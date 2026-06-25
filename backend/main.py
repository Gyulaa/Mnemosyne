import json
import os
import string
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update as sql_update, func, nullslast
from sqlalchemy.orm import Session
from starlette.responses import Response, FileResponse

from .project_manager import project_manager
from .database import Image as DBImage, Face as DBFace, Cluster as DBCluster, Person as DBPerson, Relation as DBRelation
from . import scanner as scanner_mod
from . import clusterer
from .schemas import (
    ScanStartRequest, ScanStatusResponse,
    ClusterRunRequest, ClusterResult,
    ClusterNameRequest,
    FaceAssignRequest, BatchFaceAssignRequest, CreateClusterRequest,
)
from .image_utils import load_image_bgr, crop_thumbnail

app = FastAPI(title="Photo Organizer API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    yield from project_manager.get_db()


# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    return project_manager.list_projects()


@app.get("/api/projects/active")
def active_project():
    projects = project_manager.list_projects()
    active = next((p for p in projects if p["is_active"]), None)
    if not active:
        raise HTTPException(404, "No active project")
    return active


@app.post("/api/projects")
def create_project(body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name cannot be empty")
    if scanner_mod.get_status()["running"]:
        raise HTTPException(409, "Stop the running scan before creating a new project")
    return project_manager.create_project(name)


@app.post("/api/projects/{project_id}/activate")
def activate_project(project_id: str):
    if scanner_mod.get_status()["running"]:
        raise HTTPException(409, "Stop the running scan before switching projects")
    try:
        return project_manager.switch_project(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found")


@app.patch("/api/projects/{project_id}")
def rename_project(project_id: str, body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Project name cannot be empty")
    try:
        return project_manager.rename_project(project_id, name)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found")


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    try:
        project_manager.delete_project(project_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    except FileNotFoundError:
        raise HTTPException(404, "Project not found")
    return {"ok": True}


# ── Scan ──────────────────────────────────────────────────────────────────────

@app.post("/api/scan/start")
def start_scan(req: ScanStartRequest):
    if not Path(req.path).is_dir():
        raise HTTPException(400, f"Directory not found: {req.path}")
    ok, msg = scanner_mod.start_scan(req.path, project_manager.session_factory)
    if not ok:
        raise HTTPException(409, msg)
    return {"status": "started", "path": req.path}


@app.post("/api/scan/stop")
def stop_scan():
    ok, msg = scanner_mod.stop_scan()
    return {"stopped": ok, "message": msg}


@app.get("/api/scan/status", response_model=ScanStatusResponse)
def scan_status():
    return scanner_mod.get_status()


@app.get("/api/scan/pending")
def scan_pending(db: Session = Depends(get_db)):
    count = db.query(DBImage).filter(DBImage.scan_status == "pending").count()
    return {"pending": count}


# ── Cluster ───────────────────────────────────────────────────────────────────

@app.post("/api/cluster/run", response_model=ClusterResult)
def run_cluster(req: Optional[ClusterRunRequest] = None, db: Session = Depends(get_db)):
    if req is None:
        req = ClusterRunRequest()
    return clusterer.run_clustering(db, eps=req.eps, min_samples=req.min_samples, min_det_score=req.min_det_score)


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def stats(db: Session = Depends(get_db)):
    return {
        "total_images": db.query(DBImage).count(),
        "scanned": db.query(DBImage).filter(DBImage.scan_status == "done").count(),
        "no_face": db.query(DBImage).filter(DBImage.scan_status == "no_face").count(),
        "errors": db.query(DBImage).filter(DBImage.scan_status == "error").count(),
        "pending": db.query(DBImage).filter(DBImage.scan_status == "pending").count(),
        "total_faces": db.query(DBFace).count(),
        "total_clusters": db.query(DBCluster).filter(DBCluster.label != -1).count(),
        "noise_faces": (
            db.query(DBFace)
            .join(DBCluster)
            .filter(DBCluster.label == -1)
            .count()
        ),
        "named_persons": db.query(DBPerson).filter(DBPerson.name != None).count(),
    }


# ── Images ────────────────────────────────────────────────────────────────────

@app.get("/api/images")
def list_images(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    filter: str = Query(default="all"),  # all / done / no_face / error / pending
    search: str = Query(default=""),
    sort: str = Query(default="id_desc"),  # id_desc / exif_date_desc / exif_date_asc / filename_asc
    include_person_ids: str = Query(default=""),  # comma-separated — show only images with these persons
    include_mode: str = Query(default="or"),  # or = any person present, and = all persons must be present
    exclude_person_ids: str = Query(default=""),  # comma-separated — hide images with these persons
    db: Session = Depends(get_db),
):
    q = db.query(DBImage)
    if filter != "all":
        q = q.filter(DBImage.scan_status == filter)
    if search.strip():
        q = q.filter(DBImage.path.ilike(f"%{search.strip()}%"))

    if include_person_ids.strip():
        inc_ids = [int(x) for x in include_person_ids.split(",") if x.strip().isdigit()]
        if inc_ids:
            if include_mode == "and":
                # AND: each person must appear — one subquery filter per person
                for pid in inc_ids:
                    subq = (
                        db.query(DBFace.image_id)
                        .join(DBCluster)
                        .filter(DBCluster.person_id == pid)
                        .distinct()
                        .scalar_subquery()
                    )
                    q = q.filter(DBImage.id.in_(subq))
            else:
                # OR: any of the persons must appear
                incl_subq = (
                    db.query(DBFace.image_id)
                    .join(DBCluster)
                    .filter(DBCluster.person_id.in_(inc_ids))
                    .distinct()
                    .scalar_subquery()
                )
                q = q.filter(DBImage.id.in_(incl_subq))

    if exclude_person_ids.strip():
        exc_ids = [int(x) for x in exclude_person_ids.split(",") if x.strip().isdigit()]
        if exc_ids:
            excl_subq = (
                db.query(DBFace.image_id)
                .join(DBCluster)
                .filter(DBCluster.person_id.in_(exc_ids))
                .distinct()
                .scalar_subquery()
            )
            q = q.filter(DBImage.id.notin_(excl_subq))

    total = q.count()
    if sort == "exif_date_desc":
        q = q.order_by(nullslast(DBImage.exif_date.desc()), DBImage.id.desc())
    elif sort == "exif_date_asc":
        q = q.order_by(nullslast(DBImage.exif_date.asc()), DBImage.id.asc())
    elif sort == "filename_asc":
        q = q.order_by(DBImage.path.asc())
    else:
        q = q.order_by(DBImage.id.desc())
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    status_counts = dict(
        db.query(DBImage.scan_status, func.count(DBImage.id))
        .group_by(DBImage.scan_status)
        .all()
    )

    image_ids = [img.id for img in items]
    if image_ids:
        face_counts = dict(
            db.query(DBFace.image_id, func.count(DBFace.id))
            .filter(DBFace.image_id.in_(image_ids))
            .group_by(DBFace.image_id)
            .all()
        )
        first_face_ids = dict(
            db.query(DBFace.image_id, func.min(DBFace.id))
            .filter(DBFace.image_id.in_(image_ids))
            .group_by(DBFace.image_id)
            .all()
        )
    else:
        face_counts = {}
        first_face_ids = {}

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "status_counts": {
            "done": status_counts.get("done", 0),
            "no_face": status_counts.get("no_face", 0),
            "error": status_counts.get("error", 0),
            "pending": status_counts.get("pending", 0),
        },
        "items": [
            {
                "id": img.id,
                "path": img.path,
                "filename": Path(img.path).name,
                "folder": str(Path(img.path).parent),
                "scan_status": img.scan_status,
                "error_msg": img.error_msg,
                "scanned_at": img.scanned_at.isoformat() if img.scanned_at else None,
                "exif_date": img.exif_date.isoformat() if img.exif_date else None,
                "meta_json": img.meta_json,
                "face_count": face_counts.get(img.id, 0),
                "first_face_id": first_face_ids.get(img.id),
            }
            for img in items
        ],
    }


@app.post("/api/images/bulk-delete")
def bulk_delete_images(body: dict, db: Session = Depends(get_db)):
    image_ids = body.get("image_ids", [])
    if not image_ids:
        return {"ok": True, "count": 0}
    images = db.query(DBImage).filter(DBImage.id.in_(image_ids)).all()
    count = len(images)
    for img in images:
        db.delete(img)
    db.commit()
    return {"ok": True, "count": count}


@app.delete("/api/images/{image_id}")
def delete_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(DBImage, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    db.delete(img)
    db.commit()
    return {"ok": True}


@app.get("/api/images/{image_id}/persons")
def image_persons(image_id: int, db: Session = Depends(get_db)):
    """Return the named persons (via faces → clusters) that appear in a given image."""
    faces = db.query(DBFace).filter(DBFace.image_id == image_id).all()
    seen: set[int] = set()
    result = []
    for f in faces:
        if not f.cluster_id:
            continue
        cluster = db.get(DBCluster, f.cluster_id)
        if not cluster or not cluster.person_id:
            continue
        if cluster.person_id in seen:
            continue
        seen.add(cluster.person_id)
        person = db.get(DBPerson, cluster.person_id)
        if person:
            result.append({
                "person_id": person.id,
                "person_name": person.name,
                "face_id": f.id,
                "cluster_id": f.cluster_id,
            })
    return result


@app.get("/api/images/{image_id}/view")
def view_image(image_id: int, max_size: int = 1200, db: Session = Depends(get_db)):
    """Return the image as JPEG, resized to max_size on the longest edge. Handles HEIC."""
    img_rec = db.get(DBImage, image_id)
    if not img_rec:
        raise HTTPException(404, "Image not found")
    p = Path(img_rec.path)
    if not p.exists():
        raise HTTPException(404, "File not found on disk")

    bgr = load_image_bgr(p)
    if bgr is None:
        raise HTTPException(500, "Cannot load image")

    h, w = bgr.shape[:2]
    if max(h, w) > max_size:
        scale = max_size / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return Response(content=bytes(buf), media_type="image/jpeg")


@app.get("/api/images/{image_id}/file")
def get_image_file(image_id: int, db: Session = Depends(get_db)):
    img = db.get(DBImage, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    p = Path(img.path)
    if not p.exists():
        raise HTTPException(404, "File not found on disk")
    return FileResponse(str(p))


# ── Clusters ──────────────────────────────────────────────────────────────────

@app.get("/api/clusters")
def list_clusters(db: Session = Depends(get_db)):
    clusters = db.query(DBCluster).order_by(DBCluster.label).all()
    return [
        {
            "id": c.id,
            "label": c.label,
            "face_count": len(c.faces),
            "person_id": c.person_id,
            "person_name": c.person.name if c.person else None,
            "preview_face_ids": _preview_face_ids(c.id, db),
        }
        for c in clusters
    ]


@app.get("/api/clusters/unnamed")
def list_unnamed_clusters(db: Session = Depends(get_db)):
    clusters = (
        db.query(DBCluster)
        .filter(DBCluster.person_id == None, DBCluster.label != -1)
        .order_by(DBCluster.label)
        .all()
    )
    return [
        {
            "id": c.id,
            "label": c.label,
            "face_count": len(c.faces),
            "preview_face_ids": _preview_face_ids(c.id, db),
        }
        for c in clusters
    ]


@app.patch("/api/clusters/{cluster_id}")
def rename_cluster(cluster_id: int, req: ClusterNameRequest, db: Session = Depends(get_db)):
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")

    name = req.person_name.strip()
    if not name:
        cluster.person_id = None
        db.commit()
        return {"ok": True, "person_id": None, "person_name": None}

    if cluster.person_id:
        cluster.person.name = name
        person_id = cluster.person_id
    else:
        first_face_id = cluster.faces[0].id if cluster.faces else None
        person = DBPerson(name=name, thumbnail_face_id=first_face_id)
        db.add(person)
        db.flush()
        cluster.person_id = person.id
        person_id = person.id

    db.commit()
    return {"ok": True, "person_id": person_id, "person_name": name}


@app.post("/api/clusters/{cluster_id}/link-person")
def link_cluster_person(cluster_id: int, body: dict, db: Session = Depends(get_db)):
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")
    person_id = body.get("person_id")
    if person_id is None:
        cluster.person_id = None
        db.commit()
        return {"ok": True, "person_id": None, "person_name": None}
    person = db.get(DBPerson, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    existing = db.query(DBCluster).filter(DBCluster.person_id == person_id, DBCluster.id != cluster_id).count()
    if existing > 0:
        raise HTTPException(400, "Ennek a személynek már van klasztere. Először merge-eld a Clusters tabon.")
    cluster.person_id = person.id
    db.commit()
    return {"ok": True, "person_id": person.id, "person_name": person.name}


@app.post("/api/clusters/{source_id}/merge-into/{target_id}")
def merge_clusters(source_id: int, target_id: int, db: Session = Depends(get_db)):
    if source_id == target_id:
        raise HTTPException(400, "Cannot merge a cluster with itself")

    source = db.get(DBCluster, source_id)
    target = db.get(DBCluster, target_id)
    if not source or not target:
        raise HTTPException(404, "Cluster not found")

    db.execute(sql_update(DBFace).where(DBFace.cluster_id == source_id).values(cluster_id=target_id))
    db.flush()

    if source.person_id and not target.person_id:
        target.person_id = source.person_id

    source.person_id = None
    db.flush()
    db.delete(source)
    db.commit()
    return {"ok": True, "target_cluster_id": target_id}


@app.delete("/api/clusters/{cluster_id}")
def delete_cluster(cluster_id: int, db: Session = Depends(get_db)):
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")
    if cluster.label == -1:
        raise HTTPException(400, "Cannot delete the noise cluster")

    noise = db.query(DBCluster).filter(DBCluster.label == -1).first()
    if not noise:
        noise = DBCluster(label=-1)
        db.add(noise)
        db.flush()

    db.execute(sql_update(DBFace).where(DBFace.cluster_id == cluster_id).values(cluster_id=noise.id))
    db.flush()
    cluster.person_id = None
    db.flush()
    db.delete(cluster)
    db.commit()
    return {"ok": True}


@app.post("/api/clusters")
def create_cluster(req: CreateClusterRequest, db: Session = Depends(get_db)):
    max_label = db.query(func.max(DBCluster.label)).scalar() or -1
    new_label = max(int(max_label) + 1, 0)

    cluster = DBCluster(label=new_label)
    db.add(cluster)
    db.flush()

    if req.face_ids:
        db.execute(
            sql_update(DBFace)
            .where(DBFace.id.in_(req.face_ids))
            .values(cluster_id=cluster.id, manually_assigned=True)
        )

    person_name = None
    if req.person_name and req.person_name.strip():
        person_name = req.person_name.strip()
        person = DBPerson(name=person_name)
        db.add(person)
        db.flush()
        cluster.person_id = person.id

    db.commit()
    return {
        "ok": True,
        "cluster_id": cluster.id,
        "label": new_label,
        "person_id": cluster.person_id,
        "person_name": person_name,
    }


@app.get("/api/clusters/{cluster_id}/similar-noise")
def similar_noise_faces(
    cluster_id: int,
    limit: int = Query(default=20, le=50),
    threshold: float = Query(default=0.5, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    """Return noise faces sorted by cosine similarity to this cluster's centroid."""
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")

    embeddings = []
    for face in cluster.faces:
        if face.embedding:
            emb = np.frombuffer(face.embedding, dtype=np.float32).copy()
            norm = np.linalg.norm(emb)
            if norm > 0:
                embeddings.append(emb / norm)

    if not embeddings:
        return []

    centroid = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(centroid)
    if norm > 0:
        centroid /= norm

    noise = db.query(DBCluster).filter(DBCluster.label == -1).first()
    if not noise or not noise.faces:
        return []

    candidates = []
    for face in noise.faces:
        if face.embedding:
            emb = np.frombuffer(face.embedding, dtype=np.float32).copy()
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb /= norm
                dist = float(1.0 - np.dot(centroid, emb))
                if dist <= threshold:
                    candidates.append((dist, face))

    candidates.sort(key=lambda x: x[0])

    return [
        {
            "id": f.id,
            "image_id": f.image_id,
            "image_path": f.image.path,
            "bbox": json.loads(f.bbox_json),
            "det_score": round(f.det_score, 3),
            "similarity": round(1.0 - dist, 3),
        }
        for dist, f in candidates[:limit]
    ]


@app.patch("/api/faces/{face_id}")
def assign_face(face_id: int, req: FaceAssignRequest, db: Session = Depends(get_db)):
    face = db.get(DBFace, face_id)
    if not face:
        raise HTTPException(404, "Face not found")
    target = db.get(DBCluster, req.cluster_id)
    if not target:
        raise HTTPException(404, "Target cluster not found")
    face.cluster_id = req.cluster_id
    face.manually_assigned = True
    db.commit()
    return {"ok": True}


@app.post("/api/faces/batch-assign")
def batch_assign_faces(req: BatchFaceAssignRequest, db: Session = Depends(get_db)):
    if not req.face_ids:
        raise HTTPException(400, "face_ids cannot be empty")
    target = db.get(DBCluster, req.cluster_id)
    if not target:
        raise HTTPException(404, "Target cluster not found")
    db.execute(
        sql_update(DBFace)
        .where(DBFace.id.in_(req.face_ids))
        .values(cluster_id=req.cluster_id, manually_assigned=True)
    )
    db.commit()
    return {"ok": True, "count": len(req.face_ids)}


@app.post("/api/faces/batch-unclassify")
def batch_unclassify_faces(body: dict, db: Session = Depends(get_db)):
    """Move faces back to the noise cluster and clear their manual-assignment flag."""
    face_ids = body.get("face_ids", [])
    if not face_ids:
        raise HTTPException(400, "face_ids cannot be empty")
    noise = db.query(DBCluster).filter(DBCluster.label == -1).first()
    if not noise:
        noise = DBCluster(label=-1)
        db.add(noise)
        db.flush()
    db.execute(
        sql_update(DBFace)
        .where(DBFace.id.in_(face_ids))
        .values(cluster_id=noise.id, manually_assigned=False)
    )
    db.commit()
    return {"ok": True, "count": len(face_ids)}


@app.post("/api/clusters/{cluster_id}/split")
def split_cluster(
    cluster_id: int,
    eps: float = Query(default=0.35, ge=0.1, le=0.9),
    min_samples: int = Query(default=2, ge=1),
    db: Session = Depends(get_db),
):
    """Re-cluster just the faces in this cluster with a tighter eps to find sub-groups."""
    from collections import Counter
    from sklearn.cluster import DBSCAN as SKLearnDBSCAN

    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")
    if cluster.label == -1:
        raise HTTPException(400, "Cannot split the noise cluster")

    face_data = []
    for f in cluster.faces:
        if f.embedding:
            emb = np.frombuffer(f.embedding, dtype=np.float32).copy()
            norm = np.linalg.norm(emb)
            if norm > 0:
                face_data.append((f.id, emb / norm))

    if len(face_data) < 4:
        return {"ok": False, "message": "Not enough faces to split", "sub_clusters": 0}

    face_ids_arr = [fd[0] for fd in face_data]
    embeddings = np.array([fd[1] for fd in face_data], dtype=np.float32)

    labels = SKLearnDBSCAN(eps=eps, min_samples=min_samples, metric="cosine").fit_predict(embeddings)

    unique_non_noise = [l for l in set(labels) if l != -1]
    if len(unique_non_noise) <= 1:
        return {"ok": False, "message": "Could not split at this eps — try a lower value", "sub_clusters": len(unique_non_noise)}

    label_counts = Counter(labels)
    sorted_labels = sorted(unique_non_noise, key=lambda l: -label_counts[l])

    # Noise sub-group → move to main noise cluster
    noise_face_ids = [face_ids_arr[i] for i, l in enumerate(labels) if l == -1]
    if noise_face_ids:
        noise_cluster = db.query(DBCluster).filter(DBCluster.label == -1).first()
        if not noise_cluster:
            noise_cluster = DBCluster(label=-1)
            db.add(noise_cluster)
            db.flush()
        db.execute(
            sql_update(DBFace)
            .where(DBFace.id.in_(noise_face_ids))
            .values(cluster_id=noise_cluster.id, manually_assigned=False)
        )

    # Largest sub-group stays in the original cluster
    keep_ids = [face_ids_arr[i] for i, l in enumerate(labels) if l == sorted_labels[0]]
    if keep_ids:
        db.execute(
            sql_update(DBFace).where(DBFace.id.in_(keep_ids)).values(cluster_id=cluster_id)
        )

    # Remaining sub-groups → new clusters
    max_label = db.query(func.max(DBCluster.label)).scalar() or -1
    new_clusters_info = []
    for sub_label in sorted_labels[1:]:
        sub_ids = [face_ids_arr[i] for i, l in enumerate(labels) if l == sub_label]
        max_label = int(max_label) + 1
        new_c = DBCluster(label=max_label)
        db.add(new_c)
        db.flush()
        db.execute(
            sql_update(DBFace).where(DBFace.id.in_(sub_ids)).values(cluster_id=new_c.id, manually_assigned=False)
        )
        new_clusters_info.append({"cluster_id": new_c.id, "face_count": len(sub_ids)})

    db.commit()
    return {
        "ok": True,
        "sub_clusters": len(sorted_labels),
        "kept_in_original": len(keep_ids),
        "noise_moved": len(noise_face_ids),
        "new_clusters": new_clusters_info,
    }


@app.get("/api/clusters/{cluster_id}/faces")
def get_cluster_faces(
    cluster_id: int,
    sort: str = Query(default="id_asc"),  # id_asc / exif_date_asc / exif_date_desc
    db: Session = Depends(get_db),
):
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")

    q = db.query(DBFace).filter(DBFace.cluster_id == cluster_id)
    if sort == "exif_date_asc":
        q = q.join(DBImage, DBFace.image_id == DBImage.id).order_by(
            nullslast(DBImage.exif_date.asc()), DBFace.id.asc()
        )
    elif sort == "exif_date_desc":
        q = q.join(DBImage, DBFace.image_id == DBImage.id).order_by(
            nullslast(DBImage.exif_date.desc()), DBFace.id.desc()
        )
    else:
        q = q.order_by(DBFace.id.asc())
    faces = q.all()

    return [
        {
            "id": f.id,
            "image_id": f.image_id,
            "image_path": f.image.path,
            "bbox": json.loads(f.bbox_json),
            "det_score": round(f.det_score, 3),
            "exif_date": f.image.exif_date.isoformat() if f.image.exif_date else None,
        }
        for f in faces
    ]


@app.get("/api/clusters/{cluster_id}/connections")
def cluster_connections(cluster_id: int, db: Session = Depends(get_db)):
    """Co-occurrence list for a single cluster's person: who they appear with and how many shared photos."""
    from collections import defaultdict

    cluster = db.get(DBCluster, cluster_id)
    if not cluster or not cluster.person_id:
        return []

    person_id = cluster.person_id

    rows = (
        db.query(DBFace.image_id, DBCluster.person_id)
        .join(DBCluster)
        .filter(DBCluster.person_id != None, DBCluster.label != -1)
        .all()
    )

    image_person_pairs = {(r.image_id, r.person_id) for r in rows}
    image_to_persons: dict[int, set[int]] = defaultdict(set)
    for image_id, pid in image_person_pairs:
        image_to_persons[image_id].add(pid)

    co_counts: dict[int, int] = defaultdict(int)
    intimacy_scores: dict[int, float] = defaultdict(float)
    for persons in image_to_persons.values():
        if person_id in persons:
            weight = 1.0 / len(persons)
            for other_pid in persons:
                if other_pid != person_id:
                    co_counts[other_pid] += 1
                    intimacy_scores[other_pid] += weight

    result = []
    for other_pid, count in sorted(co_counts.items(), key=lambda x: -x[1]):
        person = db.get(DBPerson, other_pid)
        if not person or not person.name:
            continue
        their_cluster = next((c for c in person.clusters if c.label != -1), None)
        result.append({
            "person_id": other_pid,
            "person_name": person.name,
            "shared_photos": count,
            "intimacy_score": round(intimacy_scores[other_pid], 3),
            "cluster_id": their_cluster.id if their_cluster else None,
            "thumbnail_face_id": _best_thumb_id(person, db),
        })

    return result


# ── Connections (co-occurrence graph) ────────────────────────────────────────

@app.get("/api/connections")
def get_connections(min_photos: int = Query(default=1, ge=1), db: Session = Depends(get_db)):
    """Co-occurrence graph: named persons as nodes, shared-photo count as edge weight."""
    from collections import defaultdict
    from itertools import combinations

    # All (image_id, person_id) pairs where the person has a name
    rows = (
        db.query(DBFace.image_id, DBCluster.person_id)
        .join(DBCluster)
        .filter(DBCluster.person_id != None, DBCluster.label != -1)
        .all()
    )

    # Deduplicate: one entry per (image, person) regardless of face count
    image_person_pairs = {(r.image_id, r.person_id) for r in rows}

    image_to_persons: dict[int, set[int]] = defaultdict(set)
    person_photo_count: dict[int, int] = defaultdict(int)
    for image_id, person_id in image_person_pairs:
        image_to_persons[image_id].add(person_id)
        person_photo_count[person_id] += 1

    # Pairwise co-occurrence counts + intimacy scores (weighted by 1/group_size)
    pair_counts: dict[tuple[int, int], int] = defaultdict(int)
    pair_intimacy: dict[tuple[int, int], float] = defaultdict(float)
    for persons in image_to_persons.values():
        w = 1.0 / len(persons)
        for a, b in combinations(sorted(persons), 2):
            pair_counts[(a, b)] += 1
            pair_intimacy[(a, b)] += w

    persons = db.query(DBPerson).filter(DBPerson.name != None).all()

    edges = [
        {"source": a, "target": b, "weight": count, "intimacy_score": round(pair_intimacy[(a, b)], 3)}
        for (a, b), count in pair_counts.items()
        if count >= min_photos
    ]

    # Only include persons that actually appear in at least one edge
    connected_ids = {e["source"] for e in edges} | {e["target"] for e in edges}
    nodes = [
        {
            "id": p.id,
            "name": p.name,
            "face_count": sum(len(c.faces) for c in p.clusters),
            "photo_count": person_photo_count.get(p.id, 0),
            "thumbnail_face_id": _best_thumb_id(p, db),
            "cluster_id": next((c.id for c in p.clusters if c.label != -1), None),
        }
        for p in persons
        if p.id in connected_ids
    ]

    return {"nodes": nodes, "edges": edges}


# ── Filesystem browser ────────────────────────────────────────────────────────

@app.get("/api/fs/list")
def fs_list(path: str = ""):
    if not path:
        items = [
            {"name": f"{letter}:", "path": f"{letter}:\\", "is_drive": True}
            for letter in string.ascii_uppercase
            if os.path.exists(f"{letter}:\\")
        ]
        return {"path": "", "parent": None, "items": items}

    p = Path(path)
    if not p.exists() or not p.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")

    parent = str(p.parent) if str(p.parent) != str(p) else None
    items = []
    try:
        for item in sorted(p.iterdir()):
            if item.is_dir() and not item.name.startswith('.'):
                try:
                    item.stat()
                    items.append({"name": item.name, "path": str(item), "is_drive": False})
                except (PermissionError, OSError):
                    pass
    except PermissionError:
        pass

    return {"path": str(p), "parent": parent, "items": items}


# ── Persons (family tree) ─────────────────────────────────────────────────────

def _preview_face_ids(cluster_id: int, db: Session, n: int = 4) -> list:
    """Top-N face IDs from a cluster, ordered by most recent EXIF date (undated last)."""
    rows = (
        db.query(DBFace.id)
        .join(DBImage, DBFace.image_id == DBImage.id)
        .filter(DBFace.cluster_id == cluster_id)
        .order_by(nullslast(DBImage.exif_date.desc()), DBFace.id.desc())
        .limit(n)
        .all()
    )
    return [r[0] for r in rows]


def _best_thumb_id(p: "DBPerson", db: Session) -> "int | None":
    """Face from the most recently taken photo; falls back to stored thumbnail_face_id."""
    if p.clusters:
        best = (
            db.query(DBFace.id)
            .join(DBImage, DBFace.image_id == DBImage.id)
            .filter(DBFace.cluster_id.in_([c.id for c in p.clusters]))
            .order_by(nullslast(DBImage.exif_date.desc()), DBFace.id.asc())
            .first()
        )
        if best:
            return best[0]
    return p.thumbnail_face_id


def _person_dict(p: "DBPerson", db: Session) -> dict:
    face_count = (
        db.query(func.count(DBFace.id))
        .join(DBCluster)
        .filter(DBCluster.person_id == p.id)
        .scalar() or 0
    )
    thumb_id = _best_thumb_id(p, db)
    linked_clusters = [
        {"id": c.id, "label": c.label, "face_count": len(c.faces)}
        for c in p.clusters if c.label != -1
    ]
    return {
        "id": p.id,
        "name": p.name,
        "birth_year": p.birth_year,
        "death_year": p.death_year,
        "notes": p.notes,
        "thumbnail_face_id": thumb_id,
        "face_count": face_count,
        "clusters": linked_clusters,
    }


@app.get("/api/persons")
def list_persons(db: Session = Depends(get_db)):
    persons = db.query(DBPerson).order_by(DBPerson.name).all()
    return [_person_dict(p, db) for p in persons]


@app.post("/api/persons", status_code=201)
def create_person(body: dict, db: Session = Depends(get_db)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    p = DBPerson(
        name=name,
        birth_year=body.get("birth_year"),
        death_year=body.get("death_year"),
        notes=body.get("notes"),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _person_dict(p, db)


@app.patch("/api/persons/{person_id}")
def update_person(person_id: int, body: dict, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    if "name" in body:
        p.name = (body["name"] or "").strip() or p.name
    if "birth_year" in body:
        p.birth_year = body["birth_year"]
    if "death_year" in body:
        p.death_year = body["death_year"]
    if "notes" in body:
        p.notes = body["notes"]
    db.commit()
    return _person_dict(p, db)


@app.delete("/api/persons/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    if p.clusters:
        raise HTTPException(400, "Cannot delete person with assigned photo clusters")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ── Relations (family tree edges) ─────────────────────────────────────────────

@app.get("/api/relations")
def list_relations(db: Session = Depends(get_db)):
    rels = db.query(DBRelation).all()
    return [{"id": r.id, "type": r.type, "person_a_id": r.person_a_id, "person_b_id": r.person_b_id} for r in rels]


@app.post("/api/relations", status_code=201)
def create_relation(body: dict, db: Session = Depends(get_db)):
    rel_type = body.get("type")
    if rel_type not in ("parent", "spouse", "sibling"):
        raise HTTPException(400, "type must be 'parent' or 'spouse'")
    a_id = body.get("person_a_id")
    b_id = body.get("person_b_id")
    if not a_id or not b_id or a_id == b_id:
        raise HTTPException(400, "person_a_id and person_b_id required and must differ")
    if not db.get(DBPerson, a_id) or not db.get(DBPerson, b_id):
        raise HTTPException(404, "Person not found")
    # Prevent duplicates (spouse and sibling are symmetric)
    from sqlalchemy import or_, and_
    if rel_type in ("spouse", "sibling"):
        existing = db.query(DBRelation).filter(
            DBRelation.type == rel_type,
            or_(
                and_(DBRelation.person_a_id == a_id, DBRelation.person_b_id == b_id),
                and_(DBRelation.person_a_id == b_id, DBRelation.person_b_id == a_id),
            ),
        ).first()
    else:
        existing = db.query(DBRelation).filter(
            DBRelation.type == rel_type,
            DBRelation.person_a_id == a_id,
            DBRelation.person_b_id == b_id,
        ).first()
    if existing:
        return {"id": existing.id, "type": existing.type, "person_a_id": existing.person_a_id, "person_b_id": existing.person_b_id}
    # Enforce max 2 parents per child
    if rel_type == "parent":
        parent_count = db.query(func.count(DBRelation.id)).filter(
            DBRelation.type == "parent",
            DBRelation.person_b_id == b_id,
        ).scalar() or 0
        if parent_count >= 2:
            raise HTTPException(400, "A személynek már van 2 szülője")
    r = DBRelation(type=rel_type, person_a_id=a_id, person_b_id=b_id)
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id, "type": r.type, "person_a_id": r.person_a_id, "person_b_id": r.person_b_id}


@app.delete("/api/relations/{relation_id}")
def delete_relation(relation_id: int, db: Session = Depends(get_db)):
    r = db.get(DBRelation, relation_id)
    if not r:
        raise HTTPException(404, "Relation not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ── Face thumbnails ────────────────────────────────────────────────────────────

@app.get("/api/faces/{face_id}/thumbnail")
def face_thumbnail(face_id: int, size: int = 160, db: Session = Depends(get_db)):
    face = db.get(DBFace, face_id)
    if not face:
        raise HTTPException(404, "Face not found")
    img = load_image_bgr(Path(face.image.path))
    if img is None:
        raise HTTPException(500, "Cannot load source image")
    thumb = crop_thumbnail(img, np.array(json.loads(face.bbox_json)), size)
    _, buf = cv2.imencode(".jpg", thumb)
    return Response(content=bytes(buf), media_type="image/jpeg")


# ── Static frontend (production build) ────────────────────────────────────────
# Must be registered LAST so /api/* routes always take precedence.
_bundle_dir = Path(os.environ.get('MNEMOSYNE_BUNDLE_DIR', str(Path(__file__).parent.parent)))
_dist = _bundle_dir / 'frontend_dist'
if not _dist.exists():
    _dist = Path(__file__).parent.parent / 'frontend' / 'dist'

if _dist.exists():
    _assets = _dist / 'assets'
    if _assets.exists():
        app.mount('/assets', StaticFiles(directory=str(_assets)), name='assets')

    @app.get('/{full_path:path}', include_in_schema=False)
    async def _spa_fallback(full_path: str):
        candidate = _dist / full_path
        if candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_dist / 'index.html'))

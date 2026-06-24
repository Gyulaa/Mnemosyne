import json
import os
import string
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update as sql_update, func
from sqlalchemy.orm import Session
from starlette.responses import Response, FileResponse

from .database import init_db, get_db, SessionLocal
from .database import Image as DBImage, Face as DBFace, Cluster as DBCluster, Person as DBPerson
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


@app.on_event("startup")
def startup():
    init_db()


# ── Scan ──────────────────────────────────────────────────────────────────────

@app.post("/api/scan/start")
def start_scan(req: ScanStartRequest):
    if not Path(req.path).is_dir():
        raise HTTPException(400, f"Directory not found: {req.path}")
    ok, msg = scanner_mod.start_scan(req.path, SessionLocal)
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
    status: Optional[str] = None,
    limit: int = Query(default=100, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(DBImage)
    if status:
        q = q.filter(DBImage.scan_status == status)
    total = q.count()
    items = q.order_by(DBImage.id).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": i.id,
                "path": i.path,
                "scan_status": i.scan_status,
                "face_count": len(i.faces),
                "exif_date": i.exif_date.isoformat() if i.exif_date else None,
            }
            for i in items
        ],
    }


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
            "preview_face_ids": [f.id for f in c.faces[:4]],
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
        {"id": c.id, "label": c.label, "face_count": len(c.faces)}
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


@app.get("/api/clusters/{cluster_id}/faces")
def get_cluster_faces(cluster_id: int, db: Session = Depends(get_db)):
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")
    return [
        {
            "id": f.id,
            "image_id": f.image_id,
            "image_path": f.image.path,
            "bbox": json.loads(f.bbox_json),
            "det_score": round(f.det_score, 3),
        }
        for f in cluster.faces
    ]


# ── Persons ───────────────────────────────────────────────────────────────────

@app.get("/api/persons")
def list_persons(db: Session = Depends(get_db)):
    persons = db.query(DBPerson).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "birth_year": p.birth_year,
            "cluster_count": len(p.clusters),
            "face_count": sum(len(c.faces) for c in p.clusters),
        }
        for p in persons
    ]


# ── Faces / media ─────────────────────────────────────────────────────────────

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

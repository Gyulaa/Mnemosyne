import io
import json
import mimetypes
import os
import re
import string
import unicodedata
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

import cv2
import numpy as np
from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update as sql_update, func, nullslast, text
from sqlalchemy.orm import Session
from starlette.responses import Response, FileResponse, StreamingResponse

from .project_manager import project_manager, PROJECTS_DIR, _read_project_json
from .database import Image as DBImage, Face as DBFace, Cluster as DBCluster, Person as DBPerson, Relation as DBRelation, Document as DBDocument, DocumentPerson as DBDocumentPerson, DocumentType as DBDocumentType, Source as DBSource, Citation as DBCitation, PersonNote as DBPersonNote, NoteCitation as DBNoteCitation, DocumentNote as DBDocumentNote, DocumentNoteCitation as DBDocumentNoteCitation, Event as DBEvent, EventPerson as DBEventPerson, EventImage as DBEventImage
from . import scanner as scanner_mod
from . import clusterer
from .clusterer import recompute_person_subclusters
from . import export_utils
from .schemas import (
    ScanStartRequest, ScanStatusResponse,
    ClusterRunRequest, ClusterResult,
    ClusterNameRequest,
    FaceAssignRequest, BatchFaceAssignRequest, CreateClusterRequest,
    SourceCreate, SourceUpdate, CitationCreate, PromoteToSourceRequest,
    NoteCreate, NoteUpdate, NoteCitationCreate,
    EventCreate, EventUpdate, EventImageAdd, EventPersonAdd,
    BulkDownloadRequest,
)
from .image_utils import load_image_bgr, crop_thumbnail, IMAGE_EXTENSIONS

app = FastAPI(title="Photo Organizer API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    yield from project_manager.get_db()


def _purge_empty_named_clusters(db: Session) -> None:
    """Delete named clusters (label >= 0) with no remaining faces.
    Persons linked via person_id are intentionally left intact so they stay
    visible in the genealogy and can be re-linked to a new cluster later."""
    db.execute(text("""
        DELETE FROM clusters
        WHERE label >= 0
          AND id NOT IN (
              SELECT DISTINCT cluster_id FROM faces WHERE cluster_id IS NOT NULL
          )
    """))
    db.commit()


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
        new_active = project_manager.delete_project(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "Project not found")
    return {"ok": True, "new_active": new_active}


@app.get("/api/projects/export")
def export_project(
    cluster_ids: str = Query(default=""),
    person_ids: str = Query(default=""),
    name: str = Query(default=""),
    include_genealogy: bool = Query(default=True),
    include_faceless: bool = Query(default=True),
    include_notes: bool = Query(default=True),
    include_sources: bool = Query(default=True),
    include_events: bool = Query(default=True),
    include_documents: bool = Query(default=True),
    include_images: bool = Query(default=True),
):
    """Download the active project as a self-contained ZIP (DB + images)."""
    project_id = project_manager.active_id
    if not project_id:
        raise HTTPException(404, "No active project")

    project_dir = PROJECTS_DIR / project_id
    source_db = project_dir / "photo_organizer.db"
    project_info = _read_project_json(project_dir / "project.json")

    if name.strip():
        project_info = {**project_info, "name": name.strip()}

    parsed_cluster_ids: list[int] | None = None
    if cluster_ids.strip():
        parsed_cluster_ids = [int(x) for x in cluster_ids.split(",") if x.strip().isdigit()]

    parsed_person_ids: list[int] | None = None
    if person_ids.strip():
        parsed_person_ids = [int(x) for x in person_ids.split(",") if x.strip().isdigit()]

    buf = export_utils.create_project_zip(
        source_db, project_info, parsed_cluster_ids,
        include_genealogy, parsed_person_ids, include_faceless,
        include_notes, include_sources, include_events,
        include_documents, include_images,
    )
    raw_name = project_info.get('name', 'project')
    ascii_name = unicodedata.normalize("NFD", raw_name).encode("ascii", "ignore").decode("ascii")
    filename = f"{ascii_name.replace(' ', '_') or 'project'}_export.zip"
    filename_utf8 = quote(f"{raw_name.replace(' ', '_')}_export.zip")

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{filename_utf8}"},
    )


@app.get("/api/export/gedcom")
def export_gedcom(
    photo_mode: str = Query("primary", regex="^(none|primary|all)$"),
    include_documents: bool = Query(True),
    include_events: bool = Query(True),
    include_sources: bool = Query(True),
    include_notes: bool = Query(True),
):
    """Export all genealogy data as a GEDCOM 5.5.1 ZIP (family.ged + media/)."""
    from . import gedcom_export

    project_id = project_manager.active_id
    if not project_id:
        raise HTTPException(404, "No active project")

    project_dir = PROJECTS_DIR / project_id
    db_path = project_dir / "photo_organizer.db"
    docs_dir = project_dir / "documents"

    project_info = _read_project_json(project_dir / "project.json")
    project_name = project_info.get("name", "family")

    buf = gedcom_export.build_gedcom_zip(
        db_path, docs_dir,
        photo_mode=photo_mode,
        include_documents=include_documents,
        include_events=include_events,
        include_sources=include_sources,
        include_notes=include_notes,
    )

    ascii_name = unicodedata.normalize("NFD", project_name).encode("ascii", "ignore").decode("ascii")
    filename = f"{ascii_name.replace(' ', '_') or 'family'}_gedcom.zip"
    filename_utf8 = quote(f"{project_name.replace(' ', '_')}_gedcom.zip")

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{filename_utf8}"},
    )


@app.post("/api/projects/import")
async def import_project(file: UploadFile = File(...)):
    """Import a project ZIP archive and activate it."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Please upload a .zip file")

    data = await file.read()
    try:
        info = export_utils.import_project_zip(data, PROJECTS_DIR)
    except (ValueError, KeyError, Exception) as e:
        raise HTTPException(400, f"Import failed: {e}")

    try:
        project = project_manager.switch_project(info["id"])
    except FileNotFoundError:
        raise HTTPException(500, "Import succeeded but could not activate project")

    return {
        **project,
        "images_reused": info.get("images_reused", 0),
        "images_new":    info.get("images_new",    0),
    }


# ── GEDCOM import ─────────────────────────────────────────────────────────────

@app.post("/api/import/gedcom/preview")
async def gedcom_import_preview(file: UploadFile = File(...)):
    """
    Parse an uploaded .ged or .zip file and return a preview of what would be
    imported, with suggested merge decisions based on name + birth-year matching.
    """
    from . import gedcom_import as gi

    project_id = project_manager.active_id
    if not project_id:
        raise HTTPException(404, "No active project")

    filename = file.filename or "upload.ged"
    data = await file.read()

    try:
        parsed, zip_bytes = gi.load_gedcom(data, filename)
    except (ValueError, Exception) as e:
        raise HTTPException(400, f"Parsing failed: {e}")

    # Load existing persons and relations for context-aware matching
    db_path = PROJECTS_DIR / project_id / "photo_organizer.db"
    import sqlite3 as _sqlite3
    conn = _sqlite3.connect(str(db_path))
    conn.row_factory = _sqlite3.Row
    try:
        existing = [dict(r) for r in conn.execute(
            "SELECT id, name, first_name, last_name, birth_year, "
            "birth_place, death_year, death_place FROM persons"
        ).fetchall()]
        existing_rels = [dict(r) for r in conn.execute(
            "SELECT type, person_a_id, person_b_id FROM relations"
        ).fetchall()]
    finally:
        conn.close()

    preview_persons = gi.build_preview(parsed, existing, existing_rels)

    # Count relations / events / sources
    total_events  = sum(len(v['events']) for v in parsed['individuals'].values())
    total_notes   = sum(len(v['notes'])  for v in parsed['individuals'].values())
    total_docs    = sum(len(v['docs'])   for v in parsed['individuals'].values())

    token = gi.store_session({
        'parsed':    parsed,
        'zip_bytes': zip_bytes,
        'project_id': project_id,
    })

    return {
        'token':            token,
        'persons':          preview_persons,
        'relations_count':  len(parsed['families']),
        'events_count':     total_events,
        'sources_count':    len(parsed['sources']),
        'notes_count':      total_notes,
        'documents_count':  total_docs,
    }


@app.post("/api/import/gedcom/confirm")
def gedcom_import_confirm(body: dict):
    """
    Execute the GEDCOM import with the user's per-person decisions.
    Expects {token: str, decisions: [{xref, action, merge_with_id}]}.
    """
    from . import gedcom_import as gi

    token     = body.get('token', '')
    decisions = body.get('decisions', [])
    options   = body.get('options', {})

    session = gi.get_session(token)
    if not session:
        raise HTTPException(400, "Import session expired — please re-upload the file")

    project_id = session['project_id']
    if project_id != project_manager.active_id:
        raise HTTPException(400, "Active project changed since preview — please re-upload")

    project_dir = PROJECTS_DIR / project_id
    db_path     = project_dir / "photo_organizer.db"
    docs_dir    = project_dir / "documents"

    try:
        stats, rollback = gi.execute_import(
            parsed    = session['parsed'],
            decisions = decisions,
            db_path   = db_path,
            docs_dir  = docs_dir,
            zip_bytes = session['zip_bytes'],
            options   = options,
        )
        gi.store_rollback(db_path, rollback)
    except Exception as e:
        raise HTTPException(500, f"Import failed: {e}")

    gi.clear_session(token)
    return {**stats, 'rollback_available': True}


@app.post("/api/import/gedcom/rollback")
def gedcom_rollback():
    """Undo the last GEDCOM import (available for 30 min after confirm)."""
    from . import gedcom_import as gi

    if not project_manager.active_id:
        raise HTTPException(400, "No active project")

    project_dir = PROJECTS_DIR / project_manager.active_id
    db_path     = project_dir / "photo_organizer.db"
    docs_dir    = project_dir / "documents"

    deleted = gi.execute_rollback(db_path, docs_dir)
    if deleted is None:
        raise HTTPException(400, "No rollback available (expired or not yet imported)")

    return {"ok": True, "deleted": deleted}


@app.get("/api/import/gedcom/rollback-status")
def gedcom_rollback_status():
    """Check if a rollback is available for the active project."""
    from . import gedcom_import as gi

    if not project_manager.active_id:
        return {"available": False}

    project_dir = PROJECTS_DIR / project_manager.active_id
    db_path     = project_dir / "photo_organizer.db"
    data = gi.get_rollback(db_path)
    if not data:
        return {"available": False}

    import time
    remaining = max(0, int(30 * 60 - (time.time() - data['created_at'])))
    return {"available": True, "expires_in_seconds": remaining}


# ── ZIP merge import ──────────────────────────────────────────────────────────

@app.post("/api/import/merge/preview")
async def merge_preview(file: UploadFile = File(...)):
    """
    Upload a project ZIP; return a per-person preview with suggested merge decisions.
    """
    from . import merge_import as mi
    from . import gedcom_import as gi

    if not project_manager.active_id:
        raise HTTPException(400, "No active project")

    project_id = project_manager.active_id
    data = await file.read()

    try:
        incoming_data = mi.read_zip_db(data)
    except (ValueError, Exception) as e:
        raise HTTPException(400, f"Could not read ZIP: {e}")

    db_path = PROJECTS_DIR / project_id / "photo_organizer.db"
    import sqlite3 as _sqlite3
    _conn = _sqlite3.connect(str(db_path))
    _conn.row_factory = _sqlite3.Row
    try:
        existing = [dict(r) for r in _conn.execute(
            "SELECT id, name, first_name, last_name, birth_year FROM persons"
        ).fetchall()]
        existing_relations = [dict(r) for r in _conn.execute(
            "SELECT id, type, person_a_id, person_b_id FROM relations"
        ).fetchall()]
    finally:
        _conn.close()

    preview_persons = mi.build_merge_preview(incoming_data, existing, existing_relations)

    token = gi.store_session({
        'incoming_data': incoming_data,
        'zip_data':      data,
        'project_id':    project_id,
    })

    return {
        'token':            token,
        'persons':          preview_persons,
        'relations_count':  len(incoming_data['relations']),
        'events_count':     len(incoming_data['events']),
        'documents_count':  len(incoming_data['documents']),
        'notes_count':      len(incoming_data['person_notes']),
        'sources_count':    len(incoming_data.get('sources', [])),
        'images_count':     len(incoming_data.get('images', [])),
        'clusters_count':   len(incoming_data.get('clusters', [])),
    }


@app.post("/api/import/merge/confirm")
def merge_confirm(body: dict):
    """
    Execute the ZIP merge with user decisions.
    Body: {token, decisions: [{incoming_id, action, merge_with_id}], options: {...}}.
    """
    from . import merge_import as mi
    from . import gedcom_import as gi

    token     = body.get('token', '')
    decisions = body.get('decisions', [])
    options   = body.get('options', {})

    session = gi.get_session(token)
    if not session:
        raise HTTPException(400, "Merge session expired — please re-upload the file")

    project_id = session['project_id']
    if project_id != project_manager.active_id:
        raise HTTPException(400, "Active project changed since preview — please re-upload")

    project_dir = PROJECTS_DIR / project_id
    db_path     = project_dir / "photo_organizer.db"
    docs_dir    = project_dir / "documents"

    try:
        stats, rollback = mi.execute_merge(
            incoming_data = session['incoming_data'],
            decisions     = decisions,
            db_path       = db_path,
            docs_dir      = docs_dir,
            zip_data      = session['zip_data'],
            options       = options,
        )
        gi.store_rollback(db_path, rollback)
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, f"Merge failed: {e}")

    gi.clear_session(token)
    return {**stats, 'rollback_available': True}


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


@app.post("/api/scan/import-files")
async def import_and_scan_files(files: List[UploadFile] = File(...)):
    active_id = project_manager.active_id
    if not active_id:
        raise HTTPException(400, "No active project")
    import_dir = PROJECTS_DIR / active_id / "imported"
    import_dir.mkdir(parents=True, exist_ok=True)

    saved = 0
    for f in files:
        if not f.filename:
            continue
        p = Path(f.filename)
        if p.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        stem = p.stem[:100]
        suffix = p.suffix.lower()
        dest = import_dir / f"{stem}{suffix}"
        counter = 1
        while dest.exists():
            dest = import_dir / f"{stem}_{counter}{suffix}"
            counter += 1
        content = await f.read()
        dest.write_bytes(content)
        saved += 1

    if saved == 0:
        raise HTTPException(400, "No valid image files received")

    ok, msg = scanner_mod.start_scan(str(import_dir), project_manager.session_factory)
    if not ok:
        raise HTTPException(409, msg)
    return {"ok": True, "count": saved, "path": str(import_dir)}


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
    # Base query: search + person filters only (no status filter).
    # Used for status_counts so each tab shows how many results it would return.
    q_base = db.query(DBImage)
    if search.strip():
        q_base = q_base.filter(DBImage.path.ilike(f"%{search.strip()}%"))

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
                    q_base = q_base.filter(DBImage.id.in_(subq))
            else:
                # OR: any of the persons must appear
                incl_subq = (
                    db.query(DBFace.image_id)
                    .join(DBCluster)
                    .filter(DBCluster.person_id.in_(inc_ids))
                    .distinct()
                    .scalar_subquery()
                )
                q_base = q_base.filter(DBImage.id.in_(incl_subq))

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
            q_base = q_base.filter(DBImage.id.notin_(excl_subq))

    # Status counts reflect search + person filters so tab badges stay accurate.
    status_counts = dict(
        q_base.with_entities(DBImage.scan_status, func.count(DBImage.id))
        .group_by(DBImage.scan_status)
        .all()
    )
    private_count = q_base.filter(DBImage.is_private == True).count()  # noqa: E712

    # Add status filter for the paginated results.
    q = q_base
    if filter == "private":
        q = q.filter(DBImage.is_private == True)  # noqa: E712
    elif filter != "all":
        q = q.filter(DBImage.scan_status == filter)

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
        "private_count": private_count,
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
                "is_private": bool(img.is_private),
            }
            for img in items
        ],
    }


@app.get("/api/events")
def list_events(has_photos: bool = Query(default=False), db: Session = Depends(get_db)):
    """List all events, optionally filtered to those with at least one photo."""
    q = db.query(DBEvent)
    if has_photos:
        q = q.filter(DBEvent.event_images.any())
    events = q.order_by(DBEvent.year.desc().nulls_last(), DBEvent.id.desc()).all()
    return [_event_dict(e) for e in events]


@app.get("/api/images/with-events")
def get_images_with_events(db: Session = Depends(get_db)):
    """Return list of image IDs that are linked to at least one event."""
    rows = db.query(DBEventImage.image_id).distinct().all()
    return [r[0] for r in rows]


@app.get("/api/images/export-zip")
def export_images_zip(
    filter: str = Query(default="all"),
    search: str = Query(default=""),
    sort: str = Query(default="id_desc"),
    include_person_ids: str = Query(default=""),
    include_mode: str = Query(default="or"),
    exclude_person_ids: str = Query(default=""),
    image_ids: str = Query(default=""),  # comma-separated; when set, overrides all other filters
    db: Session = Depends(get_db),
):
    """Download images as a ZIP file — either a specific selection or all matching the filter."""
    if image_ids.strip():
        ids = [int(x) for x in image_ids.split(",") if x.strip().isdigit()]
        images = db.query(DBImage).filter(DBImage.id.in_(ids)).all() if ids else []
    else:
        q = db.query(DBImage)
        if filter != "all":
            q = q.filter(DBImage.scan_status == filter)
        if search.strip():
            q = q.filter(DBImage.path.ilike(f"%{search.strip()}%"))
        if include_person_ids.strip():
            inc_ids = [int(x) for x in include_person_ids.split(",") if x.strip().isdigit()]
            if inc_ids:
                if include_mode == "and":
                    for pid in inc_ids:
                        subq = db.query(DBFace.image_id).join(DBCluster).filter(DBCluster.person_id == pid).distinct().scalar_subquery()
                        q = q.filter(DBImage.id.in_(subq))
                else:
                    subq = db.query(DBFace.image_id).join(DBCluster).filter(DBCluster.person_id.in_(inc_ids)).distinct().scalar_subquery()
                    q = q.filter(DBImage.id.in_(subq))
        if exclude_person_ids.strip():
            exc_ids = [int(x) for x in exclude_person_ids.split(",") if x.strip().isdigit()]
            if exc_ids:
                subq = db.query(DBFace.image_id).join(DBCluster).filter(DBCluster.person_id.in_(exc_ids)).distinct().scalar_subquery()
                q = q.filter(DBImage.id.notin_(subq))
        images = q.all()
    if not images:
        raise HTTPException(404, "No images match the current filter")

    buf = io.BytesIO()
    with __import__("zipfile").ZipFile(buf, "w", __import__("zipfile").ZIP_DEFLATED, allowZip64=True) as zf:
        for img in images:
            p = Path(img.path)
            if p.exists():
                zf.write(str(p), f"{img.id}_{p.name}")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=images_export.zip"},
    )


@app.post("/api/images/bulk-delete")
def bulk_delete_images(body: dict, db: Session = Depends(get_db)):
    image_ids = body.get("image_ids", [])
    if not image_ids:
        return {"ok": True, "count": 0}
    db.query(DBEventImage).filter(DBEventImage.image_id.in_(image_ids)).delete(synchronize_session=False)
    images = db.query(DBImage).filter(DBImage.id.in_(image_ids)).all()
    count = len(images)
    for img in images:
        db.delete(img)
    db.commit()
    _purge_empty_named_clusters(db)
    return {"ok": True, "count": count}


@app.get("/api/images/{image_id}")
def get_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(DBImage, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    face_count = db.query(func.count(DBFace.id)).filter(DBFace.image_id == image_id).scalar() or 0
    first_face = db.query(DBFace.id).filter(DBFace.image_id == image_id).order_by(DBFace.id).first()
    return {
        "id": img.id,
        "path": img.path,
        "filename": Path(img.path).name,
        "folder": str(Path(img.path).parent),
        "scan_status": img.scan_status,
        "error_msg": img.error_msg,
        "scanned_at": img.scanned_at.isoformat() if img.scanned_at else None,
        "exif_date": img.exif_date.isoformat() if img.exif_date else None,
        "meta_json": img.meta_json,
        "face_count": face_count,
        "first_face_id": first_face[0] if first_face else None,
    }


@app.delete("/api/images/{image_id}")
def delete_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(DBImage, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    db.query(DBEventImage).filter(DBEventImage.image_id == image_id).delete(synchronize_session=False)
    db.delete(img)
    db.commit()
    _purge_empty_named_clusters(db)
    return {"ok": True}


@app.patch("/api/images/{image_id}/privacy")
def toggle_image_privacy(image_id: int, body: dict, db: Session = Depends(get_db)):
    img = db.get(DBImage, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    img.is_private = bool(body.get("is_private", False))
    db.commit()
    return {"ok": True, "is_private": img.is_private}


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
            "dismissed_count": sum(1 for f in c.faces if f.dismissed),
            "person_id": c.person_id,
            "person_name": c.person.name if c.person else None,
            "preview_face_ids": _preview_face_ids(c.id, db),
            "is_private": bool(c.is_private),
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

    name_kwargs = {k: getattr(req, k) for k in ("title", "last_name", "first_name", "middle_name", "nickname") if getattr(req, k) is not None}

    if cluster.person_id:
        p = cluster.person
        p.name = name
        for k, v in name_kwargs.items():
            setattr(p, k, v)
        person_id = cluster.person_id
    else:
        first_face_id = cluster.faces[0].id if cluster.faces else None
        person = DBPerson(name=name, thumbnail_face_id=first_face_id, **name_kwargs)
        db.add(person)
        db.flush()
        cluster.person_id = person.id
        person_id = person.id

    db.commit()
    recompute_person_subclusters(person_id, db)
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
    recompute_person_subclusters(person.id, db)
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
    if target.person_id:
        recompute_person_subclusters(target.person_id, db)
    return {"ok": True, "target_cluster_id": target_id}


@app.patch("/api/clusters/{cluster_id}/privacy")
def toggle_cluster_privacy(cluster_id: int, body: dict, db: Session = Depends(get_db)):
    cluster = db.get(DBCluster, cluster_id)
    if not cluster:
        raise HTTPException(404, "Cluster not found")
    cluster.is_private = bool(body.get("is_private", False))
    db.commit()
    return {"ok": True, "is_private": cluster.is_private}


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


@app.post("/api/clusters/batch-delete")
def batch_delete_clusters(body: dict, db: Session = Depends(get_db)):
    """Delete multiple named clusters. Faces are moved to the noise cluster; persons are preserved."""
    cluster_ids: list[int] = body.get("cluster_ids", [])
    if not cluster_ids:
        return {"ok": True, "count": 0}

    clusters = db.query(DBCluster).filter(
        DBCluster.id.in_(cluster_ids),
        DBCluster.label != -1,
    ).all()

    if not clusters:
        return {"ok": True, "count": 0}

    # Ensure noise cluster exists before moving faces
    has_faced = any(db.query(DBFace).filter(DBFace.cluster_id == c.id).first() for c in clusters)
    noise = None
    if has_faced:
        noise = db.query(DBCluster).filter(DBCluster.label == -1).first()
        if not noise:
            noise = DBCluster(label=-1)
            db.add(noise)
            db.flush()

    for cluster in clusters:
        if noise:
            db.execute(
                sql_update(DBFace)
                .where(DBFace.cluster_id == cluster.id)
                .values(cluster_id=noise.id)
            )
            db.flush()
        cluster.person_id = None
        db.flush()
        db.delete(cluster)

    db.commit()
    return {"ok": True, "count": len(clusters)}


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
        name_kwargs = {k: getattr(req, k) for k in ("title", "last_name", "first_name", "middle_name", "nickname") if getattr(req, k) is not None}
        first_face_id = req.face_ids[0] if req.face_ids else None
        person = DBPerson(name=person_name, thumbnail_face_id=first_face_id, **name_kwargs)
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
    _purge_empty_named_clusters(db)
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
    _purge_empty_named_clusters(db)
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
    _purge_empty_named_clusters(db)
    return {"ok": True, "count": len(face_ids)}


@app.post("/api/faces/batch-dismiss")
def batch_dismiss_faces(body: dict, db: Session = Depends(get_db)):
    """Soft-hide faces from the unclassified view without removing them from the database."""
    face_ids = body.get("face_ids", [])
    if not face_ids:
        raise HTTPException(400, "face_ids cannot be empty")
    db.execute(sql_update(DBFace).where(DBFace.id.in_(face_ids)).values(dismissed=True))
    db.commit()
    return {"ok": True, "count": len(face_ids)}


@app.post("/api/faces/batch-restore")
def batch_restore_faces(body: dict, db: Session = Depends(get_db)):
    """Un-hide previously dismissed faces."""
    face_ids = body.get("face_ids", [])
    if not face_ids:
        raise HTTPException(400, "face_ids cannot be empty")
    db.execute(sql_update(DBFace).where(DBFace.id.in_(face_ids)).values(dismissed=False))
    db.commit()
    return {"ok": True, "count": len(face_ids)}


@app.post("/api/faces/batch-delete")
def batch_delete_faces(body: dict, db: Session = Depends(get_db)):
    """Permanently delete face records. Cannot be undone."""
    face_ids = body.get("face_ids", [])
    if not face_ids:
        raise HTTPException(400, "face_ids cannot be empty")
    db.query(DBFace).filter(DBFace.id.in_(face_ids)).delete(synchronize_session=False)
    db.commit()
    _purge_empty_named_clusters(db)
    return {"ok": True, "count": len(face_ids)}


@app.post("/api/clusters/{cluster_id}/split")
def split_cluster(
    cluster_id: int,
    eps: float = Query(default=0.35, ge=0.1, le=0.9),
    min_samples: int = Query(default=3, ge=1),
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
    _purge_empty_named_clusters(db)
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
            "dismissed": bool(f.dismissed),
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
        "title": p.title,
        "last_name": p.last_name,
        "first_name": p.first_name,
        "middle_name": p.middle_name,
        "nickname": p.nickname,
        "sex": p.sex,
        "birth_year": p.birth_year,
        "birth_place": p.birth_place,
        "birth_date": p.birth_date,
        "christening_year": p.christening_year,
        "christening_place": p.christening_place,
        "christening_date": p.christening_date,
        "death_year": p.death_year,
        "death_place": p.death_place,
        "death_date": p.death_date,
        "burial_year": p.burial_year,
        "burial_place": p.burial_place,
        "burial_date": p.burial_date,
        "occupation": p.occupation,
        "religion": p.religion,
        "nationality": p.nationality,
        "cause_of_death": p.cause_of_death,
        "education": p.education,
        "notes": p.notes,
        "hidden_auto_events": json.loads(p.hidden_auto_events) if p.hidden_auto_events else [],
        "thumbnail_face_id": thumb_id,
        "face_count": face_count,
        "clusters": linked_clusters,
    }


def _rel_dict(r: "DBRelation") -> dict:
    return {
        "id": r.id,
        "type": r.type,
        "person_a_id": r.person_a_id,
        "person_b_id": r.person_b_id,
        "marriage_year": r.marriage_year,
        "marriage_place": r.marriage_place,
        "divorce_year": r.divorce_year,
        "divorce_place": r.divorce_place,
        "is_private": bool(r.is_private),
    }


def _doc_dict(d: "DBDocument") -> dict:
    return {
        "id": d.id,
        "person_id": d.person_id,
        "stored_name": d.stored_name,
        "filename": d.filename,
        "mime_type": d.mime_type,
        "title": d.title,
        "doc_type": d.doc_type,
        "year": d.year,
        "description": d.description,
        "created_at": d.created_at,
        "is_private": bool(d.is_private),
        "source_id": d.source.id if d.source else None,
        "persons": [
            {"id": dp.person_id, "name": dp.person.name if dp.person else None}
            for dp in (d.linked_persons or [])
        ],
    }


def _source_dict(s: "DBSource") -> dict:
    return {
        "id": s.id,
        "title": s.title,
        "source_type": s.source_type,
        "author": s.author,
        "year": s.year,
        "publisher": s.publisher,
        "location": s.location,
        "url": s.url,
        "description": s.description,
        "document_id": s.document_id,
        "event_id": s.event_id,
        "created_at": s.created_at,
        "citation_count": len(s.citations),
    }


def _citation_dict(c: "DBCitation") -> dict:
    return {
        "id": c.id,
        "source_id": c.source_id,
        "person_id": c.person_id,
        "fact": c.fact,
        "detail": c.detail,
        "notes": c.notes,
        "source_title": c.source.title if c.source else None,
        "source_type": c.source.source_type if c.source else None,
        "source_document_id": c.source.document_id if c.source else None,
        "source_year": c.source.year if c.source else None,
        "source_author": c.source.author if c.source else None,
    }


def _docs_dir() -> Path:
    pid = project_manager.active_id
    if not pid:
        raise HTTPException(404, "No active project")
    d = PROJECTS_DIR / pid / "documents"
    d.mkdir(parents=True, exist_ok=True)
    return d


@app.get("/api/persons")
def list_persons(db: Session = Depends(get_db)):
    persons = db.query(DBPerson).order_by(DBPerson.name).all()
    return [_person_dict(p, db) for p in persons]


_PERSON_FIELDS = [
    "title", "last_name", "first_name", "middle_name", "nickname",
    "sex", "birth_year", "birth_place", "birth_date",
    "christening_year", "christening_place", "christening_date",
    "death_year", "death_place", "death_date",
    "burial_year", "burial_place", "burial_date",
    "occupation", "religion", "nationality", "cause_of_death", "education",
    "notes", "hidden_auto_events",
]


def _year_from_date(d: str | None) -> int | None:
    if d and len(d) >= 4:
        try:
            return int(d[:4])
        except ValueError:
            pass
    return None


def _derive_display_name(title: str | None, last_name: str | None, first_name: str | None, middle_name: str | None = None) -> str | None:
    parts = [p.strip() for p in [title, last_name, first_name, middle_name] if p and p.strip()]
    return ' '.join(parts) or None


@app.post("/api/persons", status_code=201)
def create_person(body: dict, db: Session = Depends(get_db)):
    derived = _derive_display_name(body.get("title"), body.get("last_name"), body.get("first_name"))
    name = derived or (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    p = DBPerson(name=name, **{f: body.get(f) for f in _PERSON_FIELDS if f in body})
    db.add(p)
    db.commit()
    db.refresh(p)
    return _person_dict(p, db)


@app.patch("/api/persons/{person_id}")
def update_person(person_id: int, body: dict, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    for f in _PERSON_FIELDS:
        if f in body:
            val = body[f]
            if f == "hidden_auto_events" and isinstance(val, list):
                val = json.dumps(val)
            setattr(p, f, val)
    # Auto-derive display name from name parts when any part is provided
    name_parts_in_body = any(k in body for k in ("title", "last_name", "first_name", "middle_name"))
    if name_parts_in_body:
        derived = _derive_display_name(p.title, p.last_name, p.first_name, p.middle_name)
        if derived:
            p.name = derived
    elif "name" in body:
        p.name = (body["name"] or "").strip() or p.name
    # Auto-derive _year from _date so tree display stays in sync
    for prefix in ("birth", "death", "christening", "burial"):
        if f"{prefix}_date" in body:
            setattr(p, f"{prefix}_year", _year_from_date(getattr(p, f"{prefix}_date")))
    db.commit()
    return _person_dict(p, db)


@app.post("/api/persons/{source_id}/merge-into/{target_id}")
def merge_persons(source_id: int, target_id: int, db: Session = Depends(get_db)):
    """Merge source into target. Target's non-null fields take priority. Source is deleted."""
    src = db.get(DBPerson, source_id)
    tgt = db.get(DBPerson, target_id)
    if not src or not tgt:
        raise HTTPException(404, "Person not found")
    if source_id == target_id:
        raise HTTPException(400, "Cannot merge a person into themselves")

    # 1. Fill missing biographical fields on target from source
    bio_fields = [
        "title", "last_name", "first_name", "middle_name", "nickname",
        "sex",
        "birth_year", "birth_place", "birth_date",
        "christening_year", "christening_place", "christening_date",
        "death_year", "death_place", "death_date",
        "burial_year", "burial_place", "burial_date",
        "occupation", "religion", "nationality", "cause_of_death", "education",
        "thumbnail_face_id",
    ]
    for f in bio_fields:
        if getattr(tgt, f) is None and getattr(src, f) is not None:
            setattr(tgt, f, getattr(src, f))

    # Merge hidden_auto_events lists (union, deduplicated)
    tgt_hidden = json.loads(tgt.hidden_auto_events) if tgt.hidden_auto_events else []
    src_hidden = json.loads(src.hidden_auto_events) if src.hidden_auto_events else []
    merged_hidden = list(dict.fromkeys(tgt_hidden + src_hidden))
    tgt.hidden_auto_events = json.dumps(merged_hidden) if merged_hidden else None

    # 2. Re-link clusters from source → target
    # Raw SQL avoids SQLAlchemy nullifying person_id when src is later deleted:
    # setting cluster.person_id via ORM doesn't update src.clusters in-memory, so
    # db.delete(src) would emit UPDATE SET person_id=NULL before the DELETE.
    db.execute(
        sql_update(DBCluster)
        .where(DBCluster.person_id == source_id)
        .values(person_id=target_id)
    )
    db.expire(src)  # force reload of src.clusters from DB (now empty) before delete

    # 3. Transfer relations using raw SQL to avoid ORM cascade-delete on db.delete(src).
    # The Person model has cascade="all, delete-orphan" on relations_as_a/b, so when
    # db.delete(src) is called, SQLAlchemy lazy-loads src's relations from the DB and
    # cascade-deletes them — even if we already updated the FK columns via ORM objects.
    # Using raw SQL + db.expire(src) ensures the ORM sees an empty collection at delete time.
    def _rkey(type_, a, b):
        return (type_, min(a, b), max(a, b))

    existing_rel_keys: set = set()
    for row in db.execute(
        text("SELECT type, person_a_id, person_b_id FROM relations WHERE person_a_id=:tid OR person_b_id=:tid"),
        {"tid": target_id}
    ).fetchall():
        existing_rel_keys.add(_rkey(row[0], row[1], row[2]))

    for row in db.execute(
        text("SELECT id, type, person_a_id, person_b_id FROM relations WHERE person_a_id=:sid OR person_b_id=:sid"),
        {"sid": source_id}
    ).fetchall():
        rid, rtype, ra, rb = row[0], row[1], row[2], row[3]
        new_a = target_id if ra == source_id else ra
        new_b = target_id if rb == source_id else rb
        if new_a == new_b:
            db.execute(text("DELETE FROM relations WHERE id=:id"), {"id": rid})
            continue
        key = _rkey(rtype, new_a, new_b)
        if key in existing_rel_keys:
            db.execute(text("DELETE FROM relations WHERE id=:id"), {"id": rid})
        else:
            db.execute(
                text("UPDATE relations SET person_a_id=:a, person_b_id=:b WHERE id=:id"),
                {"a": new_a, "b": new_b, "id": rid}
            )
            existing_rel_keys.add(key)

    db.expire(src)  # clear ORM's in-memory relation collections so cascade sees nothing to delete

    # 4. Transfer event_persons (avoid duplicate person in same event)
    tgt_event_ids = {
        ep.event_id for ep in db.query(DBEventPerson).filter(DBEventPerson.person_id == target_id).all()
    }
    src_eps = db.query(DBEventPerson).filter(DBEventPerson.person_id == source_id).all()
    for ep in src_eps:
        if ep.event_id in tgt_event_ids:
            # Target already in this event — promote featured if source was featured
            if ep.featured:
                tgt_ep = db.query(DBEventPerson).filter(
                    DBEventPerson.event_id == ep.event_id,
                    DBEventPerson.person_id == target_id,
                ).first()
                if tgt_ep:
                    tgt_ep.featured = True
            db.delete(ep)
        else:
            ep.person_id = target_id
            tgt_event_ids.add(ep.event_id)

    # 5. Transfer documents, notes, citations
    db.execute(text("UPDATE documents    SET person_id = :tid WHERE person_id = :sid"), {"tid": target_id, "sid": source_id})
    db.execute(text("UPDATE person_notes SET person_id = :tid WHERE person_id = :sid"), {"tid": target_id, "sid": source_id})
    db.execute(text("UPDATE citations    SET person_id = :tid WHERE person_id = :sid"), {"tid": target_id, "sid": source_id})

    # 6. Delete source (event_persons already transferred; relations already transferred)
    db.execute(text("DELETE FROM event_persons WHERE person_id = :sid"), {"sid": source_id})
    db.delete(src)
    db.commit()

    # Sync derived year fields on target
    for prefix in ("birth", "death", "christening", "burial"):
        date_val = getattr(tgt, f"{prefix}_date")
        if date_val:
            setattr(tgt, f"{prefix}_year", _year_from_date(date_val))
    db.commit()

    # Recompute sub-clusters for target: it now has all of source's faces too
    recompute_person_subclusters(target_id, db)

    return _person_dict(tgt, db)


@app.delete("/api/persons/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    if p.clusters:
        raise HTTPException(400, "Cannot delete person with assigned photo clusters")
    # event_persons has no ORM cascade from Person and the actual DB table was created
    # by Base.metadata.create_all() without ON DELETE CASCADE, so delete manually.
    db.execute(text("DELETE FROM event_persons WHERE person_id = :pid"), {"pid": person_id})
    db.delete(p)
    db.commit()
    # Clean up events that no longer have any participants
    with db.bind.connect() as conn:
        conn.execute(text("DELETE FROM events WHERE id NOT IN (SELECT DISTINCT event_id FROM event_persons)"))
        conn.commit()
    return {"ok": True}


# ── Relations (family tree edges) ─────────────────────────────────────────────

@app.get("/api/relations")
def list_relations(db: Session = Depends(get_db)):
    return [_rel_dict(r) for r in db.query(DBRelation).all()]


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
        return _rel_dict(existing)
    # Enforce max 2 parents per child
    if rel_type == "parent":
        parent_count = db.query(func.count(DBRelation.id)).filter(
            DBRelation.type == "parent",
            DBRelation.person_b_id == b_id,
        ).scalar() or 0
        if parent_count >= 2:
            raise HTTPException(400, "A személynek már van 2 szülője")
    # Infer sex from spouse pairing: if one is known, set the other to opposite.
    if rel_type == "spouse":
        pa = db.get(DBPerson, a_id)
        pb = db.get(DBPerson, b_id)
        if pa and pb:
            if pa.sex and not pb.sex:
                pb.sex = 'F' if pa.sex == 'M' else 'M'
            elif pb.sex and not pa.sex:
                pa.sex = 'F' if pb.sex == 'M' else 'M'

    r = DBRelation(type=rel_type, person_a_id=a_id, person_b_id=b_id)
    db.add(r)
    db.commit()
    db.refresh(r)
    return _rel_dict(r)


@app.patch("/api/relations/{relation_id}")
def update_relation(relation_id: int, body: dict, db: Session = Depends(get_db)):
    r = db.get(DBRelation, relation_id)
    if not r:
        raise HTTPException(404, "Relation not found")
    for f in ("marriage_year", "marriage_place", "divorce_year", "divorce_place", "is_private"):
        if f in body:
            setattr(r, f, body[f])
    db.commit()
    return _rel_dict(r)


@app.delete("/api/relations/{relation_id}")
def delete_relation(relation_id: int, db: Session = Depends(get_db)):
    r = db.get(DBRelation, relation_id)
    if not r:
        raise HTTPException(404, "Relation not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ── Documents ─────────────────────────────────────────────────────────────────

@app.get("/api/documents")
def list_all_documents(db: Session = Depends(get_db)):
    docs = db.query(DBDocument).order_by(DBDocument.created_at.desc()).all()
    return [_doc_dict(d) for d in docs]


@app.get("/api/persons/{person_id}/documents")
def list_documents(person_id: int, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    # Query via junction table so all documents linked to this person are returned
    docs = (
        db.query(DBDocument)
        .join(DBDocumentPerson, DBDocumentPerson.document_id == DBDocument.id)
        .filter(DBDocumentPerson.person_id == person_id)
        .order_by(DBDocument.year, DBDocument.created_at)
        .all()
    )
    return [_doc_dict(d) for d in docs]


@app.post("/api/persons/{person_id}/documents", status_code=201)
async def upload_document(
    person_id: int,
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    doc_type: Optional[str] = Form(default="other"),
    year: Optional[int] = Form(default=None),
    description: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    docs_dir = _docs_dir()
    ext = Path(file.filename or "file").suffix or ""
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = docs_dir / stored_name
    data = await file.read()
    dest.write_bytes(data)
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0]
    doc = DBDocument(
        person_id=person_id,
        stored_name=stored_name,
        filename=file.filename or stored_name,
        mime_type=mime,
        title=title or None,
        doc_type=doc_type or "other",
        year=year,
        description=description or None,
        created_at=datetime.now().isoformat(),
    )
    db.add(doc)
    db.flush()
    # Also insert into junction table
    db.add(DBDocumentPerson(document_id=doc.id, person_id=person_id))
    db.commit()
    db.refresh(doc)
    return _doc_dict(doc)


@app.post("/api/documents/{doc_id}/persons/{person_id}", status_code=201)
def link_person_to_document(doc_id: int, person_id: int, db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    if not db.get(DBPerson, person_id):
        raise HTTPException(404, "Person not found")
    existing = db.get(DBDocumentPerson, (doc_id, person_id))
    if not existing:
        db.add(DBDocumentPerson(document_id=doc_id, person_id=person_id))
        db.commit()
        db.refresh(d)
    return _doc_dict(d)


@app.delete("/api/documents/{doc_id}/persons/{person_id}")
def unlink_person_from_document(doc_id: int, person_id: int, db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    dp = db.get(DBDocumentPerson, (doc_id, person_id))
    if dp:
        db.delete(dp)
        db.commit()
        db.refresh(d)
    return _doc_dict(d)


# ── Document types ─────────────────────────────────────────────────────────────

@app.get("/api/document-types")
def list_document_types(db: Session = Depends(get_db)):
    types = db.query(DBDocumentType).order_by(DBDocumentType.sort_order, DBDocumentType.label).all()
    return [{"id": t.id, "key": t.key, "label": t.label, "sort_order": t.sort_order} for t in types]


@app.post("/api/document-types", status_code=201)
def create_document_type(body: dict, db: Session = Depends(get_db)):
    key = (body.get("key") or "").strip()
    label = (body.get("label") or "").strip()
    if not key or not label:
        raise HTTPException(400, "key and label are required")
    existing = db.query(DBDocumentType).filter(DBDocumentType.key == key).first()
    if existing:
        raise HTTPException(409, "A type with this key already exists")
    max_order = db.query(func.max(DBDocumentType.sort_order)).scalar() or 0
    t = DBDocumentType(key=key, label=label, sort_order=max_order + 1)
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "key": t.key, "label": t.label, "sort_order": t.sort_order}


@app.patch("/api/document-types/{type_id}")
def update_document_type(type_id: int, body: dict, db: Session = Depends(get_db)):
    t = db.get(DBDocumentType, type_id)
    if not t:
        raise HTTPException(404, "Document type not found")
    if "label" in body and body["label"]:
        t.label = body["label"].strip()
    if "sort_order" in body:
        t.sort_order = int(body["sort_order"])
    db.commit()
    return {"id": t.id, "key": t.key, "label": t.label, "sort_order": t.sort_order}


@app.delete("/api/document-types/{type_id}")
def delete_document_type(type_id: int, db: Session = Depends(get_db)):
    t = db.get(DBDocumentType, type_id)
    if not t:
        raise HTTPException(404, "Document type not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


@app.patch("/api/documents/{doc_id}")
def update_document(doc_id: int, body: dict, db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    for f in ("title", "doc_type", "year", "description", "is_private"):
        if f in body:
            setattr(d, f, body[f])
    db.commit()
    return _doc_dict(d)


@app.get("/api/documents/{doc_id}/file")
def serve_document(doc_id: int, dl: bool = Query(default=False), db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    docs_dir = _docs_dir()
    path = docs_dir / d.stored_name
    if not path.exists():
        raise HTTPException(404, "File not found on disk")
    disposition = "attachment" if dl else "inline"
    safe_name = quote(d.filename)
    return FileResponse(
        str(path),
        media_type=d.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'{disposition}; filename="{safe_name}"'},
    )


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    docs_dir = _docs_dir()
    path = docs_dir / d.stored_name
    if path.exists():
        path.unlink(missing_ok=True)
    db.delete(d)
    db.commit()
    return {"ok": True}


@app.post("/api/documents/bulk-download")
def bulk_download_documents(body: BulkDownloadRequest, db: Session = Depends(get_db)):
    import zipfile as _zf
    import re as _re

    _person_ref_re = _re.compile(r"@\[([^\]]+)\]\(#pid-\d+\)")
    _md_link_re    = _re.compile(r"\[([^\]]*)\]\([^)]*\)")

    def _plain(text: str) -> str:
        text = _person_ref_re.sub(r"\1", text)
        text = _md_link_re.sub(r"\1", text)
        return text.strip()

    docs = (
        db.query(DBDocument)
        .filter(DBDocument.id.in_(body.ids))
        .all()
    )
    if not docs:
        raise HTTPException(404, "No documents found")

    docs_dir = _docs_dir()

    # Build deduplicated archive filenames
    used: dict[str, int] = {}
    archive_names: dict[int, str] = {}
    for doc in docs:
        base = doc.filename or doc.stored_name
        if base not in used:
            used[base] = 0
            archive_names[doc.id] = base
        else:
            used[base] += 1
            name, _, ext = base.rpartition(".")
            archive_names[doc.id] = f"{name} ({used[base]}).{ext}" if ext else f"{base} ({used[base]})"

    buf = io.BytesIO()
    with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED, allowZip64=True) as zf:

        index_parts: list[str] = []

        for i, doc in enumerate(docs, 1):
            # Add the file
            file_path = docs_dir / doc.stored_name
            if file_path.exists():
                zf.write(str(file_path), archive_names[doc.id])

            if body.include_notes:
                # ── Build index entry ─────────────────────────────────────
                header_parts = []
                if doc.doc_type:
                    header_parts.append(doc.doc_type.replace("_", " ").title())
                if doc.year:
                    header_parts.append(str(doc.year))
                header_meta = " | ".join(header_parts)

                persons = (
                    db.query(DBPerson)
                    .join(DBDocumentPerson, DBDocumentPerson.person_id == DBPerson.id)
                    .filter(DBDocumentPerson.document_id == doc.id)
                    .order_by(DBPerson.name)
                    .all()
                )
                person_names = ", ".join(p.name or "(unnamed)" for p in persons) or "—"

                lines: list[str] = []
                title = doc.title or doc.filename
                lines.append(f"[{i}] {title}")
                lines.append("    " + "─" * max(len(title) + 4, 20))
                if header_meta:
                    lines.append(f"    {header_meta}")
                lines.append(f"    File:    {archive_names[doc.id]}")
                lines.append(f"    Persons: {person_names}")
                if doc.description:
                    lines.append(f"    Description: {_plain(doc.description)}")

                notes = (
                    db.query(DBDocumentNote)
                    .filter(DBDocumentNote.document_id == doc.id)
                    .order_by(DBDocumentNote.sort_order)
                    .all()
                )
                if notes:
                    lines.append("")
                    lines.append("    Notes:")
                    for note in notes:
                        if note.title:
                            lines.append(f"    ▸ {note.title}")
                        content = _plain(note.content or "")
                        for line in content.splitlines():
                            lines.append(f"      {line}")
                        cites = sorted(note.note_citations, key=lambda c: c.marker)
                        if cites:
                            cite_strs = []
                            for nc in cites:
                                if nc.source:
                                    s = nc.source
                                    label = s.title
                                    if s.year:
                                        label += f" ({s.year})"
                                    if nc.detail:
                                        label += f" — {nc.detail}"
                                elif nc.custom_label:
                                    label = nc.custom_label
                                    if nc.detail:
                                        label += f" — {nc.detail}"
                                else:
                                    label = f"[{nc.marker}]"
                                cite_strs.append(f"      [{nc.marker}] {label}")
                            lines.append("      Sources:")
                            lines.extend(cite_strs)

                index_parts.append("\n".join(lines))

        if body.include_notes and index_parts:
            header = (
                "Documents Export\n"
                "================\n"
                f"Exported: {datetime.utcnow().strftime('%Y-%m-%d')}\n"
                f"Files: {len(docs)}\n"
                "\n"
            )
            index_text = header + "\n\n".join(index_parts) + "\n"
            zf.writestr("_index.txt", index_text.encode("utf-8"))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="documents.zip"'},
    )


# ── Sources ───────────────────────────────────────────────────────────────────

@app.get("/api/sources")
def list_sources(db: Session = Depends(get_db)):
    sources = db.query(DBSource).order_by(DBSource.year, DBSource.title).all()
    return [_source_dict(s) for s in sources]


@app.post("/api/sources", status_code=201)
def create_source(body: SourceCreate, db: Session = Depends(get_db)):
    s = DBSource(
        title=body.title,
        source_type=body.source_type,
        author=body.author,
        year=body.year,
        publisher=body.publisher,
        location=body.location,
        url=body.url,
        description=body.description,
        document_id=body.document_id,
        event_id=body.event_id,
        created_at=datetime.now().isoformat(),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _source_dict(s)


@app.patch("/api/sources/{source_id}")
def update_source(source_id: int, body: SourceUpdate, db: Session = Depends(get_db)):
    s = db.get(DBSource, source_id)
    if not s:
        raise HTTPException(404, "Source not found")
    for field in ("title", "source_type", "author", "year", "publisher", "location", "url", "description"):
        val = getattr(body, field)
        if val is not None:
            setattr(s, field, val)
    db.commit()
    return _source_dict(s)


@app.delete("/api/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    s = db.get(DBSource, source_id)
    if not s:
        raise HTTPException(404, "Source not found")
    db.delete(s)
    db.commit()
    return {"ok": True}


@app.post("/api/documents/{doc_id}/promote-to-source", status_code=201)
def promote_document_to_source(doc_id: int, body: PromoteToSourceRequest, db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    if d.source:
        return _source_dict(d.source)
    # Infer source_type from mime_type
    inferred_type = "other"
    if d.mime_type:
        if d.mime_type.startswith("audio/"):
            inferred_type = "audio"
        elif d.mime_type == "application/pdf" or d.mime_type.startswith("image/"):
            inferred_type = "register"
    s = DBSource(
        title=body.title or d.title or d.filename,
        source_type=body.source_type or inferred_type,
        year=d.year,
        document_id=doc_id,
        created_at=datetime.now().isoformat(),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _source_dict(s)


# ── Citations ─────────────────────────────────────────────────────────────────

@app.get("/api/persons/{person_id}/citations")
def list_citations(person_id: int, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    citations = db.query(DBCitation).filter(DBCitation.person_id == person_id).all()
    return [_citation_dict(c) for c in citations]


@app.post("/api/persons/{person_id}/citations", status_code=201)
def add_citation(person_id: int, body: CitationCreate, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    if not db.get(DBSource, body.source_id):
        raise HTTPException(404, "Source not found")
    c = DBCitation(
        source_id=body.source_id,
        person_id=person_id,
        fact=body.fact,
        detail=body.detail,
        notes=body.notes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _citation_dict(c)


@app.patch("/api/citations/{citation_id}")
def update_citation(citation_id: int, body: dict, db: Session = Depends(get_db)):
    c = db.get(DBCitation, citation_id)
    if not c:
        raise HTTPException(404, "Citation not found")
    for field in ("fact", "detail", "notes"):
        if field in body:
            setattr(c, field, body[field])
    db.commit()
    return _citation_dict(c)


@app.delete("/api/citations/{citation_id}")
def delete_citation(citation_id: int, db: Session = Depends(get_db)):
    c = db.get(DBCitation, citation_id)
    if not c:
        raise HTTPException(404, "Citation not found")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ── Person Notes ──────────────────────────────────────────────────────────────

def _note_citation_dict(nc: "DBNoteCitation") -> dict:
    return {
        "id": nc.id,
        "note_id": nc.note_id,
        "source_id": nc.source_id,
        "marker": nc.marker,
        "detail": nc.detail,
        "custom_label": getattr(nc, 'custom_label', None),
        "source_title": nc.source.title if nc.source else None,
        "source_type": nc.source.source_type if nc.source else None,
        "source_document_id": nc.source.document_id if nc.source else None,
        "source_event_id": nc.source.event_id if nc.source else None,
        "source_year": nc.source.year if nc.source else None,
        "source_author": nc.source.author if nc.source else None,
    }


def _note_dict(n: "DBPersonNote") -> dict:
    return {
        "id": n.id,
        "person_id": n.person_id,
        "title": n.title,
        "content": n.content,
        "sort_order": n.sort_order,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
        "is_private": bool(n.is_private),
        "citations": sorted([_note_citation_dict(nc) for nc in n.note_citations], key=lambda x: x["marker"]),
    }


@app.get("/api/notes")
def list_all_notes(db: Session = Depends(get_db)):
    """Lightweight note list for search — returns id, person_id, title and content only."""
    notes = db.query(DBPersonNote).order_by(DBPersonNote.person_id).all()
    return [
        {"id": n.id, "person_id": n.person_id, "title": n.title, "content": n.content}
        for n in notes
    ]


@app.get("/api/persons/{person_id}/notes")
def list_notes(person_id: int, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    notes = db.query(DBPersonNote).filter(DBPersonNote.person_id == person_id).order_by(DBPersonNote.sort_order, DBPersonNote.created_at).all()
    return [_note_dict(n) for n in notes]


@app.post("/api/persons/{person_id}/notes", status_code=201)
def create_note(person_id: int, body: NoteCreate, db: Session = Depends(get_db)):
    p = db.get(DBPerson, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    now = datetime.now().isoformat()
    n = DBPersonNote(
        person_id=person_id,
        title=body.title or None,
        content=body.content,
        sort_order=body.sort_order,
        created_at=now,
        updated_at=now,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return _note_dict(n)


@app.patch("/api/notes/{note_id}")
def update_note(note_id: int, body: NoteUpdate, db: Session = Depends(get_db)):
    n = db.get(DBPersonNote, note_id)
    if not n:
        raise HTTPException(404, "Note not found")
    if body.title is not None:
        n.title = body.title or None
    if body.content is not None:
        n.content = body.content
    if body.sort_order is not None:
        n.sort_order = body.sort_order
    if body.is_private is not None:
        n.is_private = body.is_private
    n.updated_at = datetime.now().isoformat()
    db.commit()
    return _note_dict(n)


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    n = db.get(DBPersonNote, note_id)
    if not n:
        raise HTTPException(404, "Note not found")
    db.delete(n)
    db.commit()
    return {"ok": True}


@app.post("/api/notes/{note_id}/citations", status_code=201)
def add_note_citation(note_id: int, body: NoteCitationCreate, db: Session = Depends(get_db)):
    n = db.get(DBPersonNote, note_id)
    if not n:
        raise HTTPException(404, "Note not found")
    if body.source_id is not None and not db.get(DBSource, body.source_id):
        raise HTTPException(404, "Source not found")
    if body.source_id is None and not body.custom_label:
        raise HTTPException(400, "Either source_id or custom_label is required")
    nc = DBNoteCitation(
        note_id=note_id,
        source_id=body.source_id,
        marker=body.marker,
        detail=body.detail,
        custom_label=body.custom_label,
    )
    db.add(nc)
    db.commit()
    db.refresh(nc)
    return _note_citation_dict(nc)


@app.patch("/api/note-citations/{nc_id}")
def update_note_citation(nc_id: int, body: dict, db: Session = Depends(get_db)):
    nc = db.get(DBNoteCitation, nc_id)
    if not nc:
        raise HTTPException(404, "Note citation not found")
    for field in ("source_id", "marker", "detail"):
        if field in body:
            setattr(nc, field, body[field])
    db.commit()
    return _note_citation_dict(nc)


@app.delete("/api/note-citations/{nc_id}")
def delete_note_citation(nc_id: int, db: Session = Depends(get_db)):
    nc = db.get(DBNoteCitation, nc_id)
    if not nc:
        raise HTTPException(404, "Note citation not found")
    db.delete(nc)
    db.commit()
    return {"ok": True}


# ── Document notes ────────────────────────────────────────────────────────────

def _doc_note_citation_dict(nc: "DBDocumentNoteCitation") -> dict:
    src = nc.source
    return {
        "id": nc.id, "note_id": nc.note_id,
        "source_id": nc.source_id,
        "marker": nc.marker, "detail": nc.detail,
        "custom_label": nc.custom_label,
        "source_title": src.title if src else None,
        "source_type": src.source_type if src else None,
        "source_document_id": src.document_id if src else None,
        "source_event_id": src.event_id if src else None,
        "source_year": src.year if src else None,
        "source_author": src.author if src else None,
    }


def _doc_note_dict(n: "DBDocumentNote") -> dict:
    return {
        "id": n.id, "document_id": n.document_id,
        "title": n.title, "content": n.content,
        "sort_order": n.sort_order,
        "created_at": n.created_at, "updated_at": n.updated_at,
        "citations": sorted(
            [_doc_note_citation_dict(nc) for nc in n.note_citations],
            key=lambda x: x["marker"],
        ),
    }


@app.get("/api/documents/{doc_id}/notes")
def list_doc_notes(doc_id: int, db: Session = Depends(get_db)):
    notes = (
        db.query(DBDocumentNote)
        .filter_by(document_id=doc_id)
        .order_by(DBDocumentNote.sort_order, DBDocumentNote.id)
        .all()
    )
    return [_doc_note_dict(n) for n in notes]


@app.post("/api/documents/{doc_id}/notes", status_code=201)
def create_doc_note(doc_id: int, body: NoteCreate, db: Session = Depends(get_db)):
    d = db.get(DBDocument, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    now = datetime.utcnow().isoformat()
    n = DBDocumentNote(
        document_id=doc_id,
        title=body.title,
        content=body.content or "",
        sort_order=body.sort_order or 0,
        created_at=now,
        updated_at=now,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return _doc_note_dict(n)


@app.patch("/api/document-notes/{note_id}")
def update_doc_note(note_id: int, body: NoteUpdate, db: Session = Depends(get_db)):
    n = db.get(DBDocumentNote, note_id)
    if not n:
        raise HTTPException(404, "Note not found")
    if body.title is not None:
        n.title = body.title
    if body.content is not None:
        n.content = body.content
    n.updated_at = datetime.utcnow().isoformat()
    db.commit()
    db.refresh(n)
    return _doc_note_dict(n)


@app.delete("/api/document-notes/{note_id}")
def delete_doc_note(note_id: int, db: Session = Depends(get_db)):
    n = db.get(DBDocumentNote, note_id)
    if not n:
        raise HTTPException(404, "Note not found")
    db.delete(n)
    db.commit()
    return {"ok": True}


@app.post("/api/document-notes/{note_id}/citations", status_code=201)
def add_doc_note_citation(note_id: int, body: NoteCitationCreate, db: Session = Depends(get_db)):
    n = db.get(DBDocumentNote, note_id)
    if not n:
        raise HTTPException(404, "Note not found")
    if body.source_id is None and not body.custom_label:
        raise HTTPException(400, "Either source_id or custom_label is required")
    nc = DBDocumentNoteCitation(
        note_id=note_id,
        source_id=body.source_id,
        marker=body.marker,
        detail=body.detail,
        custom_label=body.custom_label,
    )
    db.add(nc)
    db.commit()
    db.refresh(nc)
    return _doc_note_citation_dict(nc)


@app.delete("/api/document-note-citations/{nc_id}")
def delete_doc_note_citation(nc_id: int, db: Session = Depends(get_db)):
    nc = db.get(DBDocumentNoteCitation, nc_id)
    if not nc:
        raise HTTPException(404, "Citation not found")
    db.delete(nc)
    db.commit()
    return {"ok": True}


# ── Face thumbnails ────────────────────────────────────────────────────────────

@app.get("/api/faces/{face_id}/thumbnail")
def face_thumbnail(face_id: int, size: int = 160, db: Session = Depends(get_db)):
    face = db.get(DBFace, face_id)
    if not face:
        raise HTTPException(404, "Face not found")
    p = Path(face.image.path)
    if not p.exists():
        raise HTTPException(404, "Source image no longer on disk")
    img = load_image_bgr(p)
    if img is None:
        raise HTTPException(404, "Cannot load source image")
    thumb = crop_thumbnail(img, np.array(json.loads(face.bbox_json)), size)
    _, buf = cv2.imencode(".jpg", thumb)
    return Response(content=bytes(buf), media_type="image/jpeg")


# ── Events ────────────────────────────────────────────────────────────────────

def _event_person_dict(ep: DBEventPerson) -> dict:
    p = ep.person
    return {
        "id": ep.id,
        "person_id": ep.person_id,
        "role": ep.role,
        "featured": bool(ep.featured),
        "person_name": p.name if p else None,
        "thumbnail_face_id": p.thumbnail_face_id if p else None,
    }


def _event_image_dict(ei: DBEventImage) -> dict:
    img = ei.image
    return {
        "id": ei.id,
        "image_id": ei.image_id,
        "image_path": img.path if img else None,
        "first_face_id": img.faces[0].id if img and img.faces else None,
    }


def _event_dict(ev: DBEvent) -> dict:
    return {
        "id": ev.id,
        "event_type": ev.event_type,
        "title": ev.title,
        "date": ev.date,
        "year": ev.year,
        "place": ev.place,
        "description": ev.description,
        "created_at": ev.created_at,
        "updated_at": ev.updated_at,
        "is_private": bool(ev.is_private),
        "persons": [_event_person_dict(ep) for ep in ev.event_persons],
        "images": [_event_image_dict(ei) for ei in ev.event_images],
    }


@app.get("/api/persons/{person_id}/events")
def list_person_events(person_id: int, db: Session = Depends(get_db)):
    eps = db.query(DBEventPerson).filter(DBEventPerson.person_id == person_id).all()
    event_ids = [ep.event_id for ep in eps]
    if not event_ids:
        return []
    events = db.query(DBEvent).filter(DBEvent.id.in_(event_ids)).all()
    return [_event_dict(ev) for ev in events]


@app.post("/api/events")
def create_event(body: EventCreate, db: Session = Depends(get_db)):
    now = datetime.utcnow().isoformat()
    year = body.year
    if not year and body.date:
        try:
            year = int(body.date.split("-")[0])
        except Exception:
            pass
    ev = DBEvent(
        event_type=body.event_type,
        title=body.title,
        date=body.date,
        year=year,
        place=body.place,
        description=body.description,
        created_at=now,
        updated_at=now,
    )
    db.add(ev)
    db.flush()
    seen: set[int] = set()
    if body.person_id is not None:
        db.add(DBEventPerson(event_id=ev.id, person_id=body.person_id, role="primary"))
        seen.add(body.person_id)
    for pid in body.extra_person_ids:
        if pid not in seen:
            db.add(DBEventPerson(event_id=ev.id, person_id=pid, role="participant"))
            seen.add(pid)
    db.commit()
    db.refresh(ev)
    return _event_dict(ev)


@app.patch("/api/events/{event_id}")
def update_event(event_id: int, body: EventUpdate, db: Session = Depends(get_db)):
    ev = db.get(DBEvent, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(ev, field, val)
    # Keep year in sync with date
    if body.date is not None and body.year is None:
        try:
            ev.year = int(body.date.split("-")[0])
        except Exception:
            pass
    ev.updated_at = datetime.utcnow().isoformat()
    db.commit()
    db.refresh(ev)
    return _event_dict(ev)


@app.delete("/api/events/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    ev = db.get(DBEvent, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    db.delete(ev)
    db.commit()
    return {"ok": True}


@app.get("/api/events/{event_id}/images/zip")
def export_event_images_zip(event_id: int, db: Session = Depends(get_db)):
    """Download all images attached to an event as a ZIP archive."""
    ev = db.get(DBEvent, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.event_images:
        raise HTTPException(404, "Event has no images")

    buf = io.BytesIO()
    with __import__("zipfile").ZipFile(buf, "w", __import__("zipfile").ZIP_DEFLATED, allowZip64=True) as zf:
        for ei in ev.event_images:
            img = ei.image
            if not img:
                continue
            p = Path(img.path)
            if p.exists():
                zf.write(str(p), f"{img.id}_{p.name}")
    buf.seek(0)

    safe_title = re.sub(r'[^\w\s-]', '', ev.title or 'event').strip().replace(' ', '_') or 'event'
    filename = f"event_{event_id}_{safe_title}.zip"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )


@app.post("/api/events/{event_id}/images")
def add_event_image(event_id: int, body: EventImageAdd, db: Session = Depends(get_db)):
    ev = db.get(DBEvent, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    existing = db.query(DBEventImage).filter_by(event_id=event_id, image_id=body.image_id).first()
    if existing:
        return _event_dict(ev)
    db.add(DBEventImage(event_id=event_id, image_id=body.image_id))
    db.commit()
    db.refresh(ev)
    return _event_dict(ev)


@app.delete("/api/event-images/{ei_id}")
def remove_event_image(ei_id: int, db: Session = Depends(get_db)):
    ei = db.get(DBEventImage, ei_id)
    if not ei:
        raise HTTPException(404, "Not found")
    event_id = ei.event_id
    db.delete(ei)
    db.commit()
    ev = db.get(DBEvent, event_id)
    return _event_dict(ev) if ev else {"ok": True}


@app.post("/api/events/{event_id}/persons")
def add_event_person(event_id: int, body: EventPersonAdd, db: Session = Depends(get_db)):
    ev = db.get(DBEvent, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    existing = db.query(DBEventPerson).filter_by(event_id=event_id, person_id=body.person_id).first()
    if existing:
        return _event_dict(ev)
    db.add(DBEventPerson(event_id=event_id, person_id=body.person_id, role=body.role))
    db.commit()
    db.refresh(ev)
    return _event_dict(ev)


@app.patch("/api/event-persons/{ep_id}")
def patch_event_person(ep_id: int, body: dict, db: Session = Depends(get_db)):
    ep = db.get(DBEventPerson, ep_id)
    if not ep:
        raise HTTPException(404, "Not found")
    if "featured" in body:
        ep.featured = bool(body["featured"])
    db.commit()
    db.refresh(ep.event)
    return _event_dict(ep.event)


@app.delete("/api/event-persons/{ep_id}")
def remove_event_person(ep_id: int, db: Session = Depends(get_db)):
    ep = db.get(DBEventPerson, ep_id)
    if not ep:
        raise HTTPException(404, "Not found")
    event_id = ep.event_id
    db.delete(ep)
    db.commit()
    ev = db.get(DBEvent, event_id)
    return _event_dict(ev) if ev else {"ok": True}


@app.get("/api/images/{image_id}/events")
def list_image_events(image_id: int, db: Session = Depends(get_db)):
    eis = db.query(DBEventImage).filter(DBEventImage.image_id == image_id).all()
    event_ids = [ei.event_id for ei in eis]
    if not event_ids:
        return []
    events = db.query(DBEvent).filter(DBEvent.id.in_(event_ids)).all()
    return [_event_dict(ev) for ev in events]


# ── Auto-update ───────────────────────────────────────────────────────────────

from . import updater as _updater  # noqa: E402


@app.get('/api/update/status')
def update_status():
    return _updater.get_state()


@app.post('/api/update/check')
def update_check():
    _updater.trigger_check()
    return {'ok': True}


@app.post('/api/update/download')
def update_download():
    state = _updater.get_state()
    if state['status'] not in ('update_available',):
        raise HTTPException(400, 'Nincs elérhető frissítés letöltéshez.')
    _updater.start_download()
    return {'ok': True}


@app.post('/api/update/apply')
def update_apply():
    state = _updater.get_state()
    if state['status'] != 'ready':
        raise HTTPException(400, 'A frissítés még nincs letöltve.')
    try:
        _updater.apply_update()   # writes script + schedules os._exit(0)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    return {'ok': True}


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

    _dist_resolved = _dist.resolve()

    @app.get('/{full_path:path}', include_in_schema=False)
    async def _spa_fallback(full_path: str):
        candidate = (_dist / full_path).resolve()
        if candidate.is_relative_to(_dist_resolved) and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(_dist / 'index.html'))

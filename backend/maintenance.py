"""
Quiet gallery maintenance.

Photos referenced by the DB can vanish from disk outside the app — moved,
deleted in the OS, on a drive that was unmounted. Without this, the user has
to notice the broken thumbnail and delete the entry here too. `scanner.py`
already prunes this during a full scan, but only for files under the root
being scanned; this module does the same check across every image in the
project, so it can run automatically whenever a project is opened without
requiring the user to point a scan at anything.

Runs once per project activation, in a background thread, so opening a
project is never blocked by it. All public functions are thread-safe.
"""

from __future__ import annotations

import threading
from pathlib import Path

from sqlalchemy import text

_state: dict = {
    "running": False,
    "removed_images": 0,
    "removed_faces": 0,
}
_lock = threading.Lock()


def get_status() -> dict:
    with _lock:
        return dict(_state)


def _run(session_factory) -> None:
    from .database import Image as DBImage, Face as DBFace

    removed_images = 0
    removed_faces = 0
    db = session_factory()
    try:
        stale_ids = [img.id for img in db.query(DBImage).all() if not Path(img.path).exists()]
        if stale_ids:
            removed_faces = db.query(DBFace).filter(DBFace.image_id.in_(stale_ids)) \
                .delete(synchronize_session=False)
            removed_images = len(stale_ids)
            db.query(DBImage).filter(DBImage.id.in_(stale_ids)).delete(synchronize_session=False)
            db.commit()

            # Named clusters (label >= 0) left with no faces at all — mirrors
            # main.py's _purge_empty_named_clusters. Linked persons are kept.
            db.execute(text("""
                DELETE FROM clusters
                WHERE label >= 0
                  AND id NOT IN (
                      SELECT DISTINCT cluster_id FROM faces WHERE cluster_id IS NOT NULL
                  )
            """))
            db.commit()
    finally:
        db.close()
        with _lock:
            _state["running"] = False
            _state["removed_images"] = removed_images
            _state["removed_faces"] = removed_faces


def start(session_factory) -> bool:
    """Kick off a prune pass for the active project. No-op if one is already
    running. Sub-cluster centroids for any affected person are left alone —
    they refresh at the next clustering run, same as every other place that
    removes faces (deleting an image, batch-deleting faces, ...)."""
    from . import scanner as scanner_mod

    with _lock:
        if _state["running"]:
            return False
        _state["running"] = True

    if scanner_mod.get_status()["running"]:
        with _lock:
            _state["running"] = False
        return False

    threading.Thread(target=_run, args=(session_factory,), daemon=True, name="gallery-maintenance").start()
    return True

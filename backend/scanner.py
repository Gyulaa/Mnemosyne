import json
import threading
from datetime import datetime
from pathlib import Path

import numpy as np

from .image_utils import load_image_bgr, IMAGE_EXTENSIONS

_face_app = None
_face_app_lock = threading.Lock()


class _State:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.stop_requested = False
        self.processed = 0
        self.total = 0
        self.errors = 0
        self.current_path: str | None = None


_state = _State()
_thread: threading.Thread | None = None


def _get_face_app(det_size: int = 640):
    global _face_app
    with _face_app_lock:
        if _face_app is None:
            from insightface.app import FaceAnalysis
            app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=0, det_size=(det_size, det_size))
            _face_app = app
    return _face_app


def _extract_exif_date(path: Path) -> datetime | None:
    try:
        from PIL import Image
        pil = Image.open(path)
        exif = pil._getexif()
        if exif:
            date_str = exif.get(36867) or exif.get(36868)  # DateTimeOriginal / DateTimeDigitized
            if date_str:
                return datetime.strptime(str(date_str), "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass
    return None


def _extract_meta_json(path: Path) -> str | None:
    """Return a JSON string with width, height, make, model from EXIF."""
    import json as _json
    try:
        from PIL import Image
        pil = Image.open(path)
        w, h = pil.size
        meta: dict = {"width": w, "height": h}
        try:
            exif = pil._getexif()
            if exif:
                if exif.get(271): meta["make"]  = str(exif[271]).strip()
                if exif.get(272): meta["model"] = str(exif[272]).strip()
        except Exception:
            pass
        return _json.dumps(meta)
    except Exception:
        return None


def _run(root_path: str, session_factory, det_size: int):
    from .database import Image as DBImage, Face as DBFace

    db = session_factory()
    try:
        root = Path(root_path)

        # Phase 1: walk directory, register new/changed images as pending
        all_paths = sorted(
            p for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        )
        for p in all_paths:
            mtime = p.stat().st_mtime
            existing = db.query(DBImage).filter(DBImage.path == str(p)).first()
            if existing is None:
                db.add(DBImage(path=str(p), mtime=mtime, scan_status="pending"))
            elif existing.mtime != mtime:
                db.query(DBFace).filter(DBFace.image_id == existing.id).delete()
                existing.mtime = mtime
                existing.scan_status = "pending"
                existing.scanned_at = None
                existing.error_msg = None
        db.commit()

        # Phase 2: process pending images one by one
        pending_ids = [
            row[0] for row in
            db.query(DBImage.id).filter(DBImage.scan_status == "pending").all()
        ]
        with _state.lock:
            _state.total = len(pending_ids)
            _state.processed = 0
            _state.errors = 0

        app = _get_face_app(det_size)

        for img_id in pending_ids:
            if _state.stop_requested:
                break

            img_rec = db.get(DBImage, img_id)
            if img_rec is None:
                continue

            try:
                bgr = load_image_bgr(Path(img_rec.path))
                if bgr is None or bgr.shape[0] < 32 or bgr.shape[1] < 32:
                    img_rec.scan_status = "error"
                    img_rec.error_msg = "Cannot load or image too small"
                    db.commit()
                    with _state.lock:
                        _state.processed += 1
                        _state.errors += 1
                    continue

                faces = app.get(bgr)

                img_rec.scanned_at = datetime.utcnow()
                img_rec.exif_date  = _extract_exif_date(Path(img_rec.path))
                img_rec.meta_json  = _extract_meta_json(Path(img_rec.path))
                if not faces:
                    img_rec.scan_status = "no_face"
                else:
                    img_rec.scan_status = "done"
                    for face in faces:
                        if face.embedding is None:
                            continue
                        db.add(DBFace(
                            image_id=img_id,
                            bbox_json=json.dumps(face.bbox.tolist()),
                            embedding=face.embedding.astype(np.float32).tobytes(),
                            det_score=float(face.det_score),
                        ))

                db.commit()

            except Exception as e:
                try:
                    db.rollback()
                    img_rec = db.get(DBImage, img_id)
                    if img_rec:
                        img_rec.scan_status = "error"
                        img_rec.error_msg = str(e)[:500]
                        db.commit()
                except Exception:
                    db.rollback()
                with _state.lock:
                    _state.errors += 1

            with _state.lock:
                _state.processed += 1

    finally:
        db.close()
        with _state.lock:
            _state.running = False
            _state.stop_requested = False


def start_scan(root_path: str, session_factory, det_size: int = 640) -> tuple[bool, str]:
    global _thread
    with _state.lock:
        if _state.running:
            return False, "Scanner is already running"
        _state.running = True
        _state.stop_requested = False
        _state.current_path = root_path

    _thread = threading.Thread(
        target=_run,
        args=(root_path, session_factory, det_size),
        daemon=True,
        name="face-scanner",
    )
    _thread.start()
    return True, "Started"


def stop_scan() -> tuple[bool, str]:
    with _state.lock:
        if not _state.running:
            return False, "Scanner is not running"
        _state.stop_requested = True
    return True, "Stop requested"


def get_status() -> dict:
    with _state.lock:
        return {
            "running": _state.running,
            "processed": _state.processed,
            "total": _state.total,
            "errors": _state.errors,
            "current_path": _state.current_path,
        }

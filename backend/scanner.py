import hashlib
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path

import numpy as np

from .image_utils import load_image_bgr, IMAGE_EXTENSIONS

DHASH_NEAR_DUP_THRESHOLD = 5  # Hamming distance ≤ 5 → near-duplicate


def _sha256_file(path: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def _compute_dhash(pil_image, size: int = 8) -> int:
    """64-bit difference hash stored as signed int64 (SQLite compatible)."""
    from PIL import Image
    gray = pil_image.convert('L').resize((size + 1, size), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    val = 0
    for row in range(size):
        for col in range(size):
            if pixels[row * (size + 1) + col] < pixels[row * (size + 1) + col + 1]:
                val |= 1 << (row * size + col)
    # Convert unsigned 64-bit to signed so SQLite INTEGER doesn't overflow
    return val if val < (1 << 63) else val - (1 << 64)


def _hamming(a: int, b: int) -> int:
    # Mask to 64 bits before XOR — handles signed values read back from SQLite
    return bin((a & 0xFFFFFFFFFFFFFFFF) ^ (b & 0xFFFFFFFFFFFFFFFF)).count('1')

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
        self.dupes_skipped = 0
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


def _run(root_path: str, session_factory, det_size: int, skip_duplicates: bool = False):
    from .database import Image as DBImage, Face as DBFace

    db = session_factory()
    try:
        root = Path(root_path)

        # Phase 1: walk directory, register new/changed images as pending
        all_paths = sorted(
            p for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        )
        all_path_strs = {str(p) for p in all_paths}

        # Build a map of content_hash → id for already-completed images (exact dup detection)
        done_hashes: dict[str, int] = {
            row.content_hash: row.id
            for row in db.query(DBImage).filter(
                DBImage.content_hash.isnot(None),
                DBImage.scan_status.in_(["done", "no_face"]),
            ).all()
            if row.content_hash
        }

        for p in all_paths:
            mtime = p.stat().st_mtime
            existing = db.query(DBImage).filter(DBImage.path == str(p)).first()
            if existing is None:
                chash = _sha256_file(p)
                orig_id = done_hashes.get(chash) if chash else None
                if orig_id and skip_duplicates:
                    with _state.lock:
                        _state.dupes_skipped += 1
                    continue  # don't even record it
                db.add(DBImage(
                    path=str(p), mtime=mtime,
                    scan_status="exact_duplicate" if orig_id else "pending",
                    stable_id=str(uuid.uuid4()),
                    content_hash=chash,
                    source_path=str(p),
                    duplicate_of=orig_id,
                ))
                if orig_id:
                    with _state.lock:
                        _state.dupes_skipped += 1
            elif existing.mtime != mtime:
                db.query(DBFace).filter(DBFace.image_id == existing.id).delete()
                existing.mtime = mtime
                existing.scan_status = "pending"
                existing.scanned_at = None
                existing.error_msg = None
                existing.phash = None
                existing.duplicate_of = None
                existing.content_hash = _sha256_file(p)
            elif existing.stable_id is None:
                existing.stable_id = str(uuid.uuid4())
                existing.content_hash = _sha256_file(p)
                existing.source_path = existing.source_path or str(p)

        # Remove DB records for images under this root that no longer exist on disk
        root_prefix = str(root)
        stale = [
            img for img in db.query(DBImage).all()
            if img.path.startswith(root_prefix) and img.path not in all_path_strs
        ]
        for img in stale:
            db.query(DBFace).filter(DBFace.image_id == img.id).delete()
            db.delete(img)

        if stale:
            db.commit()
            from sqlalchemy import text as _text
            db.execute(_text("""
                DELETE FROM clusters
                WHERE label >= 0
                  AND id NOT IN (
                      SELECT DISTINCT cluster_id FROM faces WHERE cluster_id IS NOT NULL
                  )
            """))

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

        # Load existing phashes from DB for near-duplicate detection
        known_phashes: dict[int, int] = {
            row.phash: row.id
            for row in db.query(DBImage).filter(
                DBImage.phash.isnot(None),
                DBImage.scan_status.in_(["done", "no_face"]),
            ).all()
            if row.phash is not None
        }

        for img_id in pending_ids:
            if _state.stop_requested:
                break

            img_rec = db.get(DBImage, img_id)
            if img_rec is None:
                continue

            with _state.lock:
                _state.current_path = img_rec.path

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

                # Compute perceptual hash for near-duplicate detection
                try:
                    from PIL import Image as PILImage
                    pil = PILImage.fromarray(bgr[..., ::-1])  # BGR → RGB
                    phash_val = _compute_dhash(pil)
                except Exception:
                    phash_val = None

                # Check for near-duplicate
                near_dup_id: int | None = None
                if phash_val is not None:
                    for existing_phash, existing_id in known_phashes.items():
                        if _hamming(phash_val, existing_phash) <= DHASH_NEAR_DUP_THRESHOLD:
                            near_dup_id = existing_id
                            break

                img_rec.phash = phash_val

                if near_dup_id is not None:
                    img_rec.scan_status = "near_duplicate"
                    img_rec.duplicate_of = near_dup_id
                    img_rec.scanned_at = datetime.utcnow()
                    img_rec.exif_date = _extract_exif_date(Path(img_rec.path))
                    img_rec.meta_json = _extract_meta_json(Path(img_rec.path))
                    db.commit()
                    with _state.lock:
                        _state.dupes_skipped += 1
                        _state.processed += 1
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

                # Add to known phashes so subsequent images can match against it
                if phash_val is not None:
                    known_phashes[phash_val] = img_id

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


def start_scan(root_path: str, session_factory, det_size: int = 640, skip_duplicates: bool = False) -> tuple[bool, str]:
    global _thread
    with _state.lock:
        if _state.running:
            return False, "Scanner is already running"
        _state.running = True
        _state.stop_requested = False
        _state.dupes_skipped = 0
        _state.current_path = root_path

    _thread = threading.Thread(
        target=_run,
        args=(root_path, session_factory, det_size, skip_duplicates),
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
            "dupes_skipped": _state.dupes_skipped,
            "current_path": _state.current_path,
        }

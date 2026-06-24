from pathlib import Path
import cv2
import numpy as np
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIC_OK = True
except ImportError:
    HEIC_OK = False

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
if HEIC_OK:
    IMAGE_EXTENSIONS |= {".heic", ".heif"}

THUMB_PADDING = 0.20


def load_image_bgr(path: Path) -> np.ndarray | None:
    suffix = path.suffix.lower()
    if suffix in {".heic", ".heif"} and HEIC_OK:
        try:
            img = Image.open(path).convert("RGB")
            return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        except Exception:
            return None
    # cv2.imread fails silently on Windows with non-ASCII paths; use imdecode instead
    try:
        buf = np.fromfile(str(path), dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is not None:
            return img
    except Exception:
        pass
    try:
        pil = Image.open(path).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def crop_thumbnail(img_bgr: np.ndarray, bbox: np.ndarray, size: int = 160) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    x1, y1, x2, y2 = bbox.astype(int)
    fw, fh = x2 - x1, y2 - y1
    pad_x = int(fw * THUMB_PADDING)
    pad_y = int(fh * THUMB_PADDING)
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)
    crop = img_bgr[y1:y2, x1:x2]
    if crop.size == 0:
        return np.zeros((size, size, 3), dtype=np.uint8)
    return cv2.resize(crop, (size, size))

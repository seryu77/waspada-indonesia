"""Privasi: tidak ada face recognition. Wajah dan plat nomor diblur sebelum gambar disimpan atau
dikirim ke LLM.

Urutan detektor:
1. Wajah: OpenCV FaceDetectorYN (YuNet) bila file model ada di weights/face_detection_yunet.onnx.
2. Plat: area bawah kotak kendaraan dari YOLO (kalau pipeline vision aktif dan kotak diberikan).
3. Tanpa detektor: gambar diperkecil (lebar maks 640 px) lalu diblur ringan seluruhnya, cukup untuk
   membuat wajah dan plat tidak terbaca tetapi kejadian (api, asap, genangan) tetap terlihat.
"""

import logging
from pathlib import Path

log = logging.getLogger("waspada.privacy")

try:
    import cv2
    import numpy as np

    HAS_CV = True
except ImportError:  # pragma: no cover
    HAS_CV = False

YUNET = Path(__file__).resolve().parents[2] / "weights" / "face_detection_yunet.onnx"
MAX_W = 640
_face = None


def available() -> bool:
    return HAS_CV


def _face_detector(w: int, h: int):
    global _face
    if not YUNET.exists():
        return None
    if _face is None:
        _face = cv2.FaceDetectorYN.create(str(YUNET), "", (w, h), 0.6)
    _face.setInputSize((w, h))
    return _face


def _blur_box(img, x1: int, y1: int, x2: int, y2: int) -> None:
    h, w = img.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 - x1 < 4 or y2 - y1 < 4:
        return
    roi = img[y1:y2, x1:x2]
    k = max(15, ((x2 - x1) // 3) | 1)
    img[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (k, k), 0)


def anonymize(img, vehicle_boxes: list[tuple[int, int, int, int]] | None = None):
    """Blur wajah dan perkiraan area plat. img: ndarray BGR. Kembalikan ndarray baru."""
    h, w = img.shape[:2]
    if w > MAX_W:
        img = cv2.resize(img, (MAX_W, int(h * MAX_W / w)), interpolation=cv2.INTER_AREA)
        scale = MAX_W / w
        vehicle_boxes = [tuple(int(v * scale) for v in b) for b in (vehicle_boxes or [])]  # type: ignore[misc]
        h, w = img.shape[:2]
    out = img.copy()
    detected_any = False

    det = _face_detector(w, h)
    if det is not None:
        _, faces = det.detect(out)
        if faces is not None:
            for f in faces:
                x, y, fw, fh = (int(v) for v in f[:4])
                pad = int(0.25 * max(fw, fh))
                _blur_box(out, x - pad, y - pad, x + fw + pad, y + fh + pad)
        detected_any = True

    for x1, y1, x2, y2 in vehicle_boxes or []:
        # Plat biasanya di sepertiga bawah kendaraan
        _blur_box(out, x1, y1 + int((y2 - y1) * 0.6), x2, y2)
        detected_any = True

    if not detected_any:
        out = cv2.GaussianBlur(out, (7, 7), 0)
    return out


def anonymize_jpeg(data: bytes) -> bytes | None:
    """Untuk foto laporan warga. None kalau gambar tidak bisa dibaca atau OpenCV tidak ada."""
    if not HAS_CV:
        return None
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    ok, buf = cv2.imencode(".jpg", anonymize(img), [cv2.IMWRITE_JPEG_QUALITY, 82])
    return buf.tobytes() if ok else None

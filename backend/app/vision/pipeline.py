"""Pipeline CCTV + computer vision (aktif jika ENABLE_VISION=true).

- Ambil 1 frame tiap VISION_SAMPLE_S detik per kamera (bukan setiap frame) dengan OpenCV.
- YOLO mendeteksi kandidat: api/asap (weights khusus fire/smoke, misal hasil training D-Fire),
  kendaraan bertabrakan (kotak kendaraan saling tumpang tindih), kerumunan (jumlah orang),
  dan kelas kustom lain (flood, fight) bila weights-nya punya.
- Aturan sebelum LLM: deteksi harus muncul di CONSISTENT_FRAMES frame berturut-turut dengan
  confidence rata-rata di atas threshold, plus cooldown per kamera.
- Frame bukti diblur (wajah, plat) sebelum disimpan dan dikirim ke LLM.

Catatan: izin akses CCTV pemda/ATCS/Jasa Marga wajib dicek sebelum menyambungkan stream nyata.
"""

import asyncio
import logging
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path

from ..config import BASE_DIR, settings
from ..hub import hub
from ..models import Camera, Incident, Source, now_iso

log = logging.getLogger("waspada.vision")

CONSISTENT_FRAMES = 3
CONF_MIN = 0.5
CROWD_MIN = 15
COOLDOWN_S = 600
VEHICLES = {"car", "motorcycle", "bus", "truck"}
# Nama kelas dari weights kustom -> jenis bahaya
CUSTOM_MAP = {"fire": "fire", "smoke": "fire", "flood": "flood", "water": "flood", "accident": "accident", "crash": "accident", "fight": "crime", "violence": "crime"}
TITLES = {"fire": "Api/asap terdeteksi CCTV", "flood": "Genangan terdeteksi CCTV", "accident": "Dugaan tabrakan kendaraan", "crime": "Kerumunan/perkelahian terdeteksi"}


@dataclass
class FrameResult:
    hazards: dict[str, float]  # jenis -> confidence tertinggi
    vehicle_boxes: list[tuple[int, int, int, int]]
    frame: object  # ndarray BGR


def _iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / area if area else 0.0


class VisionPipeline:
    def __init__(self) -> None:
        from ultralytics import YOLO  # import berat, hanya saat vision aktif

        fire = Path(settings.fire_weights)
        fire = fire if fire.is_absolute() else BASE_DIR / fire
        self.custom = YOLO(str(fire)) if fire.exists() else None
        if not self.custom:
            log.warning("Weights fire/smoke tidak ditemukan di %s; deteksi api/asap nonaktif", fire)
        self.general = YOLO(settings.general_weights)
        self.history: dict[tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=CONSISTENT_FRAMES))
        self.frames: dict[str, deque] = defaultdict(lambda: deque(maxlen=4))
        self.last_fire: dict[tuple[str, str], float] = {}
        self.caps: dict[str, object] = {}

    # ---- ambil frame ----
    def _grab(self, cam: Camera):
        import cv2
        import numpy as np
        import httpx

        if cam.stream_type == "snapshot":
            r = httpx.get(cam.stream_url, timeout=10)
            r.raise_for_status()
            return cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
        cap = self.caps.get(cam.id)
        if cap is None or not cap.isOpened():
            cap = cv2.VideoCapture(cam.stream_url)
            self.caps[cam.id] = cap
        for _ in range(4):  # buang frame lama di buffer, ambil yang terbaru
            cap.grab()
        ok, frame = cap.read()
        return frame if ok else None

    # ---- deteksi ----
    def _detect(self, frame) -> FrameResult:
        hazards: dict[str, float] = {}
        if self.custom:
            for r in self.custom(frame, verbose=False, conf=CONF_MIN):
                for c, conf in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                    h = CUSTOM_MAP.get(r.names[int(c)].lower())
                    if h:
                        hazards[h] = max(hazards.get(h, 0), conf)
        vehicles, persons = [], []
        for r in self.general(frame, verbose=False, conf=CONF_MIN):
            for box, c, conf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                name = r.names[int(c)]
                if name in VEHICLES:
                    vehicles.append((tuple(int(v) for v in box), conf))
                elif name == "person":
                    persons.append(conf)
        # Kendaraan bertabrakan: dua kotak saling tumpang tindih cukup besar
        for i in range(len(vehicles)):
            for j in range(i + 1, len(vehicles)):
                if _iou(vehicles[i][0], vehicles[j][0]) > 0.2:
                    hazards["accident"] = max(hazards.get("accident", 0), min(vehicles[i][1], vehicles[j][1]))
        if len(persons) >= CROWD_MIN:
            hazards["crime"] = max(hazards.get("crime", 0), sum(persons) / len(persons))
        return FrameResult(hazards=hazards, vehicle_boxes=[v[0] for v in vehicles], frame=frame)

    # ---- loop per kamera ----
    async def run_camera(self, cam_id: str) -> None:
        import cv2

        from ..pipeline import process_candidate
        from .privacy import anonymize

        while True:
            cam = hub.cameras.get(cam_id)
            if not cam:
                return
            try:
                frame = await asyncio.to_thread(self._grab, cam)
            except Exception as e:
                log.debug("kamera %s gagal: %s", cam_id, e)
                frame = None
            status = "online" if frame is not None else "offline"
            if status != cam.status or frame is not None:
                cam.status = status  # type: ignore[assignment]
                if frame is not None:
                    cam.last_frame_at = now_iso()
                await hub.update_camera(cam)
            if frame is None:
                await asyncio.sleep(max(30, settings.vision_sample_s))
                continue

            res = await asyncio.to_thread(self._detect, frame)
            self.frames[cam_id].append(anonymize(res.frame, res.vehicle_boxes))
            for hz in TITLES:
                hist = self.history[(cam_id, hz)]
                hist.append(res.hazards.get(hz, 0.0))
                consistent = len(hist) == CONSISTENT_FRAMES and all(c >= CONF_MIN for c in hist)
                cooled = time.time() - self.last_fire.get((cam_id, hz), 0) > COOLDOWN_S
                if consistent and cooled:
                    self.last_fire[(cam_id, hz)] = time.time()
                    jpgs, urls = [], []
                    for f in list(self.frames[cam_id])[-4:]:
                        ok, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        if ok:
                            name = f"{cam_id}-{uuid.uuid4().hex[:8]}.jpg"
                            (settings.frames_dir / name).write_bytes(buf.tobytes())
                            jpgs.append(buf.tobytes())
                            urls.append(f"/api/frames/{name}")
                    avg = sum(hist) / len(hist)
                    inc = Incident(
                        id=f"cv-{cam_id}-{uuid.uuid4().hex[:6]}",
                        type=hz,  # type: ignore[arg-type]
                        title=TITLES[hz],
                        description=f"Terdeteksi konsisten di {CONSISTENT_FRAMES} frame berturut-turut (confidence rata-rata {avg:.2f}).",
                        lat=cam.lat,
                        lng=cam.lng,
                        address=f"CCTV {cam.name}, {cam.city}",
                        severity="high" if avg >= 0.7 else "medium",
                        source=Source(id="cctv", label=f"CCTV {cam.name} + YOLO", kind="cctv"),
                        camera_id=cam.id,
                        evidence=urls,
                    )
                    cam.detections_today += 1
                    await hub.update_camera(cam)
                    asyncio.create_task(process_candidate(inc, jpgs))
                    hist.clear()
            await asyncio.sleep(settings.vision_sample_s)


async def start_vision() -> list[asyncio.Task]:
    try:
        vp = VisionPipeline()
    except ImportError:
        log.error("ENABLE_VISION=true tapi ultralytics belum terpasang. Jalankan: pip install -r requirements-vision.txt")
        return []
    settings.frames_dir.mkdir(parents=True, exist_ok=True)
    log.info("Pipeline vision aktif untuk %d kamera", len(hub.cameras))
    return [asyncio.create_task(vp.run_camera(cid)) for cid in list(hub.cameras)]

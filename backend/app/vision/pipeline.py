"""Pipeline CCTV + computer vision (aktif jika ENABLE_VISION=true).

Sumber: kamera ATCS publik hasil scripts/sync_cctv.py (HLS) plus kamera yang ditambahkan manual.

- Hemat untuk server pemda: tiap kamera hanya diambil 1 frame per giliran, koneksi langsung
  ditutup (bukan streaming terus). Kamera dikunjungi bergiliran oleh VISION_CONCURRENCY worker,
  dengan jeda minimal VISION_SAMPLE_S detik per kamera.
- Tiga lapis model:
  1. YOLO umum (COCO): kendaraan saling tumpang tindih = dugaan tabrakan, banyak orang = kerumunan.
  2. YOLO-World (open vocabulary, prompt teks): api, asap, banjir/genangan, kendaraan terguling.
     Tidak perlu training sendiri.
  3. Weights kustom opsional (misal fire/smoke hasil training D-Fire) kalau file-nya ada.
- Aturan sebelum LLM: deteksi harus muncul di CONSISTENT_FRAMES frame berturut-turut dengan
  confidence di atas threshold, plus cooldown per kamera. Lalu diverifikasi LLM dua tahap.
- Frame bukti diblur (wajah, plat) sebelum disimpan dan dikirim ke LLM.

Catatan: untuk produksi, ajukan izin tertulis ke Dishub/Diskominfo pemilik kamera.
"""

import asyncio
import itertools
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
# Prompt YOLO-World -> jenis bahaya. Kalimat pendek dalam bahasa Inggris paling akurat.
WORLD_PROMPTS = {
    "fire": "fire",
    "flames": "fire",
    "smoke": "fire",
    "flood water": "flood",
    "flooded street": "flood",
    "overturned car": "accident",
    "crashed car": "accident",
}
WORLD_CONF = 0.3
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
        self.world = None
        if settings.world_weights:
            try:
                from ultralytics import YOLOWorld

                self.world = YOLOWorld(settings.world_weights)
                self.world.set_classes(list(WORLD_PROMPTS))
            except Exception as e:  # weights gagal diunduh, atau paket clip belum ada
                log.warning("YOLO-World nonaktif (%s); deteksi banjir/api lewat prompt teks mati", e)
        self.history: dict[tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=CONSISTENT_FRAMES))
        self.frames: dict[str, deque] = defaultdict(lambda: deque(maxlen=4))
        self.last_fire: dict[tuple[str, str], float] = {}
        self.caps: dict[str, object] = {}

    # ---- ambil frame ----
    def _grab(self, cam: Camera):
        import cv2
        import numpy as np
        import httpx

        url = cam.vision_url or cam.stream_url
        if cam.stream_type == "snapshot":
            r = httpx.get(url, timeout=10)
            r.raise_for_status()
            return cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
        if cam.stream_type == "rtsp":
            # Kamera sendiri: koneksi dibiarkan terbuka supaya tidak reconnect tiap frame
            cap = self.caps.get(cam.id)
            if cap is None or not cap.isOpened():
                cap = cv2.VideoCapture(url)
                self.caps[cam.id] = cap
            for _ in range(4):  # buang frame lama di buffer, ambil yang terbaru
                cap.grab()
            ok, frame = cap.read()
            return frame if ok else None
        # HLS publik: buka, ambil satu frame, tutup. Satu segmen per giliran, bukan streaming terus.
        cap = cv2.VideoCapture(url)
        try:
            ok, frame = cap.read()
            return frame if ok else None
        finally:
            cap.release()

    # ---- deteksi ----
    def _detect(self, frame) -> FrameResult:
        hazards: dict[str, float] = {}
        if self.custom:
            for r in self.custom(frame, verbose=False, conf=CONF_MIN):
                for c, conf in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                    h = CUSTOM_MAP.get(r.names[int(c)].lower())
                    if h:
                        hazards[h] = max(hazards.get(h, 0), conf)
        if self.world:
            for r in self.world(frame, verbose=False, conf=WORLD_CONF):
                for c, conf in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                    h = WORLD_PROMPTS.get(r.names[int(c)])
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
    async def step(self, cam_id: str) -> None:
        """Satu giliran untuk satu kamera: ambil frame, deteksi, mungkin buat kandidat kejadian."""
        import cv2

        from ..pipeline import process_candidate
        from .privacy import anonymize

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
            return

        res = await asyncio.to_thread(self._detect, frame)
        self.frames[cam_id].append(anonymize(res.frame, res.vehicle_boxes))
        for hz in TITLES:
            hist = self.history[(cam_id, hz)]
            hist.append(res.hazards.get(hz, 0.0))
            floor = WORLD_CONF if self.world and hz in ("fire", "flood") else CONF_MIN
            consistent = len(hist) == CONSISTENT_FRAMES and all(c >= floor for c in hist)
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


def vision_cameras() -> list[str]:
    """Kamera yang bisa dibaca di server: HLS/RTSP/snapshot, atau embed yang punya vision_url.

    YouTube tidak pernah diproses (dilarang ToS), kamera demo "none" tidak punya stream.
    VISION_CITIES membatasi ke kota tertentu (misal "Banjarbaru,Ciamis") supaya laptop kuat.
    """
    cities = {c.strip().lower() for c in settings.vision_cities.split(",") if c.strip()}
    ids = [
        c.id
        for c in hub.cameras.values()
        if (c.vision_url or (c.stream_type in ("hls", "rtsp", "snapshot") and c.stream_url))
        and c.stream_type != "youtube"
        and (not cities or c.city.lower() in cities)
    ]
    return ids[: settings.vision_max_cameras] if settings.vision_max_cameras > 0 else ids


async def start_vision() -> list[asyncio.Task]:
    try:
        vp = VisionPipeline()
    except ImportError:
        log.error("ENABLE_VISION=true tapi ultralytics belum terpasang. Jalankan: pip install -r requirements-vision.txt")
        return []
    settings.frames_dir.mkdir(parents=True, exist_ok=True)
    ids = vision_cameras()
    if not ids:
        log.warning("Pipeline vision aktif tapi tidak ada kamera yang bisa dibaca")
        return []
    order = itertools.cycle(ids)
    last: dict[str, float] = {}
    lock = asyncio.Lock()

    async def worker() -> None:
        while True:
            async with lock:
                cid = next(order)
            wait = settings.vision_sample_s - (time.monotonic() - last.get(cid, 0))
            if wait > 0:
                await asyncio.sleep(wait)
            last[cid] = time.monotonic()
            try:
                await vp.step(cid)
            except Exception:
                log.exception("vision kamera %s gagal", cid)

    n = max(1, min(settings.vision_concurrency, len(ids)))
    log.info("Pipeline vision aktif untuk %d kamera, %d worker, jeda %ss per kamera", len(ids), n, settings.vision_sample_s)
    return [asyncio.create_task(worker()) for _ in range(n)]

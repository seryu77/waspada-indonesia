"""Simulator demo: kejadian baru tiap SIMULATOR_MIN_S sampai SIMULATOR_MAX_S detik di lokasi nyata."""

import asyncio
import logging
import random
import uuid

from .config import settings
from .hub import hub
from .llm.context import haversine_km
from .models import Incident, Source, now_iso
from .pipeline import process_candidate

log = logging.getLogger("waspada.simulator")
SEVERITIES = ["critical", "critical", "high", "high", "medium", "low"]


_bag: list[dict] = []


def _next(templates: list[dict]) -> dict:
    """Putar template tanpa mengulang lokasi sampai semua terpakai."""
    global _bag
    if not _bag:
        _bag = random.sample(templates, len(templates))
    return _bag.pop()


async def spawn(templates: list[dict], severity: str | None = None, cctv_only: bool = False) -> Incident:
    active_titles = {i.title for i in hub.incidents.values() if i.status == "active" and i.id.startswith("sim-")}
    pool = [t for t in templates if t["source"]["kind"] == "cctv"] if cctv_only else templates
    pool = [t for t in pool if t["title"] not in active_titles] or pool
    t = random.choice(pool) if cctv_only else _next(templates)
    src = t["source"]
    inc = Incident(
        id=f"sim-{uuid.uuid4().hex[:10]}",
        type=t["type"],
        title=t["title"],
        description=t["description"],
        lat=t["lat"] + random.uniform(-0.01, 0.01),
        lng=t["lng"] + random.uniform(-0.01, 0.01),
        address=t["address"],
        severity=severity or random.choice(SEVERITIES),
        # kind "simulator" supaya UI tidak menyebutnya sumber resmi
        source=Source(id=f"sim-{src['id']}", label=f"{src['label']} (simulasi)", kind="simulator"),
        magnitude=t.get("magnitude"),
    )
    log.info("simulator: %s di %s (%s)", inc.title, inc.address, inc.severity)
    if src["kind"] == "cctv":
        inc.source.label = f"{src['label']} + YOLO (simulasi)"
        await _bump_camera(inc)
    asyncio.create_task(process_candidate(inc))
    return inc


async def run_simulator(templates: list[dict]) -> None:
    await asyncio.sleep(8)
    while True:
        await spawn(templates)
        await asyncio.sleep(random.uniform(settings.simulator_min_s, settings.simulator_max_s))


async def _bump_camera(inc: Incident) -> None:
    online = [c for c in hub.cameras.values() if c.status == "online"]
    if not online:
        return
    cam = min(online, key=lambda c: haversine_km(inc.lat, inc.lng, c.lat, c.lng))
    if haversine_km(inc.lat, inc.lng, cam.lat, cam.lng) > 80:
        return
    inc.camera_id = cam.id
    cam.detections_today += 1
    cam.last_frame_at = now_iso()
    await hub.update_camera(cam)

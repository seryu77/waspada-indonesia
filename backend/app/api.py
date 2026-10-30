import re
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import db
from .config import settings
from .dispatch.manager import PENDING, manager
from .hub import hub
from .models import Incident, Source, dump
from .pipeline import process_candidate
from .vision import privacy

router = APIRouter(prefix="/api")

BOUNDS = {"north": 6.8, "south": -11.8, "west": 94.0, "east": 141.8}
HAZARDS = {"fire", "flood", "crime", "earthquake", "landslide", "accident", "volcano"}
TITLES = {
    "fire": "Laporan kebakaran",
    "flood": "Laporan banjir",
    "crime": "Laporan kriminal",
    "earthquake": "Laporan gempa",
    "landslide": "Laporan longsor",
    "accident": "Laporan kecelakaan",
    "volcano": "Laporan gunung api",
}
MAX_PHOTO = 8 * 1024 * 1024


@router.get("/snapshot")
async def snapshot() -> dict:
    return hub.snapshot()


@router.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "incidents": len(hub.incidents),
        "clients": len(hub.clients),
        "verifier": "claude" if settings.llm_enabled else "heuristik (simulasi)",
        "dispatch_mode": settings.dispatch_mode,
        "vision": settings.enable_vision,
    }


def _get(incident_id: str) -> Incident:
    inc = hub.incidents.get(incident_id)
    if not inc:
        raise HTTPException(404, "Kejadian tidak ditemukan")
    return inc


@router.get("/incidents/{incident_id}/evidence")
async def incident_evidence(incident_id: str) -> dict:
    """Bukti pendukung untuk operator: kondisi lokasi, kejadian sekitar, kamera, frame deteksi."""
    from .evidence import gather

    return await gather(_get(incident_id))


@router.post("/incidents/{incident_id}/dispatch/confirm")
async def dispatch_confirm(incident_id: str) -> dict:
    inc = _get(incident_id)
    if not inc.dispatch or inc.dispatch.state not in PENDING:
        raise HTTPException(409, "Tidak ada dispatch yang menunggu keputusan untuk kejadian ini")
    inc = await manager.confirm(incident_id)
    return dump(inc)  # type: ignore[arg-type]


@router.post("/incidents/{incident_id}/dispatch/cancel")
async def dispatch_cancel(incident_id: str) -> dict:
    inc = _get(incident_id)
    if not inc.dispatch or inc.dispatch.state not in PENDING:
        raise HTTPException(409, "Tidak ada dispatch yang menunggu keputusan untuk kejadian ini")
    inc = await manager.cancel(incident_id)
    return dump(inc)  # type: ignore[arg-type]


@router.post("/reports", status_code=201)
async def create_report(
    background: BackgroundTasks,
    type: str = Form(...),
    description: str = Form(..., min_length=10, max_length=1000),
    lat: float = Form(...),
    lng: float = Form(...),
    photo: UploadFile | None = File(None),
) -> dict:
    if type not in HAZARDS:
        raise HTTPException(422, "Jenis kejadian tidak dikenal")
    if not (BOUNDS["south"] <= lat <= BOUNDS["north"] and BOUNDS["west"] <= lng <= BOUNDS["east"]):
        raise HTTPException(422, "Lokasi harus di wilayah Indonesia")

    rid = f"rep-{uuid.uuid4().hex[:10]}"
    frames: list[bytes] = []
    evidence: list[str] = []
    note = ""
    if photo and photo.filename:
        raw = await photo.read(MAX_PHOTO + 1)
        if len(raw) > MAX_PHOTO:
            raise HTTPException(413, "Foto maksimal 8 MB")
        blurred = privacy.anonymize_jpeg(raw)
        if blurred:
            settings.frames_dir.mkdir(parents=True, exist_ok=True)
            name = f"{rid}.jpg"
            (settings.frames_dir / name).write_bytes(blurred)
            frames.append(blurred)
            evidence.append(f"/api/frames/{name}")
        else:
            note = " (foto tidak dipakai: format tidak terbaca atau modul blur tidak tersedia)"

    inc = Incident(
        id=rid,
        type=type,  # type: ignore[arg-type]
        title=TITLES[type],
        description=description.strip() + note,
        lat=lat,
        lng=lng,
        address=f"{lat:.4f}, {lng:.4f}",
        severity="medium",
        source=Source(id="citizen", label="Laporan warga (Waspada)", kind="citizen"),
        evidence=evidence or None,
        verifying=True,
    )
    await db.save_report(rid, {"type": type, "description": description, "lat": lat, "lng": lng, "photo": bool(evidence)})
    await db.audit(rid, "system", "report_received", {"type": type})
    await hub.upsert_incident(inc)
    background.add_task(process_candidate, inc, frames)
    return dump(inc)


@router.post("/demo/trigger", status_code=201)
async def demo_trigger() -> dict:
    """Mode demo: buat kejadian kritis dari CCTV sekarang juga (untuk pitch dan uji alur 112)."""
    if not settings.demo_mode:
        raise HTTPException(404, "Mode demo nonaktif")
    from .main import TEMPLATES
    from .simulator import spawn

    inc = await spawn(TEMPLATES, severity="critical", cctv_only=True)
    return dump(inc)


@router.get("/audit")
async def audit(limit: int = 200, incident_id: str | None = None) -> list[dict]:
    return await db.audit_list(min(limit, 1000), incident_id)


@router.get("/frames/{name}")
async def frame(name: str) -> FileResponse:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.jpg", name):
        raise HTTPException(400, "Nama file tidak valid")
    path = settings.frames_dir / name
    if not path.is_file():
        raise HTTPException(404, "Frame tidak ditemukan")
    return FileResponse(path, media_type="image/jpeg")

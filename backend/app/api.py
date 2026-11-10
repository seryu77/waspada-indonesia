import re
import secrets
import uuid
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db
from .config import settings
from .dispatch.manager import PENDING, manager
from .hub import hub, public_view
from .models import Incident, OperatorNote, Source, dump
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

# Token rahasia per laporan warga: hanya pelapor (yang menyimpannya di browser) yang bisa membalas operator.
# Tidak pernah ikut dikirim lewat snapshot/WebSocket.
_report_tokens: dict[str, str] = {}


@router.get("/snapshot")
async def snapshot(role: str | None = None) -> dict:
    return hub.snapshot(operator=role == "operator")


@router.get("/hotspots")
async def hotspots() -> dict:
    """Titik panas untuk heatmap. Hanya diambil browser saat toggle heatmap dinyalakan."""
    return {"hotspots": hub.hotspots, "meta": hub.hotspot_meta}


@router.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "incidents": len(hub.incidents),
        "clients": len(hub.clients),
        "verifier": settings.verifier_label,
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


class ManualDispatchIn(BaseModel):
    agency: str | None = Field(None, max_length=120)


@router.post("/incidents/{incident_id}/dispatch/manual")
async def dispatch_manual(incident_id: str, body: ManualDispatchIn | None = None) -> dict:
    """Operator mengirim ke 112 secara manual, untuk kejadian yang tidak masuk alur dispatch otomatis."""
    inc = _get(incident_id)
    if inc.status != "active":
        raise HTTPException(409, "Kejadian sudah ditutup")
    if inc.dispatch and inc.dispatch.state in (*PENDING, "sent"):
        raise HTTPException(409, "Kejadian ini sudah dalam alur dispatch")
    inc = await manager.manual(incident_id, body.agency if body else None)
    return dump(inc)  # type: ignore[arg-type]


class ResolveIn(BaseModel):
    reason: Literal["handled", "false_alarm", "duplicate"]
    note: str | None = Field(None, max_length=500)


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: str, body: ResolveIn) -> dict:
    """Operator menutup kejadian. False alarm atau duplikat yang masih menunggu dispatch otomatis ditolak dulu."""
    inc = _get(incident_id)
    if inc.status != "active":
        raise HTTPException(409, "Kejadian sudah ditutup")
    if inc.dispatch and inc.dispatch.state in PENDING:
        if body.reason == "handled":
            raise HTTPException(409, "Putuskan dispatch 112 dulu sebelum menandai kejadian selesai")
        inc = await manager.cancel(incident_id) or inc
    if body.note and body.note.strip():
        inc.notes = [*(inc.notes or []), OperatorNote(text=body.note.strip())]
    await hub.resolve(inc, body.reason, "operator")
    await db.audit(incident_id, "operator", "resolved", {"reason": body.reason, "note": body.note})
    return dump(inc)


class NoteIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    kind: Literal["note", "update", "question"] = "note"


@router.post("/incidents/{incident_id}/notes", status_code=201)
async def add_note(incident_id: str, body: NoteIn) -> dict:
    inc = _get(incident_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Catatan kosong")
    if body.kind == "question" and incident_id not in _report_tokens:
        raise HTTPException(409, "Pertanyaan hanya bisa dikirim ke laporan warga dari aplikasi Waspada")
    inc.notes = [*(inc.notes or []), OperatorNote(text=text, kind=body.kind)]
    await hub.upsert_incident(inc)
    await db.audit(incident_id, "operator", "note_added", {"text": text, "kind": body.kind})
    return dump(inc)


class RulesIn(BaseModel):
    auto_dispatch_enabled: bool | None = None
    auto_dispatch_min: float | None = Field(None, ge=0.5, le=0.99)
    countdown_s: int | None = Field(None, ge=10, le=300)
    false_alarm_hide_min: float | None = Field(None, ge=0.5, le=0.99)
    citizen_requires_review: bool | None = None
    official_quake_auto: bool | None = None


@router.get("/automation")
async def get_automation() -> dict:
    return settings.rules()


@router.put("/automation")
async def put_automation(body: RulesIn) -> dict:
    """Ubah aturan otomasi saat runtime. Berlaku untuk kejadian berikutnya, bukan yang sudah diputuskan."""
    changes = body.model_dump(exclude_none=True)
    attr = {"auto_dispatch_min": "dispatch_confidence_min", "countdown_s": "dispatch_countdown_s"}
    before = settings.rules()
    for k, val in changes.items():
        setattr(settings, attr.get(k, k), val)
    diff = {k: {"from": before[k], "to": v} for k, v in changes.items() if before[k] != v}
    if diff:
        await db.audit(None, "operator", "rules_updated", diff)
        await hub.broadcast("meta.update", hub.meta())
    return settings.rules()


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
    token = secrets.token_urlsafe(24)
    _report_tokens[rid] = token
    await db.save_report(rid, {"type": type, "description": description, "lat": lat, "lng": lng, "photo": bool(evidence), "token": token})
    await db.audit(rid, "system", "report_received", {"type": type})
    await hub.upsert_incident(inc)
    background.add_task(process_candidate, inc, frames)
    return dump(inc) | {"reporter_token": token}


class ReplyIn(BaseModel):
    token: str = Field(..., min_length=8, max_length=100)
    text: str = Field(..., min_length=1, max_length=500)


@router.post("/reports/{report_id}/reply", status_code=201)
async def reporter_reply(report_id: str, body: ReplyIn) -> dict:
    """Pelapor membalas operator (misal menjawab pertanyaan atau menambah info). Butuh token dari saat melapor."""
    inc = _get(report_id)
    expected = _report_tokens.get(report_id)
    if not expected or not secrets.compare_digest(expected, body.token):
        raise HTTPException(403, "Token laporan tidak cocok")
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Pesan kosong")
    inc.notes = [*(inc.notes or []), OperatorNote(author="pelapor", text=text, kind="reply")]
    await hub.upsert_incident(inc)
    await db.audit(report_id, "citizen", "reporter_replied", {"text": text})
    return public_view(dump(inc))


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

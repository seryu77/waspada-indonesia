"""Mode rekam video demo: skenario yang bisa diulang, tanpa hasil acak.

Saat mode rekam aktif:
- simulator berhenti membuat kejadian acak (dan tidak menutup kejadian simulasi lama),
- sumber live (FIRMS, BMKG, PetaBencana, MAGMA) dibekukan setelah data pertama masuk,
  supaya id dan isi kejadian tidak berubah di tengah rekaman,
- kalau fokus jenis diisi (misal kebakaran, gempa, kecelakaan), jenis lain tidak dikirim ke browser.
Skenario dipicu dari halaman /rekam (atau POST /api/demo/scenario/{nama}).
Perilaku default (mode rekam mati) tidak berubah.
"""

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db
from .config import Settings, settings
from .dispatch.manager import manager
from .hub import hub
from .models import Incident, Source, Verification, dump

HAZARDS = {"fire", "flood", "crime", "earthquake", "landslide", "accident", "volcano"}

router = APIRouter(prefix="/api/demo")

RULE_ATTRS = ["auto_dispatch_enabled", "dispatch_confidence_min", "dispatch_countdown_s", "false_alarm_hide_min", "citizen_requires_review", "official_quake_auto"]

# Hasil verifikasi ditetapkan (bukan acak) supaya setiap take menghasilkan jalur yang sama
CCTV = ("sim-cctv", "CCTV demo + YOLO (simulasi)")
SCENARIOS: dict[str, dict] = {
    # ---- Kebakaran ----
    "fire_auto": {
        "label": "Kebakaran gudang (CCTV): auto-dispatch",
        "type": "fire",
        "title": "Kebakaran gudang",
        "description": "YOLO mendeteksi api dan asap tebal di 4 frame berturut-turut.",
        "lat": -6.1352,
        "lng": 106.8133,
        "address": "Penjaringan, Jakarta Utara",
        "severity": "critical",
        "source": CCTV,
        "verdict": "confirmed",
        "confidence": 0.93,
        "reasoning": "Api dan asap tebal terlihat konsisten di 4 frame berurutan, tidak ada tanda latihan atau pembakaran terkendali. Gudang berada di kawasan padat dekat permukiman.",
        "agency": "Damkar Jakarta Utara + BPBD DKI",
    },
    "fire_citizen": {
        "label": "Laporan warga kebakaran rumah: wajib validasi",
        "type": "fire",
        "title": "Kebakaran rumah warga",
        "description": "Warga melaporkan api dari dapur merambat ke atap, dua rumah di sebelahnya terancam.",
        "lat": -6.9175,
        "lng": 107.6191,
        "address": "Kel. Babakan Ciamis, Sumur Bandung, Kota Bandung",
        "severity": "high",
        "source": ("sim-citizen", "Laporan warga (simulasi)"),
        "verdict": "confirmed",
        "confidence": 0.88,
        "reasoning": "Deskripsi laporan konsisten (sumber api, arah rambatan, dan rumah terancam disebut jelas) dan lokasinya permukiman padat. Laporan warga tetap wajib divalidasi operator 112.",
        "agency": "Damkar Kota Bandung",
    },
    "fire_false": {
        "label": "Asap gerobak sate (CCTV): false alarm disaring AI",
        "type": "fire",
        "title": "Asap terdeteksi di tepi jalan",
        "description": "YOLO mendeteksi asap putih di trotoar.",
        "lat": -7.7926,
        "lng": 110.3658,
        "address": "Jl. Malioboro, Yogyakarta",
        "severity": "high",
        "source": CCTV,
        "verdict": "false_alarm",
        "confidence": 0.86,
        "reasoning": "Asap berasal dari gerobak sate di tepi jalan: nyala kecil, terkendali, dan ada penjual di sampingnya. Bukan kebakaran.",
        "agency": "Damkar setempat",
    },
    # ---- Kecelakaan ----
    "accident_auto": {
        "label": "Bus terguling di tol (CCTV): auto-dispatch",
        "type": "accident",
        "title": "Bus terguling",
        "description": "YOLO mendeteksi bus rebah di bahu jalan dan kendaraan berhenti mendadak di belakangnya.",
        "lat": -7.0225,
        "lng": 110.3567,
        "address": "Tol Semarang-Solo KM 448, Ungaran",
        "severity": "critical",
        "source": CCTV,
        "verdict": "confirmed",
        "confidence": 0.91,
        "reasoning": "Bus terlihat rebah di 3 frame berurutan, arus kendaraan di belakangnya berhenti. Kemungkinan banyak korban, butuh ambulans dan evakuasi.",
        "agency": "PJR Jateng + Ambulans 119 + Basarnas",
    },
    "accident_review": {
        "label": "Tabrakan di persimpangan (CCTV): butuh validasi",
        "type": "accident",
        "title": "Tabrakan di persimpangan",
        "description": "YOLO mendeteksi dua kendaraan berhenti melintang dan kerumunan di persimpangan.",
        "lat": -7.2756,
        "lng": 112.7426,
        "address": "Jl. Ahmad Yani, Surabaya",
        "severity": "high",
        "source": CCTV,
        "verdict": "confirmed",
        "confidence": 0.78,
        "reasoning": "Dua kendaraan berhenti melintang dan kerumunan mulai terbentuk, tetapi korban belum terlihat jelas di frame. Perlu dicek operator sebelum mengirim petugas.",
        "agency": "Satlantas Polrestabes Surabaya + Ambulans 119",
    },
    # ---- Gempa (aturan sumber resmi, tanpa LLM) ----
    "quake_auto": {
        "label": "Gempa M6,4 (data BMKG): langsung hitung mundur",
        "type": "earthquake",
        "title": "Gempa M6,4 Cianjur",
        "description": "Gempa M6,4 kedalaman 10 km, dirasakan kuat di Cianjur, Sukabumi, dan Bandung.",
        "lat": -6.86,
        "lng": 107.01,
        "address": "10 km BaratDaya Kab. Cianjur, Jawa Barat",
        "severity": "critical",
        "magnitude": 6.4,
        "source": ("sim-bmkg", "BMKG (simulasi)"),
        "official": True,
        "agency": "BPBD + Basarnas",
    },
    "quake_watch": {
        "label": "Gempa M4,8 (data BMKG): cukup dipantau",
        "type": "earthquake",
        "title": "Gempa M4,8 Bengkulu",
        "description": "Gempa M4,8 kedalaman 35 km, dirasakan lemah di Bengkulu.",
        "lat": -4.12,
        "lng": 101.95,
        "address": "48 km BaratDaya Kab. Seluma, Bengkulu",
        "severity": "low",
        "magnitude": 4.8,
        "source": ("sim-bmkg", "BMKG (simulasi)"),
        "official": True,
        "agency": "BPBD setempat",
    },
}

FOCUS_DEFAULT = "fire,earthquake,accident"


def state() -> dict:
    return {
        "demo": settings.demo_mode,
        "recording": settings.recording_mode,
        "focus": settings.demo_focus,
        "scenarios": [{"name": k, "label": v["label"]} for k, v in SCENARIOS.items()],
    }


@router.get("/state")
async def get_state() -> dict:
    return state()


class RecordingIn(BaseModel):
    enabled: bool


def _require_demo() -> None:
    if not settings.demo_mode:
        raise HTTPException(404, "Mode demo nonaktif")


@router.post("/recording")
async def set_recording(body: RecordingIn) -> dict:
    _require_demo()
    settings.recording_mode = body.enabled
    await db.audit(None, "operator", "recording_mode", {"enabled": body.enabled})
    await _resync()
    return state()


class FocusIn(BaseModel):
    # Jenis bahaya yang tampil saat mode rekam; kosong = semua
    types: list[str]


@router.post("/focus")
async def set_focus(body: FocusIn) -> dict:
    _require_demo()
    settings.demo_focus = ",".join(t for t in body.types if t in HAZARDS)
    await _resync()
    return state()


async def _resync() -> None:
    """Fokus atau mode rekam berubah: kirim ulang seluruh isi peta ke browser."""
    await hub.broadcast("snapshot", hub.snapshot())
    await hub.broadcast("meta.update", hub.meta())


@router.post("/scenario/{name}", status_code=201)
async def scenario(name: str) -> dict:
    _require_demo()
    s = SCENARIOS.get(name)
    if not s:
        raise HTTPException(404, "Skenario tidak dikenal")
    from .pipeline import process_candidate
    from .simulator import _bump_camera

    src_id, src_label = s["source"]
    if s.get("official"):
        return await _official(s)
    inc = Incident(
        id=f"sim-{uuid.uuid4().hex[:10]}",
        type=s["type"],
        title=s["title"],
        description=s["description"],
        lat=s["lat"],
        lng=s["lng"],
        address=s["address"],
        severity=s["severity"],
        source=Source(id=src_id, label=src_label, kind="simulator"),
    )
    if src_id == "sim-cctv":
        await _bump_camera(inc)
    preset = Verification(
        verdict=s["verdict"],
        confidence=s["confidence"],
        severity=s["severity"],
        reasoning=s["reasoning"],
        recommended_agency=s["agency"],
        model="heuristik (simulasi)",
        stage="triage",
        simulated=True,
        needs_manual_review=s["verdict"] != "confirmed",
    )
    import asyncio

    asyncio.create_task(process_candidate(inc, preset=preset))
    return dump(inc)


async def _official(s: dict) -> dict:
    """Gempa dari sumber resmi: tidak lewat verifier AI, aturan official_quake_auto yang memutuskan (sama dengan BMKG asli)."""
    inc = Incident(
        id=f"sim-{uuid.uuid4().hex[:10]}",
        type=s["type"],
        title=s["title"],
        description=s["description"],
        lat=s["lat"],
        lng=s["lng"],
        address=s["address"],
        severity=s["severity"],
        magnitude=s["magnitude"],
        source=Source(id=s["source"][0], label=s["source"][1], kind="simulator"),
    )
    if (inc.magnitude or 0) < 6:
        await hub.upsert_incident(inc)  # di bawah M6: tampil di peta, tidak masuk alur dispatch
        return dump(inc)
    inc.verification = Verification(
        verdict="confirmed",
        confidence=0.99,
        severity=inc.severity,
        reasoning="Data resmi BMKG. Gempa M6 atau lebih, tidak memerlukan verifikasi LLM.",
        recommended_agency=s["agency"],
        model="aturan sumber resmi BMKG (simulasi, tanpa LLM)",
        stage="verify",
        simulated=True,
        needs_manual_review=False,
    )
    await hub.upsert_incident(inc)
    if settings.official_quake_auto:
        await manager.start(inc)
    else:
        await manager.request_review(inc, reason="Aturan gempa resmi langsung kirim dimatikan, menunggu validasi operator 112")
    return dump(inc)


@router.post("/reset")
async def reset() -> dict:
    """Kembalikan data demo ke awal: kejadian simulasi dihapus, data contoh dimuat ulang, aturan otomasi ke default."""
    _require_demo()
    from .sources.demo_seed import load_seed

    for iid in list(manager._tasks):
        manager._stop_timer(iid)
    incidents, _, _, countdown_ids, _ = load_seed()
    seed_ids = {i.id for i in incidents}
    for iid in [k for k in hub.incidents if k.startswith("sim-") or k in seed_ids]:
        hub.incidents.pop(iid)
    for i in incidents:
        hub.incidents[i.id] = i
    fresh = Settings()
    for attr in RULE_ATTRS:
        setattr(settings, attr, getattr(fresh, attr))
    await db.audit(None, "operator", "demo_reset", {})
    await hub.broadcast("snapshot", hub.snapshot())
    for cid in countdown_ids:
        await manager.route(hub.incidents[cid])
    await hub.broadcast("meta.update", hub.meta())
    return state()

"""Waspada Nusantara - backend FastAPI + WebSocket.

Jalankan: uvicorn app.main:app --reload --port 8000
"""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .api import router
from .config import settings
from .dispatch.manager import manager
from .hub import hub
from .models import Verification
from .simulator import run_simulator
from .sources.base import DataSource
from .sources.bmkg import BMKGSource
from .sources.demo_seed import load_cameras, load_seed
from .sources.firms import FIRMSSource
from .sources.magma import MagmaSource
from .sources.petabencana import PetaBencanaSource

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("waspada")
TEMPLATES: list[dict] = []


async def run_source(src: DataSource) -> None:
    """Loop satu sumber data. Gagal = log lalu coba lagi, tidak pernah menjatuhkan server."""
    from .pipeline import process_candidate

    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "WaspadaNusantara/0.1 (hackathon)"}, follow_redirects=True) as client:
        while True:
            try:
                res = await src.fetch(client)
                for z in res.zones:
                    hub.zones[z.id] = z
                if res.hotspots is not None:
                    await hub.set_hotspots(res.hotspots, res.hotspot_meta or {})
                if res.replace:
                    if src.id == "magma" and res.zones:
                        # Ganti zona radius gunung api demo dengan data PVMBG
                        for zid in [k for k, z in hub.zones.items() if z.kind == "volcano_exclusion" and not k.startswith("zone-magma-")]:
                            hub.zones.pop(zid)
                    new = await hub.replace_source(src.id, res.incidents)
                    for inc in new:
                        await _official_dispatch(inc)
                else:
                    for inc in res.incidents:
                        if inc.id in hub.incidents:
                            continue
                        if res.needs_verification:
                            asyncio.create_task(process_candidate(inc))
                        else:
                            await hub.upsert_incident(inc)
                if res.zones:
                    await hub.broadcast("snapshot", hub.snapshot())
                log.info("sumber %s: %d kejadian", src.id, len(res.incidents))
            except Exception as e:
                log.warning("sumber %s gagal: %s", src.id, e)
                if src.id == "firms":
                    hub.hotspot_meta = {**hub.hotspot_meta, "error": str(e)[:160]}
                    await hub.broadcast("hotspots.meta", hub.hotspot_meta)
            await asyncio.sleep(src.interval_s)


async def _official_dispatch(inc) -> None:
    """Gempa resmi M >= 6 langsung masuk hitung mundur (tanpa LLM, label sumber resmi)."""
    if inc.type == "earthquake" and (inc.magnitude or 0) >= 6:
        inc.verification = Verification(
            verdict="confirmed",
            confidence=0.99,
            severity=inc.severity,
            reasoning="Data resmi BMKG. Gempa M6 atau lebih, tidak memerlukan verifikasi LLM.",
            recommended_agency="BPBD + Basarnas",
            model="sumber resmi BMKG (tanpa LLM)",
            stage="verify",
            simulated=False,
            needs_manual_review=False,
        )
        if settings.official_quake_auto:
            await manager.start(inc)
        else:
            await manager.request_review(inc, reason="Aturan gempa resmi langsung kirim dimatikan, menunggu validasi operator 112")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init()
    settings.frames_dir.mkdir(parents=True, exist_ok=True)
    incidents, zones, routes, countdown_ids, templates = load_seed()
    TEMPLATES[:] = templates
    hub.cameras = {c.id: c for c in load_cameras()}
    hub.routes = {r.id: r for r in routes}
    hub.zones = {z.id: z for z in zones}
    if settings.demo_mode:
        hub.incidents = {i.id: i for i in incidents}
    tasks: list[asyncio.Task] = [asyncio.create_task(hub.heartbeat_loop())]
    if settings.demo_mode:
        for cid in countdown_ids:
            if cid in hub.incidents:
                await manager.route(hub.incidents[cid])
        tasks.append(asyncio.create_task(run_simulator(templates)))
    for src in [BMKGSource(), FIRMSSource(), PetaBencanaSource(), MagmaSource()]:
        if src.enabled():
            tasks.append(asyncio.create_task(run_source(src)))
        else:
            log.info("sumber %s nonaktif", src.id)
    if settings.enable_vision:
        from .vision.pipeline import start_vision

        tasks += await start_vision()
    log.info(
        "Waspada Nusantara siap. verifier=%s dispatch=%s demo=%s",
        settings.verifier_label,
        settings.dispatch_mode,
        settings.demo_mode,
    )
    yield
    for t in tasks:
        t.cancel()
    for t in tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await t
    await db.close()


app = FastAPI(title="Waspada Nusantara API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    # Halaman operator menyambung dengan ?role=operator supaya menerima catatan internal.
    # Ini pemisahan tampilan, bukan autentikasi (belum ada login operator).
    await hub.connect(ws, operator=ws.query_params.get("role") == "operator")
    try:
        while True:
            await ws.receive_text()  # klien tidak perlu mengirim apa pun; ini menjaga koneksi
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws)

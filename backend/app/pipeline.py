"""Alur kandidat: tandai sedang diverifikasi -> verifier (LLM atau heuristik) -> audit -> dispatch."""

import asyncio
import logging

from . import db
from .config import settings
from .dispatch.manager import manager, should_dispatch
from .hub import hub
from .llm.context import build_context, haversine_km
from .llm.verifier import verify_incident
from .models import Incident, dump

log = logging.getLogger("waspada.pipeline")
_sem = asyncio.Semaphore(3)  # batasi panggilan LLM paralel


async def process_candidate(inc: Incident, frames: list[bytes] | None = None) -> Incident:
    frames = frames or []
    inc.verifying = True
    await hub.upsert_incident(inc)
    others = list(hub.incidents.values())
    nearby = sum(1 for o in others if o.id != inc.id and o.status == "active" and haversine_km(inc.lat, inc.lng, o.lat, o.lng) <= 15)
    async with _sem:
        if not settings.llm_enabled:
            await asyncio.sleep(2.5)  # supaya status "diverifikasi" terlihat di demo
        context = await build_context(inc, others)
        v = await verify_incident(inc, frames, context, nearby)
    inc = hub.incidents.get(inc.id, inc)
    inc.verifying = None
    inc.verification = v
    # False alarm yang yakin disembunyikan dari peta, tapi tetap tersimpan di DB + audit log
    if v.verdict == "false_alarm" and v.confidence >= 0.7:
        inc.status = "resolved"
    await hub.upsert_incident(inc)
    await db.audit(inc.id, "ai", f"verified_{v.stage}", dump(v))
    if should_dispatch(inc):
        await manager.start(inc)
    return inc

"""Alur kandidat: tandai sedang diverifikasi -> verifier (LLM atau heuristik) -> audit -> dispatch (auto atau review)."""

import asyncio
import logging

from . import db
from .config import settings
from .dispatch.manager import manager
from .evidence import conditions
from .hub import hub
from .llm.context import build_context, haversine_km
from .llm.verifier import verify_incident
from .models import Incident, Verification, dump
from .news import check_news

log = logging.getLogger("waspada.pipeline")
_sem = asyncio.Semaphore(3)  # batasi panggilan LLM paralel
# Kluster satelit datang berombongan (puluhan sekaligus); antrean terpisah supaya tidak menahan
# verifikasi laporan warga, CCTV, dan simulator
_sat_sem = asyncio.Semaphore(4)


async def process_candidate(inc: Incident, frames: list[bytes] | None = None, preset: Verification | None = None) -> Incident:
    """preset: hasil verifikasi yang sudah ditetapkan (skenario mode rekam); verifier dilewati."""
    frames = frames or []
    inc.verifying = True
    await hub.upsert_incident(inc)
    others = list(hub.incidents.values())
    near = [o for o in others if o.id != inc.id and o.status == "active" and haversine_km(inc.lat, inc.lng, o.lat, o.lng) <= 15]
    nearby = len(near)
    # Laporan kebakaran dari sumber lain (warga, CCTV, resmi) di dekat titik panas satelit
    nearby_fire = sum(1 for o in near if o.type == "fire" and o.source.kind != "satellite" and not o.source.id.endswith("firms"))
    async with _sat_sem if inc.satellite else _sem:
        if (preset or not settings.llm_enabled) and not inc.satellite:
            await asyncio.sleep(2.5)  # supaya status "diverifikasi" terlihat di demo
        if preset:
            v = preset
        else:
            # Satu kali ambil (di-cache), jadi angka untuk LLM, heuristik, dan panel operator sama
            cond = await conditions(inc.lat, inc.lng)
            news = await check_news(inc)
            context = await build_context(inc, others, cond=cond, news=news)
            v = await verify_incident(inc, frames, context, nearby, conditions=cond, nearby_fire=nearby_fire, news=news)
    inc = hub.incidents.get(inc.id, inc)
    inc.verifying = None
    inc.verification = v
    # False alarm yang yakin disembunyikan dari peta, tapi tetap tersimpan di DB + audit log
    if v.verdict == "false_alarm" and v.confidence >= settings.false_alarm_hide_min:
        await hub.resolve(inc, "false_alarm", "ai")
    else:
        await hub.upsert_incident(inc)
    await db.audit(inc.id, "ai", f"verified_{v.stage}", dump(v))
    await manager.route(inc)
    return inc

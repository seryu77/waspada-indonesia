"""Auto-dispatch dengan human-in-the-loop.

Aturan: verdict confirmed + confidence >= DISPATCH_CONFIDENCE_MIN + severity tinggi/kritis
-> hitung mundur DISPATCH_COUNTDOWN_S. Operator bisa "Kirim sekarang" atau "Batalkan".
Tanpa aksi, payload terkirim otomatis lewat adapter. Semua keputusan dicatat di audit log.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .. import db
from ..config import settings
from ..hub import hub
from ..models import Dispatch, Incident, TimelineEntry, now_iso
from .base import DispatchAdapter
from .simulate import SimulateAdapter
from .webhook import WebhookAdapter

log = logging.getLogger("waspada.dispatch")


def make_adapter() -> DispatchAdapter:
    return WebhookAdapter() if settings.dispatch_mode == "webhook" else SimulateAdapter()


def should_dispatch(inc: Incident) -> bool:
    v = inc.verification
    if not v or inc.dispatch:
        return False
    return v.verdict == "confirmed" and v.confidence >= settings.dispatch_confidence_min and v.severity in ("high", "critical")


def build_payload(inc: Incident, decided_by: str) -> dict:
    v = inc.verification
    base = settings.public_base_url.rstrip("/")
    evidence = [e if e.startswith("http") else f"{base}{e}" for e in (inc.evidence or [])]
    return {
        "schema": "waspada.dispatch.v1",
        "incident_id": inc.id,
        "type": inc.type,
        "title": inc.title,
        "severity": inc.effective_severity(),
        "coordinates": {"lat": inc.lat, "lng": inc.lng},
        "address": inc.address,
        "reported_at": inc.reported_at,
        "sent_at": now_iso(),
        "source": inc.source.model_dump(),
        "ai_summary": {
            "verdict": v.verdict,
            "confidence": v.confidence,
            "reasoning": v.reasoning,
            "model": v.model,
            "simulated": v.simulated,
        }
        if v
        else None,
        "evidence_urls": evidence,
        "recommended_agency": inc.dispatch.agency if inc.dispatch else (v.recommended_agency if v else None),
        "decided_by": decided_by,
    }


class DispatchManager:
    def __init__(self) -> None:
        self.adapter = make_adapter()
        self._tasks: dict[str, asyncio.Task] = {}

    async def start(self, inc: Incident, agency: str | None = None, note: str | None = None) -> Incident:
        secs = settings.dispatch_countdown_s
        deadline = datetime.now(timezone.utc) + timedelta(seconds=secs)
        v = inc.verification
        tl = []
        if v:
            tl.append(TimelineEntry(actor="ai", action="verified", note=note or f"Terverifikasi {v.model} (confidence {v.confidence:.2f})".replace(".", ",")))
        tl.append(TimelineEntry(actor="system", action="countdown_started", note=f"Hitung mundur {secs} detik dimulai"))
        inc.dispatch = Dispatch(
            state="countdown",
            agency=agency or (v.recommended_agency if v else "BPBD setempat"),
            mode=self.adapter.mode,  # type: ignore[arg-type]
            deadline=deadline.isoformat(),
            countdown_s=secs,
            timeline=tl,
        )
        await hub.upsert_incident(inc)
        await db.audit(inc.id, "system", "countdown_started", {"seconds": secs, "agency": inc.dispatch.agency})
        self._tasks[inc.id] = asyncio.create_task(self._countdown(inc.id, secs))
        return inc

    async def _countdown(self, incident_id: str, secs: float) -> None:
        try:
            await asyncio.sleep(secs)
            await self._send(incident_id, "system", "auto_sent", "Tidak ada aksi operator, terkirim otomatis")
        except asyncio.CancelledError:
            pass

    async def _send(self, incident_id: str, actor: str, action: str, note: str) -> Incident | None:
        inc = hub.incidents.get(incident_id)
        if not inc or not inc.dispatch or inc.dispatch.state != "countdown":
            return inc
        d = inc.dispatch
        d.timeline.append(TimelineEntry(actor=actor, action=action, note=note))  # type: ignore[arg-type]
        payload = build_payload(inc, decided_by=actor)
        result = await self.adapter.send(payload)
        d.deadline = None
        if result.ok:
            d.state = "sent"
            d.sent_at = now_iso()
            d.timeline.append(TimelineEntry(actor="system", action="sent", note=result.note))
        else:
            d.state = "failed"
            d.timeline.append(TimelineEntry(actor="system", action="failed", note=result.note))
        await db.audit(incident_id, actor, action, {"result": d.state, "note": result.note, "payload": payload})
        await hub.upsert_incident(inc)
        return inc

    def _stop_timer(self, incident_id: str) -> None:
        t = self._tasks.pop(incident_id, None)
        if t and not t.done() and t is not asyncio.current_task():
            t.cancel()

    async def confirm(self, incident_id: str) -> Incident | None:
        self._stop_timer(incident_id)
        return await self._send(incident_id, "operator", "confirmed", "Operator menekan Kirim sekarang")

    async def cancel(self, incident_id: str) -> Incident | None:
        self._stop_timer(incident_id)
        inc = hub.incidents.get(incident_id)
        if not inc or not inc.dispatch or inc.dispatch.state != "countdown":
            return inc
        inc.dispatch.state = "cancelled"
        inc.dispatch.deadline = None
        inc.dispatch.timeline.append(TimelineEntry(actor="operator", action="cancelled", note="Dibatalkan operator"))
        await db.audit(incident_id, "operator", "cancelled", {})
        await hub.upsert_incident(inc)
        return inc


manager = DispatchManager()

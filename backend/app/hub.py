"""State in-memory + broadcast WebSocket."""

import asyncio
import json
import logging

from fastapi import WebSocket

from . import db
from .config import settings
from .models import Camera, Incident, Route, Zone, dump, now_iso

log = logging.getLogger("waspada.hub")


class Hub:
    def __init__(self) -> None:
        self.incidents: dict[str, Incident] = {}
        self.zones: dict[str, Zone] = {}
        self.routes: dict[str, Route] = {}
        self.cameras: dict[str, Camera] = {}
        self.clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    # ---- snapshot ----
    def snapshot(self) -> dict:
        return {
            "incidents": [dump(i) for i in self.incidents.values()],
            "zones": [dump(z) for z in self.zones.values()],
            "routes": [dump(r) for r in self.routes.values()],
            "cameras": [dump(c) for c in self.cameras.values()],
            "meta": {
                "verifier": "claude" if settings.llm_enabled else "heuristik (simulasi)",
                "dispatch_mode": settings.dispatch_mode,
                "countdown_s": settings.dispatch_countdown_s,
                "server_time": now_iso(),
            },
        }

    # ---- clients ----
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        await ws.send_text(json.dumps({"type": "snapshot", "data": self.snapshot()}))

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, type_: str, data: dict) -> None:
        if not self.clients:
            return
        msg = json.dumps({"type": type_, "data": data})
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    # ---- mutations ----
    async def upsert_incident(self, inc: Incident, persist: bool = True) -> Incident:
        inc.updated_at = now_iso()
        self.incidents[inc.id] = inc
        data = dump(inc)
        if persist:
            await db.save_incident(data)
        await self.broadcast("incident.upsert", data)
        return inc

    async def replace_source(self, source_id: str, fresh: list[Incident]) -> list[Incident]:
        """Ganti semua kejadian dari satu sumber resmi. Kembalikan kejadian yang benar-benar baru."""
        fresh_ids = {i.id for i in fresh}
        for old_id, old in list(self.incidents.items()):
            if old.source.id == source_id and old_id not in fresh_ids and old.status == "active":
                old.status = "resolved"
                await self.upsert_incident(old)
        new = []
        for inc in fresh:
            prev = self.incidents.get(inc.id)
            if prev is None:
                new.append(inc)
            else:
                # Pertahankan verifikasi/dispatch yang sudah ada
                inc.verification = prev.verification
                inc.dispatch = prev.dispatch
                inc.reported_at = prev.reported_at
            if prev is None or dump(prev) | {"updated_at": ""} != dump(inc) | {"updated_at": ""}:
                await self.upsert_incident(inc)
        return new

    async def update_camera(self, cam: Camera) -> None:
        self.cameras[cam.id] = cam
        await self.broadcast("camera.update", dump(cam))

    async def heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(15)
            await self.broadcast("heartbeat", {"server_time": now_iso()})


hub = Hub()

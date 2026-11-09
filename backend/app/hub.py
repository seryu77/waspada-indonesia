"""State in-memory + broadcast WebSocket."""

import asyncio
import json
import logging

from fastapi import WebSocket

from . import db
from .config import settings
from .models import Camera, Incident, Route, Zone, dump, now_iso

log = logging.getLogger("waspada.hub")


def public_view(data: dict) -> dict:
    """Versi kejadian untuk halaman publik: catatan internal operator dibuang."""
    notes = data.get("notes")
    if not notes:
        return data
    shown = [n for n in notes if n.get("kind") != "note"]
    out = {k: v for k, v in data.items() if k != "notes"}
    if shown:
        out["notes"] = shown
    return out


class Hub:
    def __init__(self) -> None:
        self.incidents: dict[str, Incident] = {}
        self.zones: dict[str, Zone] = {}
        self.routes: dict[str, Route] = {}
        self.cameras: dict[str, Camera] = {}
        # WebSocket -> True kalau klien halaman operator (lihat /ws?role=operator)
        self.clients: dict[WebSocket, bool] = {}
        self._lock = asyncio.Lock()

    # ---- snapshot ----
    def snapshot(self, operator: bool = True) -> dict:
        incidents = [dump(i) for i in self.incidents.values()]
        return {
            "incidents": incidents if operator else [public_view(i) for i in incidents],
            "zones": [dump(z) for z in self.zones.values()],
            "routes": [dump(r) for r in self.routes.values()],
            "cameras": [dump(c) for c in self.cameras.values()],
            "meta": self.meta(),
        }

    def meta(self) -> dict:
        return {
            "verifier": settings.verifier_label,
            "dispatch_mode": settings.dispatch_mode,
            "countdown_s": settings.dispatch_countdown_s,
            "auto_dispatch_min": settings.dispatch_confidence_min,
            "rules": settings.rules(),
            "server_time": now_iso(),
        }

    # ---- clients ----
    async def connect(self, ws: WebSocket, operator: bool = False) -> None:
        await ws.accept()
        self.clients[ws] = operator
        await ws.send_text(json.dumps({"type": "snapshot", "data": self.snapshot(operator)}))

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.pop(ws, None)

    async def broadcast(self, type_: str, data: dict) -> None:
        if not self.clients:
            return
        msg = json.dumps({"type": type_, "data": data})
        public_msg = msg
        if type_ == "incident.upsert":
            public_msg = json.dumps({"type": type_, "data": public_view(data)})
        elif type_ == "snapshot":
            public_msg = json.dumps({"type": type_, "data": self.snapshot(operator=False)})
        dead = []
        for ws, operator in list(self.clients.items()):
            try:
                await ws.send_text(msg if operator else public_msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.pop(ws, None)

    # ---- mutations ----
    async def upsert_incident(self, inc: Incident, persist: bool = True) -> Incident:
        inc.updated_at = now_iso()
        self.incidents[inc.id] = inc
        data = dump(inc)
        if persist:
            await db.save_incident(data)
        await self.broadcast("incident.upsert", data)
        return inc

    async def resolve(self, inc: Incident, reason: str, by: str) -> Incident:
        inc.status = "resolved"
        inc.resolution = reason  # type: ignore[assignment]
        inc.resolved_at = now_iso()
        inc.resolved_by = by  # type: ignore[assignment]
        return await self.upsert_incident(inc)

    async def replace_source(self, source_id: str, fresh: list[Incident]) -> list[Incident]:
        """Ganti semua kejadian dari satu sumber resmi. Kembalikan kejadian yang benar-benar baru."""
        fresh_ids = {i.id for i in fresh}
        for old_id, old in list(self.incidents.items()):
            if old.source.id == source_id and old_id not in fresh_ids and old.status == "active":
                await self.resolve(old, "expired", "system")
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

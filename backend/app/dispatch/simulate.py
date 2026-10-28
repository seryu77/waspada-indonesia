import json
import logging

from .base import DispatchAdapter, DispatchResult

log = logging.getLogger("waspada.dispatch")


class SimulateAdapter(DispatchAdapter):
    """Mode demo: payload hanya dicatat ke log dan audit, tidak dikirim ke mana pun."""

    mode = "simulate"

    async def send(self, payload: dict) -> DispatchResult:
        log.info("[SIMULASI] payload dispatch 112:\n%s", json.dumps(payload, ensure_ascii=False, indent=2))
        return DispatchResult(ok=True, note="Terkirim ke command center (simulasi, tidak ada panggilan nyata)")

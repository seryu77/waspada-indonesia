import httpx

from ..config import settings
from .base import DispatchAdapter, DispatchResult


class WebhookAdapter(DispatchAdapter):
    """POST JSON ke endpoint command center pemda yang dikonfigurasi (DISPATCH_WEBHOOK_URL)."""

    mode = "webhook"

    async def send(self, payload: dict) -> DispatchResult:
        if not settings.dispatch_webhook_url:
            return DispatchResult(ok=False, note="DISPATCH_WEBHOOK_URL belum diatur")
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(settings.dispatch_webhook_url, json=payload, headers={"User-Agent": "WaspadaNusantara/0.1"})
            if r.is_success:
                return DispatchResult(ok=True, note=f"Diterima command center (HTTP {r.status_code})")
            return DispatchResult(ok=False, note=f"Command center menolak (HTTP {r.status_code})")
        except httpx.HTTPError as e:
            return DispatchResult(ok=False, note=f"Gagal menghubungi command center ({type(e).__name__})")

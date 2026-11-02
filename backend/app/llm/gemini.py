"""Klien Google Gemini (REST generateContent) untuk verifier.

Dipanggil langsung lewat httpx supaya tidak perlu SDK tambahan. Output dikunci ke skema JSON
yang sama dengan verifier Claude (responseSchema), frame dikirim sebagai inline_data JPEG.
"""

import base64

import httpx

from ..config import settings
from .schema import SYSTEM_PROMPT, VERIFICATION_SCHEMA

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# finishReason yang berarti model menolak atau diblokir filter keamanan
BLOCKED = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"}

_client: httpx.AsyncClient | None = None


class GeminiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class GeminiBlocked(Exception):
    """Model menolak, diblokir, atau output terpotong."""


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=60)
    return _client


def _schema() -> dict:
    # responseSchema memakai subset OpenAPI: tidak mendukung additionalProperties
    return {k: v for k, v in VERIFICATION_SCHEMA.items() if k != "additionalProperties"}


def _parts(frames: list[bytes], prompt: str) -> list[dict]:
    parts: list[dict] = []
    for i, jpg in enumerate(frames[:4]):
        parts.append({"text": f"Frame {i + 1} dari {min(len(frames), 4)} (berurutan):"})
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.standard_b64encode(jpg).decode()}})
    parts.append({"text": prompt})
    return parts


async def generate(model: str, frames: list[bytes], prompt: str, effort: str) -> tuple[str, str]:
    """Kembalikan (teks JSON, versi model yang melayani)."""
    config: dict = {
        "responseMimeType": "application/json",
        "responseSchema": _schema(),
        "maxOutputTokens": 8192,
        "temperature": 0.2,
    }
    # thinkingLevel hanya dikenal seri Gemini 3 ke atas; seri 2.x memakai default-nya sendiri
    if not model.startswith("gemini-2"):
        config["thinkingConfig"] = {"thinkingLevel": effort}
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": _parts(frames, prompt)}],
        "generationConfig": config,
    }
    r = await _http().post(
        API_URL.format(model=model),
        headers={"x-goog-api-key": settings.gemini_api_key},
        json=body,
    )
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", r.text)
        except ValueError:
            msg = r.text
        raise GeminiError(r.status_code, msg[:300])

    data = r.json()
    block = data.get("promptFeedback", {}).get("blockReason")
    if block:
        raise GeminiBlocked(f"Permintaan diblokir filter keamanan Gemini ({block}).")
    cands = data.get("candidates") or []
    if not cands:
        raise GeminiBlocked("Gemini tidak mengembalikan jawaban.")
    reason = cands[0].get("finishReason", "")
    if reason in BLOCKED:
        raise GeminiBlocked(f"Model menolak memproses permintaan (kategori: {reason}).")
    if reason == "MAX_TOKENS":
        raise GeminiBlocked("Output model terpotong.")
    parts = cands[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    return text, data.get("modelVersion") or model

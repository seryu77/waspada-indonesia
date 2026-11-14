"""Klien Qwen3-VL untuk verifier, lewat API chat yang kompatibel dengan OpenAI.

Bisa diarahkan ke server lokal (Ollama atau llama.cpp, misal http://localhost:11434/v1) atau ke
Hugging Face Inference Providers (https://router.huggingface.co/v1, butuh QWEN_API_KEY berisi token HF).
Frame dikirim sebagai gambar JPEG base64, output diminta dalam skema JSON verifikasi.
"""

import base64
import json
import re

import httpx

from ..config import settings
from .schema import SYSTEM_PROMPT, VERIFICATION_SCHEMA

_client: httpx.AsyncClient | None = None


class QwenError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class QwenBlocked(Exception):
    """Model menolak, tidak menjawab, atau output terpotong."""


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        # Model lokal di laptop bisa lambat saat pertama kali dimuat ke GPU
        _client = httpx.AsyncClient(timeout=settings.qwen_timeout_s)
    return _client


def _content(frames: list[bytes], prompt: str) -> list[dict]:
    parts: list[dict] = []
    for i, jpg in enumerate(frames[:4]):
        parts.append({"type": "text", "text": f"Frame {i + 1} dari {min(len(frames), 4)} (berurutan):"})
        url = "data:image/jpeg;base64," + base64.standard_b64encode(jpg).decode()
        parts.append({"type": "image_url", "image_url": {"url": url}})
    parts.append({"type": "text", "text": prompt})
    return parts


def extract_json(text: str) -> str:
    """Model kecil kadang membungkus JSON dengan ```json atau teks lain, ambil objeknya saja."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    m = re.search(r"\{.*\}", text, flags=re.S)
    return m.group(0) if m else text


async def generate(model: str, frames: list[bytes], prompt: str) -> tuple[str, str]:
    """Kembalikan (teks JSON, nama model yang melayani)."""
    system = f"{SYSTEM_PROMPT}\n\nJawab HANYA dengan satu objek JSON sesuai skema ini:\n{json.dumps(VERIFICATION_SCHEMA)}"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": _content(frames, prompt)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "verifikasi", "schema": VERIFICATION_SCHEMA, "strict": True},
        },
        "max_tokens": 1024,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {settings.qwen_api_key}"} if settings.qwen_api_key else {}
    r = await _http().post(settings.qwen_base_url.rstrip("/") + "/chat/completions", headers=headers, json=body)
    if r.status_code != 200:
        try:
            err = r.json().get("error", r.text)
            msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
        except ValueError:
            msg = r.text
        raise QwenError(r.status_code, msg[:300])

    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise QwenBlocked("Model tidak mengembalikan jawaban.")
    reason = choices[0].get("finish_reason") or ""
    if reason == "content_filter":
        raise QwenBlocked("Model menolak memproses permintaan (filter konten).")
    if reason == "length":
        raise QwenBlocked("Output model terpotong.")
    text = choices[0].get("message", {}).get("content") or ""
    return extract_json(text), data.get("model") or model

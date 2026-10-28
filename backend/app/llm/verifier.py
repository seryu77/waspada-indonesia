"""Verifikasi kandidat kejadian dengan Claude, cascade dua tahap.

Tahap 1 (TRIAGE_MODEL, default claude-haiku-5-5): filter cepat dan murah untuk semua kandidat.
Tahap 2 (VERIFY_MODEL, default claude-opus-5-5, effort low/medium): hanya untuk kandidat yang lolos
tahap 1 dengan severity tinggi/kritis, sebelum hitung mundur dispatch 112.

Refusal, output terpotong, dan error API tidak pernah membuang kejadian: hasilnya verdict "uncertain"
dengan needs_manual_review=True.
"""

import base64
import json
import logging

import anthropic

from ..config import settings
from ..models import Incident, Verification
from .heuristic import heuristic_verify
from .schema import OUTPUT_FORMAT, SYSTEM_PROMPT

log = logging.getLogger("waspada.llm")
MANUAL_AGENCY = "Operator command center"

_client: anthropic.AsyncAnthropic | None = None


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=60, max_retries=2)
    return _client


def _content(frames: list[bytes], context: str, stage: str) -> list[dict]:
    blocks: list[dict] = []
    for i, jpg in enumerate(frames[:4]):
        blocks.append({"type": "text", "text": f"Frame {i + 1} dari {min(len(frames), 4)} (berurutan):"})
        blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(jpg).decode()}})
    task = (
        "Tahap 1 (filter cepat): putuskan apakah kandidat ini layak diteruskan."
        if stage == "triage"
        else "Tahap 2 (verifikasi final sebelum dispatch 112): periksa dengan teliti, operator akan menerima hasilmu."
    )
    blocks.append({"type": "text", "text": f"{task}\n\nKonteks kandidat:\n{context}"})
    return blocks


def _manual(model: str, stage: str, inc: Incident, why: str) -> Verification:
    return Verification(
        verdict="uncertain",
        confidence=0.0,
        severity=inc.severity,
        reasoning=f"{why} Kejadian tetap ditampilkan dan butuh cek manual operator.",
        recommended_agency=MANUAL_AGENCY,
        model=model,
        stage=stage,  # type: ignore[arg-type]
        simulated=False,
        needs_manual_review=True,
    )


def _parse(resp, model: str, stage: str, inc: Incident) -> Verification:
    if resp.stop_reason == "refusal":
        cat = getattr(resp.stop_details, "category", None) if resp.stop_details else None
        return _manual(model, stage, inc, f"Model menolak memproses permintaan (kategori: {cat or 'tidak disebut'}).")
    if resp.stop_reason == "max_tokens":
        return _manual(model, stage, inc, "Output model terpotong.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return _manual(model, stage, inc, "Output model bukan JSON yang valid.")
    conf = max(0.0, min(1.0, float(data["confidence"])))
    served_by = getattr(resp, "model", None) or model
    return Verification(
        verdict=data["verdict"],
        confidence=round(conf, 2),
        severity=data["severity"],
        reasoning=data["reasoning"].strip(),
        recommended_agency=data["recommended_agency"].strip(),
        model=served_by,
        stage=stage,  # type: ignore[arg-type]
        simulated=False,
        needs_manual_review=data["verdict"] != "confirmed",
    )


async def _triage(inc: Incident, frames: list[bytes], context: str) -> Verification:
    model = settings.triage_model
    resp = await client().messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        output_config={"effort": "low", "format": OUTPUT_FORMAT},
        messages=[{"role": "user", "content": _content(frames, context, "triage")}],
    )
    return _parse(resp, model, "triage", inc)


async def _verify(inc: Incident, frames: list[bytes], context: str, triage: Verification) -> Verification:
    model = settings.verify_model
    ctx = f"{context}\n\nHasil tahap 1 ({triage.model}): {triage.verdict}, confidence {triage.confidence}, alasan: {triage.reasoning}"
    # fallbacks="default": kalau model menolak karena safety classifier, API menjalankan ulang
    # di model pengganti yang direkomendasikan (server-side). Kalau seluruh rantai menolak,
    # stop_reason tetap "refusal" dan ditangani di _parse.
    resp = await client().beta.messages.create(
        model=model,
        max_tokens=8192,
        system=SYSTEM_PROMPT,
        output_config={"effort": settings.verify_effort, "format": OUTPUT_FORMAT},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": _content(frames, ctx, "verify")}],
    )
    return _parse(resp, model, "verify", inc)


async def _safe(stage: str, model: str, inc: Incident, coro) -> Verification:
    try:
        return await coro
    except anthropic.AuthenticationError:
        log.error("ANTHROPIC_API_KEY tidak valid")
        return _manual(model, stage, inc, "Kunci API LLM tidak valid.")
    except anthropic.RateLimitError:
        return _manual(model, stage, inc, "Batas kuota API LLM tercapai.")
    except anthropic.BadRequestError as e:
        log.warning("LLM bad request: %s", e.message)
        return _manual(model, stage, inc, "Permintaan ke LLM ditolak (bad request).")
    except anthropic.APIStatusError as e:
        return _manual(model, stage, inc, f"Layanan LLM error ({e.status_code}).")
    except anthropic.APIConnectionError:
        return _manual(model, stage, inc, "Tidak bisa terhubung ke layanan LLM.")
    except Exception as e:  # jaga-jaga: kejadian tidak boleh hilang
        log.exception("verifikasi gagal")
        return _manual(model, stage, inc, f"Verifikasi gagal ({type(e).__name__}).")


async def verify_incident(inc: Incident, frames: list[bytes], context: str, nearby: int = 0) -> Verification:
    if not settings.llm_enabled:
        return heuristic_verify(inc, len(frames), nearby)
    t = await _safe("triage", settings.triage_model, inc, _triage(inc, frames, context))
    if t.recommended_agency == MANUAL_AGENCY:
        return t  # error/refusal di tahap 1, langsung ke operator
    if t.verdict == "false_alarm":
        return t
    if t.severity in ("high", "critical") or inc.severity in ("high", "critical"):
        return await _safe("verify", settings.verify_model, inc, _verify(inc, frames, context, t))
    return t

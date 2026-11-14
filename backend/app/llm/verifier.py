"""Verifikasi kandidat kejadian dengan LLM, cascade dua tahap.

Model: Qwen3-VL (open-weight, bisa jalan lokal lewat Ollama), lihat app/llm/qwen.py.
Tahap 1 (triage): filter cepat dan murah untuk semua kandidat.
Tahap 2 (verify): hanya untuk kandidat yang lolos tahap 1 dengan severity
tinggi/kritis, sebelum hitung mundur dispatch 112.

Refusal, output terpotong, dan error API tidak pernah membuang kejadian: hasilnya verdict "uncertain"
dengan needs_manual_review=True.
"""

import json
import logging

import httpx

from ..config import settings
from ..models import Incident, Verification
from . import qwen
from .heuristic import PERSISTENT_CAP, heuristic_verify

log = logging.getLogger("waspada.llm")
MANUAL_AGENCY = "Operator command center"


def _prompt(context: str, stage: str) -> str:
    task = (
        "Tahap 1 (filter cepat): putuskan apakah kandidat ini layak diteruskan."
        if stage == "triage"
        else "Tahap 2 (verifikasi final sebelum dispatch 112): periksa dengan teliti, operator akan menerima hasilmu."
    )
    return f"{task}\n\nKonteks kandidat:\n{context}"


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


def _from_json(text: str, served_by: str, model: str, stage: str, inc: Incident) -> Verification:
    try:
        data = json.loads(text)
        conf = max(0.0, min(1.0, float(data["confidence"])))
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
    except (ValueError, KeyError, TypeError):
        return _manual(model, stage, inc, "Output model bukan JSON yang valid.")


async def _qwen(inc: Incident, frames: list[bytes], context: str, stage: str, model: str) -> Verification:
    try:
        text, served_by = await qwen.generate(model, frames, _prompt(context, stage))
    except qwen.QwenBlocked as e:
        return _manual(model, stage, inc, str(e))
    return _from_json(text, served_by, model, stage, inc)


async def _triage(inc: Incident, frames: list[bytes], context: str) -> Verification:
    model = settings.active_triage_model
    return await _qwen(inc, frames, context, "triage", model)


async def _verify(inc: Incident, frames: list[bytes], context: str, triage: Verification) -> Verification:
    model = settings.active_verify_model
    ctx = f"{context}\n\nHasil tahap 1 ({triage.model}): {triage.verdict}, confidence {triage.confidence}, alasan: {triage.reasoning}"
    return await _qwen(inc, frames, ctx, "verify", model)


async def _safe(stage: str, model: str, inc: Incident, coro) -> Verification:
    try:
        return await coro
    except qwen.QwenError as e:
        log.warning("Qwen error %s: %s", e.status, e.message)
        if e.status == 429:
            return _manual(model, stage, inc, "Batas kuota API LLM tercapai.")
        if e.status in (401, 403) or "API key" in e.message:
            return _manual(model, stage, inc, "Kunci API LLM tidak valid.")
        if e.status == 404:
            return _manual(model, stage, inc, f"Model {model} tidak ditemukan.")
        if e.status == 400:
            return _manual(model, stage, inc, "Permintaan ke LLM ditolak (bad request).")
        return _manual(model, stage, inc, f"Layanan LLM error ({e.status}).")
    except httpx.TransportError:
        return _manual(model, stage, inc, "Tidak bisa terhubung ke layanan LLM.")
    except Exception as e:  # jaga-jaga: kejadian tidak boleh hilang
        log.exception("verifikasi gagal")
        return _manual(model, stage, inc, f"Verifikasi gagal ({type(e).__name__}).")


async def verify_incident(
    inc: Incident,
    frames: list[bytes],
    context: str,
    nearby: int = 0,
    conditions: dict | None = None,
    nearby_fire: int = 0,
    news: dict | None = None,
) -> Verification:
    if not settings.llm_enabled:
        return heuristic_verify(inc, len(frames), nearby, conditions, nearby_fire, news)
    return _cap_persistent(inc, await _llm_verify(inc, frames, context))


def _cap_persistent(inc: Incident, v: Verification) -> Verification:
    """Sumber panas tetap (kemungkinan flare/industri): confidence ditahan, apa pun kata model."""
    sat = inc.satellite
    if not sat or not sat.persistent_points or v.verdict == "false_alarm":
        return v
    if v.verdict == "uncertain" and v.confidence <= PERSISTENT_CAP:
        return v
    return v.model_copy(
        update={
            "verdict": "uncertain",
            "confidence": min(v.confidence, PERSISTENT_CAP),
            "needs_manual_review": True,
            "reasoning": f"{v.reasoning} Lokasi panas {sat.persistent_max_days} hari berbeda dalam 7 hari terakhir "
            f"(kemungkinan flare atau industri), confidence ditahan maksimal {round(PERSISTENT_CAP * 100)}%.",
        }
    )


async def _llm_verify(inc: Incident, frames: list[bytes], context: str) -> Verification:
    t = await _safe("triage", settings.active_triage_model, inc, _triage(inc, frames, context))
    if t.recommended_agency == MANUAL_AGENCY:
        return t  # error/refusal di tahap 1, langsung ke operator
    if t.verdict == "false_alarm":
        return t
    if t.severity in ("high", "critical") or inc.severity in ("high", "critical"):
        return await _safe("verify", settings.active_verify_model, inc, _verify(inc, frames, context, t))
    return t

"""Verifier heuristik saat ANTHROPIC_API_KEY tidak ada. Selalu berlabel "simulasi" di UI."""

import random

from ..models import Incident, Verification

AGENCY = {
    "fire": "Damkar + BPBD setempat",
    "flood": "BPBD + Basarnas",
    "crime": "Polres setempat",
    "earthquake": "BPBD + Basarnas",
    "landslide": "BPBD + Dinas PU",
    "accident": "Satlantas + Ambulans 119",
    "volcano": "BPBD + PVMBG",
}
BASE = {"official": 0.95, "satellite": 0.86, "cctv": 0.84, "simulator": 0.8, "citizen": 0.62, "demo": 0.55}


def heuristic_verify(inc: Incident, n_frames: int = 0, nearby: int = 0) -> Verification:
    # Simulator memakai jenis sumber aslinya (id "sim-cctv" -> cctv, dst.)
    origin = inc.source.id.removeprefix("sim-")
    kind = {"firms": "satellite", "bmkg": "official", "magma": "official", "petabencana": "citizen"}.get(origin, origin)
    conf = BASE.get(kind, BASE.get(inc.source.kind, 0.6)) + random.uniform(-0.03, 0.08)
    conf += min(0.1, 0.04 * nearby) + (0.03 if n_frames >= 2 else 0)
    conf = round(max(0.2, min(0.99, conf)), 2)
    verdict = "confirmed" if conf >= 0.7 else "uncertain" if conf >= 0.45 else "false_alarm"
    reasoning = {
        "confirmed": f"Deteksi konsisten dan cocok dengan sumber {inc.source.label}"
        + (f", ditambah {nearby} laporan terdekat" if nearby else "")
        + ". Heuristik menilai kejadian nyata.",
        "uncertain": "Bukti belum cukup jelas. Disarankan cek manual operator sebelum diteruskan.",
        "false_alarm": "Deteksi tidak konsisten antar frame, kemungkinan pantulan cahaya atau objek mirip.",
    }[verdict]
    return Verification(
        verdict=verdict,
        confidence=conf,
        severity=inc.severity,
        reasoning=reasoning,
        recommended_agency=AGENCY[inc.type],
        model="heuristik (simulasi)",
        stage="triage",
        simulated=True,
        needs_manual_review=verdict != "confirmed",
    )

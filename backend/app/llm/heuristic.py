"""Verifier heuristik saat API key LLM tidak ada. Selalu berlabel "simulasi" di UI."""

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


def heuristic_verify(
    inc: Incident, n_frames: int = 0, nearby: int = 0, conditions: dict | None = None, nearby_fire: int = 0, news: dict | None = None
) -> Verification:
    if inc.satellite is not None:
        return satellite_verify(inc, conditions or {}, nearby_fire, news)
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
    note = news_note(news)
    if note:
        reasoning += f" {note}"
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


# ---- Titik panas satelit (NASA FIRMS) ----
# Deterministik: kluster yang sama dengan kondisi yang sama selalu mendapat nilai yang sama.
SAT_BASE = 0.6
SAT_CONFIRM_MIN = 0.7
# Konfirmasi butuh bukti di luar satelit: udara berasap atau laporan kebakaran dari sumber lain
PM25_SMOKE = 35.5  # ug/m3, batas "tidak sehat untuk kelompok sensitif" US AQI
PM25_HEAVY = 55.5  # ug/m3, batas "tidak sehat"
CO_SMOKE = 800  # ug/m3, latar belakang di Indonesia umumnya 100 sampai 300
RAIN_MODERATE = 20  # mm per 24 jam
RAIN_HEAVY = 50
PERSISTENT_CAP = 0.5


def _num(x: float) -> str:
    return f"{x:.0f}" if float(x).is_integer() or abs(x) >= 10 else f"{x:.1f}".replace(".", ",")


def news_note(news: dict | None) -> str | None:
    """Satu kalimat hasil cek berita untuk reasoning heuristik."""
    from ..news import place_label

    if not news:
        return None
    if news["status"] == "outside":
        return f"Cek berita: lokasi di luar Indonesia ({news['place'].get('country')})."
    if news["status"] != "ok":
        return "Cek berita tidak bisa dilakukan."
    if news["items"]:
        top = news["items"][0]
        return f'Cek berita: {news["total"]} berita {news["max_age_days"]} hari terakhir di {place_label(news)}, misalnya "{top["title"]}".'
    return f"Cek berita: belum ada berita {news['max_age_days']} hari terakhir di {place_label(news)}."


def satellite_verify(inc: Incident, conditions: dict, nearby_fire: int = 0, news: dict | None = None) -> Verification:
    sat = inc.satellite
    assert sat is not None
    air = conditions.get("air") or {}
    weather = conditions.get("weather") or {}
    conf = SAT_BASE
    pro: list[str] = []
    con: list[str] = []

    extra_passes = max(0, sat.passes - 2)
    if extra_passes:
        conf += min(0.12, 0.04 * extra_passes)
    pro.append(f"{sat.passes} lintasan satelit")
    if len(sat.satellites) >= 2:
        conf += 0.05
        pro.append(f"{len(sat.satellites)} satelit berbeda ({', '.join(sat.satellites)})")
    share = sat.high_confidence_points / sat.points if sat.points else 0
    conf += round(0.08 * share, 3)
    if share >= 0.5:
        pro.append(f"{sat.high_confidence_points} dari {sat.points} deteksi berkeyakinan tinggi")
    elif sat.high_confidence_points == 0:
        con.append("tidak ada deteksi berkeyakinan tinggi")
    if sat.frp_total_mw >= 300:
        conf += 0.06
        pro.append(f"total FRP besar {_num(sat.frp_total_mw)} MW")
    elif sat.frp_total_mw >= 100:
        conf += 0.03
        pro.append(f"total FRP {_num(sat.frp_total_mw)} MW")

    corroborated = False
    pm25 = air.get("pm2_5")
    co = air.get("carbon_monoxide")
    if pm25 is not None and pm25 >= PM25_HEAVY:
        conf += 0.06
        corroborated = True
        pro.append(f"PM2.5 tinggi {_num(pm25)} ug/m3 (indikasi asap)")
    elif pm25 is not None and pm25 >= PM25_SMOKE:
        conf += 0.03
        corroborated = True
        pro.append(f"PM2.5 {_num(pm25)} ug/m3 (indikasi asap)")
    if co is not None and co >= CO_SMOKE:
        conf += 0.04
        corroborated = True
        pro.append(f"CO tinggi {_num(co)} ug/m3")
    if not air:
        con.append("data kualitas udara tidak tersedia")
    elif not corroborated:
        con.append("udara di titik ini belum menunjukkan indikasi asap")
    if nearby_fire:
        conf += min(0.1, 0.05 * nearby_fire)
        corroborated = True
        pro.append(f"{nearby_fire} laporan kebakaran lain dalam 15 km")

    if news and news["status"] == "ok" and news["items"]:
        conf += 0.08 if news["total"] >= 2 else 0.05
        corroborated = True
        top = news["items"][0]
        pro.append(f'{news["total"]} berita karhutla {news["max_age_days"]} hari terakhir di {news_place(news)}, misalnya "{top["title"]}" ({top["source"]})')
    elif news and news["status"] == "ok":
        con.append(f"belum ada berita karhutla {news['max_age_days']} hari terakhir di {news_place(news)}")
    elif news and news["status"] == "outside":
        con.append(f"lokasi di luar Indonesia ({news['place'].get('country')}), berita tidak dicek")

    rain = weather.get("rain_24h_mm")
    if rain is not None and rain >= RAIN_HEAVY:
        conf -= 0.1
        con.append(f"hujan deras 24 jam terakhir {_num(rain)} mm")
    elif rain is not None and rain >= RAIN_MODERATE:
        conf -= 0.05
        con.append(f"hujan 24 jam terakhir {_num(rain)} mm")

    conf = max(0.3, min(0.95, conf))
    if sat.persistent_points:
        conf = min(conf, PERSISTENT_CAP)
        verdict = "uncertain"
        con.insert(0, f"{sat.persistent_points} deteksi berada di lokasi yang panas {sat.persistent_max_days} hari berbeda dalam 7 hari terakhir")
        conclusion = (
            "Kemungkinan sumber panas tetap (flare gas atau industri), tetapi bisa juga kebakaran gambut yang bertahan lama. "
            f"Confidence ditahan maksimal {round(PERSISTENT_CAP * 100)}%, wajib cek operator."
        )
    elif conf >= SAT_CONFIRM_MIN and corroborated:
        verdict = "confirmed"
        conclusion = "Panas terdeteksi konsisten antar lintasan dan didukung bukti di luar satelit."
    else:
        verdict = "uncertain"
        conf = min(conf, SAT_CONFIRM_MIN - 0.01)
        conclusion = (
            "Panas terdeteksi konsisten antar lintasan, tetapi belum ada bukti di luar satelit (asap, laporan, atau berita), jadi belum terkonfirmasi."
            if conf >= 0.6
            else "Bukti belum cukup kuat. Disarankan cek manual operator."
        )
    if not sat.persistent_checked:
        con.append("riwayat 7 hari tidak tersedia, cek sumber panas tetap dilewati")

    reasoning = f"Pendukung: {'; '.join(pro)}."
    if con:
        reasoning += f" Penentang: {'; '.join(con)}."
    reasoning += f" {conclusion}"
    return Verification(
        verdict=verdict,
        confidence=round(conf, 2),
        severity=inc.severity,
        reasoning=reasoning,
        recommended_agency=AGENCY[inc.type],
        # Aturan tetap atas data nyata (bukan acak), jadi tidak berlabel simulasi
        model="heuristik satelit (tanpa LLM)",
        stage="triage",
        simulated=False,
        needs_manual_review=True,
    )


def news_place(news: dict) -> str:
    from ..news import place_label

    return place_label(news) or "wilayah ini"

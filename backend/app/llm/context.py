"""Merangkai konteks untuk verifier: lokasi, jam WIB, cuaca, kejadian dan laporan terdekat."""

import math
from datetime import datetime, timedelta, timezone

from ..models import Incident

WIB = timezone(timedelta(hours=7))


def haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


async def build_context(inc: Incident, others: list[Incident], radius_km: float = 15, cond: dict | None = None, news: dict | None = None) -> str:
    now = datetime.now(WIB)
    near = sorted(
        ((haversine_km(inc.lat, inc.lng, o.lat, o.lng), o) for o in others if o.id != inc.id and o.status == "active"),
        key=lambda t: t[0],
    )
    near = [(d, o) for d, o in near if d <= radius_km][:6]
    lines = [
        f"Jenis kandidat: {inc.type}",
        f"Judul: {inc.title}",
        f"Deskripsi: {inc.description}",
        f"Lokasi: {inc.address} ({inc.lat:.5f}, {inc.lng:.5f})",
        f"Waktu sekarang: {now:%d %b %Y %H:%M} WIB ({'malam' if now.hour < 5 or now.hour >= 19 else 'siang'})",
        f"Sumber: {inc.source.label} ({inc.source.kind})",
    ]
    sat = inc.satellite
    if sat:
        persist = (
            f"{sat.persistent_points} titik di lokasi yang panas {sat.persistent_max_days} hari berbeda dalam 7 hari (kemungkinan flare/industri)"
            if sat.persistent_points
            else "tidak ada titik di lokasi panas berulang 7 hari"
            if sat.persistent_checked
            else "riwayat 7 hari tidak tersedia"
        )
        lines.append(
            f"Data satelit (NASA FIRMS): {sat.points} titik dari {sat.passes} lintasan, satelit {', '.join(sat.satellites)}, "
            f"{sat.high_confidence_points} titik confidence tinggi, total FRP {sat.frp_total_mw:.0f} MW, "
            f"pertama {sat.first_seen[:16]} UTC, terakhir {sat.last_seen[:16]} UTC; {persist}"
        )
    from ..evidence import conditions, weather_line

    # Sumber yang sama dengan panel bukti operator, jadi angkanya identik
    w = weather_line(cond if cond is not None else await conditions(inc.lat, inc.lng))
    if w:
        lines.append(f"Kondisi lokasi saat ini (Open-Meteo): {w}")
    from ..news import news_line

    n = news_line(news)
    if n:
        lines.append(n)
    if near:
        lines.append(f"Kejadian/laporan dalam radius {radius_km:.0f} km:")
        for d, o in near:
            lines.append(f"- {d:.1f} km: {o.type}, {o.title} (sumber {o.source.label}, severity {o.severity})")
    else:
        lines.append(f"Tidak ada kejadian/laporan lain dalam radius {radius_km:.0f} km.")
    return "\n".join(lines)

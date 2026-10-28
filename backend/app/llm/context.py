"""Merangkai konteks untuk verifier: lokasi, jam WIB, cuaca, kejadian dan laporan terdekat."""

import math
from datetime import datetime, timedelta, timezone

import httpx

from ..models import Incident

WIB = timezone(timedelta(hours=7))
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
WMO = {0: "cerah", 1: "cerah berawan", 2: "berawan", 3: "mendung", 45: "kabut", 48: "kabut", 51: "gerimis", 61: "hujan ringan",
       63: "hujan sedang", 65: "hujan lebat", 80: "hujan lokal", 81: "hujan lokal sedang", 82: "hujan lokal lebat", 95: "badai petir"}


def haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


async def weather(lat: float, lng: float) -> str | None:
    """Cuaca saat ini dari Open-Meteo (gratis, tanpa key). None kalau gagal."""
    try:
        async with httpx.AsyncClient(timeout=4) as c:
            r = await c.get(WEATHER_URL, params={"latitude": lat, "longitude": lng, "current": "temperature_2m,precipitation,weather_code,wind_speed_10m"})
            cur = r.json()["current"]
        desc = WMO.get(cur.get("weather_code"), f"kode {cur.get('weather_code')}")
        return f"{desc}, {cur['temperature_2m']} C, hujan {cur['precipitation']} mm, angin {cur['wind_speed_10m']} km/j"
    except Exception:
        return None


async def build_context(inc: Incident, others: list[Incident], radius_km: float = 15) -> str:
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
    w = await weather(inc.lat, inc.lng)
    if w:
        lines.append(f"Cuaca saat ini: {w}")
    if near:
        lines.append(f"Kejadian/laporan dalam radius {radius_km:.0f} km:")
        for d, o in near:
            lines.append(f"- {d:.1f} km: {o.type}, {o.title} (sumber {o.source.label}, severity {o.severity})")
    else:
        lines.append(f"Tidak ada kejadian/laporan lain dalam radius {radius_km:.0f} km.")
    return "\n".join(lines)

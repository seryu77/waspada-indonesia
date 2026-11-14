"""Bukti pendukung untuk operator 112 dan konteks verifier AI.

Kondisi lokasi dari Open-Meteo (gratis, tanpa key): cuaca, kelembapan, angin, hujan 24 jam,
ketinggian, kualitas udara. Ditambah kejadian/laporan sekitar dan kamera CCTV terdekat.
Hasil disimpan sebentar supaya AI dan operator melihat angka yang sama.
"""

import asyncio
import time

import httpx

from .hub import hub
from .models import Incident, now_iso

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
CACHE_TTL_S = 300
NEARBY_KM = 15
CAMERA_KM = 5

WMO = {0: "cerah", 1: "cerah berawan", 2: "berawan", 3: "mendung", 45: "kabut", 48: "kabut", 51: "gerimis", 53: "gerimis",
       55: "gerimis lebat", 61: "hujan ringan", 63: "hujan sedang", 65: "hujan lebat", 80: "hujan lokal", 81: "hujan lokal sedang",
       82: "hujan lokal lebat", 95: "badai petir", 96: "badai petir + es", 99: "badai petir + es"}

_cache: dict[tuple[float, float], tuple[float, dict]] = {}


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    from .llm.context import haversine_km

    return haversine_km(a_lat, a_lng, b_lat, b_lng)


async def _weather(c: httpx.AsyncClient, lat: float, lng: float) -> dict | None:
    try:
        r = await c.get(
            FORECAST_URL,
            params={
                "latitude": lat,
                "longitude": lng,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,"
                "cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day",
                "hourly": "precipitation",
                "past_days": 1,
                "forecast_days": 1,
                "timezone": "Asia/Jakarta",
            },
        )
        d = r.json()
        cur = d["current"]
        # Hujan 24 jam terakhir: jumlah per jam sampai jam sekarang
        now = cur["time"][:13]
        hours = [(t, p) for t, p in zip(d["hourly"]["time"], d["hourly"]["precipitation"]) if t[:13] <= now]
        rain_24h = round(sum(p or 0 for _, p in hours[-24:]), 1)
        return {
            "observed_at": cur["time"],
            "description": WMO.get(cur.get("weather_code"), f"kode {cur.get('weather_code')}"),
            "weather_code": cur.get("weather_code"),
            "temperature_c": cur.get("temperature_2m"),
            "apparent_c": cur.get("apparent_temperature"),
            "humidity_pct": cur.get("relative_humidity_2m"),
            "precipitation_mm": cur.get("precipitation"),
            "rain_24h_mm": rain_24h,
            "cloud_cover_pct": cur.get("cloud_cover"),
            "wind_speed_kmh": cur.get("wind_speed_10m"),
            "wind_gust_kmh": cur.get("wind_gusts_10m"),
            "wind_direction_deg": cur.get("wind_direction_10m"),
            "is_day": bool(cur.get("is_day")),
            "elevation_m": d.get("elevation"),
        }
    except Exception:
        return None


async def _air(c: httpx.AsyncClient, lat: float, lng: float) -> dict | None:
    try:
        r = await c.get(AIR_URL, params={"latitude": lat, "longitude": lng, "current": "us_aqi,pm2_5,pm10,carbon_monoxide", "timezone": "Asia/Jakarta"})
        cur = r.json()["current"]
        return {
            "observed_at": cur["time"],
            "us_aqi": cur.get("us_aqi"),
            "pm2_5": cur.get("pm2_5"),
            "pm10": cur.get("pm10"),
            "carbon_monoxide": cur.get("carbon_monoxide"),
        }
    except Exception:
        return None


async def conditions(lat: float, lng: float) -> dict:
    """Cuaca + udara di titik ini. Gagal = field None, tidak pernah melempar error."""
    key = (round(lat, 2), round(lng, 2))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    async with httpx.AsyncClient(timeout=6) as c:
        w, a = await asyncio.gather(_weather(c, lat, lng), _air(c, lat, lng))
    data = {"weather": w, "air": a, "fetched_at": now_iso(), "provider": "Open-Meteo"}
    if w or a:
        _cache[key] = (time.time(), data)
    return data


def nearby(inc: Incident, radius_km: float = NEARBY_KM) -> list[dict]:
    out = []
    for o in hub.incidents.values():
        if o.id == inc.id or o.status != "active":
            continue
        d = _haversine_km(inc.lat, inc.lng, o.lat, o.lng)
        if d <= radius_km:
            out.append(
                {
                    "id": o.id,
                    "type": o.type,
                    "title": o.title,
                    "distance_km": round(d, 1),
                    "severity": o.effective_severity(),
                    "source_label": o.source.label,
                    "source_kind": o.source.kind,
                    "reported_at": o.reported_at,
                }
            )
    return sorted(out, key=lambda x: x["distance_km"])[:10]


def camera_for(inc: Incident) -> dict | None:
    """Kamera yang mendeteksi, atau kamera terdekat dalam radius CAMERA_KM."""
    cam = hub.cameras.get(inc.camera_id) if inc.camera_id else None
    detected = cam is not None
    if not cam:
        best = min(hub.cameras.values(), key=lambda c: _haversine_km(inc.lat, inc.lng, c.lat, c.lng), default=None)
        if best and _haversine_km(inc.lat, inc.lng, best.lat, best.lng) <= CAMERA_KM:
            cam = best
    if not cam:
        return None
    return {
        **cam.model_dump(),
        "distance_km": round(_haversine_km(inc.lat, inc.lng, cam.lat, cam.lng), 1),
        "detected_by": detected,
    }


async def gather(inc: Incident) -> dict:
    from .news import check_news

    cond, news = await asyncio.gather(conditions(inc.lat, inc.lng), check_news(inc))
    return {
        "incident_id": inc.id,
        "conditions": cond,
        "nearby": nearby(inc),
        "nearby_radius_km": NEARBY_KM,
        "camera": camera_for(inc),
        "news": news,
        "frames": inc.evidence or [],
        "detection": {"source": inc.source.label, "kind": inc.source.kind, "description": inc.description},
    }


def weather_line(cond: dict) -> str | None:
    """Ringkasan satu baris untuk konteks LLM."""
    w, a = cond.get("weather"), cond.get("air")
    if not w and not a:
        return None
    parts = []
    if w:
        parts.append(
            f"{w['description']}, suhu {w['temperature_c']} C (terasa {w['apparent_c']} C), kelembapan {w['humidity_pct']}%, "
            f"angin {w['wind_speed_kmh']} km/j (hembusan {w['wind_gust_kmh']} km/j), hujan sekarang {w['precipitation_mm']} mm, "
            f"hujan 24 jam {w['rain_24h_mm']} mm, ketinggian {w['elevation_m']} m"
        )
    if a:
        parts.append(f"kualitas udara US AQI {a['us_aqi']}, PM2.5 {a['pm2_5']} ug/m3, CO {a['carbon_monoxide']} ug/m3")
    return "; ".join(parts)

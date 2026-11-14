"""Cek berita: apakah media sudah memberitakan kejadian serupa di wilayah yang sama.

Nama wilayah (kabupaten/kota) dari Nominatim OpenStreetMap (gratis, maks 1 permintaan per detik),
berita dari Google News RSS (gratis, tanpa key). Hasil disaring ketat: judul atau ringkasan harus
memuat kata bencana DAN nama wilayah, dan terbit dalam beberapa hari terakhir. Gagal tidak pernah
menahan verifikasi.
"""

import asyncio
import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import httpx

from .models import Incident, now_iso

log = logging.getLogger("waspada.news")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NEWS_URL = "https://news.google.com/rss/search"
UA = "Awasana/0.1 (peta darurat, hackathon)"
NEWS_TTL_S = 30 * 60
PLACE_GRID = 0.05  # kira-kira 5 km, satu sel satu permintaan geocoding
MAX_AGE = timedelta(days=3)
MAX_ITEMS = 5

# Kata kunci per jenis bahaya. Titik panas satelit memakai kata kebakaran hutan/lahan.
KEYWORDS: dict[str, list[str]] = {
    "satellite": ["karhutla", "kebakaran hutan", "kebakaran lahan", "titik api", "titik panas", "hotspot", "kabut asap", "lahan terbakar", "hutan terbakar"],
    "fire": ["kebakaran", "terbakar", "karhutla", "titik api", "kobaran api"],
    "flood": ["banjir", "genangan", "air meluap", "tanggul jebol"],
    "earthquake": ["gempa"],
    "landslide": ["longsor"],
    "accident": ["kecelakaan", "tabrakan", "laka lantas"],
    "volcano": ["erupsi", "awan panas", "gunung api", "letusan", "abu vulkanik"],
    "crime": ["perampokan", "begal", "pencurian", "tawuran", "penjambretan", "pembunuhan"],
}

# Judul seperti ini membahas pencegahan atau kebijakan, bukan kejadian yang sedang berlangsung
NOT_EVENT = [
    "cegah", "pencegahan", "edukasi", "sosialisasi", "antisipasi", "imbau", "himbau", "mitigasi", "pelatihan",
    "simulasi", "apel ", "rakor", "seminar", "webinar", "akademisi", "kesiapsiagaan", "pemulihan", "anggaran",
    "tuntut", "evaluasi", "unjuk rasa", "diskusi", "regulasi", "kebijakan",
]

_place_cache: dict[tuple[int, int], dict | None] = {}
_news_cache: dict[str, tuple[float, dict]] = {}
_geo_lock = asyncio.Lock()
_last_geo = 0.0


def eligible(inc: Incident) -> bool:
    """Simulator dan data demo tidak dicek beritanya (perilaku demo tetap sama)."""
    return not inc.source.id.startswith("sim-") and inc.source.kind not in ("demo", "simulator")


async def place_for(lat: float, lng: float) -> dict | None:
    """Kabupaten/kota, provinsi, dan negara untuk koordinat ini."""
    global _last_geo
    key = (round(lat / PLACE_GRID), round(lng / PLACE_GRID))
    if key in _place_cache:
        return _place_cache[key]
    async with _geo_lock:
        if key in _place_cache:
            return _place_cache[key]
        wait = 1.1 - (time.monotonic() - _last_geo)  # kebijakan Nominatim: maks 1 per detik
        if wait > 0:
            await asyncio.sleep(wait)
        _last_geo = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=8, headers={"User-Agent": UA}) as c:
                r = await c.get(NOMINATIM_URL, params={"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 10, "accept-language": "id"})
                addr = r.json().get("address") or {}
        except Exception as e:
            log.warning("geocoding gagal: %s", e)
            return None  # tidak di-cache, dicoba lagi nanti
        district = addr.get("county") or addr.get("city") or addr.get("municipality") or addr.get("town") or addr.get("state_district")
        place = (
            {"district": district, "state": addr.get("state"), "country": addr.get("country"), "country_code": addr.get("country_code")}
            if district or addr.get("state") or addr.get("country")
            else None
        )
        _place_cache[key] = place
        return place


def _core_name(district: str) -> str:
    """'Kabupaten Bangka Selatan' -> 'Bangka Selatan', supaya cocok dengan cara media menulis."""
    return re.sub(r"^(Kabupaten|Kab\.|Kota Administrasi|Kota)\s+", "", district.strip(), flags=re.I)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(text or ""))).strip()


async def _search(query: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=8, headers={"User-Agent": UA}, follow_redirects=True) as c:
        r = await c.get(NEWS_URL, params={"q": query, "hl": "id", "gl": "ID", "ceid": "ID:id"})
        r.raise_for_status()
    root = ET.fromstring(r.text)
    out = []
    for it in root.iter("item"):
        try:
            published = parsedate_to_datetime(it.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "title": _clean(it.findtext("title") or ""),
                "summary": _clean(it.findtext("description") or ""),
                "source": _clean(it.findtext("source") or ""),
                "url": it.findtext("link") or "",
                "published_at": published.astimezone(timezone.utc).isoformat(),
            }
        )
    return out


def _result(status: str, place: dict | None = None, **extra) -> dict:
    return {"status": status, "place": place, "items": [], "total": 0, "max_age_days": MAX_AGE.days, "checked_at": now_iso(), "provider": "Google News", **extra}


async def check_news(inc: Incident) -> dict | None:
    """Berita yang cocok dengan jenis bahaya dan wilayah kejadian. None = tidak dicek (simulator/demo)."""
    if not eligible(inc):
        return None
    place = await place_for(inc.lat, inc.lng)
    if place and place.get("country_code") not in (None, "id"):
        return _result("outside", place)
    if not place or not place.get("district"):
        return _result("no_place", place)

    name = _core_name(place["district"])
    words = KEYWORDS["satellite" if inc.satellite else inc.type]
    terms = " OR ".join(f'"{w}"' if " " in w else w for w in words)
    query = f'({terms}) "{name}" when:{MAX_AGE.days}d'
    hit = _news_cache.get(query)
    if hit and time.time() - hit[0] < NEWS_TTL_S:
        return hit[1]
    try:
        items = await _search(query)
    except Exception as e:
        log.warning("cek berita gagal (%s): %s", name, e)
        return _result("error", place)

    now = datetime.now(timezone.utc)
    lname = name.lower()
    matched = []
    for it in items:
        text = f"{it['title']} {it['summary']}".lower()
        fresh = now - datetime.fromisoformat(it["published_at"]) <= MAX_AGE
        title = it["title"].lower()
        if fresh and lname in text and any(w in text for w in words) and not any(x in title for x in NOT_EVENT):
            matched.append({k: v for k, v in it.items() if k != "summary"})
    matched.sort(key=lambda x: x["published_at"], reverse=True)
    result = _result("ok", place, query=query, keywords=words, items=matched[:MAX_ITEMS], total=len(matched))
    _news_cache[query] = (time.time(), result)
    return result


def place_label(news: dict | None) -> str:
    place = (news or {}).get("place") or {}
    return ", ".join(x for x in (place.get("district"), place.get("state")) if x)


def news_line(news: dict | None) -> str | None:
    """Ringkasan satu baris untuk konteks LLM."""
    if not news:
        return None
    if news["status"] == "outside":
        return f"Cek berita: lokasi di luar Indonesia ({news['place'].get('country')}), tidak dicek."
    if news["status"] != "ok":
        return "Cek berita: tidak bisa dilakukan (wilayah tidak dikenali atau layanan berita gagal)."
    where = place_label(news)
    if not news["items"]:
        return f"Cek berita: tidak ada berita {news['max_age_days']} hari terakhir tentang kejadian serupa di {where}."
    titles = "; ".join(f'"{i["title"]}" ({i["source"]})' for i in news["items"][:3])
    return f"Cek berita: {news['total']} berita {news['max_age_days']} hari terakhir di {where}: {titles}"

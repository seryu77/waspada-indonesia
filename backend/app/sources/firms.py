"""Titik panas satelit NASA FIRMS, wilayah Indonesia. Butuh MAP_KEY gratis.

Data diambil dari semua satelit yang melintas (VIIRS SNPP, NOAA-20, NOAA-21, dan MODIS) supaya
pembaruan lebih sering. Hasilnya dua: kluster sebagai kejadian di peta, dan titik mentah untuk heatmap.

Supaya pinpoint kejadian tidak hanya bergantung pada satu titik panas mentah:
- Kluster baru jadi kejadian kalau terdeteksi minimal MIN_PASSES lintasan berbeda (pasangan satelit +
  waktu akuisisi). Kluster satu lintasan cukup tampil di heatmap.
- Sel kira-kira 500 m yang panas di >= PERSISTENT_DAYS hari berbeda dalam 7 hari terakhir ditandai
  kemungkinan sumber panas tetap (flare gas, cerobong industri). Tidak dibuang, karena kebakaran gambut
  juga bisa bertahan berhari-hari: verifier yang menahan confidence-nya.
"""

import asyncio
import csv
import io
import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from ..config import settings
from ..models import Incident, SatelliteInfo, Source
from .base import DataSource, SourceResult

log = logging.getLogger("waspada.firms")

BBOX = "94.0,-11.8,141.8,6.8"  # west,south,east,north
URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{sat}/{bbox}/{days}"
SATELLITES = {
    "VIIRS_SNPP_NRT": "VIIRS S-NPP",
    "VIIRS_NOAA20_NRT": "VIIRS NOAA-20",
    "VIIRS_NOAA21_NRT": "VIIRS NOAA-21",
    "MODIS_NRT": "MODIS",
}
DAYS = 2  # heatmap memudar dalam 48 jam
MAX_AGE = timedelta(hours=48)
CLUSTER_AGE = timedelta(hours=24)  # kejadian di peta hanya dari 24 jam terakhir
GRID = 0.1  # derajat, kira-kira 11 km, untuk kluster kejadian
HEAT_GRID = 0.01  # kira-kira 1 km, titik dari satelit berbeda di sel yang sama digabung
MAX_CLUSTERS = 40
# Kandidat yang diberi nama wilayah sebelum disaring negara (area bbox ikut mencakup Australia
# utara dan Timor Leste); sisanya dipotong ke MAX_CLUSTERS
MAX_CANDIDATES = 60
MAX_HEAT_POINTS = 4000
MIN_PASSES = 2  # kluster jadi kejadian kalau terlihat minimal dari 2 lintasan berbeda

# Sumber panas tetap: riwayat 7 hari dari satu satelit VIIRS (yang pertama berhasil)
PERSIST_SATELLITES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]
PERSIST_HISTORY_DAYS = 7
PERSIST_GRID = 0.005  # kira-kira 500 m
PERSISTENT_DAYS = 5  # panas di >= 5 hari berbeda = kemungkinan flare/industri
PERSIST_TTL_S = 6 * 3600
PERSIST_RETRY_S = 30 * 60  # kalau gagal, coba lagi setelah 30 menit (filter dilewati sementara)


@dataclass(frozen=True)
class Point:
    lat: float
    lng: float
    frp: float
    at: datetime
    sat: str
    high: bool  # confidence tinggi (VIIRS "h", MODIS >= 80)


def _low_confidence(raw: str) -> bool:
    raw = (raw or "").strip().lower()
    if raw.isdigit():  # MODIS: 0-100
        return int(raw) < 30
    return raw in ("l", "low")  # VIIRS: l / n / h


def _high_confidence(raw: str) -> bool:
    raw = (raw or "").strip().lower()
    if raw.isdigit():
        return int(raw) >= 80
    return raw in ("h", "high")


def _acq_time(r: dict) -> datetime:
    t = r["acq_time"].zfill(4)
    return datetime.fromisoformat(f"{r['acq_date']}T{t[:2]}:{t[2:]}:00+00:00")


def _short(area: str) -> str:
    """'Kabupaten Bombana' -> 'Bombana' supaya judul ringkas."""
    for prefix in ("Kabupaten ", "Kota Administrasi "):
        if area.startswith(prefix):
            return area[len(prefix):]
    return area


def _cell(lat: float, lng: float) -> tuple[int, int]:
    return round(lat / PERSIST_GRID), round(lng / PERSIST_GRID)


class FIRMSSource(DataSource):
    id = "firms"
    label = "NASA FIRMS"
    interval_s = 600

    def __init__(self) -> None:
        # Sel 500 m -> tanggal-tanggal terdeteksi panas, dari riwayat 7 hari
        self._persist: dict[tuple[int, int], set[str]] | None = None
        self._persist_at = 0.0
        self._persist_failed_at = 0.0

    def enabled(self) -> bool:
        return bool(settings.nasa_firms_map_key)

    async def _get_csv(self, client: httpx.AsyncClient, sat: str, days: str) -> list[dict]:
        url = URL.format(key=settings.nasa_firms_map_key, sat=sat, bbox=BBOX, days=days)
        res = await client.get(url, timeout=60)
        res.raise_for_status()
        if not res.text.lstrip().startswith("latitude"):
            # FIRMS membalas teks biasa (bukan CSV) kalau key salah atau kuota habis
            raise ValueError(res.text.strip()[:120])
        return list(csv.DictReader(io.StringIO(res.text)))

    async def _fetch_one(self, client: httpx.AsyncClient, sat: str) -> list[dict]:
        rows = await self._get_csv(client, sat, str(DAYS))
        for r in rows:
            r["_sat"] = SATELLITES[sat]
        return rows

    async def _persistent_cells(self, client: httpx.AsyncClient) -> dict[tuple[int, int], set[str]] | None:
        """Riwayat 7 hari per sel 500 m, di-cache 6 jam. None = belum tersedia (filter dilewati)."""
        now = time.time()
        if self._persist is not None and now - self._persist_at < PERSIST_TTL_S:
            return self._persist
        if now - self._persist_failed_at < PERSIST_RETRY_S:
            return self._persist  # data lama (kalau ada) tetap dipakai sampai waktu coba ulang
        # Area API membatasi rentang 1..5 hari, jadi 7 hari diambil dua kali dengan tanggal awal
        today = datetime.now(timezone.utc).date()
        first = today - timedelta(days=PERSIST_HISTORY_DAYS - 1)
        spans = [f"5/{first.isoformat()}", f"{PERSIST_HISTORY_DAYS - 5}/{(first + timedelta(days=5)).isoformat()}"]
        for sat in PERSIST_SATELLITES:
            try:
                parts = await asyncio.gather(*(self._get_csv(client, sat, s) for s in spans))
            except Exception as e:
                log.warning("riwayat FIRMS %s gagal: %s", sat, e)
                continue
            rows = [r for part in parts for r in part]
            if not rows:
                continue  # satelit ini sedang tidak mengirim data, coba berikutnya
            cells: dict[tuple[int, int], set[str]] = defaultdict(set)
            for r in rows:
                if _low_confidence(r.get("confidence", "")):
                    continue
                try:
                    cells[_cell(float(r["latitude"]), float(r["longitude"]))].add(r["acq_date"])
                except (KeyError, ValueError):
                    continue
            self._persist, self._persist_at = dict(cells), now
            fixed = sum(1 for d in cells.values() if len(d) >= PERSISTENT_DAYS)
            log.info("riwayat FIRMS %s: %d baris, %d sel, %d sel panas >= %d hari", sat, len(rows), len(cells), fixed, PERSISTENT_DAYS)
            return self._persist
        self._persist_failed_at = now
        log.warning("riwayat 7 hari FIRMS tidak tersedia, filter sumber panas tetap dilewati")
        return self._persist

    @staticmethod
    def _persistent_days(cells: dict[tuple[int, int], set[str]], lat: float, lng: float) -> int:
        """Jumlah hari berbeda panas di sel ini dan 8 tetangganya (posisi piksel bergeser antar lintasan)."""
        cy, cx = _cell(lat, lng)
        days: set[str] = set()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                days |= cells.get((cy + dy, cx + dx), set())
        return len(days)

    async def fetch(self, client: httpx.AsyncClient) -> SourceResult:
        results = await asyncio.gather(*(self._fetch_one(client, s) for s in SATELLITES), return_exceptions=True)
        rows: list[dict] = []
        ok: list[str] = []
        for sat, res in zip(SATELLITES, results):
            if isinstance(res, BaseException):
                log.warning("FIRMS %s gagal: %s", sat, res)
            else:
                rows += res
                ok.append(SATELLITES[sat])
        if not ok:
            raise RuntimeError("semua satelit FIRMS gagal diambil")

        now = datetime.now(timezone.utc)
        points: list[Point] = []
        for r in rows:
            conf = r.get("confidence", "")
            if _low_confidence(conf):
                continue
            try:
                at = _acq_time(r)
                points.append(Point(float(r["latitude"]), float(r["longitude"]), float(r.get("frp") or 0), at, r["_sat"], _high_confidence(conf)))
            except (KeyError, ValueError):
                continue
        points = [p for p in points if now - p.at <= MAX_AGE]

        persist = await self._persistent_cells(client)
        candidates = self._clusters([p for p in points if now - p.at <= CLUSTER_AGE], persist)
        # Hanya wilayah Indonesia yang jadi kejadian; heatmap tetap menampilkan semua titik
        incidents = [inc for inc in candidates if await self._name(inc)][:MAX_CLUSTERS]
        if len(incidents) < len(candidates):
            log.info("FIRMS: %d kandidat, %d di Indonesia dipakai", len(candidates), len(incidents))
        return SourceResult(
            incidents=incidents,
            replace=True,
            needs_verification=True,
            hotspots=self._heat(points),
            hotspot_meta={
                "mode": "live",
                "satellites": ok,
                "count": len(points),
                "latest_at": max((p.at for p in points), default=now).isoformat(),
            },
        )

    @staticmethod
    async def _name(inc: Incident) -> bool:
        """Judul dan alamat dengan nama wilayah (cache per sel ~5 km, Nominatim maks 1 per detik).

        False = lokasi di luar Indonesia (dibuang). Lokasi tanpa nama (laut, atau geocoding gagal) tetap dipakai.
        """
        from ..news import place_for

        place = await place_for(inc.lat, inc.lng)
        if not place:
            return True
        if place.get("country_code") not in (None, "id"):
            return False
        area = place.get("district") or place.get("state")
        if not area:
            return True
        parts = [place.get("district"), place.get("state")]
        inc.title = f"Indikasi kebakaran di {_short(area)}"
        inc.address = ", ".join(p for p in dict.fromkeys(parts) if p)
        return True

    @staticmethod
    def _heat(points: list[Point]) -> list[list[float]]:
        """Titik untuk heatmap: [lat, lng, frp MW, waktu deteksi dalam detik epoch]."""
        cells: dict[tuple[int, int], list] = {}
        for p in points:
            key = (round(p.lat / HEAT_GRID), round(p.lng / HEAT_GRID))
            c = cells.get(key)
            if c is None:
                cells[key] = [p.lat, p.lng, p.frp, p.at.timestamp()]
            else:
                c[2] += p.frp
                c[3] = max(c[3], p.at.timestamp())
        out = sorted(cells.values(), key=lambda c: -c[3])[:MAX_HEAT_POINTS]
        return [[round(c[0], 4), round(c[1], 4), round(c[2], 1), int(c[3])] for c in out]

    def _clusters(self, points: list[Point], persist: dict[tuple[int, int], set[str]] | None = None) -> list[Incident]:
        # Kelompokkan titik panas per sel grid supaya peta tidak penuh ribuan marker
        cells: dict[tuple[int, int], list[Point]] = defaultdict(list)
        for p in points:
            cells[(round(p.lat / GRID), round(p.lng / GRID))].append(p)
        # Wajib konfirmasi: minimal 2 lintasan berbeda (satelit + waktu akuisisi)
        confirmed = {k: pts for k, pts in cells.items() if len({(p.sat, p.at) for p in pts}) >= MIN_PASSES}
        clusters = sorted(confirmed.items(), key=lambda kv: -sum(p.frp for p in kv[1]))[:MAX_CANDIDATES]
        log.info("FIRMS: %d kluster, %d lolos minimal %d lintasan", len(cells), len(confirmed), MIN_PASSES)
        out = []
        for (gy, gx), pts in clusters:
            n = len(pts)
            frp = sum(p.frp for p in pts)
            lat = sum(p.lat for p in pts) / n
            lng = sum(p.lng for p in pts) / n
            sev = "critical" if n >= 10 or frp > 300 else "high" if n >= 4 or frp > 80 else "medium"
            first, last = min(p.at for p in pts), max(p.at for p in pts)
            sat_list = sorted({p.sat for p in pts})
            passes = len({(p.sat, p.at) for p in pts})
            fixed = [self._persistent_days(persist, p.lat, p.lng) for p in pts] if persist is not None else []
            info = SatelliteInfo(
                points=n,
                passes=passes,
                satellites=sat_list,
                frp_total_mw=round(frp, 1),
                high_confidence_points=sum(1 for p in pts if p.high),
                persistent_points=sum(1 for d in fixed if d >= PERSISTENT_DAYS),
                persistent_max_days=max(fixed, default=0),
                persistent_checked=persist is not None,
                first_seen=first.isoformat(),
                last_seen=last.isoformat(),
            )
            out.append(
                Incident(
                    id=f"firms-{gy}-{gx}",
                    type="fire",
                    title="Indikasi kebakaran (pantauan satelit)",
                    description=f"Satelit NASA mendeteksi panas {n} kali dari {passes} lintasan dalam 24 jam terakhir, total FRP {frp:.0f} MW ({', '.join(sat_list)}).",
                    lat=lat,
                    lng=lng,
                    address=f"Sekitar {lat:.3f}, {lng:.3f}",
                    severity=sev,
                    source=Source(id="firms", label="NASA FIRMS", kind="satellite"),
                    reported_at=last.isoformat(),
                    satellite=info,
                )
            )
        return out

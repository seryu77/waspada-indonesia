"""Titik panas satelit NASA FIRMS, wilayah Indonesia. Butuh MAP_KEY gratis.

Data diambil dari semua satelit yang melintas (VIIRS SNPP, NOAA-20, NOAA-21, dan MODIS) supaya
pembaruan lebih sering. Hasilnya dua: kluster sebagai kejadian di peta, dan titik mentah untuk heatmap.
"""

import asyncio
import csv
import io
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx

from ..config import settings
from ..models import Incident, Source
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
MAX_HEAT_POINTS = 4000


def _low_confidence(raw: str) -> bool:
    raw = (raw or "").strip().lower()
    if raw.isdigit():  # MODIS: 0-100
        return int(raw) < 30
    return raw in ("l", "low")  # VIIRS: l / n / h


def _acq_time(r: dict) -> datetime:
    t = r["acq_time"].zfill(4)
    return datetime.fromisoformat(f"{r['acq_date']}T{t[:2]}:{t[2:]}:00+00:00")


class FIRMSSource(DataSource):
    id = "firms"
    label = "NASA FIRMS"
    interval_s = 600

    def enabled(self) -> bool:
        return bool(settings.nasa_firms_map_key)

    async def _fetch_one(self, client: httpx.AsyncClient, sat: str) -> list[dict]:
        url = URL.format(key=settings.nasa_firms_map_key, sat=sat, bbox=BBOX, days=DAYS)
        res = await client.get(url, timeout=60)
        res.raise_for_status()
        if not res.text.lstrip().startswith("latitude"):
            # FIRMS membalas teks biasa (bukan CSV) kalau key salah atau kuota habis
            raise ValueError(res.text.strip()[:120])
        rows = list(csv.DictReader(io.StringIO(res.text)))
        for r in rows:
            r["_sat"] = SATELLITES[sat]
        return rows

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
        points: list[tuple[float, float, float, datetime, str]] = []
        for r in rows:
            if _low_confidence(r.get("confidence", "")):
                continue
            try:
                at = _acq_time(r)
                points.append((float(r["latitude"]), float(r["longitude"]), float(r.get("frp") or 0), at, r["_sat"]))
            except (KeyError, ValueError):
                continue
        points = [p for p in points if now - p[3] <= MAX_AGE]

        return SourceResult(
            incidents=self._clusters([p for p in points if now - p[3] <= CLUSTER_AGE]),
            replace=True,
            hotspots=self._heat(points),
            hotspot_meta={
                "mode": "live",
                "satellites": ok,
                "count": len(points),
                "latest_at": max((p[3] for p in points), default=now).isoformat(),
            },
        )

    @staticmethod
    def _heat(points: list[tuple[float, float, float, datetime, str]]) -> list[list[float]]:
        """Titik untuk heatmap: [lat, lng, frp MW, waktu deteksi dalam detik epoch]."""
        cells: dict[tuple[int, int], list] = {}
        for lat, lng, frp, at, _ in points:
            key = (round(lat / HEAT_GRID), round(lng / HEAT_GRID))
            c = cells.get(key)
            if c is None:
                cells[key] = [lat, lng, frp, at.timestamp()]
            else:
                c[2] += frp
                c[3] = max(c[3], at.timestamp())
        out = sorted(cells.values(), key=lambda c: -c[3])[:MAX_HEAT_POINTS]
        return [[round(c[0], 4), round(c[1], 4), round(c[2], 1), int(c[3])] for c in out]

    @staticmethod
    def _clusters(points: list[tuple[float, float, float, datetime, str]]) -> list[Incident]:
        # Kelompokkan titik panas per sel grid supaya peta tidak penuh ribuan marker
        cells: dict[tuple[int, int], list] = defaultdict(list)
        for p in points:
            cells[(round(p[0] / GRID), round(p[1] / GRID))].append(p)
        clusters = sorted(cells.items(), key=lambda kv: -sum(p[2] for p in kv[1]))[:MAX_CLUSTERS]
        out = []
        for (gy, gx), pts in clusters:
            n = len(pts)
            frp = sum(p[2] for p in pts)
            lat = sum(p[0] for p in pts) / n
            lng = sum(p[1] for p in pts) / n
            sev = "critical" if n >= 10 or frp > 300 else "high" if n >= 4 or frp > 80 else "medium"
            last = max(p[3] for p in pts)
            sats = ", ".join(sorted({p[4] for p in pts}))
            out.append(
                Incident(
                    id=f"firms-{gy}-{gx}",
                    type="fire",
                    title=f"{n} titik panas satelit",
                    description=f"Kluster {n} hotspot dengan total FRP {frp:.0f} MW dalam 24 jam terakhir ({sats}).",
                    lat=lat,
                    lng=lng,
                    address=f"Sekitar {lat:.3f}, {lng:.3f}",
                    severity=sev,
                    source=Source(id="firms", label="NASA FIRMS", kind="satellite"),
                    reported_at=last.isoformat(),
                )
            )
        return out

"""Titik panas satelit NASA FIRMS (VIIRS), wilayah Indonesia. Butuh MAP_KEY gratis."""

import csv
import io
from collections import defaultdict

import httpx

from ..config import settings
from ..models import Incident, Source
from .base import DataSource, SourceResult

BBOX = "94.0,-11.8,141.8,6.8"  # west,south,east,north
URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{bbox}/1"
GRID = 0.1  # derajat, kira-kira 11 km
MAX_CLUSTERS = 40


class FIRMSSource(DataSource):
    id = "firms"
    label = "NASA FIRMS"
    interval_s = 900

    def enabled(self) -> bool:
        return bool(settings.nasa_firms_map_key)

    async def fetch(self, client: httpx.AsyncClient) -> SourceResult:
        res = await client.get(URL.format(key=settings.nasa_firms_map_key, bbox=BBOX), timeout=60)
        res.raise_for_status()
        rows = list(csv.DictReader(io.StringIO(res.text)))
        # Kelompokkan titik panas per sel grid supaya peta tidak penuh ribuan titik
        cells: dict[tuple[int, int], list[dict]] = defaultdict(list)
        for r in rows:
            if r.get("confidence", "n") == "l":
                continue
            lat, lng = float(r["latitude"]), float(r["longitude"])
            cells[(round(lat / GRID), round(lng / GRID))].append(r)
        clusters = sorted(cells.items(), key=lambda kv: -sum(float(x.get("frp") or 0) for x in kv[1]))[:MAX_CLUSTERS]
        out = []
        for (gy, gx), pts in clusters:
            n = len(pts)
            frp = sum(float(p.get("frp") or 0) for p in pts)
            lat = sum(float(p["latitude"]) for p in pts) / n
            lng = sum(float(p["longitude"]) for p in pts) / n
            sev = "critical" if n >= 10 or frp > 300 else "high" if n >= 4 or frp > 80 else "medium"
            last = max(pts, key=lambda p: (p["acq_date"], p["acq_time"]))
            t = last["acq_time"].zfill(4)
            out.append(
                Incident(
                    id=f"firms-{gy}-{gx}",
                    type="fire",
                    title=f"{n} titik panas satelit",
                    description=f"Kluster {n} hotspot VIIRS dengan total FRP {frp:.0f} MW dalam 24 jam terakhir.",
                    lat=lat,
                    lng=lng,
                    address=f"Sekitar {lat:.3f}, {lng:.3f}",
                    severity=sev,
                    source=Source(id="firms", label="NASA FIRMS (VIIRS)", kind="satellite"),
                    reported_at=f"{last['acq_date']}T{t[:2]}:{t[2:]}:00+00:00",
                )
            )
        return SourceResult(incidents=out, replace=True)

"""Laporan warga dari PetaBencana.id (banjir, kebakaran, asap, dll)."""

import httpx

from ..config import settings
from ..models import Incident, Source
from .base import DataSource, SourceResult

URL = "https://data.petabencana.id/reports?geoformat=geojson&timeperiod=86400"
TYPE_MAP = {"flood": "flood", "fire": "fire", "haze": "fire", "volcano": "volcano", "earthquake": "earthquake"}
TITLE = {"flood": "Laporan banjir", "fire": "Laporan kebakaran", "haze": "Laporan asap", "volcano": "Laporan gunung api", "earthquake": "Laporan gempa"}


class PetaBencanaSource(DataSource):
    id = "petabencana"
    label = "PetaBencana.id"
    interval_s = 300

    def enabled(self) -> bool:
        return settings.enable_petabencana

    async def fetch(self, client: httpx.AsyncClient) -> SourceResult:
        data = (await client.get(URL)).json()
        out = []
        for f in data.get("result", {}).get("features", [])[:50]:
            p = f.get("properties", {})
            dt = p.get("disaster_type")
            if dt not in TYPE_MAP:
                continue
            lng, lat = f["geometry"]["coordinates"][:2]
            rd = p.get("report_data") or {}
            depth = rd.get("flood_depth")
            sev = "high" if depth and depth >= 70 else "medium"
            desc = (p.get("text") or "").strip() or TITLE[dt]
            if depth:
                desc += f" (kedalaman sekitar {depth} cm)"
            out.append(
                Incident(
                    id=f"pb-{p.get('pkey')}",
                    type=TYPE_MAP[dt],
                    title=TITLE[dt],
                    description=desc[:400],
                    lat=float(lat),
                    lng=float(lng),
                    address=(p.get("tags") or {}).get("instance_region_code") or f"{lat:.4f}, {lng:.4f}",
                    severity=sev,
                    source=Source(id="petabencana", label="PetaBencana.id (laporan warga)", kind="citizen"),
                    reported_at=p.get("created_at"),
                    evidence=[p["image_url"]] if p.get("image_url") else None,
                )
            )
        return SourceResult(incidents=out, needs_verification=True)

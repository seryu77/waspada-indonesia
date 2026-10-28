"""Gempa dari BMKG open data (TEWS). Gratis tanpa key."""

from datetime import datetime, timedelta, timezone

import httpx

from ..config import settings
from ..models import Incident, Source
from .base import DataSource, SourceResult, severity_from_magnitude

AUTO = "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json"
TERKINI = "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"
MAX_AGE = timedelta(hours=72)


def _to_incident(g: dict) -> Incident | None:
    try:
        lat_s, lng_s = g["Coordinates"].split(",")
        mag = float(g["Magnitude"])
        when = datetime.fromisoformat(g["DateTime"])
    except (KeyError, ValueError):
        return None
    if datetime.now(timezone.utc) - when > MAX_AGE:
        return None
    potensi = g.get("Potensi", "")
    sev = severity_from_magnitude(mag)
    if "berpotensi tsunami" in potensi.lower() and "tidak" not in potensi.lower():
        sev = "critical"
    desc = f"{g.get('Wilayah', '')}. Kedalaman {g.get('Kedalaman', '-')}. {potensi}".strip()
    if g.get("Dirasakan"):
        desc += f" Dirasakan: {g['Dirasakan']}."
    return Incident(
        id=f"bmkg-{g['DateTime']}",
        type="earthquake",
        title=f"Gempa M{mag:.1f}".replace(".", ","),
        description=desc,
        lat=float(lat_s),
        lng=float(lng_s),
        address=g.get("Wilayah", ""),
        severity=sev,
        source=Source(id="bmkg", label="BMKG (TEWS)", kind="official"),
        reported_at=when.isoformat(),
        magnitude=mag,
    )


class BMKGSource(DataSource):
    id = "bmkg"
    label = "BMKG"
    interval_s = 60

    def enabled(self) -> bool:
        return settings.enable_bmkg

    async def fetch(self, client: httpx.AsyncClient) -> SourceResult:
        auto = (await client.get(AUTO)).json()["Infogempa"]["gempa"]
        terkini = (await client.get(TERKINI)).json()["Infogempa"]["gempa"]
        seen: dict[str, Incident] = {}
        for g in [auto, *terkini]:
            inc = _to_incident(g)
            if inc:
                seen[inc.id] = inc
        return SourceResult(incidents=list(seen.values()), replace=True)

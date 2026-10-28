"""Status gunung api dari MAGMA Indonesia (PVMBG). Tidak ada API JSON resmi, jadi parsing halaman
tingkat aktivitas. Kalau gagal, data seed tetap dipakai."""

import html
import re

import httpx

from ..config import settings
from ..models import Incident, Source, Zone
from .base import DataSource, SourceResult

URL = "https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas"

# Koordinat puncak (perkiraan) gunung api yang sering naik status
COORDS: dict[str, tuple[float, float]] = {
    "Anak Krakatau": (-6.102, 105.423),
    "Merapi": (-7.540, 110.446),
    "Semeru": (-8.108, 112.922),
    "Lewotobi Laki-laki": (-8.542, 122.775),
    "Lewotobi Perempuan": (-8.575, 122.775),
    "Ibu": (1.488, 127.630),
    "Ruang": (2.300, 125.370),
    "Marapi": (-0.381, 100.473),
    "Sinabung": (3.170, 98.392),
    "Karangetang": (2.781, 125.407),
    "Dempo": (-4.016, 103.121),
    "Dukono": (1.693, 127.894),
    "Ili Lewotolok": (-8.272, 123.505),
    "Raung": (-8.125, 114.042),
    "Bromo": (-7.942, 112.950),
    "Lokon": (1.358, 124.792),
    "Kerinci": (-1.697, 101.264),
    "Agung": (-8.343, 115.508),
    "Rinjani": (-8.411, 116.457),
    "Gamalama": (0.800, 127.330),
    "Awu": (3.689, 125.447),
    "Banda Api": (-4.525, 129.871),
    "Sangeangapi": (-8.200, 119.070),
    "Slamet": (-7.242, 109.208),
    "Soputan": (1.108, 124.737),
    "Tambora": (-8.250, 117.992),
}
LEVELS = {"IV": ("critical", "Awas", 7000), "III": ("high", "Siaga", 5000)}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse(page: str) -> list[tuple[str, str, str]]:
    """Kembalikan (nama, provinsi, level romawi) untuk gunung Level III dan IV."""
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    lines = [ln.strip() for ln in html.unescape(re.sub(r"<[^>]+>", "\n", t)).splitlines() if ln.strip()]
    out, level = [], None
    for ln in lines:
        m = re.match(r"^Level (IV|III|II|I) \(", ln)
        if m:
            level = m.group(1)
            continue
        if level in LEVELS and " - " in ln and not ln.startswith("Tidak ada"):
            name, prov = ln.split(" - ", 1)
            out.append((name.strip(), prov.strip(), level))
    return out


class MagmaSource(DataSource):
    id = "magma"
    label = "MAGMA Indonesia"
    interval_s = 1800

    def enabled(self) -> bool:
        return settings.enable_magma

    async def fetch(self, client: httpx.AsyncClient) -> SourceResult:
        res = await client.get(URL, timeout=30)
        res.raise_for_status()
        items = parse(res.text)
        if not items:
            raise ValueError("format halaman MAGMA berubah, tidak ada data level")
        incidents, zones = [], []
        for name, prov, lvl in items:
            if name not in COORDS:
                continue
            lat, lng = COORDS[name]
            sev, label, radius = LEVELS[lvl]
            sid = _slug(name)
            incidents.append(
                Incident(
                    id=f"magma-{sid}",
                    type="volcano",
                    title=f"{name} Level {lvl} ({label})",
                    description=f"Status aktivitas gunung api {name} Level {lvl} ({label}) menurut PVMBG. Ikuti rekomendasi radius aman.",
                    lat=lat,
                    lng=lng,
                    address=f"Gunung {name}, {prov}",
                    severity=sev,
                    source=Source(id="magma", label="PVMBG / MAGMA Indonesia", kind="official"),
                )
            )
            zones.append(
                Zone(
                    id=f"zone-magma-{sid}",
                    kind="volcano_exclusion",
                    shape="circle",
                    label=f"Radius larangan {radius // 1000} km {name}",
                    source="PVMBG (radius perkiraan)",
                    center=(lat, lng),
                    radius_m=radius,
                )
            )
        return SourceResult(incidents=incidents, zones=zones, replace=True)

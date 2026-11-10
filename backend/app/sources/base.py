"""Interface bersama untuk semua sumber data."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import httpx

from ..models import Incident, Zone


@dataclass
class SourceResult:
    incidents: list[Incident] = field(default_factory=list)
    zones: list[Zone] = field(default_factory=list)
    # True = hasil menggantikan semua kejadian sebelumnya dari sumber ini (data resmi)
    replace: bool = False
    # True = kejadian baru perlu lewat verifier LLM (laporan warga, CCTV)
    needs_verification: bool = False
    # Titik panas untuk heatmap: [lat, lng, frp MW, detik epoch]. None = sumber ini tidak mengirim heatmap
    hotspots: list[list[float]] | None = None
    hotspot_meta: dict | None = None


class DataSource(ABC):
    id: str
    label: str
    interval_s: float = 300

    def enabled(self) -> bool:
        return True

    @abstractmethod
    async def fetch(self, client: httpx.AsyncClient) -> SourceResult: ...


def severity_from_magnitude(m: float) -> str:
    if m >= 7:
        return "critical"
    if m >= 6:
        return "high"
    if m >= 5:
        return "medium"
    return "low"

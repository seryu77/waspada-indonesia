"""Kontrak data. Sama dengan frontend/src/types.ts dan shared/types.md."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

HazardType = Literal["fire", "flood", "crime", "earthquake", "landslide", "accident", "volcano"]
Severity = Literal["low", "medium", "high", "critical"]
SourceKind = Literal["official", "satellite", "cctv", "citizen", "demo", "simulator"]
Verdict = Literal["confirmed", "false_alarm", "uncertain"]
DispatchState = Literal["review", "countdown", "sent", "cancelled", "failed"]
Actor = Literal["ai", "operator", "system"]

SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Source(BaseModel):
    id: str
    label: str
    kind: SourceKind


class Verification(BaseModel):
    verdict: Verdict
    confidence: float = Field(ge=0, le=1)
    severity: Severity
    reasoning: str
    recommended_agency: str
    model: str
    stage: Literal["triage", "verify"]
    simulated: bool
    needs_manual_review: bool
    verified_at: str = Field(default_factory=now_iso)


class TimelineEntry(BaseModel):
    at: str = Field(default_factory=now_iso)
    actor: Actor
    action: str
    note: str


class Dispatch(BaseModel):
    state: DispatchState
    agency: str
    mode: Literal["simulate", "webhook"]
    deadline: str | None = None
    countdown_s: int | None = None
    sent_at: str | None = None
    timeline: list[TimelineEntry] = []


class Incident(BaseModel):
    id: str
    type: HazardType
    title: str
    description: str
    lat: float
    lng: float
    address: str
    severity: Severity
    status: Literal["active", "resolved"] = "active"
    source: Source
    reported_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    camera_id: str | None = None
    magnitude: float | None = None
    evidence: list[str] | None = None
    verifying: bool | None = None
    verification: Verification | None = None
    dispatch: Dispatch | None = None

    def effective_severity(self) -> Severity:
        return self.verification.severity if self.verification else self.severity


class Zone(BaseModel):
    id: str
    kind: Literal["burn", "smoke", "flood", "volcano_exclusion", "crime"]
    shape: Literal["polygon", "circle"]
    label: str
    source: str
    period: str | None = None
    coords: list[tuple[float, float]] | None = None
    center: tuple[float, float] | None = None
    radius_m: float | None = None


class Route(BaseModel):
    id: str
    kind: Literal["blocked", "danger"]
    label: str
    reason: str
    source: str
    path: list[tuple[float, float]]


class Camera(BaseModel):
    id: str
    name: str
    city: str
    lat: float
    lng: float
    status: Literal["online", "offline"]
    detections_today: int = 0
    stream_url: str
    stream_type: Literal["hls", "rtsp", "snapshot"]
    last_frame_at: str | None = None


def dump(m: BaseModel) -> dict:
    return m.model_dump(mode="json", exclude_none=True)

"""Seed data demo dari shared/seed.json (dipakai juga oleh frontend)."""

import json
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..models import Camera, Dispatch, Incident, Route, TimelineEntry, Verification, Zone


def _iso(age_min: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=age_min)).isoformat()


def load_seed() -> tuple[list[Incident], list[Zone], list[Route], list[str], list[dict]]:
    """Kembalikan (incidents, zones, routes, id yang perlu hitung mundur, template simulator)."""
    raw = json.loads(settings.seed_path.read_text(encoding="utf-8"))
    incidents: list[Incident] = []
    countdown_ids: list[str] = []
    for r in raw["incidents"]:
        r = dict(r)
        age = r.pop("age_min")
        v = r.pop("verification", None)
        d = r.pop("dispatch", None)
        r["source"] = {**r["source"], "label": f"{r['source']['label']} - data demo"}
        inc = Incident(**r, reported_at=_iso(age), updated_at=_iso(age))
        if v:
            inc.verification = Verification(**v, verified_at=_iso(max(0, age - 1)))
        if d:
            if d["state"] == "countdown":
                countdown_ids.append(inc.id)
            else:
                tl = [TimelineEntry(at=_iso(t.pop("age_min")), **t) for t in [dict(x) for x in d["timeline"]]]
                inc.dispatch = Dispatch(state=d["state"], agency=d["agency"], mode=d["mode"], timeline=tl, sent_at=tl[-1].at if tl else None)
        incidents.append(inc)
    zones = [Zone(**z) for z in raw["zones"]]
    routes = [Route(**r) for r in raw["routes"]]
    return incidents, zones, routes, countdown_ids, raw["simulator_templates"]


def load_cameras() -> list[Camera]:
    raw = json.loads(settings.cameras_path.read_text(encoding="utf-8"))
    return [Camera(**c) for c in raw["cameras"]]

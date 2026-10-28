"""SQLite untuk MVP: riwayat kejadian, laporan warga, dan audit log keputusan AI/operator."""

import json

import aiosqlite

from .config import settings
from .models import now_iso

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    incident_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    data TEXT NOT NULL
);
"""

_db: aiosqlite.Connection | None = None


async def init() -> None:
    global _db
    _db = await aiosqlite.connect(settings.db_path)
    await _db.executescript(SCHEMA)
    await _db.commit()


async def close() -> None:
    if _db:
        await _db.close()


async def save_incident(inc: dict) -> None:
    if not _db:
        return
    await _db.execute(
        "INSERT INTO incidents (id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (inc["id"], json.dumps(inc), inc.get("updated_at", now_iso())),
    )
    await _db.commit()


async def save_report(report_id: str, data: dict) -> None:
    if not _db:
        return
    await _db.execute("INSERT OR REPLACE INTO reports (id, at, data) VALUES (?, ?, ?)", (report_id, now_iso(), json.dumps(data)))
    await _db.commit()


async def audit(incident_id: str | None, actor: str, action: str, detail: dict | None = None) -> None:
    if not _db:
        return
    await _db.execute(
        "INSERT INTO audit_log (at, incident_id, actor, action, detail) VALUES (?, ?, ?, ?, ?)",
        (now_iso(), incident_id, actor, action, json.dumps(detail or {}, ensure_ascii=False)),
    )
    await _db.commit()


async def audit_list(limit: int = 200, incident_id: str | None = None) -> list[dict]:
    if not _db:
        return []
    q = "SELECT at, incident_id, actor, action, detail FROM audit_log"
    args: tuple = ()
    if incident_id:
        q += " WHERE incident_id = ?"
        args = (incident_id,)
    q += " ORDER BY id DESC LIMIT ?"
    async with _db.execute(q, (*args, limit)) as cur:
        rows = await cur.fetchall()
    return [{"at": r[0], "incident_id": r[1], "actor": r[2], "action": r[3], "detail": json.loads(r[4] or "{}")} for r in rows]

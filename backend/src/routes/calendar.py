"""
Content Calendar router — schedule Generate-with-AI runs for specific
datetimes. Each "slot" stores the same params shape /api/pipeline/run-ai
takes; the worker (still in api_server) fires them at scheduled_at.

CRUD only — the firing worker `_calendar_worker` lives alongside the
other long-lived workers in api_server.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


def _validate_scheduled_at(raw: str) -> str:
    """
    Accept ISO-8601 datetime strings and normalize to UTC ISO format.

    Was: stored verbatim. A malformed string ("tomorrow", "2026-13-01",
    "5:00pm") got silently stuck in the calendar — pop_due() would skip
    it forever because fromisoformat() raised on every tick. The slot
    just sat there confusing the user with a 'planned' status that
    never fired.

    Returns the normalized ISO string. Raises HTTPException(400) on
    parse failure with a message that surfaces the problem to the UI.
    """
    s = (raw or "").strip()
    if not s:
        raise HTTPException(400, "scheduled_at (ISO datetime) is required")
    try:
        # `fromisoformat` accepts "Z" only on Python 3.11+; for
        # backward-compat we pre-translate it. Same hack content_calendar's
        # pop_due uses internally — keep the two places consistent.
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            400,
            f"scheduled_at must be ISO-8601 (e.g. '2026-04-30T14:30:00Z'), got {s!r}",
        )
    if t.tzinfo is None:
        # Naive datetimes get assigned UTC. We don't try to guess the
        # user's local zone — the frontend always submits UTC.
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc).isoformat()


@router.get("")
async def calendar_list():
    from api_server import PROJECT_ROOT
    from content_calendar import list_slots
    return {"slots": list_slots(PROJECT_ROOT)}


@router.post("")
async def calendar_create(req: dict):
    from api_server import PROJECT_ROOT
    from content_calendar import create_slot
    # Reject unparseable timestamps BEFORE persisting — otherwise the
    # slot would sit forever in 'planned' status because pop_due()
    # silently skips entries it can't parse.
    sched = _validate_scheduled_at(req.get("scheduled_at") or "")
    title = (req.get("title") or "").strip() or "Scheduled run"
    kind  = (req.get("kind") or "ai").strip()
    if kind not in ("ai",):
        raise HTTPException(400, "kind must be 'ai' for now")
    brand_id = req.get("brand_id") or None
    params   = req.get("params") or {}
    slot = create_slot(
        PROJECT_ROOT,
        scheduled_at=sched, kind=kind,
        brand_id=brand_id, title=title, params=params,
    )
    return {"slot": slot}


@router.put("/{slot_id}")
async def calendar_update(slot_id: str, req: dict):
    from api_server import PROJECT_ROOT
    from content_calendar import update_slot
    # Same validation on update — we only validate the field if the
    # caller is changing it, so partial patches that don't touch the
    # timestamp still work.
    if "scheduled_at" in req and req["scheduled_at"] is not None:
        req["scheduled_at"] = _validate_scheduled_at(req["scheduled_at"])
    s = update_slot(PROJECT_ROOT, slot_id, req)
    if not s:
        raise HTTPException(404, "Slot not found")
    return {"slot": s}


@router.delete("/{slot_id}")
async def calendar_delete(slot_id: str):
    from api_server import PROJECT_ROOT
    from content_calendar import delete_slot
    if not delete_slot(PROJECT_ROOT, slot_id):
        raise HTTPException(404, "Slot not found")
    return {"deleted": True}


@router.post("/{slot_id}/fire-now")
async def calendar_fire_now(slot_id: str):
    """Reschedule a slot to NOW so the worker picks it up next tick."""
    from api_server import PROJECT_ROOT
    from content_calendar import update_slot, get_slot
    s = get_slot(PROJECT_ROOT, slot_id)
    if not s:
        raise HTTPException(404, "Slot not found")
    update_slot(PROJECT_ROOT, slot_id, {
        "scheduled_at": datetime.now(timezone.utc).isoformat(),
        "status": "planned",
        "error": None,
    })
    return {"queued_for_immediate_fire": True}

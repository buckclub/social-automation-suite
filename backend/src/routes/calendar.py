"""
Content Calendar router — schedule Generate-with-AI runs for specific
datetimes. Each "slot" stores the same params shape /api/pipeline/run-ai
takes; the worker (still in api_server) fires them at scheduled_at.

CRUD only — the firing worker `_calendar_worker` lives alongside the
other long-lived workers in api_server.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("")
async def calendar_list():
    from api_server import PROJECT_ROOT
    from content_calendar import list_slots
    return {"slots": list_slots(PROJECT_ROOT)}


@router.post("")
async def calendar_create(req: dict):
    from api_server import PROJECT_ROOT
    from content_calendar import create_slot
    sched = (req.get("scheduled_at") or "").strip()
    if not sched:
        raise HTTPException(400, "scheduled_at (ISO datetime) is required")
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

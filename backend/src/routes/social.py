"""
Social-copy batch queue router — endpoints for enqueueing N posts at
once for background social-copy generation, plus inspect / cancel /
clear-history. The actual worker `_social_queue_worker` is still in
api_server.py because it calls `_do_generate_social_copy` (a closure
over module-level state).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/social", tags=["social"])


@router.post("/batch-generate")
async def batch_generate_social(req: dict):
    """
    Enqueue multiple posts for background social-copy generation.

    Body: { "items": [{"post_id": "abc", "title": "..."}, ...] }
    """
    from api_server import PROJECT_ROOT, _log
    from social_queue import enqueue_many
    items_in = req.get("items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(400, "items[] required")
    added = enqueue_many(PROJECT_ROOT, items_in)
    _log(f"Social copy queue: +{len(added)} item(s) (skipped {len(items_in) - len(added)} dup/empty)")
    return {"added": added, "count": len(added)}


@router.get("/queue")
async def social_queue_snapshot():
    """Return the full queue state (pending/running/history)."""
    from api_server import PROJECT_ROOT
    from social_queue import snapshot
    return snapshot(PROJECT_ROOT)


@router.delete("/queue/{queue_id}")
async def social_queue_cancel(queue_id: str):
    """Cancel a queued entry (running entries can't be cancelled mid-call)."""
    from api_server import PROJECT_ROOT
    from social_queue import cancel
    ok = cancel(PROJECT_ROOT, queue_id)
    if not ok:
        raise HTTPException(409, "Can't cancel — item is currently running")
    return {"cancelled": True}


@router.delete("/queue")
async def social_queue_clear_history():
    """Clear finished / failed / cancelled rows from the queue view."""
    from api_server import PROJECT_ROOT
    from social_queue import clear_history
    removed = clear_history(PROJECT_ROOT)
    return {"removed": removed}

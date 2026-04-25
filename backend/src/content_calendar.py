"""
Content Calendar — schedule content generation for specific datetimes.

Each "slot" stores everything needed to fire a Generate-with-AI run at
its scheduled time. The background worker (in api_server.py) polls
every minute, fires due slots, and tracks their lifecycle.

Slot states:
  planned    → user-created, scheduled_at in the future
  due        → scheduled_at <= now, picked up by the worker
  generating → worker is calling generate-variants
  queued     → variant approved + post enqueued on the run queue
  rendered   → render queue worker finished it (post_id set)
  failed     → an error happened along the way (error message captured)
  cancelled  → user clicked cancel before it fired

Storage: `.cache/content_calendar.json` via JsonLedger.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from json_ledger import get_ledger


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "content_calendar.json")


def _ledger(project_root: str):
    return get_ledger(_path(project_root), default={"slots": []})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_slots(project_root: str) -> list[dict]:
    with _ledger(project_root).read() as d:
        return d.get("slots") or []


def get_slot(project_root: str, slot_id: str) -> Optional[dict]:
    for s in list_slots(project_root):
        if s.get("id") == slot_id:
            return s
    return None


def create_slot(project_root: str,
                *, scheduled_at: str, kind: str,
                brand_id: Optional[str],
                title: str,
                params: dict) -> dict:
    """
    `kind` is one of "ai" | "custom" | "news_link". For now only "ai" is
    fully wired in the worker.
    """
    slot = {
        "id":           f"slot_{uuid.uuid4().hex[:10]}",
        "scheduled_at": scheduled_at,
        "kind":         kind,
        "brand_id":     brand_id,
        "title":        (title or "")[:200],
        "params":       dict(params or {}),
        "status":       "planned",
        "created_at":   _now(),
        "fired_at":     None,
        "post_id":      None,
        "error":        None,
    }
    with _ledger(project_root).mutate() as d:
        d.setdefault("slots", []).append(slot)
    return slot


def update_slot(project_root: str, slot_id: str, patch: dict) -> Optional[dict]:
    with _ledger(project_root).mutate() as d:
        for s in d.get("slots", []):
            if s.get("id") == slot_id:
                for k in ("scheduled_at", "title", "params", "brand_id", "kind",
                          "status", "fired_at", "post_id", "error"):
                    if k in patch:
                        s[k] = patch[k]
                return s
        return None


def delete_slot(project_root: str, slot_id: str) -> bool:
    with _ledger(project_root).mutate() as d:
        before = len(d.get("slots", []))
        d["slots"] = [s for s in d.get("slots", []) if s.get("id") != slot_id]
        return len(d["slots"]) != before


def pop_due(project_root: str) -> Optional[dict]:
    """
    Pick the oldest planned slot whose scheduled_at <= now, mark it as
    'due', return it. Returns None if nothing's ready.
    """
    now = datetime.now(timezone.utc)
    with _ledger(project_root).mutate() as d:
        ready = []
        for s in d.get("slots", []):
            if s.get("status") != "planned":
                continue
            ts = s.get("scheduled_at") or ""
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if t <= now:
                ready.append((t, s))
        if not ready:
            return None
        ready.sort(key=lambda x: x[0])
        slot = ready[0][1]
        slot["status"] = "due"
        slot["fired_at"] = _now()
        return dict(slot)


def mark_status(project_root: str, slot_id: str, status: str,
                *, error: Optional[str] = None,
                post_id: Optional[str] = None) -> None:
    with _ledger(project_root).mutate() as d:
        for s in d.get("slots", []):
            if s.get("id") == slot_id:
                s["status"] = status
                if error is not None: s["error"] = error
                if post_id is not None: s["post_id"] = post_id
                return


def init_on_startup(project_root: str) -> int:
    """Demote any in-flight states back to 'planned' after a crash."""
    n = 0
    with _ledger(project_root).mutate() as d:
        for s in d.get("slots", []):
            if s.get("status") in ("due", "generating"):
                s["status"] = "planned"
                s["fired_at"] = None
                n += 1
    return n

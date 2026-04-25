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

Storage: `.cache/content_calendar.json`
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

_lock = Lock()


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "content_calendar.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(path: str) -> dict:
    if not os.path.isfile(path):
        return {"slots": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        d.setdefault("slots", [])
        return d
    except Exception:
        return {"slots": []}


def _save(path: str, data: dict) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def list_slots(project_root: str) -> list[dict]:
    return _load(_path(project_root)).get("slots") or []


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
    fully wired in the worker — `params` should look like the body of
    /api/pipeline/run-ai (content_style, niche, target_audience, tone,
    content_filter, video_mode, voice_override, narrator_gender,
    background_selector, custom_topic, custom_title).
    """
    p = _path(project_root)
    with _lock:
        d = _load(p)
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
        d["slots"].append(slot)
        _save(p, d)
    return slot


def update_slot(project_root: str, slot_id: str, patch: dict) -> Optional[dict]:
    p = _path(project_root)
    with _lock:
        d = _load(p)
        for s in d["slots"]:
            if s.get("id") == slot_id:
                for k in ("scheduled_at", "title", "params", "brand_id", "kind", "status",
                          "fired_at", "post_id", "error"):
                    if k in patch:
                        s[k] = patch[k]
                _save(p, d)
                return s
        return None


def delete_slot(project_root: str, slot_id: str) -> bool:
    p = _path(project_root)
    with _lock:
        d = _load(p)
        before = len(d["slots"])
        d["slots"] = [s for s in d["slots"] if s.get("id") != slot_id]
        if len(d["slots"]) == before:
            return False
        _save(p, d)
    return True


def pop_due(project_root: str) -> Optional[dict]:
    """
    Pick the oldest planned slot whose scheduled_at <= now, mark it as
    'due', return it. Returns None if nothing's ready.
    """
    p = _path(project_root)
    now = datetime.now(timezone.utc)
    with _lock:
        d = _load(p)
        ready = []
        for s in d["slots"]:
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
        _save(p, d)
        return dict(slot)


def mark_status(project_root: str, slot_id: str, status: str,
                *, error: Optional[str] = None,
                post_id: Optional[str] = None) -> None:
    p = _path(project_root)
    with _lock:
        d = _load(p)
        for s in d["slots"]:
            if s.get("id") == slot_id:
                s["status"] = status
                if error is not None: s["error"] = error
                if post_id is not None: s["post_id"] = post_id
                _save(p, d)
                return


def init_on_startup(project_root: str) -> int:
    """Demote any in-flight states back to 'planned' after a crash."""
    p = _path(project_root)
    n = 0
    with _lock:
        d = _load(p)
        for s in d["slots"]:
            if s.get("status") in ("due", "generating"):
                s["status"] = "planned"
                s["fired_at"] = None
                n += 1
        if n:
            _save(p, d)
    return n

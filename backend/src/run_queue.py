"""
Run queue for the pipeline.

The pipeline itself is single-slot — only one post can be rendering at a
time. This module adds a "next up" queue on top so the user can line up
N posts and walk away. A background worker watches the queue and starts
the next item whenever the pipeline goes idle.

Ledger at `.cache/run_queue.json`:
  {
    "paused": false,
    "items": [
      {
        "queue_id":   "<uuid4>",
        "post_id":    "<reddit id or custom id>",
        "title":      "<cached for UI display>",
        "subreddit":  "",
        "status":     "queued" | "running" | "done" | "failed" | "cancelled",
        "added_at":   "<iso>",
        "started_at": "<iso>" | null,
        "finished_at":"<iso>" | null,
        "error":      "<last error>" | null,
        "params":     { ...kwargs forwarded to _run_pipeline_async },
      },
      ...
    ],
    "history_cap": 100
  }

Only QUEUED items are meaningful after a server restart — the rest are
recycled. Keep up to `history_cap` historical entries (done/failed/
cancelled) so the user can see what ran overnight.
"""
from __future__ import annotations
import json
import os
import time
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

_lock = Lock()
DEFAULT_HISTORY_CAP = 100


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "run_queue.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(path: str) -> dict:
    if not os.path.isfile(path):
        return {"paused": False, "items": [], "history_cap": DEFAULT_HISTORY_CAP}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "items" not in data:
            data["items"] = []
        if "paused" not in data:
            data["paused"] = False
        if "history_cap" not in data:
            data["history_cap"] = DEFAULT_HISTORY_CAP
        return data
    except Exception:
        return {"paused": False, "items": [], "history_cap": DEFAULT_HISTORY_CAP}


def _save(path: str, data: dict) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def _prune_history(items: list, cap: int) -> list:
    """Keep all queued/running items + last `cap` terminal ones."""
    active = [i for i in items if i.get("status") in ("queued", "running")]
    terminal = [i for i in items if i.get("status") not in ("queued", "running")]
    terminal.sort(key=lambda i: i.get("finished_at") or i.get("added_at") or "", reverse=True)
    return active + terminal[:cap]


def init_on_startup(project_root: str) -> None:
    """
    Recovery pass: any item marked 'running' at load time is stale — the
    server restarted mid-run. Demote to 'failed' with a clear message so
    the user knows what happened.
    """
    with _lock:
        path = _path(project_root)
        data = _load(path)
        changed = False
        for item in data["items"]:
            if item.get("status") == "running":
                item["status"] = "failed"
                item["error"] = "Server restarted while running"
                item["finished_at"] = _now()
                changed = True
        if changed:
            _save(path, data)


def snapshot(project_root: str) -> dict:
    path = _path(project_root)
    return _load(path)


def enqueue(project_root: str, post_id: str, title: str = "",
            subreddit: str = "", params: Optional[dict] = None) -> dict:
    """Push a new queued item. Returns the created entry."""
    with _lock:
        path = _path(project_root)
        data = _load(path)
        # Prevent duplicate entries for the same post unless the prior one
        # already finished — otherwise the queue could get spammy.
        for i in data["items"]:
            if i.get("post_id") == post_id and i.get("status") in ("queued", "running"):
                return i
        item = {
            "queue_id":    uuid.uuid4().hex,
            "post_id":     post_id,
            "title":       title or post_id,
            "subreddit":   subreddit or "",
            "status":      "queued",
            "added_at":    _now(),
            "started_at":  None,
            "finished_at": None,
            "error":       None,
            "params":      dict(params or {}),
        }
        data["items"].append(item)
        data["items"] = _prune_history(data["items"], data["history_cap"])
        _save(path, data)
        return item


def remove(project_root: str, queue_id: str) -> bool:
    with _lock:
        path = _path(project_root)
        data = _load(path)
        before = len(data["items"])
        data["items"] = [i for i in data["items"] if i.get("queue_id") != queue_id]
        if len(data["items"]) == before:
            return False
        _save(path, data)
        return True


def reorder(project_root: str, queue_id: str, direction: int) -> bool:
    """Move a queued item up (-1) or down (+1) one slot among queued items."""
    with _lock:
        path = _path(project_root)
        data = _load(path)
        # Only reorder among queued items (running / done stay fixed).
        queued_idx = [idx for idx, i in enumerate(data["items"]) if i.get("status") == "queued"]
        match = [idx for idx in queued_idx if data["items"][idx].get("queue_id") == queue_id]
        if not match:
            return False
        me = match[0]
        pos = queued_idx.index(me)
        new_pos = pos + (1 if direction > 0 else -1)
        if new_pos < 0 or new_pos >= len(queued_idx):
            return False
        target = queued_idx[new_pos]
        data["items"][me], data["items"][target] = data["items"][target], data["items"][me]
        _save(path, data)
        return True


def mark_running(project_root: str, queue_id: str) -> Optional[dict]:
    with _lock:
        path = _path(project_root)
        data = _load(path)
        for item in data["items"]:
            if item.get("queue_id") == queue_id:
                item["status"]     = "running"
                item["started_at"] = _now()
                _save(path, data)
                return item
        return None


def mark_finished(project_root: str, queue_id: str, *,
                  success: bool, error: Optional[str] = None) -> None:
    with _lock:
        path = _path(project_root)
        data = _load(path)
        for item in data["items"]:
            if item.get("queue_id") == queue_id:
                item["status"]      = "done" if success else "failed"
                item["finished_at"] = _now()
                if error:
                    item["error"] = error[:400]
                break
        data["items"] = _prune_history(data["items"], data["history_cap"])
        _save(path, data)


def set_paused(project_root: str, paused: bool) -> None:
    with _lock:
        path = _path(project_root)
        data = _load(path)
        data["paused"] = bool(paused)
        _save(path, data)


def next_queued(project_root: str) -> Optional[dict]:
    """Return the first queued item without mutating, or None."""
    path = _path(project_root)
    data = _load(path)
    if data.get("paused"):
        return None
    for item in data["items"]:
        if item.get("status") == "queued":
            return item
    return None


def clear_history(project_root: str) -> int:
    """Drop everything except queued + running. Returns count dropped."""
    with _lock:
        path = _path(project_root)
        data = _load(path)
        before = len(data["items"])
        data["items"] = [i for i in data["items"] if i.get("status") in ("queued", "running")]
        _save(path, data)
        return before - len(data["items"])


def retry(project_root: str, queue_id: str) -> Optional[dict]:
    """Flip a failed/cancelled item back to 'queued' at the tail of the queue."""
    with _lock:
        path = _path(project_root)
        data = _load(path)
        for item in data["items"]:
            if item.get("queue_id") == queue_id:
                if item.get("status") in ("queued", "running", "done"):
                    return None  # only retry-able from terminal failed/cancelled
                item["status"]      = "queued"
                item["error"]       = None
                item["started_at"]  = None
                item["finished_at"] = None
                _save(path, data)
                return item
        return None

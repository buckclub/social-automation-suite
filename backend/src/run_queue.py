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

Storage: JsonLedger (json_ledger.py) — atomic writes + path-keyed lock.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from json_ledger import get_ledger

DEFAULT_HISTORY_CAP = 100


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "run_queue.json")


def _ledger(project_root: str):
    return get_ledger(
        _path(project_root),
        default={"paused": False, "items": [], "history_cap": DEFAULT_HISTORY_CAP},
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _prune_history(items: list, cap: int) -> list:
    """Keep all queued/running items + last `cap` terminal ones."""
    active = [i for i in items if i.get("status") in ("queued", "running")]
    terminal = [i for i in items if i.get("status") not in ("queued", "running")]
    terminal.sort(key=lambda i: i.get("finished_at") or i.get("added_at") or "", reverse=True)
    return active + terminal[:cap]


def init_on_startup(project_root: str) -> None:
    """
    Recovery pass: any item marked 'running' at load time is stale — the
    server restarted mid-run. Demote to 'failed' with a clear message.
    """
    with _ledger(project_root).mutate() as data:
        data.setdefault("items", [])
        for item in data["items"]:
            if item.get("status") == "running":
                item["status"] = "failed"
                item["error"] = "Server restarted while running"
                item["finished_at"] = _now()


def snapshot(project_root: str) -> dict:
    with _ledger(project_root).read() as data:
        # Backfill defaults for the UI.
        data.setdefault("items", [])
        data.setdefault("paused", False)
        data.setdefault("history_cap", DEFAULT_HISTORY_CAP)
        return data


def enqueue(project_root: str, post_id: str, title: str = "",
            subreddit: str = "", params: Optional[dict] = None) -> dict:
    """Push a new queued item. Returns the created entry."""
    with _ledger(project_root).mutate() as data:
        data.setdefault("items", [])
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
        data["items"] = _prune_history(data["items"],
                                       data.get("history_cap", DEFAULT_HISTORY_CAP))
        return item


def remove(project_root: str, queue_id: str) -> bool:
    with _ledger(project_root).mutate() as data:
        before = len(data.get("items", []))
        data["items"] = [i for i in data.get("items", []) if i.get("queue_id") != queue_id]
        return len(data["items"]) != before


def reorder(project_root: str, queue_id: str, direction: int) -> bool:
    """Move a queued item up (-1) or down (+1) one slot among queued items."""
    with _ledger(project_root).mutate() as data:
        items = data.get("items", [])
        queued_idx = [idx for idx, i in enumerate(items) if i.get("status") == "queued"]
        match = [idx for idx in queued_idx if items[idx].get("queue_id") == queue_id]
        if not match:
            return False
        me = match[0]
        pos = queued_idx.index(me)
        new_pos = pos + (1 if direction > 0 else -1)
        if new_pos < 0 or new_pos >= len(queued_idx):
            return False
        target = queued_idx[new_pos]
        items[me], items[target] = items[target], items[me]
        return True


def move_to_top(project_root: str, queue_id: str) -> bool:
    """
    Bump a queued item to the front of the queued list. Used by the
    'Move to top' button in the UI when the user wants to prioritise
    a render without clicking the up-arrow N times.

    Operates on the queued slice only — running items keep their
    position. Returns False when the id isn't found OR is already at
    position 0 (no-op).
    """
    with _ledger(project_root).mutate() as data:
        items = data.get("items", [])
        # Find target row and the index of the FIRST queued row.
        target_idx = next(
            (i for i, it in enumerate(items)
             if it.get("queue_id") == queue_id and it.get("status") == "queued"),
            None,
        )
        if target_idx is None:
            return False
        first_queued = next(
            (i for i, it in enumerate(items) if it.get("status") == "queued"),
            None,
        )
        if first_queued is None or first_queued == target_idx:
            return False  # already at the top, or no queued at all
        # Pop and re-insert at the first-queued position so we don't
        # disturb running rows (which sort before any queued row).
        item = items.pop(target_idx)
        # Recompute first_queued in case the pop shifted it.
        first_queued = next(
            (i for i, it in enumerate(items) if it.get("status") == "queued"),
            len(items),
        )
        items.insert(first_queued, item)
        return True


def mark_running(project_root: str, queue_id: str) -> Optional[dict]:
    with _ledger(project_root).mutate() as data:
        for item in data.get("items", []):
            if item.get("queue_id") == queue_id:
                item["status"]     = "running"
                item["started_at"] = _now()
                return item
        return None


def mark_finished(project_root: str, queue_id: str, *,
                  success: bool, error: Optional[str] = None) -> None:
    with _ledger(project_root).mutate() as data:
        for item in data.get("items", []):
            if item.get("queue_id") == queue_id:
                item["status"]      = "done" if success else "failed"
                item["finished_at"] = _now()
                if error:
                    item["error"] = error[:400]
                break
        data["items"] = _prune_history(data.get("items", []),
                                       data.get("history_cap", DEFAULT_HISTORY_CAP))


def set_paused(project_root: str, paused: bool) -> None:
    with _ledger(project_root).mutate() as data:
        data["paused"] = bool(paused)


def next_queued(project_root: str) -> Optional[dict]:
    """Return the first queued item without mutating, or None."""
    with _ledger(project_root).read() as data:
        if data.get("paused"):
            return None
        for item in data.get("items", []):
            if item.get("status") == "queued":
                return item
        return None


def clear_history(project_root: str) -> int:
    """Drop everything except queued + running. Returns count dropped."""
    with _ledger(project_root).mutate() as data:
        before = len(data.get("items", []))
        data["items"] = [
            i for i in data.get("items", [])
            if i.get("status") in ("queued", "running")
        ]
        return before - len(data["items"])


def retry(project_root: str, queue_id: str) -> Optional[dict]:
    """Flip a failed/cancelled item back to 'queued' at the tail of the queue."""
    with _ledger(project_root).mutate() as data:
        for item in data.get("items", []):
            if item.get("queue_id") == queue_id:
                if item.get("status") in ("queued", "running", "done"):
                    return None
                item["status"]      = "queued"
                item["error"]       = None
                item["started_at"]  = None
                item["finished_at"] = None
                return item
        return None

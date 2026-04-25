"""
Background queue for Social Copy generation.

Generating social copy requires an LLM roundtrip (5–30 s depending on
provider), so running a dozen inline blocks the browser and loses
progress if the tab closes. This module adds a persistent queue so the
user can enqueue N post-ids and walk away — a background worker inside
the FastAPI server drains them one at a time.

The queue is stored at `.cache/social_queue.json`. Each entry is:

    {
      "queue_id":    "<uuid4>",
      "post_id":     "<reddit id>",
      "title":       "<cached for UI display>",
      "status":      "queued" | "running" | "done" | "failed" | "cancelled",
      "added_at":    "<iso>",
      "started_at":  "<iso> | null",
      "finished_at": "<iso> | null",
      "error":       "<last error message> | null"
    }

Finished items stay in history (default cap 200) so the user can see
what ran overnight. Only the currently-queued items matter after a
server restart — the existing run_queue.init_on_startup pattern is
mirrored here to demote any orphaned `running` row back to `queued`.

Storage: JsonLedger (json_ledger.py) — atomic writes + path-keyed lock.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from json_ledger import get_ledger

DEFAULT_HISTORY_CAP = 200


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "social_queue.json")


def _ledger(project_root: str):
    return get_ledger(
        _path(project_root),
        default={"items": [], "history_cap": DEFAULT_HISTORY_CAP},
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _prune(items: list[dict], cap: int) -> list[dict]:
    """Keep ALL pending + running, and only the most recent `cap` finished."""
    active, finished = [], []
    for it in items:
        if it.get("status") in ("queued", "running"):
            active.append(it)
        else:
            finished.append(it)
    finished.sort(
        key=lambda it: it.get("finished_at") or it.get("added_at") or "",
        reverse=True,
    )
    return active + finished[:cap]


# ── Public API ───────────────────────────────────────────────────────

def enqueue_many(project_root: str, items: list[dict]) -> list[dict]:
    """
    Add multiple posts to the queue. Items already queued/running for the
    same post_id are skipped so a double-click doesn't duplicate work.

    `items` shape: [{"post_id": str, "title": str}]
    Returns the list of queue rows that were actually added.
    """
    if not items:
        return []
    added: list[dict] = []
    with _ledger(project_root).mutate() as data:
        data.setdefault("items", [])
        data.setdefault("history_cap", DEFAULT_HISTORY_CAP)
        active_ids = {
            it["post_id"] for it in data["items"]
            if it.get("status") in ("queued", "running")
        }
        for src in items:
            pid = str(src.get("post_id") or "").strip()
            if not pid or pid in active_ids:
                continue
            row = {
                "queue_id":    uuid.uuid4().hex,
                "post_id":     pid,
                "title":       str(src.get("title") or ""),
                "status":      "queued",
                "added_at":    _now(),
                "started_at":  None,
                "finished_at": None,
                "error":       None,
            }
            data["items"].append(row)
            active_ids.add(pid)
            added.append(row)
        data["items"] = _prune(data["items"], data["history_cap"])
    return added


def snapshot(project_root: str) -> dict:
    """Return the current queue state for the UI. Thread-safe read."""
    with _ledger(project_root).read() as data:
        data.setdefault("items", [])
        data.setdefault("history_cap", DEFAULT_HISTORY_CAP)
        return data


def pop_next(project_root: str) -> Optional[dict]:
    """
    Pick the oldest queued item, mark it running, and return it. Returns
    None when there's nothing to run.
    """
    with _ledger(project_root).mutate() as data:
        for it in data.get("items", []):
            if it.get("status") == "queued":
                it["status"] = "running"
                it["started_at"] = _now()
                it["error"] = None
                return dict(it)
        return None


def finish(project_root: str, queue_id: str,
           *, ok: bool, error: Optional[str] = None) -> None:
    """Mark a previously-popped row as done or failed."""
    with _ledger(project_root).mutate() as data:
        for it in data.get("items", []):
            if it.get("queue_id") == queue_id:
                it["status"] = "done" if ok else "failed"
                it["finished_at"] = _now()
                it["error"] = None if ok else (error or "unknown error")
                break
        data["items"] = _prune(data.get("items", []),
                               data.get("history_cap", DEFAULT_HISTORY_CAP))


def cancel(project_root: str, queue_id: str) -> bool:
    """
    Cancel a queued or finished entry. Running items can't be cancelled
    mid-LLM-call (no safe way to interrupt the requests library), so we
    just refuse to cancel running.
    """
    with _ledger(project_root).mutate() as data:
        for it in data.get("items", []):
            if it.get("queue_id") == queue_id:
                if it.get("status") == "running":
                    return False
                if it.get("status") == "queued":
                    it["status"] = "cancelled"
                    it["finished_at"] = _now()
                else:
                    # done/failed/already-cancelled: drop the row
                    data["items"] = [x for x in data["items"] if x is not it]
                data["items"] = _prune(data.get("items", []),
                                       data.get("history_cap", DEFAULT_HISTORY_CAP))
                return True
    return False


def clear_history(project_root: str) -> int:
    """Remove all finished (done / failed / cancelled) rows."""
    with _ledger(project_root).mutate() as data:
        before = len(data.get("items", []))
        data["items"] = [
            it for it in data.get("items", [])
            if it.get("status") in ("queued", "running")
        ]
        return before - len(data["items"])


def init_on_startup(project_root: str) -> int:
    """
    Demote any 'running' rows back to 'queued' — those got orphaned by a
    crashed / restarted server. Returns the number of rows recovered.
    """
    recovered = 0
    with _ledger(project_root).mutate() as data:
        for it in data.get("items", []):
            if it.get("status") == "running":
                it["status"] = "queued"
                it["started_at"] = None
                recovered += 1
    return recovered

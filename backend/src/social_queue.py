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
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

_lock = Lock()
DEFAULT_HISTORY_CAP = 200


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "social_queue.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(path: str) -> dict:
    if not os.path.isfile(path):
        return {"items": [], "history_cap": DEFAULT_HISTORY_CAP}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("items", [])
        data.setdefault("history_cap", DEFAULT_HISTORY_CAP)
        return data
    except Exception:
        return {"items": [], "history_cap": DEFAULT_HISTORY_CAP}


def _save(path: str, data: dict) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        # Not fatal — the queue lives mostly in memory during a worker
        # tick; the next successful save will catch up.
        pass


def _prune(items: list[dict], cap: int) -> list[dict]:
    """Keep ALL pending + running, and only the most recent `cap` finished."""
    active, finished = [], []
    for it in items:
        if it.get("status") in ("queued", "running"):
            active.append(it)
        else:
            finished.append(it)
    # Newest-first by finished_at (fall back to added_at).
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
    Returns the list of queue rows that were actually added (possibly
    fewer than requested when dedup-skipped).
    """
    if not items:
        return []
    p = _path(project_root)
    with _lock:
        data = _load(p)
        active_ids = {
            it["post_id"] for it in data["items"]
            if it.get("status") in ("queued", "running")
        }
        added = []
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
        _save(p, data)
    return added


def snapshot(project_root: str) -> dict:
    """Return the current queue state for the UI. Thread-safe read."""
    with _lock:
        return _load(_path(project_root))


def pop_next(project_root: str) -> Optional[dict]:
    """
    Pick the oldest queued item, mark it running, and return it. Returns
    None when there's nothing to run. Callers should invoke this from the
    worker loop then report back via `finish()`.
    """
    p = _path(project_root)
    with _lock:
        data = _load(p)
        for it in data["items"]:
            if it.get("status") == "queued":
                it["status"] = "running"
                it["started_at"] = _now()
                it["error"] = None
                _save(p, data)
                return dict(it)
        return None


def finish(project_root: str, queue_id: str,
           *, ok: bool, error: Optional[str] = None) -> None:
    """Mark a previously-popped row as done or failed."""
    p = _path(project_root)
    with _lock:
        data = _load(p)
        for it in data["items"]:
            if it.get("queue_id") == queue_id:
                it["status"] = "done" if ok else "failed"
                it["finished_at"] = _now()
                it["error"] = None if ok else (error or "unknown error")
                break
        data["items"] = _prune(data["items"], data["history_cap"])
        _save(p, data)


def cancel(project_root: str, queue_id: str) -> bool:
    """
    Cancel a queued or finished entry. Running items can't be cancelled
    mid-LLM-call (no safe way to interrupt the requests library), so
    this just marks them cancelled AFTER they finish by flipping the
    status — the worker notices on its next cycle and skips the
    completion update. For simplicity we just refuse to cancel running.
    """
    p = _path(project_root)
    with _lock:
        data = _load(p)
        for it in data["items"]:
            if it.get("queue_id") == queue_id:
                if it.get("status") == "running":
                    return False
                if it.get("status") == "queued":
                    it["status"] = "cancelled"
                    it["finished_at"] = _now()
                # done/failed/cancelled: just drop from the list
                data["items"] = [x for x in data["items"] if x is not it] if it.get("status") != "cancelled" else data["items"]
                data["items"] = _prune(data["items"], data["history_cap"])
                _save(p, data)
                return True
    return False


def clear_history(project_root: str) -> int:
    """Remove all finished (done / failed / cancelled) rows."""
    p = _path(project_root)
    removed = 0
    with _lock:
        data = _load(p)
        before = len(data["items"])
        data["items"] = [
            it for it in data["items"]
            if it.get("status") in ("queued", "running")
        ]
        removed = before - len(data["items"])
        _save(p, data)
    return removed


def init_on_startup(project_root: str) -> int:
    """
    Demote any 'running' rows back to 'queued' — those got orphaned by a
    crashed / restarted server. Returns the number of rows recovered.
    """
    p = _path(project_root)
    recovered = 0
    with _lock:
        data = _load(p)
        for it in data["items"]:
            if it.get("status") == "running":
                it["status"] = "queued"
                it["started_at"] = None
                recovered += 1
        if recovered:
            _save(p, data)
    return recovered

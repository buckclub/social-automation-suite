"""
Script-review pause point for the Reddit pipeline.

Sits between the format/preprocess phase and TTS, giving the operator
a chance to fix OP typos, awkward phrasing, or weird AI normalization
artifacts before paid TTS runs. Off by default — flips on via
config.pipeline.script_review_enabled.

Mechanism:
  - The pipeline awaits an asyncio.Event keyed by post_id.
  - Approve / Cancel endpoints write the operator's edits to disk and
    set the event.
  - Pipeline reads the edited values back, swaps the in-memory
    title/body/comments, and continues.

State file (`posts/<post_id>/script_review.json`):
  {
    "status": "pending" | "approved" | "cancelled",
    "title": "<post-prefilter title>",
    "post_body": "<post-prefilter body>",
    "comments": [{"author": "...", "body": "..."}, ...],
    "edited": {
      "title": "<operator's final title>",
      "post_body": "<final body>",
      "comments": [...]
    },
    "created_at": "...",
    "decided_at": "..."
  }

Why a separate file vs piggybacking on summary.json: the review state
is transient (deleted after pipeline completes), and conflating it
with the canonical post snapshot makes audit trails confusing. Pure
side channel.
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# Per-post asyncio.Event registry. Keys are post_ids; values are the
# events the pipeline awaits. Cleaned up after each review resolves so
# the dict doesn't grow unbounded across long-running sessions.
_events: Dict[str, asyncio.Event] = {}

# Per-post final decision payload set by approve / cancel. The pipeline
# reads this after the event fires to know whether to continue + what
# edits to apply.
_decisions: Dict[str, Dict[str, Any]] = {}


def _state_path(project_root: str, post_id: str) -> str:
    return os.path.join(project_root, "posts", post_id, "script_review.json")


def is_enabled(config: dict) -> bool:
    """Single source of truth for the toggle. Defaults False so existing
    pipelines stay straight-through unless the user opts in."""
    pipe = (config or {}).get("pipeline") or {}
    return bool(pipe.get("script_review_enabled"))


def begin_review(project_root: str, post_id: str, title: str,
                 post_body: str, comments: List[dict]) -> str:
    """Persist the pre-edit script + create the awaiter event.

    Called by the pipeline right before it would start TTS. Returns the
    state-file path so the caller can log it; the actual blocking
    happens via `await_decision`."""
    path = _state_path(project_root, post_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "status": "pending",
        "title": title or "",
        "post_body": post_body or "",
        # Keep the same dict shape the rest of the pipeline uses so the
        # frontend can round-trip without remapping fields.
        "comments": [
            {"author": c.get("author", "Anonymous"), "body": c.get("body", "")}
            for c in (comments or [])
        ],
        "edited": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "decided_at": None,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    # Fresh event each time — overwriting any stale one from a previous
    # cancelled run for the same post_id.
    _events[post_id] = asyncio.Event()
    _decisions.pop(post_id, None)
    return path


def read_pending(project_root: str, post_id: str) -> Optional[dict]:
    """Return the pending review payload, or None if nothing is awaiting.

    Used by the GET endpoint that the frontend polls / fetches when the
    pipeline panel sees an `awaiting_review` step state."""
    path = _state_path(project_root, post_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    if data.get("status") != "pending":
        return None
    return data


@dataclass
class ReviewDecision:
    """What the pipeline gets back after the user clicks Approve/Cancel.

    `approved=False` means the user cancelled and the pipeline should
    abort. `edited` carries the (possibly user-modified) text — the
    pipeline swaps these into its in-memory variables before TTS."""
    approved: bool
    title: str
    post_body: str
    comments: List[dict]


async def await_decision(post_id: str, timeout_s: Optional[float] = None) -> ReviewDecision:
    """Block the pipeline until the user approves or cancels.

    `timeout_s=None` waits forever. The pipeline can pass a value (e.g.
    30 minutes) for a defensive auto-cancel — without one a forgotten
    review would tie up the queue indefinitely.

    Raises asyncio.TimeoutError on timeout; caller decides what to do
    (log + treat as cancel is the typical handling)."""
    evt = _events.get(post_id)
    if evt is None:
        # No event registered — either review wasn't started or another
        # decision already cleaned up. Surface as cancelled rather than
        # silently continuing with empty edits.
        return ReviewDecision(approved=False, title="", post_body="", comments=[])

    if timeout_s is not None:
        await asyncio.wait_for(evt.wait(), timeout=timeout_s)
    else:
        await evt.wait()

    decision = _decisions.pop(post_id, None) or {"approved": False}
    # Always pop the event so a reused post_id starts fresh next run.
    _events.pop(post_id, None)
    return ReviewDecision(
        approved=bool(decision.get("approved", False)),
        title=str(decision.get("title", "")),
        post_body=str(decision.get("post_body", "")),
        comments=list(decision.get("comments") or []),
    )


def submit_decision(project_root: str, post_id: str, *,
                    approved: bool,
                    title: str = "",
                    post_body: str = "",
                    comments: Optional[List[dict]] = None) -> bool:
    """Operator's verdict from the UI. Persists to the state file and
    fires the event. Returns False if there's no pending review for
    this post (stale UI / double-submit)."""
    if post_id not in _events:
        return False

    path = _state_path(project_root, post_id)
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            payload = {}
    else:
        payload = {}

    safe_comments = [
        {"author": str(c.get("author", "Anonymous")), "body": str(c.get("body", ""))}
        for c in (comments or [])
    ]
    payload["status"] = "approved" if approved else "cancelled"
    payload["decided_at"] = datetime.now(timezone.utc).isoformat()
    payload["edited"] = {
        "title": title,
        "post_body": post_body,
        "comments": safe_comments,
    } if approved else None

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
    except Exception:
        # File write failures are non-fatal for the pipeline — the event
        # still needs to fire or the pipeline hangs forever.
        pass

    _decisions[post_id] = {
        "approved": approved,
        "title": title,
        "post_body": post_body,
        "comments": safe_comments,
    }
    evt = _events.get(post_id)
    if evt is not None:
        evt.set()
    return True


def is_pending(post_id: str) -> bool:
    """True if a review is currently awaiting input. The pipeline panel
    uses this (via the GET endpoint) to flip the UI into 'awaiting review'
    mode without needing a whole new SSE event type."""
    return post_id in _events and not _events[post_id].is_set()


def cleanup(project_root: str, post_id: str) -> None:
    """Best-effort delete of the state file after the pipeline completes
    (success or failure). Keeps the posts directory tidy across runs.
    Failures are silent — leftover review files are harmless."""
    path = _state_path(project_root, post_id)
    try:
        if os.path.isfile(path):
            os.remove(path)
    except Exception:
        pass

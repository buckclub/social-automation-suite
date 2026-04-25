"""
Central AI virality-score cache.

Before this module: each score was written to `posts/<id>/viral_score.json`,
which got wiped whenever `auto_cleanup` nuked the post workspace. That
meant users had to re-burn tokens scoring the same posts every time they
came back.

Now: a single `.cache/ai_scores.json` holds every score ever produced,
keyed by post id, with:

  {
    "v": 3,                            # cache schema version
    "entries": {
      "1abc2de": {
        "result": { ... the AiScore dict the UI expects ... },
        "model":  "qwen2.5:14b",
        "title":  "<cached for invalidation>",
        "content_hash": "<sha1 of title + first 500 chars of selftext>",
        "created_at":    "<iso>",
        "last_used_at":  "<iso>"
      },
      ...
    }
  }

Lookup by `post_id` returns the entry only if:
  - model matches the CURRENT configured AI model (so changing provider
    re-scores), AND
  - the content hash still matches the current post title + body prefix
    (catches edited posts that changed substantially)

`touch()` bumps `last_used_at` on every discovery pass so a post that's
still being seen in listings never gets pruned. `prune()` drops any
entry whose `last_used_at` is older than `ttl_days`.
"""
from __future__ import annotations
import hashlib
import json
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from json_ledger import get_ledger

SCHEMA_VERSION = 3
DEFAULT_TTL_DAYS = 7


# ── Paths ───────────────────────────────────────────────────────────

def _cache_path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "ai_scores.json")


def _ledger(project_root: str):
    return get_ledger(
        _cache_path(project_root),
        default={"v": SCHEMA_VERSION, "entries": {}},
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _content_hash(title: str, selftext: str) -> str:
    """Short digest of title + first 500 body chars. Stable across cosmetic
    edits (whitespace, trailing punctuation) by doing a light normalise."""
    body = (selftext or "")[:500]
    norm = (title or "").strip().lower() + "\n" + body.strip().lower()
    return hashlib.sha1(norm.encode("utf-8", errors="replace")).hexdigest()[:16]


def _ensure_schema(data: dict) -> dict:
    """Reset the cache if the schema has bumped. Always returns a usable dict."""
    if data.get("v") != SCHEMA_VERSION or "entries" not in data:
        data.clear()
        data["v"] = SCHEMA_VERSION
        data["entries"] = {}
    return data


# ── Public API ──────────────────────────────────────────────────────

def get(project_root: str, post_id: str, *,
        current_title: str, current_body: str, current_model: str) -> Optional[dict]:
    """
    Return the cached AiScore dict for this post if the model + content
    still match, otherwise None. Updates last_used_at on a hit so prune
    doesn't drop a post the user is actively seeing.
    """
    if not post_id:
        return None
    h_now = _content_hash(current_title, current_body)
    with _ledger(project_root).mutate() as data:
        _ensure_schema(data)
        entry = data["entries"].get(post_id)
        if not entry:
            return None
        if entry.get("model") != current_model:
            return None
        if entry.get("content_hash") != h_now:
            return None
        entry["last_used_at"] = _now_iso()
        return entry.get("result")


def put(project_root: str, post_id: str, *,
        title: str, selftext: str, model: str, result: dict) -> None:
    """Insert-or-replace a score for this post."""
    if not post_id:
        return
    with _ledger(project_root).mutate() as data:
        _ensure_schema(data)
        data["entries"][post_id] = {
            "result":        result,
            "model":         model,
            "title":         (title or "")[:240],
            "content_hash":  _content_hash(title, selftext),
            "created_at":    _now_iso(),
            "last_used_at":  _now_iso(),
        }


def touch(project_root: str, post_ids: list[str]) -> int:
    """
    Bump last_used_at on every given post_id that exists in the cache.
    Returns count of entries actually touched.
    """
    if not post_ids:
        return 0
    now = _now_iso()
    touched = 0
    with _ledger(project_root).mutate() as data:
        _ensure_schema(data)
        for pid in post_ids:
            e = data["entries"].get(pid)
            if e:
                e["last_used_at"] = now
                touched += 1
    return touched


def prune(project_root: str, *, ttl_days: int = DEFAULT_TTL_DAYS) -> int:
    """Drop entries not touched in > ttl_days. Returns number removed."""
    if ttl_days <= 0:
        return 0  # disabled
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    removed = 0
    with _ledger(project_root).mutate() as data:
        _ensure_schema(data)
        to_drop = []
        for pid, e in data["entries"].items():
            try:
                last = datetime.fromisoformat(e.get("last_used_at") or e.get("created_at") or "")
            except Exception:
                to_drop.append(pid)
                continue
            if last < cutoff:
                to_drop.append(pid)
        for pid in to_drop:
            data["entries"].pop(pid, None)
            removed += 1
    return removed


def size(project_root: str) -> int:
    """How many entries are currently cached. Cheap, for diagnostics."""
    with _ledger(project_root).read() as data:
        _ensure_schema(data)
        return len(data["entries"])


def clear(project_root: str) -> int:
    """Wipe everything. Returns count cleared."""
    with _ledger(project_root).mutate() as data:
        _ensure_schema(data)
        n = len(data["entries"])
        data["entries"] = {}
        return n


def snapshot(project_root: str) -> dict:
    """Full snapshot for the cache-admin endpoint."""
    with _ledger(project_root).read() as data:
        _ensure_schema(data)
        return {
            "size":     len(data["entries"]),
            "entries":  data["entries"],
            "path":     _cache_path(project_root),
        }


# ── One-time migration from the legacy per-post cache ─────────────

def migrate_from_legacy_per_post(project_root: str) -> int:
    """
    Sweep `posts/<id>/viral_score.json` on startup. If the AI-score cache
    doesn't already have an entry for that id, import the legacy row.
    Returns number migrated. Safe to run repeatedly — later passes are
    no-ops for already-migrated ids.
    """
    posts_root = os.path.join(project_root, "posts")
    if not os.path.isdir(posts_root):
        return 0
    migrated = 0
    with _ledger(project_root).mutate() as data:
        _ensure_schema(data)
        entries = data["entries"]
        for pid in os.listdir(posts_root):
            if pid in entries:
                continue
            legacy = os.path.join(posts_root, pid, "viral_score.json")
            if not os.path.isfile(legacy):
                continue
            try:
                with open(legacy, "r", encoding="utf-8") as f:
                    legacy_row = json.load(f)
            except Exception:
                continue
            title = legacy_row.get("title") or ""
            model = legacy_row.get("model") or ""
            result = legacy_row.get("result")
            if not result:
                continue
            entries[pid] = {
                "result":        result,
                "model":         model,
                "title":         title[:240],
                "content_hash":  _content_hash(title, ""),
                "created_at":    _now_iso(),
                "last_used_at":  _now_iso(),
            }
            migrated += 1
    return migrated

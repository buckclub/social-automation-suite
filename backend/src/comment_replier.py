"""
Comment Replier — fetches top-level YouTube comments on the user's
uploaded videos, generates draft replies in the active brand voice,
and (optionally) posts them once the user approves.

Read flow uses just the YT Data API key (`commentThreads.list`, 1 unit
per call). Write flow needs OAuth with `youtube.force-ssl` scope and
`comments.insert` (50 units per reply).

Storage at .cache/comment_drafts.json:
    {
      "drafts": [
        {
          "id":              "<uuid>",
          "comment_id":      "<YT top-level comment id>",
          "thread_id":       "<YT commentThread id — used as parentId for the reply>",
          "yt_video_id":     "<YT video id>",
          "post_id":         "<our local post id>",
          "brand_id":        "<active brand at fetch time>",
          "comment_text":    "...",
          "comment_author":  "...",
          "comment_url":     "https://youtube.com/watch?v=…&lc=…",
          "draft_reply":     "<LLM-generated suggestion>",
          "edited_reply":    null | "<user-edited override>",
          "status":          "draft" | "posted" | "rejected" | "failed",
          "created_at":      "...",
          "posted_at":       null | "...",
          "error":           null | "..."
        },
        ...
      ]
    }
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import requests

from json_ledger import get_ledger


COMMENT_THREADS_URL = "https://www.googleapis.com/youtube/v3/commentThreads"


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "comment_drafts.json")


def _ledger(project_root: str):
    return get_ledger(_path(project_root), default={"drafts": []})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── YT comment fetcher (read — uses API key) ─────────────────────────

def fetch_top_level_comments(api_key: str, video_id: str, *,
                             max_results: int = 20) -> list[dict]:
    """
    Pull up to `max_results` top-level comments for a video. Returns
    raw rows with the fields we need to display + reply.
    """
    if not api_key or not video_id:
        return []
    try:
        r = requests.get(COMMENT_THREADS_URL, params={
            "part":          "snippet",
            "videoId":       video_id,
            "maxResults":    min(100, max(1, int(max_results))),
            "order":         "time",         # newest-first; lets us catch replies fast
            "textFormat":    "plainText",
            "key":           api_key,
        }, timeout=20)
        if r.status_code != 200:
            return []
        items = r.json().get("items", [])
        out = []
        for it in items:
            top = (((it.get("snippet") or {}).get("topLevelComment") or {}).get("snippet") or {})
            cid = (((it.get("snippet") or {}).get("topLevelComment") or {})).get("id") or ""
            out.append({
                "thread_id":      it.get("id") or "",
                "comment_id":     cid,
                "text":           top.get("textDisplay") or top.get("textOriginal") or "",
                "author":         top.get("authorDisplayName") or "",
                "author_channel": (top.get("authorChannelUrl") or ""),
                "published_at":   top.get("publishedAt") or "",
                "like_count":     int(top.get("likeCount", 0) or 0),
                "viewer_rating":  top.get("viewerRating") or "",
            })
        return out
    except Exception:
        return []


# ── LLM draft helper ─────────────────────────────────────────────────

def draft_reply(*,
    comment_text: str, video_title: str,
    brand_name: str, brand_persona_hint: str,
    provider: str, api_key: str, model: str, ollama_url: str,
) -> Optional[str]:
    if not comment_text:
        return None
    try:
        from gemini_hooks import _call_ai
    except Exception:
        return None
    system = (
        "You are responding to a YouTube comment as a creator. Rules:\n"
        "- 1-2 short sentences MAX. ≤180 chars.\n"
        "- No fake enthusiasm, no '@user' mentions, no emojis unless they obviously fit.\n"
        "- Read the comment carefully; if it's a question, answer it briefly. If it's a "
        "compliment, acknowledge briefly. If it's hostile or low-quality, ignore. If it's a "
        "spam/self-promo comment (URL/handle dump), output the literal string \"SKIP\".\n"
        "- Match the channel's voice."
    )
    voice_block = (
        f"Channel: {brand_name or '(unspecified)'}\n"
        + (f"Voice / persona: {brand_persona_hint}\n" if brand_persona_hint else "")
    )
    prompt = (
        f"Video title: \"{video_title}\"\n\n"
        f"{voice_block}\n"
        f"Top-level comment to reply to:\n\"\"\"\n{comment_text[:1200]}\n\"\"\"\n\n"
        "Write the reply text directly — no JSON, no quotes, no preamble. "
        "If the comment is spam/low-quality, output exactly:\nSKIP"
    )
    raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
    if not raw:
        return None
    text = raw.strip().strip("\"'")
    if text.upper().startswith("SKIP"):
        return None
    # The LLM occasionally wraps its answer in JSON despite instructions.
    if text.startswith("{"):
        try:
            d = json.loads(text)
            text = d.get("reply") or d.get("text") or ""
        except Exception:
            pass
    return text[:500] or None


# ── Drafts ledger ────────────────────────────────────────────────────

def list_drafts(project_root: str) -> list[dict]:
    with _ledger(project_root).read() as d:
        return d.get("drafts") or []


def add_drafts(project_root: str, rows: list[dict]) -> int:
    """
    Append new drafts. Skips any whose comment_id already exists in
    the ledger so re-syncing the same video doesn't duplicate.
    """
    added = 0
    with _ledger(project_root).mutate() as d:
        d.setdefault("drafts", [])
        existing = {r.get("comment_id") for r in d["drafts"] if r.get("comment_id")}
        for r in rows:
            cid = r.get("comment_id") or ""
            if not cid or cid in existing:
                continue
            row = {
                "id":             uuid.uuid4().hex[:12],
                "comment_id":     cid,
                "thread_id":      r.get("thread_id") or "",
                "yt_video_id":    r.get("yt_video_id") or "",
                "post_id":        r.get("post_id") or "",
                "brand_id":       r.get("brand_id") or "",
                "comment_text":   (r.get("comment_text") or "")[:2000],
                "comment_author": r.get("comment_author") or "",
                "comment_url":    r.get("comment_url") or "",
                "draft_reply":    (r.get("draft_reply") or "")[:500],
                "edited_reply":   None,
                "status":         "draft",
                "created_at":     _now(),
                "posted_at":      None,
                "error":          None,
            }
            d["drafts"].append(row)
            existing.add(cid)
            added += 1
    return added


def update_draft(project_root: str, draft_id: str, patch: dict) -> Optional[dict]:
    with _ledger(project_root).mutate() as d:
        for r in d.get("drafts", []):
            if r.get("id") == draft_id:
                for k in ("edited_reply", "status", "posted_at", "error"):
                    if k in patch:
                        r[k] = patch[k]
                return r
    return None


def delete_draft(project_root: str, draft_id: str) -> bool:
    with _ledger(project_root).mutate() as d:
        before = len(d.get("drafts", []))
        d["drafts"] = [r for r in d.get("drafts", []) if r.get("id") != draft_id]
        return len(d["drafts"]) != before


def get_draft(project_root: str, draft_id: str) -> Optional[dict]:
    for r in list_drafts(project_root):
        if r.get("id") == draft_id:
            return r
    return None

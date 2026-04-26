"""
Daily content-idea feed.

Niche Finder helps users discover whole NICHES they could build a
channel around. This endpoint solves the next-step problem:
"I'm already in the relationship-drama niche — what story should I
make TODAY?"

Cached 6 hours per (niche, content_filter) combination so flipping
between brands or tabs is cheap. The LLM call costs ~5-10 cents
on flagship models, ~free on local Ollama.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/ideas", tags=["ideas"])


_TTL_S = 6 * 3600  # 6 hours — fresh-enough for "daily ideas" cadence
_cache: dict[str, dict] = {}  # key → {"fetched_at": float, "data": dict}


def _cache_key(niche: str, content_filter: str, count: int) -> str:
    raw = f"{niche}|{content_filter}|{count}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


@router.post("/daily")
async def generate_daily_ideas(req: dict):
    """
    Body:
      {
        "niche":           str (required, e.g. "relationship_drama"),
        "content_filter":  "safe" | "normal" | "edgy" (default normal),
        "count":           int 3-8 (default 5),
        "force":           bool (default false — skip cache)
      }
    Returns:
      {
        "fetched_at": iso,
        "from_cache": bool,
        "ideas": [
          {
            "title":          "≤90 char hook-style title",
            "premise":        "≤220 char setup paragraph",
            "content_style":  "story" | "qa" | "interactive" | "hot_take",
            "tone":           one of the standard tones,
            "why":            "≤140 char rationale — why this works now"
          },
          ...
        ]
      }
    """
    from api_server import _load_config, pick_feature_model, _log

    niche = (req.get("niche") or "").strip()
    if not niche:
        raise HTTPException(400, "niche is required")
    cf = (req.get("content_filter") or "normal").strip().lower()
    if cf not in ("safe", "normal", "edgy"):
        cf = "normal"
    try:
        count = max(3, min(8, int(req.get("count") or 5)))
    except (TypeError, ValueError):
        count = 5
    force = bool(req.get("force"))

    key = _cache_key(niche, cf, count)
    now = time.time()
    if not force:
        hit = _cache.get(key)
        if hit and now - hit["fetched_at"] < _TTL_S:
            return {**hit["data"], "from_cache": True}

    cfg = _load_config()
    g = cfg.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    # Reuse the niche_finder feature override since these are
    # adjacent in spirit — both are 'what should I make' brainstorming.
    model = pick_feature_model(cfg, "niche_finder")
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    # Pull niche metadata from the merged niches dict for context.
    try:
        from ai_content_generator import merged_niches
        niche_info = merged_niches(cfg).get(niche, {"name": niche, "themes": "", "subs": ""})
    except Exception:
        niche_info = {"name": niche, "themes": "", "subs": ""}

    system = (
        "You are an idea-firehose for a short-form-video creator. Generate "
        "FRESH, SPECIFIC story prompts they could record today — each one "
        "must be a concrete situation with a hook, not a generic theme. "
        "Avoid clichés the niche has been beaten to death with. Prefer "
        "premises that suggest a real plot twist or strong emotional beat. "
        "Return ONLY minified JSON, no markdown."
    )
    prompt = (
        f"Niche: {niche_info.get('name') or niche}\n"
        f"Themes the niche covers: {niche_info.get('themes') or 'general'}\n"
        f"Source subreddits (for tone reference): {niche_info.get('subs') or 'mixed'}\n"
        f"Content filter: {cf}\n\n"
        f"Generate {count} story-prompt ideas for today. Each idea should be a\n"
        "specific premise (one situation, one POV, one tension) — NOT a topic\n"
        "category. The viewer should be able to picture what the video looks\n"
        "like just from the title.\n\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "ideas": [\n'
        '    {"title": "<≤90 char hook-style title>",\n'
        '     "premise": "<≤220 char specific setup of the situation>",\n'
        '     "content_style": "story|qa|interactive|hot_take",\n'
        '     "tone": "dramatic|funny|heartfelt|shocking|cringe",\n'
        '     "why": "<≤140 char rationale — why this works as short-form>"}\n'
        "  ]\n"
        "}"
    )

    from gemini_hooks import _call_ai
    raw = await asyncio.to_thread(_call_ai, provider, api_key, prompt, system, model, ollama_url)
    if not raw:
        raise HTTPException(502, f"AI provider '{provider}' returned empty response")

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip("`").strip()
    try:
        parsed = json.loads(cleaned)
    except Exception:
        a, b = cleaned.find("{"), cleaned.rfind("}")
        if a >= 0 and b > a:
            try:
                parsed = json.loads(cleaned[a:b + 1])
            except Exception:
                raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")
        else:
            raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")

    ideas_in = (parsed.get("ideas") or []) if isinstance(parsed, dict) else []
    ideas_out: list[dict] = []
    for it in ideas_in[:count]:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()[:120]
        premise = str(it.get("premise") or "").strip()[:280]
        if not title or not premise:
            continue
        cs = str(it.get("content_style") or "story").strip().lower()
        if cs not in ("story", "qa", "interactive", "hot_take"):
            cs = "story"
        tone = str(it.get("tone") or "dramatic").strip().lower()
        if tone not in ("dramatic", "funny", "heartfelt", "shocking", "cringe"):
            tone = "dramatic"
        ideas_out.append({
            "title": title,
            "premise": premise,
            "content_style": cs,
            "tone": tone,
            "why": str(it.get("why") or "").strip()[:160],
        })

    if not ideas_out:
        raise HTTPException(502, "AI returned no usable ideas")

    data = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "ideas": ideas_out,
        "niche": niche,
        "content_filter": cf,
        "from_cache": False,
    }
    _cache[key] = {"fetched_at": now, "data": data}
    _log(f"Daily ideas: generated {len(ideas_out)} for niche={niche} filter={cf}")
    return data

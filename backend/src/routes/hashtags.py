"""
Hashtag Lab router — ranks hashtags for a caption using YouTube benchmark
references plus an LLM-driven strategist prompt. Strict JSON output.

Quota: ~100 YT units per analysis when a niche + YT key is supplied;
zero otherwise (graceful no-op without benchmarks).
"""
from __future__ import annotations

import asyncio
import json
import re
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/hashtags", tags=["hashtags"])


@router.post("/analyze")
async def analyze_hashtags(req: dict):
    """
    Body: { caption: str, niche?: str, platform?: "tiktok"|"instagram"|"youtube"|"all" }
    Returns:
      {
        "suggestions": [{ "tag": "#aita", "score": 87, "reason": "..." }, …],
        "from_caption": ["#existingTag", …],
        "benchmarks_used": int,
        "provider": str, "model": str
      }
    """
    from api_server import _load_config, PROJECT_ROOT, _log

    caption = (req.get("caption") or "").strip()
    if not caption:
        raise HTTPException(400, "caption is required")
    niche = (req.get("niche") or "").strip()
    platform = (req.get("platform") or "all").strip().lower()
    if platform not in ("tiktok", "instagram", "youtube", "all"):
        platform = "all"

    config = _load_config()
    g = config.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")
    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    existing = re.findall(r"#[\w_]+", caption)
    existing_lower = {t.lower() for t in existing}

    yt_cfg = config.get("youtube", {}) or {}
    yt_key = yt_cfg.get("api_key", "")
    benchmarks: list[dict] = []
    if yt_key and niche:
        try:
            from youtube_benchmarks import fetch_benchmarks
            benchmarks = fetch_benchmarks(
                f"{niche} reddit stories shorts" if niche else "reddit stories shorts",
                yt_key, project_root=PROJECT_ROOT, count=8,
            )
        except Exception as e:
            _log(f"Hashtag Lab: benchmark fetch failed: {e}")

    benchmarks_block = ""
    if benchmarks:
        lines = []
        for i, b in enumerate(benchmarks[:8], 1):
            tags_str = ", ".join(b.get("tags", [])[:10]) or "(no tags)"
            lines.append(
                f"[{i}] {b.get('view_count', 0):,} views — \"{b.get('title','')}\"\n"
                f"    tags: {tags_str}"
            )
        benchmarks_block = (
            "\n\n=== HIGH-PERFORMING VIDEOS IN THIS NICHE (tag references) ===\n"
            + "\n\n".join(lines) + "\n"
        )

    system = (
        "You are a hashtag strategist for short-form video. Return ONLY minified "
        "JSON, no markdown. Each suggestion must be a real, currently-active hashtag "
        "(no fabricated trends). Score 0-100 reflecting how well the tag matches the "
        "caption's content AND its likely reach on the target platform. Avoid generic "
        "filler unless the benchmarks clearly use it."
    )

    prompt = (
        f"Caption to analyze:\n\"{caption[:1500]}\"\n\n"
        f"Niche: {niche or '(unspecified)'}\n"
        f"Target platform: {platform}\n"
        f"Tags already in the caption (do NOT re-recommend): {', '.join(existing) or 'none'}\n"
        + benchmarks_block +
        "\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "suggestions": [\n'
        '    {"tag": "#example", "score": 85, "reason": "<≤80 chars why this fits>"},\n'
        '    ...\n'
        "  ]\n"
        "}\n\n"
        "Return 12-20 suggestions, sorted by score descending. Mix:\n"
        "- 3-5 core niche tags (the ones with the most accounts following them)\n"
        "- 4-6 specific topical tags drawn from the caption's actual content\n"
        "- 2-3 algorithmic reach tags (#fyp / #foryoupage etc) IF appropriate to platform\n"
        "- 2-3 long-tail / community tags that target specific audiences\n"
        "Tags MUST start with '#'. No spaces inside tags. Lowercase except for proper nouns."
    )

    from gemini_hooks import _call_ai  # type: ignore
    # Synchronous network call; bounce to a worker thread so we don't
    # block the asyncio event loop for the LLM round-trip (5-30 s
    # depending on provider).
    raw = await asyncio.to_thread(
        _call_ai, provider, api_key, prompt, system, model, ollama_url,
    )
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
        s = cleaned.find("{"); e = cleaned.rfind("}")
        if s >= 0 and e > s:
            try: parsed = json.loads(cleaned[s:e + 1])
            except Exception:
                raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")
        else:
            raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")

    suggestions = []
    for s in (parsed.get("suggestions") or []):
        tag = (s.get("tag") or "").strip()
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = "#" + tag
        if tag.lower() in existing_lower:
            continue
        try:
            score = int(s.get("score") or 0)
        except (TypeError, ValueError):
            score = 0
        suggestions.append({
            "tag": tag,
            "score": max(0, min(100, score)),
            "reason": str(s.get("reason") or "")[:140],
        })
    suggestions.sort(key=lambda x: x["score"], reverse=True)

    return {
        "suggestions": suggestions,
        "from_caption": existing,
        "benchmarks_used": len(benchmarks),
        "provider": provider,
        "model": model,
    }

"""
Niche Finder router — turns YouTube trend data + the user's brief
into ranked channel-niche ideas with channel-name suggestions and
first-video pitches.

Quota: 1 unit per trending fetch + ~100 per user keyword. Trending
cached 6h, keyword searches reuse the 24h benchmark cache.
"""
from __future__ import annotations

import asyncio
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/niches", tags=["niches"])


@router.post("/generate")
async def niches_generate(req: dict):
    from api_server import _load_config, PROJECT_ROOT
    config = _load_config()
    yt_key = (config.get("youtube") or {}).get("api_key", "")
    if not yt_key:
        raise HTTPException(400, "YouTube API key not configured (Config → Publishing).")

    g = config.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")
    provider = g.get("provider", "gemini")
    ai_api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    interests = (req.get("interests") or "").strip()
    audience  = (req.get("audience") or "").strip()
    cf = (req.get("content_filter") or "normal").strip().lower()
    if cf not in ("safe", "normal", "edgy"):
        cf = "normal"
    region = (req.get("region") or "US").strip().upper()
    try:
        count = max(3, min(10, int(req.get("count") or 6)))
    except (TypeError, ValueError):
        count = 6

    from niche_finder import generate_niches
    out = await asyncio.to_thread(
        generate_niches,
        interests=interests,
        audience=audience,
        content_filter=cf,
        region=region,
        api_key=yt_key,
        provider=provider, ai_api_key=ai_api_key, model=model, ollama_url=ollama_url,
        count=count,
        project_root=PROJECT_ROOT,
    )
    if out.get("error"):
        raise HTTPException(502, out["error"])
    return out

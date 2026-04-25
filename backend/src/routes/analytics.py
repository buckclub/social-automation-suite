"""
YouTube performance analytics router — aggregates stats across every
upload tracked by the suite, plus an LLM-driven "what's working"
recommendations endpoint.

Self-contained: a 10-minute in-process cache keeps YT quota cheap
even with hundreds of uploads. Both helpers (_gather_yt_video_ids,
_fetch_yt_stats) and the cache live in this module — they don't
escape to the rest of the app.

Dependencies on api_server module state:
  - videos_db (read-only) — to walk per-post upload rows
  - _load_config() — for the YT API key + AI provider settings
  - pick_feature_model() — for the per-feature scoring model override
  - _log() — for cache + fetch failures

These are accessed via lazy imports inside the handlers so this module
can load before api_server's globals are fully populated (mirrors the
existing routes/* convention).
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ── Cache ─────────────────────────────────────────────────────────────
# Process-local. Flushed on server restart, which is fine — the YT API
# returns the same data anyway. Bumping force=true on the request
# bypasses the TTL.
_cache: dict = {"fetched_at": 0.0, "data": None}
_TTL_S = 600  # 10 minutes


# ── YT data helpers ───────────────────────────────────────────────────

def _gather_yt_video_ids() -> list[dict]:
    """Walk videos_db; collect every (video_id, post_id, post_title) that
    has a YouTube upload row."""
    from api_server import videos_db
    out: list[dict] = []
    for v in videos_db:
        for up in (v.get("uploads") or []):
            if up.get("platform") != "youtube":
                continue
            vid = up.get("video_id")
            if not vid:
                continue
            out.append({
                "yt_video_id":    vid,
                "post_id":        v.get("id") or "",
                "post_title":     v.get("title") or "",
                "subreddit":      v.get("subreddit") or "",
                "uploaded_at":    up.get("uploaded_at") or "",
                "uploaded_title": up.get("title") or v.get("title") or "",
                "privacy":        up.get("privacy") or "private",
                "url":            up.get("url") or f"https://youtube.com/shorts/{vid}",
            })
    return out


def _fetch_yt_stats(video_ids: list[str], api_key: str) -> dict[str, dict]:
    """Batch-fetch stats from the YT v3 API. Returns {video_id: {...}}.
    Sync — call from to_thread if invoking from an async context."""
    import requests as _requests
    from api_server import _log
    out: dict[str, dict] = {}
    BATCH = 50  # API hard cap
    for i in range(0, len(video_ids), BATCH):
        batch = video_ids[i:i + BATCH]
        try:
            r = _requests.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={
                    "part": "statistics,snippet,status",
                    "id":   ",".join(batch),
                    "key":  api_key,
                },
                timeout=20,
            )
            if r.status_code != 200:
                _log(f"YT analytics batch failed: {r.status_code} {r.text[:200]}")
                continue
            for item in r.json().get("items", []):
                vid = item.get("id")
                if not vid:
                    continue
                stats = item.get("statistics", {}) or {}
                snip = item.get("snippet", {}) or {}
                status = item.get("status", {}) or {}
                out[vid] = {
                    "views":          int(stats.get("viewCount", 0) or 0),
                    "likes":          int(stats.get("likeCount", 0) or 0),
                    "comments":       int(stats.get("commentCount", 0) or 0),
                    "title":          snip.get("title", ""),
                    "published_at":   snip.get("publishedAt", ""),
                    "thumbnail":      (((snip.get("thumbnails") or {}).get("medium") or {}).get("url") or ""),
                    "privacy_status": status.get("privacyStatus", ""),
                }
        except Exception as e:
            _log(f"YT analytics batch exception: {e}")
            continue
    return out


# ── Routes ────────────────────────────────────────────────────────────

@router.get("/performance")
async def performance_analytics(force: bool = False):
    """
    Aggregate stats across every YouTube upload tracked by the suite.
    Cached for 10 minutes per fetch — `/videos` quota is 1 unit per
    50-video batch.
    """
    from api_server import _load_config
    cfg = _load_config()
    yt_cfg = cfg.get("youtube", {}) or {}
    api_key = yt_cfg.get("api_key", "")
    if not api_key:
        raise HTTPException(400, "YouTube API key not configured (Config → Publishing).")

    # Cache hit?
    now = time.time()
    if not force and _cache["data"] is not None:
        if now - _cache["fetched_at"] < _TTL_S:
            return _cache["data"]

    rows = _gather_yt_video_ids()
    if not rows:
        return {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "videos": [], "totals": {"videos": 0, "views": 0, "likes": 0, "comments": 0, "days_tracked": 0},
            "averages": {"views": 0, "likes": 0, "comments": 0},
            "top": [], "by_day": [],
        }

    stats_map = await asyncio.to_thread(
        _fetch_yt_stats, [r["yt_video_id"] for r in rows], api_key,
    )

    enriched = []
    for r in rows:
        s = stats_map.get(r["yt_video_id"])
        if not s:
            continue
        enriched.append({**r, **s})
    enriched.sort(key=lambda x: x.get("views", 0), reverse=True)

    total_views    = sum(x.get("views", 0)    for x in enriched)
    total_likes    = sum(x.get("likes", 0)    for x in enriched)
    total_comments = sum(x.get("comments", 0) for x in enriched)
    n = len(enriched) or 1

    # Group views by published_at date for the trend sparkline.
    by_day_map: dict[str, dict] = defaultdict(lambda: {"count": 0, "views": 0, "likes": 0})
    earliest = ""
    for x in enriched:
        d = (x.get("published_at") or "")[:10]
        if not d:
            continue
        if not earliest or d < earliest:
            earliest = d
        by_day_map[d]["count"] += 1
        by_day_map[d]["views"] += x.get("views", 0)
        by_day_map[d]["likes"] += x.get("likes", 0)
    sorted_days = sorted(by_day_map.items())[-30:]
    by_day = [{"date": d, **v} for d, v in sorted_days]

    days_tracked = 0
    if earliest:
        try:
            e = datetime.fromisoformat(earliest)
            days_tracked = max(
                1,
                (datetime.now(timezone.utc).replace(tzinfo=None) - e.replace(tzinfo=None)).days,
            )
        except Exception:
            days_tracked = 0

    out = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "videos": enriched,
        "totals": {
            "videos": len(enriched), "views": total_views,
            "likes": total_likes, "comments": total_comments,
            "days_tracked": days_tracked,
        },
        "averages": {
            "views":    int(total_views / n),
            "likes":    int(total_likes / n),
            "comments": int(total_comments / n),
        },
        "top":    enriched[:5],
        "by_day": by_day,
    }
    _cache["data"] = out
    _cache["fetched_at"] = now
    return out


@router.post("/recommendations")
async def performance_recommendations():
    """
    LLM-powered diagnosis of what's working / what isn't across the
    user's tracked YouTube uploads. Compares top vs bottom performers
    and returns actionable, specific recommendations.

    Reuses the cached performance data so it doesn't re-spend YT quota.
    """
    from api_server import _load_config, pick_feature_model, videos_db

    cfg = _load_config()
    g = cfg.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    perf = _cache.get("data")
    if not perf:
        # Trigger a fresh fetch via the route handler — which reads
        # cache too, so this is a single source of truth for the
        # data shape.
        perf = await performance_analytics(force=False)
        if not isinstance(perf, dict):
            perf = {}

    videos = perf.get("videos") or []
    if len(videos) < 3:
        raise HTTPException(400, "Need at least 3 tracked videos to compare. Publish a few more and try again.")

    # Group by brand so we can highlight cross-brand patterns when relevant.
    by_brand: dict[str, list[dict]] = {}
    for v in videos:
        brand = "—"
        try:
            for r in videos_db:
                for up in (r.get("uploads") or []):
                    if up.get("video_id") == v.get("yt_video_id"):
                        brand = r.get("brand_name") or "—"
                        break
        except Exception:
            pass
        by_brand.setdefault(brand, []).append(v)

    sorted_videos = sorted(videos, key=lambda x: x.get("views", 0), reverse=True)
    top = sorted_videos[:5]
    bottom = sorted_videos[-5:]
    median_views = sorted_videos[len(sorted_videos) // 2].get("views", 0)

    def _vrow(v):
        return (
            f"- \"{v.get('title','')[:120]}\" · "
            f"{v.get('views', 0):,} views · "
            f"{v.get('likes', 0):,} likes · "
            f"{v.get('comments', 0):,} comments · "
            f"published {v.get('published_at', '')[:10]}"
        )

    brand_lines = []
    for brand, vs in by_brand.items():
        if len(vs) < 2:
            continue
        avg = sum(x.get("views", 0) for x in vs) // max(1, len(vs))
        brand_lines.append(f"  · {brand}: {len(vs)} videos, avg {avg:,} views")

    block = (
        f"Total tracked: {len(videos)} videos. "
        f"Median views: {median_views:,}.\n\n"
        f"TOP 5 performers:\n" + "\n".join(_vrow(v) for v in top) + "\n\n"
        f"BOTTOM 5 performers:\n" + "\n".join(_vrow(v) for v in bottom)
    )
    if brand_lines:
        block += "\n\nBy brand:\n" + "\n".join(brand_lines)

    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    # Performance-recommendation analysis isn't latency-critical; honor
    # any per-feature override the user set, but it's reasonable to
    # leave it on the flagship model since users only run it once
    # every few days.
    model = pick_feature_model(cfg, "scoring")  # share the scoring override
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    system = (
        "You are a data-driven short-form video coach. Compare the user's "
        "TOP and BOTTOM performers and surface SPECIFIC, ACTIONABLE patterns. "
        "Cite individual titles when relevant. Don't hedge — the user wants "
        "the playbook, not vague advice. Return ONLY minified JSON, no markdown."
    )
    prompt = (
        f"{block}\n\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "headline":  "<one-sentence diagnosis of the data>",\n'
        '  "wins": [\n'
        '    {"insight": "<specific pattern shared by top performers>",\n'
        '     "action":  "<concrete recommendation>",\n'
        '     "evidence": "<reference 1-2 specific titles>"},\n'
        "    ...3-5 entries\n"
        "  ],\n"
        '  "losses": [\n'
        '    {"insight": "<specific pattern hurting bottom performers>",\n'
        '     "action":  "<concrete recommendation>",\n'
        '     "evidence": "<reference 1-2 specific titles>"},\n'
        "    ...2-4 entries\n"
        "  ],\n"
        '  "next_5_pitches": [\n'
        '    "<title for next video that should outperform — leans on win patterns>",\n'
        '    ...exactly 5\n'
        "  ]\n"
        "}\n\n"
        "Each insight + action pair MUST be specific — no generic advice."
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
        a = cleaned.find("{"); b = cleaned.rfind("}")
        if a >= 0 and b > a:
            try:
                parsed = json.loads(cleaned[a:b + 1])
            except Exception:
                raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")
        else:
            raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")
    return {
        "headline":      str(parsed.get("headline") or "")[:280],
        "wins":          (parsed.get("wins") or [])[:6],
        "losses":        (parsed.get("losses") or [])[:5],
        "next_5_pitches": (parsed.get("next_5_pitches") or [])[:5],
        "fetched_at":    datetime.now(timezone.utc).isoformat(),
        "videos_analyzed": len(videos),
    }

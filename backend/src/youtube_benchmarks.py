"""
YouTube benchmark fetcher — given a niche query, returns top-performing short
videos (titles, descriptions, tags, views) to inform social copy generation.

Uses YouTube Data API v3 with a simple API key. Free tier quota is 10,000
units/day. A typical benchmark fetch costs ~110 units (100 for search +
1 per video × 10 = 110), so ~90 generations per day on the free tier.

Results are cached per query for 24h to avoid burning quota on re-generations
of the same post.
"""
from __future__ import annotations
import json
import os
import time
from typing import Optional

import requests


SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
CACHE_TTL_SEC = 24 * 3600


def _cache_path(project_root: str, cache_key: str) -> str:
    cache_dir = os.path.join(project_root, ".cache", "youtube_benchmarks")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, f"{cache_key}.json")


def _load_cached(project_root: str, cache_key: str) -> Optional[list[dict]]:
    path = _cache_path(project_root, cache_key)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("fetched_at", 0) + CACHE_TTL_SEC < time.time():
            return None  # expired
        return data.get("results")
    except Exception:
        return None


def _save_cache(project_root: str, cache_key: str, results: list[dict]) -> None:
    path = _cache_path(project_root, cache_key)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"fetched_at": time.time(), "results": results}, f, indent=2)
    except Exception:
        pass


def _sanitize_key(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9_]+", "_", s.lower())[:80]


def fetch_benchmarks(
    query: str,
    api_key: str,
    *,
    project_root: Optional[str] = None,
    count: int = 10,
    prefer_shorts: bool = True,
    min_views: int = 10_000,
) -> list[dict]:
    """
    Return up to `count` high-performing YouTube videos for the given query.
    Each item: {title, description, tags, view_count, like_count, video_id, channel, duration_sec}.

    Returns [] (never raises) if the API key is missing, quota is exhausted,
    or the network is down — the caller can fall back to AI-only generation.
    """
    if not api_key:
        return []
    query = (query or "").strip()
    if not query:
        return []

    cache_key = _sanitize_key(f"{query}_{count}_{int(prefer_shorts)}")
    if project_root:
        cached = _load_cached(project_root, cache_key)
        if cached is not None:
            return cached

    try:
        # Step 1 — search for videos matching the query.
        search_params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "order": "viewCount",
            "maxResults": max(1, min(50, count * 2)),  # overshoot so we can filter
            "key": api_key,
            "safeSearch": "none",
            "relevanceLanguage": "en",
        }
        if prefer_shorts:
            search_params["videoDuration"] = "short"  # < 4min (captures shorts)
        r = requests.get(SEARCH_URL, params=search_params, timeout=10)
        if project_root:
            try:
                from youtube_quota import record as _quota_record
                _quota_record(project_root, "search.list")
            except Exception:
                pass
        if r.status_code == 403:
            print("⚠️  YouTube API: 403 (check API key, billing, or daily quota)")
            return []
        r.raise_for_status()
        data = r.json()
        ids = [
            item["id"]["videoId"]
            for item in data.get("items", [])
            if item.get("id", {}).get("videoId")
        ]
        if not ids:
            return []

        # Step 2 — fetch statistics + full snippets for those video IDs.
        videos_params = {
            "part": "snippet,statistics,contentDetails",
            "id": ",".join(ids),
            "key": api_key,
        }
        r2 = requests.get(VIDEOS_URL, params=videos_params, timeout=10)
        if project_root:
            try:
                from youtube_quota import record as _quota_record
                _quota_record(project_root, "videos.list")
            except Exception:
                pass
        r2.raise_for_status()
        vdata = r2.json()

        def _iso_dur_to_sec(iso: str) -> int:
            # PT#M#S / PT#H#M#S — cheap parser.
            import re
            m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
            if not m:
                return 0
            h, mm, s = m.groups(default="0")
            return int(h) * 3600 + int(mm) * 60 + int(s)

        out: list[dict] = []
        for it in vdata.get("items", []):
            snip = it.get("snippet", {}) or {}
            stats = it.get("statistics", {}) or {}
            views = int(stats.get("viewCount", 0) or 0)
            if views < min_views:
                continue
            dur = _iso_dur_to_sec((it.get("contentDetails", {}) or {}).get("duration", ""))
            if prefer_shorts and dur > 240:
                continue  # only shorts/short-form
            out.append({
                "video_id":      it.get("id"),
                "title":         snip.get("title", ""),
                "description":   (snip.get("description") or "")[:1200],
                "tags":          (snip.get("tags") or [])[:20],
                "channel":       snip.get("channelTitle", ""),
                "view_count":    views,
                "like_count":    int(stats.get("likeCount", 0) or 0),
                "duration_sec":  dur,
            })
        out.sort(key=lambda v: v["view_count"], reverse=True)
        out = out[:count]
        if project_root:
            _save_cache(project_root, cache_key, out)
        return out
    except requests.exceptions.RequestException as e:
        print(f"⚠️  YouTube API error: {e}")
        return []
    except Exception as e:
        print(f"⚠️  YouTube benchmarks unexpected error: {e}")
        return []

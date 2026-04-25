"""
Channel-niche finder. Combines current YouTube trend data with the
user's interests + audience + content filter to produce 5-10 candidate
niche cards (name + description + sample channel names + first video
ideas + trend rationale).

Pulls real signals from the YouTube Data API:
  * `chart=mostPopular`           — what's trending in a region right now
  * `search` per user keyword     — what's getting views in their interest
                                    space over the last 90 days

Both are dirt-cheap quota-wise (1 unit + 100 unit per search). Reuses
youtube_benchmarks's cache so repeated runs don't re-spend quota.

LLM picks the synthesis — the suite's existing AI provider chain
(gemini / openrouter / ollama / nvidia_nim) is reused so users don't
need an extra config knob.
"""
from __future__ import annotations

import json
import os
import time
from typing import Optional

import requests


CHART_URL = "https://www.googleapis.com/youtube/v3/videos"
TREND_CACHE_TTL_S = 6 * 3600   # six hours — short enough to feel fresh, long enough to save quota


def _cache_path(project_root: str, key: str) -> str:
    d = os.path.join(project_root, ".cache", "youtube_trends")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{key}.json")


def _load_cache(path: str) -> Optional[list]:
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("fetched_at", 0) + TREND_CACHE_TTL_S < time.time():
            return None
        return data.get("items") or []
    except Exception:
        return None


def _save_cache(path: str, items: list) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"fetched_at": time.time(), "items": items}, f)
        os.replace(tmp, path)
    except Exception:
        pass


# ── Trend fetch ──────────────────────────────────────────────────────

def fetch_trending(api_key: str, *, region: str = "US",
                   max_results: int = 30,
                   project_root: Optional[str] = None) -> list[dict]:
    """
    Pull `chart=mostPopular` for `region` (ISO-3166 code). Returns a list
    of {title, channel, view_count, tags, description}.
    """
    if not api_key:
        return []
    region = (region or "US").upper().strip()[:3]
    cache = _cache_path(project_root, f"trending_{region}_{max_results}") if project_root else None
    if cache:
        cached = _load_cache(cache)
        if cached is not None:
            return cached

    try:
        r = requests.get(CHART_URL, params={
            "part":       "snippet,statistics",
            "chart":      "mostPopular",
            "regionCode": region,
            "maxResults": min(50, max(1, int(max_results))),
            "key":        api_key,
        }, timeout=20)
        if r.status_code != 200:
            print(f"⚠️  YT trending fetch failed: {r.status_code} {r.text[:200]}")
            return []
        items = []
        for it in r.json().get("items", []):
            sn = it.get("snippet", {}) or {}
            st = it.get("statistics", {}) or {}
            items.append({
                "title":       sn.get("title", ""),
                "channel":     sn.get("channelTitle", ""),
                "tags":        sn.get("tags", []) or [],
                "description": (sn.get("description") or "")[:280],
                "view_count":  int(st.get("viewCount", 0) or 0),
                "like_count":  int(st.get("likeCount", 0) or 0),
                "category_id": sn.get("categoryId", ""),
            })
        if cache:
            _save_cache(cache, items)
        return items
    except Exception as e:
        print(f"⚠️  YT trending fetch raised: {e}")
        return []


def fetch_keyword_top(api_key: str, keyword: str, *,
                      region: str = "US", count: int = 8,
                      project_root: Optional[str] = None) -> list[dict]:
    """
    Reuse youtube_benchmarks for a per-keyword "top videos in the last
    90 days" search. Cached identically.
    """
    if not keyword.strip():
        return []
    try:
        from youtube_benchmarks import fetch_benchmarks
        return fetch_benchmarks(
            keyword.strip(), api_key, project_root=project_root or ".",
            count=count, region=region,
        )
    except TypeError:
        # Older signature without region — drop it.
        try:
            return fetch_benchmarks(keyword.strip(), api_key, project_root=project_root or ".", count=count)
        except Exception as e:
            print(f"⚠️  benchmark fetch failed for '{keyword}': {e}")
            return []
    except Exception as e:
        print(f"⚠️  benchmark fetch failed for '{keyword}': {e}")
        return []


# ── LLM synthesis ────────────────────────────────────────────────────

def _build_trend_block(trending: list[dict], keyword_groups: list[dict]) -> str:
    lines: list[str] = []
    if trending:
        lines.append("=== TRENDING ON YOUTUBE RIGHT NOW (mostPopular chart) ===")
        for i, v in enumerate(trending[:25], 1):
            tags = ", ".join((v.get("tags") or [])[:5])
            lines.append(
                f"[{i}] {v.get('view_count', 0):,} views — \"{v.get('title','')}\""
                f" by {v.get('channel','')}"
                + (f" · tags: {tags}" if tags else "")
            )
    for grp in keyword_groups:
        kw = grp["keyword"]
        items = grp.get("items") or []
        if not items:
            continue
        lines.append("")
        lines.append(f"=== TOP VIDEOS FOR \"{kw}\" (last 90d, by views) ===")
        for i, v in enumerate(items[:8], 1):
            lines.append(
                f"[{i}] {v.get('view_count', 0):,} views — \"{v.get('title','')}\""
                f" by {v.get('channel','')}"
            )
    return "\n".join(lines)


def generate_niches(
    *,
    interests: str,
    audience: str,
    content_filter: str,
    region: str,
    api_key: str,                  # YouTube key
    provider: str, ai_api_key: str, model: str, ollama_url: str,
    count: int = 6,
    project_root: Optional[str] = None,
) -> dict:
    """
    Synthesise niche cards from real YouTube data + the user's brief.
    Returns { niches: [...], trend_signals: { trending_count, keyword_count } }.
    """
    if not api_key:
        return {"niches": [], "error": "YouTube API key not configured (Config → Publishing)."}

    # Pull data
    trending = fetch_trending(api_key, region=region, project_root=project_root)
    seeds = [k.strip() for k in (interests or "").split(",") if k.strip()][:5]
    keyword_groups: list[dict] = []
    for kw in seeds:
        items = fetch_keyword_top(api_key, kw, region=region, project_root=project_root)
        keyword_groups.append({"keyword": kw, "items": items})

    if not trending and not any(g["items"] for g in keyword_groups):
        return {"niches": [],
                "error": "Couldn't fetch any YouTube data. Check your API key + quota."}

    trend_block = _build_trend_block(trending, keyword_groups)

    # LLM synthesis
    system = (
        "You are a faceless-channel niche strategist. Given real YouTube "
        "trend data + a creator's brief, produce a curated list of niche "
        "ideas with names, channel-name suggestions, descriptions, and "
        "first-video ideas. Ground EVERY niche in at least one signal "
        "from the trend block — don't invent trends. Return ONLY minified "
        "JSON, no markdown."
    )
    target = (audience or "").strip() or "(unspecified)"
    cf = (content_filter or "normal").strip().lower()
    prompt = (
        f"Creator's brief:\n"
        f"  Interests: {', '.join(seeds) or '(none — surprise me)'}\n"
        f"  Target audience: {target}\n"
        f"  Content filter: {cf} (safe / normal / edgy)\n"
        f"  Region: {region}\n"
        f"  Number of niches to return: {count}\n\n"
        f"{trend_block}\n\n"
        "Return JSON with this exact shape (do NOT add extra keys):\n"
        "{\n"
        '  "niches": [\n'
        "    {\n"
        '      "name":               "<3-6 word niche name>",\n'
        '      "description":        "<140-220 char paragraph the user could paste into a YouTube About box>",\n'
        '      "why_trending":       "<≤200 chars citing specific trend signals from the block above by name>",\n'
        '      "saturation":         "low" | "medium" | "high",\n'
        '      "audience":           "<who watches this — demographics + interests>",\n'
        '      "channel_name_ideas": ["<short brandable name>", "<variant 2>", "<variant 3>"],\n'
        '      "first_video_ideas":  ["<title 1>", "<title 2>", "<title 3>", "<title 4>", "<title 5>"],\n'
        '      "fit_score":          <0-100 — how well this matches the brief AND the trend signals>\n'
        "    },\n"
        "    ...\n"
        "  ]\n"
        "}\n"
        "Sort niches by fit_score descending. Distinct niches, not slight variations of each other."
    )

    try:
        from gemini_hooks import _call_ai
    except Exception:
        return {"niches": [], "error": "gemini_hooks unavailable"}

    raw = _call_ai(provider, ai_api_key, prompt, system, model, ollama_url)
    if not raw:
        return {"niches": [], "error": f"AI provider '{provider}' returned empty response"}

    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```")[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.strip("`").strip()
    try:
        parsed = json.loads(s)
    except Exception:
        a = s.find("{"); b = s.rfind("}")
        if a < 0 or b <= a:
            return {"niches": [], "error": f"AI returned non-JSON: {s[:200]}"}
        try: parsed = json.loads(s[a:b + 1])
        except Exception:
            return {"niches": [], "error": f"AI returned non-JSON: {s[:200]}"}

    out_niches = []
    for n in (parsed.get("niches") or [])[:count]:
        out_niches.append({
            "name":               (n.get("name") or "").strip()[:80],
            "description":        (n.get("description") or "").strip()[:300],
            "why_trending":       (n.get("why_trending") or "").strip()[:280],
            "saturation":         (n.get("saturation") or "medium").lower().strip(),
            "audience":           (n.get("audience") or "").strip()[:160],
            "channel_name_ideas": [str(x).strip()[:60] for x in (n.get("channel_name_ideas") or [])][:5],
            "first_video_ideas":  [str(x).strip()[:120] for x in (n.get("first_video_ideas") or [])][:8],
            "fit_score":          max(0, min(100, int(n.get("fit_score") or 0))),
        })
    out_niches.sort(key=lambda x: x["fit_score"], reverse=True)
    return {
        "niches": out_niches,
        "trend_signals": {
            "trending_count":  len(trending),
            "keywords_used":   [g["keyword"] for g in keyword_groups],
        },
    }

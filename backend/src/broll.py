"""
Auto B-roll insertion — given a finalised audio + script, ask the LLM to
pick visual moments worth illustrating with topic-relevant footage,
download those clips from Pexels, and return a list of overlay specs the
render pipeline can stitch in.

Each "moment" produced by `select_broll_moments()` is a dict:
    {
      "start_s":   <when the moment begins, seconds into the audio>,
      "end_s":     <when it ends>,
      "query":     "<2-4 word visual concept the LLM wants on screen>",
      "reason":    "<short explanation, surfaced in the UI>",
      "video_url": "<absolute Pexels video URL — picked best fit>",
      "video_id":  "<Pexels video id>",
      "local_path":"<absolute path on disk after download>",
    }

Pexels uses a free API (200 requests/hour) — set the key on the
backend config under `video.broll.pexels_api_key`. The LLM is the
existing one (gemini / openrouter / ollama / nvidia_nim).

Failures degrade gracefully — `select_broll_moments` returns [] if any
step blows up so a render never fails because of b-roll.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Optional


PEXELS_VIDEO_SEARCH = "https://api.pexels.com/videos/search"


# ── LLM moment tagger ────────────────────────────────────────────────

def _build_prompt(script: str, total_duration_s: float, max_clips: int) -> str:
    return (
        f"Source narration script (duration ~{total_duration_s:.1f} s):\n"
        f"\"\"\"\n{script[:6000]}\n\"\"\"\n\n"
        f"Pick up to {max_clips} moments to overlay topic-relevant b-roll footage.\n"
        "Each moment should:\n"
        "- Cover a short window (2-5 seconds), not the whole script.\n"
        "- Match a CONCRETE visual concept (a noun phrase, not an abstraction).\n"
        "- Avoid the first 2 seconds (let the title card breathe).\n"
        "- Stagger across the script — don't bunch.\n\n"
        "Return JSON of this exact shape (minified, no markdown):\n"
        "{\n"
        '  "moments": [\n'
        '    {"start_s": 6.0, "end_s": 9.5,'
        ' "query": "wedding venue", "reason": "she describes the wedding day"},\n'
        "    ...\n"
        "  ]\n"
        "}\n"
        "Total duration is fixed — start_s and end_s must be inside [0, "
        f"{total_duration_s:.1f}]."
    )


def select_broll_moments(
    *, script: str, total_duration_s: float,
    provider: str, api_key: str, model: str, ollama_url: str = "",
    max_clips: int = 6,
) -> list[dict]:
    """LLM call only — returns moments WITHOUT video_url/local_path filled in."""
    if not script or total_duration_s < 4:
        return []
    try:
        from gemini_hooks import _call_ai  # type: ignore
    except Exception:
        return []
    system = (
        "You are picking visual b-roll moments for a short-form video. "
        "Concrete noun phrases only — they will be passed to a stock-footage "
        "search engine. Return ONLY minified JSON, no markdown."
    )
    raw = _call_ai(provider, api_key, _build_prompt(script, total_duration_s, max_clips), system, model, ollama_url)
    if not raw:
        return []
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
        if s < 0 or e <= s:
            return []
        try: parsed = json.loads(cleaned[s:e + 1])
        except Exception: return []
    out: list[dict] = []
    for m in (parsed.get("moments") or [])[:max_clips]:
        try:
            a = float(m.get("start_s") or 0); b = float(m.get("end_s") or 0)
        except (TypeError, ValueError):
            continue
        a = max(0.0, min(total_duration_s, a))
        b = max(a + 0.5, min(total_duration_s, b))
        # Cap clip length so b-roll never dominates a 60s reel.
        if b - a > 6.0:
            b = a + 6.0
        q = (m.get("query") or "").strip()
        if not q:
            continue
        out.append({
            "start_s": round(a, 2),
            "end_s":   round(b, 2),
            "query":   q[:80],
            "reason":  (m.get("reason") or "")[:160],
        })
    # Sort by start time so the FFmpeg overlay chain is deterministic.
    out.sort(key=lambda x: x["start_s"])
    return out


# ── Pexels search + download ─────────────────────────────────────────

def _pexels_search(query: str, api_key: str, *, target_w: int = 1080, target_h: int = 1920) -> Optional[dict]:
    """Pick the best portrait video file Pexels returns for `query`."""
    if not query or not api_key:
        return None
    try:
        req = urllib.request.Request(
            f"{PEXELS_VIDEO_SEARCH}?query={urllib.parse.quote(query)}"
            f"&orientation=portrait&size=medium&per_page=8",
            headers={"Authorization": api_key, "User-Agent": "Social-Automation-Suite/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"   ⚠️  Pexels search failed for '{query}': {e}")
        return None

    videos = data.get("videos") or []
    if not videos:
        return None

    # Pick the first video, then within that pick the best file
    # (closest to 1080×1920 without going over).
    v = videos[0]
    files = v.get("video_files") or []
    if not files:
        return None
    # Prefer h264/.mp4 and the smallest file that's at least as wide as target.
    best = None
    best_score = -1.0
    for f in files:
        link = f.get("link") or ""
        w = int(f.get("width") or 0)
        h = int(f.get("height") or 0)
        if not link.endswith(".mp4"):
            continue
        if w < 720 or h < 1280:
            continue
        # Score: prefer portrait + reasonably-close-to-target resolution.
        is_portrait = h > w
        if not is_portrait:
            continue
        score = -(abs(w - target_w) + abs(h - target_h))  # higher = closer
        if score > best_score:
            best_score = score
            best = f
    if not best:
        # Fall back to any mp4 available.
        for f in files:
            if f.get("link", "").endswith(".mp4"):
                best = f
                break
    if not best:
        return None
    return {
        "video_url": best.get("link"),
        "video_id":  v.get("id"),
        "duration":  float(v.get("duration") or 0),
        "width":     int(best.get("width") or 0),
        "height":    int(best.get("height") or 0),
    }


def download_clip(url: str, dest_path: str, *, timeout: float = 60.0) -> bool:
    """Stream a Pexels mp4 to disk. Returns True on success."""
    if os.path.isfile(dest_path) and os.path.getsize(dest_path) > 1024:
        return True  # already cached
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Social-Automation-Suite/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest_path + ".part", "wb") as f:
            while True:
                chunk = resp.read(1 << 18)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(dest_path + ".part", dest_path)
        return True
    except Exception as e:
        print(f"   ⚠️  b-roll download failed ({url}): {e}")
        try: os.remove(dest_path + ".part")
        except OSError: pass
        return False


# ── Public API: select + download in one shot ────────────────────────

def select_and_download(
    *,
    script: str, total_duration_s: float,
    out_dir: str,
    provider: str, ai_api_key: str, model: str, ollama_url: str,
    pexels_api_key: str,
    max_clips: int = 6,
) -> list[dict]:
    """
    End-to-end b-roll resolution: tag moments via LLM, search Pexels for
    each query, download the picked video. Returns the moments enriched
    with video_url + local_path. Drops any moment whose download failed.
    """
    if not pexels_api_key:
        return []
    moments = select_broll_moments(
        script=script, total_duration_s=total_duration_s,
        provider=provider, api_key=ai_api_key, model=model, ollama_url=ollama_url,
        max_clips=max_clips,
    )
    if not moments:
        return []
    os.makedirs(out_dir, exist_ok=True)
    enriched: list[dict] = []
    for m in moments:
        pick = _pexels_search(m["query"], pexels_api_key)
        if not pick:
            continue
        # Sanitise the filename so a query like "kid's birthday" doesn't
        # break mkdir.
        safe_q = re.sub(r"[^\w\-]+", "_", m["query"])[:40].strip("_") or "broll"
        local = os.path.join(out_dir, f"{int(m['start_s']):03d}_{safe_q}_{pick['video_id']}.mp4")
        if not download_clip(pick["video_url"], local):
            continue
        enriched.append({
            **m,
            "video_url":  pick["video_url"],
            "video_id":   pick["video_id"],
            "local_path": local,
        })
    return enriched

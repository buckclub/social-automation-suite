"""
FastAPI server that wraps the Reddit Video Generator pipeline.
Provides REST endpoints for the frontend dashboard.

Run with: uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload

Author: Faheem Alvi
GitHub: https://github.com/FaheemAlvii
LinkedIn: https://www.linkedin.com/in/faheem-alvi
Email: faheemalvi2000@gmail.com
License: CC BY-NC 4.0
"""
import asyncio
import io
import os
import sys
import json
import time
import shutil
import re
import glob
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

# Import existing backend modules
from reddit_story_maker import RedditStoryMaker
from story_formatter import StoryFormatter
from tts_engine import TTSManager, LazyPyTikTokTTS
from local_tts import (
    check_vibevoice, install_vibevoice, VibeVoiceTTS, discover_vibevoice_voices, VIBEVOICE_MODELS,
    check_qwen3tts, install_qwen3tts, Qwen3TTS, QWEN3_TTS_MODELS,
)
# ── State ────────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(os.path.join(meipass, "dist"))
        candidates.append(os.path.join(meipass, "frontend_dist"))
    candidates.append(os.path.join(PROJECT_ROOT, "frontend_dist"))
    candidates.append(os.path.join(PROJECT_ROOT, "dist"))
    FRONTEND_DIST = None
    for c in candidates:
        if os.path.isdir(c):
            FRONTEND_DIST = c
            break
    if FRONTEND_DIST is None:
        FRONTEND_DIST = os.path.join(PROJECT_ROOT, "dist")
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    FRONTEND_DIST = os.path.join(PROJECT_ROOT, "dist")
FRONTEND_ASSETS = os.path.join(FRONTEND_DIST, "assets")
CONFIG_PATH = os.path.join(PROJECT_ROOT, "config.json")
CONFIG_EXAMPLE_PATH = os.path.join(PROJECT_ROOT, "config.json.example")

DEFAULT_CONFIG = {
    "subreddits": ["AskReddit"],
    "request_delay": 2.0,
    "filters": {
        "min_upvotes": 50, "min_comments": 10, "max_comments": 999999999,
        "min_age_hours": 1, "max_age_hours": 168,
        "allow_nsfw": False, "require_selftext": False,
    },
    "formatting": {"default_mode": "qa", "max_comments": 10, "min_comment_score": 10},
    "tts": {
        "enabled": True, "provider": "streamlabs_polly", "main_voice": "Matthew",
        "use_multiple_voices": True,
        "comment_voices": ["Brian","Amy","Emma","Joanna","Matthew","Joey","Justin","Kendra","Kimberly","Salli"],
        "output_format": "mp3", "speed": 0.5,
    },
    "video": {
        "mode": "short_reel", "use_gpu": True, "auto_cleanup": False,
        "threads": 0, "engine": "ffmpeg", "split_duration": 30,
        "outro_text": "Follow for Part {next_part}",
        "branding": "",
    },
    "output": {"posts_directory": "posts", "used_posts_file": "used_posts.json"},
    "discord": {"enabled": True, "webhook_url": "", "upload_media": True},
    "gemini": {
        "enabled": False,
        "api_key": "",
        "openrouter_api_key": "",
        "provider": "gemini",
        "model": "gemini-2.0-flash",
        "generate_hook": True,
        "generate_thumbnail_text": True,
        "gemini_models": [
            "gemini-2.0-flash", "gemini-2.5-flash-preview-05-20",
            "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-lite",
        ],
        "openrouter_models": [
            "google/gemma-3-27b-it:free", "google/gemma-3-12b-it:free",
            "google/gemma-3-4b-it:free", "google/gemma-3-1b-it:free",
            "google/gemini-2.0-flash-exp:free", "google/gemini-2.5-flash-preview:thinking",
            "deepseek/deepseek-chat-v3-0324:free", "meta-llama/llama-4-maverick:free",
            "qwen/qwen3-235b-a22b:free", "mistralai/mistral-small-3.1-24b-instruct:free",
        ],
        "ollama_url": "http://localhost:11434",
        "ollama_models": [
            "llama3.2", "llama3.1", "gemma3", "gemma2",
            "mistral", "qwen2.5", "phi3", "deepseek-r1",
        ],
        "nvidia_nim_api_key": "",
        "nvidia_nim_models": [
            "meta/llama-3.1-405b-instruct", "meta/llama-3.1-70b-instruct",
            "meta/llama-3.1-8b-instruct", "google/gemma-2-27b-it",
            "google/gemma-2-9b-it", "mistralai/mixtral-8x22b-instruct-v0.1",
            "nvidia/llama-3.1-nemotron-70b-instruct", "deepseek-ai/deepseek-r1",
        ],
    },
}

def _initial_reddit_steps() -> list[dict]:
    """Canonical Reddit pipeline step list. Pulled from reddit_pipeline so
    the step set is defined in one place for both the runner and the UI."""
    try:
        from reddit_pipeline import REDDIT_STEP_DEFS
        return [dict(s) for s in REDDIT_STEP_DEFS]
    except Exception:
        # Fallback if the new module isn't importable for any reason.
        return [
            {"id": "ai_generate", "title": "AI Content Generation", "status": "idle", "detail": ""},
            {"id": "fetch", "title": "Fetch Reddit Post", "status": "idle", "detail": ""},
            {"id": "format", "title": "Format Story", "status": "idle", "detail": ""},
            {"id": "tts", "title": "Generate TTS Audio", "status": "idle", "detail": ""},
            {"id": "video", "title": "Render Video", "status": "idle", "detail": ""},
            {"id": "thumbnail", "title": "Generate Thumbnails", "status": "idle", "detail": ""},
            {"id": "notify", "title": "Notify & Upload", "status": "idle", "detail": ""},
        ]


pipeline_state = {
    "steps": _initial_reddit_steps(),
    "is_running": False,
    "current_post": None,
    "started_at": None,
    "completed_at": None,
    "error": None,
}

# Cancellation flag
_cancel_requested = False

videos_db: List[Dict] = []
stats = {
    "videos_today": 0, "posts_scanned": 0,
    "total_render_time_s": 0, "total_runs": 0, "successful_runs": 0,
}
run_logs: List[str] = []


def _log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    entry = f"[{ts}] {msg}"
    run_logs.append(entry)
    if len(run_logs) > 500:
        run_logs.pop(0)
    print(entry)


def _ensure_config():
    if os.path.exists(CONFIG_PATH):
        return
    if os.path.exists(CONFIG_EXAMPLE_PATH):
        shutil.copy2(CONFIG_EXAMPLE_PATH, CONFIG_PATH)
        _log("Created config.json from config.json.example")
    else:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        _log("Created config.json with default values")


def _load_config() -> dict:
    _ensure_config()
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_config(config: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def _get_video_file_info(post_id: str) -> dict:
    """Get file size and paths for a video entry."""
    posts_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    videos_dir = os.path.join(PROJECT_ROOT, "videos")
    paths = []
    total_size = 0

    # Check posts dir
    if os.path.isdir(posts_dir):
        for f in os.listdir(posts_dir):
            if f.endswith(".mp4"):
                fp = os.path.join(posts_dir, f)
                paths.append(fp)
                total_size += os.path.getsize(fp)

    # Check videos dir
    if os.path.isdir(videos_dir):
        for item in os.listdir(videos_dir):
            item_path = os.path.join(videos_dir, item)
            if item == post_id and os.path.isdir(item_path):
                for f in os.listdir(item_path):
                    if f.endswith(".mp4"):
                        fp = os.path.join(item_path, f)
                        paths.append(fp)
                        total_size += os.path.getsize(fp)
            elif item.endswith(".mp4") and post_id in item:
                paths.append(item_path)
                total_size += os.path.getsize(item_path)

    return {"paths": paths, "total_size": total_size}


def _persist_videos_db() -> None:
    """
    Write the full in-memory videos_db to projects.json.

    We dump the whole list verbatim so every flavor of entry (published,
    audio_only, failed) survives a server restart — not just successful
    renders. Called after any mutation to videos_db.
    """
    try:
        from projects_db import save_registry
        save_registry(PROJECT_ROOT, list(videos_db))
    except Exception as e:
        _log(f"projects.json save failed: {e}")


def _load_videos_from_disk():
    # 1. Authoritative source: projects.json registry.
    #    Load every entry verbatim — audio_only and failed rows included,
    #    so the UI state survives server restarts.
    try:
        from projects_db import load_registry
        for p in load_registry(PROJECT_ROOT):
            vpaths = [vp for vp in (p.get("video_paths") or []) if vp and os.path.exists(vp)]
            has_video = bool(vpaths)
            status = p.get("status", "published" if has_video else "fetched")
            audio_dir = p.get("audio_dir") or ""
            post_audio_dir = os.path.join(PROJECT_ROOT, "posts", p.get("id", ""), "audio")
            has_audio = (
                bool(audio_dir and os.path.isdir(audio_dir))
                or os.path.isdir(post_audio_dir)
            )
            # Drop rows with nothing left on disk (video gone AND audio gone)
            # so stale failures don't clutter the UI forever.
            if not has_video and not has_audio and status != "fetched":
                continue
            entry = {
                "id": p.get("id"),
                "title": p.get("title", "Untitled"),
                "subreddit": p.get("subreddit", "unknown"),
                "score": int(p.get("score", 0) or 0),
                "num_comments": int(p.get("num_comments", 0) or 0),
                "status": status if has_video else ("audio_only" if has_audio else "fetched"),
                "created_at": p.get("created_at", ""),
                "has_video": has_video,
                "has_audio": has_audio,
                "parts": len(vpaths) if len(vpaths) > 1 else p.get("parts"),
                "file_size_bytes": sum(os.path.getsize(vp) for vp in vpaths if os.path.exists(vp)) or p.get("file_size_bytes"),
                "video_paths": vpaths,
                "part_files": p.get("part_files"),
                "has_thumbnails": p.get("has_thumbnails", False),
                "render_time_s": p.get("render_time_s"),
                # Preserve pipeline-internal fields so Re-render / Resume keep working.
                "audio_dir": audio_dir,
                "timeline_path": p.get("timeline_path"),
            }
            if not any(v["id"] == entry["id"] for v in videos_db):
                videos_db.append(entry)
    except Exception as e:
        _log(f"projects.json load failed: {e}")

    posts_dir = os.path.join(PROJECT_ROOT, "posts")
    if not os.path.exists(posts_dir):
        # Still scan videos/ for loose mp4s
        _scan_loose_videos_dir()
        return
    for post_id in os.listdir(posts_dir):
        # Skip if the projects.json registry already has this post — the
        # registry entry is authoritative and prevents a stale posts/<id>/
        # workspace from showing up as a second (audio_only) card.
        if any(v["id"] == post_id for v in videos_db):
            continue
        post_dir = os.path.join(posts_dir, post_id)
        if not os.path.isdir(post_dir):
            continue
        summary_path = os.path.join(post_dir, "summary.json")
        if os.path.exists(summary_path):
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
            # Check for video files (video.mp4 or video_part*.mp4)
            has_video = os.path.exists(os.path.join(post_dir, "video.mp4"))
            if not has_video:
                has_video = any(f.startswith("video_part") and f.endswith(".mp4") for f in os.listdir(post_dir))
            has_audio = os.path.exists(os.path.join(post_dir, "audio"))
            file_info = _get_video_file_info(post_id)
            mp4s = [f for f in os.listdir(post_dir) if f.endswith(".mp4")]
            # Use video file mtime for created_at if no downloaded_at
            created_at = summary.get("downloaded_at", "")
            if not created_at:
                # Use the most recent file modification time
                all_files = file_info["paths"] if file_info["paths"] else [os.path.join(post_dir, f) for f in os.listdir(post_dir)]
                mtimes = [os.path.getmtime(f) for f in all_files if os.path.exists(f)]
                if mtimes:
                    created_at = datetime.fromtimestamp(max(mtimes), tz=timezone.utc).isoformat()

            videos_db.append({
                "id": post_id,
                "title": summary.get("title", "Untitled"),
                "subreddit": summary.get("subreddit", "unknown"),
                "score": summary.get("score", 0),
                "num_comments": summary.get("num_comments", 0),
                "status": "published" if has_video else ("audio_only" if has_audio else "fetched"),
                "created_at": created_at,
                "has_video": has_video,
                "has_audio": has_audio,
                "parts": len(mp4s) if len(mp4s) > 1 else None,
                "file_size_bytes": file_info["total_size"] or None,
                "video_paths": file_info["paths"],
            })
    _scan_loose_videos_dir()
    _dedupe_slug_duplicates()
    # Snapshot anything discovered from disk scans (posts/, videos/ loose
    # files) back into projects.json so future restarts don't re-do this work.
    _persist_videos_db()


def _dedupe_slug_duplicates():
    """
    Clean up duplicates where one row has the real post id (audio_only,
    possibly also already-published) and another row has a filename-derived
    id pointing at the same rendered mp4. Happens when an earlier render
    succeeded but its videos_db persistence crashed — the loose-scanner
    then created a second row with a slug id. Merges file paths into the
    real post row and drops the slug-id row.
    """
    global videos_db
    # Build a map: title-slug → entry with real post id
    real_entries: dict[str, dict] = {}
    for v in videos_db:
        vid = v.get("id") or ""
        title = v.get("title") or ""
        slug = _title_to_filename_stem(title)
        # A "real" post id looks like a reddit id: short, all alphanumeric,
        # no long underscore-separated runs. Heuristic: id length <= 10 and
        # id != slug (slug would be much longer from the title).
        if slug and len(vid) <= 10 and vid != slug:
            real_entries[slug] = v

    if not real_entries:
        return

    to_drop: list[str] = []
    for v in videos_db:
        vid = v.get("id") or ""
        # slug-id rows: id equals the slug of their own title, or id starts
        # with a slug of a real entry's title.
        for slug, real in real_entries.items():
            if vid == real.get("id"):
                continue
            if vid.startswith(slug):
                # Merge this row's file paths into the real entry.
                for p in v.get("video_paths") or []:
                    if p not in (real.get("video_paths") or []):
                        real.setdefault("video_paths", []).append(p)
                if v.get("has_video"):
                    real["has_video"] = True
                    real["status"] = "published"
                real["file_size_bytes"] = v.get("file_size_bytes") or real.get("file_size_bytes")
                if not real.get("created_at"):
                    real["created_at"] = v.get("created_at")
                to_drop.append(vid)
                break

    if to_drop:
        videos_db = [v for v in videos_db if v.get("id") not in to_drop]


def _title_to_filename_stem(title: str) -> str:
    r"""Reverse-engineered match to the slug used by _run_pipeline_async when
    writing final mp4s (safe_title = re.sub(r"[^\w\-_]", "_", title)[:50])."""
    safe = re.sub(r"[^\w\-_]", "_", title or "")
    safe = re.sub(r"_+", "_", safe)[:50].strip("_")
    return safe


def _find_matching_entry_for_orphan(filename_stem: str):
    """
    Given a filename stem like `27F_30M_Thinks_marriage_is_nothing_..._reel_20260423_161100`,
    return the existing videos_db entry whose title, when slugified, is a
    prefix of the stem. Catches the case where a render succeeded but the
    persistence call crashed, leaving the registry with the audio_only row
    and an orphan mp4 in videos/.
    """
    for v in videos_db:
        t = v.get("title") or ""
        if not t:
            continue
        slug = _title_to_filename_stem(t)
        if not slug:
            continue
        if filename_stem.startswith(slug):
            return v
    return None


def _scan_loose_videos_dir():
    """Pick up video files in videos/ that the registry doesn't know about.
    When a loose mp4's filename matches an existing registry entry's title
    (prefix-match on the slugified title), upgrade that entry's video_paths
    instead of creating a duplicate row with a filename-derived id."""
    videos_dir = os.path.join(PROJECT_ROOT, "videos")
    if not os.path.exists(videos_dir):
        return

    known_paths: set[str] = set()
    for v in videos_db:
        for p in v.get("video_paths") or []:
            known_paths.add(os.path.normcase(os.path.abspath(p)))

    for item in os.listdir(videos_dir):
        item_path = os.path.join(videos_dir, item)

        # Skip preserved project directories — they don't contain rendered videos.
        if item.startswith("proj_"):
            continue

        # 2a. Subdirectory containing mp4s (multi-part videos layout)
        if os.path.isdir(item_path):
            mp4s = [f for f in os.listdir(item_path) if f.endswith(".mp4")]
            if not mp4s:
                continue
            video_paths = [os.path.join(item_path, f) for f in mp4s]
            if all(os.path.normcase(os.path.abspath(vp)) in known_paths for vp in video_paths):
                continue

            total_size = sum(os.path.getsize(vp) for vp in video_paths)
            mtimes = [os.path.getmtime(vp) for vp in video_paths]
            vid_created_at = datetime.fromtimestamp(max(mtimes), tz=timezone.utc).isoformat() if mtimes else ""

            # Try to attach these files to an existing audio_only / orphan
            # registry entry rather than creating a new filename-ID row.
            existing = _find_matching_entry_for_orphan(item)
            if existing:
                existing["video_paths"] = video_paths
                existing["has_video"] = True
                existing["status"] = "published"
                existing["parts"] = len(mp4s) if len(mp4s) > 1 else existing.get("parts")
                existing["file_size_bytes"] = total_size or existing.get("file_size_bytes")
                if not existing.get("created_at"):
                    existing["created_at"] = vid_created_at
                continue

            if any(v["id"] == item for v in videos_db):
                continue
            videos_db.append({
                "id": item,
                "title": item.replace("_", " "),
                "subreddit": "—",
                "score": 0, "num_comments": 0,
                "status": "published",
                "created_at": vid_created_at,
                "has_video": True, "has_audio": False,  # loose dir: no preserved audio
                "parts": len(mp4s) if len(mp4s) > 1 else None,
                "file_size_bytes": total_size or None,
                "video_paths": video_paths,
            })
            continue

        # 2b. Loose single mp4 file (what auto_cleanup + regular renders leave behind)
        if item.lower().endswith(".mp4"):
            abs_path = os.path.normcase(os.path.abspath(item_path))
            if abs_path in known_paths:
                continue
            loose_id = os.path.splitext(item)[0]
            mtime = os.path.getmtime(item_path)
            created = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()

            # If this mp4's filename matches an existing entry's title
            # (e.g. an audio_only row whose render succeeded but whose
            # persistence call crashed), attach the file to that entry.
            existing = _find_matching_entry_for_orphan(loose_id)
            if existing:
                existing["video_paths"] = [item_path]
                existing["has_video"] = True
                existing["status"] = "published"
                existing["file_size_bytes"] = os.path.getsize(item_path)
                if not existing.get("created_at"):
                    existing["created_at"] = created
                continue

            if any(v["id"] == loose_id for v in videos_db):
                continue
            videos_db.append({
                "id": loose_id,
                "title": loose_id.replace("_", " "),
                "subreddit": "—",
                "score": 0, "num_comments": 0,
                "status": "published",
                "created_at": created,
                "has_video": True, "has_audio": False,  # no preserved audio ⇒ Re-render won't work
                "parts": None,
                "file_size_bytes": os.path.getsize(item_path),
                "video_paths": [item_path],
            })


def _load_used_posts() -> List[str]:
    config = _load_config()
    used_file = os.path.join(PROJECT_ROOT, config.get("output", {}).get("used_posts_file", "used_posts.json"))
    if os.path.exists(used_file):
        with open(used_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _used_post_titles() -> List[str]:
    """Collect titles of previously-used posts from their summary.json files."""
    titles: List[str] = []
    posts_root = os.path.join(PROJECT_ROOT, "posts")
    if not os.path.isdir(posts_root):
        return titles
    for pid in os.listdir(posts_root):
        summary = os.path.join(posts_root, pid, "summary.json")
        if os.path.isfile(summary):
            try:
                with open(summary, "r", encoding="utf-8") as f:
                    data = json.load(f)
                t = (data.get("title") or "").strip()
                if t:
                    titles.append(t)
            except Exception:
                pass
    return titles


async def _run_clip_render_async(project_id: str, proposal_id: str):
    """
    Render one approved proposal from a Clip Maker project. Drives the
    modular CLIP_PIPELINE and mirrors its step progress into pipeline_state
    so the Dashboard timeline + status bar update just like a Reddit run.
    """
    from clip_projects import load_project, save_project, set_status
    from clip_pipeline import CLIP_PIPELINE
    from pipeline_core import PipelineContext

    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        pipeline_state["error"] = f"Clip project not found: {project_id}"
        return
    prop = next((p for p in (proj.get("proposals") or []) if p.get("id") == proposal_id), None)
    if not prop:
        pipeline_state["error"] = f"Proposal not found: {proposal_id}"
        return

    # Lay out the step list in pipeline_state so the UI can show it.
    pipeline_state["is_running"] = True
    pipeline_state["error"] = None
    pipeline_state["steps"] = CLIP_PIPELINE.step_summaries
    pipeline_state["current_post"] = {
        "id": f"clip:{project_id}:{proposal_id}",
        "title": (prop.get("custom_title") or prop.get("hook_line") or proj.get("name") or "clip")[:120],
        "subreddit": "clipmaker",
        "score": int(prop.get("score") or 0),
    }
    pipeline_state["started_at"] = datetime.now(timezone.utc).isoformat()
    pipeline_state["completed_at"] = None
    _log(f"Clip render starting: {project_id}/{proposal_id}")

    def _mirror(step_id: str, status: str, detail: str = "", _extra=None):
        now_s = datetime.now(timezone.utc).isoformat()
        for step in pipeline_state["steps"]:
            if step["id"] == step_id:
                if status == "running":
                    step["started_at"] = now_s
                    step["finished_at"] = None
                elif status in ("done", "error", "skipped") and step.get("started_at"):
                    step["finished_at"] = now_s
                step["status"] = "running" if status == "sub" else status
                if detail:
                    step["detail"] = detail
                break
        if status == "error":
            _log(f"Clip step {step_id} error: {detail}")

    # Captions — prefer the dedicated clip_captions block, fall back to the
    # Reddit captions so new configs don't break existing ones.
    cfg = _load_config()
    clip_caps = (cfg.get("clip_captions") or cfg.get("captions") or {})

    ctx = PipelineContext({
        "project_root": PROJECT_ROOT,
        "project":      proj,
        "proposal":     prop,
        "config":       cfg,
        "captions":     clip_caps,
    })

    try:
        await CLIP_PIPELINE.run(ctx, _mirror)
        set_status(PROJECT_ROOT, project_id, "done", "render finished")
        _log(f"Clip render done: {project_id}/{proposal_id} → {ctx.get('final_path')}")
    except Exception as e:
        pipeline_state["error"] = str(e)
        set_status(PROJECT_ROOT, project_id, "failed", "", error=str(e))
        _log(f"Clip render FAILED: {project_id}/{proposal_id}: {e}")
    finally:
        pipeline_state["is_running"] = False
        pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()


async def _queue_worker():
    """
    Background task that drains the run queue. Sleeps when the pipeline
    is busy or the queue is empty/paused. Starts the next queued item
    by calling _run_pipeline_async directly in-process.
    """
    from run_queue import next_queued, mark_running, mark_finished
    # Small startup grace so lifespan yield completes first.
    await asyncio.sleep(2)
    while True:
        try:
            if pipeline_state.get("is_running"):
                await asyncio.sleep(2)
                continue
            item = next_queued(PROJECT_ROOT)
            if not item:
                await asyncio.sleep(3)
                continue

            qid = item["queue_id"]
            pid = item.get("post_id") or ""
            params = item.get("params") or {}
            kind = (params.get("kind") or "post").lower()
            _log(f"Queue: starting {kind}:{pid} — {item.get('title','')[:60]} ({qid[:8]})")
            mark_running(PROJECT_ROOT, qid)

            err_out: Optional[str] = None
            if kind == "clip":
                # Clip Maker render — uses the modular pipeline in clip_pipeline.
                try:
                    await _run_clip_render_async(
                        params.get("clip_project") or "",
                        params.get("clip_proposal") or "",
                    )
                    err_out = pipeline_state.get("error")
                except Exception as e:
                    err_out = str(e)
            else:
                # Legacy Reddit post pipeline. Also handles batch-run-ai
                # items, since those write a synthetic post to disk and
                # enqueue with kind: "post". background_override is
                # forwarded so the AI batch's per-run BG selector is
                # honoured by the queued runs (it's also used by
                # explicit Resume / Retry flows that pass it through).
                await _run_pipeline_async(
                    specific_post_id=pid,
                    selected_comments=params.get("selected_comments"),
                    max_comment_chars=int(params.get("max_comment_chars") or 0),
                    narrator_gender=params.get("narrator_gender"),
                    voice_override=params.get("voice_override"),
                    background_override=params.get("background_override"),
                )
                err_out = pipeline_state.get("error")

            success = not err_out
            mark_finished(PROJECT_ROOT, qid, success=success, error=err_out if err_out else None)
            _log(f"Queue: finished {kind}:{pid} ({'OK' if success else 'FAILED'})")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _log(f"Queue worker error: {e}")
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_config()
    _load_videos_from_disk()
    # Recover from any 'running' items left by a crashed/restarted server.
    try:
        from run_queue import init_on_startup
        init_on_startup(PROJECT_ROOT)
    except Exception as e:
        _log(f"Run queue recovery failed: {e}")
    # Same recovery for the social-copy queue.
    try:
        from social_queue import init_on_startup as social_init
        n = social_init(PROJECT_ROOT)
        if n:
            _log(f"Social copy queue: recovered {n} orphaned running item(s)")
    except Exception as e:
        _log(f"Social copy queue recovery failed: {e}")
    # Same recovery for the content calendar.
    try:
        from content_calendar import init_on_startup as cal_init
        n = cal_init(PROJECT_ROOT)
        if n:
            _log(f"Content calendar: recovered {n} orphaned in-flight slot(s)")
    except Exception as e:
        _log(f"Calendar recovery failed: {e}")
    # AI-score cache housekeeping: one-time migrate legacy per-post rows,
    # then prune anything not touched in the TTL window so stale models
    # don't linger forever.
    try:
        from ai_score_cache import migrate_from_legacy_per_post, prune
        mig = migrate_from_legacy_per_post(PROJECT_ROOT)
        if mig:
            _log(f"AI-score cache: migrated {mig} legacy per-post row(s)")
        cfg = _load_config()
        ttl = int((cfg.get("ai_scoring") or {}).get("cache_ttl_days", 7))
        pruned = prune(PROJECT_ROOT, ttl_days=ttl)
        if pruned:
            _log(f"AI-score cache: pruned {pruned} stale entr{'y' if pruned == 1 else 'ies'} (>{ttl}d unused)")
    except Exception as e:
        _log(f"AI-score cache init failed: {e}")
    # Kick off the background workers.
    task = asyncio.create_task(_queue_worker())
    social_task = asyncio.create_task(_social_queue_worker())
    calendar_task = asyncio.create_task(_calendar_worker())
    _log("Server started")
    try:
        yield
    finally:
        for t in (task, social_task, calendar_task):
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


# ── App ──────────────────────────────────────────────────────────────
app = FastAPI(title="Social Automation Suite API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# ── Endpoints ────────────────────────────────────────────────────────

if os.path.isdir(FRONTEND_ASSETS):
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS), name="assets")


@app.get("/api/health")
async def health():
    return {"status": "online", "timestamp": datetime.now(timezone.utc).isoformat()}


# ── Branding / title-card assets ────────────────────────────────────
from fastapi import UploadFile, File

@app.post("/api/branding/profile-pic")
async def upload_profile_pic(file: UploadFile = File(...)):
    """
    Save an uploaded image to branding/avatar.<ext> and record the path on
    config.thumbnail.profile_pic_path. Replaces any previously saved avatar.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Please upload an image (png/jpg/webp).")
    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise HTTPException(400, "Unsupported image format — use PNG, JPG, or WebP.")
    branding_dir = os.path.join(PROJECT_ROOT, "branding")
    os.makedirs(branding_dir, exist_ok=True)
    dest = os.path.join(branding_dir, f"avatar{ext}")
    # Drop any stale avatars with different extensions so we don't stack old files.
    for other_ext in (".png", ".jpg", ".jpeg", ".webp"):
        prev = os.path.join(branding_dir, f"avatar{other_ext}")
        if prev != dest and os.path.isfile(prev):
            try: os.remove(prev)
            except OSError: pass
    contents = await file.read()
    with open(dest, "wb") as f:
        f.write(contents)

    rel_path = os.path.relpath(dest, PROJECT_ROOT).replace("\\", "/")
    cfg = _load_config()
    cfg.setdefault("thumbnail", {})["profile_pic_path"] = rel_path
    _save_config(cfg)
    return {"saved": True, "path": rel_path, "size_bytes": len(contents)}


@app.get("/api/branding/profile-pic")
async def get_profile_pic():
    """Serve the configured profile pic so the Config UI can preview it."""
    from fastapi.responses import FileResponse
    cfg = _load_config()
    rel = (cfg.get("thumbnail") or {}).get("profile_pic_path") or ""
    if not rel:
        raise HTTPException(404, "No profile pic set")
    path = rel if os.path.isabs(rel) else os.path.join(PROJECT_ROOT, rel)
    if not os.path.isfile(path):
        raise HTTPException(404, "Profile pic missing on disk")
    return FileResponse(path)


@app.delete("/api/branding/profile-pic")
async def delete_profile_pic():
    cfg = _load_config()
    rel = (cfg.get("thumbnail") or {}).get("profile_pic_path") or ""
    if rel:
        path = rel if os.path.isabs(rel) else os.path.join(PROJECT_ROOT, rel)
        try:
            if os.path.isfile(path): os.remove(path)
        except OSError:
            pass
    cfg.setdefault("thumbnail", {})["profile_pic_path"] = ""
    _save_config(cfg)
    return {"cleared": True}


# ── Backgrounds library ─────────────────────────────────────────────
_VIDEO_EXTS = (".mp4", ".mov", ".avi", ".mkv", ".webm")

def _backgrounds_root() -> str:
    d = os.path.join(PROJECT_ROOT, "backgrounds")
    os.makedirs(d, exist_ok=True)
    return d

def _safe_bg_path(rel: str) -> str:
    """Resolve a user-supplied relative path against backgrounds/, rejecting anything that escapes it."""
    rel = (rel or "").strip().replace("\\", "/").lstrip("/")
    if rel.startswith("/") or ".." in rel.split("/"):
        raise HTTPException(400, "Invalid path")
    root = _backgrounds_root()
    candidate = os.path.abspath(os.path.join(root, rel))
    if not candidate.startswith(os.path.abspath(root)):
        raise HTTPException(400, "Path escapes backgrounds directory")
    return candidate


@app.get("/api/backgrounds")
async def list_backgrounds(path: str = ""):
    """List folders + videos inside backgrounds/<path>. Returns breadcrumb + entries."""
    root = _backgrounds_root()
    abs_path = _safe_bg_path(path)
    if not os.path.isdir(abs_path):
        if abs_path == root:
            os.makedirs(abs_path, exist_ok=True)
        else:
            raise HTTPException(404, f"Folder not found: {path}")

    folders = []
    videos = []
    for name in sorted(os.listdir(abs_path)):
        full = os.path.join(abs_path, name)
        rel = os.path.relpath(full, root).replace("\\", "/")
        if os.path.isdir(full):
            inner_count = 0
            for r, _, fs in os.walk(full):
                inner_count += sum(1 for f in fs if f.lower().endswith(_VIDEO_EXTS))
            folders.append({"name": name, "path": rel, "video_count": inner_count})
        elif os.path.isfile(full) and name.lower().endswith(_VIDEO_EXTS):
            try:
                st = os.stat(full)
                videos.append({
                    "name":  name,
                    "path":  rel,
                    "size":  st.st_size,
                    "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                })
            except OSError:
                pass

    rel_clean = os.path.relpath(abs_path, root).replace("\\", "/")
    if rel_clean == ".":
        rel_clean = ""
        parent = None
    else:
        parent = os.path.dirname(rel_clean).replace("\\", "/") or ""

    return {
        "path":    rel_clean,
        "parent":  parent,
        "folders": folders,
        "videos":  videos,
    }


@app.post("/api/backgrounds/upload")
async def upload_background(file: UploadFile = File(...), folder: str = ""):
    """Upload a video into a (possibly nested) folder under backgrounds/."""
    name = os.path.basename(file.filename or "")
    if not name or not name.lower().endswith(_VIDEO_EXTS):
        raise HTTPException(400, f"Unsupported video format. Allowed: {', '.join(_VIDEO_EXTS)}")
    target_dir = _safe_bg_path(folder) if folder else _backgrounds_root()
    os.makedirs(target_dir, exist_ok=True)
    base, ext = os.path.splitext(name)
    dest = os.path.join(target_dir, name)
    idx = 1
    while os.path.exists(dest):
        dest = os.path.join(target_dir, f"{base}_{idx}{ext}")
        idx += 1

    size = 0
    with open(dest, "wb") as f:
        while True:
            chunk = await file.read(1 << 20)   # 1 MB
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)

    rel = os.path.relpath(dest, _backgrounds_root()).replace("\\", "/")
    _log(f"Background uploaded: {rel} ({size/1024/1024:.1f} MB)")
    return {"saved": True, "path": rel, "size": size}


@app.delete("/api/backgrounds")
async def delete_background(path: str):
    target = _safe_bg_path(path)
    if not os.path.isfile(target):
        raise HTTPException(404, "File not found")
    if not target.lower().endswith(_VIDEO_EXTS):
        raise HTTPException(400, "Not a video file")
    try:
        os.remove(target)
    except OSError as e:
        raise HTTPException(500, f"Couldn't delete: {e}")
    return {"deleted": True, "path": path}


@app.post("/api/backgrounds/folders")
async def create_background_folder(req: dict):
    """Body: {path: 'parent/new-folder'}"""
    rel = (req.get("path") or "").strip()
    if not rel:
        raise HTTPException(400, "path is required")
    target = _safe_bg_path(rel)
    if os.path.exists(target):
        raise HTTPException(409, "Already exists")
    os.makedirs(target, exist_ok=True)
    return {"created": True, "path": rel}


@app.delete("/api/backgrounds/folders")
async def delete_background_folder(path: str, recursive: bool = False):
    target = _safe_bg_path(path)
    if target == _backgrounds_root():
        raise HTTPException(400, "Can't delete the backgrounds root")
    if not os.path.isdir(target):
        raise HTTPException(404, "Folder not found")
    try:
        if recursive:
            shutil.rmtree(target)
        else:
            os.rmdir(target)
    except OSError as e:
        raise HTTPException(400, f"Couldn't delete folder: {e}")
    return {"deleted": True, "path": path}


@app.get("/api/backgrounds/preview")
async def background_preview(path: str):
    """Stream a background video back so the browser can preview it inline."""
    from fastapi.responses import FileResponse
    target = _safe_bg_path(path)
    if not os.path.isfile(target):
        raise HTTPException(404, "Not found")
    return FileResponse(target, media_type="video/mp4")


@app.post("/api/backgrounds/move")
async def move_background(req: dict):
    """
    Move a video file (or subfolder) to a different folder within backgrounds/.

    Body:
      { src_path: "subA/clip.mp4",          # file OR folder
        dest_folder: "subB" }               # "" = backgrounds root
    Auto-renames with _1, _2, … if the destination already has a file
    with the same basename, so drag-to-move never silently overwrites.
    """
    src_rel  = (req.get("src_path") or "").strip()
    dest_rel = (req.get("dest_folder") or "").strip()
    if not src_rel:
        raise HTTPException(400, "src_path is required")

    src = _safe_bg_path(src_rel)
    dest_dir = _safe_bg_path(dest_rel) if dest_rel else _backgrounds_root()

    if not os.path.exists(src):
        raise HTTPException(404, "Source not found")
    if not os.path.isdir(dest_dir):
        raise HTTPException(400, "Destination folder does not exist")

    basename = os.path.basename(src.rstrip(os.sep))
    # Refuse to move a folder into itself or any of its own children.
    if os.path.isdir(src):
        src_abs = os.path.abspath(src)
        dest_abs = os.path.abspath(dest_dir)
        if dest_abs == src_abs or dest_abs.startswith(src_abs + os.sep):
            raise HTTPException(400, "Can't move a folder into itself")

    base, ext = os.path.splitext(basename)
    target = os.path.join(dest_dir, basename)
    idx = 1
    while os.path.exists(target):
        if os.path.abspath(target) == os.path.abspath(src):
            # Same location — treat as no-op.
            return {"moved": False, "path": os.path.relpath(target, _backgrounds_root()).replace("\\", "/")}
        target = os.path.join(dest_dir, f"{base}_{idx}{ext}")
        idx += 1

    try:
        shutil.move(src, target)
    except OSError as e:
        raise HTTPException(500, f"Move failed: {e}")

    rel = os.path.relpath(target, _backgrounds_root()).replace("\\", "/")
    _log(f"Background moved: {src_rel} → {rel}")
    return {"moved": True, "path": rel}


@app.get("/api/backgrounds/all-folders")
async def list_all_folders():
    """Flat list of every folder (recursive) with a video count — used by the config dropdown."""
    root = _backgrounds_root()
    out = [{"path": "", "name": "(All backgrounds — random)", "video_count": 0}]
    total = 0
    for r, _, fs in os.walk(root):
        total += sum(1 for f in fs if f.lower().endswith(_VIDEO_EXTS))
    out[0]["video_count"] = total
    for dirpath, _, _ in os.walk(root):
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel == ".":
            continue
        inner = 0
        for r, _, fs in os.walk(dirpath):
            inner += sum(1 for f in fs if f.lower().endswith(_VIDEO_EXTS))
        out.append({"path": rel, "name": rel, "video_count": inner})
    return {"folders": out}


# ── Run queue ───────────────────────────────────────────────────────
@app.get("/api/pipeline/queue")
async def get_queue():
    from run_queue import snapshot
    return snapshot(PROJECT_ROOT)


@app.post("/api/pipeline/queue/add")
async def queue_add(req: dict):
    """
    Body: {
      post_id: str,
      title?, subreddit?: str  (cached for UI display),
      params?: {
        narrator_gender?, voice_override?, selected_comments?, max_comment_chars?, fresh?
      }
    }
    """
    from run_queue import enqueue
    pid = (req.get("post_id") or "").strip()
    if not pid:
        raise HTTPException(400, "post_id is required")
    item = enqueue(
        PROJECT_ROOT,
        post_id=pid,
        title=(req.get("title") or "").strip(),
        subreddit=(req.get("subreddit") or "").strip(),
        params=req.get("params") or {},
    )
    return {"queued": True, "item": item}


@app.post("/api/pipeline/queue/add-many")
async def queue_add_many(req: dict):
    """Body: { items: [{post_id, title, subreddit, params}, ...] }"""
    from run_queue import enqueue
    created = []
    for it in (req.get("items") or []):
        pid = (it.get("post_id") or "").strip()
        if not pid:
            continue
        created.append(enqueue(
            PROJECT_ROOT,
            post_id=pid,
            title=(it.get("title") or "").strip(),
            subreddit=(it.get("subreddit") or "").strip(),
            params=it.get("params") or {},
        ))
    return {"queued": len(created), "items": created}


@app.delete("/api/pipeline/queue/{queue_id}")
async def queue_remove(queue_id: str):
    from run_queue import remove
    ok = remove(PROJECT_ROOT, queue_id)
    if not ok:
        raise HTTPException(404, "Queue item not found")
    return {"removed": True}


@app.post("/api/pipeline/queue/{queue_id}/retry")
async def queue_retry(queue_id: str):
    from run_queue import retry
    item = retry(PROJECT_ROOT, queue_id)
    if not item:
        raise HTTPException(400, "Queue item isn't in a retryable state (only failed/cancelled)")
    return {"requeued": True, "item": item}


@app.post("/api/pipeline/queue/{queue_id}/move")
async def queue_move(queue_id: str, req: dict):
    """Body: {direction: -1 | +1}"""
    from run_queue import reorder
    direction = int(req.get("direction") or 0)
    if direction not in (-1, 1):
        raise HTTPException(400, "direction must be -1 or 1")
    ok = reorder(PROJECT_ROOT, queue_id, direction)
    if not ok:
        raise HTTPException(400, "Can't move that far / item not queued")
    return {"moved": True}


@app.post("/api/pipeline/queue/pause")
async def queue_pause():
    from run_queue import set_paused
    set_paused(PROJECT_ROOT, True)
    return {"paused": True}


@app.post("/api/pipeline/queue/resume")
async def queue_resume():
    from run_queue import set_paused
    set_paused(PROJECT_ROOT, False)
    return {"paused": False}


@app.post("/api/pipeline/queue/clear-history")
async def queue_clear_history():
    from run_queue import clear_history
    dropped = clear_history(PROJECT_ROOT)
    return {"dropped": dropped}


@app.get("/api/cost/summary")
async def cost_summary():
    """Local TTS/AI usage ledger — today + current month + 30-day spark."""
    from cost_tracker import snapshot
    return snapshot(PROJECT_ROOT)


@app.get("/api/cost/elevenlabs-balance")
async def cost_elevenlabs_balance():
    """Live character balance from the ElevenLabs /v1/user endpoint."""
    from cost_tracker import fetch_elevenlabs_balance
    cfg = _load_config()
    tts = cfg.get("tts") or {}
    key = (tts.get("elevenlabs") or {}).get("api_key") or tts.get("elevenlabs_api_key") or ""
    if not key:
        return {"available": False, "reason": "no_api_key"}
    info = fetch_elevenlabs_balance(key)
    if not info:
        return {"available": False, "reason": "fetch_failed"}
    return {"available": True, **info}


# ── Clip Maker ──────────────────────────────────────────────────────
# Feature: long-form media → whisper → LLM finds the best Shorts-worthy
# windows → user adjusts → render 9:16 with captions. Source is either
# an uploaded file or a YouTube URL (yt-dlp).

@app.get("/api/clips")
async def list_clip_projects():
    from clip_projects import load_registry
    return {"projects": load_registry(PROJECT_ROOT)}


@app.get("/api/clips/{project_id}")
async def get_clip_project(project_id: str):
    from clip_projects import load_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    return proj


@app.delete("/api/clips/{project_id}")
async def delete_clip_project(project_id: str):
    from clip_projects import delete_project
    ok = delete_project(PROJECT_ROOT, project_id)
    if not ok:
        raise HTTPException(404, "Clip project not found")
    return {"deleted": True}


@app.post("/api/clips/metadata")
async def probe_clip_source(req: dict):
    """Cheap 'what's this URL?' probe. Shown pre-download."""
    url = (req.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    from yt_ingest import fetch_metadata, IngestError
    try:
        return await asyncio.to_thread(fetch_metadata, url)
    except IngestError as e:
        raise HTTPException(400, str(e))


@app.post("/api/clips/from-youtube")
async def create_clip_project_youtube(req: dict):
    """
    Create a project from a YouTube URL. Spawns a background task that
    downloads + probes duration; returns the new project record
    immediately with status='ingesting'.
    """
    url = (req.get("url") or "").strip()
    name = (req.get("name") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    from clip_projects import create_project
    proj = create_project(PROJECT_ROOT, name=name or "", source_type="youtube", source_url=url)
    asyncio.create_task(_ingest_youtube_async(proj["id"], url))
    return proj


@app.post("/api/clips/from-upload")
async def create_clip_project_upload(file: UploadFile = File(...), name: str = ""):
    """Create a project from an uploaded mp4 — streams to disk."""
    fn = os.path.basename(file.filename or "")
    ext = os.path.splitext(fn)[1].lower() or ".mp4"
    if ext not in (".mp4", ".mov", ".mkv", ".webm", ".avi"):
        raise HTTPException(400, "Unsupported video format — use mp4 / mov / mkv / webm / avi")

    from clip_projects import create_project, save_project, project_dir
    proj = create_project(PROJECT_ROOT, name=name or os.path.splitext(fn)[0],
                          source_type="upload")
    dest = os.path.join(project_dir(PROJECT_ROOT, proj["id"]), f"source{ext}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    size = 0
    with open(dest, "wb") as f:
        while True:
            chunk = await file.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)

    # Probe duration via ffprobe.
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = "ffmpeg"
    probe = subprocess.run(
        [ff, "-i", dest, "-hide_banner"], capture_output=True, text=True
    )
    duration = 0.0
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", probe.stderr or "")
    if m:
        h, mm, ss = m.groups()
        duration = int(h) * 3600 + int(mm) * 60 + float(ss)

    proj["source_file"] = dest
    proj["duration_s"] = duration
    proj["status"] = "ready_to_transcribe"
    proj["status_detail"] = f"uploaded {size / 1024 / 1024:.1f} MB"
    save_project(PROJECT_ROOT, proj)
    return proj


async def _ingest_youtube_async(project_id: str, url: str):
    from clip_projects import load_project, save_project, project_dir, set_status
    from yt_ingest import download, parse_vtt_to_segments, IngestError

    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        return
    try:
        cfg = _load_config()
        cm_cfg = cfg.get("clipmaker") or {}
        max_dur = int(cm_cfg.get("max_duration_s", 3600))
        set_status(PROJECT_ROOT, project_id, "ingesting", f"downloading (cap {max_dur // 60}m)")
        dest_dir = project_dir(PROJECT_ROOT, project_id)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, "source.mp4")

        def _dl():
            return download(url, dest, max_duration_s=max_dur)
        info = await asyncio.to_thread(_dl)

        proj = load_project(PROJECT_ROOT, project_id)
        if not proj:
            return
        proj["source_file"] = info["video_path"]
        proj["duration_s"]  = info["duration_s"]
        proj["name"]        = proj["name"] or info["title"]
        proj["source_thumb"] = info["thumbnail"]

        # If yt-dlp grabbed auto-captions, we can skip whisper entirely.
        if info["caption_vtt_path"]:
            segs = parse_vtt_to_segments(info["caption_vtt_path"])
            if segs:
                proj["transcript"] = {
                    "source":   f"youtube-{info['caption_source']}",
                    "lang":     "en",
                    "segments": segs,
                }
                proj["status"] = "ready_to_propose"
                proj["status_detail"] = f"{len(segs)} caption cues via YouTube"
                save_project(PROJECT_ROOT, proj)
                _log(f"Clip project {project_id}: YT captions imported ({len(segs)} cues)")
                return
        # No captions — defer to a whisper pass when the user asks.
        proj["status"] = "ready_to_transcribe"
        proj["status_detail"] = "downloaded; needs whisper for transcript"
        save_project(PROJECT_ROOT, proj)
        _log(f"Clip project {project_id}: downloaded, awaiting transcription")
    except IngestError as e:
        set_status(PROJECT_ROOT, project_id, "failed", "", error=str(e))
    except Exception as e:
        set_status(PROJECT_ROOT, project_id, "failed", "", error=f"ingest error: {e}")


@app.post("/api/clips/{project_id}/transcribe")
async def transcribe_clip_project(project_id: str):
    """Run faster-whisper over the source when auto-captions aren't available."""
    from clip_projects import load_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    if not proj.get("source_file"):
        raise HTTPException(400, "Source file not ready yet")
    asyncio.create_task(_transcribe_clip_async(project_id))
    return {"started": True}


async def _transcribe_clip_async(project_id: str):
    from clip_projects import load_project, save_project, set_status
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        return
    try:
        set_status(PROJECT_ROOT, project_id, "transcribing", "faster-whisper on source")
        from whisper_align import is_available, _get_model, _resolve_device
        if not is_available():
            set_status(PROJECT_ROOT, project_id, "failed", "", error="faster-whisper not installed")
            return

        cfg = _load_config()
        cm_cfg = cfg.get("clipmaker") or {}
        model_size = cm_cfg.get("transcribe_model") or "base"
        device, compute = _resolve_device("auto", "default")

        def _run():
            model = _get_model(model_size, device, compute)
            segments_iter, _info = model.transcribe(proj["source_file"], language="en")
            out = []
            for seg in segments_iter:
                out.append({
                    "start": float(seg.start or 0),
                    "end":   float(seg.end or 0),
                    "text":  (seg.text or "").strip(),
                })
            return out

        segs = await asyncio.to_thread(_run)
        proj = load_project(PROJECT_ROOT, project_id)
        if not proj:
            return
        proj["transcript"] = {"source": f"whisper-{model_size}", "lang": "en", "segments": segs}
        proj["status"] = "ready_to_propose"
        proj["status_detail"] = f"{len(segs)} transcript cues"
        save_project(PROJECT_ROOT, proj)
        _log(f"Clip project {project_id}: whisper transcribed {len(segs)} segments")
    except Exception as e:
        set_status(PROJECT_ROOT, project_id, "failed", "", error=f"transcribe error: {e}")


@app.post("/api/clips/{project_id}/propose")
async def propose_clip_project(project_id: str, req: dict = {}):
    """Ask the LLM for the top N clip windows."""
    from clip_projects import load_project, save_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    tr = proj.get("transcript") or {}
    segs = tr.get("segments") or []
    cfg = _load_config()
    g = cfg.get("gemini") or {}
    cm = cfg.get("clipmaker") or {}
    mode = req.get("mode") or cm.get("mode", "ai_only")
    # event_driven mode doesn't need a transcript — it reads the source
    # file directly for audio/visual signals. Only block the transcript-
    # based modes when there isn't one.
    if not segs and mode != "event_driven":
        raise HTTPException(400, "No transcript yet — run /transcribe first (or use a YouTube link with captions).")

    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    from clip_propose import propose_clips
    # Heuristic modes (ai_plus, ai_visual, event_driven) need the source
    # file to compute audio / visual signals. None is fine for ai_only /
    # manual.
    source_path_for_heuristics = proj.get("source_file") or None
    # Precedence (lowest → highest): config.json → project-stored
    # event_detect (where per-project ref sounds live) → per-request
    # override (pre/post roll tweaked on the Propose button).
    event_cfg: dict = {}
    if isinstance(cm.get("event_detect"), dict):
        event_cfg.update(cm["event_detect"])
    if isinstance(proj.get("event_detect"), dict):
        event_cfg.update(proj["event_detect"])
    if isinstance(req.get("event_detect"), dict):
        event_cfg.update(req["event_detect"])
    def _run():
        return propose_clips(
            segs,
            duration_s=proj.get("duration_s", 0),
            provider=provider, api_key=api_key, model=model, ollama_url=ollama_url,
            target_count=int(req.get("target_count") or cm.get("target_count", 5)),
            min_len_s=int(req.get("min_len_s") or cm.get("min_len_s", 15)),
            max_len_s=int(req.get("max_len_s") or cm.get("max_len_s", 60)),
            mode=mode,
            source_path=source_path_for_heuristics,
            event_cfg=event_cfg,
        )

    proposals = await asyncio.to_thread(_run)
    proj["proposals"] = proposals
    proj["status"] = "ready_to_review"
    proj["status_detail"] = f"{len(proposals)} proposals"
    save_project(PROJECT_ROOT, proj)
    _log(f"Clip project {project_id}: {len(proposals)} proposals via {provider}")
    return {"proposals": proposals}


@app.post("/api/clips/{project_id}/proposals/{proposal_id}")
async def update_proposal(project_id: str, proposal_id: str, req: dict):
    """Edit a proposal's start/end/title/approval."""
    from clip_projects import load_project, save_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    props = proj.get("proposals") or []
    found = None
    for p in props:
        if p.get("id") == proposal_id:
            found = p
            break
    if not found:
        raise HTTPException(404, "Proposal not found")
    if "start" in req:
        found["start"] = max(0.0, float(req["start"] or 0))
        found["user_adjusted"] = True
    if "end" in req:
        found["end"] = max(found["start"] + 1.0, float(req["end"] or 0))
        found["user_adjusted"] = True
    if "approved" in req:
        found["approved"] = bool(req["approved"])
    if "custom_title" in req:
        found["custom_title"] = (req["custom_title"] or "")[:200] or None
    save_project(PROJECT_ROOT, proj)
    return {"proposal": found}


@app.post("/api/clips/{project_id}/proposals/add")
async def add_proposal(project_id: str, req: dict):
    """Add a manually-specified clip window."""
    from clip_projects import load_project, save_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    start = max(0.0, float(req.get("start") or 0))
    end   = max(start + 1.0, float(req.get("end") or 0))
    existing = proj.get("proposals") or []
    # Pick a unique id — next pN after the current max.
    n = len(existing) + 1
    while any(p.get("id") == f"p{n}" for p in existing):
        n += 1
    new = {
        "id":            f"p{n}",
        "start":         start,
        "end":           end,
        "hook_line":     (req.get("hook_line") or "").strip()[:200],
        "reason":        "manual",
        "score":         0,
        "approved":      True,
        "user_adjusted": True,
        "custom_title":  (req.get("custom_title") or "").strip()[:200] or None,
    }
    existing.append(new)
    proj["proposals"] = existing
    proj["status"] = "ready_to_review"
    save_project(PROJECT_ROOT, proj)
    return {"proposal": new}


@app.post("/api/clips/{project_id}/references")
async def upload_clip_reference(project_id: str,
                                 file: UploadFile = File(...),
                                 label: str = "",
                                 min_ncc: float = 0.5):
    """
    Upload a reference sound (short WAV/MP3) for template matching in
    event_driven mode. Stored under `clips/<project_id>/refs/`. The
    project's event_detect.reference_sounds list is updated.
    """
    from clip_projects import load_project, save_project, project_dir
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    # Simple extension guard — FFmpeg decodes inside, so we're lenient.
    safe_name = os.path.basename(file.filename or "ref.wav")
    # Strip any path-escape attempts; keep a plain filename.
    safe_name = re.sub(r"[^\w\.\-]+", "_", safe_name).strip("._") or "ref.wav"
    refs_dir = os.path.join(project_dir(PROJECT_ROOT, project_id), "refs")
    os.makedirs(refs_dir, exist_ok=True)
    dest = os.path.join(refs_dir, safe_name)
    # De-dup: if the name is taken, suffix with _2, _3, …
    stem, ext = os.path.splitext(safe_name)
    n = 2
    while os.path.exists(dest):
        dest = os.path.join(refs_dir, f"{stem}_{n}{ext}")
        n += 1
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    # Persist into the project's event_detect config.
    ed = proj.setdefault("event_detect", {})
    refs = ed.setdefault("reference_sounds", [])
    refs.append({
        "path":    dest,
        "label":   label or os.path.splitext(os.path.basename(dest))[0],
        "min_ncc": max(0.2, min(0.95, float(min_ncc))),
    })
    save_project(PROJECT_ROOT, proj)
    return {"added": True, "ref": refs[-1]}


@app.get("/api/clips/{project_id}/references")
async def list_clip_references(project_id: str):
    """Return all reference sounds attached to this project."""
    from clip_projects import load_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    refs = (proj.get("event_detect") or {}).get("reference_sounds") or []
    # Only expose safe shape to UI — basename + label + threshold.
    return {
        "references": [
            {
                "name":    os.path.basename(r.get("path") or ""),
                "label":   r.get("label") or "",
                "min_ncc": r.get("min_ncc", 0.5),
                "exists":  bool(r.get("path") and os.path.isfile(r.get("path"))),
            }
            for r in refs if isinstance(r, dict)
        ]
    }


@app.delete("/api/clips/{project_id}/references/{name}")
async def delete_clip_reference(project_id: str, name: str):
    """Remove a reference sound by basename."""
    from clip_projects import load_project, save_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    ed = proj.setdefault("event_detect", {})
    refs = ed.get("reference_sounds") or []
    keep = []
    removed_path = None
    for r in refs:
        if isinstance(r, dict) and os.path.basename(r.get("path") or "") == name:
            removed_path = r.get("path")
            continue
        keep.append(r)
    ed["reference_sounds"] = keep
    save_project(PROJECT_ROOT, proj)
    if removed_path and os.path.isfile(removed_path):
        try: os.remove(removed_path)
        except OSError: pass
    return {"deleted": True}


@app.delete("/api/clips/{project_id}/proposals/{proposal_id}")
async def delete_proposal(project_id: str, proposal_id: str):
    from clip_projects import load_project, save_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")
    proj["proposals"] = [p for p in (proj.get("proposals") or []) if p.get("id") != proposal_id]
    save_project(PROJECT_ROOT, proj)
    return {"deleted": True}


@app.post("/api/clips/{project_id}/render")
async def render_clip_project(project_id: str, req: dict = {}):
    """
    Queue every APPROVED proposal for rendering. Each becomes its own
    queue item so the run queue UI shows per-clip progress.
    """
    from clip_projects import load_project, save_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Clip project not found")

    only_ids = req.get("only_ids") or []
    approved = [
        p for p in (proj.get("proposals") or [])
        if p.get("approved") and (not only_ids or p.get("id") in only_ids)
    ]
    if not approved:
        raise HTTPException(400, "No approved proposals to render")

    from run_queue import enqueue
    queued = []
    for prop in approved:
        title = (prop.get("custom_title") or prop.get("hook_line") or
                 f"{proj['name']} — {prop['id']}")[:100]
        item = enqueue(
            PROJECT_ROOT,
            post_id=f"clip:{project_id}:{prop['id']}",
            title=title,
            subreddit="clipmaker",
            params={
                "kind":        "clip",
                "clip_project": project_id,
                "clip_proposal": prop["id"],
            },
        )
        queued.append(item)

    proj["status"] = "rendering"
    proj["status_detail"] = f"{len(queued)} clip(s) queued"
    save_project(PROJECT_ROOT, proj)
    return {"queued": len(queued), "items": queued}


@app.get("/api/clips/{project_id}/source-video")
async def clip_source_stream(project_id: str):
    """Stream the source file back for the in-browser review player."""
    from fastapi.responses import FileResponse
    from clip_projects import load_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj or not proj.get("source_file") or not os.path.isfile(proj["source_file"]):
        raise HTTPException(404, "Source not available")
    return FileResponse(proj["source_file"], media_type="video/mp4")


@app.get("/api/clips/{project_id}/clip-video")
async def rendered_clip_stream(project_id: str, proposal_id: str):
    """Stream a rendered clip back."""
    from fastapi.responses import FileResponse
    from clip_projects import load_project
    proj = load_project(PROJECT_ROOT, project_id)
    if not proj:
        raise HTTPException(404, "Not found")
    for r in (proj.get("rendered_clips") or []):
        if r.get("proposal_id") == proposal_id:
            vp = r.get("video_path")
            if vp and os.path.isfile(vp):
                return FileResponse(vp, media_type="video/mp4")
    raise HTTPException(404, "Rendered clip not found")


@app.get("/api/render-history")
async def render_history_endpoint(days: int = 30):
    """30/60/90-day render history for the Dashboard chart."""
    from render_history import snapshot
    days = max(7, min(90, int(days or 30)))
    return snapshot(PROJECT_ROOT, days=days)


@app.get("/api/system/status")
async def system_status():
    """
    Supplemental status for the UI status bar:
      - ollama_reachable: whether the configured Ollama URL is up right now
      - disk_free_gb:     free bytes on the disk that holds videos/
      - videos_dir_gb:    current size of videos/ so the user can tell if
                          they're about to run out of room
    """
    # Ollama ping (configurable URL, fall back to localhost:11434)
    cfg = _load_config()
    ollama_url = (cfg.get("gemini", {}) or {}).get("ollama_url") or "http://localhost:11434"
    ollama_ok = False
    ollama_detail = "unreachable"
    try:
        import requests as _rq
        r = _rq.get(f"{ollama_url.rstrip('/')}/api/tags", timeout=1.0)
        if r.status_code == 200:
            ollama_ok = True
            tags = (r.json() or {}).get("models") or []
            ollama_detail = f"{len(tags)} model(s) loaded"
    except Exception as e:
        ollama_detail = str(e)[:60]

    # Disk free + videos/ size
    disk_free_gb = None
    videos_dir_gb = None
    try:
        import shutil as _sh
        free = _sh.disk_usage(PROJECT_ROOT).free
        disk_free_gb = round(free / (1024 ** 3), 1)
    except Exception:
        pass
    try:
        vd = os.path.join(PROJECT_ROOT, "videos")
        if os.path.isdir(vd):
            total = 0
            for root, _, files in os.walk(vd):
                for f in files:
                    try:
                        total += os.path.getsize(os.path.join(root, f))
                    except OSError:
                        pass
            videos_dir_gb = round(total / (1024 ** 3), 2)
    except Exception:
        pass

    return {
        "ollama_reachable": ollama_ok,
        "ollama_detail":    ollama_detail,
        "ollama_url":       ollama_url,
        "disk_free_gb":     disk_free_gb,
        "videos_dir_gb":    videos_dir_gb,
    }


@app.get("/api/config")
async def get_config():
    return _load_config()


@app.post("/api/ai/test")
async def test_ai_model(req: dict):
    """Test the AI model with a sample prompt to verify connectivity."""
    provider = req.get("provider", "gemini")
    model = req.get("model", "gemini-2.0-flash")
    api_key = req.get("api_key", "")
    ollama_url = req.get("ollama_url", "http://localhost:11434")

    if provider not in ("ollama",) and not api_key:
        # For nvidia_nim, check nvidia_nim-specific key too
        if provider == "nvidia_nim":
            api_key = req.get("nvidia_nim_api_key", req.get("api_key", ""))
        if not api_key:
            raise HTTPException(400, "API key is required")

    try:
        from gemini_hooks import _call_ai
        sample_prompt = "Write a one-sentence hook for a story about a neighbor's strange midnight ritual."
        system_prompt = "You are a short-form video scriptwriter. Write a punchy 1-sentence hook. Output ONLY the hook text."

        result = await asyncio.to_thread(_call_ai, provider, api_key, sample_prompt, system_prompt, model, ollama_url)

        if result:
            _log(f"AI test successful ({provider}/{model})")
            return {"success": True, "response": result}
        else:
            _log(f"AI test returned empty ({provider}/{model})")
            raise HTTPException(502, "Model returned empty response — check API key and model availability")
    except HTTPException:
        raise
    except Exception as e:
        _log(f"AI test failed ({provider}/{model}): {e}")
        raise HTTPException(502, f"AI test failed: {str(e)}")


@app.put("/api/config")
async def update_config(update: dict):
    config = _load_config()
    def deep_merge(base, overlay):
        for key, value in overlay.items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                deep_merge(base[key], value)
            else:
                base[key] = value
    deep_merge(config, update)
    _save_config(config)
    _log("Config updated")
    return {"success": True, "config": config}


@app.get("/api/posts/discover")
async def discover_posts(sort: str = "hot"):
    """
    sort = hot | new | top | viral
    - viral: Reddit sort stays 'hot' but posts ranked client-side by score-per-hour.
    """
    try:
        maker = RedditStoryMaker()
        reddit_sort = "hot" if sort == "viral" else sort
        subreddits = maker.config.get("subreddits", [])
        if not subreddits and "subreddit" in maker.config:
            subreddits = [maker.config["subreddit"]]

        reddit_cfg = maker.config.get("reddit", {}) if isinstance(maker.config.get("reddit"), dict) else {}
        per_sub_cap = int(reddit_cfg.get("max_per_subreddit_per_run", 10))
        # How many posts Reddit actually returns per subreddit listing — the
        # ones that fail filters still count against per_sub_cap, so fetch_limit
        # should be comfortably higher than the cap. Clamped to Reddit's own
        # 100-per-request limit.
        fetch_limit = max(per_sub_cap, int(reddit_cfg.get("fetch_limit", 25)))
        fetch_limit = min(100, fetch_limit)
        used_titles = _used_post_titles()

        from difflib import SequenceMatcher
        def _title_dup(title: str) -> Optional[str]:
            lo = (title or "").strip().lower()
            if not lo:
                return None
            for used in used_titles:
                if SequenceMatcher(None, lo, used.lower()).ratio() >= 0.85:
                    return used
            return None

        # Pagination cap — how many Reddit listing requests we're willing
        # to chain per subreddit in pursuit of enough eligible posts.
        # 4 pages × 100 posts = 400 candidates max per subreddit.
        max_pages = int(reddit_cfg.get("max_fetch_pages", 4))
        max_pages = max(1, min(8, max_pages))
        # How many non-eligible (excluding NSFW-rejected ones, which we keep
        # around so the user can toggle allow_nsfw) posts we retain per
        # subreddit purely for context — otherwise the response is silent
        # about _why_ we couldn't find more.
        keep_rejected_context = 3

        all_posts = []
        for subreddit in subreddits:
            eligible_kept = 0
            rejected_kept = 0
            nsfw_kept = 0
            after_tok = None
            pages_fetched = 0

            # Request delay between pages to be polite to Reddit's rate limits.
            # Reddit's unauth'd limit is 60/min — we're well under that.
            while (eligible_kept < per_sub_cap and pages_fetched < max_pages):
                posts_page, next_after = maker.fetch_subreddit_page(
                    subreddit=subreddit, limit=fetch_limit,
                    sort=reddit_sort, after=after_tok,
                )
                pages_fetched += 1
                if not posts_page:
                    break

                for post in posts_page:
                    meets, reason = maker._meets_filters(post)
                    is_nsfw_reject = (not meets) and reason == "Post is NSFW"

                    # Decide whether to keep this post in the response:
                    # - eligible: always, up to per_sub_cap
                    # - NSFW-rejected: always (user might toggle allow_nsfw)
                    # - other rejects: keep a small handful for context
                    if meets:
                        if eligible_kept >= per_sub_cap:
                            continue
                        eligible_kept += 1
                    elif is_nsfw_reject:
                        # NSFW — always include so toggling allow_nsfw works.
                        nsfw_kept += 1
                    else:
                        if rejected_kept >= keep_rejected_context:
                            continue
                        rejected_kept += 1

                    created_utc = post.get("created_utc", 0)
                    age_hours = max(0.1, (time.time() - created_utc) / 3600)
                    score = post.get("score", 0)
                    viral_score = round(score / age_hours, 2)
                    text = (post.get("title", "") + " " + (post.get("selftext", "") or "")).strip()
                    word_count = len(text.split())
                    # ~155 wpm average across Polly/ElevenLabs Turbo
                    est_duration_s = int(round(word_count / 155 * 60)) if word_count else 0
                    dup_of = _title_dup(post.get("title", ""))
                    all_posts.append({
                        "id": post.get("id"), "title": post.get("title", ""),
                        "subreddit": post.get("subreddit", ""), "score": score,
                        "num_comments": post.get("num_comments", 0),
                        "selftext": (post.get("selftext", "") or "")[:300],
                        "url": post.get("url", ""), "permalink": post.get("permalink", ""),
                        "age_hours": round(age_hours, 1), "over_18": post.get("over_18", False),
                        "viral_score": viral_score,
                        "est_duration_s": est_duration_s,
                        "word_count": word_count,
                        "meets_filters": meets,
                        "filter_reason": reason if not meets else None,
                        "already_used": post.get("id") in maker.used_posts,
                        "title_dupe_of": dup_of,
                    })

                if not next_after:
                    break  # end of listing
                after_tok = next_after
                # Light delay between pagination calls per subreddit.
                if pages_fetched < max_pages and eligible_kept < per_sub_cap:
                    await asyncio.sleep(0.5)

            _log(
                f"r/{subreddit}: {eligible_kept} eligible + {nsfw_kept} NSFW (kept) + "
                f"{rejected_kept} other-reject (context) from {pages_fetched} page(s)"
            )

        if sort == "viral":
            all_posts.sort(key=lambda p: p["viral_score"], reverse=True)
        stats["posts_scanned"] += len(all_posts)
        # Keep AI-score cache entries warm for every post that showed up in
        # discovery, so a post that's been sitting in the feed for a week
        # but never rendered doesn't lose its cached score to the TTL prune.
        try:
            from ai_score_cache import touch as _cache_touch
            _cache_touch(PROJECT_ROOT, [p["id"] for p in all_posts if p.get("id")])
        except Exception:
            pass
        _log(
            f"Discovered {len(all_posts)} posts from {len(subreddits)} subreddit(s) "
            f"(sort={sort}, fetch={fetch_limit}/page, up to {max_pages} pages/sub, target={per_sub_cap} eligible/sub)"
        )
        return {"posts": all_posts, "total": len(all_posts)}
    except Exception as e:
        _log(f"Discover error: {e}")
        raise HTTPException(500, str(e))


# ── Post Comments ─────────────────────────────────────────────────────

@app.post("/api/posts/comments")
async def get_post_comments(req: dict = {}):
    """Fetch comments for a Reddit post. Accepts URL or post_id. Returns comments for selection."""
    url = req.get("url", "").strip()
    post_id = req.get("post_id", "").strip()

    # Extract post_id from URL if given
    if url and not post_id:
        match = re.search(r'/comments/([a-z0-9]+)', url)
        if match:
            post_id = match.group(1)
        else:
            match = re.search(r'redd\.it/([a-z0-9]+)', url)
            if match:
                post_id = match.group(1)

    if not post_id:
        raise HTTPException(400, "Could not determine post ID")

    try:
        # Check if post already exists on disk
        post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
        if os.path.exists(post_dir) and os.path.exists(os.path.join(post_dir, "full_data.json")):
            formatter = StoryFormatter(post_id)
        else:
            # Fetch from Reddit first
            maker = RedditStoryMaker()
            post_url = f"https://www.reddit.com/comments/{post_id}"
            full_data = await asyncio.to_thread(maker.fetch_post_details, post_url)
            if not full_data:
                raise HTTPException(502, "Could not fetch post from Reddit")
            post_data = full_data[0]["data"]["children"][0]["data"] if isinstance(full_data, list) else full_data
            post_obj = {
                "id": post_id, "title": post_data.get("title", ""),
                "author": post_data.get("author", ""), "subreddit": post_data.get("subreddit", ""),
                "score": post_data.get("score", 0), "upvote_ratio": post_data.get("upvote_ratio", 0),
                "url": post_data.get("url", ""), "permalink": post_data.get("permalink", ""),
                "selftext": post_data.get("selftext", ""), "num_comments": post_data.get("num_comments", 0),
                "over_18": post_data.get("over_18", False), "is_video": post_data.get("is_video", False),
                "created_utc": post_data.get("created_utc", 0),
            }
            await asyncio.to_thread(maker.save_post_data, post_id, post_obj, full_data)
            formatter = StoryFormatter(post_id)

        comments = formatter.get_all_comments(min_score=0)
        title = formatter.summary.get("title", "")
        return {
            "post_id": post_id,
            "title": title,
            "comments": [
                {
                    "index": i,
                    "author": c["author"],
                    "body": c["body"],
                    "score": c["score"],
                    "char_count": len(c["body"]),
                }
                for i, c in enumerate(comments)
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        _log(f"Comments fetch error: {e}")
        raise HTTPException(500, str(e))

# ── Pipeline ──────────────────────────────────────────────────────────

@app.get("/api/pipeline/status")
async def pipeline_status():
    return pipeline_state


@app.post("/api/pipeline/run")
async def run_pipeline(req: dict = {}):
    if pipeline_state["is_running"]:
        raise HTTPException(409, "Pipeline is already running")
    post_id = req.get("post_id")
    selected_comments = req.get("selected_comments")  # optional list of indices
    max_comment_chars = req.get("max_comment_chars", 0)
    narrator_gender  = req.get("narrator_gender")  # "auto" | "male" | "female" | None
    voice_override   = req.get("voice_override")
    fresh            = bool(req.get("fresh"))  # true = wipe existing project data first

    # If `fresh` is set, delete EVERYTHING associated with this post so the
    # new run doesn't appear as a duplicate on the Videos page:
    #   1. Previous final .mp4s + thumbnails listed in the projects.json entry
    #      (these live in videos/ and wouldn't be cleaned otherwise)
    #   2. posts/<id>/ (Reddit JSON, TTS audio, timeline)
    #   3. videos/proj_<id>/ (preserved audio + timeline from previous run)
    #   4. projects.json entry
    #   5. in-memory videos_db entry
    #   6. used_posts.json entry (so discover can re-surface the post)
    if fresh and post_id:
        try:
            # 1. Delete old rendered mp4s + thumbnails from videos/ so they
            # don't keep showing up as separate entries.
            try:
                from projects_db import find as _reg_find
                old_proj = _reg_find(PROJECT_ROOT, post_id)
            except Exception:
                old_proj = None
            if old_proj:
                for vp in old_proj.get("video_paths") or []:
                    try:
                        if vp and os.path.isfile(vp):
                            os.remove(vp)
                            _log(f"Fresh run: removed old video {os.path.basename(vp)}")
                            # Sibling thumbnail.
                            base = os.path.splitext(vp)[0]
                            for t in (base + "_thumbnail.png", base + ".png"):
                                if os.path.isfile(t):
                                    os.remove(t)
                    except OSError as e:
                        _log(f"Fresh run: could not remove {vp}: {e}")

            # 2. posts/<id>/ workspace
            post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
            if os.path.isdir(post_dir):
                shutil.rmtree(post_dir)
                _log(f"Fresh run: cleared {post_dir}")
            # 3. videos/proj_<id>/ preserved dir
            preserve_dir = os.path.join(PROJECT_ROOT, "videos", f"proj_{post_id}")
            if os.path.isdir(preserve_dir):
                shutil.rmtree(preserve_dir)
                _log(f"Fresh run: cleared {preserve_dir}")
            # 4. projects.json entry
            try:
                from projects_db import remove as _reg_remove
                _reg_remove(PROJECT_ROOT, post_id)
            except Exception:
                pass
            # 5. In-memory list — drop this project AND any legacy loose-mp4
            #    entries whose id matches the pattern we'd have generated for
            #    this post (slug_reel_timestamp). Simpler: drop anything
            #    whose video_paths reference a now-deleted file.
            global videos_db
            def _paths_alive(v: dict) -> bool:
                paths = v.get("video_paths") or []
                return any(p and os.path.exists(p) for p in paths)
            videos_db = [v for v in videos_db if v["id"] != post_id and _paths_alive(v)]
            _persist_videos_db()
            # And remove the post from used_posts so discover can re-pick it.
            try:
                used_path = os.path.join(PROJECT_ROOT,
                    _load_config().get("output", {}).get("used_posts_file", "used_posts.json"))
                if os.path.exists(used_path):
                    with open(used_path, "r", encoding="utf-8") as _uf:
                        used = json.load(_uf)
                    used = [x for x in used if x != post_id]
                    with open(used_path, "w", encoding="utf-8") as _uf:
                        json.dump(used, _uf, indent=2)
            except Exception:
                pass
        except Exception as e:
            _log(f"Fresh cleanup warning: {e}")

    for step in pipeline_state["steps"]:
        step["status"] = "idle"
        step["detail"] = ""
        step.pop("sub_steps", None)
    # Skip AI step for Reddit pipeline
    _set_step("ai_generate", "done", "Reddit mode — skipped")
    pipeline_state["is_running"] = True
    pipeline_state["error"] = None
    pipeline_state["current_post"] = None
    pipeline_state["started_at"] = datetime.now(timezone.utc).isoformat()
    pipeline_state["completed_at"] = None
    _log(f"Pipeline started" + (f" for post {post_id}" if post_id else "") + (" (fresh)" if fresh else ""))
    asyncio.create_task(_run_pipeline_async(
        post_id,
        selected_comments=selected_comments,
        max_comment_chars=max_comment_chars,
        narrator_gender=narrator_gender,
        voice_override=voice_override,
    ))
    return {"started": True}


@app.post("/api/pipeline/run-url")
async def run_pipeline_from_url(req: dict = {}):
    """Run the pipeline from a specific Reddit URL with custom preferences."""
    if pipeline_state["is_running"]:
        raise HTTPException(409, "Pipeline is already running")
    
    url = req.get("url", "").strip()
    if not url:
        raise HTTPException(400, "URL is required")
    
    post_id = None
    match = re.search(r'/comments/([a-z0-9]+)', url)
    if match:
        post_id = match.group(1)
    else:
        match = re.search(r'redd\.it/([a-z0-9]+)', url)
        if match:
            post_id = match.group(1)
    
    if not post_id:
        raise HTTPException(400, "Could not extract post ID from URL. Use a valid Reddit post URL.")
    
    video_mode = req.get("video_mode")
    format_mode = req.get("format_mode")
    tts_enabled = req.get("tts_enabled")
    selected_comments = req.get("selected_comments")  # list of indices
    max_comment_chars = req.get("max_comment_chars", 0)
    
    config = _load_config()
    if video_mode:
        config.setdefault("video", {})["mode"] = video_mode
    if format_mode:
        config.setdefault("formatting", {})["default_mode"] = format_mode
    if tts_enabled is not None:
        config.setdefault("tts", {})["enabled"] = tts_enabled
    _save_config(config)
    
    for step in pipeline_state["steps"]:
        step["status"] = "idle"
        step["detail"] = ""
        step.pop("sub_steps", None)
    _set_step("ai_generate", "done", "Reddit URL mode — skipped")
    pipeline_state["is_running"] = True
    pipeline_state["error"] = None
    pipeline_state["current_post"] = None
    pipeline_state["started_at"] = datetime.now(timezone.utc).isoformat()
    pipeline_state["completed_at"] = None
    _log(f"Pipeline started from URL for post {post_id} (mode={video_mode}, format={format_mode})")
    asyncio.create_task(_run_pipeline_async(post_id, selected_comments=selected_comments, max_comment_chars=max_comment_chars))
    return {"started": True}


@app.post("/api/pipeline/run-custom")
async def run_pipeline_custom(req: dict = {}):
    """Run the pipeline from user-provided custom story or Q&A content."""
    if pipeline_state["is_running"]:
        raise HTTPException(409, "Pipeline is already running")

    title = req.get("title", "").strip()
    content = req.get("content", "").strip()
    format_mode = req.get("format_mode", "story")
    video_mode = req.get("video_mode", "short_reel")
    tts_enabled = req.get("tts_enabled", True)
    comments = req.get("comments", [])  # list of {author, body} for Q&A

    if not title:
        raise HTTPException(400, "Title is required")
    if not content:
        raise HTTPException(400, "Content is required")

    # Create a synthetic post directory
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    post_id = f"custom_{timestamp}"
    post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    os.makedirs(post_dir, exist_ok=True)

    # Write summary.json (same structure the pipeline expects)
    summary = {
        "id": post_id,
        "title": title,
        "author": "custom",
        "subreddit": "Custom",
        "score": 0,
        "upvote_ratio": 1.0,
        "url": "",
        "permalink": "",
        "selftext": content,
        "num_comments": len(comments),
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(os.path.join(post_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    # Write full_data.json for the formatter
    full_children = []
    for i, c in enumerate(comments):
        full_children.append({
            "kind": "t1",
            "data": {
                "author": c.get("author", f"User{i+1}"),
                "body": c.get("body", ""),
                "score": c.get("score", 1),
                "stickied": False,
            }
        })

    full_data = [
        {
            "kind": "Listing",
            "data": {
                "children": [{
                    "kind": "t3",
                    "data": {
                        "id": post_id, "title": title, "author": "custom",
                        "subreddit": "Custom", "score": 0, "upvote_ratio": 1.0,
                        "url": "", "permalink": "", "selftext": content,
                        "num_comments": len(comments),
                    }
                }]
            }
        },
        {
            "kind": "Listing",
            "data": {"children": full_children}
        },
    ]
    with open(os.path.join(post_dir, "full_data.json"), "w", encoding="utf-8") as f:
        json.dump(full_data, f, indent=2)

    # Update config for this run
    config = _load_config()
    if video_mode:
        config.setdefault("video", {})["mode"] = video_mode
    if format_mode:
        config.setdefault("formatting", {})["default_mode"] = format_mode
    if tts_enabled is not None:
        config.setdefault("tts", {})["enabled"] = tts_enabled
    _save_config(config)

    # Start pipeline
    for step in pipeline_state["steps"]:
        step["status"] = "idle"
        step["detail"] = ""
        step.pop("sub_steps", None)
    _set_step("ai_generate", "done", "Custom content — skipped")
    pipeline_state["is_running"] = True
    pipeline_state["error"] = None
    pipeline_state["current_post"] = {"id": post_id, "title": title, "subreddit": "Custom", "score": 0}
    pipeline_state["started_at"] = datetime.now(timezone.utc).isoformat()
    pipeline_state["completed_at"] = None
    _log(f"Pipeline started from custom content: {title[:60]} (mode={format_mode})")

    # Run pipeline — the fetch step will find summary.json on disk and skip Reddit fetch
    asyncio.create_task(_run_pipeline_async(post_id))
    return {"started": True}


# ──────────────────────────────────────────────────────────────────────
# AI-script drafts — survive accidental dialog-close / browser refresh.
#
# The dialog now writes the latest set of generated candidates here as
# soon as they're produced (and on every per-card regenerate). When the
# user re-opens the dialog, the frontend fetches this and offers to
# resume. Once the user runs/approves or explicitly discards, the draft
# is deleted.
#
# Single-slot store at .cache/ai_drafts.json. Multi-user isn't a concern
# in self-hosted mode and a single record keeps the UI uncluttered.
# ──────────────────────────────────────────────────────────────────────

def _ai_drafts_path() -> str:
    d = os.path.join(PROJECT_ROOT, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "ai_drafts.json")


@app.post("/api/ai/drafts")
async def save_ai_draft(req: dict):
    """
    Persist the in-flight Generate-with-AI state. Body:
      {
        "params":   {<dialog state — content_style, niche, ..., target_audience, tone, count, etc>},
        "variants": [<variant dicts from /generate-variants>]
      }
    """
    variants = req.get("variants")
    params = req.get("params") or {}
    if not isinstance(variants, list):
        raise HTTPException(400, "variants[] required")
    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "params": params,
        "variants": variants,
    }
    try:
        path = _ai_drafts_path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"last_draft": payload}, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception as e:
        raise HTTPException(500, f"Failed to save draft: {e}")
    return {"saved": True, "created_at": payload["created_at"], "count": len(variants)}


@app.get("/api/ai/drafts")
async def get_ai_draft():
    """Return the most recent draft, or {draft: None}."""
    path = _ai_drafts_path()
    if not os.path.isfile(path):
        return {"draft": None}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"draft": data.get("last_draft")}
    except Exception:
        return {"draft": None}


@app.delete("/api/ai/drafts")
async def clear_ai_draft():
    """Discard the saved draft (on Run approved, or explicit Discard)."""
    path = _ai_drafts_path()
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass
    return {"cleared": True}


@app.post("/api/ai/generate-variants")
async def generate_ai_variants(req: dict = {}):
    """
    Generate N candidate content variants in parallel without touching pipeline state.
    The frontend shows these in a picker; the chosen one is then handed to
    /api/pipeline/run-ai via the `preselected_content` field.
    """
    config = _load_config()
    gemini_cfg = config.get("gemini", {})
    if not gemini_cfg.get("enabled", False):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    content_style      = req.get("content_style", "story")
    niche              = req.get("niche", "relationship_drama")
    custom_topic       = req.get("custom_topic")
    interactive_format = req.get("interactive_format", "put_a_finger_down")

    acg_cfg = config.get("ai_content_generation", {}) or {}
    content_filter = (req.get("content_filter") or acg_cfg.get("content_filter_default") or "normal").strip().lower()
    if content_filter not in ("safe", "normal", "edgy"):
        content_filter = "normal"
    target_audience = (req.get("target_audience") or acg_cfg.get("target_audience_default") or "").strip() or None
    tone = (req.get("tone") or acg_cfg.get("tone_default") or "dramatic").strip().lower()
    if tone not in ("dramatic", "funny", "heartfelt", "shocking", "cringe"):
        tone = "dramatic"

    try:
        count = max(1, min(5, int(req.get("count", 3))))
    except (TypeError, ValueError):
        count = 3

    from ai_content_generator import AIContentGenerator
    generator = AIContentGenerator(config)

    def _one():
        return generator.generate(
            content_style, niche, custom_topic, interactive_format,
            content_filter, target_audience, tone,
        )

    # Run the N generations concurrently. Each call is already retried inside.
    tasks = [asyncio.to_thread(_one) for _ in range(count)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    variants = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            _log(f"[variants] variant {i+1} raised: {r}")
            continue
        if r:
            variants.append(r)

    if not variants:
        raise HTTPException(502, "All variants failed to generate. Check AI provider logs.")

    return {"variants": variants, "count": len(variants)}


def _write_ai_post_to_disk(
    *,
    content_data: dict,
    content_style: str,
    niche: str,
    content_filter: str,
    target_audience: Optional[str],
    tone: str,
    custom_title: Optional[str] = None,
) -> tuple[str, str, str, str]:
    """
    Materialise an AI-generated content payload into the synthetic-post
    files (`posts/<id>/summary.json` + `full_data.json`) that the
    Reddit-pipeline already knows how to consume. Returns
    `(post_id, title, subreddit, format_mode)`.

    Used by both /api/pipeline/run-ai (the single-shot path) and
    /api/pipeline/batch-run-ai (the queue-many path) — once the post
    files exist, the run queue's existing `kind: "post"` worker handles
    the rest with no AI-specific code.
    """
    import uuid as _uuid
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    # Random suffix so two batch-run items submitted in the same second
    # don't collide on disk.
    short = _uuid.uuid4().hex[:6]
    post_id = f"ai_{content_style}_{timestamp}_{short}"
    post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    os.makedirs(post_dir, exist_ok=True)

    title = (custom_title or content_data.get("title") or "AI Generated Content").strip()
    subreddit = f"AI/{niche}"

    # Build selftext + format_mode based on content style.
    if content_style == "interactive":
        segments = content_data.get("segments", [])
        body_parts = []
        for seg in segments:
            body_parts.append(seg.get("text", ""))
            pause = seg.get("pause_seconds", 0)
            if pause > 0:
                body_parts.append(f"[PAUSE:{pause}]")
        selftext = "\n\n".join(body_parts)
        format_mode = "story"
    elif content_style == "qa":
        selftext = content_data.get("question", title)
        format_mode = "qa"
    else:
        selftext = content_data.get("body", "")
        format_mode = "story"

    summary = {
        "id": post_id, "title": title, "author": "AI",
        "subreddit": subreddit, "score": 0, "upvote_ratio": 1.0,
        "url": "", "permalink": "", "selftext": selftext,
        "num_comments": len(content_data.get("comments", [])),
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "ai_generated": True, "content_style": content_style, "niche": niche,
        "content_filter": content_filter,
        "target_audience": target_audience or "",
        "tone": tone,
    }
    with open(os.path.join(post_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    comments_children = []
    for i, c in enumerate(content_data.get("comments", [])):
        comments_children.append({
            "kind": "t1",
            "data": {
                "author": c.get("author", f"user_{i+1}"),
                "body": c.get("body", ""), "score": c.get("score", 1), "stickied": False,
            }
        })
    full_data = [
        {"kind": "Listing", "data": {"children": [{"kind": "t3", "data": {
            "id": post_id, "title": title, "author": "AI",
            "subreddit": subreddit, "score": 0, "upvote_ratio": 1.0,
            "url": "", "permalink": "", "selftext": selftext,
            "num_comments": len(comments_children),
        }}]}},
        {"kind": "Listing", "data": {"children": comments_children}},
    ]
    with open(os.path.join(post_dir, "full_data.json"), "w", encoding="utf-8") as f:
        json.dump(full_data, f, indent=2)

    return post_id, title, subreddit, format_mode


@app.post("/api/pipeline/run-ai")
async def run_pipeline_ai(req: dict = {}):
    """Run the pipeline using AI-generated content (story, Q&A, interactive, hot take)."""
    if pipeline_state["is_running"]:
        raise HTTPException(409, "Pipeline is already running")

    content_style = req.get("content_style", "story")
    niche = req.get("niche", "relationship_drama")
    custom_topic = req.get("custom_topic")
    interactive_format = req.get("interactive_format", "put_a_finger_down")
    video_mode = req.get("video_mode", "short_reel")
    tts_enabled = req.get("tts_enabled", True)
    # Per-run transient overrides from the AI dialog (never touch config.json).
    voice_override     = (req.get("voice_override") or "").strip() or None
    narrator_gender    = (req.get("narrator_gender") or "auto").strip().lower() or "auto"
    background_override = req.get("background_selector")
    if background_override is None:
        background_override = None  # keep None so the pipeline falls back to config
    else:
        background_override = str(background_override).strip()
    custom_title       = (req.get("custom_title") or "").strip() or None

    config = _load_config()
    gemini_cfg = config.get("gemini", {})
    if not gemini_cfg.get("enabled", False):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    # Content-filter + target-audience + tone: per-run, fall back to config defaults.
    acg_cfg = config.get("ai_content_generation", {}) or {}
    content_filter = (req.get("content_filter") or acg_cfg.get("content_filter_default") or "normal").strip().lower()
    if content_filter not in ("safe", "normal", "edgy"):
        content_filter = "normal"
    target_audience = (req.get("target_audience") or acg_cfg.get("target_audience_default") or "").strip() or None
    tone = (req.get("tone") or acg_cfg.get("tone_default") or "dramatic").strip().lower()
    if tone not in ("dramatic", "funny", "heartfelt", "shocking", "cringe"):
        tone = "dramatic"

    # Optional: caller already generated the content via /api/ai/generate-variants
    # and picked one — skip the generation step and use this payload directly.
    preselected_content = req.get("preselected_content")

    # Start pipeline steps and mark AI generation as running
    for step in pipeline_state["steps"]:
        step["status"] = "idle"
        step["detail"] = ""
        step.pop("sub_steps", None)
    pipeline_state["is_running"] = True
    pipeline_state["error"] = None
    pipeline_state["started_at"] = datetime.now(timezone.utc).isoformat()
    pipeline_state["completed_at"] = None

    provider_name = gemini_cfg.get("provider", "gemini")
    model_name = gemini_cfg.get("model", "")

    if preselected_content and isinstance(preselected_content, dict):
        # Skip generation — caller picked a variant from /api/ai/generate-variants
        _set_step("ai_generate", "done", f"Using pre-selected: {preselected_content.get('title', '')[:60]}", [
            {"label": f"Style: {content_style}", "status": "done", "detail": ""},
            {"label": f"Niche: {niche}", "status": "done", "detail": ""},
            {"label": "Source: user-picked variant", "status": "done", "detail": "✓ content ready"},
        ])
        content_data = dict(preselected_content)
        content_data.setdefault("content_style", content_style)
    else:
        _set_step("ai_generate", "running", f"Generating {content_style} content...", [
            {"label": f"Style: {content_style}", "status": "running", "detail": ""},
            {"label": f"Niche: {niche}", "status": "pending", "detail": ""},
            {"label": f"Provider: {provider_name} / {model_name}", "status": "pending", "detail": ""},
        ])
        try:
            from ai_content_generator import AIContentGenerator
            generator = AIContentGenerator(config)
            _log(f"Generating AI content: style={content_style}, niche={niche}, filter={content_filter}, tone={tone}")

            content_data = await asyncio.to_thread(
                generator.generate, content_style, niche, custom_topic, interactive_format,
                content_filter, target_audience, tone,
            )
            if not content_data:
                _set_step("ai_generate", "error", "AI returned empty content after retries")
                pipeline_state["is_running"] = False
                pipeline_state["error"] = "AI failed to generate content after retries"
                pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                return {"started": False, "error": "AI failed to generate content"}
        except Exception as e:
            _set_step("ai_generate", "error", f"AI generation failed: {str(e)[:80]}")
            pipeline_state["is_running"] = False
            pipeline_state["error"] = str(e)
            pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()
            _log(f"AI content generation error: {e}")
            raise HTTPException(502, f"AI content generation failed: {str(e)}")

        _set_step("ai_generate", "done", f"Generated: {content_data.get('title', '')[:60]}", [
            {"label": f"Style: {content_style}", "status": "done", "detail": ""},
            {"label": f"Niche: {niche}", "status": "done", "detail": ""},
            {"label": f"Provider: {provider_name}", "status": "done", "detail": "✓ content ready"},
        ])

    # Materialise the content into a synthetic post on disk.
    post_id, title, subreddit, format_mode = _write_ai_post_to_disk(
        content_data=content_data,
        content_style=content_style,
        niche=niche,
        content_filter=content_filter,
        target_audience=target_audience,
        tone=tone,
        custom_title=custom_title,
    )

    # Update config for this run
    if video_mode:
        config.setdefault("video", {})["mode"] = video_mode
    config.setdefault("formatting", {})["default_mode"] = format_mode
    if tts_enabled is not None:
        config.setdefault("tts", {})["enabled"] = tts_enabled
    _save_config(config)

    pipeline_state["current_post"] = {"id": post_id, "title": title, "subreddit": subreddit, "score": 0}
    _log(f"AI pipeline started: {content_style} / {niche} — {title[:60]}"
         + (f" · voice={voice_override}" if voice_override else "")
         + (f" · bg={background_override}" if background_override else ""))

    asyncio.create_task(_run_pipeline_async(
        specific_post_id=post_id,
        narrator_gender=narrator_gender if narrator_gender != "auto" else None,
        voice_override=voice_override,
        background_override=background_override,
    ))
    return {"started": True}


# ──────────────────────────────────────────────────────────────────────
# News Roundup — RSS / Atom feed reader for the /news page.
#
# News-reaction content compounds (daily volume, daily algorithm refresh).
# This endpoint fetches a feed, parses it via stdlib (no feedparser
# dependency), and returns items the user can click to pre-fill the
# Generate-with-AI dialog with the story as context.
# ──────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# Hashtag Lab — paste any caption, get ranked hashtag suggestions backed
# by both AI tag-extraction and (when configured) YouTube benchmark
# data so the user can compare against what's actually getting reach
# in their niche.
# ──────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# Carousel posts — multi-slide IG / TikTok / LinkedIn carousels.
#
# State lives on the frontend (single-page editor with localStorage
# auto-save). Backend is stateless: split a script into N slides, render
# all slides as PNGs and ship them back as a zip.
# ──────────────────────────────────────────────────────────────────────

@app.post("/api/carousels/split-script")
async def carousel_split_script(req: dict):
    """
    Use the configured LLM to split a long-form story into N slide-sized
    chunks. The first slide is reserved for a hook (title only), the
    last slide for a CTA. Body slides are 50-80 words each so they read
    cleanly on mobile.

    Body: { script: str, slide_count: int (3-10), hook_only_first: bool }
    Returns: { slides: [{title, body}, …] }
    """
    script = (req.get("script") or "").strip()
    if not script:
        raise HTTPException(400, "script is required")
    try:
        n = max(3, min(10, int(req.get("slide_count") or 6)))
    except (TypeError, ValueError):
        n = 6

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

    system = (
        "You are a viral Instagram-carousel scriptwriter. Split the provided "
        "story into exactly N slides. Slide 1 is the HOOK (title only — bold, "
        "≤90 chars, builds curiosity). Slides 2 to N-1 are story BEATS — each "
        "~50-80 words, readable on mobile, ending on a mini-cliffhanger so the "
        "reader swipes. The FINAL slide is the PAYOFF + CTA (title + short body "
        "ending with 'Follow for more …' or 'What would you do?'). Return ONLY "
        "minified JSON, no markdown."
    )
    prompt = (
        f"Source story:\n\"\"\"\n{script[:4000]}\n\"\"\"\n\n"
        f"Split into exactly {n} slides.\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "slides": [\n'
        '    {"title": "<bold hook ≤90 chars>", "body": ""},\n'
        '    {"title": "", "body": "<beat 1, ~50-80 words>"},\n'
        "    ...\n"
        '    {"title": "<payoff title>", "body": "<CTA + question>"}\n'
        "  ]\n"
        "}\n"
        "Hook slide title MUST be present. Final slide must include both title and body."
    )

    from gemini_hooks import _call_ai  # type: ignore
    raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
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

    slides = []
    for s in (parsed.get("slides") or [])[:n]:
        slides.append({
            "title": (s.get("title") or "")[:200],
            "body":  (s.get("body") or "")[:600],
        })
    if not slides:
        raise HTTPException(502, "AI returned no slides")
    return {"slides": slides, "count": len(slides)}


@app.post("/api/carousels/preview")
async def carousel_preview_slide(req: dict):
    """
    Render a single slide to PNG and return it as a data URI string.
    Frontend uses this for the live preview pane on every keystroke
    (debounced).

    Body: { slide: {title, body}, style: {...}, idx: int, total: int }
    """
    from carousel_renderer import render_slide_to_png
    slide = req.get("slide") or {}
    style = req.get("style") or {}
    try:
        idx = max(1, int(req.get("idx") or 1))
        total = max(1, int(req.get("total") or 1))
    except (TypeError, ValueError):
        idx, total = 1, 1
    try:
        png_bytes = await asyncio.to_thread(render_slide_to_png, slide, style, idx=idx, total=total)
    except Exception as e:
        raise HTTPException(500, f"Render failed: {e}")
    import base64
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return {"data_uri": f"data:image/png;base64,{b64}"}


# ──────────────────────────────────────────────────────────────────────
# Quote Cards — single-image quote posts. Same renderer as carousels;
# we just emit ONE slide and skip the pagination indicator.
#
# Two flows: paste a quote directly, or pick a quotable line from any
# existing rendered video's transcript / source text.
# ──────────────────────────────────────────────────────────────────────

@app.post("/api/quote-cards/render")
async def quote_card_render(req: dict):
    """
    Body: { quote: str, attribution?: str, style: {...} (carousel style block) }
    Returns: { data_uri: str }  — base64 PNG, the same shape carousel
    preview returns. UI shows it inline + offers a download button.
    """
    from carousel_renderer import render_slide_to_png
    quote = (req.get("quote") or "").strip()
    if not quote:
        raise HTTPException(400, "quote is required")
    attribution = (req.get("attribution") or "").strip()
    style = dict(req.get("style") or {})
    # Quote cards are single-image — pagination indicator makes no sense.
    style["show_pagination"] = False
    slide = {"title": quote, "body": attribution}
    try:
        png_bytes = await asyncio.to_thread(render_slide_to_png, slide, style, idx=1, total=1)
    except Exception as e:
        raise HTTPException(500, f"Render failed: {e}")
    import base64
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return {"data_uri": f"data:image/png;base64,{b64}"}


@app.post("/api/quote-cards/extract")
async def quote_card_extract(req: dict):
    """
    Pull the most quotable lines out of an existing rendered post's
    narration. Body: { post_id: str, max_quotes?: int (default 5) }
    Returns: { quotes: [{ text, why }, ...], source_title: str }

    Uses the configured LLM. Reads the script text from posts/<id>/
    (story_mode.txt → qa_mode.txt → summary.selftext fallback).
    """
    post_id = (req.get("post_id") or "").strip()
    if not post_id:
        raise HTTPException(400, "post_id required")
    try:
        max_quotes = max(1, min(10, int(req.get("max_quotes") or 5)))
    except (TypeError, ValueError):
        max_quotes = 5

    post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    title = ""
    text = ""
    summary_path = os.path.join(post_dir, "summary.json")
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                s = json.load(f)
            title = s.get("title", "")
            text = s.get("selftext", "") or ""
        except Exception:
            pass
    for cand in ("story_mode.txt", "qa_mode.txt"):
        p = os.path.join(post_dir, cand)
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    text = f.read()
                break
            except Exception:
                pass
    if not text:
        raise HTTPException(404, f"No script text found for post {post_id}")

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

    system = (
        "You are pulling the MOST quotable lines out of a piece of writing. "
        "A quotable line is one that stands alone as a single image post on "
        "Instagram or X — punchy, emotionally resonant, or surprising. ≤180 "
        "characters each. Return ONLY minified JSON, no markdown."
    )
    prompt = (
        f"Title: {title}\n\nText:\n\"\"\"\n{text[:4000]}\n\"\"\"\n\n"
        f"Pick the {max_quotes} most quotable lines. They can be paraphrased "
        f"slightly for punch but must preserve the original meaning.\n\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "quotes": [\n'
        '    {"text": "<≤180 char quote>", "why": "<≤80 char one-liner explaining the punch>"},\n'
        "    ...\n"
        "  ]\n"
        "}\n"
    )

    from gemini_hooks import _call_ai  # type: ignore
    raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
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
    quotes = []
    for q in (parsed.get("quotes") or []):
        t = (q.get("text") or "").strip()
        if not t:
            continue
        quotes.append({"text": t[:200], "why": (q.get("why") or "").strip()[:120]})
    return {"quotes": quotes, "source_title": title}


@app.post("/api/carousels/render")
async def carousel_render_zip(req: dict):
    """
    Render every slide and stream back a zip of PNGs. Browser saves
    locally — no server-side persistence. Each PNG is named
    `slide_NN.png` in upload order.

    Body: { slides: [{title, body}, …], style: {...} }
    """
    from carousel_renderer import render_carousel_to_zip
    from fastapi.responses import StreamingResponse
    slides = req.get("slides") or []
    style = req.get("style") or {}
    if not isinstance(slides, list) or not slides:
        raise HTTPException(400, "slides[] required (and non-empty)")
    try:
        zip_bytes = await asyncio.to_thread(render_carousel_to_zip, slides, style)
    except Exception as e:
        raise HTTPException(500, f"Render failed: {e}")
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="carousel.zip"'},
    )


@app.post("/api/hashtags/analyze")
async def analyze_hashtags(req: dict):
    """
    Body: { caption: str, niche?: str, platform?: "tiktok"|"instagram"|"youtube"|"all" }
    Returns:
      {
        "suggestions": [{ "tag": "#aita", "score": 87, "reason": "core Reddit-TikTok niche tag" }, …],
        "from_caption": ["#existingTag", …],     # tags already in the user's caption
        "benchmarks_used": int,                   # # of YT videos scraped, 0 if no API key
        "provider": str, "model": str
      }
    """
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

    # Tags already in the caption — don't recommend duplicates.
    existing = re.findall(r"#[\w_]+", caption)
    existing_lower = {t.lower() for t in existing}

    # YouTube benchmarks for tag-density reference (graceful no-op if no key).
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

    # Build benchmarks block exactly like Social Copy does, then ask the
    # LLM to rank tags. Strict JSON output.
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
    raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
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
        # Drop duplicates of existing tags.
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


@app.get("/api/news/feeds")
async def list_news_feeds():
    """Return the curated feed presets — surfaced as quick-pick buttons."""
    from news_feeds import CURATED_FEEDS
    return {"feeds": CURATED_FEEDS}


@app.post("/api/news/fetch")
async def fetch_news_feed(req: dict):
    """Pull and parse an RSS/Atom feed. Body: { url: str }."""
    from news_feeds import fetch_feed
    url = (req.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    items, err = await asyncio.to_thread(fetch_feed, url)
    if err:
        raise HTTPException(502, err)
    return {"items": items, "count": len(items)}


@app.post("/api/pipeline/run-custom-script")
async def run_pipeline_custom_script(req: dict = {}):
    """
    Render a user-pasted script — no AI generation, no Reddit fetching.
    The script is materialised as a synthetic post via the same helper
    the AI flow uses, then queued through the run-queue. UI lives at
    /custom-script.

    Body:
      title:               required
      body:                required (the script text — TTS will read this verbatim)
      content_style:       "story" (default) — kept here for forward-compat
      video_mode:          "short_reel" (default) | "reel" | "full_video"
      tts_enabled:         bool (default true)
      narrator_gender:     "auto" | "male" | "female"
      voice_override:      voice_id or null
      background_selector: folder | file | empty for random | null for config default
      enqueue:             when true, push onto the run queue instead of firing
                           immediately. Useful for paste-many-scripts workflows.
    """
    title = (req.get("title") or "").strip()
    body  = (req.get("body") or "").strip()
    if not title or not body:
        raise HTTPException(400, "title and body are required")

    content_style = (req.get("content_style") or "story").strip()
    if content_style not in ("story", "qa", "interactive", "hot_take"):
        content_style = "story"

    video_mode = (req.get("video_mode") or "short_reel").strip()
    tts_enabled = bool(req.get("tts_enabled", True))
    narrator_gender = (req.get("narrator_gender") or "auto").strip().lower() or "auto"
    voice_override = (req.get("voice_override") or "").strip() or None
    bg = req.get("background_selector")
    background_override = None if bg is None else str(bg).strip()
    enqueue_only = bool(req.get("enqueue", False))

    config = _load_config()

    # Wrap the user's text into the same content_data shape AI generation
    # produces, then write it to disk. The pipeline doesn't care where
    # the body came from once posts/<id>/ exists.
    content_data = {"title": title, "body": body}
    post_id, _, subreddit, format_mode = _write_ai_post_to_disk(
        content_data=content_data,
        content_style=content_style,
        niche="custom",
        content_filter="normal",
        target_audience=None,
        tone="dramatic",
        custom_title=title,
    )

    # Ensure the pipeline knows what mode + tts state to use.
    if video_mode:
        config.setdefault("video", {})["mode"] = video_mode
    config.setdefault("formatting", {})["default_mode"] = format_mode
    config.setdefault("tts", {})["enabled"] = tts_enabled
    _save_config(config)

    if enqueue_only or pipeline_state.get("is_running"):
        from run_queue import enqueue
        item = enqueue(PROJECT_ROOT, post_id=post_id, title=title, subreddit=subreddit,
                       params={
                           "kind": "post",
                           "narrator_gender": narrator_gender if narrator_gender != "auto" else None,
                           "voice_override": voice_override,
                           "background_override": background_override,
                       })
        _log(f"Custom-script queued: {title[:60]} → {post_id}")
        return {"started": False, "queued": True, "queue_item": item, "post_id": post_id}

    pipeline_state["current_post"] = {"id": post_id, "title": title, "subreddit": subreddit, "score": 0}
    _log(f"Custom-script pipeline starting: {title[:60]} → {post_id}")
    asyncio.create_task(_run_pipeline_async(
        specific_post_id=post_id,
        narrator_gender=narrator_gender if narrator_gender != "auto" else None,
        voice_override=voice_override,
        background_override=background_override,
    ))
    return {"started": True, "queued": False, "post_id": post_id}


@app.post("/api/pipeline/batch-run-ai")
async def batch_run_pipeline_ai(req: dict = {}):
    """
    Queue many AI-generated stories at once. The caller has already
    generated + reviewed each candidate in the dialog (via
    /api/ai/generate-variants); this endpoint just writes each to disk
    as a synthetic post and enqueues it on the existing run queue. The
    queue worker drains them serially through the same code path Reddit
    posts use.

    Body:
      {
        "items": [
          {
            "preselected_content": {<variant dict from generate-variants>},
            "content_style": "story", "niche": "...",
            "content_filter": "normal", "target_audience": "...", "tone": "dramatic",
            "video_mode": "short_reel", "tts_enabled": true,
            "narrator_gender": "auto"|"male"|"female",
            "voice_override": "<voice_id or null>",
            "background_selector": "<folder|file|empty for random>",
            "custom_title": "<override or null>"
          },
          ...
        ]
      }
    """
    items = req.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "items[] required")

    config = _load_config()
    gemini_cfg = config.get("gemini", {})
    if not gemini_cfg.get("enabled", False):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    from run_queue import enqueue
    queued = []
    failures: list[dict] = []
    for idx, item in enumerate(items):
        try:
            content_data = item.get("preselected_content") or {}
            if not isinstance(content_data, dict) or not content_data:
                failures.append({"index": idx, "error": "missing preselected_content"})
                continue
            content_style = (item.get("content_style") or "story").strip()
            niche = (item.get("niche") or "relationship_drama").strip()
            content_filter = (item.get("content_filter") or "normal").strip().lower()
            if content_filter not in ("safe", "normal", "edgy"):
                content_filter = "normal"
            target_audience = (item.get("target_audience") or "").strip() or None
            tone = (item.get("tone") or "dramatic").strip().lower()
            if tone not in ("dramatic", "funny", "heartfelt", "shocking", "cringe"):
                tone = "dramatic"
            custom_title = (item.get("custom_title") or "").strip() or None

            post_id, title, subreddit, _ = _write_ai_post_to_disk(
                content_data=content_data,
                content_style=content_style,
                niche=niche,
                content_filter=content_filter,
                target_audience=target_audience,
                tone=tone,
                custom_title=custom_title,
            )

            ng = (item.get("narrator_gender") or "auto").strip().lower()
            voice_override = (item.get("voice_override") or "").strip() or None
            bg = item.get("background_selector")
            background_override = None if bg is None else str(bg).strip()

            params = {
                "kind": "post",
                "narrator_gender": ng if ng != "auto" else None,
                "voice_override": voice_override,
                "background_override": background_override,
                # Per-run video/tts knobs travel with the queue item so a
                # later batch enqueue can't mutate config.json mid-run.
                "video_mode": item.get("video_mode"),
                "tts_enabled": item.get("tts_enabled"),
            }
            row = enqueue(PROJECT_ROOT, post_id=post_id, title=title,
                          subreddit=subreddit, params=params)
            queued.append(row)
        except Exception as e:
            _log(f"batch-run-ai item {idx} failed: {e}")
            failures.append({"index": idx, "error": str(e)})

    _log(f"batch-run-ai: queued {len(queued)} item(s) ({len(failures)} failed)")
    return {"queued": queued, "count": len(queued), "failures": failures}


async def reset_pipeline():
    if pipeline_state["is_running"]:
        raise HTTPException(409, "Cannot reset while running")
    for step in pipeline_state["steps"]:
        step["status"] = "idle"
        step["detail"] = ""
        step.pop("sub_steps", None)
    pipeline_state["current_post"] = None
    pipeline_state["error"] = None
    pipeline_state["started_at"] = None
    pipeline_state["completed_at"] = None
    _log("Pipeline reset")
    return {"success": True}


@app.post("/api/pipeline/cancel")
async def cancel_pipeline():
    global _cancel_requested
    if not pipeline_state["is_running"]:
        raise HTTPException(400, "Pipeline is not running")
    _cancel_requested = True
    _log("Pipeline cancellation requested")
    return {"success": True}


@app.post("/api/pipeline/resume-video")
async def resume_video_from_audio(req: dict = {}):
    """Resume video generation from an existing post that has audio but no video."""
    if pipeline_state["is_running"]:
        raise HTTPException(409, "Pipeline is already running")

    post_id = req.get("post_id", "").strip()
    if not post_id:
        raise HTTPException(400, "post_id is required")

    post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    audio_dir = os.path.join(post_dir, "audio")
    summary_path = os.path.join(post_dir, "summary.json")

    # Fall back to preserved project audio/timeline if auto_cleanup already
    # removed the post_dir.
    if not os.path.isdir(audio_dir):
        try:
            from projects_db import find as _reg_find
            proj = _reg_find(PROJECT_ROOT, post_id)
        except Exception:
            proj = None
        if proj and proj.get("audio_dir") and os.path.isdir(proj["audio_dir"]):
            audio_dir = proj["audio_dir"]
        else:
            raise HTTPException(
                404,
                "This video was rendered before audio preservation was added, so its TTS "
                "clips aren't on disk anymore. Run a fresh pipeline on the same post to "
                "produce a re-renderable copy.",
            )
    if not os.path.exists(summary_path):
        # Synthesize a minimal summary from the registry so the resume path works.
        try:
            from projects_db import find as _reg_find
            proj = _reg_find(PROJECT_ROOT, post_id)
        except Exception:
            proj = None
        if proj:
            summary = {
                "title": proj.get("title", post_id),
                "subreddit": proj.get("subreddit", ""),
                "score": proj.get("score", 0),
                "author": "Anonymous",
            }
            try:
                os.makedirs(post_dir, exist_ok=True)
                with open(summary_path, "w", encoding="utf-8") as _sf:
                    json.dump(summary, _sf, indent=2)
            except Exception:
                pass
        else:
            raise HTTPException(404, f"No summary.json found for post {post_id}")

    # Read summary
    with open(summary_path, "r", encoding="utf-8") as f:
        summary = json.load(f)

    title = summary.get("title", post_id)

    # Prefer the authoritative timeline.json saved when TTS ran — its text ↔ audio
    # mapping is guaranteed correct. Fall back to the old audio-file scan for older posts.
    timeline_path = os.path.join(post_dir, "timeline.json")
    if not os.path.exists(timeline_path):
        # Fall back to the project registry's preserved timeline (auto_cleanup case).
        try:
            from projects_db import find as _reg_find
            _proj = _reg_find(PROJECT_ROOT, post_id)
            if _proj and _proj.get("timeline_path") and os.path.isfile(_proj["timeline_path"]):
                timeline_path = _proj["timeline_path"]
        except Exception:
            pass
    timeline: list = []
    if os.path.exists(timeline_path):
        try:
            with open(timeline_path, "r", encoding="utf-8") as _f:
                timeline = json.load(_f)
            # Validate audio paths still exist
            timeline = [s for s in timeline if s.get("audio_path") and os.path.exists(s["audio_path"])]
        except Exception as e:
            _log(f"timeline.json unreadable, falling back to audio scan: {e}")
            timeline = []

    if not timeline:
        audio_files = sorted([f for f in os.listdir(audio_dir) if f.endswith(('.mp3', '.wav', '.m4a'))])
        if not audio_files:
            raise HTTPException(404, "No audio files found in audio directory")

        for af in audio_files:
            timeline.append({
                "text": "",
                "audio_path": os.path.join(audio_dir, af),
                "author": summary.get("author", "Anonymous"),
            })

        # Try to load formatted text to populate segment texts (best-effort)
        for mode_file in ["story_mode.txt", "qa_mode.txt"]:
            txt_path = os.path.join(post_dir, mode_file)
            if os.path.exists(txt_path):
                with open(txt_path, "r", encoding="utf-8") as f:
                    lines = [l.strip() for l in f.readlines() if l.strip()]
                for i, seg in enumerate(timeline):
                    if i < len(lines):
                        seg["text"] = lines[i]
                break

    # Reset pipeline state
    for step in pipeline_state["steps"]:
        step["status"] = "idle"
        step["detail"] = ""
        step.pop("sub_steps", None)

    # Mark completed steps
    _set_step("ai_generate", "done", "Resumed — skipped")
    _set_step("fetch", "done", f"Resumed: {title[:60]}")
    _set_step("format", "done", "Using existing formatted text")
    _set_step("tts", "done", f"Using {len(timeline)} existing audio segments")

    pipeline_state["is_running"] = True
    pipeline_state["error"] = None
    pipeline_state["current_post"] = {
        "id": post_id, "title": title,
        "subreddit": summary.get("subreddit", ""),
        "score": summary.get("score", 0),
    }
    pipeline_state["started_at"] = datetime.now(timezone.utc).isoformat()
    pipeline_state["completed_at"] = None
    _log(f"Resuming video from audio: {post_id} — {title[:60]} ({len(timeline)} segments)")

    asyncio.create_task(_resume_video_async(post_id, title, timeline))
    return {"started": True}


async def _resume_video_async(post_id: str, title: str, timeline: list):
    """Resume pipeline from video step using existing audio timeline."""
    global videos_db
    start_time = time.time()
    config = _load_config()
    generated_video_paths = []

    try:
        video_config = config.get("video", {})
        video_mode = video_config.get("mode", "reel")
        use_gpu = video_config.get("use_gpu", False)
        hw_accel = video_config.get("hw_accel", "nvenc" if use_gpu else "none")
        engine = video_config.get("engine", "moviepy")
        threads = video_config.get("threads", 0)
        branding = video_config.get("branding", "")

        # ── Video Step ──────────────────────────────────────────────
        _set_step("video", "running", "Rendering video from existing audio...")
        _log("Rendering video (resumed)...")

        from video_generator import VideoGenerator
        video_gen = VideoGenerator(mode=video_mode, use_gpu=use_gpu, threads=threads, hw_accel=hw_accel, captions_config=config.get("captions", {}), thumbnail_config=config.get("thumbnail", {}))
        # Resume path has no per-run override — follow whatever the config
        # currently says for the default background selector.
        video_gen.set_background_selector((config.get("video", {}) or {}).get("background_selector", ""))
        _bgm_path, _bgm_db = _resolve_background_music(post_id, config)
        video_gen.background_music_path = _bgm_path
        video_gen.background_music_db = _bgm_db
        output_base = os.path.join(PROJECT_ROOT, "posts", post_id)

        # Load post metadata for title card rendering during resume.
        _summary_path = os.path.join(PROJECT_ROOT, "posts", post_id, "summary.json")
        _resume_meta = {"title": title, "subreddit": "", "score": 0}
        try:
            with open(_summary_path, "r", encoding="utf-8") as _sf:
                _s = json.load(_sf)
                _resume_meta["subreddit"] = _s.get("subreddit", "")
                _resume_meta["score"] = int(_s.get("score", 0) or 0)
        except Exception:
            pass

        if video_mode == "short_reel":
            from moviepy.editor import AudioFileClip
            split_duration = video_config.get("split_duration", 30.0)
            outro_text_template = video_config.get("outro_text", "Follow for Part {next_part}")
            max_total = float(split_duration)
            tail_dur = 2.0

            parts, current, accum = [], [], 0.0
            for seg in timeline:
                try:
                    ac = AudioFileClip(seg["audio_path"])
                    dur = ac.duration
                    ac.close()
                except Exception:
                    dur = 0.0
                if accum + dur + tail_dur <= max_total:
                    current.append(seg)
                    accum += dur
                else:
                    if current:
                        parts.append(current)
                    current = [seg]
                    accum = dur
            if current:
                parts.append(current)

            video_sub_steps = [
                {"label": f"Part {idx}", "status": "pending", "detail": f"{len(ps)} segments"}
                for idx, ps in enumerate(parts, 1)
            ]
            _set_step("video", "running", f"Rendering {len(parts)} parts · engine: {engine}", video_sub_steps)

            for idx, part_segs in enumerate(parts, start=1):
                video_sub_steps[idx - 1]["status"] = "running"
                _set_step("video", "running", f"Rendering part {idx}/{len(parts)}...", video_sub_steps)
                _check_cancelled()
                part_out = os.path.join(output_base, f"video_part{idx}.mp4")
                tail_text = outro_text_template.replace("{next_part}", str(idx + 1)) if idx < len(parts) else None

                if engine == "ffmpeg":
                    vp = await asyncio.to_thread(video_gen.generate_video_ffmpeg, part_segs, part_out, tail_text, tail_dur, branding, _resume_meta["title"], _resume_meta["subreddit"], _resume_meta["score"])
                else:
                    vp = await asyncio.to_thread(video_gen.generate_video, part_segs, part_out, tail_text, tail_dur, branding, _resume_meta["title"], _resume_meta["subreddit"], _resume_meta["score"])

                if vp:
                    generated_video_paths.append(vp)
                    video_sub_steps[idx - 1]["status"] = "done"
                else:
                    video_sub_steps[idx - 1]["status"] = "error"
                _set_step("video", "running", f"Rendering part {idx}/{len(parts)}...", video_sub_steps)
        else:
            output_video = os.path.join(output_base, "video.mp4")
            video_sub_steps = [{"label": "Full video", "status": "running", "detail": f"{engine} engine"}]
            _set_step("video", "running", f"Rendering single video · engine: {engine}", video_sub_steps)
            if engine == "ffmpeg":
                vp = await asyncio.to_thread(video_gen.generate_video_ffmpeg, timeline, output_video, None, 0.0, branding, _resume_meta["title"], _resume_meta["subreddit"], _resume_meta["score"])
            else:
                vp = await asyncio.to_thread(video_gen.generate_video, timeline, output_video, None, 0.0, branding, _resume_meta["title"], _resume_meta["subreddit"], _resume_meta["score"])
            if vp:
                generated_video_paths.append(vp)
                video_sub_steps[0]["status"] = "done"
            else:
                video_sub_steps[0]["status"] = "error"

        if generated_video_paths:
            # Move to videos/
            videos_dir = os.path.join(PROJECT_ROOT, "videos")
            os.makedirs(videos_dir, exist_ok=True)
            safe_title = re.sub(r"[^\w\-_]", "_", title)
            safe_title = re.sub(r"_+", "_", safe_title)[:50].strip("_")
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            base_name = f"{safe_title}_{video_mode}_{ts}"

            if len(generated_video_paths) > 1:
                series_dir = os.path.join(videos_dir, base_name)
                os.makedirs(series_dir, exist_ok=True)
                final_paths = []
                for idx, src in enumerate(generated_video_paths, 1):
                    dest = os.path.join(series_dir, f"{base_name}_part{idx}.mp4")
                    try:
                        shutil.move(src, dest)
                        final_paths.append(dest)
                    except Exception:
                        final_paths.append(src)
                generated_video_paths = final_paths
            else:
                final_dest = os.path.join(videos_dir, f"{base_name}.mp4")
                try:
                    shutil.move(generated_video_paths[0], final_dest)
                    generated_video_paths = [final_dest]
                except Exception:
                    pass

            _set_step("video", "done", f"Rendered {len(generated_video_paths)} video(s)")

            # Thumbnails
            _set_step("thumbnail", "running", "Generating thumbnails...")
            p_title = title
            p_sub = pipeline_state.get("current_post", {}).get("subreddit", "")
            p_score = pipeline_state.get("current_post", {}).get("score", 0)
            num_thumbs = len(generated_video_paths)

            try:
                if num_thumbs > 1:
                    series_dir = os.path.dirname(generated_video_paths[0])
                    for idx in range(1, num_thumbs + 1):
                        thumb_path = os.path.join(series_dir, f"thumbnail_part{idx}.png")
                        await asyncio.to_thread(video_gen.generate_thumbnail, p_title, p_sub, idx, num_thumbs, thumb_path, p_score, branding)
                elif video_mode in ("reel", "short_reel"):
                    vdir = os.path.dirname(generated_video_paths[0])
                    vbase = os.path.splitext(os.path.basename(generated_video_paths[0]))[0]
                    thumb_path = os.path.join(vdir, f"{vbase}_thumbnail.png")
                    await asyncio.to_thread(video_gen.generate_thumbnail, p_title, p_sub, 1, 1, thumb_path, p_score, branding)
                _set_step("thumbnail", "done", f"Generated {num_thumbs} thumbnail(s)")
            except Exception as e:
                _set_step("thumbnail", "error", f"Thumbnail failed: {str(e)[:80]}")
        else:
            _set_step("video", "error", "No video output")
            _set_step("thumbnail", "done", "Skipped — no video")

        # Notify
        _set_step("notify", "done", "Resume complete — notify skipped")

        # Record
        elapsed = time.time() - start_time
        stats["videos_today"] += 1
        stats["total_runs"] += 1
        stats["successful_runs"] += 1
        stats["total_render_time_s"] += elapsed

        total_size = sum(os.path.getsize(p) for p in generated_video_paths if os.path.exists(p))
        # Replace any existing entry for this id (resume updates the row).
        videos_db = [v for v in videos_db if v["id"] != post_id]
        videos_db.insert(0, {
            "id": post_id,
            "title": title, "subreddit": pipeline_state["current_post"].get("subreddit", ""),
            "score": pipeline_state["current_post"].get("score", 0),
            "num_comments": 0, "status": "published" if generated_video_paths else "failed",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "has_video": bool(generated_video_paths), "has_audio": True,
            "render_time_s": round(elapsed, 1),
            "parts": len(generated_video_paths) if len(generated_video_paths) > 1 else None,
            "file_size_bytes": total_size or None,
            "video_paths": list(generated_video_paths),
        })
        _persist_videos_db()
        try:
            from render_history import record as _rh_record
            _rh_record(PROJECT_ROOT, success=bool(generated_video_paths), render_time_s=elapsed, resume=True)
        except Exception:
            pass
        _log(f"Resume pipeline completed in {elapsed:.1f}s")

    except Exception as e:
        pipeline_state["error"] = str(e)
        try:
            from render_history import record as _rh_record
            _rh_record(PROJECT_ROOT, success=False, resume=True)
        except Exception:
            pass
        for step in pipeline_state["steps"]:
            if step["status"] == "running":
                step["status"] = "error"
                step["detail"] = str(e)[:100]
        stats["total_runs"] += 1
        _log(f"Resume pipeline error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        pipeline_state["is_running"] = False
        pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()


def _check_cancelled():
    """Check if cancellation was requested and raise if so."""
    global _cancel_requested
    if _cancel_requested:
        _cancel_requested = False
        raise Exception("Pipeline cancelled by user")


async def _run_pipeline_async(specific_post_id: Optional[str] = None, selected_comments: Optional[List[int]] = None, max_comment_chars: int = 0, narrator_gender: Optional[str] = None, voice_override: Optional[str] = None, background_override: Optional[str] = None, captions_preset: Optional[str] = None):
    """Execute the full pipeline matching main.py run_pipeline() flow."""
    global _cancel_requested, videos_db
    _cancel_requested = False
    start_time = time.time()
    config = _load_config()
    mode = config.get("formatting", {}).get("default_mode", "qa")

    try:
        maker = RedditStoryMaker()

        # ── Step 1: Fetch ────────────────────────────────────────────
        _set_step("fetch", "running", "Scanning subreddits...")
        _log("Step 1: Fetching posts...")
        await asyncio.sleep(0.3)

        if specific_post_id:
            # Check if post already exists on disk
            post_dir = os.path.join(PROJECT_ROOT, "posts", specific_post_id)
            if os.path.exists(post_dir) and os.path.exists(os.path.join(post_dir, "summary.json")):
                _log(f"Using existing post: {specific_post_id}")
                try:
                    with open(os.path.join(post_dir, "summary.json"), "r", encoding="utf-8") as f:
                        summary = json.load(f)
                    pipeline_state["current_post"] = {
                        "id": specific_post_id,
                        "title": summary.get("title", ""),
                        "subreddit": summary.get("subreddit", ""),
                        "score": summary.get("score", 0),
                    }
                    post_id = specific_post_id
                    _set_step("fetch", "done", f"Using existing: {summary.get('title', '')[:60]}")
                except Exception:
                    _set_step("fetch", "error", "Could not load existing post data")
                    pipeline_state["is_running"] = False
                    return
            else:
                # Post not on disk — fetch it from Reddit
                _log(f"Post {specific_post_id} not on disk, fetching from Reddit...")
                _set_step("fetch", "running", f"Fetching post {specific_post_id} from Reddit...")
                try:
                    post_url = f"https://www.reddit.com/comments/{specific_post_id}"
                    full_data = await asyncio.to_thread(maker.fetch_post_details, post_url)

                    if not full_data:
                        _set_step("fetch", "error", f"Could not fetch post {specific_post_id} from Reddit")
                        pipeline_state["error"] = f"Post {specific_post_id} not found"
                        pipeline_state["is_running"] = False
                        return

                    # Extract post data from Reddit's response format
                    post_data = full_data[0]["data"]["children"][0]["data"] if isinstance(full_data, list) else full_data
                    post_obj = {
                        "id": specific_post_id,
                        "title": post_data.get("title", ""),
                        "author": post_data.get("author", "Anonymous"),
                        "subreddit": post_data.get("subreddit", ""),
                        "score": post_data.get("score", 0),
                        "upvote_ratio": post_data.get("upvote_ratio", 0),
                        "url": post_data.get("url", ""),
                        "permalink": post_data.get("permalink", ""),
                        "selftext": post_data.get("selftext", ""),
                        "num_comments": post_data.get("num_comments", 0),
                        "over_18": post_data.get("over_18", False),
                        "is_video": post_data.get("is_video", False),
                        "created_utc": post_data.get("created_utc", 0),
                    }
                    await asyncio.to_thread(maker.save_post_data, specific_post_id, post_obj, full_data)
                    pipeline_state["current_post"] = {
                        "id": specific_post_id,
                        "title": post_obj["title"],
                        "subreddit": post_obj["subreddit"],
                        "score": post_obj["score"],
                    }
                    post_id = specific_post_id
                    _set_step("fetch", "done", f"Fetched: {post_obj['title'][:60]}")
                    _log(f"Fetched post from Reddit: {post_obj['title'][:80]}")

                    # Mark as used
                    maker.used_posts.append(specific_post_id)
                    maker._save_used_posts()
                except Exception as e:
                    _set_step("fetch", "error", f"Fetch failed: {str(e)[:80]}")
                    _log(f"Failed to fetch post {specific_post_id}: {e}")
                    pipeline_state["error"] = str(e)
                    pipeline_state["is_running"] = False
                    return
        else:
            # Full fetch flow: find_suitable_post → fetch_post_details → save_post_data
            post = await asyncio.to_thread(maker.find_suitable_post)
            if not post:
                _set_step("fetch", "error", "No suitable posts found")
                pipeline_state["is_running"] = False
                pipeline_state["error"] = "No suitable posts found"
                _log("No suitable post found")
                return

            post_id = post.get("id")
            post_url = post.get("url")
            pipeline_state["current_post"] = {
                "id": post_id,
                "title": post.get("title"),
                "subreddit": post.get("subreddit"),
                "score": post.get("score"),
            }
            _set_step("fetch", "done", f"Found: {post.get('title', '')[:60]}...")
            _log(f"Selected post: {post.get('title', '')[:80]}")

            # Fetch full details and save
            _log("Fetching post details and comments...")
            full_data = await asyncio.to_thread(maker.fetch_post_details, post_url)
            if full_data:
                await asyncio.to_thread(maker.save_post_data, post_id, post, full_data)
            else:
                _log("Warning: Could not fetch full post details")

            # Mark as used
            maker.used_posts.append(post_id)
            maker._save_used_posts()

        _check_cancelled()

        # ── Step 2: Format ───────────────────────────────────────────
        _set_step("format", "running", "Formatting story for narration...")
        _log("Step 2: Formatting story...")
        try:
            formatter = await asyncio.to_thread(StoryFormatter, post_id)
            # Save both formatted text files
            await asyncio.to_thread(formatter.save_formatted_story, "story")
            await asyncio.to_thread(formatter.save_formatted_story, "qa")
            title = formatter.summary.get("title", "")
            selftext = formatter.summary.get("selftext", "")
            author = formatter.summary.get("author", "Anonymous")
            post_subreddit = formatter.summary.get("subreddit", "")
            post_score = int(formatter.summary.get("score", 0) or 0)
            _set_step("format", "done", "Story & Q&A text formatted")
            _log("Story formatted (story_mode.txt + qa_mode.txt)")
        except Exception as e:
            _set_step("format", "error", f"Format failed: {str(e)[:80]}")
            _log(f"Format error: {e}")
            pipeline_state["error"] = str(e)
            pipeline_state["is_running"] = False
            pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()
            return

        _check_cancelled()

        # ── Step 2.5: Gemini Hooks (between format and TTS) ──────────
        gemini_hook_text = None
        gemini_thumbnail_text = None
        gemini_cfg = config.get("gemini", {})
        if gemini_cfg.get("enabled", False) and gemini_cfg.get("api_key", ""):
            _log("Step 2.5: Generating Gemini hooks...")
            try:
                from gemini_hooks import generate_hooks
                # Build comments context for hook generation
                comments_ctx = ""
                if mode == "qa":
                    max_c = config.get("formatting", {}).get("max_comments", 10)
                    min_s = config.get("formatting", {}).get("min_comment_score", 10)
                    top_comments = formatter._extract_top_comments(max_c, min_s)
                    comments_ctx = "\n".join(c.get("body", "")[:200] for c in top_comments[:5])

                gemini_hook_text, gemini_thumbnail_text = await asyncio.to_thread(
                    generate_hooks, config, title, selftext, comments_ctx
                )
                if gemini_hook_text:
                    _log(f"Gemini hook: \"{gemini_hook_text[:80]}\"")
                if gemini_thumbnail_text:
                    _log(f"Gemini thumbnail: \"{gemini_thumbnail_text[:60]}\"")
            except Exception as e:
                _log(f"Gemini hooks failed (non-fatal): {e}")

        _check_cancelled()

        # ── Step 3: TTS ──────────────────────────────────────────────
        _set_step("tts", "running", "Generating speech audio...")
        _log("Step 3: Generating TTS audio...")
        timeline = []
        try:
            tts_manager = TTSManager()
            if not tts_manager.enabled:
                _set_step("tts", "done", "TTS disabled in config — skipped")
                _log("TTS is disabled in config, skipping")
            else:
                tts_config = config.get("tts", {})
                main_voice = tts_config.get("main_voice", "Matthew")
                # Resolve voice by narrator gender / override if supplied on run.
                provider_for_resolve = tts_config.get("provider", "streamlabs_polly")
                resolved_gender = narrator_gender
                if narrator_gender == "auto" or not narrator_gender:
                    try:
                        from narrator_gender import detect_narrator_gender as _detect
                        resolved_gender = _detect(title, selftext)
                    except Exception:
                        resolved_gender = None
                _resolved = _resolve_voice(provider_for_resolve, config, resolved_gender, voice_override)
                if _resolved and _resolved != main_voice:
                    _log(f"Voice resolved: gender={resolved_gender or 'unknown'} → {_resolved} (was {main_voice})")
                    main_voice = _resolved
                multi_voice = tts_config.get("use_multiple_voices", True)
                comment_voices = tts_config.get("comment_voices", [])
                provider = tts_config.get("provider", "streamlabs_polly")
                model_size = tts_config.get("model_size", "")

                # Get comments for Q&A mode only
                if mode == "story":
                    comments = []
                else:
                    max_comments_cfg = config.get("formatting", {}).get("max_comments", 10)
                    min_score = config.get("formatting", {}).get("min_comment_score", 10)
                    all_comments = formatter._extract_top_comments(max_comments_cfg, min_score)
                    # Apply char limit filter
                    if max_comment_chars and max_comment_chars > 0:
                        all_comments = [c for c in all_comments if len(c.get("body", "")) <= max_comment_chars]
                    # Apply selection filter
                    if selected_comments is not None:
                        comments = [all_comments[i] for i in selected_comments if 0 <= i < len(all_comments)]
                    else:
                        comments = all_comments

                post_body = selftext if mode == "story" or selftext else ""

                # Deterministic pre-TTS substitutions. Runs BEFORE Ollama
                # normalization so our expansions (age+sex, TL;DR, AITA/NTA,
                # in-law acronyms) survive any rewrite.
                pref_cfg = tts_config.get("prefilter", {}) or {}
                pref_on = bool(pref_cfg.get("enabled", True))
                if pref_on:
                    try:
                        from tts_prefilter import apply_rules as _prefilter, clean_redundant as _clean_redundant
                        opts = dict(
                            expand_age_gender=bool(pref_cfg.get("expand_age_gender", True)),
                            expand_tldr=bool(pref_cfg.get("expand_tldr", True)),
                            expand_acronyms=bool(pref_cfg.get("expand_acronyms", True)),
                        )
                        title = _prefilter(title, **opts)
                        post_body = _prefilter(post_body, **opts)
                        comments = [{**c, "body": _prefilter(c.get("body", ""), **opts)} for c in comments]

                        # Redundant-opener + consecutive-dupe stripping. Runs
                        # after substitutions so the fuzzy-title match catches
                        # "AITAH" after it's been expanded to "am I the asshole
                        # here". Off by default for comments — they rarely echo
                        # the title and removing a trailing one-word ack would
                        # be rude. Only applies to the main post body.
                        if bool(pref_cfg.get("strip_title_echo", True)):
                            orig_lines = post_body.count("\n")
                            post_body = _clean_redundant(
                                post_body, title,
                                strip_title_echo=True,
                                strip_adjacent_dupes=bool(pref_cfg.get("strip_adjacent_dupes", True)),
                            )
                            dropped = orig_lines - post_body.count("\n")
                            if dropped > 0:
                                _log(f"Pre-TTS cleanup: stripped {dropped} redundant line(s) from body")
                        _log("Pre-TTS prefilter applied (age/sex, TL;DR, acronyms, redundancy)")
                    except Exception as _e:
                        _log(f"Pre-TTS prefilter skipped: {_e}")

                # Pre-TTS normalization (Reddit-speak cleanup via local Ollama).
                # Skips gracefully if Ollama isn't reachable.
                pre_norm = bool(tts_config.get("pre_normalize", True))
                if pre_norm:
                    try:
                        from tts_normalize import normalize_text
                        gem_cfg = config.get("gemini", {}) or {}
                        norm_url = gem_cfg.get("ollama_url") or config.get("ollama_url") or "http://localhost:11434"
                        norm_model = tts_config.get("normalize_model") or gem_cfg.get("model") or "qwen2.5:14b"
                        cache_path = os.path.join(PROJECT_ROOT, "posts", post_id, "normalized_cache.json")
                        _log(f"Pre-TTS normalization: model={norm_model} (skips if Ollama is down)")
                        _t0 = time.time()
                        new_title = await asyncio.to_thread(
                            normalize_text, title,
                            ollama_url=norm_url, model=norm_model, cache_path=cache_path
                        )
                        new_body = await asyncio.to_thread(
                            normalize_text, post_body,
                            ollama_url=norm_url, model=norm_model, cache_path=cache_path
                        )
                        new_comments = []
                        for c in comments:
                            cb = c.get("body", "")
                            nb = await asyncio.to_thread(
                                normalize_text, cb,
                                ollama_url=norm_url, model=norm_model, cache_path=cache_path
                            )
                            new_comments.append({**c, "body": nb})
                        changed = int(new_title != title) + int(new_body != post_body) + sum(
                            1 for a, b in zip(comments, new_comments) if a.get("body") != b.get("body")
                        )
                        title, post_body, comments = new_title, new_body, new_comments
                        _log(f"Normalized {changed} text segment(s) in {time.time() - _t0:.1f}s")
                    except Exception as _e:
                        _log(f"Pre-TTS normalization skipped: {_e}")

                # Second pass of deterministic cleanup. Ollama tends to put
                # smart quotes / em-dashes back in; the prefilter ASCII-fies
                # them so TTS doesn't mispronounce and whisper doesn't choke.
                if pref_on:
                    try:
                        from tts_prefilter import apply_rules as _prefilter, clean_redundant as _clean_redundant
                        title = _prefilter(title, **opts)
                        post_body = _prefilter(post_body, **opts)
                        comments = [{**c, "body": _prefilter(c.get("body", ""), **opts)} for c in comments]
                        # Safety: re-run redundancy stripper in case Ollama
                        # re-inserted a paraphrase of the title in its output.
                        if bool(pref_cfg.get("strip_title_echo", True)):
                            post_body = _clean_redundant(
                                post_body, title,
                                strip_title_echo=True,
                                strip_adjacent_dupes=bool(pref_cfg.get("strip_adjacent_dupes", True)),
                            )
                    except Exception:
                        pass

                # Initial sub-steps (will be replaced with real-time progress)
                _set_step("tts", "running", f"Calculating segments · provider: {provider}", [
                    {"label": "Analyzing text...", "status": "running", "detail": ""}
                ])
                _log(f"Generating full narrative: {len(comments)} comments, mode={mode}, provider={provider}")

                # For local TTS providers, use different engine classes
                if provider == "vibevoice":
                    audio_dir = os.path.join(PROJECT_ROOT, "posts", post_id, "audio")
                    vv_model = model_size if model_size and model_size.startswith("vibevoice") else "vibevoice-0.5b"
                    tts_instance = VibeVoiceTTS(voice=main_voice, model_size=vv_model, output_dir=audio_dir, cancel_check=_check_cancelled)
                    _log(f"Using VibeVoice local TTS engine (model={vv_model})")
                elif provider == "qwen3_tts":
                    audio_dir = os.path.join(PROJECT_ROOT, "posts", post_id, "audio")
                    q_model = model_size if model_size and model_size.startswith("qwen3") else "qwen3-tts-1.7b"
                    tts_instance = Qwen3TTS(voice=main_voice, model_size=q_model, output_dir=audio_dir, cancel_check=_check_cancelled)
                    _log(f"Using Qwen3-TTS local engine (model={q_model})")
                elif provider == "lazypy_tiktok":
                    audio_dir = os.path.join(PROJECT_ROOT, "posts", post_id, "audio")
                    tts_instance = LazyPyTikTokTTS(voice=main_voice, output_dir=audio_dir, cancel_check=_check_cancelled)
                    _log(f"Using TikTok TTS via LazyPy (voice={main_voice})")
                elif provider == "elevenlabs":
                    from tts_engine import ElevenLabsTTS
                    audio_dir = os.path.join(PROJECT_ROOT, "posts", post_id, "audio")
                    el_cfg = tts_config.get("elevenlabs", {}) if isinstance(tts_config.get("elevenlabs"), dict) else {}
                    # Default native_timestamps = on. Users can flip off
                    # tts.elevenlabs.use_native_timestamps if they hit API
                    # quirks (e.g. a deprecated-endpoint scenario on an
                    # older plan) and want to fall back to whisper alignment.
                    use_native_ts = True
                    if "use_native_timestamps" in el_cfg:
                        use_native_ts = bool(el_cfg.get("use_native_timestamps"))
                    elif "use_native_timestamps" in tts_config:
                        use_native_ts = bool(tts_config.get("use_native_timestamps"))
                    tts_instance = ElevenLabsTTS(
                        voice=main_voice,
                        output_dir=audio_dir,
                        api_key=tts_config.get("elevenlabs_api_key") or el_cfg.get("api_key", ""),
                        model_id=tts_config.get("elevenlabs_model_id") or el_cfg.get("model_id", "eleven_multilingual_v2"),
                        stability=float(el_cfg.get("stability", 0.5)),
                        similarity_boost=float(el_cfg.get("similarity_boost", 0.75)),
                        style=float(el_cfg.get("style", 0.0)),
                        use_speaker_boost=bool(el_cfg.get("use_speaker_boost", True)),
                        cancel_check=_check_cancelled,
                        use_native_timestamps=use_native_ts,
                    )
                    _log(
                        f"Using ElevenLabs (voice={main_voice}, model={tts_instance.model_id}, "
                        f"native_timings={'on' if use_native_ts else 'off'})"
                    )

                # Real-time progress tracking
                tts_sub_steps_live = []
                last_phase = [None]
                _tts_heartbeat_last = [time.time()]

                def _tts_progress(phase, current, total, detail):
                    """Called from TTS thread after each segment."""
                    if phase != last_phase[0]:
                        if tts_sub_steps_live:
                            tts_sub_steps_live[-1]["status"] = "done"
                        voice_label = main_voice
                        if phase.startswith("Comment"):
                            ci = int(phase.split(" ")[1]) - 1
                            if multi_voice and comment_voices:
                                author = comments[ci].get("author", "Anon") if ci < len(comments) else "Anon"
                                voice_label = comment_voices[hash(author) % len(comment_voices)]
                        tts_sub_steps_live.append({
                            "label": f"{phase} — voice: {voice_label}",
                            "status": "running",
                            "detail": f"seg {current}/{total}"
                        })
                        last_phase[0] = phase
                        # Log every phase transition so the UI log + terminal
                        # show where TTS is at, not just the live step detail.
                        _log(f"TTS: {phase} · seg {current}/{total}")
                    else:
                        if tts_sub_steps_live:
                            tts_sub_steps_live[-1]["detail"] = f"seg {current}/{total} — {detail}"
                        # Heartbeat log every ~8s so a long-running phase
                        # proves liveness in the run-log panel.
                        if time.time() - _tts_heartbeat_last[0] > 8.0:
                            _log(f"TTS: {phase} · seg {current}/{total} — still working")
                            _tts_heartbeat_last[0] = time.time()
                    _set_step("tts", "running", f"Segment {current}/{total} · {phase}", list(tts_sub_steps_live))

                # Use the appropriate TTS engine
                if provider in ("vibevoice", "qwen3_tts", "lazypy_tiktok", "elevenlabs"):
                    # Local TTS or LazyPy TikTok: generate segments directly
                    timeline = await asyncio.to_thread(
                        _generate_local_tts_narrative,
                        tts_instance, post_id, title, post_body, author, comments,
                        _tts_progress, _check_cancelled
                    )
                else:
                    # Streamlabs or other TTSManager-based providers
                    timeline = await asyncio.to_thread(
                        tts_manager.generate_full_narrative,
                        post_id, title, post_body, author, comments,
                        progress_callback=_tts_progress,
                        cancel_check=_check_cancelled
                    )

                # Prepend Gemini hook to the start of the timeline
                if gemini_hook_text and timeline:
                    _log("Prepending Gemini hook to audio timeline...")
                    hook_audio_dir = os.path.join(PROJECT_ROOT, "posts", post_id, "audio")
                    os.makedirs(hook_audio_dir, exist_ok=True)

                    # Generate TTS for the hook using the same provider
                    hook_seg = None
                    if provider in ("vibevoice", "qwen3_tts", "lazypy_tiktok", "elevenlabs"):
                        hook_seg_list = await asyncio.to_thread(
                            tts_instance.generate_segments, gemini_hook_text, None, _check_cancelled
                        )
                        if hook_seg_list:
                            for s in hook_seg_list:
                                s["author"] = author
                                s["segment_role"] = "title"
                            hook_seg = hook_seg_list
                    else:
                        from tts_engine import StreamlabsTTS
                        hook_tts = StreamlabsTTS(voice=main_voice, output_dir=hook_audio_dir, cancel_check=_check_cancelled)
                        hook_seg_list = await asyncio.to_thread(
                            hook_tts.generate_segments, gemini_hook_text, None, _check_cancelled
                        )
                        if hook_seg_list:
                            for s in hook_seg_list:
                                s["author"] = author
                                s["segment_role"] = "title"
                            hook_seg = hook_seg_list

                    if hook_seg:
                        timeline = hook_seg + timeline
                        _log(f"Hook prepended ({len(hook_seg)} segments)")

                if timeline:
                    for ss in tts_sub_steps_live:
                        ss["status"] = "done"
                    _set_step("tts", "done", f"Generated {len(timeline)} audio segments", tts_sub_steps_live)
                    _log(f"TTS complete: {len(timeline)} segments")

                    speed = float(tts_config.get("speed", 1.0) or 1.0)
                    caption_cfg = config.get("captions", {}) or {}

                    # === Order matters: whisper align FIRST on clean original
                    # audio, THEN speed-stretch, THEN scale timestamps. atempo
                    # distorts formants enough that whisper (even large-v3)
                    # misses words on stretched audio, so we do ASR before any
                    # time-stretch and scale the timings mathematically.

                    # 1a) Count how many segments already have NATIVE per-word
                    # timings from the TTS engine (ElevenLabs /with-timestamps).
                    # Those are sample-accurate and skip whisper entirely.
                    native_hits = sum(
                        1 for _s in timeline
                        if _s.get("native_timings") and _s.get("words")
                    )
                    if native_hits:
                        _log(
                            f"TTS native timings: using {native_hits}/{len(timeline)} "
                            "segments directly from ElevenLabs /with-timestamps (no whisper needed)"
                        )

                    # 1b) Whisper alignment — on the ORIGINAL pre-stretch audio.
                    # Only runs when at least one segment is MISSING native
                    # timings (e.g. mixed-provider runs or a fallback from a
                    # /with-timestamps failure). Saves 15-30s per render on a
                    # 3080 when every segment came back with native timings.
                    needs_whisper = [
                        _s for _s in timeline
                        if not _s.get("is_pause") and not _s.get("words")
                    ]
                    if caption_cfg.get("force_align", False) and needs_whisper:
                        try:
                            from whisper_align import is_available as _wh_ok, align_audio, install_hint
                            if not _wh_ok():
                                _log(f"Whisper alignment requested but not installed. Skipping. ({install_hint()})")
                            else:
                                model_size = caption_cfg.get("align_model_size", "base")
                                _set_step("tts", "running",
                                          f"Aligning {len(needs_whisper)} segment(s) without native timings (whisper {model_size})...")
                                _log(f"Whisper alignment starting on {len(needs_whisper)}/{len(timeline)} segments "
                                     f"(model={model_size}, pre-atempo)...")
                                _t0 = time.time()
                                aligned = 0
                                for _seg in needs_whisper:
                                    if _check_cancelled():
                                        pass
                                    words = await asyncio.to_thread(
                                        align_audio, _seg.get("audio_path", ""),
                                        text_hint=_seg.get("text", ""),
                                        model_size=model_size,
                                    )
                                    if words:
                                        _seg["words"] = words
                                        aligned += 1
                                _log(f"Whisper alignment done: {aligned}/{len(needs_whisper)} segments in {time.time() - _t0:.1f}s")
                        except Exception as _e:
                            _log(f"Whisper alignment error (continuing without): {_e}")

                    # 2) Apply atempo speed stretch to audio files (in place).
                    if abs(speed - 1.0) >= 0.01:
                        try:
                            from tts_speed import adjust_speed
                            paths = [s.get("audio_path", "") for s in timeline if s.get("audio_path")]
                            _log(f"Applying TTS playback speed ×{speed:.2f} to {len(paths)} clip(s)...")
                            changed = await asyncio.to_thread(adjust_speed, paths, speed)
                            _log(f"Speed adjusted: {changed} clip(s) stretched")

                            # 3) Scale whisper word timestamps by 1/speed so
                            # they line up with the NEW (stretched) audio
                            # durations. atempo changes playback time:
                            #   new_time = old_time / speed
                            # So a word whisper said was at t=5.0s on original
                            # audio is now at t=4.0s on the 1.25×-stretched audio.
                            inv = 1.0 / speed
                            scaled = 0
                            for _seg in timeline:
                                for _w in (_seg.get("words") or []):
                                    if "start" in _w:
                                        _w["start"] = float(_w["start"]) * inv
                                    if "end" in _w:
                                        _w["end"] = float(_w["end"]) * inv
                                if _seg.get("words"):
                                    scaled += 1
                            _log(f"Scaled {scaled} segment's word timestamps by 1/{speed:.2f} to match stretched audio")

                            # Invalidate the whisper caches that now hold
                            # UN-scaled timestamps for a now-stretched file.
                            for p in paths:
                                for suffix in (".whisper.json", ".whisper_v2.json", ".whisper_v3.json", ".whisper_v4.json", ".whisper_v5.json", ".whisper_v6.json", ".whisper_v7.json", ".whisper_v8.json"):
                                    cache = p + suffix
                                    if os.path.exists(cache):
                                        try: os.remove(cache)
                                        except Exception: pass
                        except Exception as e:
                            _log(f"TTS speed adjust failed: {e}")

                    # Persist the authoritative timeline so Re-render can reuse exact caption text.
                    try:
                        tl_path = os.path.join(PROJECT_ROOT, "posts", post_id, "timeline.json")
                        with open(tl_path, "w", encoding="utf-8") as _tf:
                            json.dump(timeline, _tf, indent=2, ensure_ascii=False)
                    except Exception as _e:
                        _log(f"Could not save timeline.json: {_e}")
                else:
                    for ss in tts_sub_steps_live:
                        ss["status"] = "error"
                    _set_step("tts", "error", "No audio segments generated", tts_sub_steps_live)
                    _log("TTS produced no segments")
        except Exception as e:
            if "cancelled" in str(e).lower():
                _set_step("tts", "error", "Cancelled by user")
                _log("TTS cancelled by user")
                raise  # Re-raise to stop pipeline
            _set_step("tts", "error", f"TTS failed: {str(e)[:80]}")
            _log(f"TTS error: {e}")

        _check_cancelled()

        # Release whisper/CUDA memory before FFmpeg spawns child processes.
        # On Windows, Python holding ~5 GB committed causes CreateProcess to
        # fail with WinError 1455 "paging file too small" — the OS pre-commits
        # swap equal to the parent's committed pages for the child.
        try:
            from whisper_align import unload_models as _wh_unload
            _wh_unload()
        except Exception:
            pass

        # ── Step 4: Video ────────────────────────────────────────────
        _set_step("video", "running", "Rendering video...")
        _log("Step 4: Rendering video...")
        video_config = config.get("video", {})
        video_mode = video_config.get("mode", "reel")
        use_gpu = video_config.get("use_gpu", False)
        hw_accel = video_config.get("hw_accel", "nvenc" if use_gpu else "none")
        engine = video_config.get("engine", "moviepy")
        threads = video_config.get("threads", 0)
        auto_cleanup = video_config.get("auto_cleanup", False)

        generated_video_paths = []

        if not timeline:
            _set_step("video", "error", "No audio timeline — cannot render video")
            _log("Video skipped: no audio timeline available")
        else:
            try:
                from video_generator import VideoGenerator
                video_gen = VideoGenerator(mode=video_mode, use_gpu=use_gpu, threads=threads, hw_accel=hw_accel, captions_config=config.get("captions", {}), thumbnail_config=config.get("thumbnail", {}))
                video_gen.set_background_selector(background_override if background_override is not None else (config.get("video", {}) or {}).get("background_selector", ""))
                _bgm_path, _bgm_db = _resolve_background_music(post_id, config)
                video_gen.background_music_path = _bgm_path
                video_gen.background_music_db = _bgm_db
                output_base = os.path.join(PROJECT_ROOT, "posts", post_id)

                if video_mode == "short_reel":
                    # Split into parts based on split_duration
                    from moviepy.editor import AudioFileClip
                    split_duration = video_config.get("split_duration", 30.0)
                    outro_text_template = video_config.get("outro_text", "Follow for Part {next_part}")
                    max_total = float(split_duration)
                    tail_dur = 2.0

                    parts, current, accum = [], [], 0.0
                    for seg in timeline:
                        try:
                            ac = AudioFileClip(seg["audio_path"])
                            dur = ac.duration
                            ac.close()
                        except Exception:
                            dur = 0.0
                        if accum + dur + tail_dur <= max_total:
                            current.append(seg)
                            accum += dur
                        else:
                            if current:
                                parts.append(current)
                            current = [seg]
                            accum = dur
                    if current:
                        parts.append(current)

                    _log(f"Split into {len(parts)} video parts (max {split_duration}s each)")
                    video_sub_steps = [
                        {"label": f"Part {idx}", "status": "pending", "detail": f"{len(ps)} segments"}
                        for idx, ps in enumerate(parts, 1)
                    ]
                    _set_step("video", "running", f"Rendering {len(parts)} parts · engine: {engine}", video_sub_steps)

                    branding = config.get("video", {}).get("branding", "")

                    for idx, part_segs in enumerate(parts, start=1):
                        video_sub_steps[idx - 1]["status"] = "running"
                        _set_step("video", "running", f"Rendering part {idx}/{len(parts)}...", video_sub_steps)
                        _log(f"Rendering part {idx}/{len(parts)}...")
                        _check_cancelled()
                        part_out = os.path.join(output_base, f"video_part{idx}.mp4")
                        tail_text = None
                        if idx < len(parts):
                            tail_text = outro_text_template.replace("{next_part}", str(idx + 1))

                        if engine == "ffmpeg":
                            vp = await asyncio.to_thread(video_gen.generate_video_ffmpeg, part_segs, part_out, tail_text, tail_dur, branding, title, post_subreddit, post_score)
                        else:
                            vp = await asyncio.to_thread(video_gen.generate_video, part_segs, part_out, tail_text, tail_dur, branding, title, post_subreddit, post_score)

                        if vp:
                            generated_video_paths.append(vp)
                            video_sub_steps[idx - 1]["status"] = "done"
                        else:
                            video_sub_steps[idx - 1]["status"] = "error"
                        _set_step("video", "running", f"Rendering part {idx}/{len(parts)}...", video_sub_steps)
                else:
                    # Single video output
                    branding = config.get("video", {}).get("branding", "")
                    output_video = os.path.join(output_base, "video.mp4")
                    video_sub_steps = [{"label": "Full video", "status": "running", "detail": f"{engine} engine · {len(timeline)} segments"}]
                    _set_step("video", "running", f"Rendering single video · engine: {engine}", video_sub_steps)
                    _log(f"Rendering single video ({engine} engine)...")
                    if engine == "ffmpeg":
                        vp = await asyncio.to_thread(video_gen.generate_video_ffmpeg, timeline, output_video, None, 0.0, branding, title, post_subreddit, post_score)
                    else:
                        vp = await asyncio.to_thread(video_gen.generate_video, timeline, output_video, None, 0.0, branding, title, post_subreddit, post_score)
                    if vp:
                        # Post-render overlays. Order matters: B-roll
                        # FIRST (replaces the background during its
                        # window), then the avatar layered on top so the
                        # PNG-tuber is visible regardless of which b-roll
                        # is showing behind it.
                        if engine == "ffmpeg":
                            try:
                                n = await _maybe_apply_broll(post_id, vp, timeline, video_gen, config)
                                if n:
                                    _log(f"B-roll: overlaid {n} moment(s) onto {os.path.basename(vp)}")
                            except Exception as e:
                                _log(f"B-roll overlay error (non-fatal): {e}")
                            try:
                                if await _maybe_apply_avatar(post_id, vp, timeline, video_gen, config):
                                    _log(f"Avatar: overlaid onto {os.path.basename(vp)}")
                            except Exception as e:
                                _log(f"Avatar overlay error (non-fatal): {e}")
                        generated_video_paths.append(vp)
                        video_sub_steps[0]["status"] = "done"
                    else:
                        video_sub_steps[0]["status"] = "error"

                if generated_video_paths:
                    # Move to videos/ directory (matching main.py behavior)
                    videos_dir = os.path.join(PROJECT_ROOT, "videos")
                    os.makedirs(videos_dir, exist_ok=True)
                    safe_title = re.sub(r"[^\w\-_]", "_", title)
                    safe_title = re.sub(r"_+", "_", safe_title)[:50].strip("_")
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    base_name = f"{safe_title}_{video_mode}_{timestamp}"

                    if len(generated_video_paths) > 1:
                        series_dir = os.path.join(videos_dir, base_name)
                        os.makedirs(series_dir, exist_ok=True)
                        final_paths = []
                        for idx, src in enumerate(generated_video_paths, 1):
                            dest = os.path.join(series_dir, f"{base_name}_part{idx}.mp4")
                            try:
                                shutil.move(src, dest)
                                final_paths.append(dest)
                            except Exception:
                                final_paths.append(src)
                        generated_video_paths = final_paths
                    else:
                        final_dest = os.path.join(videos_dir, f"{base_name}.mp4")
                        try:
                            shutil.move(generated_video_paths[0], final_dest)
                            generated_video_paths = [final_dest]
                        except Exception:
                            pass

                    _set_step("video", "done", f"Rendered {len(generated_video_paths)} video(s)")
                    _log(f"Video complete: {len(generated_video_paths)} file(s)")

                    # Preserve audio + timeline under videos/proj_<id>/ so
                    # Re-render keeps working after auto_cleanup nukes posts/<id>/.
                    preserve_root = os.path.join(PROJECT_ROOT, "videos", f"proj_{post_id}")
                    preserved_audio_dir = None
                    preserved_timeline = None
                    try:
                        src_audio = os.path.join(PROJECT_ROOT, "posts", post_id, "audio")
                        src_timeline = os.path.join(PROJECT_ROOT, "posts", post_id, "timeline.json")
                        if os.path.isdir(src_audio):
                            dest_audio = os.path.join(preserve_root, "audio")
                            os.makedirs(preserve_root, exist_ok=True)
                            if os.path.isdir(dest_audio):
                                shutil.rmtree(dest_audio)
                            shutil.copytree(src_audio, dest_audio)
                            preserved_audio_dir = dest_audio
                        if os.path.isfile(src_timeline):
                            os.makedirs(preserve_root, exist_ok=True)
                            dest_tl = os.path.join(preserve_root, "timeline.json")
                            shutil.copyfile(src_timeline, dest_tl)
                            preserved_timeline = dest_tl
                            # Rewrite audio paths inside the copied timeline to
                            # point at the preserved audio so Re-render resolves.
                            if preserved_audio_dir:
                                try:
                                    with open(dest_tl, "r", encoding="utf-8") as _tf:
                                        _tl = json.load(_tf)
                                    for _seg in _tl:
                                        ap = _seg.get("audio_path") or ""
                                        if ap:
                                            _seg["audio_path"] = os.path.join(preserved_audio_dir, os.path.basename(ap))
                                    with open(dest_tl, "w", encoding="utf-8") as _tf:
                                        json.dump(_tl, _tf, indent=2, ensure_ascii=False)
                                except Exception as _e:
                                    _log(f"Could not rewrite preserved timeline audio paths: {_e}")
                    except Exception as e:
                        _log(f"Audio/timeline preservation failed: {e}")

                    # Upsert the project registry (survives server restarts).
                    try:
                        from projects_db import upsert as _reg_upsert
                        _reg_upsert(PROJECT_ROOT, {
                            "id": post_id,
                            "title": title,
                            "subreddit": post_subreddit,
                            "score": post_score,
                            "num_comments": len(comments) if isinstance(comments, list) else 0,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                            "video_paths": list(generated_video_paths),
                            "audio_dir": preserved_audio_dir,
                            "timeline_path": preserved_timeline,
                            "render_time_s": None,
                            "status": "published",
                        })
                    except Exception as e:
                        _log(f"projects.json upsert failed: {e}")

                    # Auto cleanup
                    if auto_cleanup:
                        post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
                        try:
                            shutil.rmtree(post_dir)
                            _log(f"Cleaned up post workspace: {post_dir}")
                        except Exception as e:
                            _log(f"Cleanup warning: {e}")
                else:
                    _set_step("video", "error", "Video generation produced no output")
                    _log("Video generation failed — no output files")

            except ImportError as e:
                _set_step("video", "done", f"Video module not available — skipped ({e})")
                _log(f"Video skipped (import error): {e}")
            except Exception as e:
                _set_step("video", "error", f"Render failed: {str(e)[:80]}")
                _log(f"Video error: {e}")
                import traceback
                traceback.print_exc()

        _check_cancelled()

        # ── Step 5: Thumbnails ───────────────────────────────────────
        _set_step("thumbnail", "running", "Generating thumbnails...")
        _log("Step 5: Generating thumbnails...")
        if not generated_video_paths:
            _set_step("thumbnail", "done", "No videos — skipped")
            _log("Thumbnails skipped: no video output")
        else:
            try:
                from video_generator import VideoGenerator
                if 'video_gen' not in dir():
                    video_gen = VideoGenerator(mode=video_mode, use_gpu=use_gpu, threads=threads, hw_accel=hw_accel, captions_config=config.get("captions", {}), thumbnail_config=config.get("thumbnail", {}))
                video_gen.set_background_selector(background_override if background_override is not None else (config.get("video", {}) or {}).get("background_selector", ""))
                branding = config.get("video", {}).get("branding", "")
                p_title = pipeline_state.get("current_post", {}).get("title", title) if pipeline_state.get("current_post") else title
                p_sub = pipeline_state.get("current_post", {}).get("subreddit", "") if pipeline_state.get("current_post") else ""
                p_score = pipeline_state.get("current_post", {}).get("score", 0) if pipeline_state.get("current_post") else 0
                thumb_title_override = gemini_thumbnail_text if gemini_thumbnail_text else None

                thumb_sub_steps = []
                num_thumbs = len(generated_video_paths)

                if num_thumbs > 1:
                    series_dir = os.path.dirname(generated_video_paths[0])
                    for idx in range(1, num_thumbs + 1):
                        thumb_sub_steps.append({"label": f"Part {idx}", "status": "pending", "detail": ""})
                    _set_step("thumbnail", "running", f"Generating {num_thumbs} thumbnails...", thumb_sub_steps)
                    for idx in range(1, num_thumbs + 1):
                        thumb_sub_steps[idx - 1]["status"] = "running"
                        _set_step("thumbnail", "running", f"Thumbnail {idx}/{num_thumbs}...", thumb_sub_steps)
                        thumb_path = os.path.join(series_dir, f"thumbnail_part{idx}.png")
                        await asyncio.to_thread(
                            video_gen.generate_thumbnail,
                            p_title, p_sub, idx, num_thumbs, thumb_path, p_score, branding,
                            thumb_title_override
                        )
                        thumb_sub_steps[idx - 1]["status"] = "done"
                        _set_step("thumbnail", "running", f"Thumbnail {idx}/{num_thumbs}...", thumb_sub_steps)
                else:
                    if video_mode in ("reel", "short_reel"):
                        thumb_sub_steps = [{"label": "Single thumbnail", "status": "running", "detail": ""}]
                        _set_step("thumbnail", "running", "Generating thumbnail...", thumb_sub_steps)
                        # Determine path
                        vdir = os.path.dirname(generated_video_paths[0])
                        vbase = os.path.splitext(os.path.basename(generated_video_paths[0]))[0]
                        thumb_path = os.path.join(vdir, f"{vbase}_thumbnail.png")
                        await asyncio.to_thread(
                            video_gen.generate_thumbnail,
                            p_title, p_sub, 1, 1, thumb_path, p_score, branding,
                            thumb_title_override
                        )
                        thumb_sub_steps[0]["status"] = "done"
                    else:
                        thumb_sub_steps = [{"label": "Full mode — skipped", "status": "done", "detail": ""}]

                _set_step("thumbnail", "done", f"Generated {num_thumbs} thumbnail(s)", thumb_sub_steps)
                _log(f"Thumbnails complete: {num_thumbs}")
            except Exception as e:
                _set_step("thumbnail", "error", f"Thumbnail failed: {str(e)[:80]}")
                _log(f"Thumbnail error: {e}")

        _check_cancelled()

        # ── Step 6: Discord Notify ───────────────────────────────────
        _set_step("notify", "running", "Sending notification...")
        _log("Step 6: Discord notification...")
        discord_conf = config.get("discord", {})
        if not discord_conf.get("enabled"):
            _set_step("notify", "done", "Discord disabled — skipped")
            _log("Discord notifications disabled")
        elif not discord_conf.get("webhook_url"):
            _set_step("notify", "done", "No webhook URL configured — skipped")
            _log("No Discord webhook URL")
        else:
            try:
                from discord_notifier import DiscordNotifier
                notifier = DiscordNotifier(discord_conf["webhook_url"])
                upload_media = discord_conf.get("upload_media", True)

                fields = [
                    {"name": "Mode", "value": video_mode, "inline": True},
                    {"name": "Parts", "value": str(len(generated_video_paths)), "inline": True},
                    {"name": "Engine", "value": engine, "inline": True},
                ]
                await asyncio.to_thread(
                    notifier.send_embed,
                    "🎬 New Video Ready",
                    f"**{title}**\n\nVideo generation complete.",
                    fields,
                )

                if upload_media and generated_video_paths:
                    for vp in generated_video_paths:
                        await asyncio.to_thread(notifier.send_file, vp)

                _set_step("notify", "done", "Discord notified")
                _log("Discord notification sent")
            except Exception as e:
                _set_step("notify", "error", f"Notify failed: {str(e)[:80]}")
                _log(f"Discord error: {e}")

        # ── Done ─────────────────────────────────────────────────────
        elapsed = time.time() - start_time
        stats["videos_today"] += 1
        stats["total_runs"] += 1
        stats["successful_runs"] += 1
        stats["total_render_time_s"] += elapsed

        # Use actual generated paths (not _get_video_file_info which can't find moved files)
        total_size = sum(os.path.getsize(p) for p in generated_video_paths if os.path.exists(p))
        # Tag the row with whichever brand profile was active when the
        # render fired, so the Videos page can filter / group / display
        # a brand badge per card. Looked up at the moment of write so
        # mid-pipeline brand-switches don't retroactively re-label.
        _b_id, _b_name, _b_color = _active_brand_summary()
        # Drop prior row for this id so a repeat run replaces instead of duplicating.
        videos_db = [v for v in videos_db if v["id"] != post_id]
        videos_db.insert(0, {
            "id": post_id,
            "title": title or post_id,
            "subreddit": pipeline_state["current_post"].get("subreddit", "") if pipeline_state["current_post"] else "",
            "score": pipeline_state["current_post"].get("score", 0) if pipeline_state["current_post"] else 0,
            "num_comments": 0,
            "status": "published" if generated_video_paths else "audio_only" if timeline else "fetched",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "has_video": bool(generated_video_paths),
            "has_audio": bool(timeline),
            "render_time_s": round(elapsed, 1),
            "parts": len(generated_video_paths) if len(generated_video_paths) > 1 else None,
            "file_size_bytes": total_size or None,
            "video_paths": list(generated_video_paths),
            "audio_dir": locals().get("preserved_audio_dir"),
            "timeline_path": locals().get("preserved_timeline"),
            "brand_id":   _b_id,
            "brand_name": _b_name,
            "brand_color": _b_color,
        })
        _persist_videos_db()
        try:
            from render_history import record as _rh_record
            _rh_record(PROJECT_ROOT, success=bool(generated_video_paths), render_time_s=elapsed, resume=False)
        except Exception:
            pass
        _log(f"Pipeline completed in {elapsed:.1f}s")

    except Exception as e:
        pipeline_state["error"] = str(e)
        try:
            from render_history import record as _rh_record
            _rh_record(PROJECT_ROOT, success=False, resume=False)
        except Exception:
            pass
        for step in pipeline_state["steps"]:
            if step["status"] == "running":
                step["status"] = "error"
                step["detail"] = str(e)[:100]
        stats["total_runs"] += 1
        _log(f"Pipeline error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        pipeline_state["is_running"] = False
        pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()


def _set_step(step_id: str, status: str, detail: str = "", sub_steps: Optional[List[Dict]] = None):
    now_iso = datetime.now(timezone.utc).isoformat()
    for step in pipeline_state["steps"]:
        if step["id"] == step_id:
            # Stamp transitions so the UI can render per-step elapsed time.
            prev = step.get("status")
            step["status"] = status
            step["detail"] = detail
            if status == "running" and prev != "running":
                step["started_at"] = now_iso
                step["finished_at"] = None
            elif status in ("done", "error") and prev == "running":
                step["finished_at"] = now_iso
            if sub_steps is not None:
                step["sub_steps"] = sub_steps
            break


def _generate_local_tts_narrative(tts_instance, post_id, title, body, author, comments, progress_callback, cancel_check):
    """Generate full narrative using a local TTS engine (VibeVoice or Qwen3)."""
    timeline = []
    total_segments = 0
    current_segment = 0

    # Pre-calculate total segments
    title_segs = tts_instance.segment_text(title)
    body_segs = tts_instance.segment_text(body) if body and body.strip() else []
    comment_seg_counts = [len(tts_instance.segment_text(c.get("body", ""))) for c in comments]
    total_segments = len(title_segs) + len(body_segs) + sum(comment_seg_counts)

    def _make_progress(phase):
        def _cb(current_in_phase, total_in_phase, seg_text):
            nonlocal current_segment
            current_segment += 1
            if progress_callback:
                progress_callback(phase, current_segment, total_segments, f"({current_in_phase}/{total_in_phase}) {seg_text[:40]}")
        return _cb

    # Title
    title_segments = tts_instance.generate_segments(title, progress_callback=_make_progress("Title"), cancel_check=cancel_check)
    for seg in title_segments:
        seg["author"] = author
        seg["segment_role"] = "title"
        timeline.append(seg)

    # Body
    if body and body.strip():
        body_segments = tts_instance.generate_segments(body, progress_callback=_make_progress("Body"), cancel_check=cancel_check)
        for seg in body_segments:
            seg["author"] = author
            timeline.append(seg)

    # Comments
    for i, comment in enumerate(comments):
        if cancel_check:
            cancel_check()
        comment_body = comment.get("body", "")
        comment_author = comment.get("author", "Anonymous")
        comment_segments = tts_instance.generate_segments(comment_body, progress_callback=_make_progress(f"Comment {i+1}"), cancel_check=cancel_check)
        for seg in comment_segments:
            seg["author"] = comment_author
            timeline.append(seg)

    return timeline


# ── Videos ────────────────────────────────────────────────────────────

@app.get("/api/videos")
async def list_videos():
    safe = []
    for v in videos_db:
        entry = {k: val for k, val in v.items() if k != "video_paths"}
        # Add a list of part filenames so the frontend knows what's available
        paths = v.get("video_paths", [])
        entry["part_files"] = [os.path.basename(p) for p in paths if os.path.exists(p)]
        # Check for thumbnails alongside video files
        entry["has_thumbnails"] = False
        if paths:
            first_dir = os.path.dirname(paths[0]) if paths[0] else None
            if first_dir and os.path.isdir(first_dir):
                entry["has_thumbnails"] = any(f.endswith(".png") and "thumbnail" in f for f in os.listdir(first_dir))
        # Social copy: exists on disk already? The card renders a ✓ badge
        # so the user can tell at a glance which ones still need copy.
        entry["has_social"] = os.path.isfile(
            os.path.join(PROJECT_ROOT, "posts", str(v.get("id") or ""), "social.json")
        )
        # Brand fields are already on `entry` thanks to the dict-copy at
        # the top of the loop, but ensure they exist on legacy rows so
        # the UI doesn't have to handle `undefined` everywhere.
        entry.setdefault("brand_id",    None)
        entry.setdefault("brand_name",  None)
        entry.setdefault("brand_color", None)
        safe.append(entry)
    return {"videos": safe}


def _find_thumbnail_files(video_id: str) -> List[str]:
    """
    Return thumbnail PNG paths for one specific video.

    The render pipeline writes thumbnails as `<mp4_basename>_thumbnail.png`
    alongside each mp4, so the source-of-truth is the registry entry's
    `video_paths`: for each mp4 path, the matching thumbnail is
    `<mp4_path without .mp4>_thumbnail.png`. The previous implementation
    walked the whole `videos/` directory picking up ANY thumbnail PNG,
    which meant every `/api/videos/X/thumbnail` request returned the same
    alphabetically-first file regardless of which video was requested.
    """
    paths: list[str] = []
    entry = _find_video_entry(video_id)
    if entry and entry.get("video_paths"):
        for vp in entry["video_paths"]:
            if not vp:
                continue
            base, _ = os.path.splitext(vp)
            # Try both `<base>_thumbnail.png` (used by FFmpeg engine) and
            # `<base>.png` (moviepy fallback).
            for candidate in (f"{base}_thumbnail.png", f"{base}.png"):
                if os.path.isfile(candidate) and candidate not in paths:
                    paths.append(candidate)

    # Fallback: search for thumbnails inside posts/<video_id>/ — that's
    # where live pipeline runs put them before they get moved to videos/.
    if not paths:
        post_dir = os.path.join(PROJECT_ROOT, "posts", video_id)
        if os.path.isdir(post_dir):
            for f in sorted(os.listdir(post_dir)):
                if f.endswith("_thumbnail.png") or f == "thumbnail.png":
                    fp = os.path.join(post_dir, f)
                    if fp not in paths:
                        paths.append(fp)

    return paths


@app.get("/api/videos/{video_id}/thumbnail")
async def get_thumbnail(video_id: str, part: int = 0):
    """Serve a thumbnail image for a video part (0-indexed)."""
    thumbs = _find_thumbnail_files(video_id)
    if not thumbs:
        raise HTTPException(404, "No thumbnails found")
    if part < 0 or part >= len(thumbs):
        raise HTTPException(404, f"Thumbnail part {part} not found. Available: 0-{len(thumbs)-1}")
    return FileResponse(
        thumbs[part],
        media_type="image/png",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
    )


def _find_video_entry(video_id: str):
    for v in videos_db:
        if v["id"] == video_id:
            return v
    return None


def _find_all_video_files(video_id: str) -> List[str]:
    """
    Return mp4 paths for ONE specific video.

    Source of truth is the registry entry's `video_paths`. The previous
    implementation bolted a 'fallback' that appended `videos/` itself to
    the search dirs, then walked that folder listing every mp4 in it —
    so every /api/videos/X/stream request resolved to a flat 'every
    video on disk' list. Hence the preview always opening the wrong
    video. Post-dir fallback (`posts/<video_id>/*.mp4`) is id-scoped so
    it's still safe.
    """
    paths: list[str] = []
    entry = _find_video_entry(video_id)
    if entry and entry.get("video_paths"):
        for p in entry["video_paths"]:
            if p and os.path.exists(p) and p not in paths:
                paths.append(p)
        # When the registry has any surviving file, trust it — don't
        # augment with unrelated scanned files.
        if paths:
            return paths

    # Only fall back to the id-scoped post workspace, never the shared
    # videos/ root. videos/<video_id>/ (multi-part subfolders) IS
    # id-scoped so that's fine too.
    post_dir = os.path.join(PROJECT_ROOT, "posts", video_id)
    parts_dir = os.path.join(PROJECT_ROOT, "videos", video_id)
    for d in (post_dir, parts_dir):
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.lower().endswith(".mp4"):
                    fp = os.path.join(d, f)
                    if fp not in paths:
                        paths.append(fp)
    return paths


@app.get("/api/videos/{video_id}/stream")
async def stream_video(video_id: str, part: int = 0):
    """Stream a specific part (0-indexed). Defaults to first part."""
    all_files = _find_all_video_files(video_id)
    if not all_files:
        raise HTTPException(404, "Video file not found")
    if part < 0 or part >= len(all_files):
        raise HTTPException(404, f"Part {part} not found. Available: 0-{len(all_files)-1}")
    # Disable caching so a re-rendered file is always picked up fresh.
    return FileResponse(
        all_files[part],
        media_type="video/mp4",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
    )


@app.get("/api/videos/{video_id}/download")
async def download_video(video_id: str, part: int = 0):
    """Download a specific part (0-indexed). Defaults to first part."""
    all_files = _find_all_video_files(video_id)
    if not all_files:
        raise HTTPException(404, "Video file not found")
    if part < 0 or part >= len(all_files):
        raise HTTPException(404, f"Part {part} not found. Available: 0-{len(all_files)-1}")
    path = all_files[part]
    filename = os.path.basename(path)
    return FileResponse(path, media_type="video/mp4", filename=filename)


@app.delete("/api/videos/{video_id}")
async def delete_video(video_id: str, keep_files: bool = False):
    """
    Remove a video from the list. If keep_files is true, leaves files on disk.
    Otherwise deletes:
      - the exact mp4 paths recorded for this entry (plus its sibling thumbnail)
      - its posts/<id>/ workspace when the id looks like a Reddit post id
    Never substring-matches filenames — that previously caused sibling posts
    with similar titles to be deleted together.
    """
    global videos_db
    entry = next((v for v in videos_db if v["id"] == video_id), None)
    if not entry:
        raise HTTPException(404, f"Video '{video_id}' not found in list")

    # 1. Always drop from the in-memory list AND the persistent registry.
    videos_db = [v for v in videos_db if v["id"] != video_id]
    _persist_videos_db()

    if keep_files:
        _log(f"Removed '{video_id}' from list (files kept on disk)")
        return {"success": True, "files_deleted": 0, "paths": []}

    # 2. Delete exact files referenced by this entry.
    deleted_paths = []
    for p in entry.get("video_paths") or []:
        try:
            if p and os.path.isfile(p):
                os.remove(p)
                deleted_paths.append(p)
                # Sibling thumbnail in videos/ dir (same basename + _thumbnail.png / .mp4 swap)
                base = os.path.splitext(p)[0]
                for tpath in (base + "_thumbnail.png", base + ".png"):
                    if os.path.isfile(tpath):
                        os.remove(tpath)
                        deleted_paths.append(tpath)
        except OSError as e:
            _log(f"Could not delete {p}: {e}")

    # 3. If the id looks like a Reddit post id (alphanumeric, ≤12 chars) and a
    #    posts/<id>/ workspace exists, remove that too. This won't match
    #    unrelated posts thanks to the exact folder-name check.
    if video_id and video_id.isalnum() and len(video_id) <= 12:
        post_dir = os.path.join(PROJECT_ROOT, "posts", video_id)
        if os.path.isdir(post_dir):
            try:
                shutil.rmtree(post_dir)
                deleted_paths.append(post_dir)
            except OSError as e:
                _log(f"Could not remove {post_dir}: {e}")

        # Also remove a same-named dir under videos/ (multi-part series layout)
        series_dir = os.path.join(PROJECT_ROOT, "videos", video_id)
        if os.path.isdir(series_dir):
            try:
                shutil.rmtree(series_dir)
                deleted_paths.append(series_dir)
            except OSError as e:
                _log(f"Could not remove {series_dir}: {e}")

        # And the preserved project dir (videos/proj_<id>/ with audio + timeline).
        proj_dir = os.path.join(PROJECT_ROOT, "videos", f"proj_{video_id}")
        if os.path.isdir(proj_dir):
            try:
                shutil.rmtree(proj_dir)
                deleted_paths.append(proj_dir)
            except OSError as e:
                _log(f"Could not remove {proj_dir}: {e}")

    _log(f"Deleted '{video_id}': {len(deleted_paths)} path(s)")
    return {"success": True, "files_deleted": len(deleted_paths), "paths": deleted_paths}


@app.get("/api/used-posts")
async def get_used_posts():
    return {"used_posts": _load_used_posts()}


@app.get("/api/logs")
async def get_logs():
    return {"logs": run_logs[-100:]}


@app.get("/api/stats")
async def get_stats():
    avg_render = round(stats["total_render_time_s"] / stats["total_runs"]) if stats["total_runs"] > 0 else 0
    success_rate = round(stats["successful_runs"] / stats["total_runs"] * 100) if stats["total_runs"] > 0 else 0
    return {
        "videos_today": stats["videos_today"],
        "posts_scanned": stats["posts_scanned"],
        "avg_render_time_s": avg_render,
        "success_rate": success_rate,
        "total_runs": stats["total_runs"],
    }


# ── TTS Provider Management ─────────────────────────────────────────

@app.get("/api/tts/elevenlabs/voices")
async def elevenlabs_voices():
    """
    Fetch the ElevenLabs voice library for the currently configured API key.
    Uses tts.elevenlabs_api_key (or tts.elevenlabs.api_key) from config.json.
    """
    import requests as _requests
    cfg = _load_config()
    tts_cfg = cfg.get("tts", {}) or {}
    el_cfg = tts_cfg.get("elevenlabs", {}) if isinstance(tts_cfg.get("elevenlabs"), dict) else {}
    api_key = tts_cfg.get("elevenlabs_api_key") or el_cfg.get("api_key") or ""
    if not api_key:
        return {"voices": [], "error": "missing_api_key"}
    try:
        r = _requests.get(
            "https://api.elevenlabs.io/v2/voices",
            headers={"xi-api-key": api_key, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code == 401:
            return {"voices": [], "error": "unauthorized"}
        r.raise_for_status()
        data = r.json()
        voices = []
        for v in data.get("voices", []):
            voices.append({
                "voice_id": v.get("voice_id"),
                "name": v.get("name"),
                "category": v.get("category"),  # premade / cloned / generated
                "description": (v.get("labels") or {}).get("description") or v.get("description"),
                "labels": v.get("labels") or {},
                "preview_url": v.get("preview_url"),
            })
        voices.sort(key=lambda x: ((x.get("category") or "z"), (x.get("name") or "").lower()))
        return {"voices": voices}
    except _requests.exceptions.RequestException as e:
        return {"voices": [], "error": f"request_failed: {e}"}


# ──────────────────────────────────────────────────────────────────────
# Background music library — auto-pick a track that matches the script's
# tone, mix it under the narration during render. Storage layout mirrors
# `backgrounds/`: flat files plus a metadata JSON for per-track moods.
# ──────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────
# Content Calendar — schedule Generate-with-AI runs for specific datetimes.
# Each "slot" stores the same params shape /api/pipeline/run-ai takes;
# the worker fires them at scheduled_at, generates a variant, picks the
# top-fit, and enqueues the render.
# ──────────────────────────────────────────────────────────────────────

@app.get("/api/calendar")
async def calendar_list():
    from content_calendar import list_slots
    return {"slots": list_slots(PROJECT_ROOT)}


@app.post("/api/calendar")
async def calendar_create(req: dict):
    from content_calendar import create_slot
    sched = (req.get("scheduled_at") or "").strip()
    if not sched:
        raise HTTPException(400, "scheduled_at (ISO datetime) is required")
    title = (req.get("title") or "").strip() or "Scheduled run"
    kind  = (req.get("kind") or "ai").strip()
    if kind not in ("ai",):
        # MVP: only the AI pipeline path is wired. custom/news can come later.
        raise HTTPException(400, "kind must be 'ai' for now")
    brand_id = req.get("brand_id") or None
    params   = req.get("params") or {}
    slot = create_slot(
        PROJECT_ROOT,
        scheduled_at=sched, kind=kind,
        brand_id=brand_id, title=title, params=params,
    )
    return {"slot": slot}


@app.put("/api/calendar/{slot_id}")
async def calendar_update(slot_id: str, req: dict):
    from content_calendar import update_slot
    s = update_slot(PROJECT_ROOT, slot_id, req)
    if not s:
        raise HTTPException(404, "Slot not found")
    return {"slot": s}


@app.delete("/api/calendar/{slot_id}")
async def calendar_delete(slot_id: str):
    from content_calendar import delete_slot
    if not delete_slot(PROJECT_ROOT, slot_id):
        raise HTTPException(404, "Slot not found")
    return {"deleted": True}


@app.post("/api/calendar/{slot_id}/fire-now")
async def calendar_fire_now(slot_id: str):
    """Reschedule a slot to NOW so the worker picks it up next tick."""
    from content_calendar import update_slot, get_slot
    s = get_slot(PROJECT_ROOT, slot_id)
    if not s:
        raise HTTPException(404, "Slot not found")
    update_slot(PROJECT_ROOT, slot_id, {
        "scheduled_at": datetime.now(timezone.utc).isoformat(),
        "status": "planned",
        "error": None,
    })
    return {"queued_for_immediate_fire": True}


async def _calendar_worker():
    """
    Fires due calendar slots. Each slot:
      1. Mark `generating` → snapshot the brand's settings (auto-switch).
      2. Run /api/ai/generate-variants internally to get a candidate.
      3. Write synthetic post + enqueue on the run queue (kind: "post").
      4. Mark `queued` with post_id.
    Errors mark `failed` with the exception message.
    """
    from content_calendar import pop_due, mark_status
    await asyncio.sleep(3)  # lifespan-yield grace
    while True:
        try:
            slot = pop_due(PROJECT_ROOT)
            if not slot:
                await asyncio.sleep(30)
                continue

            sid = slot["id"]
            params = slot.get("params") or {}
            brand_id = slot.get("brand_id")
            _log(f"Calendar: firing slot {sid} (brand={brand_id}, title={slot.get('title','')[:60]})")
            mark_status(PROJECT_ROOT, sid, "generating")

            # Optionally switch the active brand for this run. We snapshot
            # the previously-active brand's overrides first via the same
            # helper /api/brands/active uses.
            try:
                if brand_id:
                    from brand_profiles import (
                        get_profile, update_profile, get_active_id,
                        snapshot_overrides_from_config, apply_overrides_to_config,
                    )
                    cfg = _load_config()
                    prev = get_active_id(cfg)
                    if prev and prev != brand_id:
                        update_profile(PROJECT_ROOT, prev,
                                       config_overrides=snapshot_overrides_from_config(cfg))
                    new_brand = get_profile(PROJECT_ROOT, brand_id)
                    if new_brand:
                        apply_overrides_to_config(cfg, new_brand.get("config_overrides") or {})
                        cfg["active_brand_id"] = brand_id
                        _save_config(cfg)
            except Exception as e:
                _log(f"Calendar: brand switch failed for {sid}: {e}")

            # Generate one candidate via the AI flow, then enqueue it.
            try:
                cfg = _load_config()
                g = cfg.get("gemini") or {}
                provider = g.get("provider", "gemini")
                ai_key = (
                    g.get("api_key") if provider == "gemini" else
                    g.get("openrouter_api_key") if provider == "openrouter" else
                    g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
                )
                model = g.get("model") or "gemini-2.0-flash"
                ollama_url = g.get("ollama_url", "http://localhost:11434")

                from ai_content_generator import AIContentGenerator
                generator = AIContentGenerator(cfg)
                content_data = await asyncio.to_thread(
                    generator.generate,
                    params.get("content_style", "story"),
                    params.get("niche", "relationship_drama"),
                    params.get("custom_topic"),
                    params.get("interactive_format", "put_a_finger_down"),
                    (params.get("content_filter") or "normal"),
                    params.get("target_audience"),
                    (params.get("tone") or "dramatic"),
                )
                if not content_data:
                    mark_status(PROJECT_ROOT, sid, "failed", error="AI returned no content")
                    continue

                post_id, _, subreddit, _ = _write_ai_post_to_disk(
                    content_data=content_data,
                    content_style=params.get("content_style", "story"),
                    niche=params.get("niche", "relationship_drama"),
                    content_filter=(params.get("content_filter") or "normal"),
                    target_audience=params.get("target_audience"),
                    tone=(params.get("tone") or "dramatic"),
                    custom_title=params.get("custom_title"),
                )

                ng = (params.get("narrator_gender") or "auto").lower()
                from run_queue import enqueue
                enqueue(PROJECT_ROOT, post_id=post_id,
                        title=slot.get("title") or content_data.get("title", ""),
                        subreddit=subreddit,
                        params={
                            "kind": "post",
                            "narrator_gender": ng if ng != "auto" else None,
                            "voice_override": (params.get("voice_override") or "").strip() or None,
                            "background_override": params.get("background_selector"),
                            "video_mode": params.get("video_mode"),
                            "tts_enabled": params.get("tts_enabled", True),
                        })
                mark_status(PROJECT_ROOT, sid, "queued", post_id=post_id)
                _log(f"Calendar: slot {sid} → queued post {post_id}")
            except Exception as e:
                _log(f"Calendar: slot {sid} failed: {e}")
                mark_status(PROJECT_ROOT, sid, "failed", error=str(e))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _log(f"Calendar worker tick failed: {e}")
            await asyncio.sleep(15)


# ──────────────────────────────────────────────────────────────────────
# Channel-niche finder — turns "what should my next channel be?" into
# concrete niche cards backed by current YouTube trend data + the
# user's interests/audience/content-filter brief.
#
# Cheap on quota: 1 unit for the trending fetch + ~100 units per
# user-supplied keyword for the per-keyword "top videos" fetch.
# Trending result is cached 6h, keyword searches reuse the existing
# 24h benchmark cache.
# ──────────────────────────────────────────────────────────────────────

@app.post("/api/niches/generate")
async def niches_generate(req: dict):
    """
    Body:
      {
        interests:       "comma, separated, seed keywords (optional)",
        audience:        "free-text target",
        content_filter:  "safe" | "normal" | "edgy",
        region:          "US",
        count:           6
      }
    Returns:
      { niches: [...], trend_signals: {trending_count, keywords_used: [...]} }
    """
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


# ──────────────────────────────────────────────────────────────────────
# Brand profiles — saved snapshots of every "what this channel looks
# like" config key (captions, title card, watermark, voice, BG selector,
# auto-broll style, music). Switching brands writes the brand's
# config_overrides INTO config.json so every existing reader keeps
# working unchanged.
# ──────────────────────────────────────────────────────────────────────

@app.get("/api/brands")
async def brands_list():
    """List every saved brand profile + the active id."""
    from brand_profiles import list_profiles, get_active_id
    cfg = _load_config()
    return {
        "brands":    list_profiles(PROJECT_ROOT),
        "active_id": get_active_id(cfg),
    }


@app.get("/api/brands/active")
async def brand_active_get():
    """Return the active brand profile in full (or null if none)."""
    from brand_profiles import get_active_id, get_profile
    cfg = _load_config()
    bid = get_active_id(cfg)
    if not bid:
        return {"brand": None}
    return {"brand": get_profile(PROJECT_ROOT, bid)}


@app.post("/api/brands")
async def brands_create(req: dict):
    """
    Create a new brand. Body: { name, color?, snapshot_current?: bool }
    snapshot_current=true (default) takes a snapshot of brand-scoped
    keys from the live config.json so the new brand mirrors the user's
    current setup.
    """
    from brand_profiles import create_profile
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    color = (req.get("color") or "").strip() or "#FF8855"
    snapshot_current = bool(req.get("snapshot_current", True))
    cfg = _load_config()
    prof = create_profile(
        PROJECT_ROOT, name=name, color=color,
        from_config=cfg if snapshot_current else None,
    )
    return {"brand": prof}


@app.get("/api/brands/{brand_id}")
async def brands_get(brand_id: str):
    from brand_profiles import get_profile
    prof = get_profile(PROJECT_ROOT, brand_id)
    if not prof:
        raise HTTPException(404, "Brand not found")
    return {"brand": prof}


@app.put("/api/brands/{brand_id}")
async def brands_update(brand_id: str, req: dict):
    """Edit name / color. Config edits go through PUT /api/config when
    this brand is active (those auto-snapshot back here)."""
    from brand_profiles import update_profile
    prof = update_profile(
        PROJECT_ROOT, brand_id,
        name=req.get("name"),
        color=req.get("color"),
    )
    if not prof:
        raise HTTPException(404, "Brand not found")
    return {"brand": prof}


@app.delete("/api/brands/{brand_id}")
async def brands_delete(brand_id: str):
    """
    Delete a brand profile. If it was the active one, the active id is
    cleared (config.json values stay as-is — they become the next
    brand's baseline if the user creates one).
    """
    from brand_profiles import delete_profile, get_active_id
    cfg = _load_config()
    if get_active_id(cfg) == brand_id:
        cfg.pop("active_brand_id", None)
        _save_config(cfg)
    ok = delete_profile(PROJECT_ROOT, brand_id)
    if not ok:
        raise HTTPException(404, "Brand not found")
    return {"deleted": True}


@app.post("/api/brands/active")
async def brands_set_active(req: dict):
    """
    Switch the active brand. Sequence:
      1. Snapshot current brand-scoped config.json keys into the
         PREVIOUSLY active brand (if any) — auto-save.
      2. Apply the new brand's config_overrides onto config.json.
      3. Set config.active_brand_id = new id.
    Body: { id: <brand_id> }   (id="" → de-activate, no apply.)
    """
    from brand_profiles import (
        get_profile, update_profile, snapshot_overrides_from_config,
        apply_overrides_to_config, get_active_id,
    )
    new_id = (req.get("id") or "").strip()
    cfg = _load_config()
    prev_id = get_active_id(cfg)

    if prev_id and prev_id != new_id:
        # Auto-snapshot the values the user has been editing into the
        # previously-active brand so nothing is lost on switch.
        prev_overrides = snapshot_overrides_from_config(cfg)
        update_profile(PROJECT_ROOT, prev_id, config_overrides=prev_overrides)

    if not new_id:
        cfg.pop("active_brand_id", None)
        _save_config(cfg)
        return {"active_id": None, "applied": False}

    new_brand = get_profile(PROJECT_ROOT, new_id)
    if not new_brand:
        raise HTTPException(404, "Brand not found")
    apply_overrides_to_config(cfg, new_brand.get("config_overrides") or {})
    cfg["active_brand_id"] = new_id
    _save_config(cfg)
    _log(f"Brand switched: {prev_id} → {new_id} ({new_brand.get('name')})")
    return {"active_id": new_id, "applied": True, "brand": new_brand}


@app.post("/api/brands/{brand_id}/save-current")
async def brands_save_current(brand_id: str):
    """
    Manually snapshot current config.json brand-scoped keys into this
    brand's profile.json. Use case: "I just edited the captions, save
    those edits to this brand."
    """
    from brand_profiles import update_profile, snapshot_overrides_from_config
    cfg = _load_config()
    overrides = snapshot_overrides_from_config(cfg)
    prof = update_profile(PROJECT_ROOT, brand_id, config_overrides=overrides)
    if not prof:
        raise HTTPException(404, "Brand not found")
    return {"brand": prof, "saved": True}


@app.post("/api/brands/{brand_id}/profile-pic")
async def brands_upload_pic(brand_id: str, file: UploadFile = File(...)):
    """Upload / replace the brand avatar. Stored as profile_pic.png."""
    from brand_profiles import get_profile
    prof = get_profile(PROJECT_ROOT, brand_id)
    if not prof:
        raise HTTPException(404, "Brand not found")
    content = await file.read()
    if not content:
        raise HTTPException(400, "empty upload")
    dest_dir = os.path.join(PROJECT_ROOT, "brands", brand_id)
    os.makedirs(dest_dir, exist_ok=True)
    with open(os.path.join(dest_dir, "profile_pic.png"), "wb") as f:
        f.write(content)
    return {"saved": True}


@app.get("/api/brands/{brand_id}/profile-pic")
async def brands_get_pic(brand_id: str):
    p = os.path.join(PROJECT_ROOT, "brands", brand_id, "profile_pic.png")
    if not os.path.isfile(p):
        raise HTTPException(404, "no profile pic")
    return FileResponse(p, media_type="image/png")


# ──────────────────────────────────────────────────────────────────────
# Avatar Reels — per-brand "PNG-tuber" management.
#
# Each brand has its own avatar directory: brands/<id>/avatar/<slug>.png
# with metadata at brands/<id>/avatar.json giving each PNG an emotion
# tag (neutral/happy/sad/angry/surprised/confused/excited) + a "talking"
# boolean (mouth open variant).
#
# Animation knobs (position, scale, jiggle, threshold, fps) live in
# the brand's config_overrides.avatar block — gets snapshotted/applied
# along with everything else when brands are switched.
# ──────────────────────────────────────────────────────────────────────

def _avatar_dir(brand_id: str) -> str:
    return os.path.join(PROJECT_ROOT, "brands", brand_id, "avatar")


def _avatar_meta_path(brand_id: str) -> str:
    return os.path.join(_avatar_dir(brand_id), "avatar.json")


def _load_avatar_meta(brand_id: str) -> dict:
    p = _avatar_meta_path(brand_id)
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_avatar_meta(brand_id: str, meta: dict) -> None:
    os.makedirs(_avatar_dir(brand_id), exist_ok=True)
    p = _avatar_meta_path(brand_id)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


@app.get("/api/brands/{brand_id}/avatar")
async def avatar_list(brand_id: str):
    """Every PNG in this brand's avatar/ folder + tags."""
    from brand_profiles import get_profile
    if not get_profile(PROJECT_ROOT, brand_id):
        raise HTTPException(404, "Brand not found")
    d = _avatar_dir(brand_id)
    meta = _load_avatar_meta(brand_id)
    out = []
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith(".png"):
                continue
            full = os.path.join(d, fn)
            row = meta.get(fn) or {}
            out.append({
                "filename":   fn,
                "emotion":    (row.get("emotion") or "neutral"),
                "talking":    bool(row.get("talking", False)),
                "size_bytes": os.path.getsize(full),
            })
    return {"avatars": out}


@app.post("/api/brands/{brand_id}/avatar/upload")
async def avatar_upload(brand_id: str,
                        file: UploadFile = File(...),
                        emotion: str = "neutral",
                        talking: bool = False):
    """Upload a PNG. Tag it on upload (emotion + talking). De-dup name."""
    from brand_profiles import get_profile
    if not get_profile(PROJECT_ROOT, brand_id):
        raise HTTPException(404, "Brand not found")
    content = await file.read()
    if not content:
        raise HTTPException(400, "empty upload")
    fn = (file.filename or "avatar.png")
    if not fn.lower().endswith(".png"):
        # Force .png suffix — the renderer assumes RGBA PNG.
        fn = re.sub(r"\.[^.]+$", "", fn) + ".png"
    fn = re.sub(r"[^\w\.\- ]+", "_", fn).strip(" ._") or "avatar.png"

    d = _avatar_dir(brand_id)
    os.makedirs(d, exist_ok=True)
    dest = os.path.join(d, fn)
    n = 2
    while os.path.exists(dest):
        stem, ext = os.path.splitext(fn)
        dest = os.path.join(d, f"{stem}_{n}{ext}")
        n += 1
    with open(dest, "wb") as f:
        f.write(content)

    em = (emotion or "neutral").lower().strip()
    valid = ("neutral", "happy", "sad", "angry", "surprised", "confused", "excited")
    if em not in valid:
        em = "neutral"
    meta = _load_avatar_meta(brand_id)
    meta[os.path.basename(dest)] = {
        "emotion": em,
        "talking": bool(talking),
    }
    _save_avatar_meta(brand_id, meta)
    return {
        "saved": True,
        "filename": os.path.basename(dest),
        "emotion": em, "talking": bool(talking),
    }


@app.put("/api/brands/{brand_id}/avatar/{filename}")
async def avatar_update_meta(brand_id: str, filename: str, req: dict):
    """Update emotion / talking flag on an existing PNG."""
    from brand_profiles import get_profile
    if not get_profile(PROJECT_ROOT, brand_id):
        raise HTTPException(404, "Brand not found")
    if not os.path.isfile(os.path.join(_avatar_dir(brand_id), filename)):
        raise HTTPException(404, "PNG not found")
    valid = ("neutral", "happy", "sad", "angry", "surprised", "confused", "excited")
    em = (req.get("emotion") or "").lower().strip()
    if em and em not in valid:
        raise HTTPException(400, f"emotion must be one of {valid}")
    meta = _load_avatar_meta(brand_id)
    row = meta.setdefault(filename, {})
    if em:
        row["emotion"] = em
    if "talking" in req:
        row["talking"] = bool(req["talking"])
    _save_avatar_meta(brand_id, meta)
    return {"saved": True, "filename": filename, **row}


@app.delete("/api/brands/{brand_id}/avatar/{filename}")
async def avatar_delete(brand_id: str, filename: str):
    p = os.path.join(_avatar_dir(brand_id), filename)
    if not os.path.isfile(p):
        raise HTTPException(404, "PNG not found")
    try: os.remove(p)
    except OSError: raise HTTPException(500, "Failed to delete")
    meta = _load_avatar_meta(brand_id)
    meta.pop(filename, None)
    _save_avatar_meta(brand_id, meta)
    return {"deleted": True}


@app.get("/api/brands/{brand_id}/avatar/{filename}")
async def avatar_serve(brand_id: str, filename: str):
    """Stream a single PNG so the UI thumbnails / preview can show it."""
    p = os.path.join(_avatar_dir(brand_id), filename)
    if not os.path.isfile(p):
        raise HTTPException(404, "PNG not found")
    return FileResponse(p, media_type="image/png")


def _active_brand_summary() -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Helper for tagging videos_db rows. Returns (brand_id, brand_name, brand_color).
    All None if no brand is active or the active id points at a deleted profile.
    """
    try:
        from brand_profiles import get_active_id, get_profile
        cfg = _load_config()
        bid = get_active_id(cfg)
        if not bid:
            return None, None, None
        prof = get_profile(PROJECT_ROOT, bid)
        if not prof:
            return None, None, None
        return bid, prof.get("name"), prof.get("color")
    except Exception:
        return None, None, None


async def _maybe_apply_avatar(post_id: str, video_path: str, timeline: list, video_gen, config: dict) -> bool:
    """
    If the active brand has avatar.enabled, render a transparent webm
    overlay matching the rendered video's duration / canvas, then
    composite it on top via FFmpeg. Best-effort — never raises.
    """
    bid = (config or {}).get("active_brand_id")
    if not bid:
        return False
    avatar_cfg = (config.get("avatar") or {})
    if not avatar_cfg.get("enabled"):
        return False

    brand_avatar_dir = os.path.join(PROJECT_ROOT, "brands", bid, "avatar")
    if not os.path.isdir(brand_avatar_dir):
        return False
    # Need at least one PNG.
    has_png = any(
        f.lower().endswith(".png") for f in os.listdir(brand_avatar_dir)
    )
    if not has_png:
        return False

    # Source narration text + total duration.
    text = " ".join((seg.get("text") or "").strip() for seg in (timeline or []) if seg.get("text"))
    total_dur = 0.0
    for seg in (timeline or []):
        try: total_dur += float(seg.get("duration") or 0)
        except (TypeError, ValueError): pass
    if total_dur < 1.0:
        return False

    # Find the rendered AUDIO file alongside the video so amplitude
    # analysis doesn't have to demux the muxed mp4 a second time.
    # `posts/<id>/audio_full.m4a` or `*.m4a` is a fair guess; fall back
    # to the rendered video itself (FFmpeg will demux).
    audio_for_amp = video_path
    posts_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    for cand in ("ffmpeg_audio_temp.m4a", "audio_full.m4a", "audio.m4a"):
        p = os.path.join(posts_dir, cand)
        if os.path.isfile(p):
            audio_for_amp = p
            break

    g = config.get("gemini") or {}
    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    try:
        from avatar_renderer import (
            DEFAULT_SETTINGS, compute_amplitude_windows,
            compute_emotion_windows, render_avatar_overlay,
            overlay_webm_onto_video,
        )
        settings = {**DEFAULT_SETTINGS, **(avatar_cfg or {})}
        fps = int(settings.get("fps", 30))
        threshold_db = float(settings.get("talk_threshold_db", -32.0))
        use_emotions = bool(settings.get("use_emotions", True)) and bool(g.get("enabled"))

        _log(f"Avatar: analyzing audio amplitude (fps={fps}, threshold_db={threshold_db})")
        amp = await asyncio.to_thread(
            compute_amplitude_windows,
            audio_for_amp, fps=fps, threshold_db=threshold_db,
        )
        if not amp:
            _log("Avatar: amplitude analysis returned no frames; skipping overlay")
            return False

        _log(f"Avatar: tagging emotions (use_llm={use_emotions})")
        emotions = await asyncio.to_thread(
            compute_emotion_windows,
            text=text, total_duration_s=total_dur,
            provider=provider, api_key=api_key, model=model, ollama_url=ollama_url,
            use_llm=use_emotions,
        )

        # Canvas size = video_gen's reel dims (already 1080×1920 for reels).
        canvas_w = int(getattr(video_gen, "width", 1080))
        canvas_h = int(getattr(video_gen, "height", 1920))

        out_dir = os.path.dirname(video_path)
        webm_path = os.path.join(out_dir, "avatar_overlay.webm")
        _log(f"Avatar: rendering {fps}fps overlay (~{int(total_dur)}s, {canvas_w}×{canvas_h})")
        ok = await asyncio.to_thread(
            render_avatar_overlay,
            avatar_dir=brand_avatar_dir,
            canvas_w=canvas_w, canvas_h=canvas_h,
            duration_s=total_dur, fps=fps,
            amplitude_frames=amp,
            emotions=emotions,
            settings=settings,
            output_webm=webm_path,
        )
        if not ok:
            return False

        composed = os.path.join(out_dir, "with_avatar.mp4")
        ok = await asyncio.to_thread(
            overlay_webm_onto_video,
            video_path, webm_path, composed,
        )
        if ok:
            os.replace(composed, video_path)
            try: os.remove(webm_path)
            except OSError: pass
            _log(f"Avatar: ✓ overlaid onto {os.path.basename(video_path)}")
            return True
        return False
    except Exception as e:
        _log(f"Avatar overlay error (non-fatal): {e}")
        return False


async def _maybe_apply_broll(post_id: str, video_path: str, timeline: list, video_gen, config: dict) -> int:
    """
    If video.broll.enabled is on, run the LLM moment-tagger, download
    Pexels clips, and overlay them onto the rendered video. Returns the
    number of overlays applied. Best-effort — never raises.
    """
    broll_cfg = (config.get("video") or {}).get("broll") or {}
    if not broll_cfg.get("enabled"):
        return 0
    pexels_key = (broll_cfg.get("pexels_api_key") or "").strip()
    if not pexels_key:
        _log("B-roll enabled but no Pexels API key — skipping. Set it in Config → Video → Auto B-roll.")
        return 0

    g = config.get("gemini") or {}
    if not g.get("enabled"):
        return 0
    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    # Reconstruct narration text + total duration from the timeline.
    script = " ".join((seg.get("text") or "").strip() for seg in (timeline or []) if seg.get("text"))
    total_dur = 0.0
    for seg in (timeline or []):
        try: total_dur += float(seg.get("duration") or 0)
        except (TypeError, ValueError): pass
    if total_dur < 4.0 or len(script) < 60:
        return 0

    out_dir = os.path.join(PROJECT_ROOT, "posts", post_id, "broll")
    try:
        max_clips = int(broll_cfg.get("max_clips_per_minute") or 4)
        max_clips = max(1, min(8, int((total_dur / 60) * max_clips) or 3))
    except Exception:
        max_clips = 3

    try:
        from broll import select_and_download
        moments = await asyncio.to_thread(
            select_and_download,
            script=script, total_duration_s=total_dur,
            out_dir=out_dir,
            provider=provider, ai_api_key=api_key, model=model, ollama_url=ollama_url,
            pexels_api_key=pexels_key,
            max_clips=max_clips,
        )
    except Exception as e:
        _log(f"B-roll selection failed: {e}")
        return 0

    if not moments:
        _log("B-roll: no moments selected.")
        return 0

    # Persist for UI inspection ("which b-roll clips ended up in this render?").
    try:
        with open(os.path.join(PROJECT_ROOT, "posts", post_id, "broll.json"), "w", encoding="utf-8") as f:
            json.dump({"moments": moments, "applied_to": video_path}, f, indent=2)
    except Exception:
        pass

    ok = await asyncio.to_thread(video_gen.overlay_broll, video_path, moments)
    return len(moments) if ok else 0


def _resolve_background_music(post_id: str, config: dict) -> tuple[Optional[str], float]:
    """
    Look up the background music track to use for a render. Returns
    (absolute_path or None, volume_db). Reads `tts.background_music`:
        {
          "enabled": bool,
          "volume_db": -18,
          "manual_track": "<filename>" or "",   # if set, wins
          "auto_pick_by_tone": true              # falls back if no manual_track
        }
    """
    tts_cfg = config.get("tts") or {}
    bm = tts_cfg.get("background_music") or {}
    if not bm.get("enabled"):
        return None, -18.0
    try:
        vol_db = float(bm.get("volume_db", -18))
    except (TypeError, ValueError):
        vol_db = -18.0

    from music_library import music_dir, pick_track_for_tone
    manual = (bm.get("manual_track") or "").strip()
    if manual:
        p = os.path.join(music_dir(PROJECT_ROOT), manual)
        if os.path.isfile(p):
            return p, vol_db

    if bm.get("auto_pick_by_tone"):
        # Pull the tone from posts/<id>/summary.json (AI-generated posts
        # write it; legacy Reddit posts won't have it and pick_track_for_tone
        # gracefully falls back to any-tagged → any-track).
        tone = ""
        try:
            sp = os.path.join(PROJECT_ROOT, "posts", post_id, "summary.json")
            with open(sp, "r", encoding="utf-8") as f:
                tone = (json.load(f).get("tone") or "").lower()
        except Exception:
            pass
        return pick_track_for_tone(PROJECT_ROOT, tone or None), vol_db

    return None, vol_db


# ──────────────────────────────────────────────────────────────────────
# Dialogue Mode — AI generates a back-and-forth conversation between two
# characters, and the existing Custom Script pipeline handles the render.
# Speaker labels stay in the captions so viewers can follow who's talking.
#
# Future: per-segment voice swap + dual avatar overlay extension to
# Avatar Reels. This MVP ships the script primitive and the render hook.
# ──────────────────────────────────────────────────────────────────────

@app.post("/api/dialogue/generate")
async def dialogue_generate(req: dict):
    """
    Generate a two-character dialogue script. Body:
      {
        topic:               "what they argue / discuss",
        primary_persona:     "who Speaker A is — short personality blurb",
        guest_persona:       "who Speaker B is",
        primary_label:       "default 'A'",  guest_label: "default 'B'",
        exchanges:           "default 6 — number of A↔B turns",
        tone:                "dramatic | funny | heartfelt | shocking | cringe",
        content_filter:      "safe | normal | edgy",
      }
    Returns: { title, segments: [{speaker, label, text}], plain_script }
    """
    cfg = _load_config()
    g = cfg.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    topic = (req.get("topic") or "").strip()
    if not topic:
        raise HTTPException(400, "topic is required")
    primary_persona = (req.get("primary_persona") or "").strip() or "narrator"
    guest_persona   = (req.get("guest_persona") or "").strip() or "the other person"
    primary_label   = (req.get("primary_label") or "A").strip()[:24] or "A"
    guest_label     = (req.get("guest_label") or "B").strip()[:24] or "B"
    if primary_label.lower() == guest_label.lower():
        guest_label = guest_label + "2"
    try:
        exchanges = max(2, min(20, int(req.get("exchanges") or 6)))
    except (TypeError, ValueError):
        exchanges = 6
    tone = (req.get("tone") or "dramatic").lower()
    cf = (req.get("content_filter") or "normal").lower()

    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    system = (
        "You are writing a two-character viral short-form dialogue. Each "
        "line MUST be a single-sentence punchy turn (≤25 words). Tone "
        f"is {tone}. Content filter is {cf}. NO stage directions, no "
        "[asterisks], no parentheses for actions — just spoken lines. "
        "Return ONLY minified JSON, no markdown."
    )
    prompt = (
        f"Topic / scenario: {topic}\n\n"
        f"Speaker {primary_label} (\"primary\"): {primary_persona}\n"
        f"Speaker {guest_label} (\"guest\"): {guest_persona}\n\n"
        f"Write {exchanges} alternating exchanges (each = 1 line by {primary_label}, "
        f"then 1 line by {guest_label}). Build a clear arc — setup, escalation, payoff. "
        f"End on a line that begs for a comment or share.\n\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "title":  "<≤55 char hook for the video title — about the conversation>",\n'
        '  "segments": [\n'
        '    {"speaker": "primary", "text": "<line>"},\n'
        '    {"speaker": "guest",   "text": "<line>"},\n'
        "    ...\n"
        "  ]\n"
        "}"
    )
    from gemini_hooks import _call_ai
    raw = await asyncio.to_thread(_call_ai, provider, api_key, prompt, system, model, ollama_url)
    if not raw:
        raise HTTPException(502, f"AI provider '{provider}' returned empty response")
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```")[1]
        if s.startswith("json"): s = s[4:]
        s = s.strip("`").strip()
    try:
        parsed = json.loads(s)
    except Exception:
        a = s.find("{"); b = s.rfind("}")
        if a < 0 or b <= a:
            raise HTTPException(502, f"AI returned non-JSON: {s[:200]}")
        try: parsed = json.loads(s[a:b + 1])
        except Exception:
            raise HTTPException(502, f"AI returned non-JSON: {s[:200]}")

    out_segments = []
    for seg in (parsed.get("segments") or []):
        sp = (seg.get("speaker") or "").strip().lower()
        if sp not in ("primary", "guest"):
            continue
        txt = (seg.get("text") or "").strip()
        if not txt:
            continue
        out_segments.append({
            "speaker": sp,
            "label":   primary_label if sp == "primary" else guest_label,
            "text":    txt[:600],
        })
    if not out_segments:
        raise HTTPException(502, "AI returned no usable lines")

    # Build a plain-text script the existing Custom Script pipeline can
    # render. Each line begins with the speaker's label so captions
    # naturally show who's talking. Blank line between turns gives the
    # caption chunker a natural pause boundary.
    plain_lines = []
    for seg in out_segments:
        plain_lines.append(f"{seg['label']}: {seg['text']}")
    plain_script = "\n\n".join(plain_lines)

    return {
        "title":         (parsed.get("title") or topic)[:120],
        "segments":      out_segments,
        "plain_script":  plain_script,
        "primary_label": primary_label,
        "guest_label":   guest_label,
    }


# ──────────────────────────────────────────────────────────────────────
# Activity strip — single-call snapshot of every background worker so
# the bottom status bar can show what's happening across the whole
# suite without polling 4 separate endpoints.
# ──────────────────────────────────────────────────────────────────────

@app.get("/api/activity")
async def activity_snapshot():
    """
    Compact view of every background system. Designed to be polled
    every 5-10s by the StatusBar without being chatty about details.
    """
    # Render queue
    render_running = bool(pipeline_state.get("is_running"))
    render_queued = 0
    try:
        from run_queue import _path as _rq_path, _load as _rq_load
        rq = _rq_load(_rq_path(PROJECT_ROOT))
        render_queued = sum(1 for it in (rq.get("items") or []) if it.get("status") == "queued")
    except Exception:
        pass

    # Social-copy queue
    social_running = 0
    social_queued = 0
    try:
        from social_queue import snapshot as _social_snap
        sd = _social_snap(PROJECT_ROOT)
        for it in (sd.get("items") or []):
            if it.get("status") == "running": social_running += 1
            elif it.get("status") == "queued": social_queued += 1
    except Exception:
        pass

    # Calendar
    cal_planned = 0
    cal_next: Optional[str] = None
    cal_in_flight = 0
    try:
        from content_calendar import list_slots
        for s in list_slots(PROJECT_ROOT):
            st = s.get("status")
            if st == "planned":
                cal_planned += 1
                ts = s.get("scheduled_at") or ""
                if ts and (cal_next is None or ts < cal_next):
                    cal_next = ts
            elif st in ("due", "generating"):
                cal_in_flight += 1
    except Exception:
        pass

    # Comment drafts
    comment_drafts_open = 0
    comment_failed = 0
    try:
        from comment_replier import list_drafts
        for d in list_drafts(PROJECT_ROOT):
            if d.get("status") == "draft": comment_drafts_open += 1
            elif d.get("status") == "failed": comment_failed += 1
    except Exception:
        pass

    return {
        "render_queue":   {
            "running": render_running,
            "queued":  render_queued,
        },
        "social_copy":    {
            "running": social_running,
            "queued":  social_queued,
        },
        "calendar":       {
            "planned":   cal_planned,
            "in_flight": cal_in_flight,
            "next_at":   cal_next,
        },
        "comment_drafts": {
            "open":   comment_drafts_open,
            "failed": comment_failed,
        },
    }


# ──────────────────────────────────────────────────────────────────────
# Comment Replier — fetch top-level comments on the user's uploads, AI
# drafts replies in the active brand voice, user approves and posts.
# Read uses the YT API key (free); posting uses OAuth + the
# youtube.force-ssl scope (50 quota units per reply).
# ──────────────────────────────────────────────────────────────────────

@app.get("/api/comments/drafts")
async def comments_list_drafts():
    from comment_replier import list_drafts
    return {"drafts": list_drafts(PROJECT_ROOT)}


@app.post("/api/comments/sync")
async def comments_sync(req: dict = {}):
    """
    Pulls latest comments from up to N most-recently uploaded videos,
    runs the LLM drafter on each, and stores fresh drafts. Skips any
    comment_id already in the ledger so re-syncs don't duplicate.

    Body: { max_videos?: 5, max_per_video?: 15 }
    """
    cfg = _load_config()
    yt_cfg = cfg.get("youtube", {}) or {}
    api_key = yt_cfg.get("api_key", "")
    if not api_key:
        raise HTTPException(400, "YouTube API key not configured (Config → Publishing).")
    g = cfg.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled (Config → AI Hooks).")

    try:
        max_videos = max(1, min(20, int(req.get("max_videos") or 5)))
        max_per_video = max(1, min(30, int(req.get("max_per_video") or 15)))
    except Exception:
        max_videos, max_per_video = 5, 15

    # Walk the registry for uploaded videos, newest-first.
    uploads = []
    for v in videos_db:
        for up in (v.get("uploads") or []):
            if up.get("platform") != "youtube" or not up.get("video_id"):
                continue
            uploads.append({
                "yt_video_id": up["video_id"],
                "post_id":     v.get("id") or "",
                "title":       v.get("title") or up.get("title") or "",
                "uploaded_at": up.get("uploaded_at") or "",
                "brand_id":    v.get("brand_id") or "",
                "brand_name":  v.get("brand_name") or "",
            })
    uploads.sort(key=lambda x: x.get("uploaded_at", ""), reverse=True)
    uploads = uploads[:max_videos]
    if not uploads:
        return {"added": 0, "message": "No tracked YouTube uploads yet."}

    provider = g.get("provider", "gemini")
    ai_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")
    bm = (cfg.get("video") or {}).get("branding") or ""

    from comment_replier import fetch_top_level_comments, draft_reply, add_drafts
    new_rows: list[dict] = []
    for u in uploads:
        comments = await asyncio.to_thread(
            fetch_top_level_comments, api_key, u["yt_video_id"],
            max_results=max_per_video,
        )
        for c in comments:
            txt = c.get("text") or ""
            if not txt.strip():
                continue
            draft = await asyncio.to_thread(
                draft_reply,
                comment_text=txt,
                video_title=u["title"],
                brand_name=u["brand_name"],
                brand_persona_hint=bm,
                provider=provider, api_key=ai_key,
                model=model, ollama_url=ollama_url,
            )
            if not draft:
                # SKIP path or LLM refusal — don't bother the user
                continue
            new_rows.append({
                "comment_id":     c.get("comment_id") or "",
                "thread_id":      c.get("thread_id") or "",
                "yt_video_id":    u["yt_video_id"],
                "post_id":        u["post_id"],
                "brand_id":       u["brand_id"],
                "comment_text":   txt,
                "comment_author": c.get("author") or "",
                "comment_url":    f"https://youtube.com/watch?v={u['yt_video_id']}&lc={c.get('comment_id','')}",
                "draft_reply":    draft,
            })
    added = await asyncio.to_thread(add_drafts, PROJECT_ROOT, new_rows)
    _log(f"Comment replier: synced {len(uploads)} video(s), added {added} new draft(s)")
    return {"added": added, "videos_scanned": len(uploads)}


@app.put("/api/comments/drafts/{draft_id}")
async def comments_update_draft(draft_id: str, req: dict):
    from comment_replier import update_draft
    r = update_draft(PROJECT_ROOT, draft_id, {
        "edited_reply": req.get("edited_reply"),
    })
    if not r:
        raise HTTPException(404, "Draft not found")
    return {"draft": r}


@app.delete("/api/comments/drafts/{draft_id}")
async def comments_delete_draft(draft_id: str):
    from comment_replier import delete_draft, update_draft
    # If the user wants to keep history but skip the comment, mark rejected
    # via PUT; outright delete is ok too.
    if not delete_draft(PROJECT_ROOT, draft_id):
        raise HTTPException(404, "Draft not found")
    return {"deleted": True}


@app.post("/api/comments/drafts/{draft_id}/reject")
async def comments_reject_draft(draft_id: str):
    from comment_replier import update_draft
    r = update_draft(PROJECT_ROOT, draft_id, {"status": "rejected"})
    if not r:
        raise HTTPException(404, "Draft not found")
    return {"draft": r}


@app.post("/api/comments/drafts/{draft_id}/post")
async def comments_post_draft(draft_id: str):
    """
    Actually post the (possibly edited) reply to YouTube via OAuth.
    Requires the youtube.force-ssl scope — users who connected before
    that scope was added must Disconnect + Connect again on the
    Publishing tab.
    """
    from comment_replier import get_draft, update_draft
    d = get_draft(PROJECT_ROOT, draft_id)
    if not d:
        raise HTTPException(404, "Draft not found")
    text = (d.get("edited_reply") or d.get("draft_reply") or "").strip()
    if not text:
        raise HTTPException(400, "Reply text is empty.")

    yt = _yt_cfg()
    if not (yt.get("client_id") and yt.get("client_secret") and yt.get("refresh_token")):
        raise HTTPException(400, "YouTube OAuth not connected. Connect it on the Publishing tab.")

    # Refresh the access token (same trick the publisher uses).
    import requests as _requests
    try:
        tok_r = _requests.post(
            YT_OAUTH_TOKEN_URL,
            data={
                "client_id":     yt["client_id"],
                "client_secret": yt["client_secret"],
                "refresh_token": yt["refresh_token"],
                "grant_type":    "refresh_token",
            },
            timeout=15,
        )
    except Exception as e:
        update_draft(PROJECT_ROOT, draft_id, {"status": "failed", "error": f"token refresh failed: {e}"})
        raise HTTPException(502, f"OAuth token refresh failed: {e}")
    if tok_r.status_code != 200:
        msg = f"OAuth refresh {tok_r.status_code}: {tok_r.text[:160]}"
        update_draft(PROJECT_ROOT, draft_id, {"status": "failed", "error": msg})
        raise HTTPException(401, msg + " — try Disconnect + Connect on the Publishing tab.")
    access_token = tok_r.json().get("access_token")

    try:
        post_r = _requests.post(
            "https://www.googleapis.com/youtube/v3/comments",
            params={"part": "snippet"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type":  "application/json",
            },
            json={
                "snippet": {
                    "parentId":     d.get("thread_id"),  # YT threads expects the thread id, not the comment id
                    "textOriginal": text,
                }
            },
            timeout=20,
        )
    except Exception as e:
        update_draft(PROJECT_ROOT, draft_id, {"status": "failed", "error": str(e)})
        raise HTTPException(502, f"YouTube comment-insert failed: {e}")
    if post_r.status_code >= 300:
        # 403 here usually means the OAuth scope is missing.
        msg = f"YT comments.insert {post_r.status_code}: {post_r.text[:280]}"
        update_draft(PROJECT_ROOT, draft_id, {"status": "failed", "error": msg})
        if post_r.status_code == 403:
            raise HTTPException(403, msg + " — likely missing youtube.force-ssl scope. Disconnect + Connect again on the Publishing tab.")
        raise HTTPException(post_r.status_code, msg)

    update_draft(PROJECT_ROOT, draft_id, {"status": "posted", "posted_at": datetime.now(timezone.utc).isoformat()})
    # Quota ledger so the user sees the cost.
    try:
        from youtube_quota import record
        record(PROJECT_ROOT, "comments.insert", 50)
    except Exception:
        pass
    return {"posted": True}


# ──────────────────────────────────────────────────────────────────────
# Performance Analytics — pull YouTube view/like/comment stats for every
# upload tracked in the project registry, aggregate, and serve to the
# dashboard. Uses the same YouTube Data API key that benchmarks/social
# copy already uses (`config.youtube.api_key`).
#
# Cached for 10 minutes per fetch — `/videos` quota is 1 unit per
# 50-video batch, so even with hundreds of uploads this is cheap, but
# polling on every dashboard refresh would waste quota fast.
# ──────────────────────────────────────────────────────────────────────

_perf_analytics_cache: dict = {"fetched_at": 0.0, "data": None}
_PERF_TTL_S = 600


def _gather_yt_video_ids() -> list[dict]:
    """Walk videos_db; collect every (video_id, post_id, post_title) that
    has a YouTube upload row."""
    out: list[dict] = []
    for v in videos_db:
        for up in (v.get("uploads") or []):
            if up.get("platform") != "youtube":
                continue
            vid = up.get("video_id")
            if not vid:
                continue
            out.append({
                "yt_video_id":   vid,
                "post_id":       v.get("id") or "",
                "post_title":    v.get("title") or "",
                "subreddit":     v.get("subreddit") or "",
                "uploaded_at":   up.get("uploaded_at") or "",
                "uploaded_title": up.get("title") or v.get("title") or "",
                "privacy":       up.get("privacy") or "private",
                "url":           up.get("url") or f"https://youtube.com/shorts/{vid}",
            })
    return out


def _fetch_yt_stats(video_ids: list[str], api_key: str) -> dict[str, dict]:
    """Batch-fetch stats from the YT v3 API. Returns {video_id: {...}}."""
    import requests as _requests
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
                    "views":        int(stats.get("viewCount", 0) or 0),
                    "likes":        int(stats.get("likeCount", 0) or 0),
                    "comments":     int(stats.get("commentCount", 0) or 0),
                    "title":        snip.get("title", ""),
                    "published_at": snip.get("publishedAt", ""),
                    "thumbnail":    (((snip.get("thumbnails") or {}).get("medium")
                                       or {}).get("url") or ""),
                    "privacy_status": status.get("privacyStatus", ""),
                }
        except Exception as e:
            _log(f"YT analytics batch exception: {e}")
            continue
    return out


@app.post("/api/analytics/recommendations")
async def performance_recommendations():
    """
    LLM-powered diagnosis of what's working / what isn't across the
    user's tracked YouTube uploads. Compares top vs bottom performers
    and returns actionable, specific recommendations.

    Reuses the cached performance data so it doesn't re-spend YT quota.
    """
    cfg = _load_config()
    g = cfg.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    # Pull the cached performance snapshot (or fetch fresh if cold).
    perf = _perf_analytics_cache.get("data")
    if not perf:
        # Trigger a fresh fetch via the existing endpoint helper.
        perf_resp = await performance_analytics(force=False)
        perf = perf_resp if isinstance(perf_resp, dict) else {}

    videos = perf.get("videos") or []
    if len(videos) < 3:
        raise HTTPException(400, "Need at least 3 tracked videos to compare. Publish a few more and try again.")

    # Group by brand so we can highlight cross-brand patterns when relevant.
    by_brand: dict[str, list[dict]] = {}
    for v in videos:
        # Find which brand each video used by walking videos_db (the
        # registry keeps brand_id alongside the post).
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

    # Brief block the LLM can reason over — title, views, likes, age,
    # brand. We deliberately keep it tight so the prompt fits in
    # cheap-tier context windows.
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
    model = g.get("model") or "gemini-2.0-flash"
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
            try: parsed = json.loads(cleaned[a:b + 1])
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


@app.get("/api/analytics/performance")
async def performance_analytics(force: bool = False):
    """
    Aggregate stats across every YouTube upload tracked by the suite.
    Returns:
      {
        "fetched_at": iso,
        "videos":   [<per-video row sorted by views desc>],
        "totals":   { videos, views, likes, comments, days_tracked },
        "averages": { views, likes, comments },
        "top": [<top 5 by views>],
        "by_day":   [{ date, count, views, likes }],   # last 30 days
      }
    """
    cfg = _load_config()
    yt_cfg = cfg.get("youtube", {}) or {}
    api_key = yt_cfg.get("api_key", "")
    if not api_key:
        raise HTTPException(400, "YouTube API key not configured (Config → Publishing).")

    # Cache hit?
    now = time.time()
    if not force and _perf_analytics_cache["data"] is not None:
        if now - _perf_analytics_cache["fetched_at"] < _PERF_TTL_S:
            return _perf_analytics_cache["data"]

    rows = _gather_yt_video_ids()
    if not rows:
        empty = {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "videos": [], "totals": {"videos": 0, "views": 0, "likes": 0, "comments": 0, "days_tracked": 0},
            "averages": {"views": 0, "likes": 0, "comments": 0},
            "top": [], "by_day": [],
        }
        return empty

    stats_map = await asyncio.to_thread(_fetch_yt_stats, [r["yt_video_id"] for r in rows], api_key)

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
    from collections import defaultdict
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
    # Last 30 days only.
    sorted_days = sorted(by_day_map.items())[-30:]
    by_day = [{"date": d, **v} for d, v in sorted_days]

    days_tracked = 0
    if earliest:
        try:
            e = datetime.fromisoformat(earliest)
            days_tracked = max(1, (datetime.now(timezone.utc).replace(tzinfo=None) - e.replace(tzinfo=None)).days)
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
    _perf_analytics_cache["data"] = out
    _perf_analytics_cache["fetched_at"] = now
    return out


@app.get("/api/music")
async def music_list_tracks():
    """Every track in the library with metadata (name + moods + size)."""
    from music_library import list_tracks
    return {"tracks": list_tracks(PROJECT_ROOT)}


@app.post("/api/music/upload")
async def music_upload(file: UploadFile = File(...), name: str = "", moods: str = ""):
    """
    Upload a track. `moods` is a comma-separated list (subset of the
    five tone axes: dramatic / funny / heartfelt / shocking / cringe).
    """
    from music_library import add_track
    content = await file.read()
    if not content:
        raise HTTPException(400, "empty upload")
    moods_list = [m.strip().lower() for m in moods.split(",") if m.strip()]
    try:
        row = add_track(PROJECT_ROOT, file.filename or "track.mp3", content,
                        name=name, moods=moods_list)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"track": row}


@app.put("/api/music/{filename}")
async def music_update(filename: str, req: dict):
    """Edit name / moods. Body: { name?, moods?: [..] }."""
    from music_library import update_meta
    try:
        row = update_meta(PROJECT_ROOT, filename,
                          name=req.get("name"),
                          moods=req.get("moods"))
    except FileNotFoundError:
        raise HTTPException(404, "track not found")
    return {"track": row}


@app.delete("/api/music/{filename}")
async def music_delete(filename: str):
    from music_library import delete_track
    ok = delete_track(PROJECT_ROOT, filename)
    if not ok:
        raise HTTPException(404, "track not found")
    return {"deleted": True}


@app.get("/api/music/preview/{filename}")
async def music_preview(filename: str):
    """Stream the audio file for in-browser preview."""
    from music_library import music_dir
    p = os.path.join(music_dir(PROJECT_ROOT), filename)
    if not os.path.isfile(p):
        raise HTTPException(404, "track not found")
    # Derive content-type from the extension; FastAPI's FileResponse
    # picks audio/mpeg by default which works for browsers either way.
    ext = os.path.splitext(filename)[1].lower()
    media = {
        ".mp3":  "audio/mpeg",
        ".wav":  "audio/wav",
        ".m4a":  "audio/mp4",
        ".aac":  "audio/aac",
        ".flac": "audio/flac",
        ".ogg":  "audio/ogg",
    }.get(ext, "application/octet-stream")
    return FileResponse(p, media_type=media)


@app.post("/api/tts/elevenlabs/clone-voice")
async def elevenlabs_clone_voice(
    name: str = "",
    description: str = "",
    file: UploadFile = File(...),
):
    """
    Instant Voice Cloning — uploads one audio sample to ElevenLabs and
    creates a new custom voice in the user's account. The returned
    voice_id is immediately usable in /v2/voices and across the suite's
    voice pickers.

    Form fields:
      file:        WAV/MP3/M4A/FLAC sample, ≥30s of clean speech recommended
      name:        Display name (defaults to filename stem)
      description: Optional one-liner used in the voice library

    Notes:
      - Uses the configured tts.elevenlabs.api_key.
      - ElevenLabs accepts up to 25 sample files; we send one. The user
        can add more in their ElevenLabs dashboard if they want better
        likeness.
      - Quota: each clone counts against the user's "voice slots" quota,
        not character budget. Free tier = 0 slots, Starter = 10, etc.
    """
    import requests as _requests
    if not file:
        raise HTTPException(400, "audio file required")
    cfg = _load_config()
    tts_cfg = cfg.get("tts", {}) or {}
    el_cfg = tts_cfg.get("elevenlabs", {}) if isinstance(tts_cfg.get("elevenlabs"), dict) else {}
    api_key = tts_cfg.get("elevenlabs_api_key") or el_cfg.get("api_key") or ""
    if not api_key:
        raise HTTPException(400, "ElevenLabs API key not configured")

    # Default name from filename if the form didn't include one.
    safe_name = (name or "").strip()
    if not safe_name:
        base = (file.filename or "voice").rsplit(".", 1)[0]
        safe_name = re.sub(r"[^\w\-\. ]+", "_", base).strip(" _.") or "Custom Voice"
    safe_name = safe_name[:60]

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "uploaded file is empty")

    # ElevenLabs voice-add endpoint takes multipart with the SAME field
    # name `files` repeated for every sample (we send one).
    try:
        resp = await asyncio.to_thread(
            _requests.post,
            "https://api.elevenlabs.io/v1/voices/add",
            headers={"xi-api-key": api_key, "Accept": "application/json"},
            data={
                "name": safe_name,
                "description": (description or "").strip()[:200],
            },
            files={
                "files": (file.filename or "sample.wav", audio_bytes, file.content_type or "audio/wav"),
            },
            timeout=60,
        )
    except Exception as e:
        raise HTTPException(502, f"ElevenLabs request failed: {e}")

    if resp.status_code == 401:
        raise HTTPException(401, "ElevenLabs API key was rejected (401)")
    if resp.status_code == 402:
        raise HTTPException(402, "Voice cloning requires a paid ElevenLabs tier — your account has no voice slots available.")
    if resp.status_code >= 400:
        # Bubble the provider's error message up to the toast.
        try:
            detail = resp.json().get("detail") or resp.text
        except Exception:
            detail = resp.text
        raise HTTPException(resp.status_code, f"ElevenLabs error: {str(detail)[:300]}")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, f"ElevenLabs returned non-JSON: {resp.text[:200]}")
    voice_id = data.get("voice_id") or ""
    if not voice_id:
        raise HTTPException(502, f"ElevenLabs response missing voice_id: {data}")
    _log(f"ElevenLabs cloned voice: '{safe_name}' → {voice_id}")
    return {"voice_id": voice_id, "name": safe_name}


@app.delete("/api/tts/elevenlabs/voices/{voice_id}")
async def elevenlabs_delete_voice(voice_id: str):
    """Delete a voice from the user's ElevenLabs account."""
    import requests as _requests
    if not voice_id:
        raise HTTPException(400, "voice_id required")
    cfg = _load_config()
    tts_cfg = cfg.get("tts", {}) or {}
    el_cfg = tts_cfg.get("elevenlabs", {}) if isinstance(tts_cfg.get("elevenlabs"), dict) else {}
    api_key = tts_cfg.get("elevenlabs_api_key") or el_cfg.get("api_key") or ""
    if not api_key:
        raise HTTPException(400, "ElevenLabs API key not configured")
    try:
        resp = await asyncio.to_thread(
            _requests.delete,
            f"https://api.elevenlabs.io/v1/voices/{voice_id}",
            headers={"xi-api-key": api_key},
            timeout=15,
        )
    except Exception as e:
        raise HTTPException(502, f"ElevenLabs request failed: {e}")
    if resp.status_code == 401:
        raise HTTPException(401, "ElevenLabs API key was rejected")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, f"ElevenLabs error: {resp.text[:200]}")
    return {"deleted": True, "voice_id": voice_id}


@app.get("/api/posts/{post_id}/social")
async def get_social_copy(post_id: str):
    """Return saved social copy for a post, if any."""
    path = os.path.join(PROJECT_ROOT, "posts", post_id, "social.json")
    if not os.path.isfile(path):
        return {"exists": False}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return {"exists": True, **json.load(f)}
    except Exception as e:
        raise HTTPException(500, f"Failed to read social.json: {e}")


def _do_generate_social_copy(post_id: str) -> dict:
    """
    Core social-copy generation — extracted from the HTTP endpoint so
    the background queue worker can call it. Returns the saved payload
    dict on success. Raises HTTPException (so the HTTP endpoint can
    forward the status) or plain Exception (worker catches and reports
    to the queue) on failure.
    """
    post_dir = os.path.join(PROJECT_ROOT, "posts", post_id)
    summary_path = os.path.join(post_dir, "summary.json")

    title = ""
    subreddit = ""
    summary: dict = {}
    if os.path.isfile(summary_path):
        with open(summary_path, "r", encoding="utf-8") as f:
            summary = json.load(f)
        title = summary.get("title", "")
        subreddit = summary.get("subreddit", "")
    else:
        # auto_cleanup wiped posts/<id>/ — fall back to the preserved
        # project registry entry (survives cleanup for exactly this reason).
        try:
            from projects_db import find as _reg_find
            proj = _reg_find(PROJECT_ROOT, post_id) or {}
        except Exception:
            proj = {}
        title = proj.get("title", "")
        subreddit = proj.get("subreddit", "")
        if not title:
            raise HTTPException(
                404,
                f"No metadata for {post_id} — posts/<id>/summary.json is gone and "
                "projects.json has no matching entry. Re-render from the Videos "
                "page or run a fresh pipeline to recreate the post workspace.",
            )

    # Prefer the rendered/story text so the AI has actual narration context.
    story_text = ""
    for candidate in ("story_mode.txt", "qa_mode.txt"):
        p = os.path.join(post_dir, candidate)
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8") as f:
                story_text = f.read()[:2000]
            break
    # Fallback 1: original reddit selftext if we still have the summary.
    if not story_text:
        story_text = (summary.get("selftext") or "")[:2000]
    # Fallback 2: reconstruct narration from the preserved timeline.json.
    if not story_text:
        try:
            from projects_db import find as _reg_find
            proj = _reg_find(PROJECT_ROOT, post_id) or {}
            tl_path = proj.get("timeline_path")
            if tl_path and os.path.isfile(tl_path):
                with open(tl_path, "r", encoding="utf-8") as f:
                    tl = json.load(f)
                story_text = " ".join(
                    (seg.get("text") or "").strip() for seg in tl if seg.get("text")
                )[:2000]
        except Exception:
            pass

    # Pick AI provider from config.gemini (same dispatcher used for hooks).
    config = _load_config()
    g = config.get("gemini", {}) or {}
    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    # Fetch top-performing YouTube videos in the same niche as style references.
    # Graceful no-op if no API key is configured.
    yt_cfg = config.get("youtube", {}) or {}
    yt_key = yt_cfg.get("api_key", "")
    benchmarks: list[dict] = []
    benchmark_query = f"r/{subreddit} reddit stories shorts" if subreddit else "reddit stories shorts"
    if yt_key:
        try:
            from youtube_benchmarks import fetch_benchmarks
            benchmarks = fetch_benchmarks(
                benchmark_query, yt_key, project_root=PROJECT_ROOT, count=8
            )
            _log(f"YouTube benchmarks: fetched {len(benchmarks)} videos for '{benchmark_query}'")
        except Exception as e:
            _log(f"YouTube benchmarks failed: {e}")

    system = (
        "You are a viral short-form video strategist writing for YouTube Shorts AND "
        "the TikTok/Reels pair (they share the same caption format on Reddit-story "
        "gameplay videos). Return ONLY valid minified JSON, no markdown, no commentary.\n\n"
        "=== THE TWO FORMATS ===\n"
        "1) YouTube Shorts — separate TITLE + DESCRIPTION. Title ≤55 chars, bait-y, "
        "hook in <2 s. Description is 1-2 lines then a blank line then a hashtag block.\n"
        "2) Reels/TikTok — ONE field: a long, run-on descriptive caption that spoils "
        "the story arc, followed by an inline hashtag tail. TikTok and Instagram Reels "
        "receive the SAME text.\n\n"
        "=== STYLE EXAMPLES TO MATCH (for the Reels/TikTok caption) ===\n"
        "Format A — run-on story summary, ALL-CAPS emphasis on payoffs:\n"
        "  'My coworker kept \"FORGETTING\" my name in meetings, so I let her do it in "
        "front of the one person she wanted to IMPRESS. #redditreadings #storytime "
        "#reddit #storytelling #relationship #fyp #aita #redditstories #fullstories "
        "#askreddit #reddit_tiktok'\n"
        "  'I Found Out My Wife Cheated With a Coworker, He Came to My Gym to Intimidate "
        "Me, Assaulted Me, I Defended Myself and Knocked Him Out, Pressed Charges Despite "
        "Her Begging, Took a Plea Deal, and Now I'm Moving On #gaming #redditposts "
        "#redditstorytimes #reddittreading'\n"
        "Format B — cliffhanger teaser with 'only part.' prefix + hook question:\n"
        "  'only part. why didn't he or she get a second date? #redd #reddit_tiktok "
        "#askreddit #fyp #foryoupage'\n"
        "  'only part. what are hints that women give that most men don't pick up on? "
        "#foryourpage #fyp #askreddit #redd #reddit_tiktok'\n"
        "Format C — punchy single-line hot take:\n"
        "  'Knowing how some women work makes me less of a feminist, apparently. "
        "#reddit #redditstories #redditreadings #reddit_tiktok #redditstorytime'\n"
        "  '\"The worst she can say is no\". What was the worst she ever said? "
        "#redditreadings #askreddit #reddit #fyp #rejected'\n\n"
        "Pick Format A for full-story videos, Format B when the video is a teaser cut "
        "from a longer series (use the literal prefix 'only part. '), and Format C when "
        "the video is a short hot-take / quote.\n\n"
        "=== HASHTAG RULES ===\n"
        "The hashtag tail MUST blend generic discovery tags + Reddit-TikTok niche tags "
        "+ story-specific tags. Always include at least 3 of these Reddit-TikTok core "
        "tags: #reddit #redditstories #redditstorytime #redditreadings #reddit_tiktok "
        "#redd #askreddit. Add 2-3 algorithmic tags (#fyp #foryoupage). Add the "
        "subreddit-specific tag when applicable (r/AmItheAsshole → #aita / #aitah, "
        "r/relationship_advice → #relationshipadvice / #relationship, r/tifu → #tifu, "
        "r/maliciouscompliance → #maliciouscompliance, r/pettyrevenge → #pettyrevenge). "
        "Then 2-4 topic nouns (#cheating #workplace #divorce etc). 8-14 hashtags total "
        "for Reels/TikTok captions. When benchmark videos are provided, MATCH their "
        "hashtag density and hook phrasing — without copying text verbatim."
    )

    # Build a benchmarks block that the LLM can pattern-match against.
    benchmarks_block = ""
    if benchmarks:
        lines = []
        for i, b in enumerate(benchmarks[:8], 1):
            tags_str = ", ".join(b.get("tags", [])[:8]) or "(no tags)"
            desc_str = (b.get("description") or "").replace("\n", " ")[:300]
            lines.append(
                f"[{i}] {b.get('view_count', 0):,} views — \"{b.get('title','')}\"\n"
                f"    tags: {tags_str}\n"
                f"    desc: {desc_str}"
            )
        benchmarks_block = (
            "\n\n=== HIGH-PERFORMING VIDEOS IN THIS NICHE (style references) ===\n"
            + "\n\n".join(lines)
            + "\n\nLearn from the hook phrasing, hashtag choices, and tone. "
              "Do NOT copy any title or description verbatim.\n"
        )

    # Map the subreddit to its canonical hashtag form — it's the single most
    # important discovery tag and the LLM keeps missing it.
    sub_tag_map = {
        "amitheasshole": "#AITA",
        "aita": "#AITA",
        "relationship_advice": "#relationshipadvice",
        "relationships": "#relationships",
        "tifu": "#tifu",
        "maliciouscompliance": "#maliciouscompliance",
        "pettyrevenge": "#pettyrevenge",
        "prorevenge": "#prorevenge",
        "nuclearrevenge": "#nuclearrevenge",
        "entitledparents": "#entitledparents",
        "choosingbeggars": "#choosingbeggars",
        "askreddit": "#askreddit",
        "confessions": "#confessions",
        "truoffmychest": "#offmychest",
        "offmychest": "#offmychest",
        "bestofredditorupdates": "#redditupdates",
    }
    sub_hashtag = sub_tag_map.get((subreddit or "").lower().replace("-", "_"), "")
    required_tags_str = "#reddit, #redditstories, #redditstorytime"
    if sub_hashtag:
        required_tags_str += f", {sub_hashtag}"

    prompt = f"""Generate SHORT-FORM social copy (YouTube Shorts + TikTok + Reels) for this Reddit story.

Subreddit: r/{subreddit}
Original title: {title}

Story excerpt:
{story_text[:1500]}
{benchmarks_block}
HARD REQUIREMENTS:
- YouTube Shorts titles — ≤55 chars, bait-y, one-line hooks. NO long descriptive colons.
- Reels/TikTok uses ONE caption that's used verbatim on BOTH platforms (same format).
  Pick Format A/B/C as described. Write the whole caption + inline hashtag tail as
  a single string.
- Hashtag tail MUST include at least 3 Reddit-TikTok core tags from this set:
  #reddit #redditstories #redditstorytime #redditreadings #reddit_tiktok #redd #askreddit.
  Plus the required baseline: {required_tags_str}.
- Add 2-4 story-specific topic tags. 8-14 tags total on the Reels/TikTok caption.
- Don't reuse the exact same hook text across YouTube and Reels — give each its own angle.

Return JSON with exactly this shape:
{{
  "youtube": {{
    "titles": ["<≤55 chars hook>", "<variant 2>", "<variant 3>"],
    "description": "<1-2 lines setting up the story, blank line, then 6-10 hashtags including the required ones>",
    "tags": ["reddit", "redditstories", "redditstorytime", "<sub-specific>", "<topic tags>", ...up to 12, NO leading #]
  }},
  "reel": {{
    "format":   "A",
    "caption":  "<the full Reels/TikTok caption INCLUDING the inline hashtag tail — single string, used verbatim on both platforms>",
    "hashtags": ["#reddit", "#redditstories", "#redditstorytime", "#reddit_tiktok", "<sub-specific>", "<topic>", "...8-14 total"]
  }}
}}
"""

    try:
        from gemini_hooks import _call_ai  # type: ignore
        raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
        if not raw:
            raise HTTPException(502, f"AI provider '{provider}' returned empty response")
        # Strip code fences if the model ignored our instructions.
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip("`").strip()
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to salvage: find first { and last }
            start = cleaned.find("{"); end = cleaned.rfind("}")
            if start >= 0 and end > start:
                parsed = json.loads(cleaned[start:end + 1])
            else:
                raise HTTPException(502, f"AI returned non-JSON: {cleaned[:200]}")

        out = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "provider": provider,
            "model": model,
            "source_title": title,
            "subreddit": subreddit,
            "benchmarks_used": [
                {
                    "title": b.get("title", ""),
                    "channel": b.get("channel", ""),
                    "view_count": b.get("view_count", 0),
                    "video_id": b.get("video_id", ""),
                }
                for b in benchmarks[:8]
            ],
            **parsed,
        }
        os.makedirs(post_dir, exist_ok=True)
        with open(os.path.join(post_dir, "social.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        return {"exists": True, **out}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Social copy generation failed: {e}")


@app.post("/api/posts/{post_id}/generate-social")
async def generate_social_copy(post_id: str):
    """
    Synchronous one-shot generation — blocks until the LLM responds.
    The batch-queue endpoint below is the non-blocking alternative for
    when the user wants to generate many at once and come back later.
    """
    return _do_generate_social_copy(post_id)


# ──────────────────────────────────────────────────────────────────────
# Social-copy batch queue — background generation for N posts at once.
# ──────────────────────────────────────────────────────────────────────

@app.post("/api/social/batch-generate")
async def batch_generate_social(req: dict):
    """
    Enqueue multiple posts for background social-copy generation. The
    user returns to the Videos page; a small status chip shows queue
    progress. Items already running/queued for the same post_id are
    skipped so a double-click doesn't duplicate work.

    Body: { "items": [{"post_id": "abc", "title": "..."}, ...] }
    Returns the queue rows that were actually added.
    """
    from social_queue import enqueue_many
    items_in = req.get("items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(400, "items[] required")
    added = enqueue_many(PROJECT_ROOT, items_in)
    _log(f"Social copy queue: +{len(added)} item(s) (skipped {len(items_in) - len(added)} dup/empty)")
    return {"added": added, "count": len(added)}


@app.get("/api/social/queue")
async def social_queue_snapshot():
    """Return the full queue state (pending/running/history)."""
    from social_queue import snapshot
    return snapshot(PROJECT_ROOT)


@app.delete("/api/social/queue/{queue_id}")
async def social_queue_cancel(queue_id: str):
    """Cancel a queued entry (running entries can't be cancelled mid-call)."""
    from social_queue import cancel
    ok = cancel(PROJECT_ROOT, queue_id)
    if not ok:
        raise HTTPException(409, "Can't cancel — item is currently running")
    return {"cancelled": True}


@app.delete("/api/social/queue")
async def social_queue_clear_history():
    """Clear finished / failed / cancelled rows from the queue view."""
    from social_queue import clear_history
    removed = clear_history(PROJECT_ROOT)
    return {"removed": removed}


# The background worker — one iteration per queued item. Spawned by
# lifespan(), cancelled on server shutdown. Processes strictly serially
# so LLM rate limits aren't hit.
async def _social_queue_worker():
    import asyncio
    while True:
        try:
            from social_queue import pop_next, finish
            row = pop_next(PROJECT_ROOT)
            if not row:
                await asyncio.sleep(2.0)
                continue
            qid = row["queue_id"]; pid = row["post_id"]
            _log(f"Social copy queue → generating for {pid} ({row.get('title', '')[:60]})")
            try:
                await asyncio.to_thread(_do_generate_social_copy, pid)
                finish(PROJECT_ROOT, qid, ok=True)
                _log(f"Social copy queue ✓ {pid}")
            except HTTPException as he:
                msg = f"{he.status_code}: {he.detail}"
                finish(PROJECT_ROOT, qid, ok=False, error=msg)
                _log(f"Social copy queue ✗ {pid} — {msg}")
            except Exception as e:
                finish(PROJECT_ROOT, qid, ok=False, error=str(e))
                _log(f"Social copy queue ✗ {pid} — {e}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # Don't let an outer fault kill the worker.
            _log(f"Social copy worker tick failed: {e}")
            await asyncio.sleep(5.0)


# ──────────────────────────────────────────────────────────────────────
# Publishing — YouTube Shorts
# ──────────────────────────────────────────────────────────────────────
#
# Auth model: Desktop-app OAuth 2.0 against Google. User creates a Desktop
# app client in Google Cloud Console, pastes the client_id + client_secret
# here, then clicks Connect — we open their browser to Google's consent
# page, catch the redirect on our own localhost callback endpoint, exchange
# the code for a refresh_token, and stash it in config.json.
#
# Scheduled release: uploads with `publish_at` are sent to YouTube as
# private + publishAt=<timestamp>. YouTube itself flips them public at the
# scheduled time, so our server can be offline at release.

YT_OAUTH_SCOPES = (
    "https://www.googleapis.com/auth/youtube.upload "
    "https://www.googleapis.com/auth/youtube.readonly "
    # `youtube.force-ssl` is required for posting comment replies via
    # comments.insert. Existing connected users will need to disconnect
    # + reconnect to get this added scope.
    "https://www.googleapis.com/auth/youtube.force-ssl"
)
YT_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
YT_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _yt_cfg() -> dict:
    return (_load_config().get("publishing") or {}).get("youtube") or {}


def _yt_save(patch: dict) -> None:
    cfg = _load_config()
    pub = cfg.setdefault("publishing", {})
    yt = pub.setdefault("youtube", {})
    yt.update(patch)
    _save_config(cfg)


def _yt_callback_url(request_host: Optional[str] = None) -> str:
    # The user's panel is served on the same host/port that runs this API,
    # so the callback can reuse it. Google's Desktop-app flow accepts any
    # localhost / 127.0.0.1 redirect URI without extra domain verification.
    host = (request_host or "localhost:8000").split(",")[0].strip()
    return f"http://{host}/api/publish/youtube/oauth/callback"


@app.get("/api/publish/youtube/quota")
async def youtube_quota_get():
    """Current daily quota usage ledger (counted client-side from our own
    API calls — YouTube doesn't expose a real-time usage endpoint)."""
    from youtube_quota import snapshot
    return snapshot(PROJECT_ROOT)


@app.post("/api/publish/youtube/quota/limit")
async def youtube_quota_set_limit(req: dict):
    """Override the assumed daily quota (e.g. after getting a Google quota bump)."""
    limit = int(req.get("limit") or 0)
    if limit < 1:
        raise HTTPException(400, "limit must be a positive integer")
    from youtube_quota import set_daily_limit
    set_daily_limit(PROJECT_ROOT, limit)
    return {"saved": True, "limit": limit}


@app.post("/api/publish/youtube/quota/reset")
async def youtube_quota_reset_today():
    """Zero today's counter — for when the ledger drifted from reality."""
    from youtube_quota import reset_today
    reset_today(PROJECT_ROOT)
    return {"reset": True}


@app.get("/api/publish/youtube/status")
async def youtube_publish_status():
    """Return connection status for the YouTube publisher."""
    yt = _yt_cfg()
    has_client = bool(yt.get("client_id") and yt.get("client_secret"))
    has_token = bool(yt.get("refresh_token"))
    return {
        "has_credentials": has_client,
        "connected": has_client and has_token,
        "channel_title": yt.get("channel_title", ""),
        "channel_id": yt.get("channel_id", ""),
        "custom_url": yt.get("channel_custom_url", ""),
    }


@app.post("/api/publish/youtube/credentials")
async def youtube_save_credentials(req: dict):
    """
    Save the OAuth client_id + client_secret from the Google Cloud
    Desktop-app credential. These are needed before the Connect flow.
    """
    cid = (req.get("client_id") or "").strip()
    csec = (req.get("client_secret") or "").strip()
    if not cid or not csec:
        raise HTTPException(400, "client_id and client_secret are required")
    _yt_save({"client_id": cid, "client_secret": csec})
    return {"saved": True}


@app.post("/api/publish/youtube/disconnect")
async def youtube_disconnect():
    """Forget the stored refresh_token (keeps client_id/secret)."""
    _yt_save({"refresh_token": "", "channel_title": "", "channel_id": "", "channel_custom_url": ""})
    return {"disconnected": True}


@app.get("/api/publish/youtube/oauth/start")
async def youtube_oauth_start(host: Optional[str] = None):
    """
    Return the Google consent URL for the user to open. `host` should be
    the same host:port the panel is running on (e.g. 'localhost:8000').
    """
    yt = _yt_cfg()
    if not (yt.get("client_id") and yt.get("client_secret")):
        raise HTTPException(400, "Save client_id + client_secret first")
    from urllib.parse import urlencode
    params = {
        "client_id": yt["client_id"],
        "redirect_uri": _yt_callback_url(host),
        "response_type": "code",
        "scope": YT_OAUTH_SCOPES,
        "access_type": "offline",
        "prompt": "consent",   # force re-issuing a refresh_token
        "include_granted_scopes": "true",
    }
    return {"auth_url": f"{YT_OAUTH_AUTH_URL}?{urlencode(params)}"}


@app.get("/api/publish/youtube/oauth/callback")
async def youtube_oauth_callback(code: Optional[str] = None, error: Optional[str] = None):
    """
    Google redirects here with ?code=... after the user consents. We
    exchange it for a refresh_token, fetch the channel info, and return
    a tiny self-closing HTML page so the popup tab can close itself.
    """
    from fastapi.responses import HTMLResponse

    def _html(msg: str, ok: bool = True) -> HTMLResponse:
        color = "#22c55e" if ok else "#ef4444"
        return HTMLResponse(
            f"""<!doctype html><html><body style="font-family:system-ui;background:#0a0a0f;color:#eee;padding:40px;text-align:center">
<div style="max-width:400px;margin:auto">
  <div style="font-size:48px;color:{color};margin-bottom:16px">{'✓' if ok else '✗'}</div>
  <h2>{msg}</h2>
  <p style="color:#888;font-size:14px">You can close this tab and return to the panel.</p>
</div>
<script>setTimeout(()=>window.close(),2000);if(window.opener)window.opener.postMessage({{youtubeOauth:'{ 'done' if ok else 'error' }'}},'*')</script>
</body></html>"""
        )

    if error or not code:
        return _html(f"Authorization failed: {error or 'no code returned'}", ok=False)

    yt = _yt_cfg()
    if not (yt.get("client_id") and yt.get("client_secret")):
        return _html("Missing client_id/secret in config", ok=False)

    try:
        resp = requests.post(YT_OAUTH_TOKEN_URL, data={
            "code": code,
            "client_id": yt["client_id"],
            "client_secret": yt["client_secret"],
            "redirect_uri": _yt_callback_url(),
            "grant_type": "authorization_code",
        }, timeout=30)
        data = resp.json()
        rt = data.get("refresh_token")
        if not rt:
            return _html(f"Token exchange failed: {data.get('error_description') or data}", ok=False)

        # Fetch channel info so we can show it in the UI.
        from youtube_publisher import YouTubePublisher
        pub = YouTubePublisher(yt["client_id"], yt["client_secret"], rt, project_root=PROJECT_ROOT)
        info = pub.fetch_my_channel() or {}

        _yt_save({
            "refresh_token": rt,
            "channel_title": info.get("title", ""),
            "channel_id": info.get("id", ""),
            "channel_custom_url": info.get("custom_url", ""),
        })
        _log(f"YouTube connected: {info.get('title', '(unknown)')}")
        return _html(f"Connected as {info.get('title') or 'YouTube channel'}")
    except Exception as e:
        return _html(f"OAuth error: {e}", ok=False)


# requests is imported at module top for the benchmarks client already.
import requests  # noqa: E402  (kept near use-site for clarity)


@app.post("/api/publish/youtube/upload")
async def youtube_upload(req: dict):
    """
    Upload a rendered video to YouTube Shorts.

    Body:
      {
        "video_id":    "<registry id of the video>",
        "part_index":  0,                           # which part for multi-part videos
        "title":       "...",                       # optional override; defaults to social.json.youtube.titles[0]
        "description": "...",                       # optional override
        "tags":        ["..."],                     # optional override
        "privacy":     "public" | "unlisted" | "private",
        "publish_at":  "2026-05-01T17:00:00Z"       # optional; set ⇒ uploaded private, YouTube auto-publishes
      }
    """
    yt = _yt_cfg()
    if not (yt.get("client_id") and yt.get("client_secret") and yt.get("refresh_token")):
        raise HTTPException(400, "YouTube not connected — open Config → Publishing and finish the OAuth flow.")

    vid = (req.get("video_id") or "").strip()
    if not vid:
        raise HTTPException(400, "video_id is required")
    part_idx = int(req.get("part_index") or 0)

    entry = next((v for v in videos_db if v["id"] == vid), None)
    if not entry:
        raise HTTPException(404, f"Video '{vid}' not in registry")
    paths = entry.get("video_paths") or []
    if not paths or part_idx >= len(paths):
        raise HTTPException(404, "No mp4 on disk for that video / part")
    video_path = paths[part_idx]
    if not os.path.isfile(video_path):
        raise HTTPException(404, f"mp4 missing: {video_path}")

    # Pull defaults from social.json if the user didn't override.
    social_path = os.path.join(PROJECT_ROOT, "posts", vid, "social.json")
    social: dict = {}
    if os.path.isfile(social_path):
        try:
            with open(social_path, "r", encoding="utf-8") as f:
                social = json.load(f)
        except Exception:
            pass
    yt_copy = social.get("youtube") or {}

    title = (req.get("title") or "").strip() or (yt_copy.get("titles") or [entry.get("title", "")])[0]
    description = (req.get("description") or "").strip() or yt_copy.get("description") or entry.get("title", "")
    tags = req.get("tags") or yt_copy.get("tags") or ["reddit", "redditstories", "shorts"]
    privacy = (req.get("privacy") or "public").lower()
    if privacy not in ("public", "unlisted", "private"):
        privacy = "public"
    publish_at = (req.get("publish_at") or "").strip() or None

    # Basic publish_at validation: must be UTC RFC-3339 and in the future.
    if publish_at:
        from datetime import datetime as _dt
        try:
            # Accept "...Z" and "+00:00".
            norm = publish_at.replace("Z", "+00:00")
            ts = _dt.fromisoformat(norm)
            if ts.tzinfo is None:
                raise ValueError("publish_at must include timezone (use Z or +00:00)")
            if ts.timestamp() <= time.time() + 60:
                raise ValueError("publish_at must be at least 1 minute in the future")
            # Canonicalize to Z form for the API.
            publish_at = ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception as e:
            raise HTTPException(400, f"Invalid publish_at: {e}")

    # Thumbnail (optional — YouTube ignores custom thumbs on unverified channels).
    thumb_path = None
    try:
        base, _ = os.path.splitext(video_path)
        for cand in (base + "_thumbnail.png", base + ".png"):
            if os.path.isfile(cand):
                thumb_path = cand
                break
    except Exception:
        pass

    _log(f"YouTube upload starting: {title[:60]}… (privacy={privacy}, publish_at={publish_at or '-'})")

    from youtube_publisher import YouTubePublisher
    pub = YouTubePublisher(yt["client_id"], yt["client_secret"], yt["refresh_token"], project_root=PROJECT_ROOT)

    try:
        yt_video_id = await asyncio.to_thread(
            pub.upload_short,
            video_path, title, description,
            thumb_path, tags, "22", privacy, publish_at,
        )
    except Exception as e:
        _log(f"YouTube upload exception: {e}")
        raise HTTPException(500, f"YouTube upload failed: {e}")

    if not yt_video_id:
        raise HTTPException(502, "YouTube upload returned no video id — see server logs")

    # Record the upload on the registry entry so the UI can show a link.
    uploads = entry.setdefault("uploads", [])
    uploads.append({
        "platform":   "youtube",
        "video_id":   yt_video_id,
        "url":        f"https://youtube.com/shorts/{yt_video_id}",
        "part_index": part_idx,
        "privacy":    privacy,
        "publish_at": publish_at,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "title":      title,
    })
    _persist_videos_db()
    _log(f"YouTube upload complete: https://youtube.com/shorts/{yt_video_id}")

    return {
        "success": True,
        "video_id": yt_video_id,
        "url": f"https://youtube.com/shorts/{yt_video_id}",
        "privacy": privacy,
        "publish_at": publish_at,
    }


@app.post("/api/maintenance/clear-all")
async def clear_all_data(req: dict = {}):
    """
    Nuke selected data on disk + in-memory.

    Body (all optional, default false — you must opt in to each):
      {
        "posts":   bool,   # delete posts/<id>/ folders (raw fetches, timelines, etc.)
        "videos":  bool,   # delete videos/ folder (rendered mp4s + preserved audio/timelines)
        "history": bool,   # reset used_posts.json and delete viral_score / social.json / narrator-gender caches
        "registry": bool,  # clear projects.json registry (forces a fresh index)
        "confirm": str     # must equal "DELETE" or the call is rejected
      }
    """
    if req.get("confirm") != "DELETE":
        raise HTTPException(400, 'Set "confirm": "DELETE" in the request body to proceed.')
    if pipeline_state.get("is_running"):
        raise HTTPException(409, "Pipeline is running — cancel it first.")

    do_posts    = bool(req.get("posts"))
    do_videos   = bool(req.get("videos"))
    do_history  = bool(req.get("history"))
    do_registry = bool(req.get("registry"))
    if not any([do_posts, do_videos, do_history, do_registry]):
        raise HTTPException(400, "Nothing to clear — pass at least one of posts / videos / history / registry as true.")

    summary = {"removed_paths": [], "errors": []}

    def _rm(path: str):
        try:
            if not os.path.exists(path):
                return
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            summary["removed_paths"].append(path)
        except Exception as e:
            summary["errors"].append(f"{path}: {e}")

    if do_posts:
        _rm(os.path.join(PROJECT_ROOT, "posts"))
        # Recreate empty dir for subsequent runs
        os.makedirs(os.path.join(PROJECT_ROOT, "posts"), exist_ok=True)

    if do_videos:
        _rm(os.path.join(PROJECT_ROOT, "videos"))
        os.makedirs(os.path.join(PROJECT_ROOT, "videos"), exist_ok=True)
        # In-memory list must reflect the disk wipe.
        global videos_db
        videos_db = []
        _persist_videos_db()

    if do_registry:
        _rm(os.path.join(PROJECT_ROOT, "projects.json"))
        # Drop the in-memory list too so the Videos page matches disk.
        videos_db = []

    if do_history:
        config = _load_config()
        used_posts_file = config.get("output", {}).get("used_posts_file", "used_posts.json")
        _rm(os.path.join(PROJECT_ROOT, used_posts_file))
        # Also zero the "posts scanned" stat so the dashboard reflects the reset.
        stats["posts_scanned"] = 0
        stats["videos_today"] = 0

    _log(f"Maintenance: cleared {', '.join(k for k, v in req.items() if v and k != 'confirm')}; "
         f"removed {len(summary['removed_paths'])} path(s)")
    return {"success": True, **summary}


@app.post("/api/posts/ai-scores/bulk-get")
async def ai_scores_bulk_get(req: dict):
    """
    Cheap cache lookup for the Posts page: give a list of post summaries,
    get back scores for any that are cached under the currently-configured
    model. No AI calls, no disk writes to per-post folders. Used by the
    frontend on mount so cached scores show up without a fresh button click.

    Body:
      { posts: [{id, title?, selftext?}, ...] }
    Response:
      { scores: { post_id: AiScore, ... } }
    """
    posts_in = req.get("posts") or []
    if not posts_in:
        return {"scores": {}}
    cfg = _load_config()
    g = cfg.get("gemini") or {}
    model = g.get("model") or "gemini-2.0-flash"
    from ai_score_cache import get as _cache_get
    out: dict[str, dict] = {}
    for p in posts_in:
        pid = (p.get("id") or "").strip()
        if not pid:
            continue
        cached = _cache_get(
            PROJECT_ROOT, pid,
            current_title=p.get("title", ""),
            current_body=p.get("selftext", ""),
            current_model=model,
        )
        if cached is not None:
            out[pid] = cached
    return {"scores": out}


@app.get("/api/posts/ai-scores/summary")
async def ai_scores_summary():
    """Diagnostics for the cache panel — current count, file path, TTL."""
    from ai_score_cache import size as _cache_size, _cache_path as _cp
    cfg = _load_config()
    ttl = int((cfg.get("ai_scoring") or {}).get("cache_ttl_days", 7))
    return {
        "count":     _cache_size(PROJECT_ROOT),
        "path":      _cp(PROJECT_ROOT),
        "ttl_days":  ttl,
    }


@app.post("/api/posts/ai-scores/clear")
async def ai_scores_clear():
    """Nuke the cache — useful after switching AI models or when results drift."""
    from ai_score_cache import clear as _cache_clear
    n = _cache_clear(PROJECT_ROOT)
    _log(f"AI-score cache cleared ({n} entries)")
    return {"cleared": n}


@app.post("/api/posts/score-viral")
async def score_viral_batch(req: dict):
    """
    Score a batch of posts 0-100 for short-form virality using the configured
    AI provider (gemini.*). Returns {scores: {id: {score, reason}, ...}}.

    Each post dict in `req["posts"]` should contain: id, title, selftext, subreddit, score.
    Missing / unparseable responses fall back to a heuristic score.
    """
    posts_in = req.get("posts") or []
    if not posts_in:
        return {"scores": {}}

    config = _load_config()
    g = config.get("gemini", {}) or {}
    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    model = g.get("model") or "gemini-2.0-flash"
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    from gemini_hooks import _call_ai  # type: ignore

    # Cache schema lives in ai_score_cache module — this constant was the
    # legacy per-post cache version and is now only used for the
    # `.cache/ai_scores.json` write format. Kept for reference / logs.
    CACHE_VERSION = 3

    # Best-effort regex detector from narrator_gender.py. Used as a fallback
    # filler for both the AI path (when the model didn't set the field) and
    # the heuristic path (no AI at all). Cheap to call, never raises.
    try:
        from narrator_gender import detect_narrator_gender as _regex_gender
    except Exception:
        def _regex_gender(title: str, body: str = "") -> Optional[str]:  # type: ignore
            return None

    def _heuristic(post: dict) -> dict:
        """Fallback when the AI call fails. Produces the full v3 shape with
        AI-only fields left null/empty so the UI still renders cleanly."""
        score = 0
        title = (post.get("title") or "").lower()
        if any(k in title for k in ("aita", "update", "revenge", "cheating", "cheated")):
            score += 20
        if post.get("score", 0) > 2000:
            score += 30
        if len(post.get("selftext") or "") > 600:
            score += 15
        score += min(25, int((post.get("num_comments") or 0) / 50))
        return {
            "score":            min(100, score + 10),
            "hook_strength":    None,
            "payoff_strength":  None,
            "emotion":          None,
            "target_audience":  None,
            "recommended_mode": None,
            "suggested_hook":   None,
            "pitfalls":         [],
            "content_warnings":[],
            "narrator_gender":  _regex_gender(post.get("title", ""), post.get("selftext", "")),
            "reason":           "heuristic fallback (no AI)",
            "source":           "heuristic",
        }

    out: dict[str, dict] = {}
    cache_root = os.path.join(PROJECT_ROOT, "posts")

    system = (
        "You are a TikTok/Shorts/Reels editor evaluating Reddit posts for "
        "short-form video. Be ruthless — most posts are not worth making. "
        "Score realistically: 70+ only for posts with a clear hook, strong "
        "emotional arc, and satisfying payoff. Return STRICT minified JSON only, "
        "no markdown, no commentary."
    )

    allowed_emotions = (
        "anger, outrage, shock, schadenfreude, sympathy, heartbreak, amusement, "
        "curiosity, vindication, disgust, awe, fear"
    )
    allowed_modes = "story, qa, hottake, interactive"

    def _clip_int(v, default=None):
        try:
            n = int(v)
            return max(0, min(100, n))
        except (TypeError, ValueError):
            return default

    def _clip_str(v, n=160):
        return (str(v)[:n] if v is not None else "") or ""

    def _clip_list(v, n=3, maxlen=40):
        if not isinstance(v, list):
            return []
        return [str(x)[:maxlen] for x in v[:n] if x]

    def _clip_gender(v) -> Optional[str]:
        """Coerce a model or regex response into 'male' | 'female' | None."""
        if v is None:
            return None
        s = _clip_str(v, 20).lower().strip()
        if s in ("male", "m", "man", "boy", "guy", "husband", "father", "dad",
                 "brother", "son", "he", "him"):
            return "male"
        if s in ("female", "f", "woman", "girl", "wife", "mother", "mom",
                 "sister", "daughter", "she", "her"):
            return "female"
        return None

    def _normalize_result(parsed: dict, fallback_post: dict) -> dict:
        gender = _clip_gender(parsed.get("narrator_gender"))
        if gender is None:
            # Fall back to the deterministic regex if the model didn't emit a
            # usable value — title/body tags like '(27F)' catch 60-70% of
            # Reddit relationship posts for free.
            gender = _regex_gender(
                fallback_post.get("title", ""),
                fallback_post.get("selftext", ""),
            )
        return {
            "score":            _clip_int(parsed.get("score"), 0) or 0,
            "hook_strength":    _clip_int(parsed.get("hook_strength")),
            "payoff_strength":  _clip_int(parsed.get("payoff_strength")),
            "emotion":          _clip_str(parsed.get("emotion"), 30).lower() or None,
            "target_audience":  _clip_str(parsed.get("target_audience"), 40) or None,
            "recommended_mode": _clip_str(parsed.get("recommended_mode"), 20).lower() or None,
            "suggested_hook":   _clip_str(parsed.get("suggested_hook"), 120) or None,
            "pitfalls":         _clip_list(parsed.get("pitfalls")),
            "content_warnings": _clip_list(parsed.get("content_warnings")),
            "narrator_gender":  gender,
            "reason":           _clip_str(parsed.get("reason"), 160),
            "source":           provider,
        }

    def _persist_cache(pid: str, post: dict, result: dict):
        if not pid:
            return
        try:
            from ai_score_cache import put as _cache_put
            _cache_put(
                PROJECT_ROOT, pid,
                title=post.get("title", ""),
                selftext=post.get("selftext", ""),
                model=model,
                result=result,
            )
        except Exception:
            pass

    # ── Cache pass ──────────────────────────────────────────────────────
    # Reads from the central .cache/ai_scores.json (survives posts/ cleanup).
    from ai_score_cache import get as _cache_get
    to_score: list[dict] = []
    for post in posts_in[:40]:
        pid = post.get("id") or ""
        if pid:
            cached = _cache_get(
                PROJECT_ROOT, pid,
                current_title=post.get("title", ""),
                current_body=post.get("selftext", ""),
                current_model=model,
            )
            if cached is not None:
                out[pid] = cached
                continue
        to_score.append(post)

    if not to_score:
        return {"scores": out}

    # ── Batch size / concurrency tuned per provider ─────────────────────
    # Ollama serializes requests at its default num_parallel=1, so calling
    # 4 in flight turns into a 4-deep queue that compounds wall time. Keep
    # Ollama single-threaded but batch many posts per call; remote APIs
    # are fine with low-concurrency N-in-flight requests.
    if provider == "ollama":
        batch_size = 6      # 6 posts per prompt — one call yields all results
        concurrency = 1
    elif provider == "openrouter":
        batch_size = 4
        concurrency = 3
    else:                   # gemini / nvidia_nim — fast APIs, small batches
        batch_size = 3
        concurrency = 4

    def _build_batch_prompt(posts: list[dict]) -> str:
        items = []
        for i, p in enumerate(posts, 1):
            items.append(
                f"--- POST {i} (id: {p.get('id')}) ---\n"
                f"Subreddit: r/{p.get('subreddit') or 'unknown'}\n"
                f"Upvotes: {p.get('score') or 0}, Comments: {p.get('num_comments') or 0}\n"
                f"Title: {(p.get('title') or '')[:220]}\n"
                f"Body: {(p.get('selftext') or '')[:900]}"
            )
        return (
            "Evaluate each of the following Reddit posts for a 30-90 second "
            "vertical video. Return a JSON object with a single key 'results' "
            "whose value is an array — one object per post, IN THE SAME ORDER "
            "AS INPUT, each with this exact shape:\n"
            "{\n"
            '  "id": "<echo the input post id>",\n'
            '  "score": <0-100 overall>,\n'
            '  "hook_strength": <0-100>,\n'
            '  "payoff_strength": <0-100>,\n'
            f'  "emotion": "<one of: {allowed_emotions}>",\n'
            '  "target_audience": "<short label>",\n'
            f'  "recommended_mode": "<one of: {allowed_modes}>",\n'
            '  "suggested_hook": "<≤90 chars spoken opening line>",\n'
            '  "pitfalls": ["<≤40 char>", ...0-3],\n'
            '  "content_warnings": ["<tag>", ...0-3],\n'
            '  "narrator_gender": "<male | female | unknown — the gender of the first-person narrator, inferred from self-tags like (27F), relationships mentioned (my wife, my husband), or pronouns>",\n'
            '  "reason": "<≤140 char verdict>"\n'
            "}\n\n"
            + "\n\n".join(items)
            + "\n\nReturn ONLY the JSON object, no markdown."
        )

    sem = asyncio.Semaphore(concurrency)

    async def _score_batch(batch: list[dict]):
        async with sem:
            prompt = _build_batch_prompt(batch)
            try:
                raw = await asyncio.to_thread(_call_ai, provider, api_key, prompt, system, model, ollama_url)
                if not raw:
                    for p in batch:
                        out[p.get("id") or ""] = _heuristic(p)
                    return
                s = raw.strip()
                if s.startswith("```"):
                    s = s.split("```")[1]
                    if s.startswith("json"):
                        s = s[4:]
                    s = s.strip("`").strip()
                start = s.find("{"); end = s.rfind("}")
                if start < 0 or end <= start:
                    raise ValueError("no JSON object in response")
                parsed = json.loads(s[start:end + 1])
                results = parsed.get("results") or []
                by_id = {}
                for r in results:
                    rid = str(r.get("id") or "").strip()
                    if rid:
                        by_id[rid] = r

                for i, post in enumerate(batch):
                    pid = post.get("id") or ""
                    # Prefer match by id, fall back to positional match.
                    r = by_id.get(pid) or (results[i] if i < len(results) else None)
                    if not r:
                        out[pid] = _heuristic(post)
                        continue
                    result = _normalize_result(r, post)
                    out[pid] = result
                    _persist_cache(pid, post, result)
            except Exception as e:
                _log(f"Viral score batch failed ({len(batch)} posts): {e}")
                for p in batch:
                    out[p.get("id") or ""] = _heuristic(p)

    batches = [to_score[i:i + batch_size] for i in range(0, len(to_score), batch_size)]
    _log(f"AI score: {len(to_score)} posts → {len(batches)} batches (provider={provider}, batch={batch_size}, concurrency={concurrency})")
    await asyncio.gather(*[_score_batch(b) for b in batches])
    return {"scores": out}


@app.get("/api/posts/{post_id}/narrator-gender")
async def get_narrator_gender(post_id: str):
    """
    Inspect a post (title + body) and guess the narrator's gender.
    Returns { detected: 'male' | 'female' | null, source: 'title'|'body'|null }.
    """
    from narrator_gender import detect_narrator_gender as _detect
    summary_path = os.path.join(PROJECT_ROOT, "posts", post_id, "summary.json")
    title = ""
    body = ""
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            title = data.get("title", "") or ""
            body  = data.get("selftext", "") or ""
        except Exception:
            pass
    else:
        # Post hasn't been fetched yet — try live from Reddit via RedditStoryMaker.
        try:
            maker = RedditStoryMaker()
            post = maker.fetch_post_by_id(post_id) if hasattr(maker, "fetch_post_by_id") else None
            if post:
                title = post.get("title", "") or ""
                body  = post.get("selftext", "") or ""
        except Exception:
            pass
    return {"detected": _detect(title, body), "title": title[:200]}


def _resolve_voice(provider: str, config: dict, narrator_gender: Optional[str],
                   voice_override: Optional[str]) -> str:
    """
    Resolve the main narrator voice to use for this run.
    Priority: voice_override > gendered preset > tts.main_voice.
    """
    tts_cfg = config.get("tts", {}) or {}
    if voice_override:
        return voice_override
    presets = tts_cfg.get("voice_presets", {}) or {}
    provider_presets = presets.get(provider, {}) or {}
    if narrator_gender in ("male", "female"):
        v = provider_presets.get(narrator_gender)
        if v:
            return v
    return tts_cfg.get("main_voice", "")


@app.get("/api/fonts")
async def list_fonts():
    """
    Enumerate installed system font files (.ttf/.otf) so the web UI can
    offer a dropdown. Best-effort: reads family name from the font when
    possible, falls back to filename.
    """
    import platform, glob as _glob

    search_dirs: list[str] = []
    system = platform.system()
    home = os.path.expanduser("~")
    if system == "Windows":
        search_dirs += [
            os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts"),
            os.path.join(os.environ.get("LOCALAPPDATA", home), "Microsoft", "Windows", "Fonts"),
        ]
    elif system == "Darwin":
        search_dirs += ["/Library/Fonts", "/System/Library/Fonts", os.path.join(home, "Library/Fonts")]
    else:
        search_dirs += ["/usr/share/fonts", "/usr/local/share/fonts", os.path.join(home, ".fonts"), os.path.join(home, ".local/share/fonts")]

    try:
        from PIL import ImageFont
    except Exception:
        ImageFont = None  # type: ignore

    seen_files: set[str] = set()
    fonts = []
    for d in search_dirs:
        if not d or not os.path.isdir(d):
            continue
        for ext in ("*.ttf", "*.otf", "*.ttc"):
            for path in _glob.glob(os.path.join(d, "**", ext), recursive=True):
                real = os.path.realpath(path)
                if real in seen_files:
                    continue
                seen_files.add(real)
                file_name = os.path.basename(path)
                family = None
                style = None
                if ImageFont is not None:
                    try:
                        name = ImageFont.truetype(path, 12).getname()
                        family = name[0] if name and len(name) > 0 else None
                        style = name[1] if name and len(name) > 1 else None
                    except Exception:
                        pass
                if not family:
                    family = os.path.splitext(file_name)[0].replace("_", " ").replace("-", " ").title()
                fonts.append({
                    "family": family,
                    "style": style or "",
                    "file": file_name,
                    "path": path,
                })

    # Sort by family then style, dedupe by (family, style) keeping shortest path.
    fonts.sort(key=lambda f: (f["family"].lower(), f["style"].lower(), len(f["path"])))
    dedup: dict[tuple, dict] = {}
    for f in fonts:
        key = (f["family"].lower(), f["style"].lower())
        if key not in dedup:
            dedup[key] = f
    return {"fonts": list(dedup.values())}


@app.get("/api/tts/providers")
async def tts_providers():
    """List available TTS providers and their install status."""
    return {
        "providers": [
            {
                "id": "streamlabs_polly",
                "name": "Streamlabs Polly",
                "type": "cloud",
                "installed": True,
                "details": "Free, no setup required",
                "voices": ["Brian", "Amy", "Emma", "Joanna", "Matthew", "Joey", "Justin", "Kendra", "Kimberly", "Salli"],
            },
            {
                "id": "lazypy_tiktok",
                "name": "TikTok (LazyPy)",
                "type": "cloud",
                "installed": True,
                "details": "Free TikTok voices via lazypy.ro, no setup required",
                "voices": LazyPyTikTokTTS.AVAILABLE_VOICES,
            },
            {
                "id": "elevenlabs",
                "name": "ElevenLabs",
                "type": "cloud",
                "installed": True,
                "details": "Premium realistic voices. Requires an API key from elevenlabs.io.",
                "voices": list(__import__("tts_engine").ElevenLabsTTS.PRESET_VOICES.keys()),
                "requires_api_key": True,
                "models": [
                    {"id": "eleven_multilingual_v2", "name": "Multilingual v2 (best quality)"},
                    {"id": "eleven_turbo_v2_5",     "name": "Turbo v2.5 (fast, low latency)"},
                    {"id": "eleven_monolingual_v1", "name": "Monolingual v1 (English only, classic)"},
                ],
            },
            {
                "id": "vibevoice",
                "name": "Microsoft VibeVoice",
                "type": "local",
                **check_vibevoice(),
                "voices": VibeVoiceTTS.get_available_voices(),
                "voices_detailed": discover_vibevoice_voices(),
                "models": [
                    {"id": k, **{mk: mv for mk, mv in v.items() if mk != "hf_id"}}
                    for k, v in VIBEVOICE_MODELS.items()
                ],
            },
            {
                "id": "qwen3_tts",
                "name": "Qwen3 TTS",
                "type": "local",
                **check_qwen3tts(),
                "voices": Qwen3TTS.AVAILABLE_VOICES,
                "models": [
                    {"id": k, **{mk: mv for mk, mv in v.items() if mk != "hf_id"}}
                    for k, v in QWEN3_TTS_MODELS.items()
                ],
            },
        ]
    }


# ────────────────────────────────────────────────────────────────────
# Text Posts — tweets, community posts, Reddit comments, LinkedIn, etc.
# Shares content_filter / tone / target_audience with the video pipeline
# but produces raw text and is persisted separately in text_posts.json.
# ────────────────────────────────────────────────────────────────────

from html.parser import HTMLParser as _HTMLParser


class _ReadableTextParser(_HTMLParser):
    """
    Minimal HTML-to-readable-text extractor using only the stdlib.
    Not as smart as readability-lxml but enough for news articles and
    blog posts — user can always paste text manually if a site defeats it.
    """
    _BLOCK_TAGS = {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "blockquote"}
    _SKIP_CONTAINERS = {"script", "style", "noscript", "svg", "head", "header", "footer", "nav", "aside", "form"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._parts: List[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in self._SKIP_CONTAINERS:
            self._skip_depth += 1
            return
        if t in self._BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self._SKIP_CONTAINERS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        self._parts.append(data)

    def extract(self) -> str:
        raw = "".join(self._parts)
        # Collapse whitespace within lines, preserve paragraph breaks
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw.split("\n")]
        nonblank = [ln for ln in lines if ln]
        return "\n\n".join(nonblank)


def _text_posts_generator(config: dict):
    # Lazy import so circular/early-import issues don't block app startup
    from text_post_generator import TextPostGenerator
    return TextPostGenerator(config)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_post_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    # Small random suffix to avoid collisions when the UI fires two requests in the same second
    suffix = f"{time.time_ns() % 100000:05d}"
    return f"tp_{ts}_{suffix}"


@app.get("/api/text-posts/formats")
async def text_posts_formats():
    """List supported post formats and their default char limits."""
    from text_post_generator import get_available_formats, get_available_tones
    return {"formats": get_available_formats(), "tones": get_available_tones()}


@app.post("/api/text-posts/generate")
async def text_posts_generate(req: dict = {}):
    """
    Generate a fresh text post. Does NOT persist — the frontend calls
    /api/text-posts (POST) after the user decides to save.
    """
    config = _load_config()
    if not config.get("gemini", {}).get("enabled", False):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    fmt_key = (req.get("format") or "tweet").strip()
    topic = (req.get("topic") or "").strip() or None
    source_material = (req.get("source_material") or "").strip() or None
    brand_voice = (req.get("brand_voice") or "").strip() or None

    tp_cfg = config.get("text_posts", {}) or {}
    content_filter = (req.get("content_filter") or tp_cfg.get("content_filter_default") or "normal").strip().lower()
    if content_filter not in ("safe", "normal", "edgy"):
        content_filter = "normal"
    target_audience = (req.get("target_audience") or tp_cfg.get("target_audience_default") or "").strip() or None

    from text_post_generator import VALID_TONES
    tone = (req.get("tone") or tp_cfg.get("tone_default") or "professional").strip().lower()
    if tone not in VALID_TONES:
        tone = "professional"

    char_limit = req.get("char_limit")
    if isinstance(char_limit, str):
        try:
            char_limit = int(char_limit)
        except ValueError:
            char_limit = None
    if not isinstance(char_limit, int) or char_limit <= 0:
        char_limit = None

    generator = _text_posts_generator(config)
    try:
        text = await asyncio.to_thread(
            generator.generate, fmt_key, topic, content_filter, target_audience, tone,
            char_limit, source_material, brand_voice,
        )
    except Exception as e:
        _log(f"[text-posts] generate failed: {e}")
        raise HTTPException(502, f"AI generation failed: {e}")

    if not text:
        raise HTTPException(502, "AI returned empty content after retries.")

    return {
        "text": text,
        "format": fmt_key,
        "filter": content_filter,
        "tone": tone,
        "target_audience": target_audience or "",
        "char_limit": char_limit,
    }


@app.post("/api/text-posts/generate-variants")
async def text_posts_generate_variants(req: dict = {}):
    """
    Generate N candidate variants in parallel. UI uses this to let the user
    pick the best of N before committing to a draft.
    """
    config = _load_config()
    if not config.get("gemini", {}).get("enabled", False):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    fmt_key = (req.get("format") or "tweet").strip()
    topic = (req.get("topic") or "").strip() or None
    source_material = (req.get("source_material") or "").strip() or None
    brand_voice = (req.get("brand_voice") or "").strip() or None

    tp_cfg = config.get("text_posts", {}) or {}
    content_filter = (req.get("content_filter") or tp_cfg.get("content_filter_default") or "normal").strip().lower()
    if content_filter not in ("safe", "normal", "edgy"):
        content_filter = "normal"
    target_audience = (req.get("target_audience") or tp_cfg.get("target_audience_default") or "").strip() or None

    from text_post_generator import VALID_TONES
    tone = (req.get("tone") or tp_cfg.get("tone_default") or "professional").strip().lower()
    if tone not in VALID_TONES:
        tone = "professional"

    char_limit = req.get("char_limit")
    if isinstance(char_limit, str):
        try:
            char_limit = int(char_limit)
        except ValueError:
            char_limit = None
    if not isinstance(char_limit, int) or char_limit <= 0:
        char_limit = None

    try:
        count = max(1, min(5, int(req.get("count", 3))))
    except (TypeError, ValueError):
        count = 3

    generator = _text_posts_generator(config)

    def _one():
        return generator.generate(
            fmt_key, topic, content_filter, target_audience, tone,
            char_limit, source_material, brand_voice,
        )

    tasks = [asyncio.to_thread(_one) for _ in range(count)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    variants: list[str] = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            _log(f"[text-posts] variant {i+1} raised: {r}")
            continue
        if r:
            variants.append(r)

    if not variants:
        raise HTTPException(502, "All variants failed to generate. Check AI provider logs.")

    return {"variants": variants, "count": len(variants)}


@app.post("/api/text-posts/rewrite")
async def text_posts_rewrite(req: dict = {}):
    """Rewrite an existing post given a feedback instruction."""
    config = _load_config()
    if not config.get("gemini", {}).get("enabled", False):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    original = (req.get("original") or "").strip()
    instruction = (req.get("instruction") or "").strip()
    if not original:
        raise HTTPException(400, "Field 'original' is required.")
    if not instruction:
        raise HTTPException(400, "Field 'instruction' is required.")

    fmt_key = (req.get("format") or "tweet").strip()
    source_material = (req.get("source_material") or "").strip() or None
    brand_voice = (req.get("brand_voice") or "").strip() or None

    tp_cfg = config.get("text_posts", {}) or {}
    content_filter = (req.get("content_filter") or tp_cfg.get("content_filter_default") or "normal").strip().lower()
    if content_filter not in ("safe", "normal", "edgy"):
        content_filter = "normal"
    target_audience = (req.get("target_audience") or "").strip() or None

    from text_post_generator import VALID_TONES
    tone = (req.get("tone") or "professional").strip().lower()
    if tone not in VALID_TONES:
        tone = "professional"

    char_limit = req.get("char_limit")
    if isinstance(char_limit, str):
        try:
            char_limit = int(char_limit)
        except ValueError:
            char_limit = None
    if not isinstance(char_limit, int) or char_limit <= 0:
        char_limit = None

    generator = _text_posts_generator(config)
    try:
        new_text = await asyncio.to_thread(
            generator.rewrite, fmt_key, original, instruction,
            content_filter, target_audience, tone, char_limit, source_material, brand_voice,
        )
    except Exception as e:
        _log(f"[text-posts] rewrite failed: {e}")
        raise HTTPException(502, f"AI rewrite failed: {e}")

    if not new_text:
        raise HTTPException(502, "AI returned empty content after retries.")

    return {"text": new_text}


@app.get("/api/text-posts")
async def text_posts_list():
    import text_posts_db
    posts = text_posts_db.load_posts(PROJECT_ROOT)
    # Newest first
    return {"posts": sorted(posts, key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)}


@app.get("/api/text-posts/{post_id}")
async def text_posts_get(post_id: str):
    import text_posts_db
    post = text_posts_db.find(PROJECT_ROOT, post_id)
    if not post:
        raise HTTPException(404, "Not found")
    return post


@app.post("/api/text-posts")
async def text_posts_save(req: dict = {}):
    """
    Save or update a post. If `id` is absent a new one is minted.
    When the body text differs from the stored `current`, a new revision
    is appended with the supplied `instruction` (may be empty).
    """
    import text_posts_db

    text = (req.get("text") or req.get("current") or "").strip()
    if not text:
        raise HTTPException(400, "Field 'text' is required.")

    pid = (req.get("id") or "").strip()
    now = _now_iso()

    if pid:
        existing = text_posts_db.find(PROJECT_ROOT, pid)
    else:
        existing = None
        pid = _new_post_id()

    if existing:
        # Preserve history, append revision if text changed
        post = dict(existing)
        if post.get("current") != text:
            post.setdefault("revisions", []).append({
                "text": post.get("current", ""),
                "instruction": req.get("instruction") or None,
                "at": now,
            })
        post["current"] = text
        post["updated_at"] = now
    else:
        post = {
            "id": pid,
            "created_at": now,
            "updated_at": now,
            "revisions": [],
            "current": text,
        }

    # Shallow-copy whichever metadata fields the caller supplied
    for field in ("format", "filter", "tone", "target_audience", "topic", "source_material", "char_limit"):
        if field in req:
            post[field] = req.get(field)

    text_posts_db.upsert(PROJECT_ROOT, post)
    return {"post": post}


@app.delete("/api/text-posts/{post_id}")
async def text_posts_delete(post_id: str):
    import text_posts_db
    removed = text_posts_db.remove(PROJECT_ROOT, post_id)
    if not removed:
        raise HTTPException(404, "Not found")
    return {"deleted": True, "id": post_id}


@app.post("/api/text-posts/fetch-url")
async def text_posts_fetch_url(req: dict = {}):
    """
    Fetch a URL and return readable text content. Used to ground posts in
    news articles without the user having to copy/paste the body.
    """
    import requests as _rq
    url = (req.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "Field 'url' is required.")
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(400, "URL must start with http:// or https://")

    try:
        resp = _rq.get(
            url, timeout=12,
            headers={
                # Some sites 403 default python-requests; pretend to be a browser.
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
    except Exception as e:
        raise HTTPException(502, f"Fetch failed: {e}")

    if resp.status_code >= 400:
        raise HTTPException(502, f"Fetch returned HTTP {resp.status_code}")

    ctype = resp.headers.get("content-type", "")
    if "html" not in ctype.lower() and "xml" not in ctype.lower():
        # Plain text / markdown — just return it as-is (capped)
        return {"url": url, "title": "", "text": resp.text[:20000]}

    html = resp.text
    # Title extraction (cheap)
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else ""

    parser = _ReadableTextParser()
    try:
        parser.feed(html)
    except Exception as e:
        raise HTTPException(502, f"HTML parse failed: {e}")

    text = parser.extract()[:20000]
    if not text.strip():
        raise HTTPException(502, "No readable text extracted. Paste the article content manually.")
    return {"url": url, "title": title, "text": text}


@app.get("/", include_in_schema=False)
async def frontend_index():
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    raise HTTPException(404, "Frontend build not found. Run pnpm build to create dist or place frontend_dist next to the executable.")


@app.get("/{full_path:path}", include_in_schema=False)
async def frontend_catch_all(full_path: str):
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    raise HTTPException(404, "Frontend build not found. Run pnpm build to create dist or place frontend_dist next to the executable.")


if __name__ == "__main__":
    import uvicorn
    import webbrowser

    url = "http://127.0.0.1:8000"
    webbrowser.open(url)
    uvicorn.run(app, host="127.0.0.1", port=8000)


@app.post("/api/tts/install/{provider_id}")
async def install_tts_provider(provider_id: str):
    """Install a local TTS provider."""
    _log(f"Installing TTS provider: {provider_id}")
    if provider_id == "vibevoice":
        result = await asyncio.to_thread(install_vibevoice)
    elif provider_id == "qwen3_tts":
        result = await asyncio.to_thread(install_qwen3tts)
    else:
        raise HTTPException(400, f"Unknown provider: {provider_id}")
    
    if result["success"]:
        _log(f"TTS provider {provider_id} installed successfully")
    else:
        _log(f"TTS provider {provider_id} install failed: {result.get('error', 'unknown')}")
    return result


@app.get("/api/tts/check/{provider_id}")
async def check_tts_provider(provider_id: str):
    """Check install status of a specific TTS provider."""
    if provider_id == "vibevoice":
        return check_vibevoice()
    elif provider_id == "qwen3_tts":
        return check_qwen3tts()
    elif provider_id == "streamlabs_polly":
        return {"installed": True, "details": "Always available"}
    elif provider_id == "lazypy_tiktok":
        return {"installed": True, "details": "Free TikTok voices via lazypy.ro"}
    else:
        raise HTTPException(400, f"Unknown provider: {provider_id}")

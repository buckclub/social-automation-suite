"""
YouTube source ingestion for the Clip Maker — all yt-dlp contact points
live here so the rest of the app never has to know about that library's
quirks.

Two use cases:

  1. fetch_metadata(url)          — cheap; used BEFORE the user commits
     to pulling the whole video. Returns title, duration, uploader, plus
     a hint on whether auto-captions are available in English (so we can
     skip whisper later and save a ton of time).

  2. download(url, dest_path, *)  — actual download + auto-caption file
     (VTT) written alongside. Respects `max_duration_s` so a user can't
     accidentally queue a 3-hour stream.

  3. parse_vtt_to_segments(path)  — cheap VTT → [{start, end, text}]
     converter used whether the VTT came from YouTube auto-captions or
     a whisper pass.

Network errors, DRM-locked videos, and "duration too long" all raise
IngestError with a user-readable message — never a raw yt-dlp trace.
"""
from __future__ import annotations
import os
import re
from typing import Optional


class IngestError(Exception):
    pass


# ── Metadata probe ─────────────────────────────────────────────────

def fetch_metadata(url: str) -> dict:
    """
    Return:
      { title, duration_s, uploader, thumbnail, has_en_captions }
    Raises IngestError on anything unhandled.
    """
    try:
        import yt_dlp
    except ImportError as e:
        raise IngestError(
            "yt-dlp isn't installed. `pip install yt-dlp` in the venv."
        ) from e

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": False,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise IngestError(f"Could not probe source: {e}")

    auto = info.get("automatic_captions") or {}
    manual = info.get("subtitles") or {}
    has_en = any(lang.startswith("en") for lang in auto) or any(
        lang.startswith("en") for lang in manual
    )

    return {
        "title":            info.get("title") or "",
        "duration_s":       int(info.get("duration") or 0),
        "uploader":         info.get("uploader") or info.get("channel") or "",
        "thumbnail":        info.get("thumbnail") or "",
        "has_en_captions":  has_en,
        "manual_en":        any(lang.startswith("en") for lang in manual),
        "webpage_url":      info.get("webpage_url") or url,
    }


# ── Download ───────────────────────────────────────────────────────

def download(
    url: str,
    dest_video_path: str,
    *,
    max_duration_s: int = 3600,
    max_height: int = 720,
    prefer_auto_captions: bool = True,
    progress_hook=None,
) -> dict:
    """
    Download the video to `dest_video_path` (extension will be adjusted
    to match the container yt-dlp picked). Also attempts to write the
    English auto-caption VTT alongside it as `<path>.en.vtt`.

    Returns:
        {
          "video_path":      "<resolved path>",
          "duration_s":      float,
          "title":           str,
          "thumbnail":       "<thumbnail url>",
          "caption_vtt_path": "<path>" | None,
          "caption_source":  "manual" | "automatic" | None,
        }
    """
    try:
        import yt_dlp
    except ImportError as e:
        raise IngestError("yt-dlp isn't installed.") from e

    # yt-dlp adds the real extension itself unless we pin it. Pin to .mp4
    # via merge_output_format so FFmpeg always gets a predictable container.
    dest_base, _ = os.path.splitext(dest_video_path)

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "outtmpl": dest_base + ".%(ext)s",
        "format": (
            f"bestvideo[height<={max_height}][ext=mp4]+bestaudio[ext=m4a]/"
            f"best[height<={max_height}]/best"
        ),
        "merge_output_format": "mp4",
        "writeautomaticsub":   prefer_auto_captions,
        "writesubtitles":      True,   # prefer manual if available
        "subtitleslangs":      ["en", "en-US", "en-GB"],
        "subtitlesformat":     "vtt",
    }
    if progress_hook:
        opts["progress_hooks"] = [progress_hook]

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            dur = int(info.get("duration") or 0)
            if dur and dur > max_duration_s:
                raise IngestError(
                    f"Source is {dur // 60}m — longer than the {max_duration_s // 60}m "
                    "limit. Bump clipmaker.max_duration_s in config.json to allow it."
                )
            # Now actually download.
            ydl.download([url])
    except IngestError:
        raise
    except Exception as e:
        raise IngestError(f"Download failed: {e}")

    # Resolve the real video + caption paths yt-dlp wrote.
    video_path = None
    for ext in ("mp4", "mkv", "webm", "mov"):
        candidate = f"{dest_base}.{ext}"
        if os.path.isfile(candidate):
            video_path = candidate
            break
    if not video_path:
        raise IngestError("Download finished but no video file on disk")

    caption_path: Optional[str] = None
    caption_source: Optional[str] = None
    for lang in ("en", "en-US", "en-GB"):
        p_manual = f"{dest_base}.{lang}.vtt"
        if os.path.isfile(p_manual):
            caption_path = p_manual
            # Figure out whether this was manual or automatic.
            caption_source = "manual" if (info.get("subtitles") or {}).get(lang) else "automatic"
            break

    return {
        "video_path":       video_path,
        "duration_s":       int(info.get("duration") or 0),
        "title":            info.get("title") or "",
        "thumbnail":        info.get("thumbnail") or "",
        "caption_vtt_path": caption_path,
        "caption_source":   caption_source,
    }


# ── VTT parsing ────────────────────────────────────────────────────

_VTT_TIME = re.compile(
    r"(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})"
)


def _parse_time(s: str) -> float:
    m = _VTT_TIME.search(s)
    if not m:
        return 0.0
    h = int(m.group(1) or 0)
    mi = int(m.group(2))
    sec = int(m.group(3))
    ms = int(m.group(4))
    return h * 3600 + mi * 60 + sec + ms / 1000


def parse_vtt_to_segments(path: str) -> list[dict]:
    """
    Convert a WebVTT file into a flat list of {start, end, text} dicts.
    Auto-captions from YouTube are chunked into 1-2s sliding windows
    with heavy duplication (each word shows up in 2-3 cues). We dedupe
    by taking the last occurrence of each cue's text.
    """
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except Exception:
        return []

    # Strip WEBVTT header + STYLE blocks, split on blank lines.
    blocks = raw.split("\n\n")
    segments: list[dict] = []
    seen_lines: set[str] = set()   # dedupe by exact text line

    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip() and not ln.startswith(("WEBVTT", "NOTE", "STYLE", "X-TIMESTAMP"))]
        if not lines:
            continue
        # Find a line with -->
        time_line = next((ln for ln in lines if "-->" in ln), None)
        if not time_line:
            continue
        parts = time_line.split("-->")
        if len(parts) < 2:
            continue
        try:
            start = _parse_time(parts[0].strip())
            end   = _parse_time(parts[1].strip().split()[0])
        except Exception:
            continue
        text_lines = [ln for ln in lines if "-->" not in ln and not ln.strip().isdigit()]
        text = " ".join(text_lines).strip()
        # Strip YT's inline <c> tags and timing codes.
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"&nbsp;", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text in seen_lines:
            continue
        seen_lines.add(text)
        segments.append({"start": start, "end": end, "text": text})

    # Merge contiguous near-identical cues (YT rolls words forward across
    # each 1s window, producing duplicate partials we already deduped above).
    return segments

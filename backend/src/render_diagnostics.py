"""
Render-failure diagnostics.

When the pipeline crashes, the user gets `pipeline_state["error"] =
str(e)` — a one-liner like "ffmpeg returned 1" with no actionable
information. This module turns that string (plus optional ffmpeg
stderr) into a structured diagnosis:

    {
      "category":    "ffmpeg_codec_missing",
      "recoverable": False,
      "title":       "Missing audio codec",
      "hint":        "ffmpeg can't encode 'libfdk_aac' on your build...",
      "raw_excerpt": "<first 600 chars of the actual error>"
    }

Categories try to be the smallest set that drives different *user
actions*:

  ffmpeg_oom              kill -9 / 137 / 'killed' — likely RAM
  ffmpeg_codec_missing    "Unknown encoder" / "Codec not found"
  ffmpeg_corrupt_input    "Invalid data" / "moov atom not found"
  ffmpeg_no_input         "No such file or directory" referencing media
  font_missing            "Could not load font" / "FT_New_Face failed"
  disk_full               "No space left on device" / errno 28
  network_timeout         requests.Timeout / asyncio.TimeoutError / "timed out"
  network_5xx             5xx HTTP statuses bubbling up from providers
  api_quota               "quota exceeded" / 429 / quota-related strings
  api_auth                401 / 403 / "invalid key" / "API key not"
  cancelled               user pressed cancel
  generic                 fallback

`recoverable=True` means the orchestrator MAY retry once after a short
backoff (network blips, transient 5xx). Codec / font / OOM / disk
errors are recoverable=False — retrying would just burn another minute
on the same outcome.

Designed to be imported by api_server's pipeline error handler. Has no
side effects beyond reading the strings handed to it.
"""
from __future__ import annotations

import re
from typing import Optional


# Each rule: (category, title, hint, recoverable, regex)
# Order matters — the first matching rule wins, so put more specific
# patterns above their generic counterparts.
_RULES: list[tuple[str, str, str, bool, re.Pattern[str]]] = [
    ("cancelled", "Cancelled by user",
     "The render was stopped from the UI. Nothing to fix.",
     False,
     re.compile(r"\bcancel(led|ed)\b|asyncio\.cancellederror", re.I)),

    # Silent video-render failure: ffmpeg produced no output and
    # the inline retry also returned None. Recoverable because
    # the audio + timeline are still cached on disk and a Resume
    # against them frequently succeeds (different ffmpeg process,
    # avoids whatever transient state caused the first attempt).
    # The pipeline auto-resume path uses this classification.
    ("video_silent_failure", "Video render produced no output",
     "Both render attempts returned no video file. Cached audio + "
     "timeline are intact, auto-retrying as a Resume.",
     True,
     re.compile(r"video.*render.*produced no output|render.*returned.*no video", re.I)),

    ("ffmpeg_oom", "Out of memory",
     "ffmpeg ran out of RAM. Try shorter clips, lower resolution "
     "(720p instead of 1080p), or close other apps before rendering.",
     False,
     re.compile(r"\b(killed|oom|out of memory|signal 9|exit code 137)\b", re.I)),

    ("ffmpeg_codec_missing", "Missing codec",
     "Your ffmpeg build doesn't include the codec the renderer asked for. "
     "Install a full ffmpeg (e.g. the 'essentials' build on Windows, or "
     "`apt install ffmpeg` on Linux) and restart the server.",
     False,
     re.compile(r"unknown encoder|codec not found|encoder not found|no such codec",
                re.I)),

    ("ffmpeg_corrupt_input", "Corrupt input file",
     "ffmpeg couldn't decode one of the input files (background, audio "
     "segment, etc). Re-fetch the post or re-encode the offending file.",
     False,
     re.compile(r"invalid data found|moov atom not found|invalid argument.*demux",
                re.I)),

    ("ffmpeg_no_input", "Missing media file",
     "An input file expected by the render is missing on disk — most "
     "commonly an audio segment that got cleaned up too early. Try "
     "re-rendering from scratch (not Resume).",
     False,
     re.compile(r"no such file or directory.*\.(mp3|wav|mp4|m4a|webm|jpg|png)",
                re.I)),

    ("font_missing", "Font not available",
     "The configured caption / overlay font isn't installed on this "
     "machine. Pick a different font in Config → Captions, or install "
     "the original.",
     False,
     re.compile(r"could not (open|find|load) font|ft_new_face|fontconfig.*not.*found",
                re.I)),

    ("disk_full", "Disk full",
     "The drive holding the project ran out of space mid-render. "
     "Clear out old renders in Videos → bulk delete, then try again.",
     False,
     re.compile(r"no space left on device|errno 28|disk full", re.I)),

    ("network_timeout", "Network timed out",
     "A provider call (TTS, AI, or media download) took too long. "
     "Often transient — retrying usually works.",
     True,
     re.compile(r"\btimeout\b|timed out|read timed out|connecttimeout|"
                r"asyncio\.timeouterror", re.I)),

    ("api_quota", "API quota exceeded",
     "The TTS / AI provider rejected the call because you're over your "
     "quota. Check usage on the provider's dashboard, or switch "
     "provider in Config → AI Hooks.",
     False,
     re.compile(r"quota.*exceed|rate.*limit|too many requests|429\b|"
                r"insufficient.*credit", re.I)),

    ("api_auth", "Invalid API key",
     "A provider rejected the API key as unauthorized. Re-paste the "
     "key in Config → AI Hooks (or Config → Voice).",
     False,
     re.compile(r"\b(401|403)\b|invalid api key|invalid_api_key|"
                r"api key not (valid|configured)|unauthorized", re.I)),

    ("network_5xx", "Provider error (5xx)",
     "The upstream provider returned a server error. Usually transient "
     "— retrying often works.",
     True,
     re.compile(r"\b50[0-9]\b|bad gateway|service unavailable|"
                r"internal server error", re.I)),
]


def classify(error_text: str, stderr: Optional[str] = None) -> dict:
    """
    Inspect the error message (and optional ffmpeg stderr) and return a
    structured diagnosis. Always returns a dict — falls back to
    `category="generic"` when no rule matches.

    `error_text` is what we surface to the user in the UI; it usually
    comes from `str(exception)`. `stderr` is the extra context from a
    subprocess call when available — we scan both bodies, since
    different details can land in each.
    """
    haystack = (error_text or "") + "\n" + (stderr or "")

    for cat, title, hint, recover, rx in _RULES:
        if rx.search(haystack):
            return {
                "category":    cat,
                "title":       title,
                "hint":        hint,
                "recoverable": recover,
                "raw_excerpt": _excerpt(haystack),
            }

    return {
        "category":    "generic",
        "title":       "Render failed",
        "hint":        "Check the run log for details. The bottom of the "
                       "log usually points at which step failed.",
        "recoverable": False,
        "raw_excerpt": _excerpt(haystack),
    }


def _excerpt(s: str, limit: int = 600) -> str:
    """Trim to the last `limit` chars — error tails tend to carry the
    most useful detail (subprocess.run dumps the entire ffmpeg log
    including the line that crashed)."""
    s = (s or "").strip()
    if len(s) <= limit:
        return s
    return "…" + s[-limit:]

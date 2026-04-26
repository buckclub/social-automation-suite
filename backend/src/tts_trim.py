"""
Post-synthesis silence trimming for TTS segments.

Most TTS providers leave 100-400 ms of leading/trailing silence on
every clip. Concatenating 30 segments of "title + body sentences +
comment lines" stacks that into 3-12 seconds of dead air across a
single render — wasted runtime that hurts watch-through.

This module trims leading + trailing silence per segment via ffmpeg's
`silenceremove` filter. Bounded so we never cut into actual speech
even when the clip starts soft (e.g. "uhhh" filler).

Toggled via config.tts.auto_trim_silences (default True). Can be
disabled per-render if a creator deliberately wants the breathing
room between segments.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import Optional


def trim_silence(
    audio_path: str,
    *,
    threshold_db: float = -40.0,
    head_max_s: float = 0.4,
    tail_max_s: float = 0.4,
    ffmpeg_exe: str = "ffmpeg",
) -> Optional[float]:
    """
    Trim leading + trailing silence on `audio_path` in-place.

    Bounds:
      - threshold_db: anything below this is "silence" (-40 dB is the
        sweet spot — quieter than speech but louder than typical mic
        noise floor).
      - head_max_s / tail_max_s: hard caps so we never strip more than
        N seconds even if the clip starts/ends with a long pause. This
        protects against cutting into a slow-speaking voice's first
        word ("...the thing is...") which can read as silence by the
        threshold check.

    Returns the new clip duration in seconds (using ffprobe), or None
    if anything failed. On failure the original file is preserved
    unchanged — silence trimming is a best-effort enhancement.
    """
    if not os.path.isfile(audio_path):
        return None
    try:
        # ffmpeg silenceremove syntax. start_periods=1 means trim only
        # the leading run of silence; same for stop_periods=1 on the
        # trailing side. The duration:* args bound how much silence
        # we keep — 0.05 s = a comfortable 50 ms of breathing room
        # so the clip doesn't start mid-syllable.
        with tempfile.NamedTemporaryFile(
            suffix=os.path.splitext(audio_path)[1] or ".mp3",
            delete=False,
        ) as tmp_f:
            tmp_path = tmp_f.name
        try:
            af = (
                f"silenceremove="
                f"start_periods=1:start_threshold={threshold_db}dB:start_silence=0.05:start_duration=0.05:"
                f"stop_periods=1:stop_threshold={threshold_db}dB:stop_silence=0.05:stop_duration=0.05"
            )
            cmd = [
                ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error",
                "-i", audio_path, "-af", af, tmp_path,
            ]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                return None
            if os.path.getsize(tmp_path) < 200:
                # Something went wrong — empty / corrupt output. Keep
                # the original.
                return None
            # Cap the amount we trimmed by checking duration delta. If
            # the trim ate more than head_max_s + tail_max_s combined,
            # something's off — abort and keep the original.
            orig_dur = _ffprobe_duration(audio_path, ffmpeg_exe)
            new_dur  = _ffprobe_duration(tmp_path, ffmpeg_exe)
            if orig_dur is None or new_dur is None:
                return None
            if (orig_dur - new_dur) > (head_max_s + tail_max_s) * 1.6:
                # Trimmed too aggressively — likely cut into speech.
                # Discard.
                return None
            shutil.move(tmp_path, audio_path)
            return new_dur
        finally:
            if os.path.isfile(tmp_path):
                try: os.remove(tmp_path)
                except OSError: pass
    except Exception:
        return None


def _ffprobe_duration(path: str, ffmpeg_exe: str = "ffmpeg") -> Optional[float]:
    """Cheap duration probe via ffprobe (sibling binary to ffmpeg)."""
    probe = ffmpeg_exe.replace("ffmpeg", "ffprobe")
    try:
        r = subprocess.run(
            [probe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            return None
        return float(r.stdout.strip())
    except Exception:
        return None

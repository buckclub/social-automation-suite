"""
Post-process TTS audio to apply a playback speed multiplier.

We time-stretch each generated clip with FFmpeg's `atempo` filter. The audio is
overwritten in place so the rest of the pipeline (timeline, whisper alignment,
video render) sees the already-adjusted durations, which keeps captions in sync.

atempo accepts 0.5..2.0 per instance — we chain up to two to cover 0.25..4.0.
"""
from __future__ import annotations
import os
import subprocess
import tempfile
from typing import Iterable


def _atempo_chain(speed: float) -> list[str]:
    """Return the ffmpeg `-af` value that represents `speed` using chained atempo."""
    filters: list[str] = []
    s = float(speed)
    while s > 2.0:
        filters.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        filters.append("atempo=0.5")
        s /= 0.5
    # Clamp the remaining factor to [0.5, 2.0]
    if s < 0.5:
        s = 0.5
    if s > 2.0:
        s = 2.0
    filters.append(f"atempo={s:.5f}")
    return filters


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


def adjust_speed(audio_paths: Iterable[str], speed: float) -> int:
    """
    Stretch each audio file at `audio_paths` by `speed`. Returns the number of
    files modified. No-ops if speed is ~1.0. Files are overwritten in place.
    """
    if not speed or abs(speed - 1.0) < 0.01:
        return 0
    filter_chain = ",".join(_atempo_chain(speed))
    ff = _ffmpeg_exe()
    changed = 0
    for path in audio_paths:
        if not path or not os.path.isfile(path):
            continue
        # Keep whatever container was used (mp3, wav, m4a).
        ext = os.path.splitext(path)[1].lower()
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp.close()
        try:
            cmd = [
                ff, "-y",
                "-hide_banner", "-loglevel", "error",
                "-i", path,
                "-af", filter_chain,
                "-vn",
                tmp.name,
            ]
            subprocess.run(cmd, check=True)
            # Replace original.
            os.replace(tmp.name, path)
            changed += 1
        except subprocess.CalledProcessError as e:
            print(f"⚠️  tts_speed: ffmpeg failed on {os.path.basename(path)}: {e}")
            try: os.remove(tmp.name)
            except Exception: pass
        except Exception as e:
            print(f"⚠️  tts_speed: error on {os.path.basename(path)}: {e}")
            try: os.remove(tmp.name)
            except Exception: pass
    return changed

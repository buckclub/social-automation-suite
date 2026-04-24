"""
Heuristic signals for clip detection.

These produce candidate timestamps the LLM can weight toward — not
final picks. They're cheap signals that work well on podcast / stream /
vlog content without requiring a vision model:

  * audio_energy(path) — peaks where the RMS volume spikes (laughter,
    shouting, dramatic beats usually hit here). 1-second windows.
  * scene_cuts(path)   — timestamps where the visual changes
    significantly (cuts, transitions, angle changes). Uses FFmpeg's
    built-in `select='gt(scene,...)'` filter so no vision model needed.

Both return a list of {time, score, kind} dicts sorted by time, where
`score` is a normalised 0..1 strength indicator. The caller decides
what to do with them — typically format as prompt hints and let the
LLM re-rank its candidate windows.

Never raises — on any error returns []. These are advisory signals, not
hard requirements.
"""
from __future__ import annotations
import math
import os
import re
import subprocess
import wave
from typing import Optional


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


# ── Audio energy (RMS peak detection) ───────────────────────────────

def audio_energy(source_path: str,
                 *,
                 window_s: float = 1.0,
                 top_n: int = 30,
                 min_gap_s: float = 8.0) -> list[dict]:
    """
    Extract the audio track as 16kHz mono PCM, compute RMS over
    `window_s`-second windows, and return the top `top_n` peaks
    (enforcing `min_gap_s` between adjacent picks so we don't just
    get 30 adjacent windows from one loud moment).

    Output: [{ time: float, score: 0..1, kind: "energy" }, ...]
    """
    if not source_path or not os.path.isfile(source_path):
        return []

    # We deliberately sidestep numpy/moviepy for this — a naive Python
    # RMS over shorts in `wave` is fast enough for 1-hour inputs and
    # doesn't risk pulling in ctranslate2 alloc issues.
    import tempfile
    tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_wav.close()
    try:
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vn",                   # no video
            "-ac", "1",              # mono
            "-ar", "16000",          # 16 kHz
            "-sample_fmt", "s16",
            tmp_wav.name,
        ]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            return []

        with wave.open(tmp_wav.name, "rb") as w:
            sr = w.getframerate()
            total_frames = w.getnframes()
            samples_per_window = max(1, int(sr * window_s))
            readings: list[float] = []

            # Stream-read the file, computing RMS per window. We use
            # array.array to parse int16 frames fast without numpy.
            import array
            pos = 0
            while pos < total_frames:
                frames = w.readframes(samples_per_window)
                if not frames:
                    break
                arr = array.array("h")
                arr.frombytes(frames)
                if not arr:
                    break
                # RMS = sqrt(mean(s^2))
                sq_sum = 0
                for s in arr:
                    sq_sum += s * s
                rms = math.sqrt(sq_sum / len(arr)) if arr else 0.0
                readings.append(rms)
                pos += samples_per_window

        if not readings:
            return []

        max_rms = max(readings) or 1.0
        candidates = [
            {"time": i * window_s, "score": r / max_rms, "kind": "energy"}
            for i, r in enumerate(readings)
        ]
        # Threshold and greedy-pick — always include the top peak,
        # then only add each next strongest if it's >=min_gap_s from
        # every already-picked time.
        candidates.sort(key=lambda c: c["score"], reverse=True)
        picked: list[dict] = []
        for c in candidates:
            if len(picked) >= top_n:
                break
            if any(abs(c["time"] - p["time"]) < min_gap_s for p in picked):
                continue
            picked.append(c)
        picked.sort(key=lambda c: c["time"])
        return picked
    finally:
        try: os.remove(tmp_wav.name)
        except OSError: pass


# ── Scene cuts (ffmpeg scene filter) ────────────────────────────────

# Line format from ffmpeg's showinfo/scenedetect:
# frame:N pts:N pts_time:T ... scene:X
# We use the simpler scenedetect approach via `select='gt(scene,X)'`
# + `showinfo`, then parse `pts_time=`.
_PTS_TIME = re.compile(r"pts_time:([\d.]+)")


def scene_cuts(source_path: str,
               *,
               threshold: float = 0.30,
               max_cuts: int = 200) -> list[dict]:
    """
    Run ffmpeg's scene-change detector and return cut timestamps.
    threshold is 0..1; 0.3 is a reasonable default (higher = fewer,
    more dramatic cuts; lower = more sensitive).

    Output: [{ time: float, score: 1.0, kind: "scene" }, ...]
    `score` is always 1.0 since ffmpeg only emits binary cut events.
    """
    if not source_path or not os.path.isfile(source_path):
        return []
    cmd = [
        _ffmpeg_exe(), "-hide_banner", "-nostats",
        "-i", source_path,
        "-filter:v", f"select='gt(scene,{threshold})',showinfo",
        "-f", "null", "-",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except Exception:
        return []
    # showinfo writes to stderr.
    out = r.stderr or ""
    times: list[float] = []
    for m in _PTS_TIME.finditer(out):
        try:
            times.append(float(m.group(1)))
        except ValueError:
            continue
    times.sort()
    cuts = [{"time": t, "score": 1.0, "kind": "scene"} for t in times[:max_cuts]]
    return cuts


# ── Formatting for the LLM prompt ─────────────────────────────────

def _fmt_hms(s: float) -> str:
    s = max(0, int(s))
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def build_hint_block(audio_peaks: list[dict], scene_cuts_list: list[dict],
                     *, max_audio: int = 15, max_scene: int = 20) -> str:
    """
    Convert raw signals into a compact text block the LLM can reason
    over. Returns "" if both lists are empty so the prompt stays tight.
    """
    if not audio_peaks and not scene_cuts_list:
        return ""
    lines = [
        "HEURISTIC SIGNALS — use these as hints to weight your picks, "
        "but prefer content quality over perfect alignment.",
    ]
    if audio_peaks:
        ranked = sorted(audio_peaks, key=lambda c: c["score"], reverse=True)[:max_audio]
        ranked.sort(key=lambda c: c["time"])
        lines.append("")
        lines.append(f"Audio-energy peaks (likely laughter / shouting / beats):")
        for c in ranked:
            lines.append(f"  · {_fmt_hms(c['time'])}  strength={c['score']:.2f}")
    if scene_cuts_list:
        cuts = scene_cuts_list[:max_scene]
        lines.append("")
        lines.append(f"Visual scene cuts (good natural in/out points):")
        # Tighten output: just the list of timestamps.
        lines.append("  " + ", ".join(_fmt_hms(c["time"]) for c in cuts))
    return "\n".join(lines)

"""
Heuristic signals for clip detection.

Two families of signals produced by this module:

A) LLM HINT SIGNALS — advisory, fed into `propose_clips` as a text hint
   block alongside the transcript. Used by the `ai_plus` / `ai_visual`
   modes. Cheap, never critical:

     * audio_energy(path)    — absolute top-N RMS peaks (1-s windows)
     * scene_cuts(path)      — FFmpeg scene-change timestamps

B) EVENT-DRIVEN DETECTORS — primary signals used by the `event_driven`
   mode (no transcript required). These power the "detect when a goal
   happens and clip the lead-up" workflow on silent/non-speech footage:

     * audio_transients(path)    — spikes over a rolling baseline
                                   (gunshots, horns, hit stingers)
     * color_flash(path)         — sudden luma / colour-balance jumps
                                   (muzzle flashes, damage flashes,
                                   goal-celebration colour bursts,
                                   explosions)
     * hud_delta(path, region)   — scene-change filter restricted to a
                                   cropped HUD region (kill feed,
                                   scoreboard tickers)

   + detect_events(path, cfg)    — fuses the above into a single ranked
                                   peak list with {time, score, kinds}
   + events_to_proposals(...)    — converts peaks into pre/post-roll
                                   clip windows, dedups, scores

All detectors return `{time, score, kind}` dicts (score 0..1). Everything
here swallows errors and returns [] on failure — these are advisory
signals, not hard requirements.
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


# ═══════════════════════════════════════════════════════════════════════
# Event-driven detectors — primary signals for the `event_driven` mode.
#
# These are designed for footage WITHOUT speech (gameplay, sports, music
# video, GoPro / dashcam, etc). Each detector returns peaks independently;
# `detect_events()` fuses them.
# ═══════════════════════════════════════════════════════════════════════


def audio_transients(source_path: str,
                     *,
                     window_s: float = 0.5,
                     baseline_windows: int = 10,
                     spike_ratio: float = 2.0,
                     top_n: int = 60,
                     min_gap_s: float = 5.0) -> list[dict]:
    """
    Find audio TRANSIENTS — short spikes over a rolling baseline. Unlike
    `audio_energy` (which returns the absolute loudest windows), this
    returns windows that JUMP above their local context. That's what
    distinguishes "a gunshot in an otherwise quiet room" from "the whole
    match has crowd noise." Much better for event detection.

    Algorithm:
      * Extract mono 16 kHz PCM.
      * Compute RMS over short windows (default 0.5 s).
      * Rolling baseline = median of the previous `baseline_windows`
        windows (default 10 = 5 s of context).
      * A window is a "transient" if its RMS >= baseline * spike_ratio.
      * Score = rms / (baseline * spike_ratio + epsilon), clamped 0..1.

    Output: [{ time, score 0..1, kind: "transient" }, ...]
    """
    if not source_path or not os.path.isfile(source_path):
        return []

    import array
    import tempfile
    tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_wav.close()
    try:
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
            tmp_wav.name,
        ]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            return []

        with wave.open(tmp_wav.name, "rb") as w:
            sr = w.getframerate()
            spw = max(1, int(sr * window_s))
            readings: list[float] = []
            while True:
                frames = w.readframes(spw)
                if not frames:
                    break
                arr = array.array("h"); arr.frombytes(frames)
                if not arr:
                    break
                sq = 0
                for s in arr:
                    sq += s * s
                readings.append(math.sqrt(sq / len(arr)))

        if len(readings) < baseline_windows + 2:
            return []

        # Rolling-median baseline. O(n*k) but k is small; plenty fast.
        def _median(xs: list[float]) -> float:
            s = sorted(xs)
            n = len(s)
            return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])

        candidates: list[dict] = []
        for i in range(baseline_windows, len(readings)):
            baseline = _median(readings[i - baseline_windows:i])
            if baseline < 1.0:
                baseline = 1.0  # avoid dividing by near-silence
            ratio = readings[i] / baseline
            if ratio < spike_ratio:
                continue
            # Score: how far above the spike threshold we went. Clamp at
            # 4x baseline == 1.0 so a single rare jet engine doesn't flatten
            # everything else.
            norm = max(0.0, min(1.0, (ratio - spike_ratio) / (4.0 - spike_ratio)))
            candidates.append({
                "time": round(i * window_s, 3),
                "score": round(norm, 3),
                "kind": "transient",
            })

        if not candidates:
            return []

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


def color_flash(source_path: str,
                *,
                fps: int = 5,
                top_n: int = 60,
                min_gap_s: float = 5.0,
                luma_jump: float = 40.0,
                chroma_jump: float = 35.0) -> list[dict]:
    """
    Detect sudden brightness or colour-balance changes — the visual
    signature of muzzle flashes, damage overlays (red tint), explosions
    (white-out), goal-celebration screens (saturated colour bursts).

    Implementation: ask FFmpeg to downscale each frame to a single pixel
    (`scale=1:1`) which averages the whole frame into one RGB triple,
    sampled at `fps` (default 5 fps = 200 ms resolution). Then we look
    at frame-to-frame deltas in luma (BT.601) and per-channel colour.

    No numpy — parses raw RGB bytes from stdout.
    """
    if not source_path or not os.path.isfile(source_path):
        return []

    import array
    cmd = [
        _ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
        "-i", source_path,
        "-vf", f"fps={fps},scale=1:1,format=rgb24",
        "-f", "rawvideo", "-",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=900)
    except Exception:
        return []
    if r.returncode != 0 or not r.stdout:
        return []

    buf = r.stdout
    # 3 bytes per frame (R, G, B)
    arr = array.array("B"); arr.frombytes(buf)
    n_frames = len(arr) // 3
    if n_frames < 3:
        return []

    # Pull per-frame (r, g, b, luma)
    frames = []
    for i in range(n_frames):
        R = arr[3 * i]; G = arr[3 * i + 1]; B = arr[3 * i + 2]
        Y = 0.299 * R + 0.587 * G + 0.114 * B
        frames.append((R, G, B, Y))

    # Event = |luma[i] - luma[i-1]| > luma_jump OR any channel delta > chroma_jump.
    # Use a 3-frame look-back median to suppress noise without requiring numpy.
    def _med3(idx: int, which: int) -> float:
        a = frames[max(0, idx - 1)][which]
        b = frames[max(0, idx - 2)][which]
        c = frames[max(0, idx - 3)][which]
        vs = sorted([a, b, c])
        return vs[1]

    candidates: list[dict] = []
    for i in range(3, n_frames):
        bY = _med3(i, 3)
        dY = abs(frames[i][3] - bY)
        bR = _med3(i, 0); bG = _med3(i, 1); bB = _med3(i, 2)
        dC = max(abs(frames[i][0] - bR),
                 abs(frames[i][1] - bG),
                 abs(frames[i][2] - bB))
        if dY < luma_jump and dC < chroma_jump:
            continue
        # Score: blend the two deltas, normalized. Cap at 1.0.
        norm = max(dY / (luma_jump * 3.0), dC / (chroma_jump * 3.0))
        norm = max(0.0, min(1.0, norm))
        candidates.append({
            "time": round(i / fps, 3),
            "score": round(norm, 3),
            "kind": "flash",
        })

    if not candidates:
        return []

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


def hud_delta(source_path: str,
              region: list[float] | tuple[float, float, float, float],
              *,
              threshold: float = 0.25,
              top_n: int = 80,
              min_gap_s: float = 3.0) -> list[dict]:
    """
    Run FFmpeg scene-change detection on a CROPPED region of the frame.
    The region is given as 0..1 fractions [x1, y1, x2, y2] (top-left to
    bottom-right). Typical uses:

      * Kill-feed corner in an FPS    — region = [0.70, 0.00, 1.00, 0.25]
      * Scoreboard ticker at the top  — region = [0.00, 0.00, 1.00, 0.08]
      * Minimap pop-up                — region = [0.75, 0.70, 1.00, 1.00]

    Every change inside that region produces a hit, so you'll get a peak
    exactly when the kill feed adds an entry / the score ticks up / etc.
    The cropped region is the ONLY part of the frame the filter sees, so
    a game-world scene cut or camera pan won't trigger false positives.
    """
    if not source_path or not os.path.isfile(source_path):
        return []
    if not region or len(region) != 4:
        return []
    x1, y1, x2, y2 = region
    if x2 <= x1 or y2 <= y1:
        return []
    # Fractional crop: iw/ih are the input dimensions; FFmpeg accepts
    # expressions inside crop=W:H:X:Y.
    w_expr = f"(iw*({x2 - x1:.4f}))"
    h_expr = f"(ih*({y2 - y1:.4f}))"
    x_expr = f"(iw*{x1:.4f})"
    y_expr = f"(ih*{y1:.4f})"
    vf = (
        f"crop={w_expr}:{h_expr}:{x_expr}:{y_expr},"
        f"select='gt(scene,{threshold})',showinfo"
    )
    cmd = [
        _ffmpeg_exe(), "-hide_banner", "-nostats",
        "-i", source_path,
        "-filter:v", vf,
        "-f", "null", "-",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except Exception:
        return []
    out = r.stderr or ""
    times: list[float] = []
    for m in _PTS_TIME.finditer(out):
        try:
            times.append(float(m.group(1)))
        except ValueError:
            continue
    times.sort()
    if not times:
        return []
    # Enforce min_gap.
    picked: list[float] = []
    for t in times:
        if picked and t - picked[-1] < min_gap_s:
            continue
        picked.append(t)
        if len(picked) >= top_n:
            break
    return [{"time": t, "score": 1.0, "kind": "hud"} for t in picked]


# ── Fusion + proposal building ─────────────────────────────────────

# How much each detector contributes to the fused peak score.
# Tweakable per-preset; these are sensible defaults.
DEFAULT_WEIGHTS = {
    "transient": 1.0,
    "flash":     0.7,
    "hud":       1.2,   # HUD events are semantically very precise
    "scene":     0.3,   # scene cuts are weak on their own
    "energy":    0.4,   # absolute energy is supportive, not decisive
    "yamnet":    1.5,   # class-specific acoustic match — very high signal
    "ref_sound": 1.6,   # exact-sound template match — highest confidence
}


def detect_events(source_path: str,
                  cfg: Optional[dict] = None) -> list[dict]:
    """
    Run the enabled event detectors and fuse their outputs into a single
    ranked peak list.

    cfg keys (all optional, defaults in DEFAULT_EVENT_CFG):
      use_audio_transients : bool
      use_color_flash      : bool
      hud_region           : [x1,y1,x2,y2] fractional or None
      bin_s                : float — time bucket for fusion (default 2.0)
      min_gap_s            : float — min gap between returned peaks
      top_n                : int   — how many peaks to keep
      weights              : dict  — override DEFAULT_WEIGHTS

    Output: [{ time, score, kinds: ["transient","flash",...] }, ...]
    sorted by time.
    """
    cfg = cfg or {}
    if not source_path or not os.path.isfile(source_path):
        return []

    weights = dict(DEFAULT_WEIGHTS)
    weights.update(cfg.get("weights") or {})
    bin_s = float(cfg.get("bin_s", 2.0))
    min_gap_s = float(cfg.get("min_gap_s", 8.0))
    top_n = int(cfg.get("top_n", 20))

    signals: list[dict] = []
    if cfg.get("use_audio_transients", True):
        try:
            signals.extend(audio_transients(source_path))
        except Exception as e:
            print(f"⚠️  audio_transients failed: {e}")
    if cfg.get("use_color_flash", True):
        try:
            signals.extend(color_flash(source_path))
        except Exception as e:
            print(f"⚠️  color_flash failed: {e}")
    region = cfg.get("hud_region")
    if region:
        try:
            signals.extend(hud_delta(source_path, region))
        except Exception as e:
            print(f"⚠️  hud_delta failed: {e}")
    if cfg.get("use_scene_cuts", False):
        try:
            signals.extend(scene_cuts(source_path))
        except Exception as e:
            print(f"⚠️  scene_cuts failed: {e}")
    if cfg.get("use_audio_energy", False):
        try:
            signals.extend(audio_energy(source_path))
        except Exception as e:
            print(f"⚠️  audio_energy failed: {e}")

    # YAMNet class-specific audio events (Layer 2). Optional runtime —
    # silently skipped if tflite-runtime / tensorflow isn't installed.
    yam_cfg = cfg.get("yamnet") or {}
    if yam_cfg.get("enabled"):
        try:
            from yamnet_detect import yamnet_detect, preset_classes, is_available
            if is_available():
                classes = list(yam_cfg.get("target_classes") or [])
                if not classes:
                    classes = preset_classes(yam_cfg.get("preset") or "general_action")
                yam_hits = yamnet_detect(
                    source_path,
                    classes,
                    min_confidence=float(yam_cfg.get("min_confidence", 0.25)),
                    top_n=int(yam_cfg.get("top_n", 60)),
                    min_gap_s=float(yam_cfg.get("min_gap_s", 3.0)),
                    model_path=yam_cfg.get("model_path") or None,
                    labels_path=yam_cfg.get("labels_path") or None,
                )
                signals.extend(yam_hits)
                if yam_hits:
                    print(f"   YAMNet: {len(yam_hits)} events on {len(set(classes))} classes")
        except Exception as e:
            print(f"⚠️  YAMNet failed: {e}")

    # Reference-sound template matches (Layer 3b).
    for ref in (cfg.get("reference_sounds") or []):
        rp = ref.get("path") if isinstance(ref, dict) else ref
        if not rp:
            continue
        try:
            hits = reference_sound_match(
                source_path, rp,
                min_ncc=float(ref.get("min_ncc", 0.5)) if isinstance(ref, dict) else 0.5,
                top_n=int(ref.get("top_n", 30)) if isinstance(ref, dict) else 30,
            )
            signals.extend(hits)
            if hits:
                print(f"   ref-sound '{os.path.basename(rp)}': {len(hits)} matches")
        except Exception as e:
            print(f"⚠️  reference_sound_match('{rp}') failed: {e}")

    if not signals:
        return []

    # Bin by time; fuse weighted scores; record which kinds hit.
    buckets: dict[int, dict] = {}
    for s in signals:
        t = float(s.get("time", 0))
        sc = float(s.get("score", 0))
        k = s.get("kind", "")
        w = weights.get(k, 0.5)
        b = int(t // bin_s)
        bucket = buckets.setdefault(b, {
            "time": b * bin_s + bin_s / 2.0,
            "raw_score": 0.0,
            "kinds": set(),
            "first_time": t,
        })
        bucket["raw_score"] += sc * w
        bucket["kinds"].add(k)
        # Anchor the bucket time to the EARLIEST signal in it so pre-roll
        # lands right on the triggering event rather than a bin midpoint.
        if t < bucket["first_time"]:
            bucket["first_time"] = t

    # Normalize. Peaks with ≥2 distinct kinds get a multi-signal bonus.
    peaks = []
    for b in buckets.values():
        score = b["raw_score"]
        if len(b["kinds"]) >= 2:
            score *= 1.3
        peaks.append({
            "time":  round(b["first_time"], 3),
            "score": round(score, 3),
            "kinds": sorted(b["kinds"]),
        })

    # Greedy top-N with min gap.
    peaks.sort(key=lambda p: p["score"], reverse=True)
    picked: list[dict] = []
    for p in peaks:
        if len(picked) >= top_n:
            break
        if any(abs(p["time"] - q["time"]) < min_gap_s for q in picked):
            continue
        picked.append(p)
    picked.sort(key=lambda p: p["time"])
    return picked


def events_to_proposals(events: list[dict],
                        *,
                        duration_s: float,
                        pre_roll_s: float = 15.0,
                        post_roll_s: float = 3.0,
                        min_len_s: float = 10.0,
                        max_len_s: float = 60.0,
                        max_count: int = 10,
                        kind_labels: Optional[dict] = None) -> list[dict]:
    """
    Turn a ranked event list into clip-proposal dicts matching the shape
    `propose_clips` returns. Each event at time T becomes a proposal
    window `[T - pre_roll_s, T + post_roll_s]`, clamped to the source
    duration and to the allowed length band, then deduped.

    Proposals are returned in the same schema the UI already renders:
      id, start, end, hook_line, reason, score (0-100),
      approved, user_adjusted, custom_title.
    """
    if not events:
        return []

    kind_labels = kind_labels or {
        "transient": "audio spike",
        "flash":     "visual flash",
        "hud":       "HUD change",
        "scene":     "scene cut",
        "energy":    "loud moment",
    }

    # Build raw windows.
    windows = []
    for ev in events:
        T = float(ev["time"])
        start = max(0.0, T - pre_roll_s)
        end   = min(duration_s, T + post_roll_s)
        length = end - start
        if length < min_len_s:
            # Extend backwards into the lead-up rather than forwards —
            # the user asked for the "leading up to" framing.
            start = max(0.0, end - min_len_s)
            length = end - start
        if length > max_len_s:
            # Trim front — keep the payoff on screen.
            start = end - max_len_s
            length = end - start
        if length < 1.0:
            continue
        windows.append({
            "anchor":    T,
            "start":     start,
            "end":       end,
            "raw_score": float(ev.get("score", 0.0)),
            "kinds":     list(ev.get("kinds", [])),
        })

    # Dedup overlapping windows (>50% overlap) keeping the higher raw score.
    windows.sort(key=lambda w: w["raw_score"], reverse=True)
    kept: list[dict] = []
    def _overlap_frac(a, b):
        lo = max(a["start"], b["start"]); hi = min(a["end"], b["end"])
        inter = max(0.0, hi - lo)
        shorter = min(a["end"] - a["start"], b["end"] - b["start"])
        return inter / shorter if shorter > 0 else 0.0
    for w in windows:
        if any(_overlap_frac(w, k) > 0.5 for k in kept):
            continue
        kept.append(w)
        if len(kept) >= max_count:
            break

    # Normalize raw_score → 0..100. We anchor at the max so the strongest
    # event is always ~100; mixed-signal events still stand out naturally.
    mx = max((w["raw_score"] for w in kept), default=1.0) or 1.0
    # Return sorted by time, not score, so the review UI reads linearly.
    kept.sort(key=lambda w: w["start"])

    proposals = []
    for i, w in enumerate(kept):
        score100 = max(30, min(100, int(round(60 + 40 * (w["raw_score"] / mx)))))
        kind_text = ", ".join(kind_labels.get(k, k) for k in w["kinds"]) or "event"
        hook = f"{kind_text.capitalize()} @ {_fmt_hms(w['anchor'])}"
        reason = (
            f"Detected {kind_text} at {_fmt_hms(w['anchor'])}. "
            f"Clip covers {int(w['anchor'] - w['start'])}s lead-up + "
            f"{int(w['end'] - w['anchor'])}s payoff."
        )
        proposals.append({
            "id":            f"e{i + 1}",
            "start":         round(w["start"], 2),
            "end":           round(w["end"], 2),
            "hook_line":     hook[:200],
            "reason":        reason[:220],
            "score":         score100,
            "approved":      False,
            "user_adjusted": False,
            "custom_title":  None,
            # Extra bookkeeping the UI can expose later (event markers
            # on the scrub bar, etc). Unknown keys are tolerated by the
            # save_project + UI layers.
            "event_anchor":  round(w["anchor"], 2),
            "event_kinds":   w["kinds"],
        })
    return proposals


# Sensible defaults for the whole event pipeline. Kept in one dict so a
# config.json override merges cleanly.
DEFAULT_EVENT_CFG: dict = {
    "use_audio_transients": True,
    "use_color_flash":      True,
    "use_scene_cuts":       False,
    "use_audio_energy":     False,
    "hud_region":           None,     # [x1,y1,x2,y2] 0-1 fractions
    "bin_s":                2.0,
    "min_gap_s":            8.0,
    "top_n":                20,
    "pre_roll_s":           15.0,
    "post_roll_s":          3.0,
    "min_len_s":            10.0,
    "max_len_s":            60.0,
    "max_count":            10,
    # YAMNet class-based audio tagging. Disabled by default so users
    # don't need the tflite runtime for basic event detection.
    "yamnet": {
        "enabled":        False,
        "preset":         "general_action",   # fps | sports | racing | general_action | ""
        "target_classes": [],                  # explicit override — substrings match
        "min_confidence": 0.25,
    },
    # Per-project reference sounds. Each is:
    #   { "path": "<abs>", "min_ncc": 0.5, "top_n": 30 }
    # See reference_sound_match() for details.
    "reference_sounds":     [],
}


def merged_event_cfg(user_cfg: Optional[dict]) -> dict:
    """Shallow-merge a user-supplied event_detect dict over the defaults."""
    out = dict(DEFAULT_EVENT_CFG)
    if user_cfg:
        out.update({k: v for k, v in user_cfg.items() if v is not None})
    return out


# ═══════════════════════════════════════════════════════════════════════
# Reference-sound template matching (Layer 3b)
#
# Given a short reference WAV (goal horn, killstreak jingle, victory
# sting) find every position in the source where it plays. Uses normalized
# cross-correlation computed by chunked FFT so it stays fast on hour-long
# inputs. Works at 4 kHz to cut compute 4×; enough headroom for any
# non-musical sound effect.
# ═══════════════════════════════════════════════════════════════════════

_REF_SR = 4000    # downsample target for both streams


def _extract_pcm_4k(source_path: str) -> Optional[list[int]]:
    """Decode to mono 4 kHz int16 PCM. Returns a list (cheap indexing) or None."""
    import array
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vn", "-ac", "1", "-ar", str(_REF_SR), "-sample_fmt", "s16",
            tmp.name,
        ]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            return None
        with wave.open(tmp.name, "rb") as w:
            raw = w.readframes(w.getnframes())
        a = array.array("h"); a.frombytes(raw)
        return list(a)
    finally:
        try: os.remove(tmp.name)
        except OSError: pass


def reference_sound_match(source_path: str,
                          ref_path: str,
                          *,
                          min_ncc: float = 0.5,
                          top_n: int = 30,
                          min_gap_s: float = 3.0) -> list[dict]:
    """
    Slide `ref_path` across `source_path` and return every position where
    the normalized cross-correlation exceeds `min_ncc`.

    NCC is bounded 0..1, where:
      0.40  = loose match — a similar-sounding event
      0.55  = confident match
      0.75+ = near-perfect acoustic copy

    Output: [{time, score 0..1, kind: "ref_sound", ref: <basename>}, …]
    """
    if not source_path or not os.path.isfile(source_path):
        return []
    if not ref_path or not os.path.isfile(ref_path):
        return []

    try:
        import numpy as np
    except Exception:
        print("⚠️  numpy unavailable — reference-sound matching skipped")
        return []

    src_pcm = _extract_pcm_4k(source_path)
    ref_pcm = _extract_pcm_4k(ref_path)
    if not src_pcm or not ref_pcm:
        return []

    source = np.asarray(src_pcm, dtype=np.float32) / 32768.0
    template = np.asarray(ref_pcm, dtype=np.float32) / 32768.0
    M = len(template)
    if M < 200 or len(source) < M + 10:
        return []
    # Cap template length: >30 s templates wouldn't make sense and bloat FFTs.
    if M > _REF_SR * 30:
        template = template[:_REF_SR * 30]
        M = len(template)

    # Zero-mean + unit-norm template so NCC denominator folds cleanly.
    tpl = template - template.mean()
    tpl_norm = float(np.linalg.norm(tpl)) or 1.0
    tpl /= tpl_norm

    # Chunked FFT correlation. Chunk size = 8*M (balance between FFT cost
    # and redundant overlap). Overlap = M-1 so boundary matches aren't
    # missed at chunk seams.
    chunk = max(32768, 8 * M)
    step = chunk - M + 1

    hits: list[dict] = []
    ref_name = os.path.basename(ref_path)
    # Reversed template so rfft(conv) == correlate.
    tpl_rev = tpl[::-1]

    i = 0
    while i + M <= len(source):
        end = min(len(source), i + chunk)
        seg = source[i:end]
        if len(seg) < M:
            break
        fft_size = 1 << int(math.ceil(math.log2(len(seg) + M - 1)))
        S = np.fft.rfft(seg, fft_size)
        T = np.fft.rfft(tpl_rev, fft_size)
        conv = np.fft.irfft(S * T, fft_size)
        valid_len = len(seg) - M + 1
        valid = conv[M - 1:M - 1 + valid_len]

        # Per-position source-window norm, via cumulative sum of squares.
        cs = np.concatenate([[0.0], np.cumsum(seg * seg)])
        win_ss = cs[M:M + valid_len] - cs[:valid_len]
        win_norm = np.sqrt(np.maximum(0.0, win_ss)) + 1e-8
        ncc = valid / win_norm   # bounded ≈ [-1, 1]

        # Harvest peaks.
        above = np.where(ncc >= min_ncc)[0]
        for k in above:
            t_abs = (i + int(k)) / _REF_SR
            hits.append({
                "time":  round(t_abs, 3),
                "score": round(float(min(1.0, ncc[k])), 3),
                "kind":  "ref_sound",
                "ref":   ref_name,
            })
        i += step

    if not hits:
        return []

    # Greedy top-N with min gap.
    hits.sort(key=lambda h: h["score"], reverse=True)
    picked: list[dict] = []
    for h in hits:
        if len(picked) >= top_n:
            break
        if any(abs(h["time"] - p["time"]) < min_gap_s for p in picked):
            continue
        picked.append(h)
    picked.sort(key=lambda h: h["time"])
    return picked

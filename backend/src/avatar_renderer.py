"""
Avatar Reels — composite a character ("PNG-tuber") onto a rendered
reels video. The avatar swaps frames based on:
  * audio amplitude (mouth-open / mouth-closed)
  * sentiment of the script being narrated (emotion swap)
And jiggles vertically while talking for life-like motion.

Each PNG in the brand's `avatar/` folder is tagged via avatar.json with:
    {
      "<filename>": {
        "emotion": "neutral" | "happy" | "sad" | "angry" |
                   "surprised" | "confused" | "excited",
        "talking": true | false
      }
    }

Pipeline:
  1. compute_amplitude_windows(audio, fps, threshold_db)
       → per-frame [{ t, talking: bool }]
  2. compute_emotion_windows(text, words, llm_config)
       → list[{ start, end, emotion }]
  3. render_avatar_overlay(brand_dir, fps, duration, amplitude,
                            emotions, settings, output_webm)
       → writes a transparent webm
  4. caller composites that webm onto the rendered video via FFmpeg.

For a given frame at time t, the picker chain is:
      <emotion>_<talking|idle>  →  <emotion>  →  idle  →  any
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import tempfile
import wave
from typing import Optional

try:
    from PIL import Image
    PIL_OK = True
except ImportError:
    PIL_OK = False


VALID_EMOTIONS = (
    "neutral", "happy", "sad", "angry", "surprised", "confused", "excited",
)
DEFAULT_SETTINGS = {
    "enabled":         False,
    "position":        "right",   # left / right / center / custom
    "scale":           0.55,      # fraction of frame height
    "x_offset_pct":    0.0,       # added to default position (-1.0..1.0 of frame width)
    "y_offset_pct":    0.0,       # ditto for height
    "talk_threshold_db": -32.0,   # below = idle, above = talking
    "jiggle_amp_px":   8,
    "jiggle_freq_hz":  6.0,
    "idle_breath_amp_px": 3,
    "idle_breath_freq_hz": 0.6,
    "fps":             30,
    "edge_softness_px": 0,        # post-process feather, 0 = sharp
    "use_emotions":    True,      # set False to skip the LLM call entirely
}


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


# ── 1. Amplitude analyzer ────────────────────────────────────────────

def compute_amplitude_windows(audio_path: str, *, fps: int = 30,
                              threshold_db: float = -32.0,
                              window_ms: float = 50.0) -> list[bool]:
    """
    Read a mono 16 kHz PCM stream of `audio_path`; for each video frame
    (1/fps seconds wide) decide if the avatar should be in the
    "talking" pose. Returns a list[bool] of length = ceil(duration*fps).

    The decision uses a SHORT window centred on the frame (default 50 ms)
    so the mouth-state stays smooth — switching at every video frame
    based on instantaneous loudness gives ugly flicker.
    """
    if not audio_path or not os.path.isfile(audio_path):
        return []

    import array
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", audio_path,
            "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
            tmp.name,
        ]
        if subprocess.run(cmd, capture_output=True).returncode != 0:
            return []
        with wave.open(tmp.name, "rb") as w:
            sr = w.getframerate()
            total = w.getnframes()
            raw = w.readframes(total)
        a = array.array("h"); a.frombytes(raw)
    finally:
        try: os.remove(tmp.name)
        except OSError: pass

    if not a:
        return []

    duration = len(a) / sr
    n_frames = int(math.ceil(duration * fps))
    half_w_samples = int(sr * (window_ms / 1000.0) / 2)
    thresh = 10 ** (threshold_db / 20.0) * 32768.0  # int16 absolute amplitude

    out: list[bool] = []
    for i in range(n_frames):
        t = i / fps
        centre = int(t * sr)
        s_lo = max(0, centre - half_w_samples)
        s_hi = min(len(a), centre + half_w_samples)
        if s_hi <= s_lo:
            out.append(False); continue
        # cheap mean-abs (fast in pure python with array.array)
        seg = a[s_lo:s_hi]
        # compute |mean(abs(seg))| as a decent loudness proxy without
        # the per-sample squaring cost
        accum = 0
        for v in seg:
            accum += -v if v < 0 else v
        mean_abs = accum / max(1, len(seg))
        out.append(mean_abs > thresh)
    return out


# ── 2. Emotion tagger ────────────────────────────────────────────────

def compute_emotion_windows(*,
    text: str, total_duration_s: float,
    provider: str, api_key: str, model: str, ollama_url: str,
    use_llm: bool = True,
) -> list[dict]:
    """
    Return list of [{start, end, emotion}] covering [0, total_duration_s].
    When the LLM is unavailable / disabled, returns a single all-neutral
    window so downstream code always has something to look up.
    """
    fallback = [{"start": 0.0, "end": float(total_duration_s),
                 "emotion": "neutral"}]
    if not use_llm or not text or total_duration_s < 1.0:
        return fallback
    try:
        from gemini_hooks import _call_ai
    except Exception:
        return fallback

    system = (
        "Tag emotional beats in a piece of narration so a virtual "
        "avatar can swap expressions at the right moments. Return ONLY "
        "minified JSON. Each beat must have a non-empty emotion drawn "
        "from this set ONLY: " + ", ".join(VALID_EMOTIONS) + "."
    )
    prompt = (
        f"Total duration: {total_duration_s:.1f}s\n\n"
        f"Script:\n\"\"\"\n{text[:4000]}\n\"\"\"\n\n"
        f"Cover the whole duration with non-overlapping windows. Use "
        f"\"neutral\" liberally — only flag a strong emotion when the "
        f"script clearly calls for it.\n\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "beats": [\n'
        '    {"start_s": 0.0, "end_s": 4.5, "emotion": "neutral"},\n'
        '    {"start_s": 4.5, "end_s": 6.2, "emotion": "surprised"},\n'
        "    ...\n"
        "  ]\n"
        "}\n"
    )
    raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
    if not raw:
        return fallback
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
        if a < 0 or b <= a: return fallback
        try: parsed = json.loads(s[a:b + 1])
        except Exception: return fallback

    out: list[dict] = []
    for beat in (parsed.get("beats") or []):
        try:
            a = float(beat.get("start_s") or 0)
            b = float(beat.get("end_s") or 0)
        except (TypeError, ValueError):
            continue
        if b <= a:
            continue
        em = (beat.get("emotion") or "neutral").lower().strip()
        if em not in VALID_EMOTIONS:
            em = "neutral"
        out.append({
            "start": max(0.0, a),
            "end":   min(total_duration_s, b),
            "emotion": em,
        })
    if not out:
        return fallback
    out.sort(key=lambda x: x["start"])
    return out


# ── 3. Renderer ──────────────────────────────────────────────────────

def _scan_avatar_dir(avatar_dir: str) -> dict[str, dict]:
    """
    Walk an avatar folder + its avatar.json, return:
        { "<file>": { "emotion": str, "talking": bool, "path": abs } }
    Untagged files default to {emotion:"neutral", talking:False}.
    """
    out: dict[str, dict] = {}
    if not os.path.isdir(avatar_dir):
        return out
    meta_path = os.path.join(avatar_dir, "avatar.json")
    meta: dict = {}
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f) or {}
        except Exception:
            meta = {}
    for fn in sorted(os.listdir(avatar_dir)):
        if not fn.lower().endswith(".png"):
            continue
        m = meta.get(fn) or {}
        em = (m.get("emotion") or "neutral").lower().strip()
        if em not in VALID_EMOTIONS:
            em = "neutral"
        out[fn] = {
            "emotion": em,
            "talking": bool(m.get("talking", False)),
            "path":    os.path.abspath(os.path.join(avatar_dir, fn)),
        }
    return out


def _pick_png(avatar_index: dict[str, dict], emotion: str, talking: bool) -> Optional[str]:
    """Pick the best matching PNG with a graceful fallback chain."""
    if not avatar_index:
        return None
    # 1. exact match
    for v in avatar_index.values():
        if v["emotion"] == emotion and v["talking"] == talking:
            return v["path"]
    # 2. same emotion, any talking state (prefer talking when we want talking)
    same = [v for v in avatar_index.values() if v["emotion"] == emotion]
    if same:
        # If we wanted talking but none in this emotion is talking, take it anyway.
        # If we wanted idle, prefer idle but accept talking.
        same.sort(key=lambda v: 0 if v["talking"] == talking else 1)
        return same[0]["path"]
    # 3. neutral matching talking state
    neutral = [v for v in avatar_index.values() if v["emotion"] == "neutral"]
    if neutral:
        neutral.sort(key=lambda v: 0 if v["talking"] == talking else 1)
        return neutral[0]["path"]
    # 4. any
    return next(iter(avatar_index.values()))["path"]


def _emotion_at(emotions: list[dict], t: float) -> str:
    for e in emotions:
        if e["start"] <= t < e["end"]:
            return e["emotion"]
    return emotions[-1]["emotion"] if emotions else "neutral"


def render_avatar_overlay(
    *,
    avatar_dir: str,
    canvas_w: int, canvas_h: int,
    duration_s: float,
    fps: int,
    amplitude_frames: list[bool],
    emotions: list[dict],
    settings: dict,
    output_webm: str,
) -> bool:
    """
    Render a transparent webm overlay matching the rendered video's
    duration + canvas size. Caller composites it onto the rendered
    video with a single FFmpeg overlay pass.

    Returns True on success.
    """
    if not PIL_OK:
        print("⚠️  Pillow not installed — avatar overlay skipped")
        return False
    avatar_index = _scan_avatar_dir(avatar_dir)
    if not avatar_index:
        print(f"⚠️  No PNGs in {avatar_dir} — avatar overlay skipped")
        return False

    s = {**DEFAULT_SETTINGS, **(settings or {})}
    n_frames = max(1, int(math.ceil(duration_s * fps)))
    if amplitude_frames and len(amplitude_frames) < n_frames:
        amplitude_frames = list(amplitude_frames) + [False] * (n_frames - len(amplitude_frames))
    elif not amplitude_frames:
        amplitude_frames = [False] * n_frames

    # Pre-load all PNGs once + cache resized versions per scale.
    target_h = max(64, int(canvas_h * float(s.get("scale", 0.55))))
    loaded_cache: dict[str, "Image.Image"] = {}

    def _load_scaled(path: str) -> "Image.Image":
        if path in loaded_cache:
            return loaded_cache[path]
        img = Image.open(path).convert("RGBA")
        # Scale by HEIGHT, preserving aspect.
        ratio = target_h / img.height
        new_w = max(32, int(img.width * ratio))
        img = img.resize((new_w, target_h), Image.LANCZOS)
        loaded_cache[path] = img
        return img

    # Compute the centre-x / centre-y for the chosen position.
    def _pos_xy(layer: "Image.Image") -> tuple[int, int]:
        pos = s.get("position", "right")
        if pos == "left":
            base_x = int(canvas_w * 0.05)
        elif pos == "center":
            base_x = (canvas_w - layer.width) // 2
        else:  # right (default)
            base_x = canvas_w - layer.width - int(canvas_w * 0.05)
        # Anchor to bottom of canvas with a 7% padding so the captions
        # at default `position: bottom` don't clip the avatar's mouth.
        base_y = canvas_h - layer.height - int(canvas_h * 0.07)
        # User offsets in fractional units of canvas dims.
        base_x += int(float(s.get("x_offset_pct", 0)) * canvas_w)
        base_y += int(float(s.get("y_offset_pct", 0)) * canvas_h)
        return base_x, base_y

    # Render PNG sequence into a temp dir.
    seq_dir = tempfile.mkdtemp(prefix="avatar_seq_")
    try:
        jiggle_amp = int(s.get("jiggle_amp_px", 8))
        jiggle_freq = float(s.get("jiggle_freq_hz", 6.0))
        breath_amp = int(s.get("idle_breath_amp_px", 3))
        breath_freq = float(s.get("idle_breath_freq_hz", 0.6))

        for i in range(n_frames):
            t = i / fps
            talking = bool(amplitude_frames[i]) if i < len(amplitude_frames) else False
            emotion = _emotion_at(emotions, t) if s.get("use_emotions", True) else "neutral"
            path = _pick_png(avatar_index, emotion, talking)
            if not path:
                # Empty frame — write transparent PNG so concat stays aligned.
                blank = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
                blank.save(os.path.join(seq_dir, f"f{i:06d}.png"))
                continue

            layer = _load_scaled(path)
            # Vertical jiggle: 1 cycle of sin if talking, slower idle breath otherwise.
            if talking:
                offset_y = int(jiggle_amp * math.sin(2 * math.pi * jiggle_freq * t))
            else:
                offset_y = int(breath_amp * math.sin(2 * math.pi * breath_freq * t))

            frame = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
            x, y = _pos_xy(layer)
            frame.alpha_composite(layer, dest=(x, y + offset_y))
            frame.save(os.path.join(seq_dir, f"f{i:06d}.png"))

        # Encode the PNG sequence to a transparent webm via libvpx-vp9.
        # `-pix_fmt yuva420p` keeps the alpha channel in the output.
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", str(fps),
            "-i", os.path.join(seq_dir, "f%06d.png"),
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "32",
            "-row-mt", "1",
            output_webm,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"⚠️  avatar webm encode failed: {r.stderr[-400:]}")
            return False
        return True
    finally:
        # Tidy the PNG sequence — these get big fast.
        try:
            import shutil
            shutil.rmtree(seq_dir, ignore_errors=True)
        except Exception:
            pass


# ── 4. Final overlay onto the rendered video ─────────────────────────

def overlay_webm_onto_video(input_video: str, overlay_webm: str,
                            output_video: str) -> bool:
    """
    Single-pass FFmpeg composite: avatar webm on top of the rendered
    reels video. Audio + duration of the base video pass through
    unchanged.
    """
    if not (os.path.isfile(input_video) and os.path.isfile(overlay_webm)):
        return False
    cmd = [
        _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
        "-i", input_video,
        "-i", overlay_webm,
        "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1[v]",
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        output_video,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"⚠️  avatar overlay encode failed: {r.stderr[-400:]}")
        return False
    return True

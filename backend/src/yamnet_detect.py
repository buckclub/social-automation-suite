"""
YAMNet audio-event classifier — Layer 2 of Clip Maker's event detection.

YAMNet is a MobileNet-v1-based audio classifier from Google Research that
tags every ~1-second audio window with scores over 521 AudioSet classes,
including the ones that matter for gameplay / sports clipping:

    "Gunshot, gunfire"   "Explosion"      "Machine gun"
    "Cheering"           "Applause"       "Whistling"
    "Bell"               "Siren"          "Screaming"
    "Engine"             "Skidding"       "Arcade game"

The TFLite build is ~15 MB and runs on CPU in well under realtime, so
we don't depend on GPU. The model + label CSV are auto-downloaded to
`<project_root>/models/` on first use.

Runtime is OPTIONAL: if neither `tflite_runtime` nor `tensorflow` is
installed, `is_available()` returns False and callers fall back
gracefully (YAMNet just contributes no events).

Public surface:
    is_available() -> bool
    install_hint()  -> str
    yamnet_detect(source_path, target_classes, *, min_confidence, ...)
        -> list[{time, score, kind, class}]
"""
from __future__ import annotations

import array
import math
import os
import subprocess
import tempfile
import urllib.request
import wave
from typing import Iterable, Optional


# ── Config / constants ─────────────────────────────────────────────

YAMNET_TFLITE_URL = (
    "https://storage.googleapis.com/tfhub-lite-models/google/"
    "lite-model/yamnet/classification/tflite/1.tflite"
)
YAMNET_LABELS_URL = (
    "https://storage.googleapis.com/audioset/yamnet/yamnet_class_map.csv"
)

# YAMNet expects exactly 15600 samples of mono 16kHz float32 in [-1,1].
TARGET_SR = 16000
FRAME_SAMPLES = 15600            # ~0.975 s
FRAME_HOP_SAMPLES = 7800         # 50 % overlap — good default


# ── TFLite runtime discovery ───────────────────────────────────────

_INTERPRETER_FACTORY = None


def _load_interpreter_factory():
    """Return a callable that builds a tflite interpreter, or None."""
    global _INTERPRETER_FACTORY
    if _INTERPRETER_FACTORY is not None:
        return _INTERPRETER_FACTORY
    try:
        # Standalone tflite runtime (preferred — no ~500 MB TF install).
        from tflite_runtime.interpreter import Interpreter  # type: ignore
        _INTERPRETER_FACTORY = lambda p: Interpreter(model_path=p)
        return _INTERPRETER_FACTORY
    except Exception:
        pass
    try:
        # Full TF as a fallback — whichever is already on the box wins.
        import tensorflow as tf  # type: ignore
        _INTERPRETER_FACTORY = lambda p: tf.lite.Interpreter(model_path=p)
        return _INTERPRETER_FACTORY
    except Exception:
        pass
    return None


def is_available() -> bool:
    return _load_interpreter_factory() is not None


def install_hint() -> str:
    return (
        "YAMNet event detection needs a TFLite runtime. Install either:\n"
        "  pip install tflite-runtime     # lightweight (~3 MB)\n"
        "  pip install tensorflow         # heavy but works everywhere"
    )


# ── Model + label auto-download ────────────────────────────────────

def _models_dir() -> str:
    # Live under the project root so the same model serves every project.
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    d = os.path.join(here, "models")
    os.makedirs(d, exist_ok=True)
    return d


def _download(url: str, dest: str) -> bool:
    """Download to a tempfile then rename — partial files never linger."""
    tmp = dest + ".part"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as f:
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, dest)
        return True
    except Exception as e:
        print(f"⚠️  YAMNet download failed ({url}): {e}")
        try: os.remove(tmp)
        except OSError: pass
        return False


def ensure_model(model_path: Optional[str] = None,
                 labels_path: Optional[str] = None) -> tuple[str, str] | None:
    """
    Resolve (or download) the model + labels. Returns (model, labels)
    paths, or None on failure. Safe to call repeatedly.
    """
    md = _models_dir()
    mp = model_path or os.path.join(md, "yamnet.tflite")
    lp = labels_path or os.path.join(md, "yamnet_class_map.csv")

    if not os.path.isfile(mp):
        print(f"↓ Downloading YAMNet model to {mp} …")
        if not _download(YAMNET_TFLITE_URL, mp):
            return None
    if not os.path.isfile(lp):
        print(f"↓ Downloading YAMNet label map to {lp} …")
        if not _download(YAMNET_LABELS_URL, lp):
            return None
    return mp, lp


def _parse_labels(csv_path: str) -> list[str]:
    """YAMNet class_map CSV: header then index, mid, display_name per row."""
    names: list[str] = []
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            next(f, None)   # header
            for line in f:
                # display_name is the 3rd CSV column but can contain commas
                # when wrapped in quotes. Handle both cases.
                parts = line.rstrip("\n").split(",", 2)
                if len(parts) < 3:
                    continue
                dn = parts[2].strip()
                if dn.startswith('"') and dn.endswith('"'):
                    dn = dn[1:-1]
                names.append(dn)
    except Exception as e:
        print(f"⚠️  Failed to parse YAMNet labels: {e}")
        return []
    return names


# ── Audio extraction ──────────────────────────────────────────────

def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _extract_pcm(source_path: str) -> Optional["array.array"]:
    """Decode to mono 16 kHz int16 PCM. Returns array.array('h') or None."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vn", "-ac", "1", "-ar", str(TARGET_SR), "-sample_fmt", "s16",
            tmp.name,
        ]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            return None
        with wave.open(tmp.name, "rb") as w:
            n = w.getnframes()
            raw = w.readframes(n)
        a = array.array("h")
        a.frombytes(raw)
        return a
    finally:
        try: os.remove(tmp.name)
        except OSError: pass


# ── Main inference ────────────────────────────────────────────────

def _match_target_indices(labels: list[str], targets: Iterable[str]) -> dict[int, str]:
    """
    Resolve target class strings to YAMNet indices. Matching is
    case-insensitive substring so a user config of ["gunshot"] matches
    both "Gunshot, gunfire" and "Machine gun".
    """
    out: dict[int, str] = {}
    t_lower = [t.strip().lower() for t in targets if t and t.strip()]
    if not t_lower:
        return out
    for idx, name in enumerate(labels):
        nl = name.lower()
        for t in t_lower:
            if t in nl:
                out[idx] = name
                break
    return out


def yamnet_detect(source_path: str,
                  target_classes: Iterable[str],
                  *,
                  min_confidence: float = 0.25,
                  top_n: int = 60,
                  min_gap_s: float = 3.0,
                  model_path: Optional[str] = None,
                  labels_path: Optional[str] = None) -> list[dict]:
    """
    Run YAMNet over the source audio and return peaks wherever any of
    `target_classes` crosses `min_confidence`.

    Output: [{time, score 0..1, kind: "yamnet", class: "Gunshot, gunfire"}, …]
    """
    if not source_path or not os.path.isfile(source_path):
        return []
    if not target_classes:
        return []
    factory = _load_interpreter_factory()
    if factory is None:
        return []
    paths = ensure_model(model_path, labels_path)
    if not paths:
        return []
    mp, lp = paths

    labels = _parse_labels(lp)
    if not labels:
        return []

    wanted = _match_target_indices(labels, list(target_classes))
    if not wanted:
        print(f"⚠️  YAMNet: none of the target classes matched known labels. "
              f"Got: {list(target_classes)}")
        return []

    pcm = _extract_pcm(source_path)
    if not pcm or len(pcm) < FRAME_SAMPLES:
        return []

    # numpy only used inside the inference loop; already a project dep.
    import numpy as np
    try:
        interp = factory(mp)
        interp.allocate_tensors()
        inp = interp.get_input_details()[0]
        outs = interp.get_output_details()
    except Exception as e:
        print(f"⚠️  YAMNet interpreter init failed: {e}")
        return []

    # YAMNet tflite 1 expects shape (15600,) float32. Some builds publish
    # (1, 15600); handle both.
    need_batch = len(inp["shape"]) == 2
    # Find the (521,) logit output. In the classification-tflite build
    # that's the first output.
    logit_idx = outs[0]["index"]

    # Convert the int16 PCM to normalized float32 ONCE, then slide.
    audio = np.frombuffer(pcm.tobytes(), dtype=np.int16).astype(np.float32) / 32768.0

    results: list[dict] = []
    i = 0
    while i + FRAME_SAMPLES <= len(audio):
        win = audio[i:i + FRAME_SAMPLES]
        x = win.reshape((1, FRAME_SAMPLES)) if need_batch else win
        try:
            interp.set_tensor(inp["index"], x.astype(np.float32))
            interp.invoke()
            scores = interp.get_tensor(logit_idx).reshape(-1)
        except Exception as e:
            print(f"⚠️  YAMNet inference failed at frame {i}: {e}")
            break
        # Score is the MAX target class confidence at this window, so
        # any matching event in the window fires.
        best_idx = -1
        best_val = 0.0
        for idx in wanted:
            if idx < len(scores) and scores[idx] > best_val:
                best_val = float(scores[idx])
                best_idx = idx
        if best_val >= min_confidence and best_idx >= 0:
            # YAMNet window covers [t, t + 0.975]. Report the MIDPOINT so
            # the pre-roll anchor lands on the actual event, not before it.
            t_center = (i + FRAME_SAMPLES / 2.0) / TARGET_SR
            # Normalize score: (conf - threshold) / (1 - threshold) — above
            # threshold is 0..1 so weak+rare still distinguishable.
            norm = max(0.0, (best_val - min_confidence) / max(1e-6, 1.0 - min_confidence))
            results.append({
                "time":  round(t_center, 3),
                "score": round(min(1.0, norm), 3),
                "kind":  "yamnet",
                "class": wanted[best_idx],
            })
        i += FRAME_HOP_SAMPLES

    if not results:
        return []

    # Greedy top-N with min gap.
    results.sort(key=lambda r: r["score"], reverse=True)
    picked: list[dict] = []
    for r in results:
        if len(picked) >= top_n:
            break
        if any(abs(r["time"] - p["time"]) < min_gap_s for p in picked):
            continue
        picked.append(r)
    picked.sort(key=lambda r: r["time"])
    return picked


# ── Presets ─────────────────────────────────────────────────────────

# Curated class-name substrings for the most-asked-for scenarios. Users
# can still provide their own target_classes list in config; these are a
# UX convenience.
PRESETS: dict[str, list[str]] = {
    "fps": [
        "Gunshot, gunfire",
        "Machine gun",
        "Explosion",
        "Artillery fire",
        "Cap gun",
    ],
    "sports": [
        "Cheering",
        "Applause",
        "Whistling",
        "Bell",
        "Crowd",
    ],
    "racing": [
        "Skidding",
        "Engine",
        "Race car, auto racing",
        "Accelerating, revving, vroom",
    ],
    "general_action": [
        "Explosion",
        "Gunshot, gunfire",
        "Screaming",
        "Cheering",
        "Applause",
        "Siren",
    ],
}


def preset_classes(preset: str) -> list[str]:
    return PRESETS.get(preset, PRESETS["general_action"])

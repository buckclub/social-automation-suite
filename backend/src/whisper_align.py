"""
Word-level forced alignment via faster-whisper (local).

Given a TTS-generated audio clip plus the text that produced it, returns a list
of {word, start, end} timestamps. The results are cached next to the audio file
as <audio>.whisper.json so Re-render doesn't repeat the work.

If faster-whisper is not installed, `is_available()` returns False and all align
calls return None — the caller should fall back to even-time chunking.
"""
from __future__ import annotations
import json
import os
from typing import Optional

_MODEL_CACHE: dict = {}


def is_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def install_hint() -> str:
    return "pip install faster-whisper"


def _resolve_device(device: str, compute_type: str) -> tuple[str, str]:
    """Resolve 'auto' into a concrete (device, compute_type)."""
    if device not in ("auto", "cpu", "cuda"):
        device = "auto"
    if device == "auto":
        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
            else:
                device = "cpu"
        except ImportError:
            device = "cpu"
    if compute_type in (None, "", "default"):
        compute_type = "float16" if device == "cuda" else "int8"
    return device, compute_type


def _get_model(model_size: str, device: str, compute_type: str):
    key = (model_size, device, compute_type)
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]
    from faster_whisper import WhisperModel
    print(f"   🧠 Loading faster-whisper model={model_size} device={device} compute={compute_type}")
    m = WhisperModel(model_size, device=device, compute_type=compute_type)
    _MODEL_CACHE[key] = m
    return m


def align_audio(
    audio_path: str,
    *,
    text_hint: Optional[str] = None,
    model_size: str = "base",
    device: str = "auto",
    compute_type: str = "default",
    language: str = "en",
) -> Optional[list[dict]]:
    """
    Return [{'word': str, 'start': float, 'end': float}, ...] for the audio,
    or None on failure / when faster-whisper isn't installed.
    Results are cached as <audio_path>.whisper.json.
    """
    if not audio_path or not os.path.exists(audio_path):
        return None

    # v2 cache: includes tighter beam_size (5) + word_timestamps. Old .whisper.json
    # from the greedy pass is ignored so we don't inherit its drift.
    cache_path = audio_path + ".whisper_v2.json"
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                return data
        except Exception:
            pass

    if not is_available():
        return None

    device, compute_type = _resolve_device(device, compute_type)

    try:
        model = _get_model(model_size, device, compute_type)
        segments, _info = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            initial_prompt=(text_hint or "")[:200] or None,
            vad_filter=False,
            beam_size=5,           # default 5 gives noticeably tighter word boundaries than greedy
            condition_on_previous_text=False,
        )
        words: list[dict] = []
        for seg in segments:
            if not seg.words:
                continue
            for w in seg.words:
                word = (w.word or "").strip()
                if not word:
                    continue
                words.append({
                    "word": word,
                    "start": float(w.start) if w.start is not None else 0.0,
                    "end":   float(w.end)   if w.end   is not None else 0.0,
                })
        if not words:
            return None
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(words, f, ensure_ascii=False)
        except Exception:
            pass
        return words
    except Exception as e:
        print(f"⚠️  whisper_align failed on {os.path.basename(audio_path)}: {e}")
        return None

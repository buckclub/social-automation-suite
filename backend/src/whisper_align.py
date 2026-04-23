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


def _clean_prompt(s: Optional[str]) -> str:
    """Strip bad chars from the whisper initial_prompt before it influences decoding."""
    if not s:
        return ""
    import re as _re
    # Remove replacement chars + zero-width + SentencePiece markers.
    s = _re.sub(
        r"[\ufffd\u2581\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]",
        "",
        s,
    )
    return s[:200].strip()


def _get_model(model_size: str, device: str, compute_type: str):
    key = (model_size, device, compute_type)
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]
    from faster_whisper import WhisperModel
    print(f"   🧠 Loading faster-whisper model={model_size} device={device} compute={compute_type}")
    m = WhisperModel(model_size, device=device, compute_type=compute_type)
    _MODEL_CACHE[key] = m
    return m


def unload_models() -> None:
    """
    Drop the cached WhisperModel(s) and free CUDA memory.

    Call this once alignment is done for the run — faster-whisper + CUDA keep
    ~5 GB committed by default, which on Windows makes `CreateProcess` fail
    with WinError 1455 when FFmpeg spawns (the OS pre-commits swap equal to
    the parent's committed memory). Freeing here keeps the child-spawn cheap.
    """
    global _MODEL_CACHE
    _MODEL_CACHE.clear()
    try:
        import gc
        gc.collect()
    except Exception:
        pass
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


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

    # v8 cache: drops known training-data hallucination segments (Amara,
    # "Subtitled by", "Thanks for watching", etc.) from whisper output.
    cache_path = audio_path + ".whisper_v8.json"
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
        # A guidance prompt + hint. Tells whisper the text it's about to hear
        # AND explicitly warns it not to invent content — which is the exact
        # failure mode we've been fighting.
        guidance = (
            "This is a clean text-to-speech narration. If there is silence, "
            "do not fabricate words. Transcribe only what is actually spoken."
        )
        hint = _clean_prompt(text_hint)
        full_prompt = guidance if not hint else f"{guidance} Expected content: {hint}"

        segments, _info = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            initial_prompt=full_prompt[:440],  # whisper prompt budget ~448 tokens
            beam_size=5,
            best_of=5,
            condition_on_previous_text=False,
            # Temperature fallback chain — retries low-confidence decodes at
            # warmer sampling rather than dropping them. Per faster-whisper
            # best practices this REDUCES hallucinations vs greedy-only.
            temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            # Re-enable the repetition gate. Catches the "I'm putting I'm
            # putting I'm putting..." class of hallucination where the
            # decoder collapses into a loop. Default 2.4; our test clips
            # never legitimately exceed this.
            compression_ratio_threshold=2.4,
            # Keep confidence gate at default too — it only triggers together
            # with no_speech_threshold, and ours is loose enough that real
            # speech won't be dropped.
            log_prob_threshold=-1.0,
            # Keep silence gate permissive so we don't lose quiet TTS phrasing.
            no_speech_threshold=0.9,
            suppress_blank=False,
            # VAD stays OFF. faster-whisper's built-in VAD ate real TTS
            # speech in earlier testing, and external VAD doesn't help for
            # TTS audio (no genuine silence to filter).
            vad_filter=False,
        )
        import re as _re
        # SentencePiece / BPE tokenizer artifacts sometimes leak into .word
        # (▁ = U+2581 is the classic space marker). Plus an assortment of
        # zero-width and direction-marker characters that fonts render as tofu.
        JUNK = _re.compile(
            "["
            "\u2581"          # SentencePiece space marker
            "\u200b-\u200f"   # zero-width + LTR/RTL marks
            "\u2028\u2029"    # line / paragraph separators
            "\u202a-\u202e"   # bidi embedding / override
            "\u2060-\u2064"   # word joiner & invisible operators
            "\ufe00-\ufe0f"   # variation selectors
            "\ufeff"          # BOM
            "\ufff9-\ufffb"   # interlinear annotation
            "]"
        )
        def _clean(w: str) -> str:
            if not w:
                return ""
            w = JUNK.sub("", w)
            # Collapse any Unicode whitespace to a real space then strip.
            w = _re.sub(r"\s+", " ", w).strip()
            return w

        # Known whisper training-data hallucinations. These appear as
        # artifacts during low-confidence stretches and are famously baked
        # into all Whisper variants. Strip any segment whose text contains
        # one of these markers — the entire fake subtitle credit line
        # rather than individual words.
        HALLUCINATION_MARKERS = [
            "amara.org",
            "subtitled by",
            "subtitles by",
            "transcription by",
            "transcribed by",
            "castingwords",
            "www.",
            "thanks for watching",
            "please subscribe",
            "like and subscribe",
            "like, share and subscribe",
            "music playing",
            "[music]",
            "♪",
        ]

        def _is_hallucination(seg_text: str) -> bool:
            t = (seg_text or "").lower()
            return any(m in t for m in HALLUCINATION_MARKERS)

        words: list[dict] = []
        for seg in segments:
            if not seg.words:
                continue
            # Drop whole segments that look like boilerplate hallucinations.
            seg_text = getattr(seg, "text", "") or " ".join((w.word or "") for w in seg.words)
            if _is_hallucination(seg_text):
                print(f"   ⚠️  whisper: dropped hallucinated segment: {seg_text.strip()[:80]!r}")
                continue
            for w in seg.words:
                word = _clean(w.word or "")
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

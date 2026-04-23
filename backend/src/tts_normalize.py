"""
Pre-TTS text normalization.

Uses a local Ollama model to clean up Reddit-isms before sending text to a paid
TTS like ElevenLabs. Typical fixes: "tho" -> "though", "cuz" -> "because",
punctuation, basic typo correction. Meaning must be preserved.

If Ollama isn't reachable, the functions return the original text verbatim so
the pipeline keeps working without local LLM infra.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
from typing import Optional

import requests


SYSTEM_PROMPT = (
    "You are a careful copy-editor for a text-to-speech engine. "
    "Fix only what hurts speech synthesis quality:\n"
    "- Expand Reddit-style short forms: tho->though, cuz/bc->because, thru->through, "
    "ur->your, u->you, rn->right now, irl->in real life, imo->in my opinion, "
    "tbh->to be honest, idk->I don't know, w/->with, w/o->without, etc.\n"
    "- Fix clear typos and missing apostrophes (dont->don't, wont->won't, its vs it's).\n"
    "- Replace emoji-style tokens (e.g. ':D', '<3') with a period or nothing.\n"
    "- Keep the author's voice, tone, slang cadence and structure. Do NOT rewrite "
    "  or summarize. Do NOT change proper nouns. Do NOT add or remove sentences.\n"
    "- Preserve [PAUSE:N] markers verbatim.\n"
    "Return ONLY the corrected text. No preface, no commentary, no quotes."
)


def _is_ollama_up(url: str, timeout: float = 1.5) -> bool:
    try:
        r = requests.get(f"{url.rstrip('/')}/api/tags", timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def _hash(text: str, model: str) -> str:
    h = hashlib.sha1()
    h.update(model.encode("utf-8"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


def _load_cache(path: str) -> dict:
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(path: str, data: dict) -> None:
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def _strip_thinking(text: str) -> str:
    # Ollama reasoning models may wrap output in <think>...</think>; strip it.
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def normalize_text(
    text: str,
    *,
    ollama_url: str = "http://localhost:11434",
    model: str = "qwen2.5:14b",
    cache_path: Optional[str] = None,
    timeout: float = 45.0,
    max_chars: int = 4000,
) -> str:
    """
    Return `text` cleaned up for TTS, or the original if Ollama is down / fails.
    """
    text = (text or "").strip()
    if not text:
        return text
    # Tiny snippets aren't worth the round-trip.
    if len(text) < 12:
        return text

    cache = _load_cache(cache_path) if cache_path else {}
    key = _hash(text, model)
    if key in cache:
        return cache[key]

    if not _is_ollama_up(ollama_url):
        return text

    # Keep prompt small; chunk very long inputs to avoid timeouts.
    if len(text) > max_chars:
        # Split at sentence boundary near the midpoint.
        mid = len(text) // 2
        split_at = text.rfind(". ", 0, mid + 200)
        if split_at < 200:
            split_at = mid
        left = normalize_text(text[:split_at], ollama_url=ollama_url, model=model,
                              cache_path=cache_path, timeout=timeout, max_chars=max_chars)
        right = normalize_text(text[split_at:], ollama_url=ollama_url, model=model,
                               cache_path=cache_path, timeout=timeout, max_chars=max_chars)
        return (left + " " + right).strip()

    try:
        r = requests.post(
            f"{ollama_url.rstrip('/')}/api/chat",
            json={
                "model": model,
                "stream": False,
                "options": {"temperature": 0.1},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": text},
                ],
            },
            timeout=timeout,
        )
        r.raise_for_status()
        data = r.json()
        # Ollama chat returns {"message": {"content": "..."}} and sometimes a
        # "thinking" field for reasoning models.
        cleaned = (data.get("message") or {}).get("content") or ""
        # Some reasoning models put the answer in "thinking" and leave content empty.
        if not cleaned.strip():
            cleaned = (data.get("message") or {}).get("thinking") or ""
        cleaned = _strip_thinking(cleaned).strip()
        if not cleaned:
            return text
        # Safety net: if the model returned something wildly different in length,
        # fall back to the original to avoid mangled stories.
        if not (0.5 <= len(cleaned) / max(1, len(text)) <= 1.8):
            return text
        if cache_path is not None:
            cache[key] = cleaned
            _save_cache(cache_path, cache)
        return cleaned
    except Exception as e:
        print(f"⚠️  tts_normalize: Ollama call failed ({e}); using original text.")
        return text

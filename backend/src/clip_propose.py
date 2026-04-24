"""
Ask the configured LLM to pick N most Shorts-worthy moments out of a
transcript. Returns a list of proposed clip windows.

Heuristic mode (optional — controlled by caller):
  'ai_only'       — just the LLM over the transcript
  'ai_plus'       — LLM + an audio-energy signal as an extra input hint
                    (not implemented in the MVP, stubbed to ai_only)
  'manual'        — skip the AI entirely; caller picks manually

Output per proposal:
  {
    "id":         "pN",
    "start":      float,   # seconds into source
    "end":        float,
    "hook_line":  str,     # ≤90 chars, a suggested spoken-first line
    "reason":     str,     # ≤140 chars, why this is worth clipping
    "score":      int,     # 0-100 virality guess
  }
"""
from __future__ import annotations
import json
import os
import re
from typing import Optional


def _fmt_time(s: float) -> str:
    s = max(0, int(s))
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def _transcript_to_block(segments: list[dict], max_chars: int = 24000) -> str:
    """
    Flatten {start,end,text} segments into `[HH:MM:SS] text` lines the
    LLM can reason over, truncating if the transcript is huge. We keep
    the trim to the END of the transcript since the start is usually
    intro filler that's less clip-worthy.
    """
    lines = []
    for s in segments:
        t = (s.get("text") or "").strip()
        if not t:
            continue
        lines.append(f"[{_fmt_time(s.get('start', 0))}] {t}")
    blob = "\n".join(lines)
    if len(blob) <= max_chars:
        return blob
    # Keep the last `max_chars` worth — paragraph-aware trim.
    return "…\n" + blob[-max_chars:]


def propose_clips(
    segments: list[dict],
    *,
    duration_s: float,
    provider: str,
    api_key: str,
    model: str,
    ollama_url: str = "",
    target_count: int = 5,
    min_len_s: int = 15,
    max_len_s: int = 60,
    mode: str = "ai_only",
) -> list[dict]:
    """
    Returns up to `target_count` proposals. Never raises — failures
    come back as an empty list so the caller (the clip pipeline) can
    fall back to a single "the whole thing" manual window.
    """
    if mode == "manual" or not segments:
        return []

    try:
        from gemini_hooks import _call_ai
    except Exception:
        return []

    system = (
        "You are a viral short-form video editor. Pick the most Shorts-worthy "
        f"{min_len_s}-{max_len_s} second windows out of a long transcript. "
        "Be ruthless — return only clips with a clear hook, emotional peak, "
        "or satisfying payoff. Return STRICT minified JSON only, no markdown."
    )

    prompt = (
        f"Source duration: {_fmt_time(duration_s)}\n"
        f"Target number of clips: {target_count} (fewer is fine if nothing else is strong)\n"
        f"Allowed clip length: {min_len_s}-{max_len_s} seconds\n\n"
        f"Transcript with timecodes:\n"
        f"{_transcript_to_block(segments)}\n\n"
        "Return a JSON object with key 'clips' whose value is an array. Each item:\n"
        "{\n"
        '  "start_time":   "HH:MM:SS",\n'
        '  "end_time":     "HH:MM:SS",\n'
        '  "hook_line":    "<≤90 chars spoken opening line for the clip>",\n'
        '  "reason":       "<≤140 chars verdict>",\n'
        '  "score":        <0-100 virality rating>\n'
        "}\n\n"
        f"DO NOT choose clips shorter than {min_len_s}s or longer than {max_len_s}s. "
        f"DO NOT overlap clips. Sort by score descending."
    )

    raw = _call_ai(provider, api_key, prompt, system, model, ollama_url)
    if not raw:
        return []

    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```")[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.strip("`").strip()
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        parsed = json.loads(s[start:end + 1])
    except Exception:
        return []

    proposals = []
    for i, c in enumerate((parsed.get("clips") or [])[:target_count]):
        try:
            st = _parse_hms(c.get("start_time"))
            en = _parse_hms(c.get("end_time"))
            if en <= st:
                continue
            length = en - st
            # Clamp length into the allowed band; the LLM occasionally
            # overshoots by a few seconds.
            if length < min_len_s:
                en = st + min_len_s
            if length > max_len_s:
                en = st + max_len_s
            if en > duration_s:
                en = duration_s
            if en <= st:
                continue
            proposals.append({
                "id":            f"p{i + 1}",
                "start":         round(st, 2),
                "end":           round(en, 2),
                "hook_line":     (c.get("hook_line") or "")[:200],
                "reason":        (c.get("reason") or "")[:220],
                "score":         max(0, min(100, int(c.get("score") or 0))),
                "approved":      False,
                "user_adjusted": False,
                "custom_title":  None,
            })
        except Exception:
            continue
    return proposals


# Accept HH:MM:SS, MM:SS, or plain seconds.
_HMS = re.compile(r"^\s*(\d{1,3}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\s*$")


def _parse_hms(value) -> float:
    if value is None:
        raise ValueError("missing time")
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    m = _HMS.match(s)
    if m:
        a, b, c, ms = m.groups()
        if c is None:
            # mm:ss
            mm = int(a); ss = int(b)
            hh = 0
        else:
            hh = int(a); mm = int(b); ss = int(c)
        total = hh * 3600 + mm * 60 + ss
        if ms:
            total += float("0." + ms)
        return float(total)
    # Plain seconds as a string?
    return float(s)

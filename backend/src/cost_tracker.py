"""
Local cost/usage ledger for TTS + AI providers.

Where possible we pull the *real* remaining quota from the provider's
own API (ElevenLabs exposes `/v1/user`). For providers that don't expose
live usage (Gemini, OpenRouter, NVIDIA NIM, Ollama), we keep a local
counter of characters-in / characters-out and approximate token spend
from that — good enough to spot the "did I accidentally burn through my
month?" moments without wiring 4 separate billing APIs.

Ledger at `.cache/cost_ledger.json`:
  {
    "days": {
      "2026-04-23": {
        "elevenlabs":      { "chars": 8421 },
        "streamlabs_polly": { "chars": 120 },
        "gemini":          { "in_chars": 4200, "out_chars": 900, "calls": 12 },
        "openrouter":      { "in_chars": 0,    "out_chars": 0,    "calls": 0 },
        "nvidia_nim":      { "in_chars": 0,    "out_chars": 0,    "calls": 0 },
        "ollama":          { "in_chars": 50000, "out_chars": 14000, "calls": 40 }
      }
    }
  }
"""
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from json_ledger import get_ledger

KEEP_DAYS = 90


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "cost_ledger.json")


def _ledger(project_root: str):
    return get_ledger(_path(project_root), default={"days": {}})


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _prune(days: dict, keep: int = KEEP_DAYS) -> None:
    if len(days) <= keep:
        return
    for k in sorted(days.keys())[:-keep]:
        days.pop(k, None)


def record_tts(project_root: str, provider: str, chars: int) -> None:
    """Log a TTS synthesis call. `chars` is input text length."""
    if chars <= 0:
        return
    with _ledger(project_root).mutate() as data:
        days = data.setdefault("days", {})
        day = days.setdefault(_today_key(), {})
        prov = day.setdefault(provider.lower(), {"chars": 0})
        prov["chars"] = int(prov.get("chars", 0)) + int(chars)
        _prune(days)


def record_ai(project_root: str, provider: str, *, in_chars: int = 0, out_chars: int = 0) -> None:
    """Log one AI (LLM) call. in/out character counts are approximate."""
    with _ledger(project_root).mutate() as data:
        days = data.setdefault("days", {})
        day = days.setdefault(_today_key(), {})
        prov = day.setdefault(provider.lower(), {"in_chars": 0, "out_chars": 0, "calls": 0})
        prov["in_chars"]  = int(prov.get("in_chars", 0))  + max(0, int(in_chars))
        prov["out_chars"] = int(prov.get("out_chars", 0)) + max(0, int(out_chars))
        prov["calls"]     = int(prov.get("calls", 0)) + 1
        _prune(days)


def _month_slice(days: dict) -> dict:
    """Aggregate across the current calendar month (UTC)."""
    today = datetime.now(timezone.utc).date()
    first = today.replace(day=1)
    totals: dict = {}
    for k, day in days.items():
        try:
            d = datetime.strptime(k, "%Y-%m-%d").date()
        except Exception:
            continue
        if d < first or d > today:
            continue
        for prov, usage in day.items():
            tslot = totals.setdefault(prov, {})
            for field, val in usage.items():
                if isinstance(val, (int, float)):
                    tslot[field] = tslot.get(field, 0) + val
    return totals


def snapshot(project_root: str) -> dict:
    """
    Return per-day and per-month aggregates, plus a derived 'approx_tokens'
    for AI providers using the rough ratio of 4 chars ≈ 1 token.
    """
    with _ledger(project_root).read() as data:
        days = data.get("days", {}) or {}
    today_key = _today_key()
    today = days.get(today_key, {})

    month = _month_slice(days)
    for prov, usage in month.items():
        if "in_chars" in usage or "out_chars" in usage:
            usage["approx_tokens_in"]  = int(usage.get("in_chars", 0) / 4)
            usage["approx_tokens_out"] = int(usage.get("out_chars", 0) / 4)

    series = []
    today_utc = datetime.now(timezone.utc).date()
    for i in range(29, -1, -1):
        d = today_utc - timedelta(days=i)
        k = d.strftime("%Y-%m-%d")
        day = days.get(k, {})
        # For the chart we just need a per-day scalar — use total chars
        # across providers as a rough "how noisy was today" gauge.
        total_chars = 0
        for usage in day.values():
            if isinstance(usage, dict):
                total_chars += int(usage.get("chars", 0))
                total_chars += int(usage.get("in_chars", 0))
                total_chars += int(usage.get("out_chars", 0))
        series.append({"date": k, "chars": total_chars})

    return {
        "today":      today,
        "month":      month,
        "series_30d": series,
    }


# ── Live ElevenLabs balance via their /v1/user endpoint ────────────────

def fetch_elevenlabs_balance(api_key: str) -> Optional[dict]:
    """
    Returns {character_count, character_limit, next_reset_unix} or None.
    Never raises.
    """
    if not api_key:
        return None
    try:
        import requests as _rq
        r = _rq.get(
            "https://api.elevenlabs.io/v1/user",
            headers={"xi-api-key": api_key},
            timeout=6,
        )
        if r.status_code != 200:
            return None
        data = r.json() or {}
        sub = data.get("subscription") or {}
        return {
            "character_count":           int(sub.get("character_count", 0)),
            "character_limit":           int(sub.get("character_limit", 0)),
            "next_character_count_reset_unix": sub.get("next_character_count_reset_unix"),
            "tier":                      sub.get("tier"),
            "currency":                  sub.get("currency"),
        }
    except Exception:
        return None

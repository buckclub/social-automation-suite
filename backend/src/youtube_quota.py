"""
Local YouTube Data API v3 quota ledger.

YouTube doesn't expose a real-time "how much have I used today" endpoint,
only a dashboard in Google Cloud Console. So we count every call WE make
against the documented unit cost table and persist a per-day ledger.

Per Google's docs:
  - videos.insert (upload):    1600 units
  - thumbnails.set:              50 units
  - search.list:                100 units
  - channels.list / videos.list:  1 unit each
  - most other reads:             1 unit

Quota resets at midnight Pacific time. We approximate by keying the
ledger on Pacific-local date — close enough for an 'are we about to
run out' gauge.

Ledger layout (`.cache/youtube_quota.json`):
  {
    "days": {
      "2026-04-23": { "total": 1712, "events": { "upload": 1, "search.list": 1, ... } },
      ...
    },
    "daily_limit": 10000
  }
"""
from __future__ import annotations
import json
import os
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

# Unit costs (units per call)
COST = {
    "videos.insert":       1600,
    "thumbnails.set":        50,
    "search.list":          100,
    "videos.list":            1,
    "channels.list":          1,
    "playlistItems.list":     1,
    "captions.insert":      400,
}

DEFAULT_DAILY_LIMIT = 10000  # Google's stock daily quota for a new project

# Pacific time = UTC-8 (PST) or UTC-7 (PDT). We approximate using a fixed
# UTC-8 offset — the ledger is a rough gauge, not a financial record, so
# the 1hr DST drift twice a year doesn't matter.
_PACIFIC_OFFSET = timedelta(hours=-8)

_lock = Lock()


def _ledger_path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "youtube_quota.json")


def _today_key() -> str:
    return (datetime.now(timezone.utc) + _PACIFIC_OFFSET).strftime("%Y-%m-%d")


def _load(path: str) -> dict:
    if not os.path.isfile(path):
        return {"days": {}, "daily_limit": DEFAULT_DAILY_LIMIT}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "days" not in data:
            data["days"] = {}
        if "daily_limit" not in data:
            data["daily_limit"] = DEFAULT_DAILY_LIMIT
        return data
    except Exception:
        return {"days": {}, "daily_limit": DEFAULT_DAILY_LIMIT}


def _save(path: str, data: dict) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except Exception:
        pass


def _prune_old(days: dict, keep_days: int = 30) -> None:
    if len(days) <= keep_days:
        return
    # Keep the most recent `keep_days` by date string lexicographically
    # (ISO-formatted dates sort correctly).
    for k in sorted(days.keys())[:-keep_days]:
        days.pop(k, None)


def record(project_root: str, operation: str, units: Optional[int] = None) -> None:
    """
    Log one API call. `operation` is a stable tag like "videos.insert" (used
    for the unit lookup + shown in the per-operation breakdown). `units`
    overrides the default cost — useful for future API operations we haven't
    hardcoded, or for partial-cost operations.
    """
    cost = units if units is not None else COST.get(operation, 1)
    with _lock:
        path = _ledger_path(project_root)
        data = _load(path)
        today = _today_key()
        day = data["days"].setdefault(today, {"total": 0, "events": {}})
        day["total"] = int(day.get("total", 0)) + int(cost)
        evs = day.setdefault("events", {})
        evs[operation] = int(evs.get(operation, 0)) + 1
        _prune_old(data["days"])
        _save(path, data)


def snapshot(project_root: str) -> dict:
    """
    Return current quota state for the UI:
      {
        today: "2026-04-23",
        daily_limit: 10000,
        used_today: 1712,
        remaining: 8288,
        pct_used: 17.1,
        events_today: { "videos.insert": 1, "search.list": 1 },
        history: [{ date, total }, ...last 14 days oldest→newest],
        reset_at: <next Pacific midnight as ISO UTC>,
      }
    """
    path = _ledger_path(project_root)
    data = _load(path)
    today = _today_key()
    day = data["days"].get(today, {"total": 0, "events": {}})
    limit = int(data.get("daily_limit") or DEFAULT_DAILY_LIMIT)
    used = int(day.get("total", 0))
    remaining = max(0, limit - used)
    pct = (used / limit * 100.0) if limit > 0 else 0.0

    history_keys = sorted(data["days"].keys())[-14:]
    history = [{"date": k, "total": int(data["days"][k].get("total", 0))} for k in history_keys]

    # Next reset: next Pacific midnight. We compute the Pacific date of "now",
    # then +1 day, set to 00:00 Pacific, convert back to UTC.
    now_utc = datetime.now(timezone.utc)
    now_pac = now_utc + _PACIFIC_OFFSET
    next_pac_midnight = (now_pac + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    next_reset_utc = next_pac_midnight - _PACIFIC_OFFSET
    reset_iso = next_reset_utc.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "today":         today,
        "daily_limit":   limit,
        "used_today":    used,
        "remaining":     remaining,
        "pct_used":      round(pct, 1),
        "events_today":  day.get("events", {}),
        "history":       history,
        "reset_at":      reset_iso,
        "seconds_until_reset": max(0, int(next_reset_utc.timestamp() - time.time())),
    }


def set_daily_limit(project_root: str, limit: int) -> None:
    """Override the daily limit (e.g. if the user got a quota bump from Google)."""
    with _lock:
        path = _ledger_path(project_root)
        data = _load(path)
        data["daily_limit"] = max(1, int(limit))
        _save(path, data)


def reset_today(project_root: str) -> None:
    """Clear today's counter — useful if you know Google gave you a reset or
    the ledger drifted from reality."""
    with _lock:
        path = _ledger_path(project_root)
        data = _load(path)
        data["days"][_today_key()] = {"total": 0, "events": {}}
        _save(path, data)

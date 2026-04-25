"""
Per-day render history ledger.

Feeds the Dashboard's "last 30 days" chart so the user can see their
trend — successes vs. failures per day, avg render time, a feel for
whether they're trending up or haven't shipped in a week.

Stored at `.cache/render_history.json`:
  {
    "days": {
      "2026-04-23": {
        "renders":       12,          # total attempts on this day
        "successes":     11,          # renders that produced an mp4
        "failures":       1,          # renders that errored out
        "total_time_s":  842.5,       # sum of render_time_s across all
        "resumes":        3,          # how many were resume-video runs
      },
      ...
    }
  }

Keyed by UTC date — simple and consistent with how the rest of the app
timestamps.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta

from json_ledger import get_ledger

KEEP_DAYS = 90   # prune anything older so the file stays small


def _path(project_root: str) -> str:
    d = os.path.join(project_root, ".cache")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "render_history.json")


def _ledger(project_root: str):
    return get_ledger(_path(project_root), default={"days": {}})


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _prune(days: dict, keep: int = KEEP_DAYS) -> None:
    if len(days) <= keep:
        return
    for k in sorted(days.keys())[:-keep]:
        days.pop(k, None)


def record(project_root: str, *, success: bool, render_time_s: float = 0.0, resume: bool = False) -> None:
    """Add one render attempt to today's counter."""
    with _ledger(project_root).mutate() as data:
        days = data.setdefault("days", {})
        day = days.setdefault(_today_key(), {
            "renders": 0, "successes": 0, "failures": 0,
            "total_time_s": 0.0, "resumes": 0,
        })
        day["renders"] = int(day.get("renders", 0)) + 1
        if success:
            day["successes"] = int(day.get("successes", 0)) + 1
        else:
            day["failures"] = int(day.get("failures", 0)) + 1
        if render_time_s:
            day["total_time_s"] = float(day.get("total_time_s", 0.0)) + float(render_time_s)
        if resume:
            day["resumes"] = int(day.get("resumes", 0)) + 1
        _prune(days)


def snapshot(project_root: str, *, days: int = 30) -> dict:
    """
    Return the last `days` of history in ascending date order, plus
    aggregates used by the Dashboard stats row.
    """
    with _ledger(project_root).read() as data:
        days_map = data.get("days", {}) or {}

    # Build a complete day-by-day series even for days with zero activity
    # so the chart has a continuous x-axis.
    today_utc = datetime.now(timezone.utc).date()
    series = []
    for i in range(days - 1, -1, -1):
        d = today_utc - timedelta(days=i)
        k = d.strftime("%Y-%m-%d")
        day = days_map.get(k, {})
        series.append({
            "date":         k,
            "renders":      int(day.get("renders", 0)),
            "successes":    int(day.get("successes", 0)),
            "failures":     int(day.get("failures", 0)),
            "total_time_s": float(day.get("total_time_s", 0.0)),
            "resumes":      int(day.get("resumes", 0)),
        })

    total_renders   = sum(d["renders"] for d in series)
    total_success   = sum(d["successes"] for d in series)
    total_time_s    = sum(d["total_time_s"] for d in series)
    avg_render_time = round(total_time_s / total_success, 1) if total_success else 0.0
    success_rate    = round(total_success / total_renders * 100, 1) if total_renders else 0.0
    today_row       = series[-1] if series else {"renders": 0, "successes": 0, "failures": 0}

    return {
        "series":          series,
        "days_covered":    days,
        "totals": {
            "renders":       total_renders,
            "successes":     total_success,
            "failures":      total_renders - total_success,
            "success_rate":  success_rate,
            "avg_render_s":  avg_render_time,
        },
        "today": {
            "renders":   today_row.get("renders", 0),
            "successes": today_row.get("successes", 0),
            "failures":  today_row.get("failures", 0),
        },
    }

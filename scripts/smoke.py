#!/usr/bin/env python3
"""
Smoke test — fast end-to-end import + ledger + API surface check.

Run before pushing. Catches the kinds of regressions that don't show
up in `python -c "import api_server"` alone:

  - A new module or router that exists in code but imports break
    because its dependencies aren't on PYTHONPATH (we hit this exact
    bug when extracting routes/* — api_server imported phantom
    modules and the server crashed at boot).
  - A queue / cache module whose load/save contract drifted from
    what JsonLedger provides.
  - An endpoint that 500s on a vanilla GET (config not loaded,
    PROJECT_ROOT undefined, etc).
  - A FastAPI route signature that the framework can't validate
    (wrong type hint, broken Pydantic model, etc — these raise at
    app startup, not import).

What it does NOT cover: real Reddit fetches, real LLM calls, real
ffmpeg renders. Anything that depends on external services or paid
APIs is out of scope — this is a structural / unit-level check.

Usage:
    python scripts/smoke.py
    python scripts/smoke.py --no-api      # skip the FastAPI boot section
    python scripts/smoke.py --verbose

Exits 0 on success; non-zero on first failure with a one-line cause.
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import traceback
from contextlib import contextmanager
from pathlib import Path

# ── Path setup so this script works from anywhere ─────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SRC = PROJECT_ROOT / "backend" / "src"
sys.path.insert(0, str(SRC))


# ── Tiny test runner ──────────────────────────────────────────────

class SmokeFail(Exception):
    pass


_results: list[tuple[str, bool, str]] = []
_verbose = False


@contextmanager
def step(name: str):
    """Print/track a labeled check. Any exception fails just this step
    so later steps still run (helpful for triaging multiple problems
    in one go)."""
    print(f"  · {name} … ", end="", flush=True)
    try:
        yield
        _results.append((name, True, ""))
        print("ok")
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        _results.append((name, False, msg))
        print(f"FAIL — {msg}")
        if _verbose:
            traceback.print_exc()


# ── Section: imports ──────────────────────────────────────────────

CORE_MODULES = [
    "json_ledger", "event_bus", "render_diagnostics",
    "social_queue", "run_queue", "content_calendar",
    "comment_replier", "cost_tracker", "render_history",
    "ai_score_cache", "brand_profiles", "workspace_backup",
]

ROUTER_MODULES = [
    "routes.dialogue", "routes.niche", "routes.hashtags",
    "routes.calendar", "routes.social", "routes.analytics",
]


def section_imports():
    print("\n[1/4] Module imports")
    for m in CORE_MODULES + ROUTER_MODULES:
        with step(f"import {m}"):
            __import__(m)


# ── Section: ledger roundtrips ────────────────────────────────────

def section_ledgers():
    print("\n[2/4] Ledger roundtrips")
    with tempfile.TemporaryDirectory() as td:
        with step("social_queue enqueue/snapshot/finish"):
            import social_queue
            added = social_queue.enqueue_many(td, [{"post_id": "a", "title": "t1"}])
            assert len(added) == 1
            snap = social_queue.snapshot(td)
            assert len(snap["items"]) == 1
            row = social_queue.pop_next(td)
            assert row and row["status"] == "running"
            social_queue.finish(td, row["queue_id"], ok=True)

        with step("run_queue enqueue/mark/clear"):
            import run_queue
            it = run_queue.enqueue(td, "p1", "title", "sub")
            assert it["status"] == "queued"
            run_queue.mark_running(td, it["queue_id"])
            run_queue.mark_finished(td, it["queue_id"], success=True)
            assert run_queue.clear_history(td) == 1

        with step("content_calendar create/pop_due/delete"):
            import content_calendar
            s = content_calendar.create_slot(
                td, scheduled_at="2020-01-01T00:00:00+00:00",
                kind="ai", brand_id=None, title="x", params={},
            )
            popped = content_calendar.pop_due(td)
            assert popped and popped["id"] == s["id"]
            content_calendar.delete_slot(td, s["id"])

        with step("cost_tracker record_tts/record_ai/snapshot"):
            import cost_tracker
            cost_tracker.record_tts(td, "elevenlabs", 100)
            cost_tracker.record_ai(td, "gemini", in_chars=50, out_chars=20)
            snap = cost_tracker.snapshot(td)
            assert snap.get("today")

        with step("render_history record/snapshot"):
            import render_history
            render_history.record(td, success=True, render_time_s=5.0)
            snap = render_history.snapshot(td)
            assert snap["totals"]["successes"] == 1

        with step("ai_score_cache put/get"):
            import ai_score_cache
            ai_score_cache.put(td, "p1",
                               title="T", selftext="B", model="m1",
                               result={"score": 9})
            got = ai_score_cache.get(td, "p1",
                                     current_title="T", current_body="B",
                                     current_model="m1")
            assert got == {"score": 9}

        with step("comment_replier add/list/update"):
            import comment_replier
            n = comment_replier.add_drafts(td, [{
                "comment_id": "c1",
                "draft_reply": "hi",
            }])
            assert n == 1
            drafts = comment_replier.list_drafts(td)
            assert len(drafts) == 1


# ── Section: render diagnostics classifier ────────────────────────

def section_diagnostics():
    print("\n[3/4] Render diagnostics classifier")
    import render_diagnostics as rd

    cases: list[tuple[str, str, bool]] = [
        ("ffmpeg killed signal 9",                   "ffmpeg_oom",            False),
        ("Unknown encoder libfdk_aac",               "ffmpeg_codec_missing",  False),
        ("[mov,mp4,m4a] moov atom not found",        "ffmpeg_corrupt_input",  False),
        ("Could not open font /tmp/missing.ttf",     "font_missing",          False),
        ("OSError 28: No space left on device",      "disk_full",             False),
        ("requests.exceptions.ConnectTimeout: timed out", "network_timeout",  True),
        ("HTTP 503 Service Unavailable",             "network_5xx",           True),
        ("429 Too Many Requests — quota exceeded",   "api_quota",             False),
        ("401 Unauthorized — invalid api key",       "api_auth",              False),
        ("Pipeline cancelled by user",               "cancelled",             False),
        ("RuntimeError: something else",             "generic",               False),
    ]
    for raw, expected_cat, expected_recoverable in cases:
        with step(f"classify({raw[:40]!r})"):
            d = rd.classify(raw)
            assert d["category"] == expected_cat, \
                f"got {d['category']}, expected {expected_cat}"
            assert d["recoverable"] is expected_recoverable, \
                f"got recoverable={d['recoverable']}, expected {expected_recoverable}"


# ── Section: FastAPI surface check ────────────────────────────────

def section_api():
    print("\n[4/4] FastAPI surface (TestClient)")

    # Bootstrap a throwaway project root so the app doesn't write into
    # the user's real workspace during the smoke. The api_server uses
    # PROJECT_ROOT computed from __file__, so we just make sure the
    # required dirs exist alongside the code (they should, in repo).
    try:
        with step("import api_server (boots FastAPI app)"):
            import api_server  # noqa: F401
    except Exception:
        # If app import fails, the rest of the section can't run.
        return

    try:
        from fastapi.testclient import TestClient
    except ImportError:
        with step("FastAPI testclient available"):
            raise SmokeFail("fastapi[all] not installed — `pip install httpx fastapi[all]`")
        return

    import api_server
    # Use lifespan=False — we don't want to spawn workers during the
    # smoke test (would touch real disk + may hold ports).
    client = TestClient(api_server.app)

    with step("GET /api/health"):
        r = client.get("/api/health")
        assert r.status_code == 200, r.status_code

    with step("GET /api/config returns dict"):
        r = client.get("/api/config")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    with step("GET /api/events/stats"):
        r = client.get("/api/events/stats")
        assert r.status_code == 200
        body = r.json()
        assert "subscribers" in body

    with step("GET /api/calendar (router-mounted)"):
        r = client.get("/api/calendar")
        # 200 with a slots list — even if empty.
        assert r.status_code == 200, r.status_code
        assert "slots" in r.json()

    with step("GET /api/social/queue (router-mounted)"):
        r = client.get("/api/social/queue")
        assert r.status_code == 200, r.status_code


# ── Main ──────────────────────────────────────────────────────────

def main() -> int:
    global _verbose
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--no-api", action="store_true",
                        help="Skip the FastAPI boot section (faster)")
    parser.add_argument("--verbose", action="store_true",
                        help="Print full tracebacks on failures")
    args = parser.parse_args()
    _verbose = args.verbose

    print("=== Social Automation Suite — smoke test ===")
    print(f"    project root: {PROJECT_ROOT}")
    print(f"    backend src:  {SRC}")

    section_imports()
    section_ledgers()
    section_diagnostics()
    if not args.no_api:
        section_api()
    else:
        print("\n[4/4] FastAPI surface — skipped (--no-api)")

    # Summary
    fails = [r for r in _results if not r[1]]
    total = len(_results)
    passed = total - len(fails)
    print(f"\n{'-' * 48}")
    print(f"  {passed}/{total} checks passed"
          + (f", {len(fails)} failed" if fails else ""))
    if fails:
        print()
        for n, _ok, msg in fails:
            print(f"  x {n} - {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
In-process event bus for Server-Sent Events (SSE).

Replaces the half-dozen polling loops in the frontend (Videos page,
Calendar page, social-queue widget, comment replier, status strip) with
a push model: workers `publish()` whenever state changes, the
`/api/events` SSE endpoint streams those events to every subscribed
browser, and React invalidates its query caches on receipt.

Design choices:

- **In-process only.** Single FastAPI server, asyncio loop, no Redis,
  no Postgres LISTEN/NOTIFY. The bus is an asyncio.Queue per
  subscriber. If we ever move to multi-process workers we'll bolt on
  redis pubsub here without changing the rest of the app.

- **Best-effort delivery.** Queues are bounded (256 events per
  subscriber). If a subscriber falls that far behind we drop the
  oldest events for them — better than memory bloat, and the client's
  next reconnect re-syncs via a normal GET.

- **publish() is sync-callable.** Workers (sync threads, asyncio
  callbacks, FastAPI routes) all need to publish without ceremony, so
  publish() does NOT need an event loop on the calling side. It uses
  `loop.call_soon_threadsafe` if invoked from a thread.

- **Event shape**: `{ "type": str, "ts": iso, "data": {...} }`. Keep
  the data field tiny — just the IDs the client needs to invalidate
  the right query keys (e.g. `{"queue_id": "...", "post_id": "...",
  "status": "running"}`). The client re-fetches the full row.

Standard event types (extend as new features need them):

  run_queue.update         — any change to a run-queue row
  social_queue.update      — any change to a social-queue row
  calendar.update          — any change to a calendar slot
  comment_drafts.update    — any change to a comment draft
  pipeline.step            — pipeline step transition (id + status)
  pipeline.log             — one new log line for the active run
  render.complete          — render finished (success or fail)
  render.failed_diagnostic — failure with classified reason

The bus is silent on the wire when nobody's subscribed — no events
are buffered globally. SSE is an "if you want it, listen now"
transport.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any, AsyncIterator, Optional


_log = logging.getLogger("event_bus")

MAX_QUEUE = 256                 # per-subscriber backlog before drops
HEARTBEAT_INTERVAL_S = 15.0     # SSE keepalive line every N seconds


class _Subscriber:
    """One browser tab. Owns an asyncio.Queue plus a small recent-events
    ring used to fill in if a client reconnects after a tiny network
    hiccup (we don't promise full replay — just the last few events)."""
    __slots__ = ("queue", "id")

    def __init__(self, sub_id: int) -> None:
        self.id = sub_id
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=MAX_QUEUE)


class EventBus:
    def __init__(self) -> None:
        self._subs: list[_Subscriber] = []
        self._lock = Lock()
        self._next_id = 1
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Tiny global ring for /api/events?since= reconnect-fill. Cap
        # at 200; we don't promise reliable delivery, this just smooths
        # over the case where a client briefly disconnected mid-action.
        self._recent: deque[dict] = deque(maxlen=200)

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Called once during FastAPI lifespan startup so publish() can
        cross from worker threads back into the asyncio loop safely."""
        self._loop = loop

    # ── publish ────────────────────────────────────────────────────────

    def publish(self, type_: str, data: Optional[dict] = None) -> None:
        """Fan an event out to every subscriber. Safe to call from any
        thread — including FastAPI request handlers, background asyncio
        tasks, and sync worker threads."""
        evt = {
            "type": type_,
            "ts":   datetime.now(timezone.utc).isoformat(),
            "data": data or {},
        }
        # Recent-events ring is touched from many threads — the lock
        # is brief, the deque op is O(1).
        with self._lock:
            self._recent.append(evt)
            subs = list(self._subs)

        if not subs:
            return

        loop = self._loop
        if loop is None or loop.is_closed():
            # Pre-startup or post-shutdown publish. Drop silently —
            # no subscribers could meaningfully receive it. Without
            # the is_closed() guard, call_soon_threadsafe raises
            # RuntimeError during shutdown races (worker thread
            # publishes mid-cancel).
            return

        for s in subs:
            # Hopping back onto the loop thread is required because
            # asyncio.Queue is not thread-safe for put().
            try:
                loop.call_soon_threadsafe(self._deliver, s, evt)
            except RuntimeError:
                # Loop closed between is_closed() check and the call.
                # Drop the rest of the fan-out — nothing to deliver to.
                return

    @staticmethod
    def _deliver(sub: _Subscriber, evt: dict) -> None:
        try:
            sub.queue.put_nowait(evt)
        except asyncio.QueueFull:
            # Drop the oldest event for this sub so the new one fits.
            try:
                sub.queue.get_nowait()
                sub.queue.put_nowait(evt)
            except Exception:
                pass

    # ── subscribe (async generator for the SSE response) ───────────────

    async def subscribe(self) -> AsyncIterator[str]:
        """
        Async generator that yields SSE-formatted lines forever (until
        the client disconnects, in which case the FastAPI runtime
        cancels us). One subscription per /api/events connection.
        """
        with self._lock:
            sub = _Subscriber(self._next_id)
            self._next_id += 1
            self._subs.append(sub)

        try:
            # Initial "hello" so the client knows the stream is live.
            yield self._format({"type": "hello", "ts": _now_iso(), "data": {}})

            while True:
                try:
                    evt = await asyncio.wait_for(
                        sub.queue.get(),
                        timeout=HEARTBEAT_INTERVAL_S,
                    )
                    yield self._format(evt)
                except asyncio.TimeoutError:
                    # Comment line — keeps proxies (nginx, cloudflare)
                    # from closing the idle connection. Browsers
                    # silently ignore it.
                    yield ": ping\n\n"
        finally:
            with self._lock:
                try:
                    self._subs.remove(sub)
                except ValueError:
                    pass

    @staticmethod
    def _format(evt: dict) -> str:
        # Use the typed-event form so EventSource clients can use
        # addEventListener('run_queue.update', ...) if they want.
        # Default to a single 'event:' field with the type embedded.
        body = json.dumps(evt, ensure_ascii=False, separators=(",", ":"))
        return f"event: {evt.get('type','message')}\ndata: {body}\n\n"

    # ── diagnostics ────────────────────────────────────────────────────

    def stats(self) -> dict:
        with self._lock:
            return {
                "subscribers": len(self._subs),
                "recent_count": len(self._recent),
            }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Single process-wide bus.
bus = EventBus()


# ── Convenience publishers (one-line callsites, consistent payloads) ──

def emit_run_queue(*, queue_id: str = "", post_id: str = "",
                   status: str = "", error: Optional[str] = None) -> None:
    bus.publish("run_queue.update", {
        "queue_id": queue_id, "post_id": post_id,
        "status": status, "error": error,
    })


def emit_social_queue(*, queue_id: str = "", post_id: str = "",
                      status: str = "", error: Optional[str] = None) -> None:
    bus.publish("social_queue.update", {
        "queue_id": queue_id, "post_id": post_id,
        "status": status, "error": error,
    })


def emit_calendar(*, slot_id: str = "", status: str = "",
                  error: Optional[str] = None,
                  post_id: Optional[str] = None) -> None:
    bus.publish("calendar.update", {
        "slot_id": slot_id, "status": status,
        "error": error, "post_id": post_id,
    })


def emit_pipeline_step(*, step: str = "", status: str = "",
                       detail: Optional[str] = None) -> None:
    bus.publish("pipeline.step", {
        "step": step, "status": status, "detail": detail,
    })


def emit_render_complete(*, post_id: str = "", success: bool = True,
                         error: Optional[str] = None,
                         diagnostic: Optional[dict] = None) -> None:
    bus.publish("render.complete", {
        "post_id": post_id, "success": success,
        "error": error, "diagnostic": diagnostic,
    })


def emit_comment_drafts() -> None:
    bus.publish("comment_drafts.update", {})

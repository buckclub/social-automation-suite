"""
JsonLedger — one tiny class that replaces the load/save/atomic-write/lock
boilerplate duplicated across ~7 cache files (social_queue, run_queue,
content_calendar, comment_replier, ai_score_cache, cost_tracker,
render_history, …).

Why this exists: every queue/cache module in this codebase had its own
private `_load(p)` + `_save(p, data)` pair, all doing the same thing
(json.load with a try/except → tmpfile + os.replace), all with their own
`threading.Lock()`. ~300 lines of near-identical code, and any future
improvement (retry, fsync, cross-process locking) had to be applied
seven times. This module collapses that to one well-tested helper.

Usage — the typical migration:

    # before
    _lock = threading.Lock()
    def _load(p): ...
    def _save(p, data): ...
    def add_item(root, x):
        p = _path(root)
        with _lock:
            data = _load(p)
            data["items"].append(x)
            _save(p, data)

    # after
    def _ledger(root):
        return JsonLedger(_path(root), default={"items": []})

    def add_item(root, x):
        with _ledger(root).mutate() as data:
            data["items"].append(x)

The helper is path-keyed: callers cache one JsonLedger per project_root
so the lock survives across calls. Threading.Lock is reentrant-safe
(`mutate()` does NOT use RLock — don't nest mutates from the same
thread; do all the work inside one block).

Concurrency model:
- Single-process, multi-thread (FastAPI worker threads + asyncio
  background workers in the same process). A `threading.Lock` is enough
  — no cross-process coordination, no fsync drama.
- Atomic write: `path.tmp` → `os.replace(tmp, path)`. POSIX guarantees
  this is atomic; on Windows os.replace also clobbers existing files.
"""
from __future__ import annotations

import copy
import json
import os
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Optional


# Module-level registry — one Lock per absolute path so two callers
# constructing JsonLedger for the same file share the same lock.
_LOCKS: dict[str, threading.Lock] = {}
_REGISTRY_LOCK = threading.Lock()


def _lock_for(path: str) -> threading.Lock:
    abs_path = os.path.abspath(path)
    with _REGISTRY_LOCK:
        lk = _LOCKS.get(abs_path)
        if lk is None:
            lk = threading.Lock()
            _LOCKS[abs_path] = lk
        return lk


class JsonLedger:
    """
    Thin atomic-JSON wrapper. Construct one per file path; methods are
    safe to call from multiple threads.

    Args:
        path:    absolute or project-relative path to the .json file.
        default: deep-copied and returned when the file is missing or
                 unreadable. Pass `{"items": []}` for list-style ledgers,
                 `{}` for plain dicts.
        lock:    True (default) to serialize all reads/writes via a
                 process-wide lock keyed on the absolute path. Pass
                 False for read-through caches where collisions are
                 benign (e.g. per-key trend caches).
        indent:  json.dump indent (default 2 — keeps the files
                 hand-readable and diff-friendly).
    """
    __slots__ = ("path", "default", "_lock", "indent")

    def __init__(
        self,
        path: str,
        *,
        default: Any = None,
        lock: bool = True,
        indent: int = 2,
    ) -> None:
        self.path = path
        self.default = default if default is not None else {}
        self._lock = _lock_for(path) if lock else None
        self.indent = indent

    # ── basic ops ──────────────────────────────────────────────────────

    def load(self) -> Any:
        """Return parsed JSON, or a fresh deep copy of `default` on
        FileNotFoundError / parse error / any other read failure. Never
        raises — callers that need to distinguish 'missing' vs 'corrupt'
        should check `os.path.exists` themselves first."""
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return copy.deepcopy(self.default)

    def save(self, data: Any) -> None:
        """Atomic write: tmp → os.replace. Creates parent dir if
        missing. Failures are swallowed (matching the pre-refactor
        behavior where transient disk errors didn't crash the queue);
        the next successful save catches up."""
        try:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=self.indent, ensure_ascii=False)
            os.replace(tmp, self.path)
        except OSError:
            # Intentional: best-effort writes match the old _save() bodies.
            pass

    # ── locked mutate ──────────────────────────────────────────────────

    @contextmanager
    def mutate(self) -> Iterator[Any]:
        """
        Lock → load → yield → save → unlock. The yielded value is the
        live parsed object — mutate it in place; it gets written back on
        a clean exit. If the block raises, NO save happens (the lock is
        released and the exception propagates).

        Usage:
            with ledger.mutate() as data:
                data["items"].append(...)
        """
        if self._lock is not None:
            self._lock.acquire()
        try:
            data = self.load()
            yield data
            self.save(data)
        finally:
            if self._lock is not None:
                self._lock.release()

    @contextmanager
    def read(self) -> Iterator[Any]:
        """
        Lock → load → yield (no save). For 'snapshot' style reads where
        you want a consistent view but won't mutate. The yielded object
        is a deep copy when locked (otherwise the caller could mutate
        the cache between save events) — actually the simpler contract
        is: callers must NOT mutate the returned value. We just hand
        back the parsed dict.
        """
        if self._lock is not None:
            self._lock.acquire()
        try:
            yield self.load()
        finally:
            if self._lock is not None:
                self._lock.release()


# ── Convenience: cache one ledger per (path, default) so callers don't
# re-build them each call. Thread-safe. ───────────────────────────────────
_LEDGERS: dict[str, JsonLedger] = {}


def get_ledger(path: str, *, default: Any = None, lock: bool = True,
               indent: int = 2) -> JsonLedger:
    """
    Get-or-create a JsonLedger for `path`. The first call's `default` /
    `lock` / `indent` win — subsequent calls return the cached
    instance regardless of args, so always pass the same args for a
    given path. Use this when you want one global ledger object instead
    of constructing a new JsonLedger() on every queue method.
    """
    key = os.path.abspath(path)
    lg = _LEDGERS.get(key)
    if lg is None:
        with _REGISTRY_LOCK:
            lg = _LEDGERS.get(key)
            if lg is None:
                lg = JsonLedger(path, default=default, lock=lock, indent=indent)
                _LEDGERS[key] = lg
    return lg

"""
Modular pipeline engine — shared by the clip maker (and, in a later pass,
the Reddit video pipeline when we extract its steps here).

A `Pipeline` is an ordered list of `PipelineStep` instances that are run
in sequence. Each step gets a mutable `PipelineContext` dict-like object
to read inputs and stash outputs for downstream steps. The engine handles:

  - Skipping steps whose `applicable()` returns False (e.g. 'no hook to
    prepend' when AI Hooks are disabled).
  - Calling a progress callback with step id + status + optional detail,
    so the UI can render the same timeline component the Reddit pipeline
    uses today.
  - Wrapping step exceptions so one bad step fails the whole run but
    leaves the context + history intact for debugging.

Usage:

    pipeline = Pipeline([SliceStep(), WhisperStep(), RenderStep()])
    ctx = PipelineContext({"source_file": "...", "start": 10, "end": 40})
    await pipeline.run(ctx, on_progress=my_callback)

The legacy `_run_pipeline_async` in api_server.py stays as-is for now —
this module is purely additive until the Reddit path is migrated over.
"""
from __future__ import annotations
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional


class PipelineContext(dict):
    """
    Plain dict wrapper with attribute access and a progress helper. Using
    a dict (rather than dataclasses) keeps steps loosely coupled — a step
    can stash any field name without bloating a shared schema.
    """
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value


class PipelineStep:
    """
    Override `id`, `title`, and `run()`. Optionally override
    `applicable()` for steps that only run under certain conditions.
    """
    id: str = "step"
    title: str = "Step"

    def applicable(self, ctx: PipelineContext) -> bool:
        return True

    async def run(self, ctx: PipelineContext, progress: "ProgressFn") -> None:
        raise NotImplementedError


# Progress callback shape — lets the engine stream step lifecycle events
# out to anything that wants them (api_server state mirror, logs, WS).
#
#   progress(step_id, status, detail="", extra={...})
#
# status ∈ {"running", "done", "error", "skipped", "sub"}
# - "sub" is used by long steps to push a sub-progress update without
#   changing their overall status (e.g. whisper segment 12/40).
ProgressFn = Callable[[str, str, str, Optional[dict]], None]


class Pipeline:
    def __init__(self, steps: list[PipelineStep]):
        self.steps = steps

    @property
    def step_summaries(self) -> list[dict]:
        return [{"id": s.id, "title": s.title, "status": "idle", "detail": "",
                 "started_at": None, "finished_at": None} for s in self.steps]

    async def run(self, ctx: PipelineContext, progress: ProgressFn) -> None:
        """
        Run every applicable step in order. Raises the original exception
        from the first failing step so the caller can decide how to react,
        but not before recording the failure via progress().
        """
        for step in self.steps:
            if not step.applicable(ctx):
                progress(step.id, "skipped", "not applicable", None)
                continue
            started = time.time()
            progress(step.id, "running", "", None)
            try:
                await step.run(ctx, progress)
            except Exception as e:  # noqa: BLE001 — intentional
                progress(step.id, "error", str(e)[:300], {"exception": repr(e)})
                ctx["_failed_step"] = step.id
                ctx["_error"] = str(e)
                raise
            progress(step.id, "done", f"{time.time() - started:.1f}s", None)


# ── Shared helpers for step implementations ────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

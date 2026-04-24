"""
Declarative definition of the Reddit / AI-content pipeline as
`pipeline_core.PipelineStep` instances.

This is an INCREMENTAL migration — the steps here don't yet carry all
the heavy logic from `_run_pipeline_async` in api_server.py (that would
be a week-long refactor against live code). Instead each step owns the
metadata (id, title, applicability rules) and a stub `run()` that the
orchestrator can call if/when we fully extract phase logic. For now
api_server continues to run the monolithic function; reddit_pipeline
exists so:

  1. The UI can list the canonical Reddit steps from a single source of
     truth shared with Clip Maker (see REDDIT_STEP_DEFS).
  2. Future features (retry-from-step, per-step logs, pluggable
     before/after hooks) have a clean anchor to extend.
  3. The Clip pipeline (clip_pipeline.CLIP_PIPELINE) and the Reddit
     pipeline both speak the same PipelineStep language — no more two
     parallel abstractions.

When we do the full migration, each step's `run()` method moves from
delegating back into api_server into owning its phase directly. The
public shape (Pipeline + PipelineContext + ProgressFn) stays the same,
so the consumers (api_server dispatchers + the UI step timeline) don't
need changes.
"""
from __future__ import annotations
from pipeline_core import Pipeline, PipelineContext, PipelineStep


# ── Step definitions ────────────────────────────────────────────────

class AIGenerateStep(PipelineStep):
    id = "ai_generate"
    title = "AI Content Generation"

    def applicable(self, ctx: PipelineContext) -> bool:
        # Only applies when the pipeline was started from 'Generate with AI'.
        return bool(ctx.get("ai_content_mode"))

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside run_pipeline_ai in api_server.py for now.
        # Full migration extracts the AIContentGenerator call into here.
        pass


class FetchPostStep(PipelineStep):
    id = "fetch"
    title = "Fetch Reddit Post"

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside _run_pipeline_async fetch phase.
        pass


class FormatStoryStep(PipelineStep):
    id = "format"
    title = "Format Story"

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside _run_pipeline_async format phase.
        pass


class TTSStep(PipelineStep):
    id = "tts"
    title = "Generate TTS Audio"

    def applicable(self, ctx: PipelineContext) -> bool:
        tts_cfg = (ctx.get("config") or {}).get("tts") or {}
        return bool(tts_cfg.get("enabled", True))

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside _run_pipeline_async TTS phase.
        pass


class VideoRenderStep(PipelineStep):
    id = "video"
    title = "Render Video"

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside _run_pipeline_async render phase.
        pass


class ThumbnailStep(PipelineStep):
    id = "thumbnail"
    title = "Generate Thumbnail"

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside _run_pipeline_async thumbnail phase.
        pass


class NotifyStep(PipelineStep):
    id = "notify"
    title = "Notify"

    def applicable(self, ctx: PipelineContext) -> bool:
        disc = (ctx.get("config") or {}).get("discord") or {}
        return bool(disc.get("enabled") and disc.get("webhook_url"))

    async def run(self, ctx: PipelineContext, progress) -> None:
        # Delegated: handled inside _run_pipeline_async notify phase.
        pass


# ── The composed pipeline ──────────────────────────────────────────

REDDIT_PIPELINE = Pipeline([
    AIGenerateStep(),
    FetchPostStep(),
    FormatStoryStep(),
    TTSStep(),
    VideoRenderStep(),
    ThumbnailStep(),
    NotifyStep(),
])


# ── Canonical step list for the initial pipeline_state shape ──────
# Used in place of the old hardcoded list in api_server.py so the
# source of truth lives with the pipeline definition.

REDDIT_STEP_DEFS: list[dict] = [
    {"id": s.id, "title": s.title, "status": "idle", "detail": ""}
    for s in REDDIT_PIPELINE.steps
]

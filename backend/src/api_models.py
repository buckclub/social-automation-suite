"""
Pydantic request models for the high-traffic generation routes.

Why this module exists: most routes used to take `req: dict` and reach
in with `req.get("foo") or default`, with hand-rolled type coercion
and clamping inline. That pattern is fast to write but:

  - Validation drifts between similar endpoints.
  - Errors are inconsistent (some return 400 with a string, some
    silently coerce, some let an int(None) raise to 500).
  - The contract is invisible — you have to read every line of the
    handler to know what it accepts.

These Pydantic models surface the contract once, validate consistently,
and produce structured 422 errors at the framework boundary so the
handler bodies focus on business logic.

`model_config = ConfigDict(extra="ignore")` is intentional — the
frontend will sometimes send extra fields (loaded from saved drafts /
presets, debug params, future expansion) and we don't want a
schema-evolution mismatch to break a client that's slightly ahead or
behind. We log warnings via standard Pydantic; rejecting extras would
need a coordinated frontend release.
"""
from __future__ import annotations

from typing import Any, Optional, Literal, Dict, List
from pydantic import BaseModel, ConfigDict, Field


# Provider / mode / filter unions that mirror the frontend's
# run-settings constants. These are the only string literals the API
# accepts for these fields — anything else now returns 422 instead of
# silently falling through to a default.
ContentStyle = Literal["story", "qa", "interactive", "hot_take"]
ContentFilter = Literal["safe", "normal", "edgy"]
Tone = Literal["dramatic", "funny", "heartfelt", "shocking", "cringe"]
VideoMode = Literal["short_reel", "reel", "long_reel", "full_video"]  # full_video kept for legacy compat
NarratorGender = Literal["auto", "male", "female"]
InteractiveFormat = Literal[
    "put_a_finger_down", "would_you_rather", "rate_yourself", "guess_the_answer",
]


# ── /api/ai/generate-variants ─────────────────────────────────────────
class GenerateVariantsRequest(BaseModel):
    """
    Body of POST /api/ai/generate-variants. Generates N candidate
    scripts in parallel and (optionally) retries until one beats a
    virality threshold. See generate_ai_variants() for the full flow.
    """
    model_config = ConfigDict(extra="ignore")

    content_style: ContentStyle = "story"
    niche: str = "relationship_drama"
    custom_topic: Optional[str] = None
    interactive_format: InteractiveFormat = "put_a_finger_down"
    content_filter: ContentFilter = "normal"
    target_audience: Optional[str] = None
    tone: Tone = "dramatic"

    # 1-5 candidates per attempt. Higher counts multiply token spend.
    count: int = Field(default=3, ge=1, le=5)

    # 0 = "no virality gate" (single pass). 50-95 = required score.
    # Anything below 50 is meaningless (model treats it as anything-goes).
    min_score: int = Field(default=0, ge=0, le=95)

    # When min_score > 0, the loop retries up to this many times until
    # any candidate clears the bar. 1-8 caps prevent runaway token spend.
    max_attempts: Optional[int] = Field(default=None, ge=1, le=8)


# ── /api/pipeline/run-ai ──────────────────────────────────────────────
class RunAIRequest(BaseModel):
    """
    Body of POST /api/pipeline/run-ai. Either:
      a) generates a variant inline (when preselected_content is None
         and we go through the full AI generator), OR
      b) takes a preselected variant from the GenerateWithAIDialog
         picker and skips straight to render.
    """
    model_config = ConfigDict(extra="ignore")

    content_style: ContentStyle = "story"
    niche: str = "relationship_drama"
    custom_topic: Optional[str] = None
    custom_title: Optional[str] = None
    interactive_format: InteractiveFormat = "put_a_finger_down"
    video_mode: VideoMode = "short_reel"
    tts_enabled: bool = True
    narrator_gender: NarratorGender = "auto"
    voice_override: Optional[str] = None
    background_selector: Optional[str] = None
    content_filter: ContentFilter = "normal"
    target_audience: Optional[str] = None
    tone: Tone = "dramatic"
    # If supplied, skips the AI generator and uses this dict verbatim.
    # Shape matches what generate_ai_variants returns per variant.
    preselected_content: Optional[Dict[str, Any]] = None


# ── /api/pipeline/run-custom-script ───────────────────────────────────
class RunCustomScriptRequest(BaseModel):
    """
    Body of POST /api/pipeline/run-custom-script — for users supplying
    their own title + body (no Reddit fetch, no AI generation).
    """
    model_config = ConfigDict(extra="ignore")

    title: str = Field(..., min_length=1, max_length=300)
    body: str = Field(..., min_length=1)
    content_style: ContentStyle = "story"
    video_mode: VideoMode = "short_reel"
    tts_enabled: bool = True
    narrator_gender: NarratorGender = "auto"
    voice_override: Optional[str] = None
    background_selector: Optional[str] = None
    enqueue: bool = False
    # Q&A mode supplies comments; story/hot_take don't use this.
    comments: Optional[List[Dict[str, Any]]] = None


# ── /api/calendar (POST) ──────────────────────────────────────────────
class CreateCalendarSlotRequest(BaseModel):
    """
    Body of POST /api/calendar. The 'kind' field gates which params
    schema applies; for now only 'ai' is wired so we accept its shape
    loosely.
    """
    model_config = ConfigDict(extra="ignore")

    scheduled_at: str = Field(..., min_length=10)
    kind: Literal["ai"] = "ai"
    title: Optional[str] = None
    brand_id: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)

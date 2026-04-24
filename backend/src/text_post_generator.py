"""
Text-post generator: tweets, Reddit comments, YouTube community posts,
LinkedIn posts, IG captions, etc. Mirrors the shape of ai_content_generator
but produces short-form text (no TTS, no video).

Reuses the same filter / tone / target-audience building blocks as the
video pipeline so both surfaces speak the same language.
"""

import json
import os
import re
import sys
import time
from typing import Optional, List, Dict

if getattr(sys, "frozen", False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gemini_hooks import _call_ai, DEFAULT_OLLAMA_URL

# ── Filter / audience are identical to the video pipeline — import & reuse ──
from ai_content_generator import (
    _filter_instruction,
    _audience_instruction,
    TONE_INSTRUCTIONS as _VIDEO_TONE_INSTRUCTIONS,
)

# Text posts get two extra tones the video pipeline doesn't care about.
TONE_INSTRUCTIONS: Dict[str, str] = {
    **_VIDEO_TONE_INSTRUCTIONS,
    "professional": (
        "EMOTIONAL REGISTER: PROFESSIONAL\n"
        "- Polished, considered, business-appropriate.\n"
        "- No slang, no all-caps, no exclamation spam.\n"
        "- Sound like someone a recruiter would follow."
    ),
    "informative": (
        "EMOTIONAL REGISTER: INFORMATIVE\n"
        "- Lead with the thing the reader came to know.\n"
        "- Concrete facts, numbers, names. No fluff.\n"
        "- Neutral voice — you're explaining, not selling."
    ),
}

VALID_TONES = tuple(TONE_INSTRUCTIONS.keys())


def _tone_instruction(tone: Optional[str]) -> str:
    key = (tone or "professional").strip().lower()
    return TONE_INSTRUCTIONS.get(key, TONE_INSTRUCTIONS["professional"])


# ── Post-format catalog ──────────────────────────────────────────────
# Each format is a (platform-aware) prompt recipe. char_limit is the
# default; the caller can override per run.

POST_FORMATS: Dict[str, Dict] = {
    "tweet": {
        "label": "Tweet / X post",
        "char_limit": 280,
        "rules": [
            "Single tweet, hook in the first line.",
            "No markdown, no headings.",
            "At most 1 hashtag. Do not include a link unless the source material supplies one.",
            "Hard cap at the character limit. If over, tighten — do not split.",
        ],
    },
    "x_thread": {
        "label": "X thread",
        "char_limit": 280,
        "rules": [
            "Output a 3-7 post thread. Each post on its own line, prefixed with `n/N` (e.g. `1/5`).",
            "Post 1 is the hook and must stand alone if quoted.",
            "Each individual post stays within the character limit.",
            "No hashtags on posts 2+; at most 1 on post 1.",
        ],
    },
    "reddit_comment": {
        "label": "Reddit comment",
        "char_limit": 500,
        "rules": [
            "Conversational, second-person OK.",
            "No markdown headings. Bullets OK if they fit.",
            "Don't sign off. No 'Hope this helps!'.",
        ],
    },
    "reddit_post": {
        "label": "Reddit self-post",
        "char_limit": 2500,
        "rules": [
            "Start with a compelling title on its own line prefixed `TITLE: `.",
            "Multi-paragraph body. Tight opening, details in the middle, a question or call-out at the end.",
            "No emoji in the title. Body may use sparingly if tone allows.",
        ],
    },
    "community_post": {
        "label": "YouTube community post",
        "char_limit": 700,
        "rules": [
            "One or two paragraphs. Open with something that stops the scroll.",
            "End with a question or poll-style prompt to drive comments.",
            "No hashtags. Emoji sparingly, only if tone allows.",
        ],
    },
    "facebook_post": {
        "label": "Facebook post",
        "char_limit": 600,
        "rules": [
            "1-3 short paragraphs with line breaks between them.",
            "Hook in line 1. Shareable — someone should want to send it to a friend.",
            "Hashtags optional, max 2.",
        ],
    },
    "instagram_caption": {
        "label": "Instagram caption",
        "char_limit": 1200,
        "rules": [
            "Hook in line 1 (before the 'more' fold).",
            "Short paragraphs separated by a blank line.",
            "End with a hashtag block on its own line: 5-12 relevant hashtags.",
        ],
    },
    "linkedin_post": {
        "label": "LinkedIn post",
        "char_limit": 1300,
        "rules": [
            "Hook in line 1. Short lines and line breaks — visual whitespace matters.",
            "Personal story or concrete insight, not vague platitudes.",
            "End with a question inviting discussion.",
            "Hashtags optional, max 3, on their own line at the bottom.",
        ],
    },
    "tiktok_caption": {
        "label": "TikTok caption",
        "char_limit": 150,
        "rules": [
            "One sentence hook max.",
            "2-3 hashtags at the end, space-separated.",
            "No full URLs.",
        ],
    },
    "short_reply": {
        "label": "Short reply",
        "char_limit": 200,
        "rules": [
            "1-2 sentences. No preamble, no sign-off.",
            "Directly address whatever was said or asked.",
        ],
    },
    "long_opener": {
        "label": "Long-form opener",
        "char_limit": 2000,
        "rules": [
            "Article or blog intro. 3-5 paragraphs.",
            "Open with a concrete scene or a provocative claim — no 'In today's world' openers.",
            "End on a promise of what the rest of the piece delivers.",
        ],
    },
}


# ── System-prompt assembly ───────────────────────────────────────────

_BASE_SYSTEM = """You are a professional social-media copywriter. Produce ONE {format_label} based on the brief.

{filter_instruction}

{audience_instruction}

{tone_instruction}

{brand_voice_block}

PLATFORM RULES:
{format_rules}

CHARACTER LIMIT: Target {char_limit} characters. Hard cap — if the first draft is over, tighten until it fits. Do not split into multiple posts unless the format explicitly calls for it.

{source_block}

{topic_block}

Output ONLY the post text. Do NOT wrap in quotes, do NOT add commentary like 'Here is your post:' or 'Character count: ...'. Raw text, ready to paste."""


def _source_block(source_material: Optional[str]) -> str:
    s = (source_material or "").strip()
    if not s:
        return ""
    # Cap the grounding text — some LLMs choke on huge system prompts.
    if len(s) > 6000:
        s = s[:6000] + "\n\n[…source truncated…]"
    return (
        "SOURCE MATERIAL — ground the post in these facts. Do not invent numbers, names, or quotes that aren't here:\n"
        f"---\n{s}\n---"
    )


def _brand_voice_block(brand_voice: Optional[str]) -> str:
    s = (brand_voice or "").strip()
    if not s:
        return ""
    # Brand voice sits above platform rules — it's identity, not formatting.
    if len(s) > 2000:
        s = s[:2000] + "\n[…brand voice truncated…]"
    return (
        "BRAND VOICE — this is who is posting. Adhere to it strictly; it overrides generic tone defaults where they conflict:\n"
        f"---\n{s}\n---"
    )


def _topic_block(topic: Optional[str]) -> str:
    t = (topic or "").strip()
    if not t:
        return "TOPIC: Pick something relevant to the platform and audience. Keep it fresh."
    return f"TOPIC / BRIEF:\n{t}"


def _build_system_prompt(
    fmt_key: str,
    content_filter: Optional[str],
    target_audience: Optional[str],
    tone: Optional[str],
    char_limit: Optional[int],
    topic: Optional[str],
    source_material: Optional[str],
    brand_voice: Optional[str] = None,
) -> str:
    fmt = POST_FORMATS.get(fmt_key, POST_FORMATS["tweet"])
    rules_str = "\n".join(f"- {r}" for r in fmt["rules"])
    limit = char_limit if isinstance(char_limit, int) and char_limit > 0 else fmt["char_limit"]

    return _BASE_SYSTEM.format(
        format_label=fmt["label"],
        filter_instruction=_filter_instruction(content_filter),
        audience_instruction=_audience_instruction(target_audience),
        tone_instruction=_tone_instruction(tone),
        brand_voice_block=_brand_voice_block(brand_voice),
        format_rules=rules_str,
        char_limit=limit,
        source_block=_source_block(source_material),
        topic_block=_topic_block(topic),
    )


# ── Output cleanup ──────────────────────────────────────────────────

_CODE_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.MULTILINE)
_LEADING_QUOTE = re.compile(r"^\s*[\"'“‘]")
_TRAILING_QUOTE = re.compile(r"[\"'”’]\s*$")


def _clean_output(raw: str) -> str:
    if not raw:
        return ""
    # Strip <think>…</think> reasoning blocks from reasoning models
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    # Strip markdown code fences if the model wrapped the post
    cleaned = _CODE_FENCE.sub("", cleaned).strip()
    # Strip "Here is your post:" style preambles on the first line
    first_nl = cleaned.find("\n")
    first_line = cleaned[:first_nl] if first_nl >= 0 else cleaned
    low = first_line.lower().strip()
    if low.startswith(("here is", "here's", "sure,", "sure!", "post:", "tweet:", "output:")) and first_nl >= 0:
        cleaned = cleaned[first_nl + 1:].strip()
    # If the entire body is wrapped in one pair of quotes, strip them
    if len(cleaned) > 2 and _LEADING_QUOTE.match(cleaned) and _TRAILING_QUOTE.search(cleaned):
        cleaned = cleaned[1:-1].strip()
    return cleaned


# ── Public generator ─────────────────────────────────────────────────

class TextPostGenerator:
    """Generates platform-aware text posts via the configured AI provider."""

    def __init__(self, config: dict):
        gemini_cfg = config.get("gemini", {})
        self.provider = gemini_cfg.get("provider", "gemini")
        self.model = gemini_cfg.get("model", "gemini-2.0-flash")
        self.ollama_url = gemini_cfg.get("ollama_url", DEFAULT_OLLAMA_URL)

        if self.provider == "ollama":
            self.api_key = ""
        elif self.provider == "openrouter":
            self.api_key = gemini_cfg.get("openrouter_api_key", "")
            if not self.model or self.model.startswith("gemini"):
                self.model = "google/gemini-2.0-flash-exp:free"
        elif self.provider == "nvidia_nim":
            self.api_key = gemini_cfg.get("nvidia_nim_api_key", "")
            if not self.model:
                self.model = "meta/llama-3.1-405b-instruct"
        else:
            self.api_key = gemini_cfg.get("api_key", "")

    def _call(self, system: str, user_prompt: str, retries: int = 2) -> Optional[str]:
        for attempt in range(retries):
            raw = _call_ai(self.provider, self.api_key, user_prompt, system, self.model, self.ollama_url)
            if raw:
                cleaned = _clean_output(raw)
                if cleaned:
                    return cleaned
            if attempt < retries - 1:
                time.sleep(1.0)
        return None

    def generate(
        self,
        fmt_key: str,
        topic: Optional[str] = None,
        content_filter: Optional[str] = None,
        target_audience: Optional[str] = None,
        tone: Optional[str] = None,
        char_limit: Optional[int] = None,
        source_material: Optional[str] = None,
        brand_voice: Optional[str] = None,
    ) -> Optional[str]:
        """Generate a fresh post. Returns the raw post text or None on failure."""
        if fmt_key not in POST_FORMATS:
            print(f"[text_post_generator] unknown format: {fmt_key}, defaulting to 'tweet'")
            fmt_key = "tweet"

        system = _build_system_prompt(
            fmt_key, content_filter, target_audience, tone, char_limit, topic, source_material,
            brand_voice=brand_voice,
        )
        user_prompt = f"Write the {POST_FORMATS[fmt_key]['label']} now."
        return self._call(system, user_prompt)

    def rewrite(
        self,
        fmt_key: str,
        original: str,
        instruction: str,
        content_filter: Optional[str] = None,
        target_audience: Optional[str] = None,
        tone: Optional[str] = None,
        char_limit: Optional[int] = None,
        source_material: Optional[str] = None,
        brand_voice: Optional[str] = None,
    ) -> Optional[str]:
        """Rewrite an existing post per the user's feedback instruction."""
        if fmt_key not in POST_FORMATS:
            fmt_key = "tweet"

        system = _build_system_prompt(
            fmt_key, content_filter, target_audience, tone, char_limit,
            topic=None, source_material=source_material, brand_voice=brand_voice,
        )
        # Append the rewrite brief as the user turn
        user_prompt = (
            f"Here is the current draft of the {POST_FORMATS[fmt_key]['label']}:\n\n"
            f"---\n{original}\n---\n\n"
            f"Rewrite it per this instruction:\n{instruction}\n\n"
            f"Output only the new version. Keep everything else consistent with the platform rules and character limit above."
        )
        return self._call(system, user_prompt)


# ── Helpers for external use ─────────────────────────────────────────

def get_available_formats() -> List[dict]:
    return [
        {"id": k, "label": v["label"], "char_limit": v["char_limit"]}
        for k, v in POST_FORMATS.items()
    ]


def get_available_tones() -> List[str]:
    return list(TONE_INSTRUCTIONS.keys())

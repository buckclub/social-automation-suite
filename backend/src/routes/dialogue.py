"""
Dialogue Mode router — AI generates a back-and-forth conversation
between two characters. The render pipeline is reached separately
via /api/pipeline/run-custom-script (using the returned plain_script).

Future: per-segment voice swap + dual-avatar overlay extension.
"""
from __future__ import annotations

import asyncio
import json
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/dialogue", tags=["dialogue"])


@router.post("/generate")
async def dialogue_generate(req: dict):
    """
    Body:
      {
        topic:               "what they argue / discuss",
        primary_persona:     "who Speaker A is — short personality blurb",
        guest_persona:       "who Speaker B is",
        primary_label:       "default 'A'",  guest_label: "default 'B'",
        exchanges:           "default 6 — number of A↔B turns",
        tone:                "dramatic | funny | heartfelt | shocking | cringe",
        content_filter:      "safe | normal | edgy",
      }
    Returns: { title, segments: [{speaker, label, text}], plain_script }
    """
    # Lazy imports — avoid circulars with api_server at module load.
    from api_server import _load_config
    cfg = _load_config()
    g = cfg.get("gemini") or {}
    if not g.get("enabled"):
        raise HTTPException(400, "AI is not enabled. Enable it in Config → AI Hooks first.")

    topic = (req.get("topic") or "").strip()
    if not topic:
        raise HTTPException(400, "topic is required")
    primary_persona = (req.get("primary_persona") or "").strip() or "narrator"
    guest_persona   = (req.get("guest_persona") or "").strip() or "the other person"
    primary_label   = (req.get("primary_label") or "A").strip()[:24] or "A"
    guest_label     = (req.get("guest_label") or "B").strip()[:24] or "B"
    if primary_label.lower() == guest_label.lower():
        guest_label = guest_label + "2"
    try:
        exchanges = max(2, min(20, int(req.get("exchanges") or 6)))
    except (TypeError, ValueError):
        exchanges = 6
    tone = (req.get("tone") or "dramatic").lower()
    cf = (req.get("content_filter") or "normal").lower()

    provider = g.get("provider", "gemini")
    api_key = (
        g.get("api_key") if provider == "gemini" else
        g.get("openrouter_api_key") if provider == "openrouter" else
        g.get("nvidia_nim_api_key") if provider == "nvidia_nim" else ""
    )
    from api_server import pick_feature_model
    model = pick_feature_model(cfg, "dialogue")
    ollama_url = g.get("ollama_url", "http://localhost:11434")

    system = (
        "You are writing a two-character viral short-form dialogue. Each "
        "line MUST be a single-sentence punchy turn (≤25 words). Tone "
        f"is {tone}. Content filter is {cf}. NO stage directions, no "
        "[asterisks], no parentheses for actions — just spoken lines. "
        "Return ONLY minified JSON, no markdown."
    )
    prompt = (
        f"Topic / scenario: {topic}\n\n"
        f"Speaker {primary_label} (\"primary\"): {primary_persona}\n"
        f"Speaker {guest_label} (\"guest\"): {guest_persona}\n\n"
        f"Write {exchanges} alternating exchanges (each = 1 line by {primary_label}, "
        f"then 1 line by {guest_label}). Build a clear arc — setup, escalation, payoff. "
        f"End on a line that begs for a comment or share.\n\n"
        "Return JSON of this exact shape:\n"
        "{\n"
        '  "title":  "<≤55 char hook for the video title — about the conversation>",\n'
        '  "segments": [\n'
        '    {"speaker": "primary", "text": "<line>"},\n'
        '    {"speaker": "guest",   "text": "<line>"},\n'
        "    ...\n"
        "  ]\n"
        "}"
    )
    from gemini_hooks import _call_ai
    raw = await asyncio.to_thread(_call_ai, provider, api_key, prompt, system, model, ollama_url)
    if not raw:
        raise HTTPException(502, f"AI provider '{provider}' returned empty response")
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```")[1]
        if s.startswith("json"): s = s[4:]
        s = s.strip("`").strip()
    try:
        parsed = json.loads(s)
    except Exception:
        a = s.find("{"); b = s.rfind("}")
        if a < 0 or b <= a:
            raise HTTPException(502, f"AI returned non-JSON: {s[:200]}")
        try: parsed = json.loads(s[a:b + 1])
        except Exception:
            raise HTTPException(502, f"AI returned non-JSON: {s[:200]}")

    out_segments = []
    for seg in (parsed.get("segments") or []):
        sp = (seg.get("speaker") or "").strip().lower()
        if sp not in ("primary", "guest"):
            continue
        txt = (seg.get("text") or "").strip()
        if not txt:
            continue
        out_segments.append({
            "speaker": sp,
            "label":   primary_label if sp == "primary" else guest_label,
            "text":    txt[:600],
        })
    if not out_segments:
        raise HTTPException(502, "AI returned no usable lines")

    plain_lines = [f"{seg['label']}: {seg['text']}" for seg in out_segments]
    plain_script = "\n\n".join(plain_lines)

    return {
        "title":         (parsed.get("title") or topic)[:120],
        "segments":      out_segments,
        "plain_script":  plain_script,
        "primary_label": primary_label,
        "guest_label":   guest_label,
    }

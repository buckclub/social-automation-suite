"""
Brand Profiles — saved snapshots of every "what this channel looks
like" config key. The active config (config.json) is always the live
working state; brand profiles are explicit named snapshots.

Storage layout:
    brands/
      <brand_id>/
        profile.json       # the snapshot (see SCHEMA below)
        profile_pic.png    # optional channel avatar
      <brand_id>/
        ...

SCHEMA (`profile.json`):
    {
      "id":           "brand_abc123",
      "name":         "Toxic GF Stories",
      "color":        "#FF5577",
      "created_at":   "<iso>",
      "updated_at":   "<iso>",
      "config_overrides": {
        "captions":     { ... full block ... },
        "clip_captions":{ ... full block ... },
        "thumbnail":    { ... title-card block ... },
        "video":        { "branding": "...", "outro_text": "...",
                          "background_selector": "...", "broll": {...} },
        "tts":          { "main_voice": "...", "voice_presets": {...},
                          "use_multiple_voices": ..., "comment_voices": [...],
                          "background_music": {...},
                          "elevenlabs": {... no api_key ...} }
      }
    }

Switching brands writes the brand's config_overrides INTO config.json,
so every existing config reader keeps working unchanged. The active
brand id is stored on `config.active_brand_id`.

Per-brand keys are listed in BRAND_KEYS so the snapshot helper can
extract them precisely from a full config dict. API keys never leave
config.json — they're stripped during snapshot.
"""
from __future__ import annotations

import copy
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional


# Keys that travel with a brand. Top-level entries map to either a full
# block (e.g. `captions`) or a tuple of sub-keys (e.g. only some fields
# under `video` / `tts`). Anything not listed stays in the global
# config.json (provider keys, subreddits, ai_scoring, etc).
BRAND_KEYS: dict[str, object] = {
    "captions":      True,           # full block
    "clip_captions": True,
    "thumbnail":     True,
    "video":         ("branding", "outro_text", "background_selector", "broll"),
    "tts":           ("main_voice", "voice_presets", "use_multiple_voices",
                      "comment_voices", "background_music", "elevenlabs_subset"),
}

# When extracting tts.elevenlabs we keep style/dials but DROP the api_key
# (lives in tts.elevenlabs_api_key globally). Same for any nested key that
# would leak credentials.
ELEVENLABS_BRANDED = ("model_id", "stability", "similarity_boost", "style",
                      "use_speaker_boost", "use_native_timestamps")


# ── Storage helpers ──────────────────────────────────────────────────

def brands_root(project_root: str) -> str:
    d = os.path.join(project_root, "brands")
    os.makedirs(d, exist_ok=True)
    return d


def _brand_dir(project_root: str, brand_id: str) -> str:
    return os.path.join(brands_root(project_root), brand_id)


def _profile_path(project_root: str, brand_id: str) -> str:
    return os.path.join(_brand_dir(project_root, brand_id), "profile.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(name: str) -> str:
    """Generate a stable, filesystem-safe id including a uuid suffix."""
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "brand").lower()).strip("_") or "brand"
    return f"brand_{slug[:40]}_{uuid.uuid4().hex[:6]}"


def _load_profile_file(path: str) -> Optional[dict]:
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_profile_file(path: str, profile: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


# ── Snapshot / apply helpers ─────────────────────────────────────────

def snapshot_overrides_from_config(config: dict) -> dict:
    """
    Pull just the brand-scoped keys out of a full config dict. Strips
    any nested credentials (api keys etc) so they never leak to a
    profile.json that might be shared.
    """
    out: dict = {}
    for top_key, sub in BRAND_KEYS.items():
        block = config.get(top_key)
        if block is None:
            continue
        if sub is True:
            out[top_key] = copy.deepcopy(block)
            continue
        if not isinstance(block, dict):
            continue
        sub_out: dict = {}
        for sk in sub:
            if sk == "elevenlabs_subset":
                el = block.get("elevenlabs") or {}
                if isinstance(el, dict):
                    sub_out["elevenlabs"] = {k: el[k] for k in ELEVENLABS_BRANDED if k in el}
                continue
            if sk in block:
                sub_out[sk] = copy.deepcopy(block[sk])
        if sub_out:
            out[top_key] = sub_out
    return out


def apply_overrides_to_config(config: dict, overrides: dict) -> dict:
    """
    Merge a brand's config_overrides INTO the live config dict. Returns
    the same dict (mutated). Top-level keys listed as full-block blow
    away the corresponding key entirely; sub-key entries deep-merge.
    """
    if not overrides:
        return config
    for top_key, value in overrides.items():
        rule = BRAND_KEYS.get(top_key)
        if rule is True:
            config[top_key] = copy.deepcopy(value)
        elif isinstance(rule, tuple):
            target = config.setdefault(top_key, {})
            if not isinstance(target, dict):
                config[top_key] = {}
                target = config[top_key]
            for sk in rule:
                if sk == "elevenlabs_subset":
                    incoming_el = (value or {}).get("elevenlabs") or {}
                    el_target = target.setdefault("elevenlabs", {})
                    if not isinstance(el_target, dict):
                        target["elevenlabs"] = {}
                        el_target = target["elevenlabs"]
                    for k in ELEVENLABS_BRANDED:
                        if k in incoming_el:
                            el_target[k] = incoming_el[k]
                    continue
                if sk in (value or {}):
                    target[sk] = copy.deepcopy(value[sk])
    return config


# ── Public API ───────────────────────────────────────────────────────

def list_profiles(project_root: str) -> list[dict]:
    """Return every saved brand profile as a UI-shaped summary."""
    root = brands_root(project_root)
    out: list[dict] = []
    try:
        ids = sorted(os.listdir(root))
    except OSError:
        return out
    for bid in ids:
        d = os.path.join(root, bid)
        if not os.path.isdir(d):
            continue
        prof = _load_profile_file(os.path.join(d, "profile.json"))
        if not prof:
            continue
        out.append({
            "id":         prof.get("id") or bid,
            "name":       prof.get("name") or bid,
            "color":      prof.get("color") or "#888888",
            "created_at": prof.get("created_at"),
            "updated_at": prof.get("updated_at"),
            "has_pic":    os.path.isfile(os.path.join(d, "profile_pic.png")),
        })
    return out


def get_profile(project_root: str, brand_id: str) -> Optional[dict]:
    return _load_profile_file(_profile_path(project_root, brand_id))


def create_profile(project_root: str, *, name: str, color: str = "#FF8855",
                   from_config: Optional[dict] = None) -> dict:
    """
    Materialise a new brand profile. If `from_config` is provided, the
    current brand-scoped keys are snapshotted in. Otherwise an empty
    overrides block is created and the user must edit it later.
    """
    bid = _new_id(name)
    overrides = snapshot_overrides_from_config(from_config) if from_config else {}
    prof = {
        "id":         bid,
        "name":       (name or "Untitled brand")[:80],
        "color":      color or "#FF8855",
        "created_at": _now(),
        "updated_at": _now(),
        "config_overrides": overrides,
    }
    _save_profile_file(_profile_path(project_root, bid), prof)
    return prof


def update_profile(project_root: str, brand_id: str,
                   *, name: Optional[str] = None,
                   color: Optional[str] = None,
                   config_overrides: Optional[dict] = None) -> Optional[dict]:
    prof = get_profile(project_root, brand_id)
    if not prof:
        return None
    if name is not None:
        prof["name"] = name[:80] or prof["name"]
    if color is not None:
        prof["color"] = color
    if config_overrides is not None:
        prof["config_overrides"] = config_overrides
    prof["updated_at"] = _now()
    _save_profile_file(_profile_path(project_root, brand_id), prof)
    return prof


def delete_profile(project_root: str, brand_id: str) -> bool:
    import shutil
    d = _brand_dir(project_root, brand_id)
    if not os.path.isdir(d):
        return False
    try: shutil.rmtree(d)
    except Exception: return False
    return True


def get_active_id(config: dict) -> Optional[str]:
    v = (config or {}).get("active_brand_id")
    return str(v).strip() if v else None

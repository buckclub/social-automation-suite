"""
Sound-effects library — stored under `<project_root>/sfx/` next to
`music/` and `backgrounds/`.

Mirrors music_library's storage shape so the patterns stay consistent:
- Flat audio files in the dir (mp3/wav/m4a/flac/ogg/aac).
- Per-file metadata in `sfx/_metadata.json` keyed by filename.

SFX categories are different from music tones — these describe the
SHAPE of the sound, not its emotional register:

  whoosh         transitions, cuts, swipes between segments
  ding           notification, reveal, accent
  boom           impact, dramatic moments
  pop            emphasis, punctuation, "ding" alternative
  rise           building tension, intro climb
  cash           money / result reveals (cha-ching)
  scratch        record-scratch / pivot / wait-what
  laugh          canned-laugh sting
  oof            cringe / fail / "deflate" sound
  airhorn        meme-style hype punctuation

The library exposes a search-by-category helper for downstream
pipeline integration. Pipeline-level SFX placement (auto-drop at
climax / scene cuts) is a separate feature — this module is just
storage + tagging + retrieval.
"""
from __future__ import annotations

import json
import os
import random
from datetime import datetime, timezone
from typing import Optional

# Allowed SFX categories. Kept narrow on purpose — too many tags and
# users can't predict which tag a sound belongs to. These ten cover
# 95% of short-form punctuation needs.
SFX_VOCAB = (
    "whoosh", "ding", "boom", "pop", "rise",
    "cash", "scratch", "laugh", "oof", "airhorn",
)
ALLOWED_EXTS = (".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac")


def sfx_dir(project_root: str) -> str:
    d = os.path.join(project_root, "sfx")
    os.makedirs(d, exist_ok=True)
    return d


def _meta_path(project_root: str) -> str:
    return os.path.join(sfx_dir(project_root), "_metadata.json")


def _load_meta(project_root: str) -> dict:
    p = _meta_path(project_root)
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        return data
    except Exception:
        return {}


def _save_meta(project_root: str, meta: dict) -> None:
    p = _meta_path(project_root)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def list_clips(project_root: str) -> list[dict]:
    """Every SFX in the library with metadata + size."""
    d = sfx_dir(project_root)
    meta = _load_meta(project_root)
    out: list[dict] = []
    for name in sorted(os.listdir(d)):
        if name.startswith("_") or not name.lower().endswith(ALLOWED_EXTS):
            continue
        path = os.path.join(d, name)
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        m = meta.get(name) or {}
        out.append({
            "filename": name,
            "name":     m.get("name") or os.path.splitext(name)[0],
            "tags":     [t for t in (m.get("tags") or []) if t in SFX_VOCAB],
            "added_at": m.get("added_at") or "",
            "size":     size,
        })
    return out


def add_clip(project_root: str, filename: str, name: str = "", tags: Optional[list[str]] = None) -> dict:
    """Register an existing file in the metadata. Caller is expected to
    have already written the audio to sfx_dir."""
    meta = _load_meta(project_root)
    safe_tags = [t for t in (tags or []) if t in SFX_VOCAB]
    meta[filename] = {
        "name":     name or os.path.splitext(filename)[0],
        "tags":     safe_tags,
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_meta(project_root, meta)
    return {"filename": filename, "name": meta[filename]["name"], "tags": safe_tags}


def update_tags(project_root: str, filename: str, tags: list[str], name: Optional[str] = None) -> Optional[dict]:
    """Replace tags (and optionally rename) for an existing clip."""
    meta = _load_meta(project_root)
    if filename not in meta:
        return None
    safe_tags = [t for t in (tags or []) if t in SFX_VOCAB]
    meta[filename]["tags"] = safe_tags
    if name is not None:
        meta[filename]["name"] = name.strip() or meta[filename].get("name", "")
    _save_meta(project_root, meta)
    return {"filename": filename, "name": meta[filename]["name"], "tags": safe_tags}


def delete_clip(project_root: str, filename: str) -> bool:
    """Remove the metadata entry AND the audio file. Returns True on
    success (False when the file wasn't there to start with)."""
    if "/" in filename or "\\" in filename or ".." in filename:
        return False
    d = sfx_dir(project_root)
    path = os.path.join(d, filename)
    existed = os.path.isfile(path)
    if existed:
        try:
            os.remove(path)
        except OSError:
            return False
    meta = _load_meta(project_root)
    if filename in meta:
        del meta[filename]
        _save_meta(project_root, meta)
    return existed


def pick_clip_by_tag(project_root: str, tag: str) -> Optional[str]:
    """Return a random clip path matching `tag`, or None if none.
    Used by future pipeline-integration hooks (auto-drop SFX at climax)."""
    if tag not in SFX_VOCAB:
        return None
    d = sfx_dir(project_root)
    matches = [c for c in list_clips(project_root) if tag in c["tags"]]
    if not matches:
        return None
    pick = random.choice(matches)
    return os.path.join(d, pick["filename"])

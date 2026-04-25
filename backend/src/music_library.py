"""
Background music library — stored under `<project_root>/music/` next to
the existing `backgrounds/` directory.

Each track is a flat file (mp3/wav/m4a/flac/ogg). Per-track metadata
lives in `music/_metadata.json` so we can carry mood tags without
touching the audio file:

    {
      "<filename>": {
        "name":     "<display name>",
        "moods":    ["dramatic", "shocking", ...],   # subset of the 5 tone axes
        "added_at": "<iso>"
      },
      ...
    }

The Generate-with-AI dialog already picks one of five tones per run
(dramatic / funny / heartfelt / shocking / cringe). The pipeline calls
`pick_track_for_tone(tone)` to grab a random matching track. When no
track has the requested tone, falls back to "any tagged" then "any at
all" so the user always gets some music if the feature is on.
"""
from __future__ import annotations

import json
import os
import random
import re
from datetime import datetime, timezone
from typing import Optional

# Subset of the existing tone axis so the music library inherits the
# same vocabulary as Generate-with-AI / Text Posts.
TONE_VOCAB = ("dramatic", "funny", "heartfelt", "shocking", "cringe")
ALLOWED_EXTS = (".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac")


def music_dir(project_root: str) -> str:
    d = os.path.join(project_root, "music")
    os.makedirs(d, exist_ok=True)
    return d


def _meta_path(project_root: str) -> str:
    return os.path.join(music_dir(project_root), "_metadata.json")


def _load_meta(project_root: str) -> dict:
    p = _meta_path(project_root)
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_meta(project_root: str, meta: dict) -> None:
    p = _meta_path(project_root)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def _safe_filename(s: str) -> str:
    s = re.sub(r"[^\w\.\- ]+", "_", s or "").strip(" _.")
    return s[:120] or "track"


def _normalize_moods(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out = []
    for m in raw:
        v = (m or "").strip().lower()
        if v in TONE_VOCAB and v not in out:
            out.append(v)
    return out


# ── Public API ───────────────────────────────────────────────────────

def list_tracks(project_root: str) -> list[dict]:
    """Return the library — only files that actually exist on disk."""
    d = music_dir(project_root)
    meta = _load_meta(project_root)
    out: list[dict] = []
    try:
        files = os.listdir(d)
    except OSError:
        files = []
    for fn in sorted(files):
        if fn.startswith("_") or fn.startswith("."):
            continue
        ext = os.path.splitext(fn)[1].lower()
        if ext not in ALLOWED_EXTS:
            continue
        full = os.path.join(d, fn)
        if not os.path.isfile(full):
            continue
        m = meta.get(fn, {})
        out.append({
            "filename":  fn,
            "name":      m.get("name") or os.path.splitext(fn)[0],
            "moods":     _normalize_moods(m.get("moods") or []),
            "added_at":  m.get("added_at") or "",
            "size_bytes": os.path.getsize(full),
        })
    return out


def add_track(project_root: str, filename: str, content: bytes,
              *, name: str = "", moods: Optional[list[str]] = None) -> dict:
    """Save raw bytes as `<music>/<filename>` and update metadata."""
    d = music_dir(project_root)
    safe = _safe_filename(filename)
    if os.path.splitext(safe)[1].lower() not in ALLOWED_EXTS:
        raise ValueError(f"Unsupported audio extension. Allowed: {', '.join(ALLOWED_EXTS)}")
    # De-dup name
    dest_name = safe
    n = 2
    while os.path.exists(os.path.join(d, dest_name)):
        stem, ext = os.path.splitext(safe)
        dest_name = f"{stem}_{n}{ext}"
        n += 1
    with open(os.path.join(d, dest_name), "wb") as f:
        f.write(content)
    meta = _load_meta(project_root)
    meta[dest_name] = {
        "name":     (name or os.path.splitext(dest_name)[0])[:120],
        "moods":    _normalize_moods(moods),
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_meta(project_root, meta)
    return {
        "filename":  dest_name,
        "name":      meta[dest_name]["name"],
        "moods":     meta[dest_name]["moods"],
        "added_at":  meta[dest_name]["added_at"],
        "size_bytes": len(content),
    }


def update_meta(project_root: str, filename: str,
                *, name: Optional[str] = None,
                moods: Optional[list[str]] = None) -> dict:
    """Update name and/or moods for an existing track."""
    d = music_dir(project_root)
    if not os.path.isfile(os.path.join(d, filename)):
        raise FileNotFoundError(filename)
    meta = _load_meta(project_root)
    row = meta.setdefault(filename, {})
    if name is not None:
        row["name"] = (name or "").strip()[:120] or filename
    if moods is not None:
        row["moods"] = _normalize_moods(moods)
    row.setdefault("added_at", datetime.now(timezone.utc).isoformat())
    meta[filename] = row
    _save_meta(project_root, meta)
    return {
        "filename":  filename,
        "name":      row.get("name") or os.path.splitext(filename)[0],
        "moods":     row.get("moods") or [],
        "added_at":  row.get("added_at"),
    }


def delete_track(project_root: str, filename: str) -> bool:
    d = music_dir(project_root)
    p = os.path.join(d, filename)
    if not os.path.isfile(p):
        return False
    try: os.remove(p)
    except OSError: return False
    meta = _load_meta(project_root)
    meta.pop(filename, None)
    _save_meta(project_root, meta)
    return True


def pick_track_for_tone(project_root: str, tone: Optional[str] = None) -> Optional[str]:
    """
    Return a random matching track's absolute path. Used by the render
    pipeline. Falls back gracefully:
      1. random track tagged with `tone`
      2. random track tagged with anything
      3. random untagged track
    Returns None when the library is empty.
    """
    tracks = list_tracks(project_root)
    if not tracks:
        return None
    t = (tone or "").lower().strip()
    if t:
        match = [x for x in tracks if t in x["moods"]]
        if match:
            return os.path.join(music_dir(project_root), random.choice(match)["filename"])
    tagged = [x for x in tracks if x["moods"]]
    if tagged:
        return os.path.join(music_dir(project_root), random.choice(tagged)["filename"])
    return os.path.join(music_dir(project_root), random.choice(tracks)["filename"])

"""
Persistent project registry for rendered videos.

`projects.json` at the repo root is the source of truth for the Videos page.
It survives:
  * server restarts
  * auto_cleanup deleting posts/<id>/
  * Re-render / delete operations

Schema (list of dicts):
  {
    "id": str,                         # post_id (or custom id)
    "title": str,
    "subreddit": str,
    "score": int,
    "num_comments": int,
    "created_at": str,                 # ISO-8601 UTC
    "video_paths": [str, ...],         # absolute paths to mp4 files
    "thumbnail_paths": [str, ...],     # optional
    "audio_dir": str | None,           # preserved audio for Re-render
    "timeline_path": str | None,       # preserved timeline.json
    "render_time_s": float | None,
    "status": "published" | "audio_only" | "failed",
    "settings_snapshot": {}            # optional caption/tts config used
  }
"""
from __future__ import annotations
import json
import os
import tempfile
from typing import List, Optional


def registry_path(project_root: str) -> str:
    return os.path.join(project_root, "projects.json")


def load_registry(project_root: str) -> List[dict]:
    p = registry_path(project_root)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_registry(project_root: str, projects: List[dict]) -> None:
    p = registry_path(project_root)
    # atomic write
    tmp = tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8",
                                      suffix=".tmp", dir=project_root)
    try:
        json.dump(projects, tmp, indent=2, ensure_ascii=False)
        tmp.close()
        os.replace(tmp.name, p)
    except Exception:
        try:
            os.remove(tmp.name)
        except Exception:
            pass
        raise


def upsert(project_root: str, project: dict) -> List[dict]:
    """Insert or replace a project by id. Returns the updated list."""
    pid = project.get("id")
    if not pid:
        return load_registry(project_root)
    projects = [p for p in load_registry(project_root) if p.get("id") != pid]
    projects.append(project)
    save_registry(project_root, projects)
    return projects


def remove(project_root: str, project_id: str) -> Optional[dict]:
    """Remove project by id. Returns the removed entry or None."""
    projects = load_registry(project_root)
    removed = next((p for p in projects if p.get("id") == project_id), None)
    if removed is None:
        return None
    projects = [p for p in projects if p.get("id") != project_id]
    save_registry(project_root, projects)
    return removed


def find(project_root: str, project_id: str) -> Optional[dict]:
    for p in load_registry(project_root):
        if p.get("id") == project_id:
            return p
    return None

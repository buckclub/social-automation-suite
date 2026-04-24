"""
Persistent registry for Clip Maker projects.

Each project represents one long-form source (uploaded mp4 or YouTube URL)
plus everything we've derived from it: transcript, AI-proposed clips,
user-approved clips, and rendered 9:16 shorts.

Layout on disk:

    clips/<project_id>/
        project.json          # the metadata blob below
        source.<ext>          # the actual long-form video
        transcript.json       # {source: 'youtube' | 'whisper', segments: [...]}
        renders/
            <proposal_id>.mp4
            <proposal_id>_thumbnail.png

The registry itself is just a single flat list at `clips/registry.json`
that mirrors the `project.json` of every project, so the list view
doesn't have to walk subfolders. On create/update we rewrite both the
per-project file and the registry entry.

Project.json shape:

    {
      "id":            "uuid4",
      "name":          "My podcast ep 3",
      "created_at":    "...",
      "updated_at":    "...",
      "source_type":   "youtube" | "upload",
      "source_url":    "https://..." (youtube only),
      "source_file":   "clips/<id>/source.mp4",
      "source_thumb":  "clips/<id>/thumb.jpg" | null,
      "duration_s":    float,
      "status":        "ingesting" | "transcribing" | "proposing" |
                       "ready" | "rendering" | "done" | "failed",
      "status_detail": "...",
      "error":         str | null,

      "transcript": {
        "source":   "youtube" | "whisper",
        "lang":     "en",
        "segments": [{"start": 0.0, "end": 2.4, "text": "..."}]
      } | null,

      "proposals": [
        {
          "id":            "p1",
          "start":         120.3,
          "end":           175.8,
          "hook_line":     "Wait till you hear what she did next",
          "reason":        "Strong setup + payoff with emotional peak",
          "score":         87,
          "approved":      true,
          "user_adjusted": true,
          "custom_title":  "She did WHAT" | null
        }
      ],

      "rendered_clips": [
        {
          "proposal_id":   "p1",
          "video_path":    "clips/<id>/renders/p1.mp4",
          "thumbnail_path": "clips/<id>/renders/p1_thumbnail.png" | null,
          "created_at":    "...",
          "render_time_s": 42.1
        }
      ]
    }
"""
from __future__ import annotations
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

_lock = Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clips_root(project_root: str) -> str:
    d = os.path.join(project_root, "clips")
    os.makedirs(d, exist_ok=True)
    return d


def registry_path(project_root: str) -> str:
    return os.path.join(clips_root(project_root), "registry.json")


def project_dir(project_root: str, project_id: str) -> str:
    return os.path.join(clips_root(project_root), project_id)


def project_json_path(project_root: str, project_id: str) -> str:
    return os.path.join(project_dir(project_root, project_id), "project.json")


def load_registry(project_root: str) -> list[dict]:
    p = registry_path(project_root)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_registry(project_root: str, entries: list[dict]) -> None:
    p = registry_path(project_root)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def load_project(project_root: str, project_id: str) -> Optional[dict]:
    p = project_json_path(project_root, project_id)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_project(project_root: str, proj: dict) -> None:
    """Persist a project to its own file AND sync the flat registry list."""
    pid = proj.get("id")
    if not pid:
        raise ValueError("Project missing 'id'")
    proj["updated_at"] = now_iso()

    with _lock:
        # Per-project file
        d = project_dir(project_root, pid)
        os.makedirs(d, exist_ok=True)
        p_path = project_json_path(project_root, pid)
        tmp = p_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(proj, f, indent=2, ensure_ascii=False)
        os.replace(tmp, p_path)

        # Registry — store a compact summary to keep the list fast.
        summary = _summary(proj)
        entries = load_registry(project_root)
        entries = [e for e in entries if e.get("id") != pid]
        entries.append(summary)
        # Sort newest-first so the list view is predictable.
        entries.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        _save_registry(project_root, entries)


def _summary(proj: dict) -> dict:
    """Slim version of a project for the list view."""
    return {
        "id":            proj.get("id"),
        "name":          proj.get("name"),
        "created_at":    proj.get("created_at"),
        "updated_at":    proj.get("updated_at"),
        "source_type":   proj.get("source_type"),
        "source_url":    proj.get("source_url"),
        "duration_s":    proj.get("duration_s", 0),
        "status":        proj.get("status"),
        "status_detail": proj.get("status_detail"),
        "proposal_count": len(proj.get("proposals") or []),
        "approved_count": sum(1 for p in (proj.get("proposals") or []) if p.get("approved")),
        "rendered_count": len(proj.get("rendered_clips") or []),
    }


def create_project(project_root: str, *, name: str, source_type: str,
                   source_url: Optional[str] = None) -> dict:
    pid = uuid.uuid4().hex[:12]
    proj = {
        "id":            pid,
        "name":          (name or "").strip() or f"Clip project {pid[:6]}",
        "created_at":    now_iso(),
        "updated_at":    now_iso(),
        "source_type":   source_type,          # "youtube" | "upload"
        "source_url":    source_url,
        "source_file":   None,
        "source_thumb":  None,
        "duration_s":    0,
        "status":        "ingesting",
        "status_detail": "",
        "error":         None,
        "transcript":    None,
        "proposals":     [],
        "rendered_clips": [],
    }
    save_project(project_root, proj)
    return proj


def delete_project(project_root: str, project_id: str) -> bool:
    """Drop everything on disk for this project."""
    d = project_dir(project_root, project_id)
    removed = False
    if os.path.isdir(d):
        try:
            shutil.rmtree(d)
            removed = True
        except OSError:
            pass
    with _lock:
        entries = load_registry(project_root)
        new = [e for e in entries if e.get("id") != project_id]
        if len(new) != len(entries):
            _save_registry(project_root, new)
            removed = True
    return removed


def set_status(project_root: str, project_id: str, status: str,
               detail: str = "", error: Optional[str] = None) -> Optional[dict]:
    proj = load_project(project_root, project_id)
    if not proj:
        return None
    proj["status"] = status
    proj["status_detail"] = detail
    if error is not None:
        proj["error"] = error
    save_project(project_root, proj)
    return proj

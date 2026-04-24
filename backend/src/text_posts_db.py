"""
Persistent registry of generated text posts (tweets, community posts,
Reddit comments, LinkedIn posts, etc).

`text_posts.json` at the repo root is the source of truth. Mirrors the
shape of projects_db.py but carries revision history so the rewrite loop
can show earlier versions.

Schema (list of dicts, newest last):
  {
    "id": str,                    # "tp_YYYYMMDD_HHMMSS_xxx"
    "created_at": str,            # ISO-8601 UTC
    "updated_at": str,            # ISO-8601 UTC
    "format": str,                # POST_FORMATS key (tweet, linkedin_post, ...)
    "filter": str,                # "safe" | "normal" | "edgy"
    "tone": str,                  # one of TONE_INSTRUCTIONS keys
    "target_audience": str,
    "topic": str,
    "source_material": str,
    "char_limit": int,
    "current": str,               # the live text
    "revisions": [                # latest last, capped at MAX_REVISIONS
      {"text": str, "instruction": str|None, "at": str}
    ],
  }
"""
from __future__ import annotations
import json
import os
import tempfile
from typing import List, Optional

MAX_REVISIONS = 20


def registry_path(project_root: str) -> str:
    return os.path.join(project_root, "text_posts.json")


def load_posts(project_root: str) -> List[dict]:
    p = registry_path(project_root)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_posts(project_root: str, posts: List[dict]) -> None:
    p = registry_path(project_root)
    tmp = tempfile.NamedTemporaryFile(
        "w", delete=False, encoding="utf-8", suffix=".tmp", dir=project_root,
    )
    try:
        json.dump(posts, tmp, indent=2, ensure_ascii=False)
        tmp.close()
        os.replace(tmp.name, p)
    except Exception:
        try:
            os.remove(tmp.name)
        except Exception:
            pass
        raise


def upsert(project_root: str, post: dict) -> List[dict]:
    pid = post.get("id")
    if not pid:
        return load_posts(project_root)
    # Cap revisions before persisting
    revs = post.get("revisions") or []
    if len(revs) > MAX_REVISIONS:
        post["revisions"] = revs[-MAX_REVISIONS:]
    posts = [p for p in load_posts(project_root) if p.get("id") != pid]
    posts.append(post)
    save_posts(project_root, posts)
    return posts


def remove(project_root: str, post_id: str) -> Optional[dict]:
    posts = load_posts(project_root)
    removed = next((p for p in posts if p.get("id") == post_id), None)
    if removed is None:
        return None
    posts = [p for p in posts if p.get("id") != post_id]
    save_posts(project_root, posts)
    return removed


def find(project_root: str, post_id: str) -> Optional[dict]:
    for p in load_posts(project_root):
        if p.get("id") == post_id:
            return p
    return None

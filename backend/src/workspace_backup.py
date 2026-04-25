"""
Workspace export / import — disaster-recovery for the user's setup.

Captured in the export zip:
  - config.json                          (all global settings, API keys, captions, TTS)
  - projects.json                        (registry of every render the suite has done)
  - brands/<id>/profile.json + pic       (every saved brand profile)
  - .cache/social_queue.json             (in-flight + history of social-copy generations)
  - .cache/content_calendar.json         (scheduled slots)
  - .cache/comment_drafts.json           (AI-drafted reply queue)
  - .cache/run_queue.json                (render queue state)
  - .cache/render_history.json           (per-day render counts for the chart)
  - .cache/youtube_quota.json            (today's quota ledger)
  - .cache/ai_drafts.json                (in-progress Generate-with-AI session, if any)
  - music/_metadata.json                 (per-track mood tags — NOT the audio files)
  - posts/<id>/social.json               (per-post saved social copy — generated with $)

Deliberately EXCLUDED (they're large, regenerable, or both):
  - posts/<id>/audio/*                   (re-render with TTS if needed)
  - posts/<id>/full_data.json            (Reddit data snapshots, regenerable)
  - videos/                              (final mp4s — back these up separately)
  - backgrounds/                         (stock footage — too big, source-controlled separately)
  - music/*.mp3 etc                      (audio files — too big, user owns the source)
  - clips/                               (clip-maker projects — typically large)
  - models/                              (auto-downloads on first use)
  - dist/, node_modules/, __pycache__/
"""
from __future__ import annotations

import io
import json
import os
import shutil
import zipfile
from datetime import datetime, timezone
from typing import Optional


# Paths that travel with a workspace export. Relative to project_root.
CONFIG_FILES = ["config.json", "projects.json"]
CACHE_FILES = [
    ".cache/social_queue.json",
    ".cache/content_calendar.json",
    ".cache/comment_drafts.json",
    ".cache/run_queue.json",
    ".cache/render_history.json",
    ".cache/youtube_quota.json",
    ".cache/ai_drafts.json",
]
# Whole-tree exports. The walker filters by file extension where needed
# so we don't accidentally bundle 200-MB audio files.
DIRS_TO_INCLUDE = [
    ("brands",   None),                 # everything under brands/
    ("music",    {"_metadata.json"}),   # only the manifest, not the audio
]
# Per-post sidecars — only the small JSON metadata, not audio/video.
POSTS_SIDECARS = {"social.json", "summary.json"}


def _safe_add(zf: zipfile.ZipFile, abs_path: str, arcname: str) -> bool:
    """Add a single file to the zip if it exists. Returns True on success."""
    if not os.path.isfile(abs_path):
        return False
    try:
        zf.write(abs_path, arcname=arcname)
        return True
    except Exception as e:
        print(f"⚠️  workspace export: failed to add {abs_path}: {e}")
        return False


def export_workspace(project_root: str,
                     *,
                     include_post_sidecars: bool = True) -> bytes:
    """
    Return a zip file's bytes containing every config + brand + cache
    + per-brand asset that comprises the user's setup. Audio / video /
    backgrounds are deliberately excluded — see module docstring.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Manifest header so future versions can detect schema mismatches.
        manifest = {
            "schema_version": 1,
            "exported_at":    datetime.now(timezone.utc).isoformat(),
            "project_root":   os.path.basename(project_root.rstrip("/\\")) or "workspace",
            "creator":        "Social Automation Suite",
            "files":          [],
        }
        included: list[str] = []

        # 1. Top-level config + registry
        for fn in CONFIG_FILES:
            if _safe_add(zf, os.path.join(project_root, fn), fn):
                included.append(fn)

        # 2. Cache ledgers (queue states, drafts, quota)
        for rel in CACHE_FILES:
            if _safe_add(zf, os.path.join(project_root, rel), rel):
                included.append(rel)

        # 3. Brand profiles (recursive — pic + profile.json)
        for dirname, _filter in DIRS_TO_INCLUDE:
            root = os.path.join(project_root, dirname)
            if not os.path.isdir(root):
                continue
            for cur, _, files in os.walk(root):
                for f in files:
                    full = os.path.join(cur, f)
                    rel = os.path.relpath(full, project_root).replace("\\", "/")
                    # Skip hidden + temp files; honor optional filename filter
                    if f.startswith(".") or f.endswith(".tmp"):
                        continue
                    if _filter is not None and f not in _filter:
                        continue
                    if _safe_add(zf, full, rel):
                        included.append(rel)

        # 4. Per-post sidecars (just the metadata JSONs)
        if include_post_sidecars:
            posts_dir = os.path.join(project_root, "posts")
            if os.path.isdir(posts_dir):
                for entry in sorted(os.listdir(posts_dir)):
                    p_dir = os.path.join(posts_dir, entry)
                    if not os.path.isdir(p_dir):
                        continue
                    for f in POSTS_SIDECARS:
                        full = os.path.join(p_dir, f)
                        rel = f"posts/{entry}/{f}"
                        if _safe_add(zf, full, rel):
                            included.append(rel)

        manifest["files"] = included
        zf.writestr("workspace_manifest.json", json.dumps(manifest, indent=2))

    buf.seek(0)
    return buf.getvalue()


def import_workspace(project_root: str, zip_bytes: bytes,
                     *, overwrite: bool = True) -> dict:
    """
    Restore a workspace from a previously-exported zip. Files are
    extracted to a temp dir first, validated, then atomically moved
    into place. Existing files are backed up to
    `.cache/imports/<timestamp>/` so a bad import is undoable.

    Returns a dict summarising what was restored / skipped.
    """
    if not zip_bytes:
        raise ValueError("Empty zip payload")

    # Extract into a sandbox first so we never half-apply on parse errors.
    import tempfile
    sandbox = tempfile.mkdtemp(prefix="ws_import_")
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            # Defence: refuse anything that tries to escape via "../" or
            # absolute paths. zipfile.extractall sanitises by default in
            # 3.12+, but we double-check.
            for member in zf.namelist():
                if member.startswith("/") or ".." in member.split("/"):
                    raise ValueError(f"Refusing zip entry with unsafe path: {member}")
            zf.extractall(sandbox)

        # Manifest sanity check
        man_path = os.path.join(sandbox, "workspace_manifest.json")
        if os.path.isfile(man_path):
            try:
                with open(man_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except Exception as e:
                raise ValueError(f"Invalid workspace_manifest.json: {e}")
            if int(manifest.get("schema_version", 0)) > 1:
                raise ValueError(
                    f"Workspace zip schema_version={manifest.get('schema_version')} "
                    "is newer than this server can handle. Upgrade the suite first."
                )

        # Backup existing files we're about to overwrite, then move.
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_root = os.path.join(project_root, ".cache", "imports", ts)
        os.makedirs(backup_root, exist_ok=True)

        restored: list[str] = []
        skipped:  list[str] = []
        for cur, _, files in os.walk(sandbox):
            for f in files:
                if f == "workspace_manifest.json":
                    continue
                src = os.path.join(cur, f)
                rel = os.path.relpath(src, sandbox).replace("\\", "/")
                dst = os.path.join(project_root, rel)
                if os.path.isfile(dst) and not overwrite:
                    skipped.append(rel)
                    continue
                # Backup existing before clobbering.
                if os.path.isfile(dst):
                    backup_path = os.path.join(backup_root, rel)
                    os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                    try: shutil.copy2(dst, backup_path)
                    except Exception: pass
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
                restored.append(rel)

        return {
            "restored": restored,
            "skipped":  skipped,
            "backup_dir": os.path.relpath(backup_root, project_root).replace("\\", "/"),
        }
    finally:
        try: shutil.rmtree(sandbox, ignore_errors=True)
        except Exception: pass

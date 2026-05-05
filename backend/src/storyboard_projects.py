"""
Persistent registry for Storyboard projects.

A "storyboard" is a sequence of scenes the operator assembles by hand:
each scene pairs a video clip (typically generated externally — Grok
Imagine, Sora, etc.) with a line of narration. The render pipeline
(storyboard_pipeline.py) walks the scenes in order, narrates each one
via TTS, length-matches the clip to the narration, concatenates, and
overlays captions + an optional title card.

This module is the persistence layer only. It mirrors clip_projects.py
nearly verbatim — same pattern of per-project JSON file + flat registry
summary list — so the listing UI stays fast and atomic writes are free.

Layout on disk:

    storyboard_projects/<project_id>/
        project.json
        clips/                       # per-project clip storage
            <scene_id>_<filename>.mp4
        renders/
            <render_id>.mp4
            <render_id>_thumbnail.png
        audio/                       # TTS output, written during render
            scene_<n>.mp3

Project.json shape:

    {
      "id":            "uuid4 hex (12 char)",
      "name":          "Whiskers the Detective",
      "created_at":    "...",
      "updated_at":    "...",
      "brand_id":      "<brand profile id>" | null,
      "template":      "blank" | "pet_adventure" | "stoic_wisdom" | ...,
      "scenes": [
        {
          "id":              "s1",
          "narration":       "Whiskers sniffed the empty fish bowl at midnight.",
          "clip_path":       "storyboard_projects/<id>/clips/s1_clip.mp4" | null,
          "clip_filename":   "clip01.mp4" | null,        # original name for UI
          "clip_duration_s": 4.2 | null,                  # probed at upload time
          "voice_override":  "Joanna" | null,             # per-scene voice
          // Length-match policy when clip duration != narration duration:
          //   trim       — cut clip to narration (default if clip > narration)
          //   loop       — repeat clip with cross-fade (default if clip < narration)
          //   hold       — freeze last frame to extend, or trim from end
          //   stretch    — time-stretch clip to match narration
          "fit_policy":      "auto" | "trim" | "loop" | "hold" | "stretch"
        }
      ],
      "render_history": [
        {
          "id":            "r1",
          "video_path":    "storyboard_projects/<id>/renders/r1.mp4",
          "thumbnail_path": "...",
          "created_at":    "...",
          "render_time_s": 24.3,
          "duration_s":    47.8,
          "scene_count":   5
        }
      ],
      "status":        "draft" | "rendering" | "ready" | "failed",
      "status_detail": "",
      "error":         null
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


# ── Path helpers ───────────────────────────────────────────────────

def storyboards_root(project_root: str) -> str:
    d = os.path.join(project_root, "storyboard_projects")
    os.makedirs(d, exist_ok=True)
    return d


def registry_path(project_root: str) -> str:
    return os.path.join(storyboards_root(project_root), "registry.json")


def project_dir(project_root: str, project_id: str) -> str:
    return os.path.join(storyboards_root(project_root), project_id)


def project_json_path(project_root: str, project_id: str) -> str:
    return os.path.join(project_dir(project_root, project_id), "project.json")


def project_clips_dir(project_root: str, project_id: str) -> str:
    d = os.path.join(project_dir(project_root, project_id), "clips")
    os.makedirs(d, exist_ok=True)
    return d


def project_renders_dir(project_root: str, project_id: str) -> str:
    d = os.path.join(project_dir(project_root, project_id), "renders")
    os.makedirs(d, exist_ok=True)
    return d


def project_audio_dir(project_root: str, project_id: str) -> str:
    d = os.path.join(project_dir(project_root, project_id), "audio")
    os.makedirs(d, exist_ok=True)
    return d


# ── Registry I/O ───────────────────────────────────────────────────

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
    pid = proj.get("id")
    if not pid:
        raise ValueError("Project missing 'id'")
    proj["updated_at"] = now_iso()

    with _lock:
        d = project_dir(project_root, pid)
        os.makedirs(d, exist_ok=True)
        p_path = project_json_path(project_root, pid)
        tmp = p_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(proj, f, indent=2, ensure_ascii=False)
        os.replace(tmp, p_path)

        summary = _summary(proj)
        entries = load_registry(project_root)
        entries = [e for e in entries if e.get("id") != pid]
        entries.append(summary)
        entries.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        _save_registry(project_root, entries)


def _summary(proj: dict) -> dict:
    """Slim version of a project for the list view. Includes a thumbnail
    of the FIRST scene's clip path so the list can render a strip."""
    scenes = proj.get("scenes") or []
    return {
        "id":            proj.get("id"),
        "name":          proj.get("name"),
        "created_at":    proj.get("created_at"),
        "updated_at":    proj.get("updated_at"),
        "brand_id":      proj.get("brand_id"),
        "template":      proj.get("template", "blank"),
        "scene_count":   len(scenes),
        # Sum of probed clip durations (or narration estimate if clip not set)
        # is a useful first-glance for the list — we just sum probed clips.
        "approx_duration_s": round(sum(s.get("clip_duration_s") or 0 for s in scenes), 1),
        "first_clip_path":   next((s.get("clip_path") for s in scenes if s.get("clip_path")), None),
        "render_count":  len(proj.get("render_history") or []),
        "status":        proj.get("status", "draft"),
        "status_detail": proj.get("status_detail", ""),
    }


# ── Scene ID generation ────────────────────────────────────────────
# Short stable IDs ("s1", "s2") rather than full UUIDs because they
# show up in filenames + UI. Always picks the next free integer so
# reorder doesn't reshuffle filenames already on disk.

def _next_scene_id(scenes: list[dict]) -> str:
    used = set()
    for s in scenes:
        sid = (s.get("id") or "").lstrip("s")
        if sid.isdigit():
            used.add(int(sid))
    n = 1
    while n in used:
        n += 1
    return f"s{n}"


# ── Project CRUD ───────────────────────────────────────────────────

def create_project(project_root: str, *, name: str,
                   template: str = "blank",
                   brand_id: Optional[str] = None) -> dict:
    pid = uuid.uuid4().hex[:12]
    scenes = _seed_scenes_for_template(template)
    proj = {
        "id":            pid,
        "name":          (name or "").strip() or f"Storyboard {pid[:6]}",
        "created_at":    now_iso(),
        "updated_at":    now_iso(),
        "brand_id":      brand_id,
        "template":      template,
        "scenes":        scenes,
        "render_history": [],
        "status":        "draft",
        "status_detail": "",
        "error":         None,
    }
    save_project(project_root, proj)
    return proj


def update_project(project_root: str, project_id: str, patch: dict) -> Optional[dict]:
    """Shallow-merge `patch` into the project's top-level fields. Used by
    PATCH /api/storyboard/projects/<id>. Scene reorder / edits go through
    here too — caller passes the full new `scenes` list."""
    proj = load_project(project_root, project_id)
    if proj is None:
        return None
    # Whitelist the editable keys so a malformed PATCH can't smuggle
    # internal status fields ("error", "status") into the project.
    EDITABLE = {"name", "scenes", "brand_id", "template"}
    for k, v in patch.items():
        if k in EDITABLE:
            proj[k] = v
    save_project(project_root, proj)
    return proj


def delete_project(project_root: str, project_id: str) -> bool:
    """Removes the project directory + registry entry. Returns False if
    the project didn't exist."""
    d = project_dir(project_root, project_id)
    existed = os.path.isdir(d)
    with _lock:
        if existed:
            shutil.rmtree(d, ignore_errors=True)
        entries = load_registry(project_root)
        entries = [e for e in entries if e.get("id") != project_id]
        _save_registry(project_root, entries)
    return existed


# ── Scene-level helpers (called by the upload + render endpoints) ──

def attach_clip(project_root: str, project_id: str, scene_id: str, *,
                src_path: str, original_filename: str,
                duration_s: Optional[float] = None) -> Optional[dict]:
    """Copy `src_path` into the project's clips dir and update the
    scene's clip_path / clip_filename / clip_duration_s. Returns the
    updated project, or None if the project / scene doesn't exist."""
    proj = load_project(project_root, project_id)
    if not proj:
        return None
    scenes = proj.get("scenes") or []
    scene = next((s for s in scenes if s.get("id") == scene_id), None)
    if scene is None:
        return None

    clips_d = project_clips_dir(project_root, project_id)
    safe_name = "".join(c for c in original_filename if c.isalnum() or c in "._-") or "clip.mp4"
    dest = os.path.join(clips_d, f"{scene_id}_{safe_name}")
    # Replace any prior clip for this scene so we don't accumulate junk.
    if scene.get("clip_path") and os.path.isfile(scene["clip_path"]):
        try: os.remove(scene["clip_path"])
        except OSError: pass
    shutil.move(src_path, dest)

    scene["clip_path"] = dest
    scene["clip_filename"] = original_filename
    if duration_s is not None:
        scene["clip_duration_s"] = float(duration_s)
    save_project(project_root, proj)
    return proj


def detach_clip(project_root: str, project_id: str, scene_id: str) -> Optional[dict]:
    """Remove the clip file + clear the scene's clip fields. Narration
    stays — useful when the operator wants to swap a clip without
    retyping the line."""
    proj = load_project(project_root, project_id)
    if not proj:
        return None
    scene = next((s for s in (proj.get("scenes") or []) if s.get("id") == scene_id), None)
    if scene is None:
        return None
    cp = scene.get("clip_path")
    if cp and os.path.isfile(cp):
        try: os.remove(cp)
        except OSError: pass
    scene["clip_path"] = None
    scene["clip_filename"] = None
    scene["clip_duration_s"] = None
    save_project(project_root, proj)
    return proj


# ── Templates ──────────────────────────────────────────────────────
# Each template seeds the project with a few empty scenes. The narration
# fields hold a placeholder line so the operator sees the rhythm of the
# format without committing to specific text. Empty narration === silent
# scene at render time, so leaving placeholders in won't crash anything;
# they'll just be narrated literally if the operator forgets to edit.

def _seed_scenes_for_template(template: str) -> list[dict]:
    spec = TEMPLATES.get(template) or TEMPLATES["blank"]
    scenes: list[dict] = []
    for i, narration in enumerate(spec["scenes"], start=1):
        scenes.append({
            "id":              f"s{i}",
            "narration":       narration,
            "clip_path":       None,
            "clip_filename":   None,
            "clip_duration_s": None,
            "voice_override":  None,
            "fit_policy":      "auto",
        })
    return scenes


# Order matters here — it's also the order the UI displays presets in.
TEMPLATES: dict[str, dict] = {
    "blank": {
        "name": "Blank",
        "description": "Start from scratch — one empty scene.",
        "scenes": [""],
    },
    "pet_adventure": {
        "name": "Pet Adventure",
        "description": "30–60s cute story arc — setup, twist, resolution.",
        "scenes": [
            "[Setup] Whiskers had been planning this for weeks.",
            "[Inciting moment] When midnight struck, she knew it was time.",
            "[Escalation] What she found in the kitchen would change everything.",
            "[Payoff] And that's how a cat became the family detective.",
        ],
    },
    "stoic_wisdom": {
        "name": "Stoic Wisdom",
        "description": "Quote → modern application → close. Cinematic, calm.",
        "scenes": [
            "[Quote] \"You have power over your mind — not outside events.\" — Marcus Aurelius",
            "[Application] Two thousand years later, you're doomscrolling while your day slips away.",
            "[Close] He was right. The phone is the gladiator. You decide whether to enter the arena.",
        ],
    },
    "psychology_explainer": {
        "name": "Why You Do That",
        "description": "Hidden-reason explainer with abstract visuals.",
        "scenes": [
            "[Hook] Ever notice how you check your phone the moment you sit down?",
            "[Reveal] It's not boredom. It's a 60-second dopamine reset your brain learned to crave.",
            "[Twist] The fix isn't willpower. It's giving the reset somewhere else to go.",
        ],
    },
    "what_if": {
        "name": "Surreal What-If",
        "description": "Hypothetical micro-story with dreamlike visuals.",
        "scenes": [
            "[Premise] What if your phone could feel emotions?",
            "[Scenario] It would dread Mondays, panic at low battery, fall in love with chargers.",
            "[Twist] Maybe it already does. You just call it 'glitches.'",
        ],
    },
    "true_crime_micro": {
        "name": "True Crime Micro",
        "description": "Eerie 45–60s case with tense narration.",
        "scenes": [
            "[Setup] In 1923, a woman in a small Vermont town reported her husband missing.",
            "[Mystery] Six months later, his name appeared in a different state's marriage records.",
            "[Hook] The detective who found him said one sentence that ended the case.",
        ],
    },
    "dream_interpretation": {
        "name": "Dream Interpretation",
        "description": "Recreate the dream → unpack the meaning.",
        "scenes": [
            "[Dream] You dreamed you were falling, but you weren't scared.",
            "[Meaning] That's not anxiety. That's surrender — the mind letting go of control.",
            "[Takeaway] Whatever you woke up worrying about today? It already let go of you.",
        ],
    },
}


def list_templates() -> list[dict]:
    """Surface for the GET /templates endpoint. Returns the keys + name +
    description, but not the seed scenes (those land via create)."""
    return [{"id": k, "name": v["name"], "description": v["description"]} for k, v in TEMPLATES.items()]

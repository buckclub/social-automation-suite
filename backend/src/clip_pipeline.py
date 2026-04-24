"""
Clip Maker render pipeline — composed of `PipelineStep`s from
`pipeline_core`. Each step mutates a `PipelineContext` dict; the engine
handles sequencing + progress reporting.

A clip render takes an approved `proposal` + its parent `project`:

    ctx = PipelineContext({
        "project":    <clip_projects dict>,
        "proposal":   <one item from project['proposals']>,
        "config":     <full config.json>,
        "captions":   config['clip_captions'] (falls back to config['captions']),
        "project_root": PROJECT_ROOT,
    })
    await CLIP_PIPELINE.run(ctx, on_progress)

Steps:
  1. SliceSourceStep     — ffmpeg: source.mp4 [start..end] → slice.mp4 (9:16 crop)
  2. WhisperAlignClipStep — faster-whisper on the sliced audio for
                             word-level caption timings
  3. RenderClipStep      — full render with captions overlay using the
                             existing VideoGenerator
  4. ClipThumbnailStep   — grab a still frame for the registry
  5. PersistStep         — push into project['rendered_clips'] and save

Compared to the Reddit pipeline this skips:
  - Reddit fetching (source is the user's upload / YT link)
  - Story formatting
  - TTS (original audio is used)
  - Discord notify (kept out for MVP — can be bolted back on)
"""
from __future__ import annotations
import asyncio
import os
import re
import subprocess
import tempfile
import time
from typing import Optional

from pipeline_core import Pipeline, PipelineContext, PipelineStep, now_iso


# ── Helpers ────────────────────────────────────────────────────────

def _ffmpeg_exe() -> str:
    # moviepy bundles imageio-ffmpeg; reuse its resolved path so Windows
    # users don't need ffmpeg on PATH.
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _safe_slug(s: str, limit: int = 50) -> str:
    s = re.sub(r"[^\w\-_]+", "_", s or "")
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:limit] or "clip"


# ── Steps ──────────────────────────────────────────────────────────

class SliceSourceStep(PipelineStep):
    """
    Slice [start..end] out of the source and re-encode to 9:16 1080×1920.
    Strategy: scale so the source covers the frame, then center-crop.
    Audio passes through untouched.
    """
    id = "slice"
    title = "Slice & reframe"

    async def run(self, ctx: PipelineContext, progress) -> None:
        proj = ctx.project
        prop = ctx.proposal
        source = proj.get("source_file") or ""
        if not source or not os.path.isfile(source):
            raise FileNotFoundError(f"Source file missing: {source}")

        start = float(prop["start"])
        dur = max(0.1, float(prop["end"]) - start)

        out_dir = os.path.join(os.path.dirname(source), "slices")
        os.makedirs(out_dir, exist_ok=True)
        slice_path = os.path.join(out_dir, f"{prop['id']}.mp4")

        # We place -ss BEFORE -i for fast seek, AFTER for frame-accurate.
        # Using BOTH puts us in the sweet spot: fast seek to just before
        # the keyframe then precise cut with the second -ss. Cost is
        # minimal for clips <60s.
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{max(0, start - 0.5):.3f}",
            "-i", source,
            "-ss", "0.5" if start > 0.5 else f"{start:.3f}",
            "-t", f"{dur:.3f}",
            "-vf", (
                # Scale so the shortest dimension covers 1080×1920 (9:16),
                # then crop to exactly 1080×1920 centered.
                "scale='if(gt(a,9/16),ceil(1920*a/2)*2,1080)':'if(gt(a,9/16),1920,ceil(1080/a/2)*2)',"
                "crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2"
            ),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            slice_path,
        ]

        progress(self.id, "sub", f"ffmpeg: {dur:.1f}s clip …", None)

        def _run():
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.strip()[-400:] or "ffmpeg slice failed")
        await asyncio.to_thread(_run)

        ctx["slice_path"] = slice_path


class WhisperAlignClipStep(PipelineStep):
    """
    Run whisper on the sliced audio to get word-level timestamps for
    accurate captions. On a 30-60s clip this is ~5-15s on the 3080.
    """
    id = "align"
    title = "Whisper align"

    def applicable(self, ctx: PipelineContext) -> bool:
        caps = ctx.get("captions") or {}
        if not caps.get("enabled", True):
            return False
        # Event-driven proposals come from gameplay / sports / action
        # footage with no speech worth captioning. Running whisper on
        # them wastes 10-15s per clip and frequently hallucinates
        # "Thanks for watching" over music or SFX. Skip.
        prop = ctx.get("proposal") or {}
        if prop.get("event_kinds"):
            return False
        return True

    async def run(self, ctx: PipelineContext, progress) -> None:
        slice_path = ctx["slice_path"]

        try:
            from whisper_align import is_available, align_audio
        except Exception as e:
            progress(self.id, "sub", f"faster-whisper unavailable — skipping: {e}", None)
            ctx["timeline"] = None
            return

        if not is_available():
            progress(self.id, "sub", "faster-whisper not installed — skipping captions", None)
            ctx["timeline"] = None
            return

        caps = ctx.get("captions") or {}
        model_size = caps.get("align_model_size") or "base"

        def _run():
            return align_audio(slice_path, model_size=model_size)

        progress(self.id, "sub", f"whisper={model_size} on slice", None)
        try:
            words = await asyncio.to_thread(_run)
        except Exception as e:
            progress(self.id, "sub", f"whisper failed: {e}", None)
            ctx["timeline"] = None
            return

        # Build a single-segment timeline matching the shape the renderer
        # expects (list of dicts with `audio_path`, `words`, `duration`).
        if not words:
            ctx["timeline"] = None
            return
        text_all = " ".join(w.get("word", "").strip() for w in words if w.get("word"))
        dur = float(ctx["proposal"]["end"]) - float(ctx["proposal"]["start"])
        ctx["timeline"] = [{
            "audio_path": slice_path,   # reusing the sliced video — renderer
                                        # reads only the audio portion for timing.
            "text":       text_all,
            "author":     "",
            "words":      words,
            "duration":   dur,
        }]


class RenderClipStep(PipelineStep):
    """
    Compose the final 9:16 video: the already-cut + cropped slice is the
    'background' layer, with captions burned over it via the existing
    caption renderer. This is deliberately different from the Reddit
    pipeline — we don't pull a separate background video, and we don't
    play TTS, we play the source's own audio.
    """
    id = "render"
    title = "Render captions"

    async def run(self, ctx: PipelineContext, progress) -> None:
        from video_generator import VideoGenerator
        proj = ctx.project
        prop = ctx.proposal
        cfg = ctx.get("config") or {}
        caps = ctx.get("captions") or {}

        # Skip the overlay step entirely if captions are off — just copy
        # the slice into the renders/ folder and we're done.
        out_dir = os.path.join(
            os.path.dirname(proj["source_file"]), "renders"
        )
        os.makedirs(out_dir, exist_ok=True)
        slug = _safe_slug(prop.get("custom_title") or prop.get("hook_line") or prop["id"])
        final_path = os.path.join(out_dir, f"{prop['id']}_{slug}.mp4")

        timeline = ctx.get("timeline")
        if not caps.get("enabled", True) or not timeline:
            # No captions — symlink / copy slice.
            import shutil
            shutil.copy2(ctx["slice_path"], final_path)
            ctx["final_path"] = final_path
            return

        # Configure a dedicated VideoGenerator whose 'background' is the
        # already-cut slice. We only want the caption overlay work — tell
        # the generator to skip its own bg fetching by pointing its
        # backgrounds_dir at a folder containing just the slice, and
        # using the slice as the single background video.
        video_cfg = cfg.get("video", {}) or {}
        video_gen = VideoGenerator(
            mode=video_cfg.get("mode", "reel"),
            use_gpu=bool(video_cfg.get("use_gpu", False)),
            threads=int(video_cfg.get("threads", 0) or 0),
            hw_accel=video_cfg.get("hw_accel", "none"),
            captions_config=caps,
            thumbnail_config=cfg.get("thumbnail", {}),
        )
        # Pin the background to the sliced clip so the renderer uses that
        # exact file instead of randomising.
        video_gen.backgrounds_dir = os.path.dirname(ctx["slice_path"])
        video_gen.background_selector = os.path.basename(ctx["slice_path"])

        progress(self.id, "sub", "rendering caption overlay", None)
        t0 = time.time()

        def _render():
            return video_gen.generate_video_ffmpeg(
                timeline,
                final_path,
                None, 0.0,
                video_cfg.get("branding", ""),
                prop.get("custom_title") or prop.get("hook_line") or "",
                "",  # subreddit unused
                0,   # score unused
            )

        result = await asyncio.to_thread(_render)
        if not result:
            raise RuntimeError("Render returned no output")
        ctx["final_path"] = final_path
        ctx["render_time_s"] = round(time.time() - t0, 1)


class ClipThumbnailStep(PipelineStep):
    """
    Pull the frame at 10% into the clip as a JPEG thumbnail for the list.
    Best-effort; failures don't abort the render.
    """
    id = "thumbnail"
    title = "Thumbnail"

    async def run(self, ctx: PipelineContext, progress) -> None:
        final = ctx.get("final_path")
        if not final or not os.path.isfile(final):
            return
        thumb = os.path.splitext(final)[0] + "_thumbnail.jpg"
        # Sample at ~1s in so we don't get a potential black first frame.
        cmd = [
            _ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
            "-ss", "1.0", "-i", final,
            "-frames:v", "1",
            "-q:v", "3",
            thumb,
        ]
        def _run():
            subprocess.run(cmd, capture_output=True)
        await asyncio.to_thread(_run)
        if os.path.isfile(thumb):
            ctx["thumbnail_path"] = thumb


class PersistStep(PipelineStep):
    """Push the rendered clip into the project registry."""
    id = "persist"
    title = "Save"

    async def run(self, ctx: PipelineContext, progress) -> None:
        from clip_projects import load_project, save_project
        proj_root = ctx["project_root"]
        pid = ctx.project["id"]
        proj = load_project(proj_root, pid) or ctx.project

        rendered = proj.setdefault("rendered_clips", [])
        # Remove any prior render of this same proposal so re-renders
        # don't accumulate stale entries.
        rendered[:] = [r for r in rendered if r.get("proposal_id") != ctx.proposal["id"]]
        rendered.insert(0, {
            "proposal_id":   ctx.proposal["id"],
            "video_path":    ctx["final_path"],
            "thumbnail_path": ctx.get("thumbnail_path"),
            "created_at":    now_iso(),
            "render_time_s": ctx.get("render_time_s", 0),
            "title":         ctx.proposal.get("custom_title") or ctx.proposal.get("hook_line") or "",
            "start":         ctx.proposal["start"],
            "end":           ctx.proposal["end"],
        })
        save_project(proj_root, proj)


# ── The pipeline itself ────────────────────────────────────────────

CLIP_PIPELINE = Pipeline([
    SliceSourceStep(),
    WhisperAlignClipStep(),
    RenderClipStep(),
    ClipThumbnailStep(),
    PersistStep(),
])

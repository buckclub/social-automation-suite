"""
Storyboard render pipeline.

Walks a project's scenes in order, narrates each line via TTS, length-
matches the per-scene clip to the narration, concatenates everything,
overlays captions, and writes one mp4. Works entirely on operator-
supplied clips — no AI video provider integration.

Architectural choice: instead of bolting per-scene clips onto
`video_generator.generate_video` (which is built around a single
background that gets seeked / looped to fit total duration), this
module owns its own MoviePy composition. Reasons:

  - The split-per-segment-clip model is fundamentally different from
    one-background-many-overlays, and forcing it through the existing
    pipeline would require gating every overlay on a 'is_storyboard?'
    flag.
  - We still reuse the high-value parts of video_generator: the
    caption-image renderer and the title-card builder are called as
    helpers, so caption look + title-card branding stay consistent.

Length-match policy per scene (when narration duration != clip duration):
  trim   — clip > narration: cut clip to narration length (default)
  loop   — clip < narration: repeat clip with cross-fade (default)
  hold   — pad with last-frame freeze (clip<nar) or hard-cut (clip>nar)
  stretch — speed-warp the clip to exactly match narration

`auto` resolves to trim/loop based on whether clip is longer/shorter
than narration. Empty narration => silent scene, just plays the clip.

The pipeline writes progress through the same _set_step / _log
callbacks the Reddit pipeline uses, so the existing PipelinePanel UI
shows scene-by-scene progress without any UI work.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

# Lazy-imported inside functions where applicable (moviepy is heavy and
# we don't want it imported at module load time during routing setup).


# Step IDs used by progress callbacks. Mirrors the Reddit pipeline's
# step shape so the existing UI pipeline panel renders without changes.
STORYBOARD_STEPS = [
    {"id": "validate", "title": "Validate scenes",       "status": "idle", "detail": ""},
    {"id": "tts",      "title": "Generate narration",    "status": "idle", "detail": ""},
    {"id": "video",    "title": "Compose video",         "status": "idle", "detail": ""},
    {"id": "captions", "title": "Render captions",       "status": "idle", "detail": ""},
    {"id": "thumbnail", "title": "Title card + thumb",   "status": "idle", "detail": ""},
    {"id": "write",    "title": "Write final mp4",       "status": "idle", "detail": ""},
]


# ── Helpers ────────────────────────────────────────────────────────

def _probe_duration(path: str) -> Optional[float]:
    """Return clip duration in seconds, or None if probe fails. Used at
    upload time to populate scene.clip_duration_s, and again at render
    time as a sanity check (clips on disk can change between sessions)."""
    try:
        from moviepy.editor import VideoFileClip
        with VideoFileClip(path) as v:
            return float(v.duration)
    except Exception:
        return None


def _resolve_voice(config: dict, voice_override: Optional[str]) -> str:
    """Pick the TTS voice for a scene. Per-scene override beats config
    default. We keep this simple — no narrator-gender resolution or
    multi-provider dispatch; storyboards are typically authored with
    one voice in mind, and the per-scene override handles dialogue."""
    if voice_override and voice_override.strip():
        return voice_override.strip()
    return ((config.get("tts") or {}).get("main_voice")) or "Matthew"


# ── TTS step ───────────────────────────────────────────────────────

def _synthesize_scene_audio(scenes: list[dict], audio_dir: str,
                            config: dict, log: Callable[[str], None],
                            cancel_check: Callable[[], None]) -> list[Optional[str]]:
    """For each scene, synthesize narration → mp3 path. Returns a list
    parallel to scenes; None entries are silent scenes (empty narration).

    Defaults to Streamlabs Polly because it's free + needs no key, which
    is the path most operators will be on. ElevenLabs and other paid
    providers can be added later — for v1 the user explicitly wants to
    keep external dependencies minimal."""
    from tts_engine import StreamlabsTTS

    paths: list[Optional[str]] = []
    for i, scene in enumerate(scenes, start=1):
        cancel_check()
        text = (scene.get("narration") or "").strip()
        if not text:
            paths.append(None)
            log(f"Scene {i}: silent (no narration)")
            continue
        voice = _resolve_voice(config, scene.get("voice_override"))
        tts = StreamlabsTTS(voice=voice, output_dir=audio_dir, cancel_check=cancel_check)
        out_name = f"scene_{i:02d}.mp3"
        log(f"Scene {i}: TTS '{voice}' · {len(text)} chars")
        result = tts.synthesize(text, output_filename=out_name)
        paths.append(result)
    return paths


# ── Length matching ────────────────────────────────────────────────
# Each scene's video gets its audio set to narration audio (or no audio
# for silent scenes). The clip itself gets resized in time to match
# whichever is longer: narration or original clip — operator's chosen
# fit_policy decides how.

def _fit_clip_to_audio(clip, audio_clip, policy: str, log: Callable[[str], None],
                       scene_index: int):
    """Returns (video_clip, target_duration). Caller does set_audio.

    `clip` is a moviepy VideoFileClip (no audio).
    `audio_clip` may be None (silent scene → keep clip native duration).
    """
    if audio_clip is None:
        # Silent scene — return the clip as-is. We don't trim/loop here;
        # operator chose to omit narration so they presumably want the
        # full clip to play.
        return clip, float(clip.duration)

    audio_dur = float(audio_clip.duration)
    clip_dur  = float(clip.duration)
    eps = 0.05  # tolerance for "close enough"

    # Resolve auto → trim/loop/no-op based on which side is longer.
    p = policy or "auto"
    if p == "auto":
        if abs(audio_dur - clip_dur) < eps:
            p = "trim"   # equivalent to no-op when ≈ equal
        elif clip_dur > audio_dur:
            p = "trim"
        else:
            p = "loop"

    if p == "trim":
        # Most common path. If clip is longer, cut from the end.
        # If shorter, fall through to loop with a warning — bare 'trim'
        # on a too-short clip would otherwise leave silent video at the
        # end of the audio.
        if clip_dur >= audio_dur:
            return clip.subclip(0, audio_dur), audio_dur
        log(f"Scene {scene_index}: 'trim' policy but clip ({clip_dur:.1f}s) is shorter than narration ({audio_dur:.1f}s) — falling back to loop")
        p = "loop"

    if p == "hold":
        # Hold last frame to extend, or hard-cut to shorten.
        if clip_dur >= audio_dur:
            return clip.subclip(0, audio_dur), audio_dur
        # clip < narration: build a still-image clip from the last frame
        # and concat it.
        from moviepy.editor import ImageClip, concatenate_videoclips
        last_frame = clip.get_frame(max(0.0, clip_dur - 1.0 / max(clip.fps or 30, 1)))
        pad = ImageClip(last_frame).set_duration(audio_dur - clip_dur).set_fps(clip.fps or 30)
        # No size mismatch concern — last_frame inherits clip dimensions.
        return concatenate_videoclips([clip, pad]), audio_dur

    if p == "stretch":
        # Speedwarp the clip to match narration. MoviePy's speedx does
        # this via fps_changes. Visible at large ratios; we accept that
        # — operator picked stretch knowing the trade-off.
        from moviepy.video.fx.speedx import speedx
        ratio = clip_dur / audio_dur
        return speedx(clip, factor=ratio).set_duration(audio_dur), audio_dur

    # Default / 'loop' path: concat the clip with itself, cross-faded,
    # until total >= narration; then trim to exactly narration.
    if p == "loop":
        from moviepy.editor import concatenate_videoclips
        copies = []
        accum = 0.0
        while accum < audio_dur:
            copies.append(clip)
            accum += clip_dur
        # cross-fade between iterations softens the seam. We use
        # method='compose' which respects size + opacity correctly.
        # crossfadein ~0.3s, capped at half the clip duration so very
        # short clips don't end up entirely fading.
        xfade = min(0.3, max(0.0, clip_dur / 2 - 0.05))
        looped = concatenate_videoclips(copies, method="compose",
                                        padding=-xfade if xfade > 0 else 0)
        return looped.subclip(0, audio_dur), audio_dur

    # Unknown policy — be defensive, behave like trim+pad.
    return _fit_clip_to_audio(clip, audio_clip, "auto", log, scene_index)


# ── Main render entrypoint ─────────────────────────────────────────

async def render_storyboard(
    *,
    project_root: str,
    project_id: str,
    project: dict,
    config: dict,
    log: Callable[[str], None],
    set_step: Callable[..., None],
    cancel_check: Callable[[], None],
) -> Optional[str]:
    """
    Render a storyboard project to mp4. Returns the path to the rendered
    video, or None on failure (caller logs + sets step status).

    `log` and `set_step` are callbacks the orchestrator (api_server)
    passes in so progress flows through the existing pipeline_state +
    SSE bus. `cancel_check` raises if the operator hit Cancel.
    """
    from storyboard_projects import (
        project_audio_dir, project_renders_dir, save_project,
    )

    start_time = time.time()
    scenes = list(project.get("scenes") or [])

    # ── 1. Validate ────────────────────────────────────────────────
    set_step("validate", "running", f"Checking {len(scenes)} scene(s)...")
    valid_scenes: list[dict] = []
    for i, sc in enumerate(scenes, start=1):
        cp = sc.get("clip_path")
        if not cp or not os.path.isfile(cp):
            # Scenes without a clip can't render — skip with a warning.
            # We don't bail entirely; the operator may have left a
            # placeholder mid-edit and rendering the rest is still useful.
            log(f"Scene {i}: skipped (no clip on disk)")
            continue
        valid_scenes.append(sc)
    if not valid_scenes:
        set_step("validate", "error", "No scenes with clips on disk — nothing to render.")
        return None
    set_step("validate", "done", f"{len(valid_scenes)} scene(s) ready")

    # ── 2. TTS ─────────────────────────────────────────────────────
    cancel_check()
    set_step("tts", "running", f"Synthesizing {len(valid_scenes)} narration line(s)...")
    audio_dir = project_audio_dir(project_root, project_id)
    audio_paths = await asyncio.to_thread(
        _synthesize_scene_audio, valid_scenes, audio_dir, config, log, cancel_check
    )
    set_step("tts", "done", f"{sum(1 for p in audio_paths if p)} narrated, "
             f"{sum(1 for p in audio_paths if p is None)} silent")

    # ── 3. Compose ─────────────────────────────────────────────────
    cancel_check()
    set_step("video", "running", "Loading clips + length-matching to narration...")
    from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, CompositeAudioClip

    fitted_clips = []
    scene_durations: list[float] = []  # populated post-fit
    open_handles = []  # so we can close everything regardless of error
    try:
        for i, (sc, ap) in enumerate(zip(valid_scenes, audio_paths), start=1):
            cancel_check()
            cp = sc["clip_path"]
            try:
                vclip = VideoFileClip(cp)
            except Exception as e:
                log(f"Scene {i}: clip load failed ({os.path.basename(cp)}): {e}")
                continue
            open_handles.append(vclip)
            # Strip embedded audio — we'll attach narration if present.
            vclip = vclip.without_audio()
            if ap and os.path.isfile(ap):
                aclip = AudioFileClip(ap)
                open_handles.append(aclip)
                fitted, dur = _fit_clip_to_audio(vclip, aclip, sc.get("fit_policy", "auto"), log, i)
                fitted = fitted.set_audio(aclip)
            else:
                fitted, dur = _fit_clip_to_audio(vclip, None, sc.get("fit_policy", "auto"), log, i)
            fitted_clips.append(fitted)
            scene_durations.append(dur)
            log(f"Scene {i}: fitted {dur:.2f}s")

        if not fitted_clips:
            set_step("video", "error", "No clips loaded successfully.")
            return None

        # Concat all scenes. method='compose' so different resolutions
        # don't crash — each clip is composited into a canvas matching
        # the FIRST clip's size. Operator should keep clips uniform but
        # the renderer shouldn't blow up if they don't.
        composite = concatenate_videoclips(fitted_clips, method="compose")
        total_duration = sum(scene_durations)
        set_step("video", "done", f"Composed {len(fitted_clips)} scene(s) · {total_duration:.1f}s")

        # ── 4. Captions ────────────────────────────────────────────
        # Use the existing video_generator's caption pipeline by
        # building an audio_segments list shaped like the Reddit one.
        # Each scene maps to one segment; that gives the caption chunker
        # a whole narration line to wrap. For silent scenes, no caption.
        cancel_check()
        set_step("captions", "running", "Rendering caption overlays...")
        from video_generator import VideoGenerator
        # We instantiate VideoGenerator just to access its caption
        # rendering helpers — set_audio + write happen here, not there.
        video_mode = (config.get("video") or {}).get("mode", "reel")
        vg = VideoGenerator(
            mode=video_mode,
            use_gpu=False,  # caption rendering is PIL, no GPU.
            captions_config=config.get("captions") or {},
            thumbnail_config=config.get("thumbnail") or {},
            watermark_config=((config.get("video") or {}).get("watermark") or {}),
        )

        from moviepy.editor import ImageClip, CompositeVideoClip
        caption_clips = []
        running_t = 0.0
        for i, (sc, dur, ap) in enumerate(zip(valid_scenes, scene_durations, audio_paths), start=1):
            text = (sc.get("narration") or "").strip()
            if not text or not ap:
                running_t += dur
                continue
            # Build the segment dict shape the caption code expects.
            segment = {
                "text": text,
                "audio_path": ap,
                "author": "",
                "segment_role": "body",
            }
            # Ask the existing chunker to split the narration into
            # word-chunks timed against this segment's duration.
            try:
                chunks = vg._chunk_segment(segment, dur, vg.captions["words_per_caption"])
            except Exception as e:
                log(f"Scene {i}: caption chunker failed: {e}")
                running_t += dur
                continue
            chunk_t = running_t
            for frame in chunks:
                ctext = frame["text"]
                cdur = frame["duration"]
                if not ctext:
                    chunk_t += cdur
                    continue
                try:
                    img_path = vg._render_caption_image_frame(frame)
                except Exception as e:
                    log(f"Scene {i}: caption image failed: {e}")
                    chunk_t += cdur
                    continue
                try:
                    cclip = ImageClip(img_path)
                    cw, ch = cclip.size
                    cx, cy = vg._caption_xy(cw, ch)
                    cclip = (cclip.set_duration(cdur)
                                  .set_position((cx, cy))
                                  .set_start(chunk_t))
                    cclip = vg._animate_clip(cclip, cdur)
                    caption_clips.append(cclip)
                except Exception as e:
                    log(f"Scene {i}: caption clip failed: {e}")
                chunk_t += cdur
            running_t += dur

        if caption_clips:
            composite = CompositeVideoClip([composite] + caption_clips)
        set_step("captions", "done", f"{len(caption_clips)} caption frame(s)")

        # ── 5. Title card (optional, prepended) ────────────────────
        # We deliberately skip Reddit-style title-card prepending here:
        # the storyboard's first scene IS the visual hook the operator
        # designed. Adding a card on top would override their intent.
        # Future extension: a per-project toggle.
        set_step("thumbnail", "done", "Skipped (storyboard owns its own opening)")

        # ── 6. Write ───────────────────────────────────────────────
        cancel_check()
        set_step("write", "running", "Encoding final video...")
        renders_d = project_renders_dir(project_root, project_id)
        render_id = "r" + uuid.uuid4().hex[:8]
        out_path = os.path.join(renders_d, f"{render_id}.mp4")

        # Encode params: 30 fps locked (matches the rest of the suite —
        # see commit 033745f for why the title-card animation needed
        # this). NVENC if available else libx264 medium/crf 18 — same
        # as the Reddit pipeline's default path.
        v_codec = "libx264"
        ffmpeg_params = ["-preset", "medium", "-crf", "18"]
        try:
            # Probe ffmpeg for nvenc — if registered we use it.
            import subprocess
            r = subprocess.run(["ffmpeg", "-encoders"], capture_output=True, text=True)
            if r.returncode == 0 and "h264_nvenc" in r.stdout:
                v_codec = "h264_nvenc"
                ffmpeg_params = ["-preset", "p4", "-rc", "vbr", "-cq", "19", "-b:v", "8M"]
        except Exception:
            pass

        await asyncio.to_thread(
            composite.write_videofile, out_path,
            codec=v_codec, audio_codec="aac",
            fps=30, threads=0, ffmpeg_params=ffmpeg_params,
            verbose=False, logger=None,
        )

        elapsed = time.time() - start_time
        set_step("write", "done", f"Rendered {os.path.basename(out_path)} in {elapsed:.1f}s")

        # ── 7. Record render history on the project ───────────────
        render_entry = {
            "id":            render_id,
            "video_path":    out_path,
            "thumbnail_path": None,  # Not generated in v1 — operator can screenshot or we add later.
            "created_at":    datetime.now(timezone.utc).isoformat(),
            "render_time_s": round(elapsed, 1),
            "duration_s":    round(total_duration, 2),
            "scene_count":   len(fitted_clips),
        }
        proj_now = project  # caller will save back; we mutate the dict.
        proj_now.setdefault("render_history", []).insert(0, render_entry)
        proj_now["status"] = "ready"
        proj_now["status_detail"] = f"Rendered in {elapsed:.1f}s"
        save_project(project_root, proj_now)

        return out_path

    finally:
        # Best-effort cleanup of MoviePy file handles. write_videofile
        # closes the composite for us, but the per-clip readers held
        # open against the source mp4s on disk need explicit close.
        for h in open_handles:
            try: h.close()
            except Exception: pass

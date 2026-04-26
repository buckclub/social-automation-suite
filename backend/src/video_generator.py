"""
Video Generator for Reddit Story Maker.
Combines audio segments with background video and synchronized subtitles.

Author: Faheem Alvi
GitHub: https://github.com/FaheemAlvii
LinkedIn: https://www.linkedin.com/in/faheem-alvi
Email: faheemalvi2000@gmail.com
License: CC BY-NC 4.0
"""
import os
import sys
import random
import textwrap
from typing import List, Optional

# --- Graceful moviepy / PIL imports for A-Shell / iOS compatibility ---
MOVIEPY_AVAILABLE = False
try:
    import numpy as np
    import PIL.Image
    # Monkey patch ANTIALIAS replacement for MoviePy 1.0.3 compatibility with Pillow 10+
    if not hasattr(PIL.Image, 'ANTIALIAS'):
        PIL.Image.ANTIALIAS = PIL.Image.LANCZOS
    from moviepy.editor import (
        VideoFileClip, AudioFileClip, ImageClip, CompositeVideoClip,
        concatenate_audioclips, TextClip, ColorClip, vfx
    )
    MOVIEPY_AVAILABLE = True
except ImportError:
    pass  # moviepy/numpy not available – FFmpeg-only mode

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


def _parse_color_rgba(spec: str, alpha: int = 255) -> tuple[int, int, int, int]:
    """
    Parse a '#RRGGBB' / '#RGB' / named color ('black','white') into an RGBA
    tuple. Unknown strings fall back to black. Kept local to video_generator
    so the shadow rendering stays standalone.
    """
    s = (spec or "").strip().lower()
    named = {"black": (0, 0, 0), "white": (255, 255, 255),
             "red": (255, 0, 0), "green": (0, 255, 0),
             "blue": (0, 0, 255), "yellow": (255, 217, 61)}
    if s in named:
        r, g, b = named[s]
        return (r, g, b, alpha)
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) == 6:
            try:
                return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)
            except ValueError:
                pass
    return (0, 0, 0, alpha)

def _norm_for_match(w: str) -> str:
    """Strip punctuation + lowercase for fuzzy whisper-to-text matching."""
    import re as _re
    return _re.sub(r"[^a-z0-9']", "", (w or "").lower())


def _is_speakable(w: str) -> bool:
    """
    Return True if a token represents actual spoken content. Filters out
    orphan punctuation like '-', ')', '(', '--', '...' which aren't spoken
    and would render as ugly standalone captions.
    """
    if not w:
        return False
    import re as _re
    stripped = _re.sub(r"[^\w']", "", w)
    return bool(stripped)


def _hybrid_align(expected_words: list, whisper_words: list, duration: float):
    """
    Align a list of KNOWN text words to whisper's partial timings.

    Returns a list of word dicts `{word, start, end}` covering all expected
    words. Whisper's matched words are used verbatim; unmatched expected
    words are interpolated linearly between surrounding anchors.

    Strategy: whisper on TTS audio typically produces a *contiguous slice* of
    the real narration (it just starts late or ends early). So we find the
    offset into expected_words where whisper's sequence best fits as a block,
    then do sequential matching from there.

    Returns None if matching fails (too few anchors).
    """
    if not expected_words or not whisper_words:
        return None

    # --- Step 0: Strip leading/trailing whisper hallucinations ---
    # Whisper (especially large-v3) sometimes emits a couple of "ghost" words
    # at the start or end of a clip that actually happen elsewhere in the
    # text. They appear as outliers — a large time gap (>2s) separates them
    # from the main body of detected speech. Keep only the longest run of
    # whisper words whose adjacent gaps are physically plausible.
    MAX_ADJ_GAP = 2.0  # seconds
    if len(whisper_words) >= 3:
        runs: list[list[int]] = []
        cur = [0]
        for i in range(1, len(whisper_words)):
            prev_end = float(whisper_words[i - 1].get("end", 0.0))
            this_start = float(whisper_words[i].get("start", 0.0))
            gap = this_start - prev_end
            if gap <= MAX_ADJ_GAP:
                cur.append(i)
            else:
                runs.append(cur)
                cur = [i]
        runs.append(cur)
        if runs:
            longest = max(runs, key=len)
            if len(longest) < len(whisper_words):
                dropped = len(whisper_words) - len(longest)
                print(f"   ⚠️  whisper: dropped {dropped} hallucinated word(s) "
                      f"(>{MAX_ADJ_GAP}s gap from body)")
                whisper_words = [whisper_words[i] for i in longest]

    if not whisper_words:
        return None

    norm_expected = [_norm_for_match(w) for w in expected_words]
    norm_whisper  = [_norm_for_match((w.get("word") or "")) for w in whisper_words]

    # --- Step 1: Longest Common Subsequence of (whisper_idx, expected_idx) ---
    # This naturally skips whisper hallucinations that don't appear in the
    # known text, and skips expected words that whisper missed. Output is a
    # list of index pairs in monotonic order.
    n_w, n_e = len(norm_whisper), len(norm_expected)
    # DP table of LCS lengths.
    dp = [[0] * (n_e + 1) for _ in range(n_w + 1)]
    for i in range(n_w):
        for j in range(n_e):
            if norm_whisper[i] and norm_whisper[i] == norm_expected[j]:
                dp[i + 1][j + 1] = dp[i][j] + 1
            else:
                dp[i + 1][j + 1] = max(dp[i][j + 1], dp[i + 1][j])
    # Trace back to recover matched pairs.
    matches: list[tuple[int, int]] = []
    i, j = n_w, n_e
    while i > 0 and j > 0:
        if norm_whisper[i - 1] and norm_whisper[i - 1] == norm_expected[j - 1]:
            matches.append((i - 1, j - 1))
            i -= 1; j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    matches.reverse()

    if len(matches) < 3:
        return None

    # --- Step 2: filter matches by TIMING consistency ---
    # Expected-progress and whisper-progress should track roughly linearly.
    # If an anchor's (expected_idx/total_expected) differs wildly from
    # (whisper_time/audio_duration) it's probably a coincidental word match
    # (whisper's "ut" hallucination matching expected "but" at position 8
    # when the rest of the run says it's actually at position 42). Drop it.
    def progress_pair(m):
        w_idx, e_idx = m
        w_t = float(whisper_words[w_idx].get("start", 0.0))
        return (e_idx / max(1, n_e - 1), w_t / max(0.001, duration))

    # Use the median of middle matches as the trusted slope reference.
    # Bad anchors deviate from the median-consistent cluster.
    if len(matches) >= 5:
        sorted_by_time = sorted(matches, key=lambda m: float(whisper_words[m[0]].get("start", 0.0)))
        # Drop anchors whose expected-progress deviates > 0.25 from whisper-progress.
        filtered_matches = []
        for m in matches:
            ep, wp = progress_pair(m)
            if abs(ep - wp) <= 0.3:
                filtered_matches.append(m)
        if len(filtered_matches) >= 3:
            matches = filtered_matches

    # --- Step 3: build anchors from filtered matches ---
    anchors: list[tuple[int, float, float]] = []
    last_e = -1
    for w_idx, e_idx in matches:
        if e_idx <= last_e:
            continue  # ensure strict monotonicity
        ww = whisper_words[w_idx]
        anchors.append((e_idx, float(ww.get("start", 0.0)), float(ww.get("end", 0.0))))
        last_e = e_idx

    # --- Step 3b: speech-rate sanity check ---
    # If the first surviving anchor would force leading captions to flow
    # faster than narrator can physically speak (whisper missed a middle
    # chunk of words, so its first valid anchor sits too far right in the
    # expected text), drop leading anchors until the implied rate matches
    # this segment's overall speech rate. Also do the same for trailing
    # anchors that would force the END of the segment to flow unreasonably
    # fast or slow.
    segment_rate = len(expected_words) / max(0.01, duration)  # words per second
    MAX_RATIO = 1.15  # tolerate up to 15% faster than average before rejecting

    while anchors:
        a_idx, a_start, _ = anchors[0]
        if a_start <= 0.05 or a_idx == 0:
            break
        lead_rate = a_idx / a_start
        if lead_rate <= segment_rate * MAX_RATIO:
            break
        anchors.pop(0)

    # Same for the tail — trailing anchors too close to the end of audio
    # relative to their expected position force trailing captions to speed up.
    while anchors:
        a_idx, _, a_end = anchors[-1]
        remaining_words = len(expected_words) - 1 - a_idx
        remaining_time  = max(0.01, duration - a_end)
        if remaining_words <= 0:
            break
        tail_rate = remaining_words / remaining_time
        if tail_rate <= segment_rate * MAX_RATIO:
            break
        anchors.pop()

    if len(anchors) < 2:
        return None

    if len(anchors) < 2:
        return None  # not enough solid points to interpolate

    # Build the full word list by interpolating between anchors.
    result: list[dict] = [{} for _ in expected_words]

    # Helper: distribute `total_time` across `words` using a char-weighted
    # split PLUS small pauses added after sentence-ending punctuation
    # (period, question mark, em-dash, semicolon). Makes captions respect
    # natural speech cadence instead of flowing uniformly.
    def _distribute(start_t: float, total_time: float, words: list) -> list[dict]:
        if not words or total_time <= 0:
            return [{"word": w, "start": start_t, "end": start_t} for w in words]
        # Weights: chars + pause bonus after strong punctuation.
        weights = []
        for i, w in enumerate(words):
            base = max(1, len(w))
            pause = 0
            if w and w[-1] in ".!?":
                pause = 3   # ~3 char-widths of extra time
            elif w and w[-1] in ",;:":
                pause = 1
            weights.append(base + pause)
        total_w = sum(weights) or 1
        out = []
        cursor = start_t
        for w, weight in zip(words, weights):
            d = total_time * (weight / total_w)
            out.append({"word": w, "start": cursor, "end": cursor + d})
            cursor += d
        return out

    # 1. Leading: expected words before the first anchor.
    first_idx, first_start, first_end = anchors[0]
    if first_idx > 0:
        leading = _distribute(0.0, first_start, expected_words[:first_idx])
        for j, r in enumerate(leading):
            result[j] = r
    result[first_idx] = {"word": expected_words[first_idx], "start": first_start, "end": first_end}

    # 2. Middle: between each pair of consecutive anchors.
    for k in range(1, len(anchors)):
        prev_idx, prev_start, prev_end = anchors[k - 1]
        cur_idx, cur_start, cur_end = anchors[k]
        # Words strictly between are prev_idx+1 .. cur_idx-1
        gap_words = cur_idx - prev_idx - 1
        if gap_words > 0:
            span = max(0.0, cur_start - prev_end)
            per = span / (gap_words + 1)
            for g in range(gap_words):
                ex_i = prev_idx + 1 + g
                s = prev_end + (g + 1) * per * 0 + (g) * per  # start for slot g
                # simpler: distribute evenly
                slot_start = prev_end + (span * (g) / gap_words)
                slot_end = prev_end + (span * (g + 1) / gap_words)
                result[ex_i] = {"word": expected_words[ex_i], "start": slot_start, "end": slot_end}
        result[cur_idx] = {"word": expected_words[cur_idx], "start": cur_start, "end": cur_end}

    # 3. Trailing: expected words after the last anchor.
    last_idx, _, last_end = anchors[-1]
    tail = len(expected_words) - last_idx - 1
    if tail > 0:
        remaining = max(0.2, duration - last_end)
        per = remaining / tail
        for g in range(tail):
            ex_i = last_idx + 1 + g
            result[ex_i] = {
                "word": expected_words[ex_i],
                "start": last_end + g * per,
                "end":   last_end + (g + 1) * per,
            }

    # Sanitize: ensure every slot is filled and times are monotonically increasing.
    for i, r in enumerate(result):
        if not r:
            # Shouldn't happen but guard.
            prev_end = result[i - 1]["end"] if i > 0 else 0.0
            result[i] = {"word": expected_words[i], "start": prev_end, "end": prev_end + 0.1}
    # Enforce monotonicity.
    for i in range(1, len(result)):
        if result[i]["start"] < result[i - 1]["end"]:
            result[i]["start"] = result[i - 1]["end"]
        if result[i]["end"] < result[i]["start"]:
            result[i]["end"] = result[i]["start"] + 0.05
    return result


_SILENCE_CACHE: dict = {}


def _detect_leading_silence(audio_path: str, cap: float = 1.5) -> float:
    """
    Return the number of seconds of silence at the start of an audio file,
    clamped to `cap`. Used to push fallback captions past TTS dead air.
    Cached per-path so we don't re-probe on every chunking call.
    """
    if not audio_path:
        return 0.0
    cached = _SILENCE_CACHE.get(audio_path)
    if cached is not None:
        return min(cached, cap)
    try:
        import subprocess, re as _re
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ff = "ffmpeg"
        # -30 dB threshold catches TTS leading quiet reasonably well.
        r = subprocess.run(
            [ff, "-i", audio_path, "-af",
             "silencedetect=noise=-30dB:d=0.05", "-f", "null", "-"],
            capture_output=True, text=True,
        )
        # We only care about the first silence_end line (if present at t≈0).
        first_end = 0.0
        for line in r.stderr.splitlines():
            m = _re.search(r"silence_end: ([\d.]+)", line)
            if m:
                first_end = float(m.group(1))
                break
        # Only consider it "leading silence" if it starts very near t=0.
        # (silencedetect reports silence_start too — check it's small.)
        first_start = None
        for line in r.stderr.splitlines():
            m = _re.search(r"silence_start: ([\d.]+)", line)
            if m:
                first_start = float(m.group(1))
                break
        if first_start is not None and first_start > 0.3:
            first_end = 0.0  # first silence isn't at the start
        _SILENCE_CACHE[audio_path] = first_end
        return min(first_end, cap)
    except Exception:
        _SILENCE_CACHE[audio_path] = 0.0
        return 0.0


if getattr(sys, "frozen", False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class VideoGenerator:
    """
    Generates videos from audio segments and background footage.
    """
    
    def __init__(self, mode: str = 'reel', use_gpu: bool = False, threads: int = 0, hw_accel: str = 'none',
                 captions_config: Optional[dict] = None,
                 thumbnail_config: Optional[dict] = None,
                 watermark_config: Optional[dict] = None):
        """
        Initialize video generator.
        mode: 'reel' (9:16) or 'full' (16:9)
        use_gpu: Whether to use hardware encoding (legacy, overridden by hw_accel)
        threads: Number of threads for writing video (0 = auto/max)
        hw_accel: Hardware acceleration type: 'none' (CPU), 'nvenc' (NVIDIA), 'amf' (AMD)
        captions_config: Caption appearance/timing config (see _caption_params).
        thumbnail_config: Title-card customization — profile pic, username,
            whether to draw the fake hearts/share stats bar.
        watermark_config: Position / opacity / font_size for the branding
            watermark overlay. Schema: { x_pct, y_pct, opacity, font_size,
            bg_box }. Missing → bottom-right legacy defaults preserved.
        """
        self.watermark_config = watermark_config or {}
        self.mode = mode.lower()
        self.hw_accel = hw_accel if hw_accel in ('none', 'nvenc', 'amf') else ('nvenc' if use_gpu else 'none')
        self.use_gpu = self.hw_accel != 'none'
        self.threads = threads if threads and threads > 0 else os.cpu_count() or 4

        print(f"   ⚙️  Video Processor configured with {self.threads} threads.")

        if self.mode == 'reel' or self.mode == 'short_reel':
            self.width = 1080
            self.height = 1920
            self.aspect_ratio = 9/16
        else:
            self.width = 1920
            self.height = 1080
            self.aspect_ratio = 16/9

        self.backgrounds_dir = os.path.join(PROJECT_ROOT, "backgrounds")
        if not os.path.exists(self.backgrounds_dir):
            os.makedirs(self.backgrounds_dir)

        # Which background to use for this render:
        #   - ""                  → random from ALL videos under backgrounds/ (recursive)
        #   - "folder/sub"        → random from that folder (recursive inside it)
        #   - "folder/clip.mp4"   → that specific file
        # Set via `video.background_selector` in config, overridable per-run.
        self.background_selector: str = ""

        self.captions = self._caption_params(captions_config or {})
        self.thumbnail = self._thumbnail_params(thumbnail_config or {})

    def set_background_selector(self, selector: str) -> None:
        """Assign the selector from api_server once the config is loaded."""
        self.background_selector = (selector or "").strip().replace("\\", "/")

    # ── Background resolution ──────────────────────────────────────────
    _VIDEO_EXTS = (".mp4", ".mov", ".avi", ".mkv", ".webm")

    def _iter_backgrounds(self, rel_path: str = "") -> list[str]:
        """Return absolute paths of every background video under backgrounds_dir/<rel_path> (recursive)."""
        root = os.path.join(self.backgrounds_dir, rel_path) if rel_path else self.backgrounds_dir
        root = os.path.abspath(root)
        # Refuse to walk outside backgrounds_dir (defensive against config injection).
        if not root.startswith(os.path.abspath(self.backgrounds_dir)):
            return []
        if not os.path.isdir(root):
            return []
        out: list[str] = []
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f.lower().endswith(self._VIDEO_EXTS):
                    out.append(os.path.join(dirpath, f))
        return out

    def _pick_background(self) -> Optional[str]:
        """
        Resolve self.background_selector to a single absolute mp4 path.
        Falls back through: specific file → folder random → all random.
        """
        sel = (self.background_selector or "").strip().replace("\\", "/").lstrip("/")
        if sel:
            candidate = os.path.abspath(os.path.join(self.backgrounds_dir, sel))
            # Safety: must stay inside backgrounds_dir
            if candidate.startswith(os.path.abspath(self.backgrounds_dir)):
                if os.path.isfile(candidate) and candidate.lower().endswith(self._VIDEO_EXTS):
                    return candidate
                if os.path.isdir(candidate):
                    files = self._iter_backgrounds(sel)
                    if files:
                        return random.choice(files)
                # Selector pointed somewhere that no longer exists — fall through
                # to all-backgrounds so a stale config doesn't break the render.
        all_files = self._iter_backgrounds()
        return random.choice(all_files) if all_files else None

    def _thumbnail_params(self, cfg: dict) -> dict:
        """Normalize title-card config with sensible defaults.

        Visual knobs:
          profile_pic_path  — avatar file (masked into a circle).
          username          — handle text (auto '@' prefix if bare).
          hide_stats        — drop the fake ♡/⤴ bottom bar.
          card_bg_color     — the white card behind the title (hex).
          text_color        — title text.
          username_color    — the handle above the title.
          accent_color      — fallback avatar fill + part badge.
          corner_radius     — rounded-card radius (px).
          card_max_width_pct— 0..1 — width of card relative to frame.
          title_font_size   — title text px.
          username_font_size— handle px.
        """
        def _hex(value, default):
            v = (value or "").strip()
            return v if v else default
        def _num(value, default):
            try: return float(value)
            except (TypeError, ValueError): return default

        pic_path = (cfg.get('profile_pic_path') or '').strip()
        if pic_path and not os.path.isabs(pic_path):
            pic_path = os.path.join(PROJECT_ROOT, pic_path)
        return {
            'profile_pic_path':   pic_path,
            'username':           (cfg.get('username') or '').strip(),
            'hide_stats':         bool(cfg.get('hide_stats', True)),
            'card_bg_color':      _hex(cfg.get('card_bg_color'),     '#FFFFFF'),
            'text_color':         _hex(cfg.get('text_color'),        '#141414'),
            'username_color':     _hex(cfg.get('username_color'),    '#1E1E1E'),
            'accent_color':       _hex(cfg.get('accent_color'),      '#FF4500'),
            'corner_radius':      int(_num(cfg.get('corner_radius'),    30)),
            'card_max_width_pct': max(0.3, min(1.0, _num(cfg.get('card_max_width_pct'), 0.84))),
            'title_font_size':    int(_num(cfg.get('title_font_size'),  52)),
            'username_font_size': int(_num(cfg.get('username_font_size'), 36)),
        }

    def _caption_params(self, cfg: dict) -> dict:
        """Normalize caption config with sensible defaults."""
        is_reel = self.mode in ('reel', 'short_reel')
        return {
            'enabled':         bool(cfg.get('enabled', True)),
            'font_path':       cfg.get('font_path') or 'arial.ttf',
            'font_size':       int(cfg.get('font_size', 70 if is_reel else 50)),
            'color':           cfg.get('color', 'white'),
            'stroke_color':    cfg.get('stroke_color', 'black'),
            'stroke_width':    int(cfg.get('stroke_width', 0)),
            'bg_color':        cfg.get('bg_color', 'black'),   # null/"" to disable box
            'bg_opacity':      int(cfg.get('bg_opacity', 160)),
            'padding':         int(cfg.get('padding', 40)),
            'corner_radius':   int(cfg.get('corner_radius', 20)),
            'max_width_pct':   float(cfg.get('max_width_pct', 0.8)),
            'position':        cfg.get('position', 'center'),   # 'center' | 'bottom' | 'top'
            'position_offset': int(cfg.get('position_offset', 0)),
            'words_per_caption': int(cfg.get('words_per_caption', 0)),  # 0 = whole segment
            'uppercase':       bool(cfg.get('uppercase', False)),
            'attribution':     bool(cfg.get('attribution', True)),
            # Animation modes:
            #   'none'              — static
            #   'fade' / 'pop' / 'fade_pop'  — chunk-level entry animations (MoviePy engine only)
            #   'karaoke_fill'      — every word UP TO the active one is in
            #                          highlight color (cumulative), like a
            #                          karaoke prompter sweeping left-to-right.
            #                          Requires highlight_word + alignment.
            #                          Works on the FFmpeg engine.
            #   'boxed_word'        — every word gets a colored pill behind it;
            #                          the active word's pill is the highlight
            #                          color. Works on the FFmpeg engine.
            'animation':       (cfg.get('animation') or 'none').lower(),
            'animation_duration': float(cfg.get('animation_duration', 0.15)),
            'pop_overshoot':   float(cfg.get('pop_overshoot', 1.12)),
            'pop_start_scale': float(cfg.get('pop_start_scale', 0.7)),
            # Per-word highlight (requires whisper alignment).
            'highlight_word':  bool(cfg.get('highlight_word', False)),
            'highlight_color': cfg.get('highlight_color', '#FFD93D'),   # yellow
            'highlight_scale': float(cfg.get('highlight_scale', 1.0)),  # 1.0 = no scale
            'highlight_stroke_color': cfg.get('highlight_stroke_color', cfg.get('stroke_color', 'black')),
            # Boxed-word style — pill background per word.
            'boxed_word_radius':   int(cfg.get('boxed_word_radius', 12)),
            'boxed_word_padding_x': int(cfg.get('boxed_word_padding_x', 14)),
            'boxed_word_padding_y': int(cfg.get('boxed_word_padding_y', 6)),
            'boxed_word_inactive_color': cfg.get('boxed_word_inactive_color', '#000000'),
            'boxed_word_inactive_opacity': int(cfg.get('boxed_word_inactive_opacity', 180)),
            # Safety rails against runaway captions when whisper has gaps in the audio.
            'max_chunk_duration': float(cfg.get('max_chunk_duration', 2.5)),  # seconds per chunk
            'lead_in_grace':      float(cfg.get('lead_in_grace', 1.0)),       # seconds of lead before first word
            # When true: every chunk renders on a single line. If the chunk
            # doesn't fit at the base font size, we uniformly scale the entire
            # chunk's font down until it fits — never wrap mid-word or to a
            # second row. Off by default for backward compatibility.
            'single_line':        bool(cfg.get('single_line', False)),

            # ── Drop shadow (soft blurred shadow behind text) ─────────────
            # Off by default so existing configs render identically. When on,
            # a gaussian-blurred copy of the text is rendered beneath the
            # real text at (offset_x, offset_y). Works on both the pill-box
            # and the transparent/per-word caption paths.
            'shadow_enabled':     bool(cfg.get('shadow_enabled', False)),
            'shadow_color':       cfg.get('shadow_color', '#000000'),
            'shadow_opacity':     int(cfg.get('shadow_opacity', 180)),
            'shadow_offset_x':    int(cfg.get('shadow_offset_x', 4)),
            'shadow_offset_y':    int(cfg.get('shadow_offset_y', 4)),
            'shadow_blur':        int(cfg.get('shadow_blur', 6)),
        }

    def _caption_xy(self, w: int, h: int) -> tuple:
        """Compute top-left coords for a caption box sized wxh."""
        p = self.captions
        x = (self.width - w) // 2
        if p['position'] == 'bottom':
            y = int(self.height * 0.78) - h // 2 + p['position_offset']
        elif p['position'] == 'top':
            y = int(self.height * 0.18) - h // 2 + p['position_offset']
        else:
            y = (self.height - h) // 2 + p['position_offset']
        return x, y

    def _chunk_segment(self, segment_or_text, duration: float, words_per_caption: int):
        """
        Produce a list of caption chunks covering `duration` seconds.

        If `segment_or_text` is a segment dict containing `words` (from whisper
        alignment), each chunk is anchored to real word timestamps — an empty
        ("", dur) tuple fills silent gaps. Otherwise chunks are spaced evenly
        by character count across the segment duration.

        Returns [(text_or_empty, dur), ...].
        """
        if isinstance(segment_or_text, dict):
            segment = segment_or_text
            text = (segment.get("text") or "").strip()
            words = segment.get("words") or []
        else:
            segment = None
            text = (segment_or_text or "").strip()
            words = []

        # --- Always align whisper TIMING onto the known EXPECTED text ---
        # Whisper occasionally hallucinates training-data phrases like
        # "Subtitled by the Amara.org community" or "Thanks for watching".
        # If we use its transcription text verbatim, those artifacts end up on
        # screen. Instead: display the text we KNOW was sent to TTS, and use
        # whisper only as a timing source. Hallucinations can't leak through
        # because their (junk) words never match the expected text during LCS,
        # so they contribute no anchors and are silently ignored.
        if words and isinstance(segment_or_text, dict):
            expected_words = (segment.get("text") or "").split()
            if len(expected_words) >= 3:
                hybrid = _hybrid_align(expected_words, words, duration)
                if hybrid is not None:
                    if len(words) != len(expected_words):
                        print(f"   ✎ aligning {len(words)} whisper word(s) onto {len(expected_words)} expected word(s)")
                    words = hybrid

        # Safety fallback: if whisper has a huge gap between words that we
        # couldn't hybrid-fill, revert to even distribution of known text.
        if words and len(words) >= 2:
            max_gap = max((float(words[i + 1].get("start", 0)) - float(words[i].get("end", 0)))
                          for i in range(len(words) - 1))
            if max_gap > 4.0:
                print(f"   ⚠️  whisper left a {max_gap:.1f}s gap; using even distribution")
                words = []

        if words and words_per_caption > 0:
            highlight = bool(self.captions.get('highlight_word'))
            # True when per-word timings came from the TTS engine itself
            # (ElevenLabs /with-timestamps). These are sample-accurate, so we
            # can anchor highlight frames to real speech boundaries instead of
            # the char-weight estimate used for jittery whisper timings.
            native = bool(isinstance(segment_or_text, dict) and segment_or_text.get("native_timings"))

            # Defensive cleanup: strip SentencePiece markers and zero-width chars
            # that occasionally leak through from whisper tokenization and render
            # as "tofu" boxes in fonts that lack those glyphs.
            import re as _re
            _JUNK = _re.compile(
                "[\u2581\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064"
                "\ufe00-\ufe0f\ufeff\ufff9-\ufffb]"
            )
            def _clean(s: str) -> str:
                if not s:
                    return ""
                s = _JUNK.sub("", s)
                s = _re.sub(r"\s+", " ", s).strip()
                return s

            # Drop un-speakable tokens (standalone punctuation, empty) before
            # chunking so we don't render "- and", ")", etc. as caption words.
            words = [w for w in words if _is_speakable(_clean(w.get("word") or ""))]
            if not words:
                words = []

            # Build groups with their whisper-anchored start. Drop words that
            # clean to empty.
            groups = []
            for i in range(0, len(words), words_per_caption):
                grp = [w for w in words[i:i + words_per_caption] if _clean(w.get("word") or "")]
                if not grp:
                    continue
                chunk_text = " ".join(_clean(w.get("word") or "") for w in grp).strip()
                grp_start = max(0.0, float(grp[0].get("start", 0.0)))
                groups.append((chunk_text, grp_start, grp))

            out = []

            # Policy: captions cover the ENTIRE segment with no blanks.
            # Each chunk is visible from its own "display start" until the next
            # chunk's display start. Display starts:
            #   * First chunk: t=0, so any leading silence gets the first caption.
            #   * Middle chunks: at the whisper-reported start of the group's
            #     first word (snaps to speech).
            #   * Last chunk: extends until the segment end so the final words
            #     hold on screen rather than cutting to black.
            chunk_display_starts = []
            for i, (_txt, g_start, _grp) in enumerate(groups):
                if i == 0:
                    chunk_display_starts.append(0.0)
                else:
                    chunk_display_starts.append(min(duration, max(chunk_display_starts[-1] + 0.04, g_start)))

            for i, (chunk_text, grp_start, grp) in enumerate(groups):
                start_t = chunk_display_starts[i]
                end_t   = chunk_display_starts[i + 1] if i + 1 < len(groups) else duration
                end_t   = min(duration, max(start_t + 0.04, end_t))
                total_dur = end_t - start_t

                word_list = [_clean(w.get("word") or "") for w in grp]

                # The chunk is visible for the whole total_dur. Whisper's
                # intra-chunk word timestamps have too much jitter (±80ms) and
                # produce 40ms highlight frames that look like a glitch.
                #
                # Policy:
                #   * Use whisper for CHUNK boundaries (start_t / end_t) — solid.
                #   * Distribute the per-word HIGHLIGHT evenly by char weight
                #     within the chunk. Visually smooth, viewer-readable.
                #   * Cap the visible chunk at SOFT_MAX; excess becomes a
                #     no-highlight hold frame so long silence doesn't freeze
                #     the highlight on one word.
                SOFT_MAX = 4.0
                MIN_FRAME = 0.16  # 160 ms — below this looks like a flash

                if not highlight or len(grp) <= 1:
                    if total_dur > SOFT_MAX:
                        out.append({"text": chunk_text, "duration": SOFT_MAX,
                                    "words": word_list, "active_index": -1})
                        out.append({"text": chunk_text, "duration": total_dur - SOFT_MAX,
                                    "words": word_list, "active_index": -1})
                    else:
                        out.append({"text": chunk_text, "duration": total_dur,
                                    "words": word_list, "active_index": -1})
                    continue

                # === NATIVE TIMINGS PATH ===
                # ElevenLabs /with-timestamps gives us real per-word start/end
                # timings. Use them to anchor each highlight frame to the
                # actual moment the word is spoken — no char-weight guessing,
                # no MIN_FRAME promotion that can eat short words.
                if native:
                    n = len(grp)
                    # Absolute segment-relative starts for each word in the group.
                    w_starts = [max(0.0, float(grp[j].get("start", 0.0))) for j in range(n)]
                    w_ends   = [max(w_starts[j], float(grp[j].get("end", w_starts[j]))) for j in range(n)]

                    # Each word's highlight window = [w_starts[j], w_starts[j+1])
                    # clipped into the chunk's [start_t, end_t] display window.
                    # For the last word, extend to end_t so the final highlight
                    # holds until the next chunk begins.
                    frames = []
                    # Optional pre-hold if the chunk is displayed before word 0
                    # is actually spoken (e.g. first chunk pinned at t=0).
                    first_start = max(start_t, min(end_t, w_starts[0]))
                    if first_start - start_t > 0.05:
                        frames.append({"text": chunk_text,
                                       "duration": first_start - start_t,
                                       "words": word_list, "active_index": -1})
                    for j in range(n):
                        j_start = max(start_t, min(end_t, w_starts[j]))
                        j_end   = end_t if j == n - 1 else max(j_start, min(end_t, w_starts[j + 1]))
                        dur = j_end - j_start
                        if dur <= 0.001:
                            # Word has zero (or negative) on-screen time because
                            # the NEXT word starts before this one in the timeline
                            # (can happen on rapid-fire "I, uh," style runs).
                            # Steal a tiny window from the next frame so this
                            # word still briefly highlights.
                            dur = 0.08
                        frames.append({"text": chunk_text, "duration": dur,
                                       "words": word_list, "active_index": j})
                    # Normalize: native word timings are reported relative to
                    # the TTS audio. If their sum overshoots total_dur (edge
                    # case on last chunk), proportionally trim the last frame.
                    tot = sum(f["duration"] for f in frames)
                    if tot > total_dur + 0.02 and frames:
                        overshoot = tot - total_dur
                        # Trim from the last active frame, not a pre-hold.
                        for k in range(len(frames) - 1, -1, -1):
                            if frames[k]["duration"] > overshoot + 0.1:
                                frames[k]["duration"] -= overshoot
                                break
                    out.extend(frames)
                    continue

                # Only the portion up to SOFT_MAX gets per-word highlight; the
                # rest (if any) becomes a hold frame.
                visible = min(total_dur, SOFT_MAX)
                tail    = total_dur - visible

                n = len(grp)
                # Char-weighted distribution of `visible` across the group's words.
                weights = [max(1, len(w)) for w in word_list]
                tot_w = sum(weights) or 1
                # If any word's allocation would be below MIN_FRAME, promote to
                # MIN_FRAME and scale the rest. If we can't fit MIN per word
                # (chunk too short), fall back to a single no-highlight frame.
                if visible < MIN_FRAME * n:
                    out.append({"text": chunk_text, "duration": total_dur,
                                "words": word_list, "active_index": -1})
                    continue
                raw = [visible * (w / tot_w) for w in weights]
                short = sum(1 for d in raw if d < MIN_FRAME)
                if short:
                    # Enforce MIN on short ones, rescale long ones to absorb.
                    fixed_sum = MIN_FRAME * short
                    long_durs = [d for d in raw if d >= MIN_FRAME]
                    long_sum = sum(long_durs)
                    if long_sum > fixed_sum and (visible - fixed_sum) > 0:
                        scale = (visible - fixed_sum) / long_sum
                        new_durs = []
                        for d in raw:
                            new_durs.append(MIN_FRAME if d < MIN_FRAME else d * scale)
                        raw = new_durs
                    else:
                        # Not enough slack; just give each word equal time.
                        raw = [visible / n] * n

                for j in range(n):
                    out.append({"text": chunk_text, "duration": raw[j],
                                "words": word_list, "active_index": j})

                if tail > 0.05:
                    out.append({"text": chunk_text, "duration": tail,
                                "words": word_list, "active_index": -1})

            # Drop zero-duration slivers but NEVER emit a blank caption.
            out = [f for f in out if f["duration"] > 0.001]
            if not out:
                return [{"text": text, "duration": duration,
                         "words": [text] if text else [], "active_index": -1}]
            # Final guard: merge any still-too-short frame forward into its
            # neighbor. Prevents any single flash no matter what upstream
            # produced (edge cases in hybrid back-fill, trailing squeeze, etc).
            #
            # For native ElevenLabs timings the merge threshold is lowered
            # aggressively — every frame there is anchored to a real word
            # boundary, and eating a 0.12s frame means losing that word's
            # highlight entirely (user-visible "highlight doesn't appear"
            # symptom). Only filter out true sub-frame flashes.
            MIN_FINAL = 0.05 if native else 0.14
            merged = []
            for f in out:
                if merged and f["duration"] < MIN_FINAL:
                    # absorb into previous, BUT preserve the absorbed frame's
                    # active_index if the previous was a no-highlight hold
                    # (otherwise a pre-hold would swallow word 0's highlight).
                    prev = merged[-1]
                    new_active = prev["active_index"]
                    if prev["active_index"] == -1 and f.get("active_index", -1) >= 0:
                        new_active = f["active_index"]
                    merged[-1] = {**prev,
                                  "duration": prev["duration"] + f["duration"],
                                  "active_index": new_active}
                else:
                    merged.append(dict(f))
            # If the very FIRST frame is too short, merge it forward.
            if len(merged) >= 2 and merged[0]["duration"] < MIN_FINAL:
                merged[1]["duration"] += merged[0]["duration"]
                merged = merged[1:]
            return merged

        # --- Fallback: even char-weighted chunking ---
        # Still produces per-word highlight frames when `highlight_word` is on,
        # by evenly distributing word durations. Not whisper-accurate, but
        # matches speech rate closely enough that captions never sit frozen.
        if words_per_caption <= 0 or not text:
            return [{"text": text, "duration": duration, "words": text.split() if text else [], "active_index": -1}]
        # Skip pure-punctuation tokens — they're not spoken and look ugly as captions.
        tok = [t for t in text.split() if _is_speakable(t)]
        if not tok:
            return [{"text": text, "duration": duration, "words": [], "active_index": -1}]

        # Leading-silence compensation: TTS clips usually have 0.1–0.4s of
        # dead air before the first word. Distributing captions across the
        # full duration makes them feel slightly ahead of the voice. Pull
        # a measured lead-time from:
        #   1) The audio file's silencedetect (preferred), via ffprobe
        #   2) The original `segment.words[0].start` if any whisper words
        #      survived — gives us a confirmed speech-starts-at anchor
        #   3) A conservative default of 0.2s
        lead_silence = 0.0
        audio_path = None
        if isinstance(segment_or_text, dict):
            audio_path = segment_or_text.get("audio_path")
            orig_words = segment_or_text.get("words") or []
            if orig_words:
                lead_silence = max(0.0, min(1.5, float(orig_words[0].get("start", 0.0))))
        if audio_path and lead_silence == 0.0:
            lead_silence = _detect_leading_silence(audio_path, cap=1.2)
        if lead_silence == 0.0:
            lead_silence = 0.2  # conservative TTS default

        # Clamp so we still have time to render something.
        lead_silence = min(lead_silence, max(0.0, duration * 0.2))
        speech_dur = max(0.2, duration - lead_silence)

        chunks_text = [' '.join(tok[i:i + words_per_caption])
                       for i in range(0, len(tok), words_per_caption)]
        chunks_words = [tok[i:i + words_per_caption]
                        for i in range(0, len(tok), words_per_caption)]
        total_chars = sum(len(c) for c in chunks_text) or 1

        highlight = bool(self.captions.get('highlight_word'))
        out = []
        # Leading blank frame so captions don't pre-roll during TTS dead air.
        if lead_silence > 0.05:
            out.append({"text": "", "duration": lead_silence, "words": [], "active_index": -1})

        allocated = 0.0
        for i, (c_text, c_words) in enumerate(zip(chunks_text, chunks_words)):
            if i == len(chunks_text) - 1:
                c_dur = max(0.04, speech_dur - allocated)
            else:
                c_dur = speech_dur * (len(c_text) / total_chars)
                allocated += c_dur

            if not highlight or len(c_words) <= 1:
                out.append({"text": c_text, "duration": c_dur,
                            "words": c_words, "active_index": -1})
                continue

            word_chars = sum(len(w) for w in c_words) or 1
            sub_alloc = 0.0
            for j, w in enumerate(c_words):
                if j == len(c_words) - 1:
                    dur = max(0.04, c_dur - sub_alloc)
                else:
                    dur = c_dur * (len(w) / word_chars)
                    sub_alloc += dur
                out.append({"text": c_text, "duration": dur,
                            "words": c_words, "active_index": j})
        return out

    def _animate_clip(self, clip, chunk_dur: float):
        """
        Apply the configured caption animation to an ImageClip.
        Safe against very short chunks — animation is capped at 40% of duration.
        """
        anim = self.captions['animation']
        if anim == 'none' or chunk_dur <= 0:
            return clip

        d = min(self.captions['animation_duration'], max(0.02, chunk_dur * 0.4))

        if anim in ('fade', 'fade_pop'):
            clip = clip.crossfadein(d).crossfadeout(d)

        if anim in ('pop', 'fade_pop'):
            start_scale = self.captions['pop_start_scale']
            overshoot = self.captions['pop_overshoot']
            def scale_at(t, _d=d, _s=start_scale, _o=overshoot):
                if t >= _d:
                    return 1.0
                # Ease: start → overshoot at 70% → settle to 1.0
                p = t / _d
                if p < 0.7:
                    k = p / 0.7
                    return _s + (_o - _s) * k
                k = (p - 0.7) / 0.3
                return _o + (1.0 - _o) * k
            clip = clip.resize(scale_at)

        return clip
            
    def create_text_image(self, text: str, fontsize: int = 60, color: str = 'white',
                         bg_color: Optional[str] = None, max_width: int = 800,
                         use_bg_box: bool = False, bg_opacity: int = 255, padding: int = 40,
                         font_path: Optional[str] = None, stroke_color: str = 'black',
                         stroke_width: Optional[int] = None, corner_radius: int = 20,
                         uppercase: bool = False, single_line: bool = False,
                         shadow: Optional[dict] = None) -> str:
        """
        Create an image with text using Pillow.
        Returns path to temporary image file.
        """
        if uppercase:
            text = text.upper()
        # Create a dummy image to calculate text size
        # Try to load the requested font; fall back to arial then default
        font = None
        for candidate in (font_path, 'arial.ttf'):
            if not candidate:
                continue
            try:
                font = ImageFont.truetype(candidate, fontsize)
                break
            except OSError:
                continue
        if font is None:
            font = ImageFont.load_default()
            
        # Wrap text to fit `max_width` in pixels. The old avg-char-width estimate
        # was inaccurate for wide display fonts (Gotham, Impact etc) and caused
        # rendered PNGs to overflow the frame. Using the actual font metrics
        # guarantees the text fits.
        budget = max(1, max_width - 2 * padding - 2 * max(0, stroke_width or 0))
        words = text.split()
        lines: list[str] = []
        if not words:
            lines = [""]
        elif single_line:
            # Single-line mode — measure the whole chunk, scale the font down
            # uniformly if it's over budget, never wrap. Mirrors the logic in
            # _render_highlighted_caption so both paths behave the same when
            # the user flips 'Fit on one line'.
            joined = " ".join(words)
            total = font.getlength(joined)
            if total > budget:
                ratio = (budget / total) * 0.97
                new_size = max(10, int(round(fontsize * ratio)))
                if new_size != fontsize:
                    fontsize = new_size
                    try:
                        font = ImageFont.truetype(font_path or 'arial.ttf', fontsize)
                    except OSError:
                        font = ImageFont.load_default()
            lines = [joined]
        else:
            current = words[0]
            # If a single word exceeds the budget, shrink the font until it fits.
            while font.getlength(current) > budget and fontsize > 10:
                fontsize -= 2
                try:
                    font = ImageFont.truetype(font_path or 'arial.ttf', fontsize)
                except OSError:
                    font = ImageFont.load_default()
                budget = max(1, max_width - 2 * padding - 2 * max(0, stroke_width or 0))
            for w in words[1:]:
                candidate = current + " " + w
                if font.getlength(candidate) <= budget:
                    current = candidate
                else:
                    lines.append(current)
                    current = w
                    while font.getlength(current) > budget and fontsize > 10:
                        fontsize -= 2
                        try:
                            font = ImageFont.truetype(font_path or 'arial.ttf', fontsize)
                        except OSError:
                            font = ImageFont.load_default()
                        budget = max(1, max_width - 2 * padding - 2 * max(0, stroke_width or 0))
            lines.append(current)
        wrapped_text = "\n".join(lines)

        # Resolve stroke width up-front so it's included in size measurement.
        sw_measure = stroke_width if stroke_width is not None else (0 if use_bg_box else 3)

        dummy_draw = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        bbox = dummy_draw.multiline_textbbox((0, 0), wrapped_text, font=font, stroke_width=sw_measure)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        # Drop-shadow headroom — mirrors the logic in _render_highlighted_caption.
        sh = shadow or {}
        sh_on = bool(sh.get('enabled'))
        sh_ox = int(sh.get('offset_x', 0)) if sh_on else 0
        sh_oy = int(sh.get('offset_y', 0)) if sh_on else 0
        sh_blur = max(0, int(sh.get('blur', 0))) if sh_on else 0
        sh_rgba = _parse_color_rgba(sh.get('color') or '#000000',
                                    alpha=max(0, min(255, int(sh.get('opacity', 180)))))
        sh_pad = max(abs(sh_ox), abs(sh_oy)) + sh_blur * 3 + 2 if sh_on else 0

        img_width = text_width + padding * 2 + 2 * sh_pad
        img_height = text_height + padding * 2 + 2 * sh_pad

        # Create image
        if use_bg_box and bg_color:
            # Create a transparent base image first
            img = Image.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
            # Draw the semitransparent box
            # Parse hex colors if needed or assume standard names
            # Pillow doesn't handle hex with alpha well in all versions, so let's convert simple names or leave as is
            # Ideally we draw a rectangle with RGBA color
            
            box_color = None
            if bg_color.startswith('#'):
                 # Convert hex to RGB
                h = bg_color.lstrip('#')
                rgb = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
                box_color = rgb + (bg_opacity,)
            else:
                # Basic color name map or fallback
                # For simplicity, if it's 'black' or 'white'
                if bg_color.lower() == 'black':
                    box_color = (0, 0, 0, bg_opacity)
                elif bg_color.lower() == 'white':
                    box_color = (255, 255, 255, bg_opacity)
                else: 
                     # Allow Pillow to handle it, but opacity won't work easily on string names without conversion
                     # Default to black with opacity if logic fails
                     box_color = (0, 0, 0, bg_opacity)
            
            # Draw rounded rectangle (pill shape-ish). Inset by sh_pad so
            # the shadow can extend outside the box edges when enabled.
            draw.rounded_rectangle(
                [(sh_pad, sh_pad), (img_width - sh_pad, img_height - sh_pad)],
                radius=corner_radius,
                fill=box_color
            )
            
        elif bg_color:
             # Standard solid background (old behavior mostly)
             img = Image.new('RGBA', (img_width, img_height), bg_color)
             draw = ImageDraw.Draw(img)
        else:
            # Transparent background
            img = Image.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
        
        # Draw text (with outline/stroke for better visibility). Caller may
        # override; otherwise default to 3px stroke on transparent bg, 0 on box.
        if stroke_width is None:
            stroke_width = 0 if use_bg_box else 3

        # Offset the text by (-bbox_min + padding) so the stroke on the left/top
        # side stays inside the canvas.
        draw_x = padding + sh_pad - bbox[0]
        draw_y = padding + sh_pad - bbox[1]

        # Drop shadow: render silhouette onto a separate RGBA layer, blur, and
        # composite UNDER the real text. The pill box (drawn above) is kept as
        # the under-under layer so the shadow falls on top of it.
        if sh_on:
            shadow_layer = Image.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
            shadow_draw = ImageDraw.Draw(shadow_layer)
            shadow_draw.multiline_text(
                (draw_x + sh_ox, draw_y + sh_oy),
                wrapped_text,
                font=font,
                fill=sh_rgba,
                align='center',
                stroke_width=stroke_width,
                stroke_fill=sh_rgba,
            )
            if sh_blur > 0:
                shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=sh_blur))
            img = Image.alpha_composite(img, shadow_layer)
            draw = ImageDraw.Draw(img)  # rebind — `img` was replaced

        draw.multiline_text(
            (draw_x, draw_y),
            wrapped_text,
            font=font,
            fill=color,
            align='center',
            stroke_width=stroke_width,
            stroke_fill=stroke_color
        )
        
        # Save temp file
        import tempfile
        temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        img.save(temp_file.name)
        temp_file.close()
        
        return temp_file.name

    def _render_caption_image_frame(self, frame: dict) -> str:
        """
        Render one caption frame. Routes through the per-word layout so any
        single word that's wider than the caption budget can be shrunk
        independently — avoids the frame-clipping problem when a long word
        (e.g. URLs, run-on names) exceeds max_width_pct.
        """
        words_list = frame.get("words") or []
        active_idx = int(frame.get("active_index", -1))
        if words_list:
            return self._render_highlighted_caption(words_list, active_idx)
        # No word list (e.g. empty chunk / tail text) — use the simple path.
        return self._render_caption_image(frame.get("text") or "")

    def _load_font(self, path, size):
        try:
            return ImageFont.truetype(path or 'arial.ttf', size)
        except OSError:
            try:
                return ImageFont.truetype('arial.ttf', size)
            except OSError:
                return ImageFont.load_default()

    def _render_highlighted_caption(self, words: list, active_idx: int) -> str:
        """
        Manual per-word layout so one word can differ in color and optionally
        size from the rest. Returns a PNG path that sits on a transparent
        background (or a pill if bg_color is configured).
        """
        import tempfile
        p = self.captions
        base_size  = p['font_size']
        hi_scale   = max(0.5, float(p.get('highlight_scale') or 1.0))
        font_normal = self._load_font(p['font_path'], base_size)
        font_hi     = self._load_font(p['font_path'], int(round(base_size * hi_scale)))
        color       = p['color']
        stroke      = p['stroke_color']
        stroke_w    = p['stroke_width'] or 0
        hi_color    = p.get('highlight_color') or color
        hi_stroke   = p.get('highlight_stroke_color') or stroke
        padding     = p['padding']
        max_width   = int(self.width * p['max_width_pct'])
        use_bg      = bool(p['bg_color'])

        if p['uppercase']:
            words = [w.upper() for w in words]

        # Measure space widths for layout gaps; use normal font so spacing is stable.
        space_w = int(font_normal.getlength(' '))
        budget  = max(1, max_width - 2 * padding - 2 * stroke_w)

        # ── Single-line mode ──────────────────────────────────────────
        # When the user has "Fit on one line" on, measure the entire chunk at
        # the base font and, if it overflows the budget, uniformly scale every
        # word's font down by the same ratio so the whole chunk lands on a
        # single row. This beats wrapping for short-form captions where a
        # second row pushes the content off-screen or makes mid-word breaks.
        if p.get('single_line'):
            def _measure(fn: ImageFont.FreeTypeFont, fh: ImageFont.FreeTypeFont) -> int:
                w = 0
                for i, word in enumerate(words):
                    is_active = (i == active_idx)
                    w += int((fh if is_active else fn).getlength(word))
                w += space_w * max(0, len(words) - 1)
                return w

            total = _measure(font_normal, font_hi)
            if total > budget:
                # 0.97 safety factor for glyph-advance rounding.
                ratio = (budget / total) * 0.97
                new_normal_px = max(10, int(round(font_normal.size * ratio)))
                new_hi_px     = max(10, int(round(font_hi.size     * ratio)))
                font_normal   = self._load_font(p['font_path'], new_normal_px)
                font_hi       = self._load_font(p['font_path'], new_hi_px)
                space_w       = int(font_normal.getlength(' '))

            # Build a single line with no wrap logic.
            line: list[dict] = []
            for i, word in enumerate(words):
                is_active = (i == active_idx)
                # `is_colored` decides text/box color. Karaoke-fill cumulatively
                # colours every word at-or-before the active index, mimicking
                # a karaoke prompter sweep. Other modes only colour the active
                # word.
                is_colored = is_active or (
                    p.get('animation') == 'karaoke_fill' and active_idx >= 0 and i <= active_idx
                )
                f = font_hi if is_active else font_normal
                line.append({
                    "word": word, "active": is_active, "colored": is_colored,
                    "font": f, "w": int(f.getlength(word)),
                })
            lines: list[list[dict]] = [line] if line else [[]]
        else:
            # ── Wrap mode (legacy default) ────────────────────────────
            # If a single word is wider than `budget` at its base font, shrink
            # JUST THAT WORD so it fits — other words stay at normal/highlight size.
            lines = [[]]
            cur_w = 0
            for i, word in enumerate(words):
                is_active = (i == active_idx)
                base_font = font_hi if is_active else font_normal
                base_size_for_word = int(base_font.size)
                f = base_font
                ww = int(f.getlength(word))
                # 0.97 safety factor to avoid 1-pixel overflow from glyph-advance rounding.
                if ww > budget:
                    scale = (budget / ww) * 0.97
                    new_size = max(10, int(round(base_size_for_word * scale)))
                    f = self._load_font(p['font_path'], new_size)
                    ww = int(f.getlength(word))
                    if ww > budget:
                        ww = budget
                gap = space_w if lines[-1] else 0
                if lines[-1] and cur_w + gap + ww > budget:
                    lines.append([])
                    cur_w = 0
                    gap = 0
                is_colored = is_active or (
                    p.get('animation') == 'karaoke_fill' and active_idx >= 0 and i <= active_idx
                )
                lines[-1].append({
                    "word": word, "active": is_active, "colored": is_colored,
                    "font": f, "w": ww,
                })
                cur_w += gap + ww

        # Compute line heights from the actual fonts used on that line (each
        # word may have its own size now), so line spacing is correct even when
        # one word got shrunk a lot.
        line_heights = []
        line_widths = []
        for line in lines:
            asc = max(tok["font"].getmetrics()[0] for tok in line) if line else 0
            dsc = max(tok["font"].getmetrics()[1] for tok in line) if line else 0
            line_heights.append(asc + dsc)
            w_total = sum(tok["w"] for tok in line) + space_w * max(0, len(line) - 1)
            line_widths.append(w_total)

        total_w = max(line_widths) if line_widths else 1
        total_h = sum(line_heights) + max(0, len(lines) - 1) * int(base_size * 0.15)

        # ── Drop-shadow geometry ─────────────────────────────────────
        # When shadow is enabled, pad the canvas so the blurred shadow
        # doesn't clip at the edges. We add equal padding on all sides
        # and shift all subsequent drawing by (sh_pad, sh_pad) so the
        # visual centering the caller expects is preserved.
        sh_on = bool(p.get('shadow_enabled'))
        sh_ox = int(p.get('shadow_offset_x', 0)) if sh_on else 0
        sh_oy = int(p.get('shadow_offset_y', 0)) if sh_on else 0
        sh_blur = max(0, int(p.get('shadow_blur', 0))) if sh_on else 0
        sh_rgba = _parse_color_rgba(p.get('shadow_color') or '#000000',
                                    alpha=max(0, min(255, int(p.get('shadow_opacity', 180)))))
        # Extra border so the blur + offset fit; GaussianBlur spreads ~3σ
        # so reserve 3× radius worth of headroom.
        sh_pad = max(abs(sh_ox), abs(sh_oy)) + sh_blur * 3 + 2 if sh_on else 0

        img_w = total_w + padding * 2 + stroke_w * 2 + 2 * sh_pad
        img_h = total_h + padding * 2 + stroke_w * 2 + 2 * sh_pad

        img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Separate RGBA layer to collect the shadow silhouette in the same
        # geometry as the real text, then blur + composite under the text.
        shadow_layer = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0)) if sh_on else None
        shadow_draw = ImageDraw.Draw(shadow_layer) if shadow_layer else None

        if use_bg:
            bg_color = p['bg_color']
            bg_opacity = p['bg_opacity']
            if bg_color.startswith('#'):
                h = bg_color.lstrip('#')
                rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
                box_color = rgb + (bg_opacity,)
            elif bg_color.lower() == 'black':
                box_color = (0, 0, 0, bg_opacity)
            elif bg_color.lower() == 'white':
                box_color = (255, 255, 255, bg_opacity)
            else:
                box_color = (0, 0, 0, bg_opacity)
            # Pill box sits inside the sh_pad border so the shadow can fall
            # outside it when offsets exceed the box edges.
            draw.rounded_rectangle(
                [(sh_pad, sh_pad), (img_w - sh_pad, img_h - sh_pad)],
                radius=p['corner_radius'], fill=box_color,
            )

        # ── Boxed-word style precomputes ─────────────────────────────
        # When animation == 'boxed_word', every word gets a coloured pill
        # behind it. Active word's pill is the highlight colour; others
        # use the configured "inactive" colour at the configured opacity.
        boxed = (p.get('animation') == 'boxed_word')
        bw_radius = int(p.get('boxed_word_radius', 12))
        bw_pad_x  = int(p.get('boxed_word_padding_x', 14))
        bw_pad_y  = int(p.get('boxed_word_padding_y', 6))
        if boxed:
            bw_active_rgba   = _parse_color_rgba(hi_color, alpha=255)
            bw_inactive_rgba = _parse_color_rgba(
                p.get('boxed_word_inactive_color') or '#000000',
                alpha=int(p.get('boxed_word_inactive_opacity', 180)),
            )

        # Draw each line centered horizontally. Baseline-align mixed-size words
        # within a line so a shrunk word sits nicely next to full-size ones.
        cur_y = padding + stroke_w + sh_pad
        for line, lw, lh in zip(lines, line_widths, line_heights):
            if not line:
                cur_y += lh + int(base_size * 0.15)
                continue
            line_ascent = max(tok["font"].getmetrics()[0] for tok in line)
            cur_x = (img_w - lw) // 2
            for tok in line:
                f = tok["font"]
                # Anchor each word to the line's shared baseline.
                tok_ascent = f.getmetrics()[0]
                word_y = cur_y + (line_ascent - tok_ascent)
                # `colored` (karaoke-fill aware) drives text colour;
                # `active` still gates font scaling + stroke colour so the
                # geometry stays correct as the active word advances.
                txt_color  = hi_color  if tok.get("colored") else color
                stroke_col = hi_stroke if tok["active"] else stroke

                # Boxed-word: rounded rect behind the word.
                if boxed:
                    rect_left   = cur_x - bw_pad_x
                    rect_right  = cur_x + tok["w"] + bw_pad_x
                    rect_top    = word_y - bw_pad_y
                    rect_bottom = word_y + tok_ascent + f.getmetrics()[1] + bw_pad_y
                    fill_rgba = bw_active_rgba if tok.get("colored") else bw_inactive_rgba
                    draw.rounded_rectangle(
                        [(rect_left, rect_top), (rect_right, rect_bottom)],
                        radius=bw_radius, fill=fill_rgba,
                    )

                # Mirror onto the shadow layer in pure shadow color, matching
                # position + font + stroke so the silhouette blurs identically.
                if shadow_draw is not None:
                    shadow_draw.text(
                        (cur_x + sh_ox, word_y + sh_oy), tok["word"],
                        font=f, fill=sh_rgba,
                        stroke_width=stroke_w, stroke_fill=sh_rgba,
                    )
                draw.text(
                    (cur_x, word_y), tok["word"],
                    font=f, fill=txt_color,
                    stroke_width=stroke_w, stroke_fill=stroke_col,
                )
                cur_x += tok["w"] + space_w
            cur_y += lh + int(base_size * 0.15)

        # Composite: blur the shadow, paint it BELOW the text but ABOVE the
        # pill box. `img` already contains box+text; we rebuild from bottom up.
        if shadow_layer is not None and (sh_ox or sh_oy or sh_blur):
            if sh_blur > 0:
                shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=sh_blur))
            # Keep the pill box (use_bg) as-is underneath, overlay shadow, then
            # the already-drawn text shows correctly because `img` holds both.
            # To avoid double-text, we extract: box_only = copy of img BEFORE
            # text was drawn. Simplest: re-render into a fresh canvas.
            final = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
            if use_bg:
                fdraw = ImageDraw.Draw(final)
                fdraw.rounded_rectangle(
                    [(sh_pad, sh_pad), (img_w - sh_pad, img_h - sh_pad)],
                    radius=p['corner_radius'], fill=box_color,
                )
            final = Image.alpha_composite(final, shadow_layer)
            # Now stamp boxed-pills + actual text (colors + stroke) on top.
            final_draw = ImageDraw.Draw(final)
            cur_y = padding + stroke_w + sh_pad
            for line, lw, lh in zip(lines, line_widths, line_heights):
                if not line:
                    cur_y += lh + int(base_size * 0.15); continue
                line_ascent = max(tok["font"].getmetrics()[0] for tok in line)
                cur_x = (img_w - lw) // 2
                for tok in line:
                    f = tok["font"]
                    tok_ascent = f.getmetrics()[0]
                    word_y = cur_y + (line_ascent - tok_ascent)
                    txt_color  = hi_color  if tok.get("colored") else color
                    stroke_col = hi_stroke if tok["active"] else stroke
                    if boxed:
                        rect_left   = cur_x - bw_pad_x
                        rect_right  = cur_x + tok["w"] + bw_pad_x
                        rect_top    = word_y - bw_pad_y
                        rect_bottom = word_y + tok_ascent + f.getmetrics()[1] + bw_pad_y
                        fill_rgba = bw_active_rgba if tok.get("colored") else bw_inactive_rgba
                        final_draw.rounded_rectangle(
                            [(rect_left, rect_top), (rect_right, rect_bottom)],
                            radius=bw_radius, fill=fill_rgba,
                        )
                    final_draw.text(
                        (cur_x, word_y), tok["word"],
                        font=f, fill=txt_color,
                        stroke_width=stroke_w, stroke_fill=stroke_col,
                    )
                    cur_x += tok["w"] + space_w
                cur_y += lh + int(base_size * 0.15)
            img = final

        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        img.save(tmp.name)
        tmp.close()
        return tmp.name

    def _render_caption_image(self, text: str) -> str:
        """Render a single caption PNG using the normalized caption config."""
        p = self.captions
        use_bg = bool(p['bg_color'])
        shadow = {
            'enabled':  p.get('shadow_enabled', False),
            'color':    p.get('shadow_color'),
            'opacity':  p.get('shadow_opacity', 180),
            'offset_x': p.get('shadow_offset_x', 0),
            'offset_y': p.get('shadow_offset_y', 0),
            'blur':     p.get('shadow_blur', 0),
        } if p.get('shadow_enabled') else None
        return self.create_text_image(
            text,
            fontsize=p['font_size'],
            color=p['color'],
            max_width=int(self.width * p['max_width_pct']),
            use_bg_box=use_bg,
            bg_color=p['bg_color'] if use_bg else None,
            bg_opacity=p['bg_opacity'],
            padding=p['padding'],
            font_path=p['font_path'],
            stroke_color=p['stroke_color'],
            stroke_width=p['stroke_width'],
            corner_radius=p['corner_radius'],
            uppercase=p['uppercase'],
            single_line=p.get('single_line', False),
            shadow=shadow,
        )

    def get_random_background(self, duration: float) -> VideoFileClip:
        """
        Get a background clip of appropriate duration and aspect ratio.
        Honors self.background_selector (folder or specific file); falls
        back to random from all backgrounds; finally to a solid color.
        """
        bg_path = self._pick_background()
        if not bg_path:
            print("⚠️  No background videos found in 'backgrounds/'. Using solid color.")
            return ColorClip(size=(self.width, self.height), color=(20, 20, 30), duration=duration)
        
        try:
            clip = VideoFileClip(bg_path)
            
            # Loop if shorter than duration
            if clip.duration < duration:
                clip = clip.loop(duration=duration)
            
            # Pick random start time if long enough
            if clip.duration > duration:
                max_start = clip.duration - duration
                start_time = random.uniform(0, max_start)
                clip = clip.subclip(start_time, start_time + duration)
            
            # Resize logic (Crop to fill)
            # Calculate target aspect ratio
            target_aspect = self.width / self.height
            clip_aspect = clip.w / clip.h
            
            if clip_aspect > target_aspect:
                # Clip is wider than target -> Resize by height, crop width
                new_height = self.height
                new_width = int(clip.w * (self.height / clip.h))
                clip = clip.resize(height=new_height)
                # Center crop width
                x_center = new_width / 2
                clip = clip.crop(x1=x_center - self.width/2, width=self.width, height=self.height)
            else:
                # Clip is taller than target -> Resize by width, crop height
                new_width = self.width
                new_height = int(clip.h * (self.width / clip.w))
                clip = clip.resize(width=new_width)
                # Center crop height
                y_center = new_height / 2
                clip = clip.crop(y1=y_center - self.height/2, width=self.width, height=self.height)
                
            return clip
            
        except Exception as e:
            print(f"❌ Error loading background {bg_path}: {e}")
            return ColorClip(size=(self.width, self.height), color=(20, 20, 30), duration=duration)

    def generate_video(self, audio_segments: List[dict], output_path: str, tail_text: Optional[str] = None, tail_duration: float = 0.0, branding: str = "", post_title: str = "", post_subreddit: str = "", post_score: int = 0):
        """
        Generate final video from audio segments.
        audio_segments: List of dicts {'text': str, 'audio_path': str, 'author': str (opt)}
        """
        print(f"\n🎬 Generatiing video ({self.mode.upper()} mode)...")
        
        # 1. Prepare Audio
        audio_clips = []
        temp_images = [] # Keep track to delete later
        
        for segment in audio_segments:
            if os.path.exists(segment['audio_path']):
                ac = AudioFileClip(segment['audio_path'])
                audio_clips.append(ac)
            else:
                print(f"⚠️  Missing audio file: {segment['audio_path']}")
        
        if not audio_clips:
            print("❌ No valid audio clips found")
            return None
            
        final_audio = concatenate_audioclips(audio_clips)
        total_duration = final_audio.duration + (tail_duration if (tail_text and tail_duration and tail_duration > 0) else 0)
        
        # 2. Prepare Background
        background_clip = self.get_random_background(total_duration)
        
        # Pre-render title card if any title segments exist.
        self._title_card_path = None
        if any(s.get('segment_role') == 'title' for s in audio_segments) and post_title:
            card = self._ensure_title_card(post_title, post_subreddit, post_score, branding)
            if card:
                temp_images.append(card)

        # 3. Create Subtitles & Attribution
        subtitle_clips = []
        attribution_clips = []
        title_card_clips = []
        current_time = 0
        current_author = None

        total_segments = len(audio_segments)
        print(f"   Composing {total_segments} segments...")

        for i, segment in enumerate(audio_segments):
            # Print progress every 10 segments or for first/last
            if i % 10 == 0 or i == total_segments - 1:
                print(f"     Processing segment {i+1}/{total_segments}...")
            segment_duration = audio_clips[i].duration
            author = segment.get('author', 'Anonymous')

            # Title-role segments: show the title card full-frame, no captions.
            if segment.get('segment_role') == 'title' and self._title_card_path:
                tc = (ImageClip(self._title_card_path)
                      .set_start(current_time)
                      .set_duration(segment_duration)
                      .set_position((0, 0)))
                title_card_clips.append(tc)
                current_time += segment_duration
                continue

            if not self.captions['enabled']:
                current_time += segment_duration
                continue

            # Split segment text into word-chunks. If whisper alignment is
            # present on the segment, chunk timings match real spoken words.
            chunks = self._chunk_segment(
                segment, segment_duration, self.captions['words_per_caption']
            )
            chunk_start = current_time
            first_chunk_xy = None
            for frame in chunks:
                chunk_text = frame["text"]
                chunk_dur = frame["duration"]
                if not chunk_text:
                    chunk_start += chunk_dur
                    continue
                text_img_path = self._render_caption_image_frame(frame)
                temp_images.append(text_img_path)
                txt_clip_tmp = ImageClip(text_img_path)
                cw, ch = txt_clip_tmp.size
                cx, cy = self._caption_xy(cw, ch)
                if first_chunk_xy is None:
                    first_chunk_xy = (cx, cy)
                txt_clip = (txt_clip_tmp
                           .set_duration(chunk_dur)
                           .set_position((cx, cy)))
                txt_clip = self._animate_clip(txt_clip, chunk_dur).set_start(chunk_start)
                subtitle_clips.append(txt_clip)
                chunk_start += chunk_dur

            subtitle_x, subtitle_y = first_chunk_xy if first_chunk_xy else (0, 0)

            # Attribution — show branding handle instead of OP for privacy.
            # Rendered once per segment, anchored above the first chunk.
            attr_text = f"u/{branding.strip()}" if (self.captions['attribution'] and branding and branding.strip()) else None
            if attr_text:
                attr_img_path = self.create_text_image(
                    attr_text,
                    fontsize=40 if self.mode == 'reel' else 30,
                    color='#FF4500',
                    max_width=int(self.width * 0.5),
                    use_bg_box=True,
                    bg_color='black',
                    bg_opacity=160,
                    padding=15
                )
                temp_images.append(attr_img_path)
                
                attr_clip_obj = ImageClip(attr_img_path)
                attr_w, attr_h = attr_clip_obj.size
                attr_pos = (subtitle_x, subtitle_y - attr_h - 10)
                attr_clip = (attr_clip_obj
                            .set_start(current_time)
                            .set_duration(segment_duration)
                            .set_position(attr_pos))
                attribution_clips.append(attr_clip)
            
            current_time += segment_duration

        if self.captions['enabled'] and tail_text and tail_duration and tail_duration > 0:
            tail_img_path = self._render_caption_image(tail_text)
            temp_images.append(tail_img_path)
            tail_clip_tmp = ImageClip(tail_img_path)
            tw, th = tail_clip_tmp.size
            tx, ty = self._caption_xy(tw, th)
            tail_clip = (tail_clip_tmp
                        .set_duration(tail_duration)
                        .set_position((tx, ty)))
            tail_clip = self._animate_clip(tail_clip, tail_duration).set_start(current_time)
            subtitle_clips.append(tail_clip)
        
        # 4. Branding watermark (persistent overlay)
        branding_clips = []
        if branding and branding.strip():
            brand_img_path = self.create_text_image(
                branding.strip(),
                fontsize=30,
                color='white',
                max_width=int(self.width * 0.4),
                use_bg_box=True,
                bg_color='black',
                bg_opacity=120,
                padding=12
            )
            temp_images.append(brand_img_path)
            brand_clip = (ImageClip(brand_img_path)
                         .set_duration(total_duration)
                         .set_position(('right', 'bottom'))
                         .margin(right=20, bottom=20, opacity=0))
            branding_clips.append(brand_clip)

        # 5. Composite
        # Title cards sit over the background but under captions; captions and
        # branding shouldn't render during title segments since title_card_clips
        # cover that time range fullscreen.
        final_video = CompositeVideoClip([background_clip] + title_card_clips + subtitle_clips + attribution_clips + branding_clips)
        final_video = final_video.set_audio(final_audio)
        
        # 5. Write file
        print(f"   Writing video to: {output_path}")
        try:
            # Use unique temp audio filename in the output directory
            output_dir = os.path.dirname(output_path)
            temp_audio = os.path.join(output_dir, f"temp_audio_{random.randint(1000, 9999)}.m4a")
            
            print(f"   Writing video to: {output_path}")
            
            # Codec settings based on hw_accel
            if self.hw_accel == 'nvenc':
                print("   🚀 Using NVIDIA GPU acceleration (h264_nvenc)...")
                codec = 'h264_nvenc'
                ffmpeg_params = ['-rc', 'vbr', '-cq', '19', '-b:v', '8M', '-maxrate', '10M']
                preset = 'p4'
                bitrate = None
            elif self.hw_accel == 'amf':
                print("   🚀 Using AMD GPU acceleration (h264_amf)...")
                codec = 'h264_amf'
                ffmpeg_params = ['-rc', 'vbr_latency', '-qp_i', '19', '-qp_p', '19', '-b:v', '8M', '-maxrate', '10M']
                preset = 'speed'
                bitrate = None
            else:
                print("   Using CPU encoding (libx264)...")
                codec = 'libx264'
                ffmpeg_params = ['-crf', '18']
                preset = 'medium'
                bitrate = None
            
            final_video.write_videofile(
                output_path, 
                fps=30, # Smoother 30fps
                codec=codec, 
                audio_codec='aac',
                bitrate=bitrate,
                ffmpeg_params=ffmpeg_params,
                preset=preset,
                threads=self.threads,       # Use configured threads
                logger='bar',    # Show progress bar
                temp_audiofile=temp_audio,
                remove_temp=True
            )
            print("✓ Video generation complete!")
            
            # clean up temp images
            print("   Cleaning up temporary files...")
            for p in temp_images:
                try:
                    os.remove(p)
                except:
                    pass
            
            # Explicitly close clips to release file handles
            final_video.close()
            final_audio.close()
            background_clip.close()
            for ac in audio_clips:
                ac.close()
                    
            return output_path
            
        except Exception as e:
            print(f"❌ Error writing video: {e}")
            return None

    def create_full_frame_overlays(self, segment: dict, duration: float, branding: str = ""):
        """
        Create one or more full-frame transparent PNGs for a segment.
        Returns a list of (png_path, duration) tuples so the FFmpeg concat stream
        can render multiple caption chunks within a single audio segment.
        Attribution and watermark are painted only on the first chunk's canvas.
        """
        import tempfile

        # Pause segments (silence filler from StreamlabsTTS / ElevenLabsTTS
        # when the AI content generator yields a [PAUSE:N] marker). Emit a
        # single fully-transparent frame so the audio silence has matching
        # video time — never render captions like "[3s pause]" on screen.
        if segment.get('is_pause'):
            import tempfile
            blank = Image.new('RGBA', (self.width, self.height), (0, 0, 0, 0))
            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            blank.save(tmp.name)
            tmp.close()
            return [(tmp.name, duration)]

        # Diagnostic: title-role without a prepared card means the pipeline
        # didn't populate post_title or the thumbnail render failed.
        if segment.get('segment_role') == 'title' and not getattr(self, '_title_card_path', None):
            print("   ⚠️  title-role segment but no title card prepared — falling back to captions")

        # Title-role segments: overlay the Reddit-style card widget on top of
        # the running background video (card has transparent surrounds). No
        # captions during the title.
        if segment.get('segment_role') == 'title' and getattr(self, '_title_card_path', None):
            card_img = Image.open(self._title_card_path).convert("RGBA")
            if card_img.size != (self.width, self.height):
                card_img = card_img.resize((self.width, self.height), Image.LANCZOS)
            canvas = Image.new('RGBA', (self.width, self.height), (0, 0, 0, 0))
            canvas.alpha_composite(card_img, (0, 0))
            # Also paint the watermark so branding is visible during the title.
            if branding and branding.strip():
                brand_path = self.create_text_image(
                    branding.strip(),
                    fontsize=30, color='white',
                    max_width=int(self.width * 0.4),
                    use_bg_box=True, bg_color='black',
                    bg_opacity=120, padding=12,
                )
                brand_img = Image.open(brand_path).convert("RGBA")
                bw, bh = brand_img.size
                canvas.alpha_composite(brand_img, (self.width - bw - 20, self.height - bh - 20))
                try: os.remove(brand_path)
                except: pass
            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            canvas.save(tmp.name)
            tmp.close()
            return [(tmp.name, duration)]

        captions_on = self.captions['enabled']
        if captions_on:
            chunks = self._chunk_segment(
                segment, duration, self.captions['words_per_caption']
            )
        else:
            # One empty "chunk" so the segment still holds its time slot.
            chunks = [('', duration)]
        include_attr = bool(captions_on and self.captions['attribution'] and branding and branding.strip())
        include_brand = bool(branding and branding.strip())

        out = []
        for idx, frame in enumerate(chunks):
            chunk_text = frame.get("text", "")
            chunk_dur  = frame.get("duration", 0.0)
            canvas = Image.new('RGBA', (self.width, self.height), (0, 0, 0, 0))

            if chunk_text:
                sub_path = self._render_caption_image_frame(frame)
                sub_img = Image.open(sub_path).convert("RGBA")
                sw, sh = sub_img.size
                sx, sy = self._caption_xy(sw, sh)
                canvas.alpha_composite(sub_img, (sx, sy))
                try: os.remove(sub_path)
                except: pass
            else:
                sx = sy = 0

            # Attribution: only on the first chunk so it doesn't flicker per chunk.
            if idx == 0 and include_attr:
                attr_path = self.create_text_image(
                    f"u/{branding.strip()}",
                    fontsize=40 if self.mode == 'reel' else 30,
                    color='#FF4500',
                    max_width=int(self.width * 0.5),
                    use_bg_box=True,
                    bg_color='black',
                    bg_opacity=160,
                    padding=15,
                )
                attr_img = Image.open(attr_path).convert("RGBA")
                aw, ah = attr_img.size
                canvas.alpha_composite(attr_img, (sx, max(0, sy - ah - 10)))
                try: os.remove(attr_path)
                except: pass

            # Branding watermark (every chunk, since it's persistent).
            # Position + opacity + font_size are read from config.video.
            # watermark when present, falling back to the historical
            # bottom-right defaults so existing setups don't visually
            # change. Schema:
            #   x_pct / y_pct: 0-100, anchor of the LEFT-TOP corner of
            #                  the watermark box (so 0/0 puts it at
            #                  top-left, 100/100 nudges it past the
            #                  bottom-right corner; we clamp).
            #   opacity:       0-100 — applied to the entire composite.
            #   font_size:     px (default 30).
            #   bg_box:        bool, draw a translucent black pill
            #                  behind the text for legibility (default
            #                  true).
            if include_brand:
                wm = (
                    (getattr(self, "watermark_config", None) or {})
                    if hasattr(self, "watermark_config") else {}
                )
                fs = int(wm.get("font_size") or 30)
                op = max(0, min(100, int(wm.get("opacity") if wm.get("opacity") is not None else 100)))
                use_bg = bool(wm.get("bg_box") if wm.get("bg_box") is not None else True)
                brand_path = self.create_text_image(
                    branding.strip(),
                    fontsize=fs,
                    color='white',
                    max_width=int(self.width * 0.4),
                    use_bg_box=use_bg,
                    bg_color='black',
                    bg_opacity=120,
                    padding=12,
                )
                brand_img = Image.open(brand_path).convert("RGBA")
                bw, bh = brand_img.size
                # Compute paste position. Default = bottom-right with
                # 20 px margin (legacy behavior). x_pct / y_pct override.
                if "x_pct" in wm or "y_pct" in wm:
                    x_pct = float(wm.get("x_pct") if wm.get("x_pct") is not None else 100)
                    y_pct = float(wm.get("y_pct") if wm.get("y_pct") is not None else 100)
                    # Paste position is the LEFT-TOP corner of the watermark
                    # box. Convert percentages, clamp so the box stays
                    # fully on-canvas at the extremes.
                    x = max(0, min(self.width - bw, int(x_pct * (self.width - bw) / 100)))
                    y = max(0, min(self.height - bh, int(y_pct * (self.height - bh) / 100)))
                else:
                    x = self.width - bw - 20
                    y = self.height - bh - 20
                if op < 100:
                    # Apply uniform opacity across the watermark RGBA image.
                    a = brand_img.split()[3].point(lambda v: int(v * op / 100))
                    brand_img.putalpha(a)
                canvas.alpha_composite(brand_img, (x, y))
                try: os.remove(brand_path)
                except: pass

            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            canvas.save(tmp.name)
            tmp.close()
            out.append((tmp.name, chunk_dur))
        return out

    def generate_thumbnail(self, title: str, subreddit: str, part_number: int = 1,
                           total_parts: int = 1, output_path: str = "thumbnail.png",
                           score: int = 0, branding: str = "", title_override: str = None,
                           transparent_bg: bool = False) -> Optional[str]:
        """
        Generate a Reddit-style thumbnail for a video part.
        Card size adapts to content. Includes optional branding watermark.

        transparent_bg=True produces the same card widget on a fully transparent
        canvas (no blurred video frame behind it), so it can be overlaid on top
        of a running background video as a title-card animation.
        """
        print(f"   🖼️  Generating thumbnail for Part {part_number}{' (transparent)' if transparent_bg else ''}...")
        try:
            w, h = self.width, self.height

            bg_img = None
            if not transparent_bg:
                # 1. Background — grab a frame from a random background video or use solid
                bg_path = self._pick_background()
                if bg_path:
                    try:
                        clip = VideoFileClip(bg_path)
                        t = random.uniform(0, max(clip.duration - 1, 0))
                        frame = clip.get_frame(t)
                        clip.close()
                        bg_img = Image.fromarray(frame).resize((w, h), Image.LANCZOS)
                        from PIL import ImageFilter
                        bg_img = bg_img.filter(ImageFilter.GaussianBlur(radius=12))
                        overlay = Image.new('RGBA', (w, h), (0, 0, 0, 80))
                        bg_img = bg_img.convert('RGBA')
                        bg_img = Image.alpha_composite(bg_img, overlay)
                    except Exception as e:
                        print(f"   ⚠️  Could not extract background frame: {e}")
                if bg_img is None:
                    bg_img = Image.new('RGBA', (w, h), (20, 20, 30, 255))
            else:
                # Transparent canvas — only the card itself will be drawn.
                bg_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))

            draw = ImageDraw.Draw(bg_img)

            # 2. Load fonts — sized per thumbnail config.
            tn = getattr(self, 'thumbnail', None) or {}
            title_px = int(tn.get('title_font_size', 52))
            uname_px = int(tn.get('username_font_size', 36))
            meta_px  = max(20, int(uname_px * 0.83))
            brand_px = max(18, int(uname_px * 0.72))
            try:
                font_title = ImageFont.truetype("arialbd.ttf", title_px)
                font_sub = ImageFont.truetype("arial.ttf", uname_px)
                font_meta = ImageFont.truetype("arial.ttf", meta_px)
                font_brand = ImageFont.truetype("arial.ttf", brand_px)
            except OSError:
                try:
                    font_title = ImageFont.truetype("arial.ttf", title_px)
                except OSError:
                    font_title = ImageFont.load_default()
                font_sub = font_title
                font_meta = font_title
                font_brand = font_title

            # 3. Measure content to determine dynamic card height.
            # `card_max_width_pct` ∈ (0..1]: card width relative to frame.
            cmax_pct = float(tn.get('card_max_width_pct', 0.84))
            card_w = int(w * cmax_pct)
            card_margin_x = (w - card_w) // 2
            inner_pad = max(16, int(uname_px * 0.85))
            title_max_w = card_w - inner_pad * 2

            # Subreddit / handle header — icon radius scales with handle font size.
            icon_r = max(18, int(uname_px * 0.67))
            header_h = icon_r * 2 + 10  # icon + gap

            # Title text measurement
            avg_char_w = 26
            chars_per_line = max(int(title_max_w / avg_char_w), 10)
            display_title = title_override if title_override else title
            if total_parts > 1 and not title_override:
                display_title = f"{title} (Part {part_number})"
            elif total_parts > 1 and title_override:
                display_title = f"{title_override} (Part {part_number})"
            lines = textwrap.wrap(display_title, width=chars_per_line)
            max_lines = 6
            if len(lines) > max_lines:
                lines = lines[:max_lines]
                lines[-1] = lines[-1][:len(lines[-1])-3] + "..."
            wrapped = "\n".join(lines)
            title_bbox = draw.multiline_textbbox((0, 0), wrapped, font=font_title, spacing=8)
            title_text_h = title_bbox[3] - title_bbox[1]

            # Bottom bar height — zero when stats are hidden so the card
            # hugs the title text instead of leaving an awkward gap.
            _stats_hidden = (getattr(self, 'thumbnail', None) or {}).get('hide_stats', True)
            bottom_bar_h = 0 if _stats_hidden else 40

            # Natural card height follows content exactly — no hard-coded
            # floor, because for short titles like 'I think my husband might
            # be having an affair…' the old 18%-of-frame minimum inflated
            # the card with 75+ pixels of dead white space below the text.
            # Tight gap below the title when stats are hidden.
            tail_gap = 10 if _stats_hidden else 25
            card_h = inner_pad + header_h + 20 + title_text_h + tail_gap + bottom_bar_h + inner_pad
            # Only cap at MAX — very long titles shouldn't eat half the frame.
            card_h = min(card_h, int(h * 0.55))

            card_y = (h - card_h) // 2
            card_x = card_margin_x

            # 4. Draw rounded card using configured colors + corner radius.
            def _hex_to_rgba(hexstr: str, alpha: int = 240) -> tuple:
                s = (hexstr or "").lstrip("#")
                if len(s) == 3:
                    s = "".join(ch * 2 for ch in s)
                try:
                    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), alpha)
                except Exception:
                    return (255, 255, 255, alpha)

            card_fill   = _hex_to_rgba(tn.get('card_bg_color', '#FFFFFF'), 240)
            title_fill  = _hex_to_rgba(tn.get('text_color',     '#141414'), 255)[:3]
            uname_fill  = _hex_to_rgba(tn.get('username_color', '#1E1E1E'), 255)[:3]
            accent_fill = _hex_to_rgba(tn.get('accent_color',   '#FF4500'), 255)[:3]
            corner_rad  = int(tn.get('corner_radius', 30))

            card_rect = [(card_x, card_y), (card_x + card_w, card_y + card_h)]
            draw.rounded_rectangle(card_rect, radius=corner_rad, fill=card_fill)

            # 5. Profile icon (circular) + display handle.
            #    If a user profile pic is configured, paste it as the icon —
            #    otherwise draw the stock Reddit alien. The handle follows
            #    thumbnail.username > video.branding > r/<subreddit>.
            icon_y = card_y + inner_pad
            icon_x = card_x + inner_pad
            tn = getattr(self, 'thumbnail', None) or {}
            pic_path = tn.get('profile_pic_path') or ''
            drew_custom_icon = False
            if pic_path and os.path.isfile(pic_path):
                try:
                    from PIL import Image as _PILImage
                    avatar = _PILImage.open(pic_path).convert("RGBA")
                    # Resize to the icon diameter and round-mask into a circle.
                    d = icon_r * 2
                    avatar = avatar.resize((d, d), _PILImage.LANCZOS)
                    mask = Image.new("L", (d, d), 0)
                    _mdraw = ImageDraw.Draw(mask)
                    _mdraw.ellipse((0, 0, d, d), fill=255)
                    # Alpha-composite the circular avatar onto bg_img so it
                    # respects the transparent title-card canvas.
                    bg_img.paste(avatar, (icon_x, icon_y), mask)
                    drew_custom_icon = True
                except Exception as _e:
                    print(f"   ⚠️  Profile pic failed to load ({pic_path}): {_e}")

            if not drew_custom_icon:
                # Stock Reddit alien icon fallback.
                draw.ellipse(
                    [(icon_x, icon_y), (icon_x + icon_r * 2, icon_y + icon_r * 2)],
                    fill=accent_fill
                )
                cx, cy = icon_x + icon_r, icon_y + icon_r
                draw.ellipse([(cx - 8, cy - 6), (cx - 2, cy)], fill='white')
                draw.ellipse([(cx + 2, cy - 6), (cx + 8, cy)], fill='white')
                draw.arc([(cx - 8, cy - 2), (cx + 8, cy + 8)], 0, 180, fill='white', width=2)

            # Handle shown next to the avatar. Prefers the explicit thumbnail
            # username (with auto-prepended '@'), falls back to video.branding
            # as 'u/<handle>', finally 'r/<subreddit>'.
            uname = tn.get('username') or ''
            if uname:
                if not uname.startswith(('@', 'u/', 'r/')):
                    uname = '@' + uname
                sub_text = uname
            elif branding and branding.strip():
                sub_text = f"u/{branding.strip()}"
            else:
                sub_text = f"r/{subreddit}"
            draw.text((icon_x + icon_r * 2 + 12, icon_y + 8), sub_text, fill=uname_fill, font=font_sub)

            # 6. Part badge (top right of card)
            if total_parts > 1:
                badge_text = f"Part {part_number}/{total_parts}"
                badge_bbox = draw.textbbox((0, 0), badge_text, font=font_sub)
                badge_w = badge_bbox[2] - badge_bbox[0] + 30
                badge_h = badge_bbox[3] - badge_bbox[1] + 16
                badge_x = card_x + card_w - badge_w - 20
                badge_y_pos = card_y + inner_pad
                draw.rounded_rectangle(
                    [(badge_x, badge_y_pos), (badge_x + badge_w, badge_y_pos + badge_h)],
                    radius=badge_h // 2, fill=accent_fill
                )
                draw.text((badge_x + 15, badge_y_pos + 5), badge_text, fill='white', font=font_sub)

            # 7. Title text (centered in remaining space)
            title_y = icon_y + icon_r * 2 + 20
            draw.multiline_text(
                (card_x + inner_pad, title_y), wrapped,
                fill=title_fill, font=font_title, spacing=8
            )

            # 8. Bottom bar — hearts + share count. Off by default now:
            #    the fake heart/share glyphs didn't always render in the
            #    title font and users found them more distracting than
            #    authentic-looking. Flip `thumbnail.hide_stats=false` in
            #    config to restore them.
            if not (getattr(self, 'thumbnail', None) or {}).get('hide_stats', True):
                bottom_y = card_y + card_h - inner_pad - 25
                heart = "♡"
                score_text = f"{score:,}+" if score else "999+"
                share_text = f"⤴ {score_text}"
                draw.text((card_x + inner_pad, bottom_y), f"{heart} {score_text}", fill=(120, 120, 120), font=font_meta)
                draw.text((card_x + card_w - 180, bottom_y), share_text, fill=(120, 120, 120), font=font_meta)

            # 9. Branding watermark (bottom-right corner of image) — skipped when
            # producing a transparent overlay, since the render pipeline paints
            # its own watermark per-frame.
            if not transparent_bg and branding and branding.strip():
                brand_text = branding.strip()
                brand_bbox = draw.textbbox((0, 0), brand_text, font=font_brand)
                brand_tw = brand_bbox[2] - brand_bbox[0]
                brand_th = brand_bbox[3] - brand_bbox[1]
                brand_pad = 12
                brand_x = w - brand_tw - brand_pad - 20
                brand_y = h - brand_th - brand_pad - 20
                # Semi-transparent background pill
                draw.rounded_rectangle(
                    [(brand_x - brand_pad, brand_y - brand_pad),
                     (brand_x + brand_tw + brand_pad, brand_y + brand_th + brand_pad)],
                    radius=16, fill=(0, 0, 0, 160)
                )
                draw.text((brand_x, brand_y), brand_text, fill=(255, 255, 255, 220), font=font_brand)

            # Save
            bg_img.save(output_path, quality=95)
            print(f"   ✓ Thumbnail saved: {output_path}")
            return output_path

        except Exception as e:
            print(f"   ❌ Thumbnail generation failed: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _ensure_title_card(self, post_title: str, post_subreddit: str, post_score: int, branding: str) -> Optional[str]:
        """
        Render a full-frame title card using generate_thumbnail and cache it on
        the instance. Returns the path to a PNG sized self.width × self.height.
        """
        if getattr(self, "_title_card_path", None):
            return self._title_card_path
        if not post_title:
            return None
        import tempfile
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.close()
        try:
            result = self.generate_thumbnail(
                title=post_title,
                subreddit=post_subreddit or "",
                part_number=1, total_parts=1,
                output_path=tmp.name,
                score=post_score or 0,
                branding=branding or "",
                transparent_bg=True,   # card only; real background video shows through
            )
            if result and os.path.exists(result):
                self._title_card_path = result
                return result
        except Exception as e:
            print(f"⚠️  Title card render failed: {e}")
        return None

    def overlay_broll(self, video_path: str, broll_moments: list[dict]) -> bool:
        """
        Post-process a finished render by overlaying b-roll clips at the
        timestamps the LLM picked. Each moment must already have a
        `local_path` pointing at a downloaded mp4. The function uses
        `-itsoffset` so the overlay starts from each b-roll's frame 0
        at the requested timestamp, plus `enable='between(t,A,B)'` to
        gate the overlay window.

        Returns True on success (output replaced), False otherwise.
        Best-effort: caller should handle False gracefully.
        """
        if not broll_moments:
            return False
        valid = [m for m in broll_moments if m.get("local_path") and os.path.isfile(m["local_path"])]
        if not valid:
            return False

        ffmpeg_exe = self._ffmpeg_path()
        out_dir = os.path.dirname(video_path)
        tmp_out = os.path.join(out_dir, "broll_overlay.mp4")

        cmd = [ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error", "-i", video_path]
        # Add each b-roll input with -itsoffset so its frame 0 aligns
        # with the moment's start_s. Stream index = i+1 (base is 0).
        for m in valid:
            cmd.extend(["-itsoffset", f"{float(m['start_s']):.3f}", "-i", m["local_path"]])

        # Build filter_complex chain. Each b-roll is scaled to canvas,
        # then overlaid with an enable gate. Daisy-chain through labels.
        parts = []
        for i, m in enumerate(valid, 1):
            parts.append(
                f"[{i}:v]scale={self.width}:{self.height}:"
                f"force_original_aspect_ratio=increase,"
                f"crop={self.width}:{self.height},setsar=1[b{i}]"
            )
        prev = "0:v"
        for i, m in enumerate(valid, 1):
            label_out = f"v{i}"
            a = float(m["start_s"]); b = float(m["end_s"])
            parts.append(
                f"[{prev}][b{i}]overlay=enable='between(t,{a:.3f},{b:.3f})'"
                f":eof_action=pass[{label_out}]"
            )
            prev = label_out
        filter_complex = ";".join(parts)

        cmd.extend([
            "-filter_complex", filter_complex,
            "-map", f"[{prev}]",
            "-map", "0:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "copy",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            tmp_out,
        ])

        try:
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"   ⚠️  b-roll overlay FFmpeg failed: {r.stderr[-400:]}")
                try: os.remove(tmp_out)
                except OSError: pass
                return False
            # Replace the original render.
            os.replace(tmp_out, video_path)
            print(f"   ✓ overlaid {len(valid)} b-roll moment(s)")
            return True
        except Exception as e:
            print(f"   ⚠️  b-roll overlay raised: {e}")
            try: os.remove(tmp_out)
            except OSError: pass
            return False

    def _ffmpeg_path(self) -> str:
        """Local helper so overlay_broll has the same FFmpeg resolution as the main path."""
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            return "ffmpeg"

    def generate_video_ffmpeg(self, audio_segments: List[dict], output_path: str, tail_text: Optional[str] = None, tail_duration: float = 0.0, branding: str = "", post_title: str = "", post_subreddit: str = "", post_score: int = 0):
        """
        Generate video using direct FFmpeg commands (Beta Engine).
        Significantly faster compositing but requires FFmpeg installed.
        """
        print(f"\n🎬 Generating video (FFMPEG Beta Engine)...")
        import subprocess

        temp_files = [] # Track for cleanup

        # `karaoke_fill` and `boxed_word` are render-time stylings done in
        # PIL — they work in the FFmpeg engine. The legacy chunk-entry
        # animations (fade / pop / fade_pop) still need the MoviePy engine.
        _anim = self.captions.get('animation') or 'none'
        if _anim not in ('none', 'karaoke_fill', 'boxed_word'):
            print(f"⚠️  Caption animation '{_anim}' is ignored by the FFmpeg engine. "
                  f"Set video.engine = 'moviepy' in config.json to enable animations.")

        # Pre-render the title card if any segment is tagged as 'title'.
        self._title_card_path = None
        if any(s.get('segment_role') == 'title' for s in audio_segments) and post_title:
            card = self._ensure_title_card(post_title, post_subreddit, post_score, branding)
            if card:
                temp_files.append(card)
                print(f"   Title card ready: {card}")
            else:
                print("   ⚠️  Title card could not be rendered; title segments will show captions.")

        # Resolve FFmpeg executable
        try:
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            ffmpeg_exe = 'ffmpeg' # Fallback to system path
        
        try:
            # 1. Prepare Audio — use FFmpeg's concat FILTER for a proper
            # sample-level join. The moviepy path was stitching decoded mp3
            # frames back-to-back which produced tiny click/pop artifacts
            # at each segment boundary due to encoder padding. The concat
            # filter decodes each clip, appends raw PCM, and re-encodes once.
            output_dir = os.path.dirname(output_path)
            os.makedirs(output_dir, exist_ok=True)
            temp_audio_path = os.path.join(output_dir, "ffmpeg_audio_temp.m4a")

            audio_paths = [s['audio_path'] for s in audio_segments
                           if s.get('audio_path') and os.path.exists(s['audio_path'])]
            if not audio_paths:
                raise RuntimeError("No audio files to concatenate")

            concat_cmd = [ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error"]
            for p in audio_paths:
                concat_cmd.extend(["-i", p])
            # Build the filter: [0:a][1:a]...[N:a] concat=n=N:v=0:a=1[out]
            # Add a tiny acrossfade bias by including a 10ms silence pad is
            # unnecessary — concat filter output is sample-clean.
            inputs = "".join(f"[{i}:a]" for i in range(len(audio_paths)))
            filter_complex = f"{inputs}concat=n={len(audio_paths)}:v=0:a=1[out]"
            concat_cmd.extend([
                "-filter_complex", filter_complex,
                "-map", "[out]",
                "-c:a", "aac", "-b:a", "192k",
                temp_audio_path,
            ])
            subprocess.run(concat_cmd, check=True)

            # Optional: mix in background music.
            # `self.background_music_path` and `self.background_music_db` are
            # set by the API layer before the render fires (via config). If
            # the path resolves to a real file and music is enabled, run a
            # second FFmpeg pass to mix the music underneath the voice at
            # the requested attenuation. The voice track stays at unity
            # gain — only the music is reduced — so narration intelligibility
            # is preserved across all volume settings.
            music_path = getattr(self, "background_music_path", None)
            music_db = float(getattr(self, "background_music_db", -18) or -18)
            if music_path and os.path.isfile(music_path):
                try:
                    mixed_path = os.path.join(output_dir, "ffmpeg_audio_mixed.m4a")
                    # 10**(db/20) gives a linear gain from a dB attenuation.
                    music_gain = 10 ** (music_db / 20.0)
                    # Loop the music in case it's shorter than the narration.
                    # `aloop` requires `size=` in samples; setting a huge
                    # ceiling (~2e9) effectively means "loop forever".
                    mix_filter = (
                        f"[1:a]aloop=loop=-1:size=2147483647,"
                        f"volume={music_gain:.4f}[bg];"
                        f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[out]"
                    )
                    mix_cmd = [
                        ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error",
                        "-i", temp_audio_path,
                        "-i", music_path,
                        "-filter_complex", mix_filter,
                        "-map", "[out]",
                        "-c:a", "aac", "-b:a", "192k",
                        mixed_path,
                    ]
                    subprocess.run(mix_cmd, check=True)
                    # Replace the canonical audio path so downstream
                    # caption-timing + video-mux paths use the mixed file
                    # without any other code changes.
                    try: os.remove(temp_audio_path)
                    except OSError: pass
                    temp_audio_path = mixed_path
                    print(f"   🎵 mixed background music ({os.path.basename(music_path)}, {music_db:.0f} dB)")
                except Exception as e:
                    # Music is best-effort — never let it kill a render.
                    print(f"   ⚠️  music mix failed, continuing without it: {e}")

            # Measure the actual duration of the joined audio (ffprobe-style)
            # so our caption timing is sample-accurate, not mp3-header-accurate.
            probe = subprocess.run(
                [ffmpeg_exe, "-i", temp_audio_path, "-hide_banner"],
                capture_output=True, text=True,
            )
            import re as _re
            total_duration = 0.0
            for ln in probe.stderr.splitlines():
                m = _re.search(r"Duration: (\d+):(\d+):([\d.]+)", ln)
                if m:
                    h, mm, ss = m.groups()
                    total_duration = int(h)*3600 + int(mm)*60 + float(ss)
                    break

            # We still need per-clip durations to compute caption overlays.
            # Use moviepy JUST for duration reads (no audio concatenation).
            audio_clips = [AudioFileClip(p) for p in audio_paths]

            # mp3 headers over-report duration by ~30-50ms of encoder padding
            # per file. The concat filter trims that padding, so moviepy's
            # sum is ~150ms longer than the actual joined audio — captions
            # end up trailing the voice. Scale each clip's duration to match
            # reality so caption timing lines up with what's actually heard.
            reported_sum = sum(c.duration for c in audio_clips) or 1.0
            if total_duration > 0.0:
                scale = total_duration / reported_sum
            else:
                scale = 1.0
                total_duration = reported_sum
            # Build an effective-duration list for the overlay/chunking code.
            effective_durs = [c.duration * scale for c in audio_clips]
            total_duration += (tail_duration if (tail_text and tail_duration and tail_duration > 0) else 0)

            temp_files.append(temp_audio_path)
            
            # 2. Get Background Video (Pure FFmpeg).
            # Honors self.background_selector — either a specific file, a folder
            # to pick randomly from, or "" for random across all backgrounds.
            print(f"   Preparing background (Direct FFmpeg, selector='{self.background_selector or '*'}')...")
            bg_path = self._pick_background()

            use_blank_bg = bg_path is None
            if use_blank_bg:
                print("⚠️  No background videos found — using blank background")
            
            temp_bg_path = os.path.join(output_dir, "ffmpeg_bg_temp.mp4")
            w = self.width
            h = self.height

            if use_blank_bg:
                # Generate a solid-color background using FFmpeg lavfi
                bg_color_hex = "141420"
                bg_cmd = [
                    ffmpeg_exe, '-y',
                    '-f', 'lavfi', '-i', f'color=c=0x{bg_color_hex}:s={w}x{h}:d={total_duration}:r=30',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                    temp_bg_path
                ]
                print(f"   Generating blank background: {w}x{h}, {total_duration:.1f}s")
                subprocess.run(bg_cmd, check=True)
            else:
                # Check background duration for random seeking
                start_time = 0.0
                enable_loop = True

                try:
                    with VideoFileClip(bg_path) as clip:
                        bg_duration = clip.duration

                    if bg_duration > total_duration:
                        max_start = bg_duration - total_duration
                        start_time = random.uniform(0, max_start)
                        enable_loop = False
                        print(f"   Background is long enough ({bg_duration:.1f}s). Skipping to {start_time:.1f}s.")
                    else:
                        print(f"   Background is short ({bg_duration:.1f}s). Looping.")

                except Exception as e:
                    print(f"⚠️  Could not probe background duration: {e}. Defaulting to loop from start.")

                scale_filter = f"scale='iw*max({w}/iw\\,{h}/ih)':'ih*max({w}/iw\\,{h}/ih)',crop={w}:{h}"

                bg_cmd = [ffmpeg_exe, '-y']
                if start_time > 0:
                    bg_cmd.extend(['-ss', str(start_time)])
                if enable_loop:
                    bg_cmd.extend(['-stream_loop', '-1'])
                bg_cmd.extend(['-i', bg_path, '-vf', scale_filter, '-t', str(total_duration), '-an'])

                if self.hw_accel == 'nvenc':
                    bg_cmd.extend(['-c:v', 'h264_nvenc', '-rc', 'constqp', '-qp', '26', '-b:v', '0', '-preset', 'p2'])
                elif self.hw_accel == 'amf':
                    bg_cmd.extend(['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '26', '-qp_p', '26'])
                else:
                    bg_cmd.extend(['-c:v', 'libx264', '-preset', 'ultrafast'])

                bg_cmd.append(temp_bg_path)
                print(f"   Background Command: {' '.join(bg_cmd)}")
                subprocess.run(bg_cmd, check=True)

            temp_files.append(temp_bg_path)
            
            # 3. Generate Overlays
            cp = self.captions
            print(f"   Captions: enabled={cp['enabled']}, font={cp['font_path']}, size={cp['font_size']}, "
                  f"wpc={cp['words_per_caption']}, pos={cp['position']}, uppercase={cp['uppercase']}")
            print(f"   Generating overlays for {len(audio_segments)} segments...")
            concat_lines = []
            total_chunks = 0

            current_author = None

            for i, segment in enumerate(audio_segments):
                text_preview = (segment.get('text', '') or '')[:60]
                # Use the concat-scaled duration so caption timing matches
                # the ACTUAL audio the video will play, not the padded mp3
                # header value reported by moviepy.
                duration = effective_durs[i] if i < len(effective_durs) else audio_clips[i].duration
                chunks_for_seg = 0
                for overlay_path, chunk_dur in self.create_full_frame_overlays(segment, duration, branding=branding):
                    temp_files.append(overlay_path)
                    escape_path = overlay_path.replace('\\', '/')
                    concat_lines.append(f"file '{escape_path}'")
                    concat_lines.append(f"duration {chunk_dur}")
                    chunks_for_seg += 1
                total_chunks += chunks_for_seg
                print(f"     Segment {i+1}/{len(audio_segments)} → {chunks_for_seg} chunk(s), {duration:.2f}s · \"{text_preview}\"")
            print(f"   Total overlay chunks: {total_chunks}")

            if tail_text and tail_duration and tail_duration > 0:
                tail_segment = {'text': tail_text, 'author': ''}
                for overlay_path, chunk_dur in self.create_full_frame_overlays(tail_segment, tail_duration, branding=branding):
                    temp_files.append(overlay_path)
                    escape_tail = overlay_path.replace('\\', '/')
                    concat_lines.append(f"file '{escape_tail}'")
                    concat_lines.append(f"duration {chunk_dur}")
                
            # Create concat file
            concat_path = os.path.join(output_dir, "overlay_list.txt")
            with open(concat_path, 'w', encoding='utf-8') as f:
                f.write("\n".join(concat_lines))
            temp_files.append(concat_path)
            
            # 4. Construct FFmpeg Command
            print("   Running FFmpeg render...")
            
            # Inputs:
            # -i temp_bg_path (Background)
            # -f concat -i concat_path (Overlay Stream)
            # -i temp_audio_path (Audio)
            
            # Select codec based on hw_accel
            if self.hw_accel == 'nvenc':
                v_codec = 'h264_nvenc'
            elif self.hw_accel == 'amf':
                v_codec = 'h264_amf'
            else:
                v_codec = 'libx264'

            cmd = [
                ffmpeg_exe, '-y',
                '-i', temp_bg_path,
                '-f', 'concat', '-safe', '0', '-i', concat_path,
                '-i', temp_audio_path,
                '-filter_complex', '[0:v][1:v]overlay=0:0[outv]',
                '-map', '[outv]', '-map', '2:a',
                '-c:v', v_codec,
                '-c:a', 'aac',
                '-pix_fmt', 'yuv420p',
                '-r', '30'
            ]

            if not (tail_text and tail_duration and tail_duration > 0):
                cmd.append('-shortest')
            
            if self.hw_accel == 'nvenc':
                cmd.extend(['-preset', 'p4', '-rc', 'vbr', '-cq', '19', '-b:v', '8M'])
            elif self.hw_accel == 'amf':
                cmd.extend(['-quality', 'speed', '-rc', 'vbr_latency', '-qp_i', '19', '-qp_p', '19', '-b:v', '8M'])
            else:
                cmd.extend(['-preset', 'medium', '-crf', '18'])
                
            cmd.append(output_path)
            
            print(f"   Command: {' '.join(cmd)}")
            subprocess.run(cmd, check=True)
            
            print("✓ FFmpeg generation complete!")
            
            # Cleanup
            if self.use_gpu: # Maybe keep for debug if not gpu? No, clean always unless debug mode.
                pass 
                
            print("   Cleaning up temporary files...")
            for f in temp_files:
                try:
                    if os.path.exists(f): os.remove(f)
                except: pass
                
            return output_path
            
        except Exception as e:
            print(f"❌ FFmpeg Engine Error: {e}")
            import traceback
            traceback.print_exc()
            return None

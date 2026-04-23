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
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

if getattr(sys, "frozen", False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class VideoGenerator:
    """
    Generates videos from audio segments and background footage.
    """
    
    def __init__(self, mode: str = 'reel', use_gpu: bool = False, threads: int = 0, hw_accel: str = 'none',
                 captions_config: Optional[dict] = None):
        """
        Initialize video generator.
        mode: 'reel' (9:16) or 'full' (16:9)
        use_gpu: Whether to use hardware encoding (legacy, overridden by hw_accel)
        threads: Number of threads for writing video (0 = auto/max)
        hw_accel: Hardware acceleration type: 'none' (CPU), 'nvenc' (NVIDIA), 'amf' (AMD)
        captions_config: Caption appearance/timing config (see _caption_params).
        """
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

        self.captions = self._caption_params(captions_config or {})

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
            # Animation: 'none' | 'fade' | 'pop' | 'fade_pop'. MoviePy engine only.
            'animation':       (cfg.get('animation') or 'none').lower(),
            'animation_duration': float(cfg.get('animation_duration', 0.15)),
            'pop_overshoot':   float(cfg.get('pop_overshoot', 1.12)),
            'pop_start_scale': float(cfg.get('pop_start_scale', 0.7)),
            # Per-word highlight (requires whisper alignment).
            'highlight_word':  bool(cfg.get('highlight_word', False)),
            'highlight_color': cfg.get('highlight_color', '#FFD93D'),   # yellow
            'highlight_scale': float(cfg.get('highlight_scale', 1.0)),  # 1.0 = no scale
            'highlight_stroke_color': cfg.get('highlight_stroke_color', cfg.get('stroke_color', 'black')),
            # Safety rails against runaway captions when whisper has gaps in the audio.
            'max_chunk_duration': float(cfg.get('max_chunk_duration', 2.5)),  # seconds per chunk
            'lead_in_grace':      float(cfg.get('lead_in_grace', 1.0)),       # seconds of lead before first word
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

        # --- Aligned path: we have whisper word timestamps ---
        if words and words_per_caption > 0:
            highlight = bool(self.captions.get('highlight_word'))
            # Cap how long a single caption chunk stays on screen. If the next
            # word-group is far away (long pause, whisper gap, leading silence)
            # we show the caption for this long then blank until the next word.
            max_chunk_dur = float(self.captions.get('max_chunk_duration', 2.5))
            # First-chunk grace: if the first spoken word is 5s in, we still
            # want a caption up for a short lead-in, not the whole gap.
            lead_grace   = float(self.captions.get('lead_in_grace', 1.0))

            # Build groups with their anchored start (first word's whisper start).
            groups = []
            for i in range(0, len(words), words_per_caption):
                grp = words[i:i + words_per_caption]
                chunk_text = " ".join((w.get("word") or "").strip() for w in grp).strip()
                grp_start = max(0.0, float(grp[0].get("start", 0.0)))
                groups.append((chunk_text, grp_start, grp))

            out = []
            cursor = 0.0
            for i, (chunk_text, grp_start, grp) in enumerate(groups):
                # When should this chunk become visible?
                if i == 0:
                    # First chunk: cover leading silence up to `lead_grace` seconds.
                    chunk_start = max(0.0, min(cursor, grp_start))
                    if grp_start - chunk_start > lead_grace:
                        chunk_start = max(0.0, grp_start - lead_grace)
                else:
                    chunk_start = max(cursor, grp_start)

                # When should the next chunk take over?
                if i + 1 < len(groups):
                    next_start = min(duration, max(chunk_start + 0.05, groups[i + 1][1]))
                else:
                    next_start = duration

                # Leading blank (after last chunk ended but before this one starts)
                if chunk_start > cursor:
                    out.append({"text": "", "duration": chunk_start - cursor,
                                "words": [], "active_index": -1})
                    cursor = chunk_start

                available = max(0.05, next_start - chunk_start)

                if not highlight or len(grp) <= 1:
                    # Single-frame chunk, capped.
                    visible = min(available, max_chunk_dur)
                    out.append({"text": chunk_text, "duration": visible,
                                "words": [(w.get("word") or "").strip() for w in grp],
                                "active_index": -1})
                    cursor = chunk_start + visible
                    # Blank tail if the gap exceeds the cap
                    if available > visible + 0.01:
                        out.append({"text": "", "duration": available - visible,
                                    "words": [], "active_index": -1})
                        cursor = next_start
                    else:
                        cursor = next_start
                    continue

                # Per-word highlight frames for the group.
                word_list = [(w.get("word") or "").strip() for w in grp]
                # Determine per-word end times from the next word's start (or group end).
                word_ends = []
                for j, w in enumerate(grp):
                    if j + 1 < len(grp):
                        nxt = max(chunk_start + (j + 1) * 0.04, float(grp[j + 1].get("start", 0.0)))
                        nxt = min(nxt, next_start)
                    else:
                        nxt = next_start
                    word_ends.append(nxt)

                # Scale: how much of `available` does "real speech" cover?
                # Last word's timestamp-end or group_end — whichever comes first.
                last_word_end = float(grp[-1].get("end", word_ends[-1]))
                real_end = min(last_word_end, next_start)
                real_end = max(real_end, chunk_start + 0.05)

                # Draw each word, clamped to max_chunk_dur per word (rarely triggers)
                word_cursor = chunk_start
                for j, _w in enumerate(grp):
                    end_time = min(word_ends[j], real_end)
                    dur = max(0.04, end_time - word_cursor)
                    dur = min(dur, max_chunk_dur)
                    out.append({"text": chunk_text, "duration": dur,
                                "words": word_list, "active_index": j})
                    word_cursor += dur

                cursor = word_cursor
                # Trailing silence within this group's window -> blank
                if next_start > cursor + 0.01:
                    out.append({"text": "", "duration": next_start - cursor,
                                "words": [], "active_index": -1})
                    cursor = next_start

            # Drop zero-duration slivers
            out = [f for f in out if f["duration"] > 0.001]
            return out if out else [{"text": text, "duration": duration, "words": [text], "active_index": -1}]

        # --- Fallback: even char-weighted chunking ---
        if words_per_caption <= 0 or not text:
            return [{"text": text, "duration": duration, "words": text.split() if text else [], "active_index": -1}]
        tok = text.split()
        if not tok:
            return [{"text": text, "duration": duration, "words": [], "active_index": -1}]
        chunks = [' '.join(tok[i:i + words_per_caption])
                  for i in range(0, len(tok), words_per_caption)]
        total_chars = sum(len(c) for c in chunks) or 1
        out = []
        allocated = 0.0
        for i, c in enumerate(chunks):
            if i == len(chunks) - 1:
                dur = max(0.0, duration - allocated)
            else:
                dur = duration * (len(c) / total_chars)
                allocated += dur
            out.append({"text": c, "duration": dur, "words": c.split(), "active_index": -1})
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
                         uppercase: bool = False) -> str:
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

        img_width = text_width + padding * 2
        img_height = text_height + padding * 2
        
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
            
            # Draw rounded rectangle (pill shape-ish)
            draw.rounded_rectangle(
                [(0, 0), (img_width, img_height)],
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
        draw_x = padding - bbox[0]
        draw_y = padding - bbox[1]

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

        # Wrap words into lines. Track each token's geometry + whether it's active.
        # If a single word is wider than `budget` at its base font, shrink
        # JUST THAT WORD so it fits — other words stay at normal/highlight size.
        lines: list[list[dict]] = [[]]
        cur_w = 0
        for i, word in enumerate(words):
            is_active = (i == active_idx)
            base_font = font_hi if is_active else font_normal
            base_size_for_word = int(base_font.size)
            f = base_font
            ww = int(f.getlength(word))
            # Shrink if oversized. 0.97 safety factor to avoid 1-pixel overflow
            # from rounding in glyph advance widths.
            if ww > budget:
                scale = (budget / ww) * 0.97
                new_size = max(10, int(round(base_size_for_word * scale)))
                f = self._load_font(p['font_path'], new_size)
                ww = int(f.getlength(word))
                # Corner case: even at min size 10px still wider — cap at 10.
                if ww > budget:
                    # Last resort: hard clamp.
                    ww = budget
            gap = space_w if lines[-1] else 0
            if lines[-1] and cur_w + gap + ww > budget:
                lines.append([])
                cur_w = 0
                gap = 0
            lines[-1].append({"word": word, "active": is_active, "font": f, "w": ww})
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

        img_w = total_w + padding * 2 + stroke_w * 2
        img_h = total_h + padding * 2 + stroke_w * 2

        img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

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
            draw.rounded_rectangle([(0, 0), (img_w, img_h)], radius=p['corner_radius'], fill=box_color)

        # Draw each line centered horizontally. Baseline-align mixed-size words
        # within a line so a shrunk word sits nicely next to full-size ones.
        cur_y = padding + stroke_w
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
                txt_color  = hi_color  if tok["active"] else color
                stroke_col = hi_stroke if tok["active"] else stroke
                draw.text(
                    (cur_x, word_y), tok["word"],
                    font=f, fill=txt_color,
                    stroke_width=stroke_w, stroke_fill=stroke_col,
                )
                cur_x += tok["w"] + space_w
            cur_y += lh + int(base_size * 0.15)

        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        img.save(tmp.name)
        tmp.close()
        return tmp.name

    def _render_caption_image(self, text: str) -> str:
        """Render a single caption PNG using the normalized caption config."""
        p = self.captions
        use_bg = bool(p['bg_color'])
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
        )

    def get_random_background(self, duration: float) -> VideoFileClip:
        """
        Get a random background clip of appropriate duration and aspect ratio.
        """
        video_files = [f for f in os.listdir(self.backgrounds_dir) 
                      if f.lower().endswith(('.mp4', '.mov', '.avi'))]
        
        if not video_files:
            # Create a simple color background if no videos found
            print("⚠️  No background videos found in 'backgrounds/'. Using solid color.")
            return ColorClip(size=(self.width, self.height), color=(20, 20, 30), duration=duration)
            
        bg_path = os.path.join(self.backgrounds_dir, random.choice(video_files))
        
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
            if include_brand:
                brand_path = self.create_text_image(
                    branding.strip(),
                    fontsize=30,
                    color='white',
                    max_width=int(self.width * 0.4),
                    use_bg_box=True,
                    bg_color='black',
                    bg_opacity=120,
                    padding=12,
                )
                brand_img = Image.open(brand_path).convert("RGBA")
                bw, bh = brand_img.size
                canvas.alpha_composite(brand_img, (self.width - bw - 20, self.height - bh - 20))
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
                video_files = [f for f in os.listdir(self.backgrounds_dir)
                              if f.lower().endswith(('.mp4', '.mov', '.avi'))]
                if video_files:
                    bg_path = os.path.join(self.backgrounds_dir, random.choice(video_files))
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

            # 2. Load fonts
            try:
                font_title = ImageFont.truetype("arialbd.ttf", 52)
                font_sub = ImageFont.truetype("arial.ttf", 36)
                font_meta = ImageFont.truetype("arial.ttf", 30)
                font_brand = ImageFont.truetype("arial.ttf", 26)
            except OSError:
                try:
                    font_title = ImageFont.truetype("arial.ttf", 52)
                except OSError:
                    font_title = ImageFont.load_default()
                font_sub = font_title
                font_meta = font_title
                font_brand = font_title

            # 3. Measure content to determine dynamic card height
            card_margin_x = int(w * 0.08)
            card_w = w - card_margin_x * 2
            inner_pad = 30
            title_max_w = card_w - inner_pad * 2

            # Subreddit header height
            icon_r = 24
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

            # Bottom bar height
            bottom_bar_h = 40

            # Calculate total card height dynamically
            card_h = inner_pad + header_h + 20 + title_text_h + 25 + bottom_bar_h + inner_pad
            card_h = max(card_h, int(h * 0.18))  # minimum height
            card_h = min(card_h, int(h * 0.55))  # maximum height

            card_y = (h - card_h) // 2
            card_x = card_margin_x

            # 4. Draw rounded white card
            card_rect = [(card_x, card_y), (card_x + card_w, card_y + card_h)]
            draw.rounded_rectangle(card_rect, radius=30, fill=(255, 255, 255, 240))

            # 5. Reddit icon circle + subreddit name
            icon_y = card_y + inner_pad
            icon_x = card_x + inner_pad
            draw.ellipse(
                [(icon_x, icon_y), (icon_x + icon_r * 2, icon_y + icon_r * 2)],
                fill=(255, 69, 0)
            )
            cx, cy = icon_x + icon_r, icon_y + icon_r
            draw.ellipse([(cx - 8, cy - 6), (cx - 2, cy)], fill='white')
            draw.ellipse([(cx + 2, cy - 6), (cx + 8, cy)], fill='white')
            draw.arc([(cx - 8, cy - 2), (cx + 8, cy + 8)], 0, 180, fill='white', width=2)

            # Show branding handle instead of subreddit for privacy
            sub_text = f"u/{branding.strip()}" if branding and branding.strip() else f"r/{subreddit}"
            draw.text((icon_x + icon_r * 2 + 12, icon_y + 8), sub_text, fill=(30, 30, 30), font=font_sub)

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
                    radius=badge_h // 2, fill=(255, 69, 0)
                )
                draw.text((badge_x + 15, badge_y_pos + 5), badge_text, fill='white', font=font_sub)

            # 7. Title text (centered in remaining space)
            title_y = icon_y + icon_r * 2 + 20
            draw.multiline_text(
                (card_x + inner_pad, title_y), wrapped,
                fill=(20, 20, 20), font=font_title, spacing=8
            )

            # 8. Bottom bar — hearts + share count
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

    def generate_video_ffmpeg(self, audio_segments: List[dict], output_path: str, tail_text: Optional[str] = None, tail_duration: float = 0.0, branding: str = "", post_title: str = "", post_subreddit: str = "", post_score: int = 0):
        """
        Generate video using direct FFmpeg commands (Beta Engine).
        Significantly faster compositing but requires FFmpeg installed.
        """
        print(f"\n🎬 Generating video (FFMPEG Beta Engine)...")
        import subprocess

        temp_files = [] # Track for cleanup

        if self.captions['animation'] != 'none':
            print(f"⚠️  Caption animation '{self.captions['animation']}' is ignored by the FFmpeg engine. "
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
            # 1. Prepare Audio (Using MoviePy for safety/compatibility)
            # We reuse the concatenation logic to get one solid audio file
            audio_clips = [AudioFileClip(s['audio_path']) for s in audio_segments]
            final_audio = concatenate_audioclips(audio_clips)
            total_duration = final_audio.duration + (tail_duration if (tail_text and tail_duration and tail_duration > 0) else 0)
            
            output_dir = os.path.dirname(output_path)
            os.makedirs(output_dir, exist_ok=True)
            temp_audio_path = os.path.join(output_dir, "ffmpeg_audio_temp.m4a")
            final_audio.write_audiofile(temp_audio_path, codec='aac', logger=None)
            final_audio.close()
            temp_files.append(temp_audio_path)
            
            # 2. Get Background Video (Pure FFmpeg)
            print("   Preparing background (Direct FFmpeg)...")
            video_files = [f for f in os.listdir(self.backgrounds_dir) 
                          if f.lower().endswith(('.mp4', '.mov', '.avi'))]
            
            use_blank_bg = False
            if not video_files:
                print("⚠️  No background videos found — using blank background")
                use_blank_bg = True
                bg_path = None
            else:
                bg_file = random.choice(video_files)
                bg_path = os.path.join(self.backgrounds_dir, bg_file)
            
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
                duration = audio_clips[i].duration
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

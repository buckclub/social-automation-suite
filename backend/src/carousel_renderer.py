"""
Carousel slide renderer — produces square / portrait PNG slides for
Instagram / TikTok / LinkedIn carousel posts.

Uses Pillow (already a project dep). Mirrors the design primitives of
video_generator.py's caption renderer so a user's brand colors / fonts
translate one-to-one between reels and carousels.

A "slide" is a plain dict:
    {
      "title": "<optional bold heading, top of slide>",
      "body":  "<main paragraph text>",
    }

A "style" is a plain dict (all keys optional, defaults below):
    {
      "size":            "square" | "portrait_4x5",   # 1080×1080 or 1080×1350
      "bg_color":        "#0F172A",
      "text_color":      "#F8FAFC",
      "accent_color":    "#FFD93D",
      "font_path":       "arial.ttf",
      "title_size":      72,
      "body_size":       52,
      "padding":         80,
      "watermark":       "@yourhandle",
      "show_pagination": True,                        # "1/10" indicator bottom-right
    }

Returns rendered slides as PIL Images. The HTTP layer wraps them into a
zip stream for download.
"""
from __future__ import annotations

import io
import os
import zipfile
from typing import Optional

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


# ── Defaults ──────────────────────────────────────────────────────

SIZE_PRESETS: dict[str, tuple[int, int]] = {
    "square":       (1080, 1080),
    "portrait_4x5": (1080, 1350),
}
DEFAULT_STYLE = {
    "size":            "portrait_4x5",
    "bg_color":        "#0F172A",
    "text_color":      "#F8FAFC",
    "accent_color":    "#FFD93D",
    "font_path":       "arial.ttf",
    "title_size":      72,
    "body_size":       52,
    "padding":         80,
    "watermark":       "",
    "show_pagination": True,
}


# ── Helpers ───────────────────────────────────────────────────────

def _hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = (s or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return (15, 23, 42)  # slate-900 fallback
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError:
        return (15, 23, 42)


def _load_font(path: str, size: int) -> "ImageFont.FreeTypeFont":
    for candidate in (path, "arial.ttf"):
        if not candidate:
            continue
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap_text(draw: "ImageDraw.ImageDraw", text: str, font: "ImageFont.FreeTypeFont", max_width: int) -> list[str]:
    """Greedy word-wrap honoring real font metrics. Preserves existing newlines."""
    if not text:
        return [""]
    out: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            out.append("")
            continue
        words = paragraph.split()
        if not words:
            out.append("")
            continue
        current = words[0]
        for w in words[1:]:
            candidate = current + " " + w
            if draw.textlength(candidate, font=font) <= max_width:
                current = candidate
            else:
                out.append(current)
                current = w
        out.append(current)
    return out


# ── Single-slide renderer ─────────────────────────────────────────

def render_slide(slide: dict, style: dict, *, idx: int = 1, total: int = 1) -> "Image.Image":
    """
    Compose one slide image. The slide is centered vertically; title (if
    any) sits above the body with a small accent rule between them.
    Watermark + pagination dock to the bottom corners.
    """
    if not PIL_AVAILABLE:
        raise RuntimeError("Pillow not installed — carousel rendering unavailable.")

    s = {**DEFAULT_STYLE, **(style or {})}
    w, h = SIZE_PRESETS.get(s["size"], SIZE_PRESETS["portrait_4x5"])
    pad = int(s["padding"])
    bg = _hex_to_rgb(s["bg_color"])
    fg = _hex_to_rgb(s["text_color"])
    accent = _hex_to_rgb(s["accent_color"])
    font_title = _load_font(s["font_path"], int(s["title_size"]))
    font_body  = _load_font(s["font_path"], int(s["body_size"]))
    font_meta  = _load_font(s["font_path"], 28)

    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)

    title = (slide.get("title") or "").strip()
    body  = (slide.get("body") or "").strip()
    inner_w = w - pad * 2

    # Pre-wrap title + body so we can vertically center the union.
    title_lines = _wrap_text(draw, title, font_title, inner_w) if title else []
    body_lines  = _wrap_text(draw, body, font_body, inner_w) if body else []

    title_lh = int(s["title_size"] * 1.2)
    body_lh  = int(s["body_size"] * 1.35)

    title_block_h = (title_lh * len(title_lines)) if title_lines else 0
    body_block_h  = (body_lh * len(body_lines))   if body_lines else 0
    rule_h = 24 if (title and body) else 0
    total_h = title_block_h + rule_h + body_block_h

    y = max(pad, (h - total_h) // 2)

    # Title
    for line in title_lines:
        line_w = draw.textlength(line, font=font_title)
        x = (w - line_w) // 2
        draw.text((x, y), line, font=font_title, fill=fg)
        y += title_lh

    # Accent rule between title and body (only when both are present)
    if title and body:
        rw = 80
        rx = (w - rw) // 2
        ry = y + 8
        draw.rectangle([(rx, ry), (rx + rw, ry + 4)], fill=accent)
        y += rule_h

    # Body
    for line in body_lines:
        if not line:
            y += body_lh
            continue
        line_w = draw.textlength(line, font=font_body)
        x = (w - line_w) // 2
        draw.text((x, y), line, font=font_body, fill=fg)
        y += body_lh

    # Watermark — bottom-left, low-contrast
    wm = (s.get("watermark") or "").strip()
    if wm:
        wm_w = draw.textlength(wm, font=font_meta)
        draw.text(
            (pad, h - pad - 28), wm, font=font_meta,
            fill=tuple(int(c * 0.6) for c in fg),
        )

    # Pagination — bottom-right, accent color
    if s.get("show_pagination", True) and total > 1:
        page = f"{idx}/{total}"
        page_w = draw.textlength(page, font=font_meta)
        draw.text(
            (w - pad - int(page_w), h - pad - 28), page,
            font=font_meta, fill=accent,
        )

    return img


# ── Carousel renderer (zip stream) ────────────────────────────────

def render_carousel_to_zip(slides: list[dict], style: dict) -> bytes:
    """
    Render every slide and pack them into an in-memory zip. Each PNG is
    named `slide_01.png`, `slide_02.png`, … so they sort correctly when
    the user uploads to Instagram.
    """
    if not slides:
        raise ValueError("slides[] is empty")
    buf = io.BytesIO()
    total = len(slides)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, slide in enumerate(slides, 1):
            img = render_slide(slide, style, idx=i, total=total)
            png_buf = io.BytesIO()
            img.save(png_buf, format="PNG", optimize=True)
            zf.writestr(f"slide_{i:02d}.png", png_buf.getvalue())
    buf.seek(0)
    return buf.getvalue()


def render_slide_to_png(slide: dict, style: dict, *, idx: int, total: int) -> bytes:
    """Single-slide PNG bytes — used by the live-preview endpoint."""
    img = render_slide(slide, style, idx=idx, total=total)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()

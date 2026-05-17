"""
Frame-level heatmap generator for deepfake analysis results.

Produces an 800×220px PNG using only Pillow + standard library (no matplotlib).
The image shows a horizontal timeline bar where each sampled frame is coloured:
  green  → REAL   (score < 0.4)
  yellow → UNCERTAIN (0.4 ≤ score < 0.8)
  red    → FAKE   (score ≥ 0.8)

Layout
------
  ┌─ title ──────────────────────────────── legend ─┐
  │  [frame timeline bar with rounded caps]          │
  │  frame labels below bar                          │
  └──────────────────────────────────────────────────┘
"""

from __future__ import annotations

import io
import math
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

IMG_W = 800
IMG_H = 220

PAD_X = 24        # left/right outer padding
PAD_TOP = 14      # gap above title
TITLE_H = 26      # space for the title text row
BAR_Y = PAD_TOP + TITLE_H + 8   # top of the frame timeline bar
BAR_H = 76        # height of the timeline bar
LABEL_Y = BAR_Y + BAR_H + 8     # top of frame-number labels
LEGEND_W = 100    # width of the colour-scale legend strip on the right
LEGEND_PAD = 14   # gap between bar area and legend

BG_COLOR = (18, 18, 24)          # near-black background
TITLE_COLOR = (230, 230, 240)
LABEL_COLOR = (160, 160, 180)
BORDER_COLOR = (50, 50, 65)


# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------

def _score_to_rgb(score: float) -> tuple[int, int, int]:
    """
    Map a suspicion score [0, 1] → RGB colour.

    0.0  →  (40, 200, 100)   vivid green
    0.4  →  (240, 200, 40)   amber/yellow
    0.8  →  (220, 60, 50)    red
    1.0  →  (180, 20, 30)    deep red
    """
    score = max(0.0, min(1.0, score))

    if score < 0.4:
        t = score / 0.4          # 0→1 across the green-to-yellow range
        r = int(40  + t * (240 - 40))
        g = int(200 + t * (200 - 200))
        b = int(100 + t * (40  - 100))
    elif score < 0.8:
        t = (score - 0.4) / 0.4  # 0→1 across the yellow-to-red range
        r = int(240 + t * (220 - 240))
        g = int(200 + t * (60  - 200))
        b = int(40  + t * (50  - 40))
    else:
        t = (score - 0.8) / 0.2  # 0→1 across the red-to-deep-red range
        r = int(220 + t * (180 - 220))
        g = int(60  + t * (20  - 60))
        b = int(50  + t * (30  - 50))

    return (r, g, b)


def _alpha_blend(fg: tuple[int, int, int], bg: tuple[int, int, int], alpha: float) -> tuple[int, int, int]:
    return tuple(int(fg[i] * alpha + bg[i] * (1 - alpha)) for i in range(3))  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Font helper — falls back to the built-in bitmap font gracefully
# ---------------------------------------------------------------------------

def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Try to load a readable TrueType font; fall back to Pillow's built-in."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "arial.ttf",
        "Arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (IOError, OSError):
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def _rounded_rect(
    draw: ImageDraw.ImageDraw,
    x0: int, y0: int, x1: int, y1: int,
    radius: int,
    fill: tuple[int, int, int],
) -> None:
    """Draw a filled rounded rectangle using Pillow's built-in pieslice + rectangle."""
    radius = min(radius, (x1 - x0) // 2, (y1 - y0) // 2)
    if radius <= 0:
        draw.rectangle([x0, y0, x1, y1], fill=fill)
        return

    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.pieslice([x0, y0, x0 + 2 * radius, y0 + 2 * radius], 180, 270, fill=fill)
    draw.pieslice([x1 - 2 * radius, y0, x1, y0 + 2 * radius], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2 * radius, x0 + 2 * radius, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2 * radius, y1 - 2 * radius, x1, y1], 0, 90, fill=fill)


def _draw_legend(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int) -> None:
    """Vertical colour-scale gradient strip with REAL / FAKE labels."""
    font_sm = _font(11)

    # Gradient strip (top = red/fake, bottom = green/real) — 1px rows
    for row in range(h):
        score = 1.0 - row / h   # top row → score 1.0 (fake), bottom → 0.0 (real)
        color = _score_to_rgb(score)
        draw.line([(x, y + row), (x + w, y + row)], fill=color)

    # Border around the strip
    draw.rectangle([x, y, x + w, y + h], outline=BORDER_COLOR, width=1)

    # Labels
    draw.text((x + w + 4, y - 2), "FAKE", font=font_sm, fill=_score_to_rgb(1.0))
    draw.text((x + w + 4, y + h // 2 - 6), "UNCERTAIN", font=font_sm, fill=_score_to_rgb(0.6))
    draw.text((x + w + 4, y + h - 8), "REAL", font=font_sm, fill=_score_to_rgb(0.0))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_heatmap(
    frame_scores: Sequence[float],
    verdict: str = "",
    confidence: float = 0.0,
) -> bytes:
    """
    Generate a PNG heatmap from per-frame suspicion scores.

    Parameters
    ----------
    frame_scores : sequence of floats in [0, 1]
    verdict      : overall verdict string (shown in title)
    confidence   : overall confidence (0-1, shown in title)

    Returns
    -------
    bytes — raw PNG file content
    """
    if not frame_scores:
        raise ValueError("frame_scores must not be empty")

    img = Image.new("RGB", (IMG_W, IMG_H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    font_title = _font(15)
    font_label = _font(10)

    # ------------------------------------------------------------------
    # Title row
    # ------------------------------------------------------------------
    title_text = "Veritas — Frame Analysis"
    if verdict:
        verdict_color = _score_to_rgb(confidence)
        draw.text((PAD_X, PAD_TOP), title_text, font=font_title, fill=TITLE_COLOR)

        # Append verdict badge
        title_w = draw.textlength(title_text, font=font_title) if hasattr(draw, "textlength") else 200
        badge_x = PAD_X + int(title_w) + 12
        badge_text = f"{verdict}  {round(confidence * 100)}%"
        badge_w = (draw.textlength(badge_text, font=font_title) if hasattr(draw, "textlength") else 80) + 12
        badge_h = 20
        _rounded_rect(draw, badge_x, PAD_TOP - 1, badge_x + int(badge_w), PAD_TOP + badge_h, 6, verdict_color)
        draw.text((badge_x + 6, PAD_TOP + 1), badge_text, font=font_title, fill=(10, 10, 10))
    else:
        draw.text((PAD_X, PAD_TOP), title_text, font=font_title, fill=TITLE_COLOR)

    # ------------------------------------------------------------------
    # Legend (right side)
    # ------------------------------------------------------------------
    legend_strip_w = 14
    legend_strip_h = BAR_H
    legend_label_room = 68  # room for "UNCERTAIN" text
    legend_x = IMG_W - PAD_X - legend_label_room - legend_strip_w
    _draw_legend(draw, legend_x, BAR_Y, legend_strip_w, legend_strip_h)

    # ------------------------------------------------------------------
    # Frame timeline bar
    # ------------------------------------------------------------------
    bar_x0 = PAD_X
    bar_x1 = legend_x - LEGEND_PAD
    bar_total_w = bar_x1 - bar_x0

    n = len(frame_scores)
    gap = 2                        # gap between segment cells
    cell_w = max(1, (bar_total_w - gap * (n - 1)) // n)
    radius = min(6, BAR_H, cell_w // 2)

    # Background trough
    _rounded_rect(draw, bar_x0, BAR_Y, bar_x1, BAR_Y + BAR_H, 8, (35, 35, 45))

    for i, score in enumerate(frame_scores):
        cx0 = bar_x0 + i * (cell_w + gap)
        cx1 = cx0 + cell_w
        color = _score_to_rgb(score)

        # Inner glow: slightly lighter version on top half
        light = _alpha_blend((255, 255, 255), color, 0.15)
        _rounded_rect(draw, cx0, BAR_Y + 2, cx1, BAR_Y + BAR_H - 2, radius, color)

        # Subtle highlight on upper quarter
        highlight_h = max(2, BAR_H // 4)
        _rounded_rect(draw, cx0 + 1, BAR_Y + 2, cx1 - 1, BAR_Y + 2 + highlight_h, radius, light)

    # Outer border
    _rounded_rect(draw, bar_x0 - 1, BAR_Y - 1, bar_x1 + 1, BAR_Y + BAR_H + 1, 9, BORDER_COLOR)
    # Re-draw interior so border doesn't cover it
    _rounded_rect(draw, bar_x0, BAR_Y, bar_x1, BAR_Y + BAR_H, 8, (35, 35, 45))
    for i, score in enumerate(frame_scores):
        cx0 = bar_x0 + i * (cell_w + gap)
        cx1 = cx0 + cell_w
        color = _score_to_rgb(score)
        light = _alpha_blend((255, 255, 255), color, 0.15)
        _rounded_rect(draw, cx0, BAR_Y + 2, cx1, BAR_Y + BAR_H - 2, radius, color)
        highlight_h = max(2, BAR_H // 4)
        _rounded_rect(draw, cx0 + 1, BAR_Y + 2, cx1 - 1, BAR_Y + 2 + highlight_h, radius, light)

    # ------------------------------------------------------------------
    # Frame number labels (show every nth label so they don't collide)
    # ------------------------------------------------------------------
    min_label_spacing = 30  # pixels
    step = max(1, math.ceil(min_label_spacing / (cell_w + gap)))

    for i in range(0, n, step):
        cx0 = bar_x0 + i * (cell_w + gap)
        cx1 = cx0 + cell_w
        cx_mid = (cx0 + cx1) // 2
        label = str(i + 1)
        try:
            lw = draw.textlength(label, font=font_label)
        except AttributeError:
            lw = len(label) * 6
        draw.text((cx_mid - int(lw) // 2, LABEL_Y), label, font=font_label, fill=LABEL_COLOR)

    # ------------------------------------------------------------------
    # Score ticks — thin coloured tick marks below the bar
    # ------------------------------------------------------------------
    tick_y0 = BAR_Y + BAR_H + 2
    tick_y1 = tick_y0 + 3
    for i, score in enumerate(frame_scores):
        cx0 = bar_x0 + i * (cell_w + gap)
        cx1 = cx0 + cell_w
        cx_mid = (cx0 + cx1) // 2
        color = _score_to_rgb(score)
        draw.line([(cx_mid, tick_y0), (cx_mid, tick_y1)], fill=color, width=1)

    # ------------------------------------------------------------------
    # Encode as PNG
    # ------------------------------------------------------------------
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

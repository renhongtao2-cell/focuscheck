#!/usr/bin/env python3
"""
Generate the Open Graph share images for the public pages.

Run from the project root:

    python tools/make_og_images.py

Writes 1200x630 PNGs into assets/og/. Every page that is meant to be shared
points at one of these through <meta property="og:image">.

Requires Pillow (pip install Pillow).
"""

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "og")

# palette — kept in sync with assets/styles.css
BRAND = "#0E7C5A"
BRAND_DARK = "#0A5C43"
BRAND_SOFT = "#E8F5F0"
TINT = "#EAF5F1"
INK = "#13211C"
INK2 = "#56635F"
INK3 = "#8B9691"
LINE = "#E3E9E7"

FONT_DIR = "C:/Windows/Fonts"


def font(name, size):
    """Load a Windows system font, falling back to Pillow's default."""
    for candidate in (name, "segoeui.ttf", "arial.ttf"):
        path = os.path.join(FONT_DIR, candidate)
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    words = text.split()
    lines, line = [], ""
    for word in words:
        trial = (line + " " + word).strip()
        if draw.textlength(trial, font=fnt) > max_w and line:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def draw_spaced(draw, xy, text, fnt, fill, spacing):
    """Pillow has no letter-spacing, so draw one glyph at a time."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + spacing
    return x


def spaced_width(draw, text, fnt, spacing):
    return sum(draw.textlength(c, font=fnt) for c in text) + spacing * max(0, len(text) - 1)


def gradient_background():
    img = Image.new("RGB", (W, H), "#FFFFFF")
    draw = ImageDraw.Draw(img)
    top = (255, 255, 255)
    bottom = (242, 250, 246)
    for y in range(H):
        t = y / (H - 1)
        draw.line(
            [(0, y), (W, y)],
            fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return img


def build(spec):
    img = gradient_background()
    draw = ImageDraw.Draw(img)

    # top accent
    draw.rectangle([0, 0, W, 8], fill=BRAND)

    # ---- logo ----
    draw.rounded_rectangle([72, 60, 128, 116], radius=19, fill=BRAND)
    draw.line([(89, 90), (101, 102), (118, 80)], fill="#FFFFFF", width=7, joint="curve")
    draw.text((146, 72), "FocusCheck", font=font("segoeuib.ttf", 33), fill=BRAND)

    # ---- eyebrow ----
    eyebrow = font("segoeuib.ttf", 20)
    draw_spaced(draw, (72, 196), spec["eyebrow"], eyebrow, INK3, 2.6)

    # ---- headline ----
    head = font("segoeuib.ttf", 56)
    y = 252
    for line in wrap(draw, spec["headline"], head, W - 150)[:2]:
        draw.text((72, y), line, font=head, fill=INK)
        y += 66

    # ---- subhead ----
    sub = font("segoeui.ttf", 25)
    y += 24
    for line in wrap(draw, spec["subhead"], sub, W - 170)[:2]:
        draw.text((72, y), line, font=sub, fill=INK2)
        y += 34

    # ---- pill row ----
    pill_font = font("segoeuib.ttf", 19)
    x, py, ph = 72, 470, 46
    for label in spec["pills"]:
        pw = draw.textlength(label, font=pill_font) + 44
        draw.rounded_rectangle([x, py, x + pw, py + ph], radius=ph // 2, fill=BRAND_SOFT)
        draw.text((x + 22, py + 12), label, font=pill_font, fill=BRAND_DARK)
        x += pw + 14

    # ---- footer strip ----
    draw.rectangle([0, H - 78, W, H], fill=BRAND)
    draw.text((72, H - 51), "Take the free 3-minute screening", font=font("segoeuib.ttf", 26), fill="#FFFFFF")
    host = spec.get("host", "")
    if host:
        hf = font("segoeuib.ttf", 24)
        draw.text((W - 72 - draw.textlength(host, font=hf), H - 50), host, font=hf, fill="#CFE9DF")

    path = os.path.join(OUT_DIR, spec["file"])
    img.save(path, "PNG", optimize=True)
    return path


PAGES = [
    {
        "file": "og-home.png",
        "eyebrow": "ADULT ADHD SELF-SCREENING",
        "headline": "Free adult ADHD screening, scored in 3 minutes",
        "subhead": "The WHO ASRS-v1.1 checklist, scored instantly — with a personalised "
                   "report when you want the full picture.",
        "pills": ["WHO ASRS-v1.1", "18 statements", "No sign-up"],
        "host": "focuscheck",
    },
    {
        "file": "og-inattentive.png",
        "eyebrow": "ADULT ADHD · INATTENTIVE TYPE",
        "headline": "Predominantly inattentive ADHD in adults",
        "subhead": "The quiet presentation: focus, follow-through and working memory — "
                   "not visible restlessness. It is the one most often missed.",
        "pills": ["Focus", "Working memory", "Follow-through"],
        "host": "focuscheck",
    },
    {
        "file": "og-hyperactive.png",
        "eyebrow": "ADULT ADHD · HYPERACTIVE-IMPULSIVE",
        "headline": "Hyperactive-impulsive ADHD in adults",
        "subhead": "Restlessness, urgency and impulse control — the presentation most often "
                   "misread as personality rather than as a symptom.",
        "pills": ["Restlessness", "Impulse control", "Unwinding"],
        "host": "focuscheck",
    },
    {
        "file": "og-combined.png",
        "eyebrow": "ADULT ADHD · COMBINED TYPE",
        "headline": "Combined type ADHD in adults",
        "subhead": "Both symptom clusters elevated at once — the most common adult "
                   "presentation, and usually the most disruptive.",
        "pills": ["Both clusters", "Most common", "Adults"],
        "host": "focuscheck",
    },
    {
        "file": "og-symptoms.png",
        "eyebrow": "ADULT ADHD · SYMPTOMS",
        "headline": "Adult ADHD symptoms, explained",
        "subhead": "All 18 WHO ASRS-v1.1 statements, what each one is really asking, and "
                   "exactly how the screening score is calculated.",
        "pills": ["All 18 items", "How scoring works", "Evidence-based"],
        "host": "focuscheck",
    },
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for spec in PAGES:
        path = build(spec)
        print("wrote", os.path.relpath(path), os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()

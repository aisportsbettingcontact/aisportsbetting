#!/usr/bin/env python3
"""
Splits Card Image Generator
Generates a PNG image for a single game's betting splits.

Usage:
  python3 generate_splits_image.py '<json_data>' <output_path>
"""

import sys
import json
import os
import io
import urllib.request
from PIL import Image, ImageDraw, ImageFont

try:
    import cairosvg
    HAS_CAIROSVG = True
except ImportError:
    HAS_CAIROSVG = False

# ── Constants ─────────────────────────────────────────────────────────────────
FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
FONT_BOLD = os.path.join(FONT_DIR, "Barlow-Bold.ttf")
FONT_SEMI = os.path.join(FONT_DIR, "Barlow-SemiBold.ttf")
FONT_REG  = os.path.join(FONT_DIR, "Barlow-Regular.ttf")

W   = 1100
PAD = 36

BG_DARK   = (12, 14, 20)
BG_CARD   = (20, 24, 32)
BG_HEADER = (30, 34, 44)
BG_BAR_EMPTY = (38, 44, 58)
WHITE     = (255, 255, 255)
GRAY_L    = (160, 170, 195)
GRAY_D    = (80, 90, 110)

SECTION_COLORS = {
    "SPREAD":    (255, 196, 0),
    "TOTAL":     (60, 200, 110),
    "MONEYLINE": (99, 160, 255),
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def hex_to_rgb(h: str) -> tuple:
    h = (h or "").lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    try:
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        return (80, 80, 80)

def darken(rgb, f=0.35):
    return tuple(max(0, int(c * f)) for c in rgb)

def brighten(rgb, f=1.4):
    return tuple(min(255, int(c * f)) for c in rgb)

def luminance(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    return 0.299 * r + 0.587 * g + 0.114 * b

def readable_on(bg_rgb):
    """Return white or near-white text color that reads well on bg_rgb."""
    return WHITE

def tw(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def th(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[3] - bb[1]

def draw_rr(draw, xy, r, fill=None, outline=None, ow=2):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=ow)

def fetch_logo(url: str, size: int) -> Image.Image | None:
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = resp.read()
        if url.lower().endswith(".svg") or b"<svg" in data[:200]:
            if HAS_CAIROSVG:
                png_data = cairosvg.svg2png(bytestring=data,
                                             output_width=size, output_height=size)
                img = Image.open(io.BytesIO(png_data)).convert("RGBA")
            else:
                return None
        else:
            img = Image.open(io.BytesIO(data)).convert("RGBA")
        img = img.resize((size, size), Image.LANCZOS)
        return img
    except Exception as e:
        print(f"[logo] failed {url}: {e}", file=sys.stderr)
        return None

# ── Bar renderer ──────────────────────────────────────────────────────────────
def draw_split_bar(draw, x, y, bar_w, bar_h,
                   left_pct, right_pct,
                   left_color, right_color,
                   font_pct):
    """
    Draw a two-tone split bar with percentage labels.
    Labels are always placed OUTSIDE the bar when the segment is too narrow.
    """
    r = bar_h // 2
    lp = max(0, min(100, left_pct if left_pct is not None else 50))
    rp = 100 - lp
    left_w  = int(bar_w * lp / 100)
    right_w = bar_w - left_w

    lp_str = f"{lp}%"
    rp_str = f"{rp}%"
    lbl_w_l = tw(draw, lp_str, font_pct)
    lbl_w_r = tw(draw, rp_str, font_pct)
    lbl_h   = th(draw, lp_str, font_pct)
    lbl_y   = y + (bar_h - lbl_h) // 2 - 1

    INSIDE_MIN = lbl_w_l + 16   # min segment width to show label inside

    # ── Draw background pill ──────────────────────────────────────────────────
    draw_rr(draw, [x, y, x + bar_w, y + bar_h], r, fill=BG_BAR_EMPTY)

    # ── Draw left segment ─────────────────────────────────────────────────────
    if left_w > 0:
        if left_w >= bar_w:
            draw_rr(draw, [x, y, x + bar_w, y + bar_h], r, fill=left_color)
        else:
            # Left-rounded pill clipped to left_w
            draw_rr(draw, [x, y, x + left_w + r, y + bar_h], r, fill=left_color)
            # Clip the right overhang
            draw.rectangle([x + left_w, y, x + left_w + r, y + bar_h], fill=BG_BAR_EMPTY)

    # ── Draw right segment ────────────────────────────────────────────────────
    if right_w > 0:
        if right_w >= bar_w:
            draw_rr(draw, [x, y, x + bar_w, y + bar_h], r, fill=right_color)
        else:
            draw_rr(draw, [x + left_w - r, y, x + bar_w, y + bar_h], r, fill=right_color)
            draw.rectangle([x + left_w - r, y, x + left_w, y + bar_h], fill=left_color if left_w > 0 else BG_BAR_EMPTY)

    # ── Divider ───────────────────────────────────────────────────────────────
    if 0 < left_w < bar_w:
        draw.rectangle([x + left_w - 1, y + 2, x + left_w + 1, y + bar_h - 2],
                       fill=BG_DARK)

    # ── Labels ────────────────────────────────────────────────────────────────
    # Left label
    if left_w >= INSIDE_MIN:
        draw.text((x + 10, lbl_y), lp_str, font=font_pct, fill=WHITE,
                  stroke_width=1, stroke_fill=(0, 0, 0))
    else:
        # Outside left (before bar)
        ox = x - lbl_w_l - 6
        if ox < 0:
            ox = x + 4
        draw.text((ox, lbl_y), lp_str, font=font_pct, fill=brighten(left_color))

    # Right label
    if right_w >= lbl_w_r + 16:
        draw.text((x + bar_w - lbl_w_r - 10, lbl_y), rp_str, font=font_pct, fill=WHITE,
                  stroke_width=1, stroke_fill=(0, 0, 0))
    else:
        # Outside right (after bar)
        draw.text((x + bar_w + 6, lbl_y), rp_str, font=font_pct, fill=brighten(right_color))

# ── Section renderer ──────────────────────────────────────────────────────────
def draw_section(draw, x, y, sec_w, title, accent,
                 r1_lbl, r1_left, r1_right,
                 r2_lbl, r2_left, r2_right,
                 left_name, right_name,
                 left_color, right_color, fonts):
    f_title = fonts["title"]
    f_lbl   = fonts["label"]
    f_pct   = fonts["pct"]
    f_name  = fonts["name"]

    hdr_h  = 44
    name_h = 18
    bar_h  = 32
    gap    = 12

    # Header tab
    draw_rr(draw, [x, y, x + sec_w, y + hdr_h], 8,
            fill=BG_HEADER, outline=accent, ow=2)
    t_w = tw(draw, title, f_title)
    t_h = th(draw, title, f_title)
    draw.text((x + (sec_w - t_w) // 2, y + (hdr_h - t_h) // 2), title,
              font=f_title, fill=accent)

    cy = y + hdr_h + 12

    for row_lbl, lp, rp in [(r1_lbl, r1_left, r1_right), (r2_lbl, r2_left, r2_right)]:
        lp_val = lp if lp is not None else 50
        rp_val = rp if rp is not None else 50

        # Name row
        ln_w  = tw(draw, left_name, f_name)
        rn_w  = tw(draw, right_name, f_name)
        lbl_w = tw(draw, row_lbl, f_lbl)

        draw.text((x, cy), left_name, font=f_name, fill=brighten(left_color))
        draw.text((x + (sec_w - lbl_w) // 2, cy), row_lbl, font=f_lbl, fill=GRAY_L)
        draw.text((x + sec_w - rn_w, cy), right_name, font=f_name, fill=brighten(right_color))

        cy += name_h + 3

        draw_split_bar(draw, x, cy, sec_w, bar_h,
                       lp_val, rp_val,
                       left_color, right_color, f_pct)

        cy += bar_h + gap

    return cy - y

# ── Main card renderer ────────────────────────────────────────────────────────
def render_card(data: dict, output_path: str):
    away_team   = data["away_team"]
    home_team   = data["home_team"]
    away_abbr   = data.get("away_abbr", away_team[:3].upper())
    home_abbr   = data.get("home_abbr", home_team[:3].upper())
    away_color  = hex_to_rgb(data.get("away_color") or "#1D428A")
    home_color  = hex_to_rgb(data.get("home_color") or "#C8102E")
    away_color2 = hex_to_rgb(data.get("away_color2") or "#FFFFFF")
    home_color2 = hex_to_rgb(data.get("home_color2") or "#FFFFFF")
    league      = data.get("league", "NBA")
    game_date   = data.get("game_date", "")
    start_time  = data.get("start_time", "")

    spread    = data.get("spread", {})
    total     = data.get("total", {})
    moneyline = data.get("moneyline", {})

    # Fonts
    fonts = {
        "matchup": load_font(FONT_BOLD, 30),
        "title":   load_font(FONT_BOLD, 18),
        "label":   load_font(FONT_SEMI, 13),
        "pct":     load_font(FONT_BOLD, 17),
        "name":    load_font(FONT_SEMI, 13),
        "footer":  load_font(FONT_REG, 13),
    }

    # Layout
    inner_w     = W - PAD * 2
    section_gap = 18
    section_w   = (inner_w - section_gap * 2) // 3

    logo_size   = 84
    logo_pad    = 8
    logo_total  = logo_size + logo_pad * 2

    # Estimate card height
    hdr_h    = logo_total + 20
    sec_h    = 44 + (18 + 3 + 32 + 12) * 2 + 12   # ≈ 208
    footer_h = 32
    H        = 14 + hdr_h + 16 + sec_h + footer_h + 20

    img  = Image.new("RGBA", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Card background
    draw_rr(draw, [0, 0, W, H], 16, fill=BG_CARD)

    # Top gradient stripe
    stripe_h = 6
    for px in range(W):
        t = px / W
        r = int(away_color[0]*(1-t) + home_color[0]*t)
        g = int(away_color[1]*(1-t) + home_color[1]*t)
        b = int(away_color[2]*(1-t) + home_color[2]*t)
        draw.line([(px, 0), (px, stripe_h-1)], fill=(r, g, b))

    # ── Header ────────────────────────────────────────────────────────────────
    hdr_y = stripe_h + 12

    away_logo = fetch_logo(data.get("away_logo", ""), logo_size)
    home_logo = fetch_logo(data.get("home_logo", ""), logo_size)

    # Away logo — left
    logo_y = hdr_y + 4
    if away_logo:
        cx1, cy1 = PAD, logo_y
        cx2, cy2 = PAD + logo_total, logo_y + logo_total
        draw.ellipse([cx1, cy1, cx2, cy2], fill=darken(away_color, 0.3))
        img.paste(away_logo, (cx1 + logo_pad, cy1 + logo_pad), away_logo)

    # Home logo — right
    if home_logo:
        cx1, cy1 = W - PAD - logo_total, logo_y
        cx2, cy2 = W - PAD, logo_y + logo_total
        draw.ellipse([cx1, cy1, cx2, cy2], fill=darken(home_color, 0.3))
        img.paste(home_logo, (cx1 + logo_pad, cy1 + logo_pad), home_logo)

    # Matchup text — centered between logos
    f_m = fonts["matchup"]
    logo_right_edge = PAD + logo_total + 12
    logo_left_edge  = W - PAD - logo_total - 12
    text_zone_w = logo_left_edge - logo_right_edge

    # Build matchup parts
    at = away_team
    vs = "  @  "
    ht = home_team
    at_w = tw(draw, at, f_m)
    vs_w = tw(draw, vs, f_m)
    ht_w = tw(draw, ht, f_m)
    total_mw = at_w + vs_w + ht_w

    mx = logo_right_edge + max(0, (text_zone_w - total_mw) // 2)
    my = logo_y + (logo_total - th(draw, at, f_m)) // 2

    # Away team name — use secondary color for readability
    away_text_color = brighten(away_color2) if luminance(away_color2) > 0.3 else brighten(away_color)
    home_text_color = brighten(home_color2) if luminance(home_color2) > 0.3 else brighten(home_color)

    draw.text((mx, my), at, font=f_m, fill=away_text_color,
              stroke_width=2, stroke_fill=BG_DARK)
    draw.text((mx + at_w, my), vs, font=f_m, fill=GRAY_D,
              stroke_width=1, stroke_fill=BG_DARK)
    draw.text((mx + at_w + vs_w, my), ht, font=f_m, fill=home_text_color,
              stroke_width=2, stroke_fill=BG_DARK)

    # Divider
    div_y = hdr_y + logo_total + 14
    draw.line([(PAD, div_y), (W - PAD, div_y)], fill=(40, 46, 60), width=1)

    # ── Sections ──────────────────────────────────────────────────────────────
    sec_y = div_y + 14

    sections = [
        {
            "title": "SPREAD",
            "accent": SECTION_COLORS["SPREAD"],
            "r1_lbl": "TICKETS",
            "r1_left":  spread.get("away_ticket_pct"),
            "r1_right": spread.get("home_ticket_pct"),
            "r2_lbl": "MONEY",
            "r2_left":  spread.get("away_money_pct"),
            "r2_right": spread.get("home_money_pct"),
            "left_name":  away_abbr,
            "right_name": home_abbr,
            "left_color": away_color,
            "right_color": home_color,
        },
        {
            "title": "TOTAL",
            "accent": SECTION_COLORS["TOTAL"],
            "r1_lbl": "TICKETS",
            "r1_left":  total.get("over_ticket_pct"),
            "r1_right": total.get("under_ticket_pct"),
            "r2_lbl": "MONEY",
            "r2_left":  total.get("over_money_pct"),
            "r2_right": total.get("under_money_pct"),
            "left_name":  "OVER",
            "right_name": "UNDER",
            "left_color": (55, 185, 95),
            "right_color": (200, 65, 65),
        },
        {
            "title": "MONEYLINE",
            "accent": SECTION_COLORS["MONEYLINE"],
            "r1_lbl": "TICKETS",
            "r1_left":  moneyline.get("away_ticket_pct"),
            "r1_right": moneyline.get("home_ticket_pct"),
            "r2_lbl": "MONEY",
            "r2_left":  moneyline.get("away_money_pct"),
            "r2_right": moneyline.get("home_money_pct"),
            "left_name":  away_abbr,
            "right_name": home_abbr,
            "left_color": away_color,
            "right_color": home_color,
        },
    ]

    max_sec_h = 0
    for i, sec in enumerate(sections):
        sx = PAD + i * (section_w + section_gap)
        h = draw_section(
            draw, sx, sec_y, section_w,
            sec["title"], sec["accent"],
            sec["r1_lbl"], sec["r1_left"], sec["r1_right"],
            sec["r2_lbl"], sec["r2_left"], sec["r2_right"],
            sec["left_name"], sec["right_name"],
            sec["left_color"], sec["right_color"],
            fonts,
        )
        max_sec_h = max(max_sec_h, h)

    # ── Footer ────────────────────────────────────────────────────────────────
    footer_y = sec_y + max_sec_h + 12
    footer_text = f"{league}  ·  Daily Betting Splits  ·  {game_date}  ·  {start_time}"
    ft_w = tw(draw, footer_text, fonts["footer"])
    draw.text(((W - ft_w) // 2, footer_y), footer_text,
              font=fonts["footer"], fill=GRAY_D)

    # Crop to content
    final_h = footer_y + 26
    img = img.crop((0, 0, W, final_h))

    # Save as RGB PNG
    out = Image.new("RGB", img.size, BG_DARK)
    if img.mode == "RGBA":
        out.paste(img, mask=img.split()[3])
    else:
        out.paste(img)
    out.save(output_path, "PNG", optimize=True)
    print(f"OK:{output_path}:{out.size[0]}x{out.size[1]}")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: generate_splits_image.py '<json>' <output.png>", file=sys.stderr)
        sys.exit(1)
    data = json.loads(sys.argv[1])
    render_card(data, sys.argv[2])

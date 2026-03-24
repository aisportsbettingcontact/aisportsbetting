#!/usr/bin/env python3
"""
Splits Card Image Generator — mirrors the frontend feed design exactly.

Color picking logic is ported from GameCard.tsx:
  - isUnusable: skip if luminance < 0.04 or > 0.90
  - tooSimilar: skip if Euclidean RGB distance < 60
  - pickColor: try primary → secondary → tertiary → fallback
  - awayColor: also skip if too similar to homeColor

Usage:
  python3 generate_splits_image.py '<json_data>' <output_path>

Deep logging: set env var SPLITS_DEBUG=1 for verbose output.
"""

import sys
import json
import os
import io
import math
import time
import urllib.request
from PIL import Image, ImageDraw, ImageFont

DEBUG = os.environ.get("SPLITS_DEBUG", "0") == "1"

def log(msg, level="INFO"):
    if DEBUG or level in ("ERROR", "WARN"):
        ts = time.strftime("%H:%M:%S")
        print(f"[{ts}][{level}] {msg}", file=sys.stderr)

try:
    import cairosvg
    HAS_CAIROSVG = True
    log("cairosvg available — SVG logos enabled")
except ImportError:
    HAS_CAIROSVG = False
    log("cairosvg NOT available — SVG logos will be skipped", "WARN")

# ── Font paths ────────────────────────────────────────────────────────────────
FONT_DIR  = os.path.join(os.path.dirname(__file__), "fonts")
FONT_BOLD = os.path.join(FONT_DIR, "Barlow-Bold.ttf")
FONT_SEMI = os.path.join(FONT_DIR, "Barlow-SemiBold.ttf")
FONT_REG  = os.path.join(FONT_DIR, "Barlow-Regular.ttf")

for fp in [FONT_BOLD, FONT_SEMI, FONT_REG]:
    if os.path.exists(fp):
        log(f"Font OK: {os.path.basename(fp)}")
    else:
        log(f"Font MISSING: {fp}", "WARN")

# ── Palette ───────────────────────────────────────────────────────────────────
BG_DARK       = (12, 14, 20)
BG_CARD       = (20, 24, 32)
BG_HEADER     = (28, 32, 42)
BG_BAR_EMPTY  = (38, 44, 58)
WHITE         = (255, 255, 255)
GRAY_L        = (160, 170, 195)   # TICKETS / MONEY label
GRAY_D        = (75, 85, 105)     # footer / "@"
OVER_COLOR    = (55, 185, 95)
UNDER_COLOR   = (200, 65, 65)

FALLBACK_AWAY = (26, 74, 138)     # #1a4a8a
FALLBACK_HOME = (200, 75, 12)     # #c84b0c

W   = 1100
PAD = 32

# ── Color helpers (exact port of GameCard.tsx logic) ─────────────────────────
def hex_to_rgb(h):
    if not h:
        return None
    h = h.lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    if len(h) != 6:
        return None
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return None

def luminance(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def is_unusable(rgb):
    """True if too dark (lum < 0.04) or too light (lum > 0.90)."""
    if rgb is None:
        return True
    lum = luminance(rgb)
    return lum < 0.04 or lum > 0.90

def too_similar(rgb_a, rgb_b):
    """True if Euclidean RGB distance < 60."""
    if rgb_a is None or rgb_b is None:
        return False
    dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb_a, rgb_b)))
    return dist < 60

def pick_color(p, s, t, fallback, label="?"):
    """Try primary → secondary → tertiary → fallback, skip unusable."""
    candidates = [("primary", p), ("secondary", s), ("tertiary", t)]
    for name, c in candidates:
        if c is None:
            log(f"  [{label}] {name}: None — skip")
            continue
        lum = luminance(c)
        if is_unusable(c):
            log(f"  [{label}] {name}: rgb{c} lum={lum:.3f} — UNUSABLE (too dark/light)")
            continue
        log(f"  [{label}] {name}: rgb{c} lum={lum:.3f} — SELECTED")
        return c
    log(f"  [{label}] all unusable — using FALLBACK rgb{fallback}", "WARN")
    return fallback

def resolve_away_color(primary_hex, secondary_hex, tertiary_hex, home_color, label="away"):
    """
    Resolve away team display color — same as GameCard.tsx awayColor logic.
    Also skips colors too similar to homeColor.
    """
    p = hex_to_rgb(primary_hex)
    s = hex_to_rgb(secondary_hex)
    t = hex_to_rgb(tertiary_hex)
    candidates = [("primary", p), ("secondary", s), ("tertiary", t)]
    for name, c in candidates:
        if c is None:
            log(f"  [{label}] {name}: None — skip")
            continue
        lum = luminance(c)
        if is_unusable(c):
            log(f"  [{label}] {name}: rgb{c} lum={lum:.3f} — UNUSABLE")
            continue
        if too_similar(c, home_color):
            dist = math.sqrt(sum((a - b)**2 for a, b in zip(c, home_color)))
            log(f"  [{label}] {name}: rgb{c} — TOO SIMILAR to home rgb{home_color} (dist={dist:.1f})")
            continue
        log(f"  [{label}] {name}: rgb{c} lum={lum:.3f} — SELECTED")
        return c
    log(f"  [{label}] all unusable/similar — using FALLBACK rgb{FALLBACK_AWAY}", "WARN")
    return FALLBACK_AWAY

def darken(rgb, f=0.28):
    return tuple(max(0, int(c * f)) for c in rgb)

# ── Font / draw helpers ───────────────────────────────────────────────────────
def load_font(path, size):
    try:
        font = ImageFont.truetype(path, size)
        log(f"Loaded font {os.path.basename(path)} @ {size}px")
        return font
    except Exception as e:
        log(f"Font load failed {path} @ {size}: {e}", "WARN")
        return ImageFont.load_default()

def tw(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def th(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[3] - bb[1]

def draw_rr(draw, xy, r, fill=None, outline=None, ow=2):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=ow)

def fetch_logo(url, size, team_name="?"):
    if not url:
        log(f"  [logo:{team_name}] No URL provided", "WARN")
        return None
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = resp.read()
        elapsed = time.time() - t0
        log(f"  [logo:{team_name}] Fetched {len(data)} bytes in {elapsed:.2f}s from {url}")

        if url.lower().endswith(".svg") or b"<svg" in data[:200]:
            if HAS_CAIROSVG:
                png_data = cairosvg.svg2png(bytestring=data,
                                             output_width=size, output_height=size)
                img = Image.open(io.BytesIO(png_data)).convert("RGBA")
                log(f"  [logo:{team_name}] SVG→PNG converted, size={img.size}")
            else:
                log(f"  [logo:{team_name}] SVG detected but cairosvg unavailable — skipping", "WARN")
                return None
        else:
            img = Image.open(io.BytesIO(data)).convert("RGBA")
            log(f"  [logo:{team_name}] Raster image loaded, size={img.size}")

        return img.resize((size, size), Image.LANCZOS)
    except Exception as e:
        log(f"  [logo:{team_name}] FAILED: {e}", "ERROR")
        return None

# ── Bar renderer ──────────────────────────────────────────────────────────────
def draw_split_bar(draw, x, y, bar_w, bar_h,
                   lp, rp, left_color, right_color, font_pct,
                   bar_label="?"):
    """
    Two-tone pill bar. Labels always white with black stroke.
    When a segment is too narrow, the label is placed above the bar edge.
    """
    r = bar_h // 2
    lp = max(0, min(100, lp if lp is not None else 50))
    rp = 100 - lp
    left_w  = int(bar_w * lp / 100)
    right_w = bar_w - left_w

    lp_str  = f"{lp}%"
    rp_str  = f"{rp}%"
    lbl_w_l = tw(draw, lp_str, font_pct)
    lbl_w_r = tw(draw, rp_str, font_pct)
    lbl_h   = th(draw, lp_str, font_pct)
    lbl_y   = y + (bar_h - lbl_h) // 2 - 1

    INSIDE_MIN = lbl_w_l + 18

    log(f"  [bar:{bar_label}] lp={lp}% rp={rp}% left_w={left_w}px right_w={right_w}px "
        f"bar_w={bar_w}px inside_min={INSIDE_MIN}px")

    # Background pill
    draw_rr(draw, [x, y, x + bar_w, y + bar_h], r, fill=BG_BAR_EMPTY)

    # Left segment
    if left_w > 0:
        if left_w >= bar_w:
            draw_rr(draw, [x, y, x + bar_w, y + bar_h], r, fill=left_color)
        else:
            draw_rr(draw, [x, y, x + left_w + r, y + bar_h], r, fill=left_color)
            draw.rectangle([x + left_w, y, x + left_w + r, y + bar_h], fill=BG_BAR_EMPTY)

    # Right segment
    if right_w > 0:
        if right_w >= bar_w:
            draw_rr(draw, [x, y, x + bar_w, y + bar_h], r, fill=right_color)
        else:
            draw_rr(draw, [x + left_w - r, y, x + bar_w, y + bar_h], r, fill=right_color)
            if left_w > 0:
                draw.rectangle([x + left_w - r, y, x + left_w, y + bar_h], fill=left_color)

    # Divider
    if 0 < left_w < bar_w:
        draw.rectangle([x + left_w - 1, y + 2, x + left_w + 1, y + bar_h - 2],
                       fill=BG_DARK)

    # Left label — inside if there's room, otherwise above-left corner of bar
    if left_w >= INSIDE_MIN:
        draw.text((x + 10, lbl_y), lp_str, font=font_pct, fill=WHITE,
                  stroke_width=1, stroke_fill=(0, 0, 0))
        log(f"  [bar:{bar_label}] left label INSIDE at x={x+10}")
    else:
        above_y = y - lbl_h - 3
        draw.text((x, above_y), lp_str, font=font_pct, fill=WHITE,
                  stroke_width=1, stroke_fill=(0, 0, 0))
        log(f"  [bar:{bar_label}] left label ABOVE at y={above_y}")

    # Right label — inside if there's room, otherwise above-right corner of bar
    if right_w >= lbl_w_r + 18:
        draw.text((x + bar_w - lbl_w_r - 10, lbl_y), rp_str, font=font_pct, fill=WHITE,
                  stroke_width=1, stroke_fill=(0, 0, 0))
        log(f"  [bar:{bar_label}] right label INSIDE at x={x+bar_w-lbl_w_r-10}")
    else:
        above_y = y - lbl_h - 3
        draw.text((x + bar_w - lbl_w_r, above_y), rp_str, font=font_pct, fill=WHITE,
                  stroke_width=1, stroke_fill=(0, 0, 0))
        log(f"  [bar:{bar_label}] right label ABOVE at y={above_y}")

# ── Section renderer ──────────────────────────────────────────────────────────
def draw_section(draw, x, y, sec_w, title,
                 r1_lbl, r1_left, r1_right,
                 r2_lbl, r2_left, r2_right,
                 left_name, right_name,
                 left_color, right_color, fonts):
    f_title = fonts["title"]
    f_lbl   = fonts["label"]
    f_pct   = fonts["pct"]
    f_name  = fonts["name"]

    title_h = th(draw, title, f_title)
    hdr_h   = title_h + 10       # 5px top + 5px bottom — tight

    name_h  = th(draw, left_name, f_name)
    bar_h   = 32
    # Spacing: name row → 3px → bar → 8px → next name row → 3px → bar → done
    row_gap = 8

    log(f"[section:{title}] x={x} y={y} sec_w={sec_w} hdr_h={hdr_h}")
    log(f"[section:{title}] r1: {r1_lbl} left={r1_left} right={r1_right}")
    log(f"[section:{title}] r2: {r2_lbl} left={r2_left} right={r2_right}")

    # Tab — plain background, NO border/outline, white text
    draw_rr(draw, [x, y, x + sec_w, y + hdr_h], 5, fill=BG_HEADER)
    t_w = tw(draw, title, f_title)
    draw.text((x + (sec_w - t_w) // 2, y + 5), title,
              font=f_title, fill=WHITE)

    cy = y + hdr_h + 8   # 8px gap between tab and first name row

    for row_lbl, lp, rp in [(r1_lbl, r1_left, r1_right),
                              (r2_lbl, r2_left, r2_right)]:
        lp_val = lp if lp is not None else 50

        # Name row
        rn_w  = tw(draw, right_name, f_name)
        lbl_w = tw(draw, row_lbl, f_lbl)

        draw.text((x, cy), left_name, font=f_name, fill=WHITE)
        draw.text((x + (sec_w - lbl_w) // 2, cy), row_lbl,
                  font=f_lbl, fill=GRAY_L)
        draw.text((x + sec_w - rn_w, cy), right_name, font=f_name, fill=WHITE)

        cy += name_h + 3   # tight: 3px between name and bar

        draw_split_bar(draw, x, cy, sec_w, bar_h,
                       lp_val, 100 - lp_val,
                       left_color, right_color, f_pct,
                       bar_label=f"{title}/{row_lbl}")

        cy += bar_h + row_gap   # 8px between bar and next name row

    # Remove trailing gap
    cy -= row_gap

    log(f"[section:{title}] total height used = {cy - y}px")
    return cy - y

# ── Main card renderer ────────────────────────────────────────────────────────
def render_card(data, output_path):
    t_start = time.time()

    away_team  = data["away_team"]
    home_team  = data["home_team"]
    away_abbr  = data.get("away_abbr", away_team[:3].upper())
    home_abbr  = data.get("home_abbr", home_team[:3].upper())
    league     = data.get("league",    "NBA")
    game_date  = data.get("game_date", "")
    start_time = data.get("start_time", "")

    spread    = data.get("spread",    {})
    total     = data.get("total",     {})
    moneyline = data.get("moneyline", {})

    log(f"=== render_card START: {away_team} @ {home_team} ===")
    log(f"  league={league}  date={game_date}  time={start_time}")
    log(f"  away_abbr={away_abbr}  home_abbr={home_abbr}")
    log(f"  colors: away=({data.get('away_color')},{data.get('away_color2')},{data.get('away_color3')})")
    log(f"  colors: home=({data.get('home_color')},{data.get('home_color2')},{data.get('home_color3')})")
    log(f"  spread:    {spread}")
    log(f"  total:     {total}")
    log(f"  moneyline: {moneyline}")

    # Validate splits data completeness
    for section_name, section in [("spread", spread), ("total", total), ("moneyline", moneyline)]:
        for key, val in section.items():
            if val is None:
                log(f"  [data] {section_name}.{key} = None — will show 50/50", "WARN")

    # ── Resolve colors using exact frontend pickColor logic ───────────────────
    log("--- Color resolution ---")
    home_color = pick_color(
        hex_to_rgb(data.get("home_color")),
        hex_to_rgb(data.get("home_color2")),
        hex_to_rgb(data.get("home_color3")),
        FALLBACK_HOME,
        label=f"home/{home_abbr}",
    )
    away_color = resolve_away_color(
        data.get("away_color"),
        data.get("away_color2"),
        data.get("away_color3"),
        home_color,
        label=f"away/{away_abbr}",
    )
    log(f"  FINAL away_color=rgb{away_color}  home_color=rgb{home_color}")

    fonts = {
        "matchup": load_font(FONT_BOLD, 30),
        "title":   load_font(FONT_BOLD, 15),
        "label":   load_font(FONT_SEMI, 12),
        "pct":     load_font(FONT_BOLD, 17),
        "name":    load_font(FONT_SEMI, 12),
        "footer":  load_font(FONT_REG,  12),
    }

    # Layout constants
    inner_w     = W - PAD * 2
    section_gap = 14
    section_w   = (inner_w - section_gap * 2) // 3

    logo_size  = 84
    logo_pad   = 8
    logo_total = logo_size + logo_pad * 2

    log(f"--- Layout: inner_w={inner_w} section_w={section_w} section_gap={section_gap} ---")

    # Measure section height on a dummy canvas
    _dummy_img  = Image.new("RGB", (1, 1))
    _dummy_draw = ImageDraw.Draw(_dummy_img)
    title_h = th(_dummy_draw, "SPREAD", fonts["title"])
    hdr_h   = title_h + 10
    name_h  = th(_dummy_draw, "GSW", fonts["name"])
    bar_h   = 32
    row_gap = 8
    # 2 rows: (name_h + 3 + bar_h + row_gap) * 2 - row_gap
    sec_h   = hdr_h + 8 + (name_h + 3 + bar_h + row_gap) * 2 - row_gap

    header_h = logo_total + 20
    footer_h = 28
    H = 14 + header_h + 14 + sec_h + footer_h + 18

    log(f"--- Canvas: W={W} H={H} header_h={header_h} sec_h={sec_h} ---")

    img  = Image.new("RGBA", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Card background
    draw_rr(draw, [0, 0, W, H], 16, fill=BG_CARD)

    # Top gradient stripe (5px)
    for px in range(W):
        t = px / W
        r = int(away_color[0]*(1-t) + home_color[0]*t)
        g = int(away_color[1]*(1-t) + home_color[1]*t)
        b = int(away_color[2]*(1-t) + home_color[2]*t)
        draw.line([(px, 0), (px, 5)], fill=(r, g, b))

    # ── Header ────────────────────────────────────────────────────────────────
    hdr_y  = 6 + 12
    logo_y = hdr_y + 4

    log("--- Fetching logos ---")
    away_logo = fetch_logo(data.get("away_logo", ""), logo_size, team_name=away_abbr)
    home_logo = fetch_logo(data.get("home_logo", ""), logo_size, team_name=home_abbr)

    if away_logo:
        cx1, cy1 = PAD, logo_y
        draw.ellipse([cx1, cy1, cx1 + logo_total, cy1 + logo_total],
                     fill=darken(away_color))
        img.paste(away_logo, (cx1 + logo_pad, cy1 + logo_pad), away_logo)
        log(f"  [logo:{away_abbr}] pasted at ({cx1},{cy1})")
    else:
        log(f"  [logo:{away_abbr}] NOT rendered (fetch failed)", "WARN")

    if home_logo:
        cx1, cy1 = W - PAD - logo_total, logo_y
        draw.ellipse([cx1, cy1, cx1 + logo_total, cy1 + logo_total],
                     fill=darken(home_color))
        img.paste(home_logo, (cx1 + logo_pad, cy1 + logo_pad), home_logo)
        log(f"  [logo:{home_abbr}] pasted at ({cx1},{cy1})")
    else:
        log(f"  [logo:{home_abbr}] NOT rendered (fetch failed)", "WARN")

    # Matchup text — team names in their resolved display color
    f_m = fonts["matchup"]
    logo_right_edge = PAD + logo_total + 14
    logo_left_edge  = W - PAD - logo_total - 14
    text_zone_w     = logo_left_edge - logo_right_edge

    at_w = tw(draw, away_team, f_m)
    vs_w = tw(draw, "  @  ",   f_m)
    ht_w = tw(draw, home_team, f_m)
    total_mw = at_w + vs_w + ht_w

    mx = logo_right_edge + max(0, (text_zone_w - total_mw) // 2)
    my = logo_y + (logo_total - th(draw, away_team, f_m)) // 2

    log(f"  [matchup] text_zone_w={text_zone_w} total_mw={total_mw} mx={mx} my={my}")

    draw.text((mx, my), away_team, font=f_m, fill=away_color,
              stroke_width=2, stroke_fill=BG_DARK)
    draw.text((mx + at_w, my), "  @  ", font=f_m, fill=GRAY_D,
              stroke_width=1, stroke_fill=BG_DARK)
    draw.text((mx + at_w + vs_w, my), home_team, font=f_m, fill=home_color,
              stroke_width=2, stroke_fill=BG_DARK)

    # Divider
    div_y = hdr_y + logo_total + 14
    draw.line([(PAD, div_y), (W - PAD, div_y)], fill=(40, 46, 60), width=1)

    # ── Sections ──────────────────────────────────────────────────────────────
    sec_y = div_y + 14
    log(f"--- Sections start at y={sec_y} ---")

    sections = [
        {
            "title":      "SPREAD",
            "r1_lbl":     "TICKETS",
            "r1_left":    spread.get("away_ticket_pct"),
            "r1_right":   spread.get("home_ticket_pct"),
            "r2_lbl":     "MONEY",
            "r2_left":    spread.get("away_money_pct"),
            "r2_right":   spread.get("home_money_pct"),
            "left_name":  away_abbr,
            "right_name": home_abbr,
            "left_color": away_color,
            "right_color":home_color,
        },
        {
            "title":      "TOTAL",
            "r1_lbl":     "TICKETS",
            "r1_left":    total.get("over_ticket_pct"),
            "r1_right":   total.get("under_ticket_pct"),
            "r2_lbl":     "MONEY",
            "r2_left":    total.get("over_money_pct"),
            "r2_right":   total.get("under_money_pct"),
            "left_name":  "OVER",
            "right_name": "UNDER",
            "left_color": OVER_COLOR,
            "right_color":UNDER_COLOR,
        },
        {
            "title":      "MONEYLINE",
            "r1_lbl":     "TICKETS",
            "r1_left":    moneyline.get("away_ticket_pct"),
            "r1_right":   moneyline.get("home_ticket_pct"),
            "r2_lbl":     "MONEY",
            "r2_left":    moneyline.get("away_money_pct"),
            "r2_right":   moneyline.get("home_money_pct"),
            "left_name":  away_abbr,
            "right_name": home_abbr,
            "left_color": away_color,
            "right_color":home_color,
        },
    ]

    max_sec_h = 0
    for i, sec in enumerate(sections):
        sx = PAD + i * (section_w + section_gap)
        h  = draw_section(
            draw, sx, sec_y, section_w,
            sec["title"],
            sec["r1_lbl"], sec["r1_left"], sec["r1_right"],
            sec["r2_lbl"], sec["r2_left"], sec["r2_right"],
            sec["left_name"], sec["right_name"],
            sec["left_color"], sec["right_color"],
            fonts,
        )
        max_sec_h = max(max_sec_h, h)
        log(f"  [section:{sec['title']}] rendered at x={sx}, height={h}px")

    # ── Footer ────────────────────────────────────────────────────────────────
    footer_y    = sec_y + max_sec_h + 12
    footer_text = f"{league}  ·  Daily Betting Splits  ·  {game_date}  ·  {start_time}"
    ft_w = tw(draw, footer_text, fonts["footer"])
    draw.text(((W - ft_w) // 2, footer_y), footer_text,
              font=fonts["footer"], fill=GRAY_D)
    log(f"  [footer] y={footer_y} text='{footer_text}'")

    # Crop and save
    final_h = footer_y + 24
    img = img.crop((0, 0, W, final_h))
    log(f"  [output] cropped to {W}x{final_h}")

    out = Image.new("RGB", img.size, BG_DARK)
    if img.mode == "RGBA":
        out.paste(img, mask=img.split()[3])
    else:
        out.paste(img)
    out.save(output_path, "PNG", optimize=True)

    elapsed = time.time() - t_start
    file_kb = os.path.getsize(output_path) / 1024
    log(f"=== render_card DONE in {elapsed:.2f}s — {output_path} ({file_kb:.1f} KB) ===")
    print(f"OK:{output_path}:{out.size[0]}x{out.size[1]}")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: generate_splits_image.py '<json>' <output.png>", file=sys.stderr)
        sys.exit(1)
    render_card(json.loads(sys.argv[1]), sys.argv[2])

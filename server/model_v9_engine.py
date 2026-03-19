#!/usr/bin/env python3
"""
model_v9_engine.py — Headless NCAAM KenPom Origination Engine v9.0
====================================================================
Backend integration entry point.

Protocol:
  STDIN  → single JSON object (ModelGameInput)
  STDOUT → single JSON line (ModelGameResult) — LAST line of stdout

Input schema:
  {
    "away_team":     "Iowa St.",          # KenPom team name
    "home_team":     "Texas Tech",
    "conf_a":        "Big 12",            # ncaamTeams.conference value
    "conf_h":        "Big 12",
    "mkt_sp":        -5.5,                # away spread (negative = away favored)
    "mkt_to":        143.5,               # market total
    "mkt_ml_a":      -230,                # away ML (null if not posted)
    "mkt_ml_h":      190,                 # home ML (null if not posted)
    "kenpom_email":  "...",
    "kenpom_pass":   "..."
  }

Output schema (last line of stdout):
  {
    "ok": true,
    "game": "Iowa St. @ Texas Tech",
    "away_name": "Iowa St.", "home_name": "Texas Tech",
    "conf_a": "Big 12", "conf_h": "Big 12",
    "orig_away_score": 72.41, "orig_home_score": 70.09,
    "orig_away_sp": -2.32, "orig_home_sp": 2.32,
    "orig_total": 142.50,
    "raw_away_score": ..., "raw_home_score": ...,
    "raw_away_sp": ..., "raw_home_sp": ..., "raw_total": ...,
    "mkt_away_score": ..., "mkt_home_score": ..., "mkt_total": ...,
    "ml_away_pct": 55.12, "ml_home_pct": 44.88,
    "away_ml_fair": -122.80, "home_ml_fair": 122.80,
    "over_rate": 58.3, "under_rate": 41.7,
    "spread_clamped": false, "total_clamped": false,
    "cover_direction": "UNDER",
    "cover_adj": -0.42,
    "def_suppression": 0.9812,
    "sigma_away": 10.82, "sigma_home": 10.64,
    "edges": [...],
    "error": null
  }
"""

import sys
import json
import numpy as np
from scipy.stats import norm
import time

# ─────────────────────────────────────────────────────────────────────────────
# NATIONAL CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
NAT_OE    = 109.6
NAT_DE    = 109.6
NAT_TEMPO = 67.3
NAT_APLO  = 17.5

# ─────────────────────────────────────────────────────────────────────────────
# CONFERENCE CALIBRATION TABLE
# All 30 D-I conferences — avg DE and OE from KenPom efficiency table
# Updated: 2026-03-12 (season-to-date conference-only averages)
# Falls back to NAT_DE/NAT_OE if conference not found
# ─────────────────────────────────────────────────────────────────────────────
CONF_AVG_DE = {
    # Power conferences
    'ACC':           106.8,
    'Big 12':        107.2,
    'Big East':      106.5,
    'Big Ten':       108.1,
    'SEC':           107.4,
    # Mid-majors (tier 1)
    'American':      108.9,
    'Atlantic 10':   106.7,
    'Mountain West': 108.4,
    'WCC':           107.9,
    'MVC':           109.1,
    # Mid-majors (tier 2)
    'MAC':           111.7,
    'CUSA':          110.2,
    'Sun Belt':      110.8,
    'CAA':           109.6,
    'Horizon':       110.3,
    'Big West':      110.1,
    'MAAC':          110.5,
    'SoCon':         110.7,
    'Big Sky':       111.2,
    'ASUN':          110.4,
    'OVC':           111.0,
    'Summit League': 110.9,
    'Patriot':       110.6,
    'Big South':     111.1,
    'America East':  110.8,
    # Low-majors
    'NEC':           111.5,
    'SWAC':          112.3,
    'MEAC':          112.8,
    'Southland':     111.8,
    'Ivy League':    109.3,
    'WAC':           110.6,
}

CONF_AVG_OE = {
    'ACC':           113.2,
    'Big 12':        112.8,
    'Big East':      112.4,
    'Big Ten':       111.9,
    'SEC':           112.1,
    'American':      110.1,
    'Atlantic 10':   111.4,
    'Mountain West': 110.6,
    'WCC':           110.9,
    'MVC':           109.8,
    'MAC':           108.9,
    'CUSA':          108.7,
    'Sun Belt':      109.2,
    'CAA':           109.6,
    'Horizon':       109.4,
    'Big West':      109.1,
    'MAAC':          109.3,
    'SoCon':         109.0,
    'Big Sky':       108.6,
    'ASUN':          109.2,
    'OVC':           108.8,
    'Summit League': 108.9,
    'Patriot':       108.7,
    'Big South':     108.5,
    'America East':  108.6,
    'NEC':           108.2,
    'SWAC':          107.8,
    'MEAC':          107.4,
    'Southland':     108.1,
    'Ivy League':    110.2,
    'WAC':           109.0,
}

# ─────────────────────────────────────────────────────────────────────────────
# MODEL CONSTANTS (v9 — do not change without re-validation)
# ─────────────────────────────────────────────────────────────────────────────
TOURN_PACE          = 0.965   # 3.5% tournament pace discount
TOURN_REG_CONFPPG   = 0.91    # conf PPG × 0.91 (tournament regression)
TOURN_REG_KENPOM    = 0.94    # KenPom matchup × 0.94 (tournament regression)
DELTA_CAP_PER_TEAM  = 4.0     # max ±4.0pt delta per team per anchor
MARKET_WEIGHT_FLOOR = 0.55    # market always has ≥55% weight
COVER_TOTAL_WEIGHT  = 0.66    # cover/total correlation weight (user-specified)
MAX_COVER_ADJ       = 4.0     # max cover adjustment in points
SPREAD_BAND         = 5.0     # hardcoded band limit: spread ±5pt
TOTAL_BAND          = 7.0     # hardcoded band limit: total ±7pt
PACE_FASTER_W       = 0.45    # faster team wins pace battle 55% of the time
PACE_SLOWER_W       = 0.55
SPREAD_EDGE_THRESH  = 1.5     # minimum spread delta to flag an edge
TOTAL_EDGE_THRESH   = 3.0     # minimum total delta to flag an edge
REG_OE_DE           = 0.82    # regression weight for OE/DE toward national avg
REG_APLO            = 0.85    # regression weight for APLO toward national avg
N_SIMS              = 250_000

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def regress(val, weight, avg):
    return weight * val + (1.0 - weight) * avg

def clamp(val, lo, hi):
    return max(lo, min(hi, val))

def ot_adj(score, is_ot, ot_count=1):
    return score * (40.0 / (40.0 + 5.0 * ot_count)) if is_ot else score

def win_pct_to_fair_ml(pct):
    """Legacy: takes 0-100 percentage, returns float ML. Use prob_to_ml for new code."""
    pct = max(0.01, min(99.99, pct))
    if pct >= 50.0:
        return -(pct / (100.0 - pct)) * 100.0
    else:
        return +((100.0 - pct) / pct) * 100.0

def round_to_half(x: float) -> float:
    """Round to nearest 0.5. e.g. 1.8->2.0, 1.3->1.5, 0.24->0.0, 0.51->0.5, -1.8->-2.0"""
    return round(x * 2) / 2.0

def spread_display(x: float) -> str:
    """Format a spread value: 0.0 -> 'PK', positive -> '+X' or '+X.5', negative -> '-X' or '-X.5'"""
    r = round_to_half(x)
    if r == 0.0:
        return 'PK'
    if r == int(r):
        return f'+{int(r)}' if r > 0 else str(int(r))
    return f'+{r}' if r > 0 else str(r)

# ─────────────────────────────────────────────────────────────────────────────
# ODDS / PROBABILITY HELPERS  (NHL-identical framework)
# ─────────────────────────────────────────────────────────────────────────────

def prob_to_ml(p: float) -> int:
    """Convert win probability (0-1) to American moneyline integer.
    p >= 0.5 -> favorite (negative odds, e.g. -133)
    p <  0.5 -> underdog (positive odds, e.g. +133)
    """
    p = max(0.001, min(0.999, p))
    if p >= 0.5:
        return -int(round((p / (1.0 - p)) * 100))
    else:
        return int(round(((1.0 - p) / p) * 100))

def ml_to_prob(ml: int) -> float:
    """Convert American moneyline to raw implied win probability (no vig removal)."""
    if ml < 0:
        return abs(ml) / (abs(ml) + 100.0)
    else:
        return 100.0 / (ml + 100.0)

def remove_vig(prob_a: float, prob_b: float):
    """Remove vig: true_A = prob_A / (prob_A + prob_B)."""
    total = prob_a + prob_b
    if total <= 0:
        return 0.5, 0.5
    return prob_a / total, prob_b / total

def payout_from_odds(odds: int) -> float:
    """Payout per $1 wagered (not including stake)."""
    if odds < 0:
        return 100.0 / abs(odds)
    else:
        return odds / 100.0

def expected_value(probability: float, odds: int) -> float:
    """EV = p * payout - (1 - p). Naturally accounts for distribution variance."""
    payout = payout_from_odds(odds)
    return probability * payout - (1.0 - probability)

# ─────────────────────────────────────────────────────────────────────────────
# CONF PPG
# ─────────────────────────────────────────────────────────────────────────────

def compute_conf_ppg(rows):
    conf = [r for r in rows if r.get('is_conf') and r.get('result_final')]
    if not conf:
        return {'avg_ppg_scored': None, 'avg_ppg_allowed': None,
                'n_games': 0, 'n_ot_games': 0}
    sa, aa = [], []
    n_ot = 0
    for g in conf:
        rs, ra = g['team_score'], g['opp_score']
        is_ot, ot_ct = g.get('is_ot', False), g.get('ot_count', 1)
        sa.append(ot_adj(rs, is_ot, ot_ct))
        aa.append(ot_adj(ra, is_ot, ot_ct))
        if is_ot:
            n_ot += 1
    return {
        'avg_ppg_scored':  round(float(np.mean(sa)), 4),
        'avg_ppg_allowed': round(float(np.mean(aa)), 4),
        'n_games':         len(conf),
        'n_ot_games':      n_ot,
    }

def opponent_adjusted_ppg(raw_ppg, opp_DE, conf_avg_DE):
    """Adjust conf PPG for today's specific opponent defense vs conf avg DE."""
    return raw_ppg * (opp_DE / conf_avg_DE)

def parse_schedule_rows(df):
    rows = []
    for _, row in df.iterrows():
        rs = str(row.get('Result', ''))
        cs = str(row.get('Conference', ''))
        is_conf  = cs.strip() not in ('', 'nan', 'None')
        is_final = rs.startswith('W,') or rs.startswith('L,')
        is_ot    = 'OT' in rs and is_final
        ot_count = rs.count('OT') if is_ot else 0
        ts, os_ = None, None
        if is_final:
            try:
                sp = rs.split(',')[1].strip().replace('OT', '').strip()
                pts = sp.split('-')
                ts = float(pts[0].strip())
                os_ = float(pts[1].strip())
            except Exception:
                pass
        rows.append({
            'opponent':     str(row.get('Opponent', '')),
            'is_conf':      is_conf,
            'result_final': is_final,
            'is_ot':        is_ot,
            'ot_count':     ot_count,
            'team_score':   ts,
            'opp_score':    os_,
        })
    return rows

# ─────────────────────────────────────────────────────────────────────────────
# PACE
# ─────────────────────────────────────────────────────────────────────────────

def resolve_pace(aplo_a, aplo_h):
    if aplo_a <= aplo_h:  # A is faster
        return aplo_a * PACE_FASTER_W + aplo_h * PACE_SLOWER_W
    else:                 # H is faster
        return aplo_h * PACE_FASTER_W + aplo_a * PACE_SLOWER_W

def compute_possessions(aplo_a, aplo_h):
    eff_aplo = resolve_pace(aplo_a, aplo_h)
    raw = (40.0 * 60.0) / eff_aplo * TOURN_PACE
    return max(58.0, min(76.0, raw)), eff_aplo

# ─────────────────────────────────────────────────────────────────────────────
# MATCHUP PROJECTION (NEUTRAL SITE)
# ─────────────────────────────────────────────────────────────────────────────

def matchup_projection(sa, sh, poss, conf_a, conf_h):
    oe_a = regress(sa['OE'], REG_OE_DE, NAT_OE)
    de_a = regress(sa['DE'], REG_OE_DE, NAT_DE)
    oe_h = regress(sh['OE'], REG_OE_DE, NAT_OE)
    de_h = regress(sh['DE'], REG_OE_DE, NAT_DE)
    conf_de_a = CONF_AVG_DE.get(conf_a, NAT_DE)
    conf_de_h = CONF_AVG_DE.get(conf_h, NAT_DE)
    raw_score_a = (oe_a / 100.0) * (de_h / conf_de_h) * poss
    raw_score_h = (oe_h / 100.0) * (de_a / conf_de_a) * poss
    de_ratio_a = de_a / conf_de_a
    de_ratio_h = de_h / conf_de_h
    def_supp = (de_ratio_a + de_ratio_h) / 2.0
    adj_score_a = raw_score_a * def_supp
    adj_score_h = raw_score_h * def_supp
    return {
        'score_away':      round(adj_score_a, 4),
        'score_home':      round(adj_score_h, 4),
        'def_suppression': round(def_supp, 4),
        'de_ratio_a':      round(de_ratio_a, 4),
        'de_ratio_h':      round(de_ratio_h, 4),
        'poss':            round(poss, 4),
    }

# ─────────────────────────────────────────────────────────────────────────────
# DYNAMIC CONFIDENCE WEIGHTING
# ─────────────────────────────────────────────────────────────────────────────

def compute_dynamic_weights(cpg_a, cpg_h, sa, sh, mkt_sp):
    w1 = MARKET_WEIGHT_FLOOR
    w2 = 0.225
    w3 = 0.225
    min_n = min(cpg_a.get('n_games', 0), cpg_h.get('n_games', 0))
    if min_n < 8:
        w2 -= 0.07; w3 += 0.07
    elif min_n < 12:
        w2 -= 0.03; w3 += 0.03
    ot_total = cpg_a.get('n_ot_games', 0) + cpg_h.get('n_ot_games', 0)
    if ot_total > 3:
        w2 -= 0.03; w3 += 0.03
    elif ot_total > 1:
        w2 -= 0.01; w3 += 0.01
    eff_gap = (abs(sa['OE'] - sh['OE']) + abs(sa['DE'] - sh['DE'])) / 2.0
    if eff_gap > 12:
        w3 += 0.04; w2 -= 0.04
    elif eff_gap > 7:
        w3 += 0.02; w2 -= 0.02
    total = w1 + w2 + w3
    w1 = round(w1 / total, 4)
    w2 = round(w2 / total, 4)
    w3 = round(1.0 - w1 - w2, 4)
    return w1, w2, w3

# ─────────────────────────────────────────────────────────────────────────────
# DELTA-BASED SCORE BLENDING (CENTERED ON MARKET)
# ─────────────────────────────────────────────────────────────────────────────

def blend_scores_delta(mkt_sp, mkt_to, cpg_a, cpg_h, matchup, sa, sh, conf_a, conf_h):
    mkt_a = (mkt_to - mkt_sp) / 2.0
    mkt_h = (mkt_to + mkt_sp) / 2.0

    def disc(d):
        n = d.get('n_games', 0)
        return 1.0 - (d.get('n_ot_games', 0) / n * 0.05) if n > 0 else 1.0

    raw_cpg_a = cpg_a.get('avg_ppg_scored')
    raw_cpg_h = cpg_h.get('avg_ppg_scored')
    conf_de_a = CONF_AVG_DE.get(conf_a, NAT_DE)
    conf_de_h = CONF_AVG_DE.get(conf_h, NAT_DE)

    if raw_cpg_a:
        opp_adj_cpg_a = opponent_adjusted_ppg(raw_cpg_a * disc(cpg_a), sh['DE'], conf_de_a) * TOURN_REG_CONFPPG
    else:
        opp_adj_cpg_a = None

    if raw_cpg_h:
        opp_adj_cpg_h = opponent_adjusted_ppg(raw_cpg_h * disc(cpg_h), sa['DE'], conf_de_h) * TOURN_REG_CONFPPG
    else:
        opp_adj_cpg_h = None

    kp_a = matchup['score_away'] * TOURN_REG_KENPOM
    kp_h = matchup['score_home'] * TOURN_REG_KENPOM

    w1, w2, w3 = compute_dynamic_weights(cpg_a, cpg_h, sa, sh, mkt_sp)
    if opp_adj_cpg_a is None or opp_adj_cpg_h is None:
        w3 += w2; w2 = 0.0
        total = w1 + w3; w1 /= total; w3 /= total

    delta_cpg_a = clamp((opp_adj_cpg_a - mkt_a) if opp_adj_cpg_a else 0.0, -DELTA_CAP_PER_TEAM, DELTA_CAP_PER_TEAM)
    delta_cpg_h = clamp((opp_adj_cpg_h - mkt_h) if opp_adj_cpg_h else 0.0, -DELTA_CAP_PER_TEAM, DELTA_CAP_PER_TEAM)
    delta_kp_a  = clamp(kp_a - mkt_a, -DELTA_CAP_PER_TEAM, DELTA_CAP_PER_TEAM)
    delta_kp_h  = clamp(kp_h - mkt_h, -DELTA_CAP_PER_TEAM, DELTA_CAP_PER_TEAM)

    wdelta_a = w2 * delta_cpg_a + w3 * delta_kp_a
    wdelta_h = w2 * delta_cpg_h + w3 * delta_kp_h
    blended_a = mkt_a + wdelta_a
    blended_h = mkt_h + wdelta_h

    return {
        'away': round(blended_a, 4),
        'home': round(blended_h, 4),
        'spread': round(blended_h - blended_a, 4),
        'total':  round(blended_a + blended_h, 4),
        'mkt_a': round(mkt_a, 4), 'mkt_h': round(mkt_h, 4),
        'w1': w1, 'w2': w2, 'w3': w3,
    }

# ─────────────────────────────────────────────────────────────────────────────
# SIGMA BUILD
# ─────────────────────────────────────────────────────────────────────────────

def build_sigma(sc):
    base  = 10.5
    oe_d  = (sc['OE']    - NAT_OE)    / NAT_OE
    tmp_d = (sc['Tempo'] - NAT_TEMPO) / NAT_TEMPO
    apl_d = (NAT_APLO - sc['APLO'])   / NAT_APLO
    pri   = 1.0 + oe_d * 0.20 + tmp_d * 0.15 + apl_d * 0.15
    thr_d = (sc['3Pct']              - 34.0) / 34.0
    trt_d = (sc.get('3PARate', 39.5) - 39.5) / 39.5
    to_d  = (sc['TOPct']             - 17.0) / 17.0
    efg_d = abs(sc['eFG']            - 51.8) / 51.8
    sec   = 1.0 + thr_d * 0.08 + trt_d * 0.06 + to_d * 0.06 + efg_d * 0.05
    return max(8.0, min(14.5, base * pri * sec))

# ─────────────────────────────────────────────────────────────────────────────
# MONTE CARLO
# ─────────────────────────────────────────────────────────────────────────────

def monte_carlo(mean_a, mean_h, sa, sh, mkt_sp, mkt_to, n=N_SIMS):
    sig_a = build_sigma(sa)
    sig_h = build_sigma(sh)
    np.random.seed(42)
    scores_a = np.clip(np.random.normal(mean_a, sig_a, n), 40, 135)
    scores_h = np.clip(np.random.normal(mean_h, sig_h, n), 40, 135)
    margins  = scores_h - scores_a
    totals   = scores_a + scores_h

    sp_med  = float(np.median(margins))
    sp_std  = float(np.std(margins))
    to_mean = float(np.mean(totals))
    to_std  = float(np.std(totals))

    # ── Win/cover probabilities at BOOK's line (for edge detection vs market) ──
    hw_pct = float(np.mean(margins > 0)) * 100
    aw_pct = 100.0 - hw_pct
    hc_pct = float(np.mean(margins > mkt_sp)) * 100   # home covers book spread
    ac_pct = 100.0 - hc_pct                            # away covers book spread
    ov_pct = float(np.mean(totals > mkt_to)) * 100
    un_pct = 100.0 - ov_pct

    # ── Cover-direction total adjustment ──────────────────────────────────────
    BREAKEVEN = 52.38
    home_is_fav = mkt_sp > 0
    away_is_fav = mkt_sp < 0
    if home_is_fav:
        fav_cover = hc_pct; dog_cover = ac_pct
    elif away_is_fav:
        fav_cover = ac_pct; dog_cover = hc_pct
    else:
        fav_cover = 50.0; dog_cover = 50.0

    fav_edge = fav_cover - BREAKEVEN
    dog_edge = dog_cover - BREAKEVEN

    cover_adj = 0.0
    cover_dir = 'NONE'
    if fav_edge > 0:
        cover_adj = -(fav_edge / 47.62) * COVER_TOTAL_WEIGHT * MAX_COVER_ADJ
        cover_dir = 'UNDER'
    elif dog_edge > 0:
        cover_adj = +(dog_edge / 47.62) * COVER_TOTAL_WEIGHT * MAX_COVER_ADJ
        cover_dir = 'OVER'

    raw_sd = sp_med
    raw_td = to_mean + cover_adj

    sd_delta = raw_sd - mkt_sp
    td_delta = raw_td - mkt_to

    if abs(sd_delta) > SPREAD_BAND:
        clamped_sp = mkt_sp + np.sign(sd_delta) * SPREAD_BAND
        sp_cl = True
    else:
        clamped_sp = raw_sd
        sp_cl = False

    if abs(td_delta) > TOTAL_BAND:
        clamped_to = mkt_to + np.sign(td_delta) * TOTAL_BAND
        to_cl = True
    else:
        clamped_to = raw_td
        to_cl = False

    # ── Derived model lines: round clamped values to nearest 0.5 ──────────────
    # The model spread is in home-minus-away convention:
    #   positive clamped_sp = home is favored (home wins by that margin)
    #   negative clamped_sp = away is favored
    # We store the HOME perspective spread (positive = home fav)
    # The AWAY spread = same magnitude, opposite sign for display
    model_sp_rounded = round_to_half(clamped_sp)   # home-perspective, rounded
    model_to_rounded = round_to_half(clamped_to)   # total, rounded

    # ── Fair odds at the DERIVED (rounded) model lines ────────────────────────
    # Compute cover probability at the rounded line from the 250k distribution
    # home covers if margin > model_sp_rounded  (home-minus-away convention)
    # away covers if margin < model_sp_rounded
    # over  if total  > model_to_rounded
    # under if total  < model_to_rounded
    mdl_hc_at_line = float(np.mean(margins > model_sp_rounded)) * 100
    mdl_ac_at_line = 100.0 - mdl_hc_at_line
    mdl_ov_at_line = float(np.mean(totals  > model_to_rounded)) * 100
    mdl_un_at_line = 100.0 - mdl_ov_at_line

    # Fair odds at derived model line (reflect rounding shift from true median)
    mdl_home_sp_odds = prob_to_ml(mdl_hc_at_line / 100.0)
    mdl_away_sp_odds = prob_to_ml(mdl_ac_at_line / 100.0)
    mdl_over_odds    = prob_to_ml(mdl_ov_at_line / 100.0)
    mdl_under_odds   = prob_to_ml(mdl_un_at_line / 100.0)

    # ── ML: use direct simulation win probability ──────────────────────────────
    ml_h_pct = hw_pct
    ml_a_pct = aw_pct
    h_ml = prob_to_ml(ml_h_pct / 100.0)
    a_ml = prob_to_ml(ml_a_pct / 100.0)

    return {
        # Raw (pre-rounding) originated values
        'originated_spread': round(clamped_sp, 4),
        'originated_total':  round(clamped_to, 4),
        'raw_spread':        round(raw_sd, 4),
        'raw_total':         round(raw_td, 4),
        'raw_total_pre_adj': round(to_mean, 4),
        'cover_adj':         round(cover_adj, 4),
        'cover_direction':   cover_dir,
        'spread_clamped':    sp_cl,
        'total_clamped':     to_cl,
        'spread_std':        round(sp_std, 4),
        'total_std':         round(to_std, 4),
        # Win/cover at BOOK line (for edge detection)
        'home_win_pct':      round(hw_pct, 4),
        'away_win_pct':      round(aw_pct, 4),
        'home_cover':        round(hc_pct, 4),
        'away_cover':        round(ac_pct, 4),
        'over_rate':         round(ov_pct, 4),
        'under_rate':        round(un_pct, 4),
        # Derived model lines (rounded to 0.5)
        'model_sp_rounded':  model_sp_rounded,   # home-perspective (+ = home fav)
        'model_to_rounded':  model_to_rounded,
        # Cover/over at DERIVED model line (for model odds display)
        'mdl_hc_at_line':    round(mdl_hc_at_line, 4),
        'mdl_ac_at_line':    round(mdl_ac_at_line, 4),
        'mdl_ov_at_line':    round(mdl_ov_at_line, 4),
        'mdl_un_at_line':    round(mdl_un_at_line, 4),
        # Fair odds at derived model line
        'mdl_home_sp_odds':  mdl_home_sp_odds,
        'mdl_away_sp_odds':  mdl_away_sp_odds,
        'mdl_over_odds':     mdl_over_odds,
        'mdl_under_odds':    mdl_under_odds,
        # ML
        'ml_home_pct':       round(ml_h_pct, 4),
        'ml_away_pct':       round(ml_a_pct, 4),
        'home_ml_fair':      round(h_ml, 2),
        'away_ml_fair':      round(a_ml, 2),
        'sigma_away':        round(sig_a, 4),
        'sigma_home':        round(sig_h, 4),
    }

# ─────────────────────────────────────────────────────────────────────────────
# EDGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def detect_edges(sim, mkt_sp, mkt_to, mkt_ml_h, mkt_ml_a, away, home,
                 spread_away_odds=-110, spread_home_odds=-110,
                 over_odds=-110, under_odds=-110):
    """
    NHL-identical edge detection framework.
    - Uses vig-removed breakeven (not hardcoded 52.38%) when book odds are available
    - ROI = EV per $1 wagered = p_model * payout - (1 - p_model)
    - Accounts for actual book juice on spread and total lines
    - std dev is inherently factored in via the 250k simulation distribution
    """
    edges = []

    def vig_removed_be(odds_a: int, odds_b: int) -> tuple:
        """Return vig-removed (true_a, true_b) probabilities."""
        p_a = ml_to_prob(odds_a)
        p_b = ml_to_prob(odds_b)
        return remove_vig(p_a, p_b)

    def ev_roi(p_model: float, book_odds: int) -> float:
        """Expected value per $1 wagered, expressed as percentage."""
        ev = expected_value(p_model, book_odds)
        return round(ev * 100.0, 2)

    def edge_conf(prob_edge: float, pt_delta: float = 0.0) -> str:
        """Classify edge strength."""
        if prob_edge >= 0.08 or abs(pt_delta) >= 4.0:
            return 'HIGH'
        if prob_edge >= 0.04 or abs(pt_delta) >= 2.5:
            return 'MOD'
        return 'SMALL'

    sd = sim['originated_spread'] - mkt_sp
    td = sim['originated_total']  - mkt_to

    # ── SPREAD EDGE ──────────────────────────────────────────────────────────
    if abs(sd) >= SPREAD_EDGE_THRESH:
        # Vig-removed breakeven for spread
        true_away_sp, true_home_sp = vig_removed_be(spread_away_odds, spread_home_odds)
        if sd < 0:
            # Model says away team covers (model spread < market spread)
            p_model = sim['away_cover'] / 100.0
            p_be    = true_away_sp
            prob_edge = p_model - p_be
            if prob_edge > 0:
                edges.append({
                    'type': 'SPREAD',
                    'side': f'{away} +{abs(mkt_sp):.1f}',
                    'signal': f'Model {sim["originated_spread"]:+.4f} vs mkt {mkt_sp:+.1f} (Δ{sd:+.4f}pt)',
                    'cover_pct': round(sim['away_cover'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, spread_away_odds),
                    'conf': edge_conf(prob_edge, sd),
                })
        else:
            # Model says home team covers
            p_model = sim['home_cover'] / 100.0
            p_be    = true_home_sp
            prob_edge = p_model - p_be
            if prob_edge > 0:
                edges.append({
                    'type': 'SPREAD',
                    'side': f'{home} -{abs(mkt_sp):.1f}',
                    'signal': f'Model {sim["originated_spread"]:+.4f} vs mkt {mkt_sp:+.1f} (Δ{sd:+.4f}pt)',
                    'cover_pct': round(sim['home_cover'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, spread_home_odds),
                    'conf': edge_conf(prob_edge, sd),
                })

    # ── TOTAL EDGE ───────────────────────────────────────────────────────────
    if abs(td) >= TOTAL_EDGE_THRESH:
        true_over, true_under = vig_removed_be(over_odds, under_odds)
        if td < 0:
            # Model says UNDER
            p_model = sim['under_rate'] / 100.0
            p_be    = true_under
            prob_edge = p_model - p_be
            if prob_edge > 0:
                edges.append({
                    'type': 'TOTAL',
                    'side': f'UNDER {mkt_to}',
                    'signal': f'Model {sim["originated_total"]:.4f} vs mkt {mkt_to} (Δ{td:+.4f}pt)',
                    'cover_pct': round(sim['under_rate'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, under_odds),
                    'conf': edge_conf(prob_edge, td),
                })
        else:
            # Model says OVER
            p_model = sim['over_rate'] / 100.0
            p_be    = true_over
            prob_edge = p_model - p_be
            if prob_edge > 0:
                edges.append({
                    'type': 'TOTAL',
                    'side': f'OVER {mkt_to}',
                    'signal': f'Model {sim["originated_total"]:.4f} vs mkt {mkt_to} (Δ{td:+.4f}pt)',
                    'cover_pct': round(sim['over_rate'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, over_odds),
                    'conf': edge_conf(prob_edge, td),
                })

    # ── ML EDGE ──────────────────────────────────────────────────────────────
    if mkt_ml_h is not None and mkt_ml_h != 0 and mkt_ml_a is not None and mkt_ml_a != 0:
        true_away_ml, true_home_ml = vig_removed_be(mkt_ml_a, mkt_ml_h)
        # Home ML edge
        p_h = sim['ml_home_pct'] / 100.0
        prob_edge_h = p_h - true_home_ml
        if prob_edge_h >= 0.08:
            edges.append({
                'type': 'ML',
                'side': home,
                'signal': f'Model win% {sim["ml_home_pct"]:.2f}% vs mkt vig-free {true_home_ml*100:.2f}% (Δ{prob_edge_h*100:+.2f}%)',
                'cover_pct': round(sim['ml_home_pct'], 4),
                'edge_vs_be': round(prob_edge_h * 100.0, 4),
                'roi_pct': ev_roi(p_h, mkt_ml_h),
                'conf': edge_conf(prob_edge_h),
            })
        # Away ML edge
        p_a = sim['ml_away_pct'] / 100.0
        prob_edge_a = p_a - true_away_ml
        if prob_edge_a >= 0.08:
            edges.append({
                'type': 'ML',
                'side': away,
                'signal': f'Model win% {sim["ml_away_pct"]:.2f}% vs mkt vig-free {true_away_ml*100:.2f}% (Δ{prob_edge_a*100:+.2f}%)',
                'cover_pct': round(sim['ml_away_pct'], 4),
                'edge_vs_be': round(prob_edge_a * 100.0, 4),
                'roi_pct': ev_roi(p_a, mkt_ml_a),
                'conf': edge_conf(prob_edge_a),
            })

    return edges

# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENGINE — reads from stdin, writes JSON result to stdout
# ─────────────────────────────────────────────────────────────────────────────

def run_engine(inp: dict) -> dict:
    away_name    = inp['away_team']
    home_name    = inp['home_team']
    conf_a       = inp['conf_a']
    conf_h       = inp['conf_h']
    mkt_sp       = float(inp['mkt_sp'])
    mkt_to       = float(inp['mkt_to'])
    mkt_ml_a     = inp.get('mkt_ml_a')
    mkt_ml_h     = inp.get('mkt_ml_h')
    # Use JSON input credentials; fall back to KENPOM_EMAIL/KENPOM_PASSWORD env vars
    import os as _os
    kenpom_email = inp.get('kenpom_email') or _os.environ.get('KENPOM_EMAIL', '') or 'taileredsportsbetting@gmail.com'
    kenpom_pass  = inp.get('kenpom_pass')  or _os.environ.get('KENPOM_PASSWORD', '') or '3$mHnYuV8iLcYau'

    import kenpompy.team as kpt
    from kenpompy.utils import login

    print(f'[engine] Logging in to KenPom...', file=sys.stderr)
    browser = login(kenpom_email, kenpom_pass)
    print(f'[engine] Login OK', file=sys.stderr)
    time.sleep(2)

    print(f'[engine] Fetching {away_name} ({conf_a})...', file=sys.stderr)
    sa = kpt.get_scouting_report(browser, team=away_name, conference_only=True)
    time.sleep(6)
    df_a = kpt.get_schedule(browser, team=away_name)
    rows_a = parse_schedule_rows(df_a)
    time.sleep(6)

    print(f'[engine] Fetching {home_name} ({conf_h})...', file=sys.stderr)
    sh = kpt.get_scouting_report(browser, team=home_name, conference_only=True)
    time.sleep(6)
    df_h = kpt.get_schedule(browser, team=home_name)
    rows_h = parse_schedule_rows(df_h)
    time.sleep(2)

    print(f'[engine] Running model...', file=sys.stderr)

    cpg_a = compute_conf_ppg(rows_a)
    cpg_h = compute_conf_ppg(rows_h)

    aplo_a_reg = regress(sa['APLO'], REG_APLO, NAT_APLO)
    aplo_h_reg = regress(sh['APLO'], REG_APLO, NAT_APLO)
    poss, _ = compute_possessions(aplo_a_reg, aplo_h_reg)

    matchup = matchup_projection(sa, sh, poss, conf_a, conf_h)
    blended = blend_scores_delta(mkt_sp, mkt_to, cpg_a, cpg_h, matchup, sa, sh, conf_a, conf_h)
    sim     = monte_carlo(blended['away'], blended['home'], sa, sh, mkt_sp, mkt_to)

    # ── Spread/total values ──────────────────────────────────────────────────────
    # sim['model_sp_rounded'] is in HOME-minus-AWAY convention:
    #   positive = home is favored  → home spread = -model_sp_rounded, away spread = +model_sp_rounded
    #   negative = away is favored  → home spread = +|model_sp_rounded|, away spread = -|model_sp_rounded|
    # In betting display convention:
    #   away_spread = -model_sp_rounded  (away gets the negative of the home-perspective value)
    #   home_spread = +model_sp_rounded  (home keeps the home-perspective value)
    # Wait — let's be explicit:
    #   margins = home - away, so model_sp_rounded = median(home - away)
    #   If model_sp_rounded = +2.0: home wins by 2 → home is -2 favorite, away is +2 underdog
    #   away_spread (betting) = -model_sp_rounded = -2.0 ... NO
    #   In American betting: favorite has NEGATIVE spread, underdog has POSITIVE spread
    #   home is favorite: home_spread = -model_sp_rounded (e.g. -2), away_spread = +model_sp_rounded (e.g. +2)
    #   away is favorite: away_spread = +model_sp_rounded (e.g. -2 becomes +(-2)=-2 ... )
    # Simplest: away_sp_display = -model_sp_rounded, home_sp_display = +model_sp_rounded
    #   model_sp_rounded=+2: away=-2 (fav), home=+2 (dog) — WRONG for home fav scenario
    # CORRECT FORMULA:
    #   home_sp_display = -model_sp_rounded  (home is favorite when model_sp_rounded > 0, so home gets negative)
    #   away_sp_display = +model_sp_rounded  (away is underdog when model_sp_rounded > 0, so away gets positive)
    model_sp_r  = sim['model_sp_rounded']   # home-minus-away, rounded to 0.5
    model_to_r  = sim['model_to_rounded']
    # Betting display: home_sp = -model_sp_r, away_sp = +model_sp_r
    home_sp_display = -model_sp_r
    away_sp_display = +model_sp_r

    orig_to = sim['originated_total']
    raw_sp  = sim['raw_spread']
    raw_to  = sim['raw_total']
    # Scores from derived rounded line
    orig_home_score = (model_to_r + model_sp_r) / 2.0
    orig_away_score = (model_to_r - model_sp_r) / 2.0
    raw_home_score  = (raw_to + raw_sp) / 2.0
    raw_away_score  = (raw_to - raw_sp) / 2.0
    mkt_home_score  = (mkt_to + mkt_sp) / 2.0
    mkt_away_score  = (mkt_to - mkt_sp) / 2.0

    # Book odds for spread and total (default to -110 if not provided)
    spread_away_odds = int(inp.get('spread_away_odds') or -110)
    spread_home_odds = int(inp.get('spread_home_odds') or -110)
    over_odds_val    = int(inp.get('over_odds') or -110)
    under_odds_val   = int(inp.get('under_odds') or -110)

    edges = detect_edges(
        sim, mkt_sp, mkt_to, mkt_ml_h, mkt_ml_a, away_name, home_name,
        spread_away_odds=spread_away_odds,
        spread_home_odds=spread_home_odds,
        over_odds=over_odds_val,
        under_odds=under_odds_val,
    )

    return {
        'ok':              True,
        'game':            f'{away_name} @ {home_name}',
        'away_name':       away_name,
        'home_name':       home_name,
        'conf_a':          conf_a,
        'conf_h':          conf_h,
        # Model derived lines (rounded to 0.5, betting-display convention)
        'orig_away_sp':    away_sp_display,       # away spread (+ = underdog, - = favorite)
        'orig_home_sp':    home_sp_display,        # home spread (- = favorite, + = underdog)
        'orig_total':      model_to_r,             # model total (rounded to 0.5)
        # Model projected scores
        'orig_away_score': round(orig_away_score, 2),
        'orig_home_score': round(orig_home_score, 2),
        # Raw (pre-band, pre-rounding) for debugging
        'raw_away_score':  round(raw_away_score, 2),
        'raw_home_score':  round(raw_home_score, 2),
        'raw_away_sp':     round(-raw_sp, 2),      # betting display
        'raw_home_sp':     round(raw_sp, 2),
        'raw_total':       round(raw_to, 2),
        # Market implied scores
        'mkt_away_score':  round(mkt_away_score, 2),
        'mkt_home_score':  round(mkt_home_score, 2),
        'mkt_total':       mkt_to,
        # Fair ML
        'ml_away_pct':     sim['ml_away_pct'],
        'ml_home_pct':     sim['ml_home_pct'],
        'away_ml_fair':    sim['away_ml_fair'],
        'home_ml_fair':    sim['home_ml_fair'],
        # Over/under at book line
        'over_rate':       sim['over_rate'],
        'under_rate':      sim['under_rate'],
        # Simulation metadata
        'spread_clamped':  sim['spread_clamped'],
        'total_clamped':   sim['total_clamped'],
        'cover_direction': sim['cover_direction'],
        'cover_adj':       sim['cover_adj'],
        'def_suppression': matchup['def_suppression'],
        'sigma_away':      sim['sigma_away'],
        'sigma_home':      sim['sigma_home'],
        # Model fair odds at DERIVED model line (from 250k distribution at rounded line)
        'mkt_spread_away_odds': sim['mdl_away_sp_odds'],  # odds for away to cover model spread
        'mkt_spread_home_odds': sim['mdl_home_sp_odds'],  # odds for home to cover model spread
        'mkt_total_over_odds':  sim['mdl_over_odds'],     # odds for over at model total
        'mkt_total_under_odds': sim['mdl_under_odds'],    # odds for under at model total
        # Edges
        'edges':           edges,
        'error':           None,
    }


if __name__ == '__main__':
    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw)
    except json.JSONDecodeError as e:
        result = {
            'ok': False, 'game': '', 'away_name': '', 'home_name': '',
            'conf_a': '', 'conf_h': '',
            'orig_away_score': 0, 'orig_home_score': 0,
            'orig_away_sp': 0, 'orig_home_sp': 0, 'orig_total': 0,
            'raw_away_score': 0, 'raw_home_score': 0,
            'raw_away_sp': 0, 'raw_home_sp': 0, 'raw_total': 0,
            'mkt_away_score': 0, 'mkt_home_score': 0, 'mkt_total': 0,
            'ml_away_pct': 0, 'ml_home_pct': 0,
            'away_ml_fair': 0, 'home_ml_fair': 0,
            'over_rate': 0, 'under_rate': 0,
            'spread_clamped': False, 'total_clamped': False,
            'cover_direction': 'NONE', 'cover_adj': 0,
            'def_suppression': 0, 'sigma_away': 0, 'sigma_home': 0,
            'edges': [], 'error': f'JSON parse error: {e}',
        }
        print(json.dumps(result))
        sys.exit(1)

    try:
        result = run_engine(inp)
    except Exception as e:
        import traceback
        result = {
            'ok': False,
            'game': f'{inp.get("away_team", "")} @ {inp.get("home_team", "")}',
            'away_name': inp.get('away_team', ''), 'home_name': inp.get('home_team', ''),
            'conf_a': inp.get('conf_a', ''), 'conf_h': inp.get('conf_h', ''),
            'orig_away_score': 0, 'orig_home_score': 0,
            'orig_away_sp': 0, 'orig_home_sp': 0, 'orig_total': 0,
            'raw_away_score': 0, 'raw_home_score': 0,
            'raw_away_sp': 0, 'raw_home_sp': 0, 'raw_total': 0,
            'mkt_away_score': 0, 'mkt_home_score': 0, 'mkt_total': 0,
            'ml_away_pct': 0, 'ml_home_pct': 0,
            'away_ml_fair': 0, 'home_ml_fair': 0,
            'over_rate': 0, 'under_rate': 0,
            'spread_clamped': False, 'total_clamped': False,
            'cover_direction': 'NONE', 'cover_adj': 0,
            'def_suppression': 0, 'sigma_away': 0, 'sigma_home': 0,
            'edges': [],
            'error': f'{type(e).__name__}: {e}\n{traceback.format_exc()}',
        }

    # Always print result JSON as the last line of stdout
    print(json.dumps(result))

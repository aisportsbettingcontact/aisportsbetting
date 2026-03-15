#!/usr/bin/env python3
"""
nhl_model_engine.py — NHL Monte Carlo Origination Engine v1.0
==============================================================
Backend integration entry point.

Protocol:
  STDIN  → single JSON object (NhlModelInput)
  STDOUT → single JSON line (NhlModelResult) — LAST line of stdout

Input schema:
  {
    "away_team":       "Boston Bruins",    # Full team name matching NaturalStatTrick
    "home_team":       "Toronto Maple Leafs",
    "away_abbrev":     "BOS",              # NHL abbreviation
    "home_abbrev":     "TOR",
    "away_goalie":     "Jeremy Swayman",   # Starting goalie name (or null)
    "home_goalie":     "Anthony Stolarz",
    "away_goalie_gp":  38,                 # Goalie GP (for GSAx normalization)
    "home_goalie_gp":  32,
    "away_goalie_gsax": 6.4,              # Goals Saved Above Expected
    "home_goalie_gsax": 2.1,
    "mkt_puck_line":   -1.5,              # Market puck line (always ±1.5)
    "mkt_away_pl_odds": -132,             # Market away puck line odds
    "mkt_home_pl_odds": 112,              # Market home puck line odds
    "mkt_total":       6.0,               # Market total (over/under line)
    "mkt_over_odds":   -101,              # Market over odds
    "mkt_under_odds":  101,               # Market under odds
    "mkt_away_ml":     135,               # Market away moneyline
    "mkt_home_ml":     -155,              # Market home moneyline
    "team_stats": {                        # NaturalStatTrick team stats (keyed by abbrev)
      "BOS": {
        "xGF_pct": 52.3, "xGA_pct": 47.7,
        "CF_pct": 53.1, "SCF_pct": 51.8, "HDCF_pct": 54.2,
        "SH_pct": 10.2, "SV_pct": 91.8, "GF": 180, "GA": 155
      },
      "TOR": { ... }
    }
  }

Output schema (last line of stdout):
  {
    "ok": true,
    "game": "Boston Bruins @ Toronto Maple Leafs",
    "away_name": "Boston Bruins",
    "home_name": "Toronto Maple Leafs",
    "proj_away_goals": 2.73,
    "proj_home_goals": 3.18,
    "away_puck_line": "+1.5",
    "away_puck_line_odds": -132,
    "home_puck_line": "-1.5",
    "home_puck_line_odds": 112,
    "away_ml": 135,
    "home_ml": -155,
    "total_line": 6.0,
    "over_odds": -101,
    "under_odds": 101,
    "away_win_pct": 42.3,
    "home_win_pct": 57.7,
    "over_pct": 48.2,
    "under_pct": 51.8,
    "away_cover_pct": 38.4,
    "home_cover_pct": 61.6,
    "edges": [...],
    "error": null
  }
"""

import sys
import json
import numpy as np
import time

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

SIMULATIONS     = 50_000
LEAGUE_AVG_GOALS = 3.05   # NHL 5v5 goals per team per game (2025-26 season avg)
LEAGUE_SH_PCT   = 9.5     # League average shooting percentage

# Goalie quality tiers (GSAx/game thresholds)
ELITE_GOALIE_THRESHOLD  =  0.10   # GSAx/game ≥ 0.10 → elite (-0.35 goal adj)
WEAK_GOALIE_THRESHOLD   = -0.10   # GSAx/game ≤ -0.10 → weak (+0.40 goal adj)
ELITE_GOALIE_ADJ        = -0.35
AVERAGE_GOALIE_ADJ      =  0.00
WEAK_GOALIE_ADJ         = +0.40

# Market weighting (blend model output toward market to reduce clamping)
MARKET_WEIGHT = 0.30   # 30% market blend for goals projection
MODEL_WEIGHT  = 0.70   # 70% pure model

# Home ice advantage (goals)
HOME_ICE_ADJ = 0.035   # ~3.5% boost to home team goals

# Edge detection thresholds
PUCK_LINE_EDGE_THRESHOLD = 0.05   # 5% probability edge over break-even
ML_EDGE_THRESHOLD        = 0.04   # 4% probability edge over break-even
TOTAL_EDGE_THRESHOLD     = 0.05   # 5% probability edge over break-even


# ─────────────────────────────────────────────────────────────────────────────
# ATTACK / DEFENSE INDICES
# ─────────────────────────────────────────────────────────────────────────────

def compute_attack_index(stats: dict) -> float:
    """
    Weighted composite of offensive possession metrics.
    All stats are percentages (e.g. xGF_pct=52.3 means 52.3%).
    Normalized to 1.0 = league average (50%).
    """
    raw = (
        0.40 * stats["xGF_pct"] +
        0.25 * stats["SCF_pct"] +
        0.20 * stats["HDCF_pct"] +
        0.15 * stats["CF_pct"]
    )
    return raw / 50.0


def compute_defense_index(stats: dict) -> float:
    """
    Weighted composite of defensive suppression metrics.
    xGA_pct = 100 - xGF_pct for opponent, but we use the team's own xGA% directly.
    Lower xGA% = better defense → lower defense_index → fewer goals allowed.
    """
    # SCA% = 100 - SCF% (opponent scoring chances allowed %)
    sca_pct = 100.0 - stats["SCF_pct"]
    # HDCA% = 100 - HDCF% (opponent high-danger chances allowed %)
    hdca_pct = 100.0 - stats["HDCF_pct"]
    # CA% = 100 - CF% (opponent corsi allowed %)
    ca_pct = 100.0 - stats["CF_pct"]

    raw = (
        0.45 * stats["xGA_pct"] +
        0.25 * sca_pct +
        0.20 * hdca_pct +
        0.10 * ca_pct
    )
    return raw / 50.0


def finishing_factor(stats: dict) -> float:
    """Ratio of team SH% to league average SH%."""
    return stats["SH_pct"] / LEAGUE_SH_PCT


# ─────────────────────────────────────────────────────────────────────────────
# GOALIE FACTOR
# ─────────────────────────────────────────────────────────────────────────────

def goalie_factor(gsax: float, gp: int) -> float:
    """
    Convert GSAx (Goals Saved Above Expected) to a multiplicative factor on
    goals allowed. Higher GSAx = better goalie = fewer goals allowed.

    Formula: factor = 1 - (gsax_per_game / 3.0)
    Clamp to [0.75, 1.25] to prevent extreme outliers.
    """
    if gp <= 0:
        return 1.0
    gsax_per_game = gsax / gp
    factor = 1.0 - (gsax_per_game / 3.0)
    return max(0.75, min(1.25, factor))


def goalie_tier_adjustment(gsax: float, gp: int) -> float:
    """
    Additional goal adjustment based on goalie quality tier.
    Elite goalies suppress scoring; weak goalies inflate it.
    """
    if gp <= 0:
        return AVERAGE_GOALIE_ADJ
    gsax_per_game = gsax / gp
    if gsax_per_game >= ELITE_GOALIE_THRESHOLD:
        return ELITE_GOALIE_ADJ
    elif gsax_per_game <= WEAK_GOALIE_THRESHOLD:
        return WEAK_GOALIE_ADJ
    else:
        return AVERAGE_GOALIE_ADJ


# ─────────────────────────────────────────────────────────────────────────────
# GOAL PROJECTION
# ─────────────────────────────────────────────────────────────────────────────

def project_goals(
    away_stats: dict,
    home_stats: dict,
    away_goalie_gsax: float,
    away_goalie_gp: int,
    home_goalie_gsax: float,
    home_goalie_gp: int,
    mkt_away_ml: int | None = None,
    mkt_home_ml: int | None = None,
    mkt_total: float | None = None,
) -> tuple[float, float]:
    """
    Project expected goals for away and home teams.

    Model formula (per team):
      goals = LEAGUE_AVG * attack_index * defense_index_opponent * finishing_factor * goalie_factor_opponent

    Then blend with market-implied goals (if available) to anchor to market.
    """
    attack_away  = compute_attack_index(away_stats)
    defense_away = compute_defense_index(away_stats)
    finish_away  = finishing_factor(away_stats)

    attack_home  = compute_attack_index(home_stats)
    defense_home = compute_defense_index(home_stats)
    finish_home  = finishing_factor(home_stats)

    gf_away_opp = goalie_factor(home_goalie_gsax, home_goalie_gp)
    gf_home_opp = goalie_factor(away_goalie_gsax, away_goalie_gp)

    # Raw model goals
    raw_away = (
        LEAGUE_AVG_GOALS
        * attack_away
        * defense_home
        * finish_away
        * gf_away_opp
    )
    raw_home = (
        LEAGUE_AVG_GOALS
        * attack_home
        * defense_away
        * finish_home
        * gf_home_opp
        * (1.0 + HOME_ICE_ADJ)
    )

    # Apply goalie tier adjustments (additive)
    away_tier_adj = goalie_tier_adjustment(home_goalie_gsax, home_goalie_gp)
    home_tier_adj = goalie_tier_adjustment(away_goalie_gsax, away_goalie_gp)
    raw_away += away_tier_adj
    raw_home += home_tier_adj

    # Ensure non-negative
    raw_away = max(0.5, raw_away)
    raw_home = max(0.5, raw_home)

    # Market-implied goals blend
    if mkt_away_ml is not None and mkt_home_ml is not None and mkt_total is not None:
        # Convert ML to win probability
        away_win_prob = ml_to_prob(mkt_away_ml)
        home_win_prob = 1.0 - away_win_prob
        # Market-implied goals: distribute total by win probability ratio
        # Slight adjustment: favorite gets slightly more goals
        ratio = home_win_prob / away_win_prob if away_win_prob > 0 else 1.0
        mkt_home_goals = mkt_total * ratio / (1.0 + ratio)
        mkt_away_goals = mkt_total - mkt_home_goals
        # Blend
        blended_away = MODEL_WEIGHT * raw_away + MARKET_WEIGHT * mkt_away_goals
        blended_home = MODEL_WEIGHT * raw_home + MARKET_WEIGHT * mkt_home_goals
    else:
        blended_away = raw_away
        blended_home = raw_home

    return round(blended_away, 4), round(blended_home, 4)


# ─────────────────────────────────────────────────────────────────────────────
# MONTE CARLO SIMULATION
# ─────────────────────────────────────────────────────────────────────────────

def run_simulation(lambda_away: float, lambda_home: float) -> tuple[np.ndarray, np.ndarray]:
    """Run 50k Poisson simulations for both teams."""
    away_scores = np.random.poisson(lambda_away, SIMULATIONS)
    home_scores = np.random.poisson(lambda_home, SIMULATIONS)
    return away_scores, home_scores


# ─────────────────────────────────────────────────────────────────────────────
# PROBABILITY CALCULATIONS
# ─────────────────────────────────────────────────────────────────────────────

def calculate_probs(away_scores: np.ndarray, home_scores: np.ndarray) -> dict:
    """
    Calculate all probabilities from simulation results.
    Puck line is always ±1.5 in NHL.
    """
    totals = away_scores + home_scores
    margin = home_scores - away_scores  # positive = home winning

    away_wins  = float(np.mean(away_scores > home_scores))
    home_wins  = float(np.mean(home_scores > away_scores))

    # Puck line: away +1.5 covers if away loses by exactly 1 or wins outright
    away_pl_cover = float(np.mean(margin <= 1))   # away +1.5 covers
    home_pl_cover = float(np.mean(margin >= 2))   # home -1.5 covers

    # Find the best total line from candidates
    candidates = [5.0, 5.5, 6.0, 6.5, 7.0, 7.5]
    best_line = 6.0
    best_diff = 1.0
    best_over_prob = 0.5
    for line in candidates:
        prob = float(np.mean(totals > line))
        diff = abs(prob - 0.5)
        if diff < best_diff:
            best_diff = diff
            best_line = line
            best_over_prob = prob

    return {
        "away_win":      away_wins,
        "home_win":      home_wins,
        "away_pl_cover": away_pl_cover,
        "home_pl_cover": home_pl_cover,
        "best_total_line": best_line,
        "best_over_prob":  best_over_prob,
        "totals":          totals,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PROBABILITY ↔ MONEYLINE CONVERSION
# ─────────────────────────────────────────────────────────────────────────────

def prob_to_ml(p: float) -> int:
    """Convert win probability to American moneyline odds (no vig)."""
    p = max(0.001, min(0.999, p))
    if p >= 0.5:
        return -round((p / (1.0 - p)) * 100)
    else:
        return round(((1.0 - p) / p) * 100)


def ml_to_prob(ml: int) -> float:
    """Convert American moneyline to implied win probability (no vig removal)."""
    if ml < 0:
        return abs(ml) / (abs(ml) + 100.0)
    else:
        return 100.0 / (ml + 100.0)


def format_ml(ml: int) -> str:
    """Format moneyline as string with sign."""
    return f"+{ml}" if ml > 0 else str(ml)


# ─────────────────────────────────────────────────────────────────────────────
# EDGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def detect_edges(
    probs: dict,
    mkt_away_pl_odds: int | None,
    mkt_home_pl_odds: int | None,
    mkt_over_odds: int | None,
    mkt_under_odds: int | None,
    mkt_away_ml: int | None,
    mkt_home_ml: int | None,
) -> list[dict]:
    """
    Detect edges by comparing model probabilities to market implied probabilities.
    An edge exists when model probability exceeds market implied probability by
    more than the threshold.
    """
    edges = []

    # ── Puck Line Edges ──────────────────────────────────────────────────────
    if mkt_away_pl_odds is not None:
        mkt_away_pl_prob = ml_to_prob(mkt_away_pl_odds)
        model_away_pl_prob = probs["away_pl_cover"]
        edge_vs_be = model_away_pl_prob - mkt_away_pl_prob
        if edge_vs_be >= PUCK_LINE_EDGE_THRESHOLD:
            edges.append({
                "type": "PUCK_LINE",
                "side": "AWAY +1.5",
                "model_prob": round(model_away_pl_prob * 100, 2),
                "mkt_prob":   round(mkt_away_pl_prob * 100, 2),
                "edge_vs_be": round(edge_vs_be * 100, 2),
                "conf": "HIGH" if edge_vs_be >= 0.10 else ("MOD" if edge_vs_be >= 0.07 else "LOW"),
            })

    if mkt_home_pl_odds is not None:
        mkt_home_pl_prob = ml_to_prob(mkt_home_pl_odds)
        model_home_pl_prob = probs["home_pl_cover"]
        edge_vs_be = model_home_pl_prob - mkt_home_pl_prob
        if edge_vs_be >= PUCK_LINE_EDGE_THRESHOLD:
            edges.append({
                "type": "PUCK_LINE",
                "side": "HOME -1.5",
                "model_prob": round(model_home_pl_prob * 100, 2),
                "mkt_prob":   round(mkt_home_pl_prob * 100, 2),
                "edge_vs_be": round(edge_vs_be * 100, 2),
                "conf": "HIGH" if edge_vs_be >= 0.10 else ("MOD" if edge_vs_be >= 0.07 else "LOW"),
            })

    # ── Total Edges ──────────────────────────────────────────────────────────
    if mkt_over_odds is not None:
        mkt_over_prob = ml_to_prob(mkt_over_odds)
        model_over_prob = probs["best_over_prob"]
        edge_vs_be = model_over_prob - mkt_over_prob
        if edge_vs_be >= TOTAL_EDGE_THRESHOLD:
            edges.append({
                "type": "TOTAL",
                "side": f"OVER {probs['best_total_line']}",
                "model_prob": round(model_over_prob * 100, 2),
                "mkt_prob":   round(mkt_over_prob * 100, 2),
                "edge_vs_be": round(edge_vs_be * 100, 2),
                "conf": "HIGH" if edge_vs_be >= 0.10 else ("MOD" if edge_vs_be >= 0.07 else "LOW"),
            })

    if mkt_under_odds is not None:
        mkt_under_prob = ml_to_prob(mkt_under_odds)
        model_under_prob = 1.0 - probs["best_over_prob"]
        edge_vs_be = model_under_prob - mkt_under_prob
        if edge_vs_be >= TOTAL_EDGE_THRESHOLD:
            edges.append({
                "type": "TOTAL",
                "side": f"UNDER {probs['best_total_line']}",
                "model_prob": round(model_under_prob * 100, 2),
                "mkt_prob":   round(mkt_under_prob * 100, 2),
                "edge_vs_be": round(edge_vs_be * 100, 2),
                "conf": "HIGH" if edge_vs_be >= 0.10 else ("MOD" if edge_vs_be >= 0.07 else "LOW"),
            })

    # ── Moneyline Edges ──────────────────────────────────────────────────────
    if mkt_away_ml is not None:
        mkt_away_prob = ml_to_prob(mkt_away_ml)
        model_away_prob = probs["away_win"]
        edge_vs_be = model_away_prob - mkt_away_prob
        if edge_vs_be >= ML_EDGE_THRESHOLD:
            edges.append({
                "type": "ML",
                "side": "AWAY ML",
                "model_prob": round(model_away_prob * 100, 2),
                "mkt_prob":   round(mkt_away_prob * 100, 2),
                "edge_vs_be": round(edge_vs_be * 100, 2),
                "conf": "HIGH" if edge_vs_be >= 0.08 else ("MOD" if edge_vs_be >= 0.06 else "LOW"),
            })

    if mkt_home_ml is not None:
        mkt_home_prob = ml_to_prob(mkt_home_ml)
        model_home_prob = probs["home_win"]
        edge_vs_be = model_home_prob - mkt_home_prob
        if edge_vs_be >= ML_EDGE_THRESHOLD:
            edges.append({
                "type": "ML",
                "side": "HOME ML",
                "model_prob": round(model_home_prob * 100, 2),
                "mkt_prob":   round(mkt_home_prob * 100, 2),
                "edge_vs_be": round(edge_vs_be * 100, 2),
                "conf": "HIGH" if edge_vs_be >= 0.08 else ("MOD" if edge_vs_be >= 0.06 else "LOW"),
            })

    return edges


# ─────────────────────────────────────────────────────────────────────────────
# MAIN MODEL ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def originate_game(inp: dict) -> dict:
    """
    Full NHL game origination pipeline:
    1. Load team stats from input
    2. Project goals (model + market blend)
    3. Run 50k Monte Carlo simulation
    4. Calculate probabilities
    5. Originate puck line odds, ML, and total
    6. Detect edges
    7. Return structured result
    """
    away_name   = inp["away_team"]
    home_name   = inp["home_team"]
    away_abbrev = inp.get("away_abbrev", "AWAY")
    home_abbrev = inp.get("home_abbrev", "HOME")

    team_stats = inp.get("team_stats", {})
    away_stats = team_stats.get(away_abbrev) or team_stats.get(away_name)
    home_stats = team_stats.get(home_abbrev) or team_stats.get(home_name)

    if not away_stats or not home_stats:
        return {
            "ok": False,
            "error": f"Missing team stats for {away_abbrev} or {home_abbrev}",
        }

    away_goalie_gsax = float(inp.get("away_goalie_gsax") or 0.0)
    away_goalie_gp   = int(inp.get("away_goalie_gp") or 1)
    home_goalie_gsax = float(inp.get("home_goalie_gsax") or 0.0)
    home_goalie_gp   = int(inp.get("home_goalie_gp") or 1)

    mkt_away_ml    = inp.get("mkt_away_ml")
    mkt_home_ml    = inp.get("mkt_home_ml")
    mkt_total      = inp.get("mkt_total")
    mkt_away_pl_odds = inp.get("mkt_away_pl_odds")
    mkt_home_pl_odds = inp.get("mkt_home_pl_odds")
    mkt_over_odds  = inp.get("mkt_over_odds")
    mkt_under_odds = inp.get("mkt_under_odds")

    print(f"[NHLModel] ► Originating: {away_name} @ {home_name}", file=sys.stderr)
    print(f"[NHLModel]   Away goalie: {inp.get('away_goalie','?')} GSAx={away_goalie_gsax:.2f} GP={away_goalie_gp}", file=sys.stderr)
    print(f"[NHLModel]   Home goalie: {inp.get('home_goalie','?')} GSAx={home_goalie_gsax:.2f} GP={home_goalie_gp}", file=sys.stderr)
    print(f"[NHLModel]   Market: PL_odds={mkt_away_pl_odds}/{mkt_home_pl_odds} Total={mkt_total} ML={mkt_away_ml}/{mkt_home_ml}", file=sys.stderr)

    t0 = time.time()

    # 1. Project goals
    lambda_away, lambda_home = project_goals(
        away_stats, home_stats,
        away_goalie_gsax, away_goalie_gp,
        home_goalie_gsax, home_goalie_gp,
        mkt_away_ml, mkt_home_ml, mkt_total,
    )
    print(f"[NHLModel]   Projected goals: {away_name}={lambda_away:.4f} {home_name}={lambda_home:.4f}", file=sys.stderr)

    # 2. Monte Carlo
    away_scores, home_scores = run_simulation(lambda_away, lambda_home)

    # 3. Probabilities
    probs = calculate_probs(away_scores, home_scores)

    # 4. Originate lines
    model_away_ml_int = prob_to_ml(probs["away_win"])
    model_home_ml_int = -model_away_ml_int

    model_away_pl_odds_int = prob_to_ml(probs["away_pl_cover"])
    model_home_pl_odds_int = -model_away_pl_odds_int

    model_total_line = probs["best_total_line"]
    model_over_odds_int  = prob_to_ml(probs["best_over_prob"])
    model_under_odds_int = -model_over_odds_int

    # 5. Detect edges
    edges = detect_edges(
        probs,
        mkt_away_pl_odds, mkt_home_pl_odds,
        mkt_over_odds, mkt_under_odds,
        mkt_away_ml, mkt_home_ml,
    )

    elapsed = time.time() - t0
    print(f"[NHLModel]   ✓ Done in {elapsed:.2f}s | Edges: {len(edges)}", file=sys.stderr)
    print(f"[NHLModel]   ML: {format_ml(model_away_ml_int)}/{format_ml(model_home_ml_int)} | PL: {format_ml(model_away_pl_odds_int)}/{format_ml(model_home_pl_odds_int)} | Total: {model_total_line} ({format_ml(model_over_odds_int)}/{format_ml(model_under_odds_int)})", file=sys.stderr)

    return {
        "ok":                True,
        "game":              f"{away_name} @ {home_name}",
        "away_name":         away_name,
        "home_name":         home_name,
        "away_abbrev":       away_abbrev,
        "home_abbrev":       home_abbrev,
        "away_goalie":       inp.get("away_goalie"),
        "home_goalie":       inp.get("home_goalie"),
        # Projected goals
        "proj_away_goals":   round(lambda_away, 2),
        "proj_home_goals":   round(lambda_home, 2),
        # Puck line (always ±1.5)
        "away_puck_line":    "+1.5",
        "away_puck_line_odds": model_away_pl_odds_int,
        "home_puck_line":    "-1.5",
        "home_puck_line_odds": model_home_pl_odds_int,
        # Moneylines
        "away_ml":           model_away_ml_int,
        "home_ml":           model_home_ml_int,
        # Total
        "total_line":        model_total_line,
        "over_odds":         model_over_odds_int,
        "under_odds":        model_under_odds_int,
        # Probabilities
        "away_win_pct":      round(probs["away_win"] * 100, 2),
        "home_win_pct":      round(probs["home_win"] * 100, 2),
        "away_pl_cover_pct": round(probs["away_pl_cover"] * 100, 2),
        "home_pl_cover_pct": round(probs["home_pl_cover"] * 100, 2),
        "over_pct":          round(probs["best_over_prob"] * 100, 2),
        "under_pct":         round((1.0 - probs["best_over_prob"]) * 100, 2),
        # Edges
        "edges":             edges,
        "error":             None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# STDIN/STDOUT PROTOCOL
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            result = {"ok": False, "error": "Empty input"}
        else:
            inp = json.loads(raw)
            result = originate_game(inp)
    except json.JSONDecodeError as e:
        result = {"ok": False, "error": f"JSON parse error: {e}"}
    except Exception as e:
        import traceback
        result = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}

    # Output ONLY the JSON result on the last line of stdout
    print(json.dumps(result))

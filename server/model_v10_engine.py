#!/usr/bin/env python3
###############################################################################
# ULTRA-HIGH FIDELITY CBB MARKET ORIGINATION ENGINE v10 (KENPOM-BASED)
# 250,000 SIMULATIONS | FULL DISTRIBUTIONAL DERIVATION | NO-VIG OUTPUTS
#
# POSSESSION MODEL (correct basketball physics):
#   Each possession:
#     1. Turnover? (p_TO) → 0 pts, opponent transition
#     2. No TO → Field goal attempt
#        a. 3PA with prob p_3PA (of FGA)
#        b. 2PA with prob (1 - p_3PA) (of FGA)
#        c. FT trip: independent, p_FT = FTR (FTA/FGA)
#     3. Offensive rebound on miss → recursive (geometric series)
#
# CALIBRATION: PPP is anchored to KenPom AdjO/AdjD via a scaling factor
# so that E[score] matches the KenPom matchup projection.
#
# I/O CONTRACT: identical to model_v9_engine.py
###############################################################################

import sys, json, os as _os
import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
# LEAGUE AVERAGES (2025-26 season)
# ─────────────────────────────────────────────────────────────────────────────
LG_AVG_TO        = 17.0    # TOPct (%)
LG_AVG_3PA       = 36.5    # 3PARate (%)
LG_AVG_FT        = 32.0    # FTR (FTA/FGA, %)
LG_AVG_2P        = 49.5    # 2Pct (%)
LG_AVG_3P        = 34.5    # 3Pct (%)
LG_AVG_OR        = 28.5    # ORPct (%)
LG_AVG_TEMPO     = 68.5    # possessions per 40 min
LG_AVG_OE        = 110.0   # AdjO (pts per 100 poss)
LG_AVG_FT_PCT    = 72.0    # FTPct (%)

# ─────────────────────────────────────────────────────────────────────────────
# ENGINE CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
N_SIM               = 250_000
TOURN_PACE          = 0.965   # 3.5% fewer possessions in tournament
SPREAD_EDGE_THRESH  = 1.5
TOTAL_EDGE_THRESH   = 3.0

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def round_to_half(x: float) -> float:
    return round(x * 2) / 2.0

def prob_to_ml(p: float) -> int:
    p = max(0.001, min(0.999, p))
    if abs(p - 0.5) < 0.001:
        return 100
    if p > 0.5:
        return int(round(-(p / (1.0 - p)) * 100.0))
    else:
        return int(round(((1.0 - p) / p) * 100.0))

def vig_removed_be(odds_a: int, odds_b: int):
    def to_prob(o):
        if o < 0:
            return abs(o) / (abs(o) + 100.0)
        else:
            return 100.0 / (o + 100.0)
    pa, pb = to_prob(odds_a), to_prob(odds_b)
    total = pa + pb
    return pa / total, pb / total

def ev_roi(p_model: float, odds: int) -> float:
    if odds < 0:
        payout = 100.0 / abs(odds)
    else:
        payout = odds / 100.0
    return round((p_model * payout - (1.0 - p_model)) * 100.0, 4)

def edge_conf(prob_edge: float, delta: float = 0.0) -> str:
    pt = abs(delta)
    if prob_edge >= 0.08 or pt >= 4.0:
        return 'STRONG'
    if prob_edge >= 0.05 or pt >= 2.5:
        return 'MOD'
    return 'SMALL'

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: PREPROCESS KENPOM → spec fields (all as fractions 0-1)
# ─────────────────────────────────────────────────────────────────────────────
def preprocess(sc: dict) -> dict:
    def pct(key, fallback):
        v = sc.get(key, '')
        try:
            return float(v) / 100.0
        except (TypeError, ValueError):
            return fallback / 100.0

    def raw(key, fallback):
        v = sc.get(key, '')
        try:
            return float(v)
        except (TypeError, ValueError):
            return float(fallback)

    return dict(
        AdjO         = raw('OE',       LG_AVG_OE),
        AdjD         = raw('DE',       LG_AVG_OE),
        AdjT         = raw('Tempo',    LG_AVG_TEMPO),
        eFG          = pct('eFG',      51.8),
        twoP         = pct('2Pct',     LG_AVG_2P),
        threeP       = pct('3Pct',     LG_AVG_3P),
        threePA_rate = pct('3PARate',  LG_AVG_3PA),
        FTR          = pct('FTR',      LG_AVG_FT),      # FTA/FGA
        FTPct        = pct('FTPct',    LG_AVG_FT_PCT),  # FT make %
        OR           = pct('ORPct',    LG_AVG_OR),
        TO           = pct('TOPct',    LG_AVG_TO),
        # Defensive (opponent-allowed)
        opp_eFG      = pct('DeFG',     51.8),
        opp_twoP     = pct('D2Pct',    LG_AVG_2P),
        opp_threeP   = pct('D3Pct',    LG_AVG_3P),
        opp_threePA  = pct('D3PARate', LG_AVG_3PA),
        opp_FTR      = pct('DFTR',     LG_AVG_FT),
        opp_OR       = pct('DORPct',   LG_AVG_OR),
        opp_TO       = pct('DTOPct',   LG_AVG_TO),
    )

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: POSSESSION DISTRIBUTION
# ─────────────────────────────────────────────────────────────────────────────
def possession_params(A: dict, B: dict, tournament: bool = True):
    poss_mean = 2.0 * A['AdjT'] * B['AdjT'] / (A['AdjT'] + B['AdjT'])
    if tournament:
        poss_mean *= TOURN_PACE
    poss_sigma = poss_mean * 0.08
    poss_sigma *= (1.0 + abs(A['AdjT'] - B['AdjT']) / 100.0)
    poss_sigma *= 1.05   # neutral court
    if tournament:
        poss_sigma *= 1.04
    return poss_mean, poss_sigma

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: INTERACTION SHOT MIX (offense × defense interaction)
# ─────────────────────────────────────────────────────────────────────────────
def interact(off_val: float, def_val: float, lg_avg: float) -> float:
    """off_val × (1 + (def_val - league_avg))"""
    return off_val * (1.0 + (def_val - lg_avg))

def shot_mix_params(off: dict, def_: dict) -> dict:
    """
    Returns interaction-adjusted shot mix parameters.
    All values are fractions (0-1).
    """
    # Turnover rate (interaction)
    p_TO = interact(off['TO'], def_['opp_TO'], LG_AVG_TO / 100.0)
    p_TO = max(0.05, min(0.30, p_TO))  # clamp to realistic range

    # 3PA rate (of FGA)
    p_3PA = interact(off['threePA_rate'], def_['opp_threePA'], LG_AVG_3PA / 100.0)
    p_3PA = max(0.15, min(0.55, p_3PA))

    # FTR (FTA/FGA) — interaction
    p_FTR = interact(off['FTR'], def_['opp_FTR'], LG_AVG_FT / 100.0)
    p_FTR = max(0.10, min(0.60, p_FTR))

    # 2P% interaction
    twoP = interact(off['twoP'], def_['opp_twoP'], LG_AVG_2P / 100.0)
    twoP = max(0.30, min(0.70, twoP))

    # 3P% interaction
    threeP = interact(off['threeP'], def_['opp_threeP'], LG_AVG_3P / 100.0)
    threeP = max(0.20, min(0.55, threeP))

    # OR rate
    OR = interact(off['OR'], def_['opp_OR'], LG_AVG_OR / 100.0)
    OR = max(0.10, min(0.50, OR))

    return dict(
        p_TO=p_TO, p_3PA=p_3PA, p_FTR=p_FTR,
        twoP=twoP, threeP=threeP, OR=OR,
        FTPct=off['FTPct'],
    )

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: COMPUTE EXPECTED PPP FROM SHOT MIX
# ─────────────────────────────────────────────────────────────────────────────
def expected_ppp(params: dict) -> float:
    """
    Compute expected points per possession from shot mix parameters.
    
    Possession flow:
      - p_TO: turnover → 0 pts
      - (1 - p_TO): field goal attempt
        - p_3PA of FGA: 3-point attempt
        - (1 - p_3PA) of FGA: 2-point attempt
        - p_FTR of FGA: also get FT trip (2 FTs)
      - Offensive rebound on miss → extra possession (geometric series)
    """
    p_TO = params['p_TO']
    p_FGA = 1.0 - p_TO
    p_3PA = params['p_3PA']
    p_2PA = 1.0 - p_3PA
    twoP  = params['twoP']
    threeP = params['threeP']
    FTR   = params['p_FTR']
    FTPct = params['FTPct']
    OR    = params['OR']

    # Points from field goals per possession (before OR)
    pts_2pa = p_FGA * p_2PA * twoP * 2.0
    pts_3pa = p_FGA * p_3PA * threeP * 3.0

    # Points from FTs per possession
    # FTR = FTA/FGA → FT trips per FGA = FTR, avg 2 FT per trip
    pts_ft = p_FGA * FTR * FTPct * 2.0

    # Miss rate (no OR yet)
    miss_2pa = p_FGA * p_2PA * (1.0 - twoP)
    miss_3pa = p_FGA * p_3PA * (1.0 - threeP)
    miss_rate = miss_2pa + miss_3pa

    # Offensive rebound → extra possession (geometric series: 1/(1-OR*miss_rate))
    # But OR applies to the miss rate, not all possessions
    or_factor = 1.0 / max(0.5, 1.0 - OR * miss_rate)

    ppp = (pts_2pa + pts_3pa + pts_ft) * or_factor
    return ppp

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: KENPOM MATCHUP SCORE PROJECTION
# ─────────────────────────────────────────────────────────────────────────────
def kenpom_matchup_scores(A: dict, B: dict, poss_mean: float) -> tuple:
    """
    Project expected scores using KenPom AdjO/AdjD.
    
    KenPom formula: team_score = (AdjO_off × AdjD_def / LG_AVG_OE) × poss / 100
    This is the standard KenPom matchup projection.
    """
    # Team A (away) scoring: A's offense vs B's defense
    score_A = (A['AdjO'] * B['AdjD'] / LG_AVG_OE) * poss_mean / 100.0
    # Team B (home) scoring: B's offense vs A's defense
    score_B = (B['AdjO'] * A['AdjD'] / LG_AVG_OE) * poss_mean / 100.0
    return score_A, score_B

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: VECTORIZED SIMULATION
# ─────────────────────────────────────────────────────────────────────────────
def simulate_scores(
    params_A: dict, params_B: dict,
    kp_score_A: float, kp_score_B: float,
    poss_arr: np.ndarray,
    rng: np.random.Generator,
) -> tuple:
    """
    Simulate N_SIM games. Returns (scores_A, scores_B).
    
    Strategy:
    1. Compute base PPP from shot mix for each team
    2. Scale by KenPom calibration factor so E[score] = KenPom projection
    3. Add distributional variance from Beta shooting draws
    """
    N = len(poss_arr)

    # ── TEAM A ────────────────────────────────────────────────────────────────
    ppp_A = expected_ppp(params_A)
    # KenPom calibration: scale factor so E[score_A] = kp_score_A
    # E[score_A] = ppp_A * poss_mean → scale = kp_score_A / (ppp_A * poss_mean)
    poss_mean = float(np.mean(poss_arr))
    scale_A = kp_score_A / max(0.1, ppp_A * poss_mean)
    scale_B = kp_score_B / max(0.1, expected_ppp(params_B) * poss_mean)

    # Beta variance for shooting (adds game-to-game variability)
    # Concentration parameters tuned for realistic ~10-12pt sigma per team
    # 2P% Beta: alpha = twoP * 12, beta = (1-twoP) * 12
    # 3P% Beta: alpha = threeP * 8, beta = (1-threeP) * 8 (3s are highly volatile)
    twoP_a_A  = max(0.5, params_A['twoP']  * 12.0)
    twoP_b_A  = max(0.5, (1.0 - params_A['twoP'])  * 12.0)
    threeP_a_A = max(0.5, params_A['threeP'] * 8.0)
    threeP_b_A = max(0.5, (1.0 - params_A['threeP']) * 8.0)

    twoP_a_B  = max(0.5, params_B['twoP']  * 12.0)
    twoP_b_B  = max(0.5, (1.0 - params_B['twoP'])  * 12.0)
    threeP_a_B = max(0.5, params_B['threeP'] * 8.0)
    threeP_b_B = max(0.5, (1.0 - params_B['threeP']) * 8.0)

    # Draw game-level shooting percentages from Beta distributions
    twoP_draws_A   = rng.beta(twoP_a_A,  twoP_b_A,  size=N)
    threeP_draws_A = rng.beta(threeP_a_A, threeP_b_A, size=N)
    twoP_draws_B   = rng.beta(twoP_a_B,  twoP_b_B,  size=N)
    threeP_draws_B = rng.beta(threeP_a_B, threeP_b_B, size=N)

    # Compute per-sim PPP using drawn shooting %
    def sim_ppp(params, twoP_d, threeP_d):
        p_TO  = params['p_TO']
        p_FGA = 1.0 - p_TO
        p_3PA = params['p_3PA']
        p_2PA = 1.0 - p_3PA
        FTR   = params['p_FTR']
        FTPct = params['FTPct']
        OR    = params['OR']

        pts_2pa = p_FGA * p_2PA * twoP_d * 2.0
        pts_3pa = p_FGA * p_3PA * threeP_d * 3.0
        pts_ft  = p_FGA * FTR * FTPct * 2.0

        miss_rate = p_FGA * p_2PA * (1.0 - twoP_d) + p_FGA * p_3PA * (1.0 - threeP_d)
        or_factor = 1.0 / np.maximum(0.5, 1.0 - OR * miss_rate)

        return (pts_2pa + pts_3pa + pts_ft) * or_factor

    ppp_sims_A = sim_ppp(params_A, twoP_draws_A, threeP_draws_A)
    ppp_sims_B = sim_ppp(params_B, twoP_draws_B, threeP_draws_B)

    # Score = PPP × possessions × calibration_scale
    scores_A = ppp_sims_A * poss_arr * scale_A
    scores_B = ppp_sims_B * poss_arr * scale_B

    # Add transition points (opponent TOs → fast break pts)
    # transition = 0.15 × opp_TO_rate × team_AdjT / 100 × poss
    trans_A = 0.15 * params_B['p_TO'] * (params_A.get('AdjT', LG_AVG_TEMPO) / 100.0) * poss_arr
    trans_B = 0.15 * params_A['p_TO'] * (params_B.get('AdjT', LG_AVG_TEMPO) / 100.0) * poss_arr

    scores_A += trans_A * scale_A
    scores_B += trans_B * scale_B

    return scores_A, scores_B

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7: MAIN SIMULATION
# ─────────────────────────────────────────────────────────────────────────────
def run_simulation(A: dict, B: dict, tournament: bool = True) -> dict:
    rng = np.random.default_rng()

    poss_mean, poss_sigma = possession_params(A, B, tournament)
    poss_arr = rng.normal(poss_mean, poss_sigma, size=N_SIM)
    poss_arr = np.maximum(poss_arr, 50.0)

    # KenPom matchup projection (anchor)
    kp_A, kp_B = kenpom_matchup_scores(A, B, poss_mean)

    # Shot mix parameters (interaction model)
    params_A = shot_mix_params(A, B)
    params_B = shot_mix_params(B, A)
    # Pass AdjT for transition calculation
    params_A['AdjT'] = A['AdjT']
    params_B['AdjT'] = B['AdjT']

    scores_A, scores_B = simulate_scores(
        params_A, params_B, kp_A, kp_B, poss_arr, rng
    )

    margin = scores_A - scores_B
    total  = scores_A + scores_B

    return dict(
        scores_A=scores_A, scores_B=scores_B,
        margin=margin, total=total,
        poss_mean=poss_mean,
        kp_A=kp_A, kp_B=kp_B,
    )

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8: MARKET ORIGINATION
# ─────────────────────────────────────────────────────────────────────────────
def originate_market(sim: dict, mkt_sp: float, mkt_to: float) -> dict:
    margin = sim['margin']
    total  = sim['total']
    scores_A = sim['scores_A']
    scores_B = sim['scores_B']

    # SPREAD: median of margin (away perspective: + = away favored)
    raw_spread = float(np.median(margin))
    model_spread = round_to_half(raw_spread)

    # TOTAL: median of total distribution
    raw_total = float(np.median(total))
    model_total = round_to_half(raw_total)

    # WIN PROBS
    p_A_win = float(np.mean(margin > 0))
    p_B_win = 1.0 - p_A_win

    # ML
    ML_A = prob_to_ml(p_A_win)
    ML_B = prob_to_ml(p_B_win)

    # SPREAD COVER AT MODEL LINE (for model fair odds)
    if model_spread == 0.0:
        spread_A_prob = p_A_win
    else:
        spread_A_prob = float(np.mean(margin > -model_spread))
    spread_B_prob = 1.0 - spread_A_prob

    # OVER/UNDER AT MODEL LINE (for model fair odds)
    p_over_model  = float(np.mean(total > model_total))
    p_under_model = 1.0 - p_over_model

    # COVER/OVER AT BOOK LINE (for edge detection and display odds)
    away_cover_book = float(np.mean(margin > -mkt_sp)) * 100.0
    home_cover_book = 100.0 - away_cover_book
    over_book  = float(np.mean(total > mkt_to)) * 100.0
    under_book = 100.0 - over_book

    # FAIR ODDS AT BOOK LINE (what the model says the book's line is worth)
    spread_A_fair = prob_to_ml(away_cover_book / 100.0)
    spread_B_fair = prob_to_ml(home_cover_book / 100.0)
    over_fair     = prob_to_ml(over_book / 100.0)
    under_fair    = prob_to_ml(under_book / 100.0)

    # For over_rate/under_rate fields (used for display)
    p_over  = p_over_model
    p_under = p_under_model

    return dict(
        raw_spread_away=raw_spread,
        model_spread=model_spread,
        model_total=model_total,
        p_A_win=p_A_win, p_B_win=p_B_win,
        ML_A=ML_A, ML_B=ML_B,
        spread_A_prob=spread_A_prob, spread_B_prob=spread_B_prob,
        spread_A_fair=spread_A_fair, spread_B_fair=spread_B_fair,
        p_over=p_over, p_under=p_under,
        over_fair=over_fair, under_fair=under_fair,
        away_cover=away_cover_book, home_cover=home_cover_book,
        over_rate=over_book, under_rate=under_book,
        sigma_A=float(np.std(scores_A)),
        sigma_B=float(np.std(scores_B)),
        sigma_margin=float(np.std(margin)),
        mean_A=float(np.mean(scores_A)),
        mean_B=float(np.mean(scores_B)),
    )

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9: EDGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
def detect_edges(
    mkt: dict, mkt_sp: float, mkt_to: float,
    mkt_ml_a, mkt_ml_h, away: str, home: str,
    spread_away_odds: int = -110, spread_home_odds: int = -110,
    over_odds: int = -110, under_odds: int = -110,
) -> list:
    edges = []
    sd = mkt['model_spread'] - mkt_sp
    td = mkt['model_total']  - mkt_to

    if abs(sd) >= SPREAD_EDGE_THRESH:
        true_away_sp, true_home_sp = vig_removed_be(spread_away_odds, spread_home_odds)
        if sd < 0:
            p_model = mkt['away_cover'] / 100.0
            prob_edge = p_model - true_away_sp
            if prob_edge > 0:
                edges.append({
                    'type': 'SPREAD', 'side': f'{away} +{abs(mkt_sp):.1f}',
                    'signal': f'Model {mkt["model_spread"]:+.4f} vs mkt {mkt_sp:+.1f} (Δ{sd:+.4f}pt)',
                    'cover_pct': round(mkt['away_cover'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, spread_away_odds),
                    'conf': edge_conf(prob_edge, sd),
                })
        else:
            p_model = mkt['home_cover'] / 100.0
            prob_edge = p_model - true_home_sp
            if prob_edge > 0:
                edges.append({
                    'type': 'SPREAD', 'side': f'{home} -{abs(mkt_sp):.1f}',
                    'signal': f'Model {mkt["model_spread"]:+.4f} vs mkt {mkt_sp:+.1f} (Δ{sd:+.4f}pt)',
                    'cover_pct': round(mkt['home_cover'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, spread_home_odds),
                    'conf': edge_conf(prob_edge, sd),
                })

    if abs(td) >= TOTAL_EDGE_THRESH:
        true_over, true_under = vig_removed_be(over_odds, under_odds)
        if td < 0:
            p_model = mkt['under_rate'] / 100.0
            prob_edge = p_model - true_under
            if prob_edge > 0:
                edges.append({
                    'type': 'TOTAL', 'side': f'UNDER {mkt_to}',
                    'signal': f'Model {mkt["model_total"]:.4f} vs mkt {mkt_to} (Δ{td:+.4f}pt)',
                    'cover_pct': round(mkt['under_rate'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, under_odds),
                    'conf': edge_conf(prob_edge, td),
                })
        else:
            p_model = mkt['over_rate'] / 100.0
            prob_edge = p_model - true_over
            if prob_edge > 0:
                edges.append({
                    'type': 'TOTAL', 'side': f'OVER {mkt_to}',
                    'signal': f'Model {mkt["model_total"]:.4f} vs mkt {mkt_to} (Δ{td:+.4f}pt)',
                    'cover_pct': round(mkt['over_rate'], 4),
                    'edge_vs_be': round(prob_edge * 100.0, 4),
                    'roi_pct': ev_roi(p_model, over_odds),
                    'conf': edge_conf(prob_edge, td),
                })

    if mkt_ml_h and mkt_ml_h != 0 and mkt_ml_a and mkt_ml_a != 0:
        true_away_ml, true_home_ml = vig_removed_be(mkt_ml_a, mkt_ml_h)
        p_h = mkt['p_B_win']
        prob_edge_h = p_h - true_home_ml
        if prob_edge_h >= 0.08:
            edges.append({
                'type': 'ML', 'side': home,
                'signal': f'Model win% {p_h*100:.2f}% vs mkt vig-free {true_home_ml*100:.2f}% (Δ{prob_edge_h*100:+.2f}%)',
                'cover_pct': round(p_h * 100.0, 4),
                'edge_vs_be': round(prob_edge_h * 100.0, 4),
                'roi_pct': ev_roi(p_h, mkt_ml_h),
                'conf': edge_conf(prob_edge_h),
            })
        p_a = mkt['p_A_win']
        prob_edge_a = p_a - true_away_ml
        if prob_edge_a >= 0.08:
            edges.append({
                'type': 'ML', 'side': away,
                'signal': f'Model win% {p_a*100:.2f}% vs mkt vig-free {true_away_ml*100:.2f}% (Δ{prob_edge_a*100:+.2f}%)',
                'cover_pct': round(p_a * 100.0, 4),
                'edge_vs_be': round(prob_edge_a * 100.0, 4),
                'roi_pct': ev_roi(p_a, mkt_ml_a),
                'conf': edge_conf(prob_edge_a),
            })

    return edges

# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENGINE ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────
def run_engine(inp: dict) -> dict:
    away_name = inp.get('away_team', '')
    home_name = inp.get('home_team', '')
    mkt_sp    = float(inp.get('mkt_sp', 0))
    mkt_to    = float(inp.get('mkt_to', 0))
    mkt_ml_a  = inp.get('mkt_ml_a')
    mkt_ml_h  = inp.get('mkt_ml_h')

    kenpom_email = inp.get('kenpom_email') or _os.environ.get('KENPOM_EMAIL', '') or 'taileredsportsbetting@gmail.com'
    kenpom_pass  = inp.get('kenpom_pass')  or _os.environ.get('KENPOM_PASSWORD', '') or '3$mHnYuV8iLcYau'

    import kenpompy.team as kpt
    from kenpompy.utils import login

    browser = login(kenpom_email, kenpom_pass)

    sa = kpt.get_scouting_report(browser, team=away_name, conference_only=False)
    sh = kpt.get_scouting_report(browser, team=home_name, conference_only=False)

    conf_a = str(sa.get('Conf', inp.get('conf_a', '')))
    conf_h = str(sh.get('Conf', inp.get('conf_h', '')))

    A = preprocess(sa)
    B = preprocess(sh)

    sim_raw = run_simulation(A, B, tournament=True)
    mkt = originate_market(sim_raw, mkt_sp, mkt_to)

    # model_spread = median(scores_A - scores_B)
    # Positive = away favored, Negative = home favored
    # away_sp_display: positive = underdog (+), negative = favorite (-)
    # Convention: away_sp_display = -model_spread so that:
    #   if home favored (model_spread < 0): away_sp_display = +abs(model_spread) ✓
    #   if away favored (model_spread > 0): away_sp_display = -abs(model_spread) ✓
    model_sp = mkt['model_spread']
    away_sp_display = -model_sp
    home_sp_display = +model_sp
    model_to = mkt['model_total']

    orig_away_score = (model_to - model_sp) / 2.0
    orig_home_score = (model_to + model_sp) / 2.0
    mkt_away_score  = (mkt_to - mkt_sp) / 2.0
    mkt_home_score  = (mkt_to + mkt_sp) / 2.0

    spread_away_odds = int(inp.get('spread_away_odds') or -110)
    spread_home_odds = int(inp.get('spread_home_odds') or -110)
    over_odds_val    = int(inp.get('over_odds') or -110)
    under_odds_val   = int(inp.get('under_odds') or -110)

    edges = detect_edges(
        mkt, mkt_sp, mkt_to, mkt_ml_a, mkt_ml_h,
        away_name, home_name,
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
        'orig_away_sp':    away_sp_display,
        'orig_home_sp':    home_sp_display,
        'orig_total':      model_to,
        'orig_away_score': round(orig_away_score, 2),
        'orig_home_score': round(orig_home_score, 2),
        'raw_away_score':  round(mkt['mean_A'], 2),
        'raw_home_score':  round(mkt['mean_B'], 2),
        'raw_away_sp':     round(mkt['raw_spread_away'], 2),
        'raw_home_sp':     round(-mkt['raw_spread_away'], 2),
        'raw_total':       round(mkt['mean_A'] + mkt['mean_B'], 2),
        'mkt_away_score':  round(mkt_away_score, 2),
        'mkt_home_score':  round(mkt_home_score, 2),
        'mkt_total':       mkt_to,
        'ml_away_pct':     round(mkt['p_A_win'] * 100.0, 4),
        'ml_home_pct':     round(mkt['p_B_win'] * 100.0, 4),
        'away_ml_fair':    mkt['ML_A'],
        'home_ml_fair':    mkt['ML_B'],
        'over_rate':       round(mkt['over_rate'], 4),
        'under_rate':      round(mkt['under_rate'], 4),
        'spread_clamped':  False,
        'total_clamped':   False,
        'cover_direction': 'OVER' if mkt['p_over'] > 0.5 else 'UNDER',
        'cover_adj':       0.0,
        'def_suppression': 1.0,
        'sigma_away':      round(mkt['sigma_A'], 4),
        'sigma_home':      round(mkt['sigma_B'], 4),
        'mkt_spread_away_odds': mkt['spread_A_fair'],
        'mkt_spread_home_odds': mkt['spread_B_fair'],
        'mkt_total_over_odds':  mkt['over_fair'],
        'mkt_total_under_odds': mkt['under_fair'],
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
            'mkt_spread_away_odds': 0, 'mkt_spread_home_odds': 0,
            'mkt_total_over_odds': 0, 'mkt_total_under_odds': 0,
            'edges': [], 'error': f'JSON parse error: {e}',
        }
        print(json.dumps(result))
        sys.exit(1)
    try:
        result = run_engine(inp)
    except Exception as e:
        import traceback
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
            'mkt_spread_away_odds': 0, 'mkt_spread_home_odds': 0,
            'mkt_total_over_odds': 0, 'mkt_total_under_odds': 0,
            'edges': [], 'error': str(e) + '\n' + traceback.format_exc(),
        }
        print(json.dumps(result))
        sys.exit(1)
    print(json.dumps(result))

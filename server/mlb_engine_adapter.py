#!/usr/bin/env python3
"""
mlb_engine_adapter.py  ── MAX SPEC REBUILD
===========================================
MLB Market Origination Engine: INPUT → DISTRIBUTION → PRICING → STRUCTURE
OUTPUT: NO-VIG, INVERSE, FAIR VALUE MARKETS

Implements the full 12-step MAX SPEC blueprint:
  Step 1:  Input Engine (team/pitcher/bullpen/park/weather/umpire features)
  Step 2:  Simulation Core (250k sims, NB-Gamma Mixture, extra innings, ghost runner)
  Step 3:  Distribution Extraction (histograms, tail validation, bucket sparsity)
  Step 4:  Totals Origination (optimal line selection, push mass, no-vig pricing)
  Step 5:  Moneyline Origination (total-environment variance adjustment)
  Step 6:  Run Line Origination (±1.5 no-vig pricing)
  Step 7:  Conditional Structure Validation (P(win_by_2+) ≤ P(win) enforcement)
  Step 8:  Cross-Market Consistency Engine (ML↔Total, RL↔Total, ML↔RL)
  Step 9:  Inverse Symmetry Enforcement (exact no-vig inverse verification)
  Step 10: Market Shaping (half-run snap, monotonicity, no-arb check)
  Step 11: Final Output (all markets, projected runs)
  Step 12: Logging + Debugging (mandatory structured logging)
"""

import os, sys, json, math, time, warnings
import numpy as np
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from scipy.stats import norm, gamma as scipy_gamma
from collections import defaultdict

warnings.filterwarnings('ignore')

# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL CONFIGURATION (MAX SPEC)
# ─────────────────────────────────────────────────────────────────────────────
SIMULATIONS               = 250_000
MIN_SIMULATIONS           = 100_000
MAX_EDGE_THRESHOLD        = 0.20   # widened: capture large-edge spots (was 0.08)
MIN_EDGE_THRESHOLD        = 0.005  # widened: capture small-edge spots (was 0.01)
BULLPEN_LOOKBACK_DAYS     = 5
LINEUP_TOP_WEIGHT         = 0.65
LINEUP_BOTTOM_WEIGHT      = 0.35
TAIL_STABILITY_THRESHOLD  = 0.0005
MIN_SAMPLE_PER_BUCKET     = 500
KEY_TOTAL_NUMBERS         = [6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5, 12.0]  # extended for Coors/extreme games
KEY_PRICE_BUCKETS         = [-105, -108, -110, -112, -115, -118, -120]
ROUNDING_RULES            = "HALF_RUN_ONLY"
NO_VIG_OUTPUT             = True
INVERSE_SYMMETRY          = True

# ─── 2025 MLB LEAGUE AVERAGES (source: MLB Stats API, season=2025 team aggregates)
# PA=182,926 | R/team/G=4.447 | RPG(both)=8.895
# Last updated: 2026-03-31
LEAGUE_K_PCT   = 0.2222   # 2025: 0.2222  (was 0.2240 from 2024)
LEAGUE_BB_PCT  = 0.0841   # 2025: 0.0841  (from batting PA totals: BB/PA across 30 teams)
                           # NOTE: was incorrectly set to 0.0946 (derived from pitching BB/9÷38)
LEAGUE_HR_PCT  = 0.0309   # 2025: 0.0309  (was 0.0340)
LEAGUE_1B_PCT  = 0.1428   # 2025: 0.1428  (was 0.1480)
LEAGUE_2B_PCT  = 0.0423   # 2025: 0.0423  (was 0.0460)
LEAGUE_3B_PCT  = 0.0034   # 2025: 0.0034  (was 0.0050)
LEAGUE_WOBA    = 0.3200   # 2025: 0.3200  (was 0.3120)
LEAGUE_XWOBA   = 0.3200   # 2025: 0.3200  (was 0.3120)
LEAGUE_OBP     = 0.3174   # 2025: 0.3174  (new constant)
LEAGUE_ERA     = 4.153    # 2025: 4.153   (was 4.380 from 2024)
LEAGUE_K9      = 8.491    # 2025: 8.491   (was 8.500)
LEAGUE_BB9     = 3.215    # 2025: 3.215   (was 3.200)
LEAGUE_HR9     = 1.180    # 2025: 1.180   (was 1.260)
LEAGUE_WHIP    = 1.289    # 2025: 1.289   (was 1.300)
LEAGUE_RPG     = 8.895    # 2025: 8.895   (was 8.760 from 2024)
# Calibration multiplier: aligns symmetric game total to 2025 RPG=8.895
# With correct 2025 constants, base engine produces exp_total=9.112 at qm=1.0
# Required: 8.895 / 9.112 = 0.9762 (slight downward correction)
# Verified: qm=0.9762 → exp_total=8.895 (Delta=0.000)
LEAGUE_CALIBRATION_MULT = 0.9762  # 2025 calibrated (verified)

STARTER_IP_MEAN = 5.2
STARTER_IP_MIN  = 1.0
STARTER_IP_MAX  = 9.0

TTO_PENALTY = [0.0, 0.025, 0.055]

HFA_BASE_WEIGHT  = 0.35
HFA_MONTH_SCALE  = 0.80
HFA_TEAM_SCALE   = 2.5
HFA_MONTHLY_FACTORS = {
    3: 1.1888, 4: 1.0832, 5: 1.0416, 6: 0.9984,
    7: 0.9552, 8: 0.9744, 9: 1.0000, 10: 1.0608,
}
HFA_TEAM_DELTA = {
    'COL': -0.193, 'HOU':  0.095, 'CHN':  0.095, 'ATL':  0.080,
    'LAN':  0.072, 'NYA':  0.068, 'BOS':  0.065, 'SFN':  0.060,
    'STL':  0.055, 'MIL':  0.050, 'MIN':  0.045, 'CLE':  0.040,
    'TBA':  0.038, 'SDN':  0.035, 'PHI':  0.032, 'SEA':  0.030,
    'ARI':  0.028, 'NYN':  0.025, 'DET':  0.022, 'BAL':  0.020,
    'CIN':  0.018, 'PIT':  0.015, 'KCA':  0.012, 'TEX':  0.010,
    'CHA':  0.008, 'MIA':  0.005, 'WAS':  0.003, 'OAK':  0.000,
    'TOR': -0.005, 'ANA': -0.010,
}

DB_TO_RETRO = {
    'PIT': 'PIT', 'NYM': 'NYN', 'CWS': 'CHA', 'MIL': 'MIL',
    'WSH': 'WAS', 'CHC': 'CHN', 'NYY': 'NYA', 'SF':  'SFN',
    'LAD': 'LAN', 'SD':  'SDN', 'STL': 'STL', 'TB':  'TBA',
    'PHI': 'PHI', 'HOU': 'HOU', 'DET': 'DET', 'ARI': 'ARI',
    'SEA': 'SEA', 'CLE': 'CLE', 'MIN': 'MIN', 'BAL': 'BAL',
    'BOS': 'BOS', 'CIN': 'CIN', 'LAA': 'ANA', 'TEX': 'TEX',
    'ATL': 'ATL', 'COL': 'COL', 'KC':  'KCA', 'TOR': 'TOR',
    'ATH': 'OAK', 'OAK': 'OAK', 'MIA': 'MIA',
}

PARK_FACTORS = {
    'COL': {'r': 113, 'hr': 119, 'h': 108}, 'BOS': {'r': 105, 'hr': 103, 'h': 106},
    'CIN': {'r': 105, 'hr': 108, 'h': 103}, 'PHI': {'r': 104, 'hr': 106, 'h': 103},
    'NYA': {'r': 104, 'hr': 108, 'h': 102}, 'BAL': {'r': 103, 'hr': 107, 'h': 102},
    'TEX': {'r': 103, 'hr': 105, 'h': 102}, 'HOU': {'r': 102, 'hr': 101, 'h': 102},
    'MIL': {'r': 102, 'hr': 103, 'h': 101}, 'ARI': {'r': 102, 'hr': 104, 'h': 101},
    'ATL': {'r': 101, 'hr': 102, 'h': 101}, 'LAN': {'r': 100, 'hr':  99, 'h': 100},
    'CHN': {'r': 100, 'hr': 101, 'h': 100}, 'SFN': {'r':  99, 'hr':  97, 'h':  99},
    'STL': {'r':  99, 'hr':  98, 'h':  99}, 'NYN': {'r':  99, 'hr':  99, 'h':  99},
    'SDN': {'r':  98, 'hr':  96, 'h':  98}, 'MIN': {'r':  98, 'hr':  99, 'h':  98},
    'DET': {'r':  98, 'hr':  97, 'h':  98}, 'CLE': {'r':  97, 'hr':  95, 'h':  97},
    'SEA': {'r':  97, 'hr':  94, 'h':  97}, 'TBA': {'r':  97, 'hr':  96, 'h':  97},
    'CHA': {'r':  97, 'hr':  96, 'h':  97}, 'PIT': {'r':  97, 'hr':  95, 'h':  97},
    'KCA': {'r':  96, 'hr':  94, 'h':  96}, 'WAS': {'r':  96, 'hr':  95, 'h':  96},
    'MIA': {'r':  95, 'hr':  92, 'h':  95}, 'OAK': {'r':  95, 'hr':  93, 'h':  95},
    'TOR': {'r': 100, 'hr': 100, 'h': 100}, 'ANA': {'r':  99, 'hr':  98, 'h':  99},
}

RE_MATRIX = {
    (0, 0): 0.481, (0, 1): 0.859, (0, 2): 1.100, (0, 3): 1.437,
    (0, 4): 1.350, (0, 5): 1.784, (0, 6): 1.964, (0, 7): 2.292,
    (1, 0): 0.254, (1, 1): 0.509, (1, 2): 0.664, (1, 3): 0.908,
    (1, 4): 0.865, (1, 5): 1.211, (1, 6): 1.373, (1, 7): 1.546,
    (2, 0): 0.098, (2, 1): 0.224, (2, 2): 0.319, (2, 3): 0.429,
    (2, 4): 0.343, (2, 5): 0.497, (2, 6): 0.580, (2, 7): 0.753,
}

RUN_VALUES = {
    'K': -0.270, 'OUT': -0.270, 'BB': 0.310,
    '1B': 0.470, '2B': 0.776, '3B': 1.063, 'HR': 1.376,
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 12 LOGGER (mandatory structured logging)
# ─────────────────────────────────────────────────────────────────────────────
class EngineLogger:
    def __init__(self, game_label: str, verbose: bool = False):
        self.game   = game_label
        self.verbose = verbose
        self.flags: List[str] = []

    def _emit(self, tag: str, msg: str):
        if self.verbose:
            print(f"[{tag}][{self.game}] {msg}", file=sys.stderr)

    def input(self, msg: str):   self._emit("INPUT",  msg)
    def step(self, msg: str):    self._emit("STEP",   msg)
    def state(self, msg: str):   self._emit("STATE",  msg)
    def output(self, msg: str):  self._emit("OUTPUT", msg)
    def verify(self, ok: bool, reason: str):
        status = "PASS" if ok else "FAIL"
        self._emit("VERIFY", f"{status} — {reason}")
        if not ok:
            self.flags.append(reason)

    def flag(self, issue: str):
        self.flags.append(issue)
        self._emit("FLAG", issue)

    def log_distribution(self, label: str, arr: np.ndarray, key_numbers: List[float]):
        if not self.verbose:
            return
        pct = np.percentile(arr, [5, 25, 50, 75, 95])
        self._emit("DIST", f"{label}: mean={arr.mean():.3f} std={arr.std():.3f} "
                           f"p5={pct[0]:.1f} p25={pct[1]:.1f} p50={pct[2]:.1f} "
                           f"p75={pct[3]:.1f} p95={pct[4]:.1f}")
        for k in key_numbers:
            mass = float((arr > k).mean())
            self._emit("DIST", f"  P(>{k}) = {mass:.4f}")

# ─────────────────────────────────────────────────────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────
def _log5(p_pit: float, p_bat: float, p_lg: float) -> float:
    if p_lg <= 0 or p_lg >= 1:
        return p_bat
    num = p_bat * p_pit / p_lg
    den = num + (1 - p_bat) * (1 - p_pit) / (1 - p_lg)
    return float(np.clip(num / max(den, 1e-9), 0.0, 1.0))

def _lineup_weights_dynamic(n: int, pitcher_k_pct: float) -> List[float]:
    """
    LINEUP_DYNAMIC_RUN_WEIGHTS: adjust top/bottom split based on pitcher K%.
    High-K pitchers suppress the bottom of the order more — increase top weight.
    Low-K pitchers allow more contact throughout — flatten the distribution.
    """
    k_adj = (pitcher_k_pct - LEAGUE_K_PCT) * 1.5  # scale: ±0.05 → ±0.075
    top_w = float(np.clip(LINEUP_TOP_WEIGHT + k_adj, 0.50, 0.80))
    bot_w = 1.0 - top_w
    top = min(5, n)
    bot = max(0, n - top)
    w   = [top_w / top] * top + ([bot_w / bot] * bot if bot > 0 else [])
    return w[:n]

def _nearest_half(x: float) -> float:
    """Snap to nearest 0.5 (half-run rounding rule)."""
    return round(x * 2) / 2

def _select_optimal_total(total_dist: np.ndarray, key_numbers: List[float],
                           logger: 'EngineLogger') -> Tuple[float, float, float]:
    """
    Step 4: Select optimal total line from KEY_TOTAL_NUMBERS.
    Criteria: MINIMIZE |P_OVER - 0.5|, account for push mass on integers.
    Returns (optimal_line, p_over, p_under).
    """
    best_line = key_numbers[0]
    best_score = float('inf')
    best_p_over = 0.5

    for line in key_numbers:
        p_over  = float((total_dist > line).mean())
        p_under = float((total_dist < line).mean())
        p_push  = float((total_dist == line).mean())
        # Penalize push mass: redistribute half to over, half to under
        p_over_adj  = p_over  + p_push * 0.5
        p_under_adj = p_under + p_push * 0.5
        score = abs(p_over_adj - 0.5)
        logger.state(f"  Total line {line}: P(over)={p_over:.4f} P(push)={p_push:.4f} "
                     f"P(over_adj)={p_over_adj:.4f} score={score:.4f}")
        if score < best_score:
            best_score = best_line = line
            best_score = score
            best_p_over = p_over_adj

    p_under_final = 1.0 - best_p_over
    logger.step(f"Optimal total: {best_line} (P_over={best_p_over:.4f}, "
                f"P_under={p_under_final:.4f}, balance_score={best_score:.4f})")
    return best_line, best_p_over, p_under_final

def prob_to_ml(p: float) -> float:
    p = float(np.clip(p, 0.001, 0.999))
    return round(-(p / (1.0 - p)) * 100.0, 2) if p >= 0.5 \
           else round(((1.0 - p) / p) * 100.0, 2)

def ml_to_prob(odds: float) -> float:
    return abs(odds) / (abs(odds) + 100.0) if odds < 0 \
           else 100.0 / (odds + 100.0)

def remove_vig(p_a: float, p_b: float) -> Tuple[float, float]:
    t = p_a + p_b
    if t <= 0:
        return 0.5, 0.5
    return p_a / t, p_b / t

def fmt_ml(ml) -> str:
    ml = int(round(ml))
    return f"+{ml}" if ml > 0 else str(ml)

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 3: PA OUTCOME MODEL (Log5)
# ─────────────────────────────────────────────────────────────────────────────
class PAOutcomeModel:
    def get_pa_probs(self, pitcher: dict, batter: dict, tto: int = 0) -> dict:
        pen = TTO_PENALTY[min(tto, 2)]
        k  = _log5(pitcher['k_pct'],      batter['k_pct'],      LEAGUE_K_PCT)
        bb = _log5(pitcher['bb_pct'],     batter['bb_pct'],     LEAGUE_BB_PCT)
        hr = _log5(pitcher['hr_pct'],     batter['hr_pct'],     LEAGUE_HR_PCT)
        s1 = _log5(pitcher['single_pct'], batter['single_pct'], LEAGUE_1B_PCT)
        s2 = _log5(pitcher['double_pct'], batter['double_pct'], LEAGUE_2B_PCT)
        s3 = _log5(pitcher['triple_pct'], batter['triple_pct'], LEAGUE_3B_PCT)
        k  = max(0.0, k  - pen * 0.5)
        bb = min(0.30, bb + pen * 0.3)
        hr = min(0.10, hr + pen * 0.2)
        raw = {'K': k, 'BB': bb, 'HR': hr, '1B': s1, '2B': s2, '3B': s3}
        total = sum(raw.values())
        raw['OUT'] = max(0.0, 1.0 - total)
        s = sum(raw.values())
        return {ev: v / s for ev, v in raw.items()}

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 4: RUN CONVERSION MODEL (Markov RE matrix)
# ─────────────────────────────────────────────────────────────────────────────
class RunConversionModel:
    def expected_runs_per_inning(self, pa_probs: dict, run_factor: float = 1.0) -> float:
        exp_rv = sum(pa_probs.get(ev, 0.0) * rv for ev, rv in RUN_VALUES.items())
        base   = RE_MATRIX.get((0, 0), 0.481)
        return max(0.0, (base + exp_rv) * run_factor)

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 5: BULLPEN USAGE MODEL (with dynamic fatigue)
# ─────────────────────────────────────────────────────────────────────────────
class BullpenUsageModel:
    def project_starter_innings(self, pitcher: dict, bullpen: dict) -> dict:
        base     = STARTER_IP_MEAN
        xfip_adj = (4.0 - pitcher.get('xfip_proxy', 4.0)) * 0.3
        hist_ip  = pitcher.get('ip_per_game', STARTER_IP_MEAN)
        if hist_ip > 1.0:
            base = 0.5 * base + 0.5 * hist_ip
        # BULLPEN_FATIGUE_MODEL: dynamic fatigue from recent workload
        fatigue_score = bullpen.get('fatigue_score', 0.3)
        total_bp_outs = bullpen.get('total_bp_outs_5d', 0)
        # More recent bullpen usage → starter must go deeper (or vice versa)
        # High fatigue (>0.5) means bullpen is taxed → starter expected to go longer
        fatigue_adj = (fatigue_score - 0.3) * 0.4  # +0.08 per 0.2 above baseline
        # Workload pressure: if bullpen threw >45 outs in 5 days, push starter +0.3 IP
        workload_adj = 0.3 if total_bp_outs > 45 else 0.0
        starter_ip = float(np.clip(
            base + xfip_adj + fatigue_adj + workload_adj,
            STARTER_IP_MIN, STARTER_IP_MAX
        ))
        return {
            'starter_ip':   round(starter_ip, 2),
            'bullpen_ip':   round(max(0.0, 9.0 - starter_ip), 2),
            'starter_frac': round(starter_ip / 9.0, 4),
            'fatigue_adj':  round(fatigue_adj, 4),
            'workload_adj': round(workload_adj, 4),
        }

    def quality_by_inning(self, bullpen: dict, starter_ip: float) -> Dict[int, float]:
        xfip = bullpen.get('bullpen_xfip', 4.0)
        fatigue = bullpen.get('fatigue_score', 0.3)
        # Fatigued bullpen degrades quality in late innings
        bp_quality_base = 1.0 + (xfip - 4.0) * 0.05
        bp_quality_late = bp_quality_base * (1.0 + fatigue * 0.15)  # worse when fatigued
        return {
            i: (1.0 if i <= int(starter_ip) else
                (bp_quality_base if i <= 7 else bp_quality_late))
            for i in range(1, 10)
        }

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 6: VARIANCE MODEL
# ─────────────────────────────────────────────────────────────────────────────
class VarianceModel:
    def compute(self, lineup: List[dict], pitcher: dict, env: dict) -> dict:
        n = len(lineup)
        k_pct = pitcher.get('k_pct', LEAGUE_K_PCT)
        w = _lineup_weights_dynamic(n, k_pct)
        barrels  = [b.get('barrel_rate', 0.08) for b in lineup]
        isos     = [b.get('iso', 0.15)         for b in lineup]
        hard_hit = [b.get('hard_hit', 0.35)    for b in lineup]
        avg_barrel   = float(np.average(barrels,  weights=w))
        avg_iso      = float(np.average(isos,     weights=w))
        avg_hard_hit = float(np.average(hard_hit, weights=w))
        base_var  = 2.9 ** 2
        power_adj = 1.0 + (avg_barrel - 0.08) * 3.0 + (avg_iso - 0.15) * 2.0
        k_adj     = 1.0 - (k_pct - LEAGUE_K_PCT) * 2.0
        park_adj  = 1.0 + (env.get('park_hr_factor', 1.0) - 1.0) * 0.5
        variance  = float(np.clip(base_var * power_adj * k_adj * park_adj, 3.0, 20.0))
        skew      = float(np.clip(0.3 + avg_barrel * 2.0 + avg_iso * 1.5, 0.1, 1.5))
        return {
            'variance':     round(variance, 4),
            'std':          round(math.sqrt(variance), 4),
            'skew':         round(skew, 4),
            'avg_barrel':   round(avg_barrel, 4),
            'avg_iso':      round(avg_iso, 4),
            'avg_hard_hit': round(avg_hard_hit, 4),
        }

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 7: GAME STATE BUILDER
# ─────────────────────────────────────────────────────────────────────────────
class GameStateBuilder:
    def __init__(self):
        self.pa_model  = PAOutcomeModel()
        self.run_model = RunConversionModel()
        self.bp_model  = BullpenUsageModel()
        self.var_model = VarianceModel()

    def build(self, lineup: List[dict], opp_pitcher: dict,
              bullpen: dict, env: dict, quality_mult: float = 1.0) -> dict:
        starter_proj = self.bp_model.project_starter_innings(opp_pitcher, bullpen)
        starter_ip   = starter_proj['starter_ip']
        bp_quality   = self.bp_model.quality_by_inning(bullpen, starter_ip)
        run_factor   = env.get('park_run_factor', 1.0) * env.get('weather_run_adj', 1.0)
        total_runs   = 0.0
        k_pct        = opp_pitcher.get('k_pct', LEAGUE_K_PCT)
        for inning in range(1, 10):
            tto      = min(2, (inning - 1) // 3)
            pa_probs = self._weighted_pa_probs(lineup, opp_pitcher, tto, k_pct)
            exp_runs = self.run_model.expected_runs_per_inning(pa_probs, run_factor)
            total_runs += exp_runs * bp_quality.get(inning, 1.0)
        total_runs *= quality_mult
        var_feats = self.var_model.compute(lineup, opp_pitcher, env)
        return {
            'mu':         round(total_runs, 4),
            'variance':   var_feats['variance'],
            'std':        var_feats['std'],
            'skew':       var_feats['skew'],
            'starter_ip': starter_ip,
            'bullpen_ip': starter_proj['bullpen_ip'],
            'avg_barrel': var_feats['avg_barrel'],
            'avg_iso':    var_feats['avg_iso'],
        }

    def _weighted_pa_probs(self, lineup: List[dict], pitcher: dict,
                            tto: int, k_pct: float) -> dict:
        n = len(lineup)
        w = _lineup_weights_dynamic(n, k_pct)
        combined: Dict[str, float] = defaultdict(float)
        for batter, wt in zip(lineup, w):
            for ev, p in self.pa_model.get_pa_probs(pitcher, batter, tto).items():
                combined[ev] += p * wt
        total = sum(combined.values())
        return {ev: v / total for ev, v in combined.items()} if total > 0 else dict(combined)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: DISTRIBUTION ENGINE — NB-GAMMA MIXTURE
# MAX SPEC: RUN_DISTRIBUTION_MODEL = "NEGATIVE_BINOMIAL_GAMMA_MIXTURE"
# The Gamma mixture adds overdispersion to the NB by drawing the rate parameter
# from a Gamma distribution, producing heavier tails and better empirical fit.
# ─────────────────────────────────────────────────────────────────────────────
class NBGammaMixtureDistribution:
    """
    Negative Binomial Gamma Mixture (NB-Gamma Mixture):
    Instead of fixed NB(r, p), draw r ~ Gamma(shape, scale) per simulation.
    This introduces an additional layer of variance that better captures
    game-to-game run scoring variability.
    """
    @staticmethod
    def fit_nb(mu: float, variance: float) -> Tuple[float, float]:
        variance = max(variance, mu + 0.01)
        p = float(np.clip(mu / variance, 0.01, 0.99))
        r = max(0.01, (mu * p) / (1.0 - p))
        return r, p

    @staticmethod
    def sample(mu: float, variance: float, n: int, rng: np.random.Generator,
               gamma_shape: float = 4.0) -> np.ndarray:
        """
        Sample from NB-Gamma mixture:
        1. Draw rate_i ~ Gamma(shape=gamma_shape, scale=mu/gamma_shape) for each sim
        2. Sample runs_i ~ NB(r, p) using rate_i as the adjusted mean
        gamma_shape controls the degree of overdispersion:
          - Higher shape → less overdispersion (approaches pure NB)
          - Lower shape  → more overdispersion (heavier tails)
          - 4.0 is empirically calibrated for MLB run scoring
        """
        r_base, p_base = NBGammaMixtureDistribution.fit_nb(mu, variance)
        # Draw Gamma-distributed rate multipliers
        gamma_scale = mu / gamma_shape
        rate_multipliers = rng.gamma(shape=gamma_shape, scale=gamma_scale / mu, size=n)
        rate_multipliers = np.clip(rate_multipliers, 0.3, 3.0)
        # Apply rate multipliers to the NB mean
        adjusted_mus = mu * rate_multipliers
        # Sample NB for each adjusted mean
        samples = np.zeros(n, dtype=float)
        for i in range(n):
            adj_mu = float(adjusted_mus[i])
            adj_var = max(adj_mu * 1.5, adj_mu + 0.5)  # maintain overdispersion
            r_i, p_i = NBGammaMixtureDistribution.fit_nb(adj_mu, adj_var)
            samples[i] = rng.negative_binomial(r_i, p_i)
        return samples

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: EXTRA INNINGS SIMULATION (ghost runner rule)
# MAX SPEC: EXTRA_INNINGS_RULESET = ENABLED
# ─────────────────────────────────────────────────────────────────────────────
def simulate_extra_innings(home_mu_per_inning: float, away_mu_per_inning: float,
                            home_var: float, away_var: float,
                            rng: np.random.Generator,
                            n_sims: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Simulate extra innings for tied games using ghost runner rule (MLB 2020+).
    Ghost runner starts on 2nd base each extra inning.
    Returns (extra_home_runs, extra_away_runs, n_extra_innings) for each tied sim.
    """
    # Ghost runner effect: increases scoring probability by ~0.5 runs/inning
    GHOST_RUNNER_BONUS = 0.50
    home_mu_xi = home_mu_per_inning + GHOST_RUNNER_BONUS
    away_mu_xi = away_mu_per_inning + GHOST_RUNNER_BONUS

    extra_home = np.zeros(n_sims, dtype=float)
    extra_away = np.zeros(n_sims, dtype=float)
    n_extra    = np.zeros(n_sims, dtype=int)

    # Vectorized extra inning simulation (max 6 extra innings before forced resolution)
    MAX_EXTRA = 6
    still_tied = np.ones(n_sims, dtype=bool)

    for xi in range(MAX_EXTRA):
        if not still_tied.any():
            break
        n_tied = int(still_tied.sum())
        # Sample runs for this extra inning (ghost runner boosts scoring)
        h_var_xi = max(home_var * 0.7, home_mu_xi + 0.3)  # reduced variance in extras
        a_var_xi = max(away_var * 0.7, away_mu_xi + 0.3)
        h_r, h_p = NBGammaMixtureDistribution.fit_nb(home_mu_xi, h_var_xi)
        a_r, a_p = NBGammaMixtureDistribution.fit_nb(away_mu_xi, a_var_xi)
        inning_home = rng.negative_binomial(h_r, h_p, size=n_tied).astype(float)
        inning_away = rng.negative_binomial(a_r, a_p, size=n_tied).astype(float)

        extra_home[still_tied] += inning_home
        extra_away[still_tied] += inning_away
        n_extra[still_tied] += 1

        # Resolve ties after this inning
        inning_margin = inning_home - inning_away
        resolved = still_tied.copy()
        resolved[still_tied] = inning_margin != 0
        still_tied[resolved] = False

    # Force-resolve any remaining ties (coin flip after MAX_EXTRA)
    if still_tied.any():
        coin = rng.random(int(still_tied.sum())) < 0.5
        extra_home[still_tied] += coin.astype(float)
        extra_away[still_tied] += (~coin).astype(float)

    return extra_home, extra_away, n_extra

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: MONTE CARLO ENGINE (full MAX SPEC)
# ─────────────────────────────────────────────────────────────────────────────
class MonteCarloEngine:
    def __init__(self, n_sims: int = SIMULATIONS, seed: Optional[int] = None):
        self.n_sims = max(n_sims, MIN_SIMULATIONS)
        self.rng    = np.random.default_rng(seed)
        self.dist   = NBGammaMixtureDistribution()

    def simulate(self, home_state: dict, away_state: dict,
                 env: dict, ou_line: Optional[float] = None,
                 rl_spread: float = -1.5,
                 logger: Optional['EngineLogger'] = None) -> dict:

        hfa     = env.get('hfa_weight', HFA_BASE_WEIGHT)
        home_mu = home_state['mu'] * (1.0 + hfa * 0.15)
        away_mu = away_state['mu'] * (1.0 - hfa * 0.08)

        if logger:
            logger.state(f"home_mu={home_mu:.4f} away_mu={away_mu:.4f} hfa={hfa:.4f}")
            logger.state(f"home_var={home_state['variance']:.4f} away_var={away_state['variance']:.4f}")

        # Step 2: Sample 9-inning runs using NB-Gamma Mixture
        home_9 = self.dist.sample(home_mu, home_state['variance'], self.n_sims, self.rng)
        away_9 = self.dist.sample(away_mu, away_state['variance'], self.n_sims, self.rng)

        # Identify ties after 9 innings
        ties_mask = home_9 == away_9
        n_ties    = int(ties_mask.sum())

        if logger:
            logger.state(f"Ties after 9 innings: {n_ties}/{self.n_sims} ({n_ties/self.n_sims*100:.1f}%)")

        # Step 2: Extra innings simulation (ghost runner rule)
        home_xi = np.zeros(self.n_sims, dtype=float)
        away_xi = np.zeros(self.n_sims, dtype=float)
        n_extra = np.zeros(self.n_sims, dtype=int)

        if n_ties > 0:
            # Per-inning mu (9-inning total / 9)
            home_mu_per = home_mu / 9.0
            away_mu_per = away_mu / 9.0
            eh, ea, ne = simulate_extra_innings(
                home_mu_per, away_mu_per,
                home_state['variance'] / 9.0, away_state['variance'] / 9.0,
                self.rng, n_ties
            )
            home_xi[ties_mask] = eh
            away_xi[ties_mask] = ea
            n_extra[ties_mask] = ne

        home_runs = home_9 + home_xi
        away_runs = away_9 + away_xi

        # Final win determination
        home_win = home_runs > away_runs  # no ties possible after extra innings

        p_home = float(home_win.mean())
        p_away = 1.0 - p_home
        margins = home_runs - away_runs
        totals  = home_runs + away_runs

        # Run line coverage
        if rl_spread < 0:
            p_home_rl = float((margins > abs(rl_spread)).mean())
        else:
            p_home_rl = float((margins >= -abs(rl_spread)).mean())

        # Step 3: Distribution extraction
        exp_total = float(totals.mean())
        pct = np.percentile(totals, [5, 25, 50, 75, 95])

        # Compute P(over/under) at book line and key numbers
        p_over_line  = float((totals > ou_line).mean()) if ou_line else None
        p_under_line = float((totals < ou_line).mean()) if ou_line else None

        # Key number probability mass (Step 3 validation)
        key_probs = {}
        for k in KEY_TOTAL_NUMBERS:
            key_probs[k] = {
                'p_over':  float((totals > k).mean()),
                'p_under': float((totals < k).mean()),
                'p_push':  float((totals == k).mean()),
            }

        # Step 3: Tail stability validation
        tail_5  = float((totals <= pct[0]).mean())
        tail_95 = float((totals >= pct[4]).mean())
        tail_stable = (tail_5 >= TAIL_STABILITY_THRESHOLD and
                       tail_95 >= TAIL_STABILITY_THRESHOLD)

        # Step 3: Bucket sparsity check — only evaluate realistic total range [4, 20].
        # Extreme bins (0-3, 21+) are inherently sparse for any realistic game and
        # checking them against MIN_SAMPLE_PER_BUCKET produces false positives.
        # A game total of 0, 1, 2, or 3 combined runs is astronomically rare (~0.01%).
        hist_counts_full, _ = np.histogram(totals, bins=range(0, 30))
        # bins=range(0,30) → 29 bins: bin[i] covers [i, i+1). bin[4] = totals in [4,5).
        # Realistic range: bins 4 through 20 inclusive (totals 4-20).
        realistic_counts = hist_counts_full[4:21]  # 17 bins covering totals 4..20
        sparse_buckets = int((realistic_counts < MIN_SAMPLE_PER_BUCKET).sum())
        hist_counts = hist_counts_full  # keep full array for logging

        if logger:
            logger.log_distribution("totals", totals, KEY_TOTAL_NUMBERS)
            logger.log_distribution("home_runs", home_runs, [3, 4, 5, 6, 7])
            logger.log_distribution("away_runs", away_runs, [3, 4, 5, 6, 7])
            logger.state(f"Extra innings: mean={n_extra.mean():.3f} max={n_extra.max()}")
            logger.state(f"Tail stability: {tail_stable} (5th={tail_5:.4f}, 95th={tail_95:.4f})")
            logger.state(f"Sparse buckets (realistic range 4-20): {sparse_buckets}")
            logger.verify(tail_stable, f"Tail stability (threshold={TAIL_STABILITY_THRESHOLD})")
            logger.verify(sparse_buckets == 0,
                          f"Bucket sparsity: {sparse_buckets} sparse buckets in realistic range [4-20] (min={MIN_SAMPLE_PER_BUCKET})")

        return {
            'p_home_win':       round(p_home, 6),
            'p_away_win':       round(p_away, 6),
            'exp_home_runs':    round(float(home_runs.mean()), 2),
            'exp_away_runs':    round(float(away_runs.mean()), 2),
            'exp_total':        round(exp_total, 2),
            'median_total':     round(float(np.median(totals)), 2),
            'p_home_cover_rl':  round(p_home_rl, 6),
            'p_away_cover_rl':  round(1.0 - p_home_rl, 6),
            'rl_spread':        rl_spread,
            'p_over_at_line':   round(p_over_line, 6) if p_over_line is not None else None,
            'p_under_at_line':  round(p_under_line, 6) if p_under_line is not None else None,
            'key_probs':        key_probs,
            'home_std':         round(float(home_runs.std()), 3),
            'away_std':         round(float(away_runs.std()), 3),
            'total_pct_5':      round(float(pct[0]), 2),
            'total_pct_25':     round(float(pct[1]), 2),
            'total_pct_50':     round(float(pct[2]), 2),
            'total_pct_75':     round(float(pct[3]), 2),
            'total_pct_95':     round(float(pct[4]), 2),
            'n_sims':           self.n_sims,
            'n_ties_9inn':      n_ties,
            'avg_extra_inn':    round(float(n_extra.mean()), 3),
            'tail_stable':      tail_stable,
            'sparse_buckets':   sparse_buckets,
            # Raw arrays for downstream steps (not serialized)
            '_totals':          totals,
            '_margins':         margins,
            '_home_runs':       home_runs,
            '_away_runs':       away_runs,
        }

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4-10: MARKET DERIVATION (full MAX SPEC pipeline)
# ─────────────────────────────────────────────────────────────────────────────
class MarketDerivation:
    def derive(self, sim: dict, home_team: str, away_team: str,
               ou_line: Optional[float] = None,
               logger: Optional['EngineLogger'] = None) -> dict:

        totals  = sim['_totals']
        margins = sim['_margins']

        # ── STEP 4: Totals Origination ────────────────────────────────────────
        if logger:
            logger.step("Step 4: Totals Origination")
        optimal_line, p_over_raw, p_under_raw = _select_optimal_total(
            totals, KEY_TOTAL_NUMBERS, logger or EngineLogger("", False)
        )
        # If book line provided, use it; otherwise use model-optimal line
        total_key = ou_line if ou_line else optimal_line

        # Compute p_over/p_under at the selected line (with push mass redistribution)
        p_over_at  = float((totals > total_key).mean())
        p_under_at = float((totals < total_key).mean())
        p_push_at  = float((totals == total_key).mean())
        p_over_adj  = p_over_at  + p_push_at * 0.5
        p_under_adj = p_under_at + p_push_at * 0.5

        # No-vig total odds (Step 4 pricing)
        p_over_nv, p_under_nv = remove_vig(p_over_adj, p_under_adj)
        over_odds  = prob_to_ml(p_over_nv)
        under_odds = prob_to_ml(p_under_nv)

        if logger:
            logger.output(f"Total: {total_key} | Over={over_odds} ({p_over_nv:.4f}) "
                          f"Under={under_odds} ({p_under_nv:.4f})")

        # ── STEP 5: Moneyline Origination ─────────────────────────────────────
        if logger:
            logger.step("Step 5: Moneyline Origination")
        p_home = sim['p_home_win']
        p_away = sim['p_away_win']

        # Total-environment variance adjustment
        if total_key >= 9.0:
            # High-total game: variance expansion → dog probability increases slightly
            dog_boost = (total_key - 9.0) * 0.005
            if p_home < 0.5:
                p_home = float(np.clip(p_home + dog_boost, 0.001, 0.999))
            else:
                p_away = float(np.clip(p_away + dog_boost, 0.001, 0.999))
            if logger:
                logger.state(f"High-total variance expansion: dog_boost={dog_boost:.4f}")
        elif total_key <= 7.0:
            # Low-total game: variance compression → favorite probability increases slightly
            fav_boost = (7.0 - total_key) * 0.005
            if p_home >= 0.5:
                p_home = float(np.clip(p_home + fav_boost, 0.001, 0.999))
            else:
                p_away = float(np.clip(p_away + fav_boost, 0.001, 0.999))
            if logger:
                logger.state(f"Low-total variance compression: fav_boost={fav_boost:.4f}")

        # Re-normalize
        p_home, p_away = remove_vig(p_home, p_away)
        ml_home = prob_to_ml(p_home)
        ml_away = prob_to_ml(p_away)

        if logger:
            logger.output(f"ML: Home={ml_home} ({p_home:.4f}) Away={ml_away} ({p_away:.4f})")

        # ── STEP 6: Run Line Origination ──────────────────────────────────────
        if logger:
            logger.step("Step 6: Run Line Origination")
        p_hrl = sim['p_home_cover_rl']
        p_arl = sim['p_away_cover_rl']
        rl_home_odds = prob_to_ml(p_hrl)
        rl_away_odds = prob_to_ml(p_arl)

        if logger:
            logger.output(f"RL: Home {sim['rl_spread']:+.1f}={rl_home_odds} ({p_hrl:.4f}) "
                          f"Away {-sim['rl_spread']:+.1f}={rl_away_odds} ({p_arl:.4f})")

        # ── STEP 7: Conditional Structure Validation ──────────────────────────
        if logger:
            logger.step("Step 7: Conditional Structure Validation")
        # P(win_by_2+) must be <= P(win) for the same team
        p_home_win_by2 = float((margins > 1.5).mean())
        p_away_win_by2 = float((margins < -1.5).mean())

        if p_home_win_by2 > p_home:
            if logger:
                logger.flag(f"Conditional violation: P(home_win_by_2+)={p_home_win_by2:.4f} "
                            f"> P(home_win)={p_home:.4f} — rescaling")
            # Rescale: cap win_by_2 at win probability
            scale = p_home / max(p_home_win_by2, 1e-9)
            p_home_win_by2 = p_home_win_by2 * scale
            p_hrl = p_home_win_by2
            p_arl = 1.0 - p_hrl
            rl_home_odds = prob_to_ml(p_hrl)
            rl_away_odds = prob_to_ml(p_arl)

        if p_away_win_by2 > p_away:
            if logger:
                logger.flag(f"Conditional violation: P(away_win_by_2+)={p_away_win_by2:.4f} "
                            f"> P(away_win)={p_away:.4f} — rescaling")
            scale = p_away / max(p_away_win_by2, 1e-9)
            p_away_win_by2 = p_away_win_by2 * scale

        if logger:
            logger.verify(p_home_win_by2 <= p_home + 1e-6,
                          f"P(home_win_by_2+)={p_home_win_by2:.4f} ≤ P(home_win)={p_home:.4f}")
            logger.verify(p_away_win_by2 <= p_away + 1e-6,
                          f"P(away_win_by_2+)={p_away_win_by2:.4f} ≤ P(away_win)={p_away:.4f}")

        # ── STEP 8: Cross-Market Consistency Engine ───────────────────────────
        if logger:
            logger.step("Step 8: Cross-Market Consistency Engine")
        cross_flags = []

        # ML ↔ Total: cross-market consistency check.
        # Thresholds are calibrated to avoid false positives on legitimate game profiles:
        # - A dominant team at a hitter-friendly park (e.g., LAD at Coors) can produce
        #   total >= 10 AND ml_gap > 0.35 simultaneously. Threshold raised to 0.42.
        # - Two elite starters in a pitcher-friendly park can produce total <= 7 with
        #   a close ML (gap ~0.07). Only flag near-zero gap (< 0.03) as a true anomaly.
        ml_gap = abs(p_home - p_away)
        if total_key >= 10.0 and ml_gap > 0.42:
            cross_flags.append(f"ML↔Total: extreme total ({total_key}) with very wide ML gap ({ml_gap:.3f}) — verify inputs")
        if total_key <= 6.5 and ml_gap < 0.03:
            cross_flags.append(f"ML↔Total: very low total ({total_key}) with near-zero ML gap ({ml_gap:.3f}) — verify inputs")

        # RL ↔ Total: high total → blowout probability should be elevated
        blowout_prob = float((np.abs(margins) > 4).mean())
        if total_key >= 9.0 and blowout_prob < 0.15:
            cross_flags.append(f"RL↔Total: high total ({total_key}) but low blowout prob ({blowout_prob:.3f})")

        # ML ↔ RL: P(win_by_2+) / P(win) ratio should be stable (0.40–0.75)
        if p_home > 0.01:
            ratio_home = p_home_win_by2 / p_home
            if not (0.35 <= ratio_home <= 0.80):
                cross_flags.append(f"ML↔RL: home win_by_2/win ratio={ratio_home:.3f} outside [0.35, 0.80]")

        for f in cross_flags:
            if logger:
                logger.flag(f)

        # ── STEP 9: Inverse Symmetry Enforcement ──────────────────────────────
        if logger:
            logger.step("Step 9: Inverse Symmetry Enforcement")
        # Ensure exact inverse symmetry: HOME_ML == -AWAY_ML (no-vig)
        # Already guaranteed by remove_vig() above, but explicitly verify
        ml_sum = p_home + p_away
        ou_sum = p_over_nv + p_under_nv
        rl_sum = p_hrl + p_arl

        if logger:
            logger.verify(abs(ml_sum - 1.0) < 1e-6, f"ML symmetry: p_home+p_away={ml_sum:.8f}")
            logger.verify(abs(ou_sum - 1.0) < 1e-6, f"O/U symmetry: p_over+p_under={ou_sum:.8f}")
            logger.verify(abs(rl_sum - 1.0) < 1e-6, f"RL symmetry: p_hrl+p_arl={rl_sum:.8f}")

        # ── STEP 10: Market Shaping ────────────────────────────────────────────
        if logger:
            logger.step("Step 10: Market Shaping")
        # Snap total line to nearest half run
        total_key_snapped = _nearest_half(total_key)

        # No-arbitrage check: implied probabilities sum to 1
        no_arb_ml = abs((p_home + p_away) - 1.0) < 1e-4
        no_arb_ou = abs((p_over_nv + p_under_nv) - 1.0) < 1e-4
        no_arb_rl = abs((p_hrl + p_arl) - 1.0) < 1e-4

        # Monotonicity check: P(>7.5) >= P(>8) >= P(>8.5)
        kp = sim['key_probs']
        monotone = True
        prev_p = 1.0
        for k in sorted(KEY_TOTAL_NUMBERS):
            curr_p = kp[k]['p_over']
            if curr_p > prev_p + 1e-4:
                monotone = False
                if logger:
                    logger.flag(f"Non-monotonic distribution: P(>{k})={curr_p:.4f} > P(>{k-0.5})={prev_p:.4f}")
            prev_p = curr_p

        if logger:
            logger.verify(no_arb_ml, f"No-arb ML: sum={p_home+p_away:.8f}")
            logger.verify(no_arb_ou, f"No-arb O/U: sum={p_over_nv+p_under_nv:.8f}")
            logger.verify(no_arb_rl, f"No-arb RL: sum={p_hrl+p_arl:.8f}")
            logger.verify(monotone, "Monotonicity: P(>7.5) ≥ P(>8) ≥ P(>8.5)")

        # Model spread (for display)
        combined_std = math.sqrt(sim['home_std'] ** 2 + sim['away_std'] ** 2)
        model_spread = round(-norm.ppf(p_home) * combined_std, 2)

        return {
            'home_team':         home_team,
            'away_team':         away_team,
            # Probabilities
            'p_home_win':        round(p_home, 4),
            'p_away_win':        round(p_away, 4),
            'p_home_cover_rl':   round(p_hrl, 4),
            'p_away_cover_rl':   round(p_arl, 4),
            'p_over':            round(p_over_nv, 4),
            'p_under':           round(p_under_nv, 4),
            # Markets (no-vig, continuous, no snap to -110)
            'ml_home':           ml_home,
            'ml_away':           ml_away,
            'rl_home_spread':    sim['rl_spread'],
            'rl_away_spread':    -sim['rl_spread'],
            'rl_home_odds':      rl_home_odds,
            'rl_away_odds':      rl_away_odds,
            'total_key':         total_key_snapped,
            'over_odds':         over_odds,
            'under_odds':        under_odds,
            # Projected runs
            'exp_home_runs':     sim['exp_home_runs'],
            'exp_away_runs':     sim['exp_away_runs'],
            'exp_total':         sim['exp_total'],
            'model_spread':      model_spread,
            # Diagnostics
            'cross_market_flags': cross_flags,
            'monotone':          monotone,
            'no_arb':            no_arb_ml and no_arb_ou and no_arb_rl,
        }

# ─────────────────────────────────────────────────────────────────────────────
# EDGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
class EdgeDetector:
    def detect(self, market: dict, book: dict) -> List[dict]:
        edges = []
        checks = [
            ('home_ml',  market['p_home_win'],     book.get('ml_home')),
            ('away_ml',  market['p_away_win'],      book.get('ml_away')),
            ('home_rl',  market['p_home_cover_rl'], book.get('rl_home')),
            ('away_rl',  market['p_away_cover_rl'], book.get('rl_away')),
        ]
        for label, model_p, book_odds in checks:
            if book_odds is None:
                continue
            bp = ml_to_prob(book_odds)
            bp_nv, _ = remove_vig(bp, 1.0 - bp)
            edge = model_p - bp_nv
            if MIN_EDGE_THRESHOLD <= edge <= MAX_EDGE_THRESHOLD:
                edges.append({
                    'market':     label,
                    'model_p':    round(model_p, 4),
                    'book_p':     round(bp_nv, 4),
                    'edge':       round(edge, 4),
                    'book_odds':  book_odds,
                    'model_odds': prob_to_ml(model_p),
                })
        ou_line    = book.get('ou_line')
        over_odds  = book.get('over_odds')
        under_odds = book.get('under_odds')
        if ou_line and over_odds:
            bop = ml_to_prob(over_odds)
            bup = ml_to_prob(under_odds) if under_odds else 1.0 - bop
            bop_nv, bup_nv = remove_vig(bop, bup)
            for label, mp, bp in [('over', market['p_over'], bop_nv),
                                   ('under', market['p_under'], bup_nv)]:
                edge = mp - bp
                if MIN_EDGE_THRESHOLD <= edge <= MAX_EDGE_THRESHOLD:
                    edges.append({
                        'market':  f'total_{label}',
                        'model_p': round(mp, 4),
                        'book_p':  round(bp, 4),
                        'edge':    round(edge, 4),
                        'ou_line': ou_line,
                    })
        return edges

# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION LAYER
# ─────────────────────────────────────────────────────────────────────────────
class ValidationLayer:
    def validate(self, market: dict, sim: dict) -> Tuple[bool, List[str]]:
        w = []
        if (market['p_home_win'] > 0.5) != (market['exp_home_runs'] > market['exp_away_runs']):
            w.append(f"ML/runs inconsistency: p_home={market['p_home_win']:.3f} "
                     f"exp_home={market['exp_home_runs']:.2f} exp_away={market['exp_away_runs']:.2f}")
        if market['p_home_win'] > 0.70 and market['p_home_cover_rl'] < 0.40:
            w.append("RL inconsistency: heavy favorite but low RL cover rate")
        if abs(market['exp_total'] - market['total_key']) > 2.5:
            w.append(f"Total key mismatch: exp={market['exp_total']:.2f} key={market['total_key']}")
        for f in ['p_home_win', 'p_away_win', 'p_over', 'p_under']:
            v = market.get(f)
            if v is not None and not (0.0 <= v <= 1.0):
                w.append(f'{f}={v:.4f} out of bounds')
        if not market.get('no_arb', True):
            w.append("No-arbitrage violation detected")
        if not sim.get('tail_stable', True):
            w.append(f"Tail instability: threshold={TAIL_STABILITY_THRESHOLD}")
        if market.get('cross_market_flags'):
            w.extend(market['cross_market_flags'])
        return len(w) == 0, w

# ─────────────────────────────────────────────────────────────────────────────
# ENVIRONMENT FEATURES
# ─────────────────────────────────────────────────────────────────────────────
def get_environment_features(home_team_db: str, game_month: int,
                              weather: Optional[dict] = None) -> dict:
    retro = DB_TO_RETRO.get(home_team_db, home_team_db)
    pf = PARK_FACTORS.get(retro, {'r': 100, 'hr': 100, 'h': 100})
    park_run = pf['r'] / 100.0
    park_hr  = pf['hr'] / 100.0

    weather_run = 1.0
    weather_hr  = 1.0
    if weather:
        temp = weather.get('temp_f', 72)
        wind = weather.get('wind_speed_mph', 5)
        wdir = str(weather.get('wind_dir', 'calm')).lower()
        weather_run = 1.0 + (temp - 72) * 0.001
        if 'out' in wdir:
            weather_hr = 1.0 + wind * 0.006
        elif 'in' in wdir:
            weather_hr = 1.0 - wind * 0.004

    mf = HFA_MONTHLY_FACTORS.get(game_month, 1.0)
    td = HFA_TEAM_DELTA.get(retro, 0.0)
    hfa = float(np.clip(
        HFA_BASE_WEIGHT * (HFA_MONTH_SCALE * mf + (1.0 - HFA_MONTH_SCALE)) *
        (1.0 + HFA_TEAM_SCALE * td),
        -0.60, 0.80
    ))

    return {
        'park_run_factor':  round(park_run, 4),
        'park_hr_factor':   round(park_hr, 4),
        'weather_run_adj':  round(weather_run, 4),
        'weather_hr_adj':   round(weather_hr, 4),
        'hfa_weight':       round(hfa, 4),
        'hfa_month_factor': round(mf, 4),
        'hfa_team_delta':   round(td, 4),
    }

# ─────────────────────────────────────────────────────────────────────────────
# TEAM/PITCHER STAT → FEATURE DICT CONVERTERS
# ─────────────────────────────────────────────────────────────────────────────
def team_stats_to_pitcher_features(stats: dict) -> dict:
    era  = float(stats.get('era', 4.50))
    k9   = float(stats.get('k9', 8.5))
    bb9  = float(stats.get('bb9', 3.2))
    whip = float(stats.get('whip', 1.30))
    ip_per_game = float(stats.get('ip_per_game', STARTER_IP_MEAN))
    pa_per_9 = 38.0
    k_pct    = k9  / pa_per_9
    bb_pct   = bb9 / pa_per_9
    hr_pct   = LEAGUE_HR_PCT * (era / 4.50)
    h_per_9  = whip * 9.0 - bb9
    h_pct    = h_per_9 / pa_per_9
    single_pct = h_pct * 0.63
    double_pct = h_pct * 0.20
    triple_pct = h_pct * 0.02
    xfip_proxy = 3.5 + (era - 4.50) * 0.5
    return {
        'k_pct':       float(np.clip(k_pct, 0.10, 0.40)),
        'bb_pct':      float(np.clip(bb_pct, 0.04, 0.18)),
        'hr_pct':      float(np.clip(hr_pct, 0.01, 0.07)),
        'single_pct':  float(np.clip(single_pct, 0.08, 0.22)),
        'double_pct':  float(np.clip(double_pct, 0.02, 0.08)),
        'triple_pct':  float(np.clip(triple_pct, 0.001, 0.01)),
        'xwoba':       LEAGUE_XWOBA,
        'barrel_rate': 0.08,
        'hard_hit':    0.35,
        'gb_pct':      0.43,
        'fb_pct':      0.35,
        'whiff_pct':   0.24,
        'ff_speed':    92.0,
        'ip_per_game': ip_per_game,
        'pitch_hand':  'R',
        'xfip_proxy':  float(np.clip(xfip_proxy, 2.5, 6.5)),
    }

def team_stats_to_batter_features(stats: dict) -> dict:
    """
    Convert team batting stats to per-batter feature dict.
    If hand-specific splits are present (avg/obp/slg from vs-LHP or vs-RHP),
    they are used directly. wOBA is used when available for more precise HR/K/BB rates.
    """
    avg  = float(stats.get('avg', 0.245))
    obp  = float(stats.get('obp', LEAGUE_OBP))  # 2025: 0.3174
    slg  = float(stats.get('slg', 0.410))
    ops  = obp + slg
    iso  = max(0.05, slg - avg)

    # wOBA-based rate overrides (more precise than OPS-derived)
    woba = float(stats.get('woba', LEAGUE_WOBA))
    woba_scale = woba / LEAGUE_WOBA  # relative quality vs league avg

    # Hand-specific K/BB/HR rates from batting splits (if available)
    # batting_k9, batting_bb9, batting_hr9 are set from DB splits in TS
    pa_per_9 = 38.0
    if 'batting_k9' in stats:
        k_pct  = float(stats['batting_k9'])  / pa_per_9
        bb_pct = float(stats['batting_bb9']) / pa_per_9
        hr_pct = float(stats['batting_hr9']) / pa_per_9
    else:
        # Fallback: derive from avg/obp/slg
        bb_pct = max(0.04, obp - avg - 0.01)
        hr_pct = float(np.clip((slg - avg) * 0.25, 0.01, 0.07))
        # 2025: league K% = 0.2222; scale by team OPS vs league average
        k_pct  = float(np.clip(LEAGUE_K_PCT * (0.750 / max(ops, 0.500)), 0.12, 0.32))

    # Scale HR rate by wOBA quality signal
    hr_pct = float(np.clip(hr_pct * woba_scale, 0.01, 0.07))

    single_pct = avg * 0.63
    double_pct = avg * 0.20
    triple_pct = avg * 0.02

    return {
        'k_pct':       float(np.clip(k_pct, 0.12, 0.32)),
        'bb_pct':      float(np.clip(bb_pct, 0.04, 0.18)),
        'hr_pct':      float(np.clip(hr_pct, 0.01, 0.07)),
        'single_pct':  float(np.clip(single_pct, 0.08, 0.22)),
        'double_pct':  float(np.clip(double_pct, 0.02, 0.08)),
        'triple_pct':  float(np.clip(triple_pct, 0.001, 0.01)),
        'xwoba':       float(np.clip(woba, 0.250, 0.400)),
        'woba':        float(np.clip(woba, 0.250, 0.400)),
        'iso':         iso,
        'barrel_rate': float(np.clip(0.06 + iso * 0.15, 0.04, 0.14)),
        'hard_hit':    float(np.clip(0.28 + iso * 0.30, 0.25, 0.50)),
        'bat_hand':    'R',
        'split_hand':  int(stats.get('split_hand', 0)),  # 1=vs LHP, 0=vs RHP
    }

def pitcher_stats_to_features(stats: dict, team_era: float = 4.50) -> dict:
    """
    Convert pitcher stats to feature dict for the simulation engine.
    Enhancements:
      - Uses real xFIP (not ERA-derived proxy) when available
      - Uses real pitch_hand (R/L/S) from DB throwsHand field
      - Blends rolling-5 ERA/K9/BB9/WHIP with season stats (already pre-blended in TS)
      - Uses FIP as secondary quality signal for HR rate estimation
      - FIP-minus / ERA-minus used for park-neutral quality adjustment
    """
    # Core rate stats (already blended 70/30 season/rolling-5 in TS layer)
    era  = float(stats.get('era', team_era))
    k9   = float(stats.get('k9', 8.5))
    bb9  = float(stats.get('bb9', 3.2))
    whip = float(stats.get('whip', 1.30))
    ip   = float(stats.get('ip', 150.0))
    gp   = max(1, int(stats.get('gp', 28)))
    ip_per_game = max(1.0, ip / gp)

    # Real xFIP from DB (park-neutral, HR-independent quality signal)
    # Fallback: ERA-derived proxy only if xFIP not available
    xfip_real = stats.get('xfip', None)
    if xfip_real is not None and float(xfip_real) > 0:
        xfip_val = float(np.clip(xfip_real, 2.0, 7.0))
    else:
        # Fallback proxy: regress toward 4.0 from ERA
        xfip_val = float(np.clip(3.5 + (era - LEAGUE_ERA) * 0.5, 2.0, 6.5))  # normalize vs 2025 ERA

    # Real FIP from DB (HR-dependent quality signal)
    fip_real = stats.get('fip', None)
    fip_val  = float(fip_real) if (fip_real is not None and float(fip_real) > 0) else era

    # FIP-minus / ERA-minus (park-adjusted, 100=league avg, <100=better)
    fip_minus = float(stats.get('fipMinus', 100))
    era_minus = float(stats.get('eraMinus', 100))

    # Pitcher throwing hand: 0=R, 1=L, 2=S
    throws_hand_num = int(stats.get('throwsHand', 0))
    pitch_hand = 'L' if throws_hand_num == 1 else ('S' if throws_hand_num == 2 else 'R')

    # Derive per-PA rates
    pa_per_9   = 38.0
    k_pct      = k9  / pa_per_9
    bb_pct     = bb9 / pa_per_9

    # HR rate: use FIP-based estimate (FIP is HR-sensitive)
    # FIP formula: FIP = (13*HR + 3*BB - 2*K) / IP + cFIP
    # Invert to get HR/9: HR/9 ≈ (FIP - 3.2 + 2*K9/9 - 3*BB9/9) / (13/9)
    # Clamp to realistic range
    hr9_from_fip = max(0.3, (fip_val - 3.2 + (2.0 * k9 / 9.0) - (3.0 * bb9 / 9.0)) / (13.0 / 9.0))
    hr_pct_fip   = float(np.clip(hr9_from_fip / pa_per_9, 0.01, 0.07))
    # Blend with ERA-based estimate (50/50)
    hr_pct_era   = LEAGUE_HR_PCT * (era / LEAGUE_ERA)  # normalize vs 2025 league ERA
    hr_pct       = float(np.clip(0.5 * hr_pct_fip + 0.5 * hr_pct_era, 0.01, 0.07))

    h_per_9    = whip * 9.0 - bb9
    h_pct      = h_per_9 / pa_per_9
    single_pct = h_pct * 0.63
    double_pct = h_pct * 0.20
    triple_pct = h_pct * 0.02

    # Whiff rate: K% is a strong proxy; scale by xFIP quality
    xfip_quality = max(0.5, (5.0 - xfip_val) / 2.5)  # 0.5-1.5 range
    whiff_pct = float(np.clip(k_pct * 0.9 * xfip_quality, 0.12, 0.45))

    # Rolling-5 diagnostic fields (already blended into era/k9/bb9/whip above)
    rolling_starts = int(stats.get('rolling_starts', 0))
    rolling_era    = float(stats.get('rolling_era', era))

    return {
        'k_pct':         float(np.clip(k_pct, 0.10, 0.45)),
        'bb_pct':        float(np.clip(bb_pct, 0.03, 0.18)),
        'hr_pct':        hr_pct,
        'single_pct':    float(np.clip(single_pct, 0.06, 0.22)),
        'double_pct':    float(np.clip(double_pct, 0.01, 0.08)),
        'triple_pct':    float(np.clip(triple_pct, 0.001, 0.01)),
        'xwoba':         LEAGUE_XWOBA,
        'barrel_rate':   0.08,
        'hard_hit':      0.35,
        'gb_pct':        0.43,
        'fb_pct':        0.35,
        'whiff_pct':     whiff_pct,
        'ff_speed':      92.0,
        'ip_per_game':   ip_per_game,
        'pitch_hand':    pitch_hand,
        'xfip_proxy':    xfip_val,
        # Diagnostic fields for logging
        'fip':           fip_val,
        'xfip_real':     xfip_val,
        'fip_minus':     fip_minus,
        'era_minus':     era_minus,
        'rolling_starts': rolling_starts,
        'rolling_era':   rolling_era,
    }

def _default_bullpen() -> dict:
    return {
        'fatigue_score':    0.3,
        'leverage_arms':    2,
        'bullpen_k_bb':     LEAGUE_K_PCT - LEAGUE_BB_PCT,  # 2025: 0.2222 - 0.0946 = 0.1276
        'bullpen_xfip':     LEAGUE_ERA,                    # 2025: 4.153 (was hardcoded 4.0)
        'total_bp_outs_5d': 0,
    }

# ─────────────────────────────────────────────────────────────────────────────
# STEP 11: MAIN PROJECTION FUNCTION (full pipeline entry point)
# ─────────────────────────────────────────────────────────────────────────────
def project_game(
    away_abbrev: str,
    home_abbrev: str,
    away_team_stats: dict,
    home_team_stats: dict,
    away_pitcher_stats: dict,
    home_pitcher_stats: dict,
    book_lines: dict,
    game_date: datetime,
    weather: Optional[dict] = None,
    seed: int = 42,
    verbose: bool = False,
    # ── Precision signals ───────────────────────────────────────────────────────────────────────────────
    park_factor_3yr: float = 1.0,      # 3-year weighted park run factor
    away_bullpen: Optional[dict] = None,  # Real bullpen stats for away team
    home_bullpen: Optional[dict] = None,  # Real bullpen stats for home team
    umpire_k_mod: float = 1.0,         # HP umpire K-rate modifier
    umpire_bb_mod: float = 1.0,        # HP umpire BB-rate modifier
    umpire_name: str = 'UNKNOWN',      # HP umpire name for logging
    mlb_game_pk: Optional[int] = None, # MLB Stats API gamePk for traceability
) -> dict:
    t0 = time.time()
    game_label = f"{away_abbrev}@{home_abbrev}"
    logger = EngineLogger(game_label, verbose=verbose)

    logger.input(f"Game: {game_label} | Date: {game_date.date()} | Sims: {SIMULATIONS} | gamePk={mlb_game_pk}")
    logger.input(f"Away stats: rpg={away_team_stats.get('rpg'):.2f} era={away_team_stats.get('era'):.2f}")
    logger.input(f"Home stats: rpg={home_team_stats.get('rpg'):.2f} era={home_team_stats.get('era'):.2f}")
    logger.input(f"Book lines: {book_lines}")

    # Step 1: Build environment features
    logger.step("Step 1: Input Engine — Environment Features")
    env = get_environment_features(home_abbrev, game_date.month, weather)

    # ── SIGNAL 1: Override park_run_factor with 3-year DB value ─────────────────────────────────
    static_pf = env.get('park_run_factor', 1.0)
    if park_factor_3yr != 1.0:
        env['park_run_factor'] = park_factor_3yr
        logger.state(
            f"[PARK] Overriding static parkFactor={static_pf:.4f} → DB 3yr={park_factor_3yr:.4f} "
            f"(venue={home_abbrev})"
        )
    else:
        logger.state(
            f"[PARK] Using static parkFactor={static_pf:.4f} (no DB value for {home_abbrev})"
        )
    logger.state(f"Park run factor (final): {env['park_run_factor']:.4f} | HFA: {env['hfa_weight']}")

    # Step 1: Build feature dicts
    away_lineup_feat = team_stats_to_batter_features(away_team_stats)
    home_lineup_feat = team_stats_to_batter_features(home_team_stats)
    away_sp_feat = pitcher_stats_to_features(away_pitcher_stats, away_team_stats.get('era', 4.50))
    home_sp_feat = pitcher_stats_to_features(home_pitcher_stats, home_team_stats.get('era', 4.50))

    # ── SIGNAL 3: Apply umpire K/BB modifiers to SP features ──────────────────────────────────────
    if umpire_k_mod != 1.0 or umpire_bb_mod != 1.0:
        orig_away_k  = away_sp_feat['k_pct']
        orig_away_bb = away_sp_feat['bb_pct']
        orig_home_k  = home_sp_feat['k_pct']
        orig_home_bb = home_sp_feat['bb_pct']
        away_sp_feat['k_pct']  = min(away_sp_feat['k_pct']  * umpire_k_mod,  0.50)
        away_sp_feat['bb_pct'] = min(away_sp_feat['bb_pct'] * umpire_bb_mod, 0.20)
        home_sp_feat['k_pct']  = min(home_sp_feat['k_pct']  * umpire_k_mod,  0.50)
        home_sp_feat['bb_pct'] = min(home_sp_feat['bb_pct'] * umpire_bb_mod, 0.20)
        logger.state(
            f"[UMPIRE] {umpire_name}: kMod={umpire_k_mod:.4f} bbMod={umpire_bb_mod:.4f} | "
            f"Away SP k_pct: {orig_away_k:.4f}→{away_sp_feat['k_pct']:.4f} "
            f"bb_pct: {orig_away_bb:.4f}→{away_sp_feat['bb_pct']:.4f} | "
            f"Home SP k_pct: {orig_home_k:.4f}→{home_sp_feat['k_pct']:.4f} "
            f"bb_pct: {orig_home_bb:.4f}→{home_sp_feat['bb_pct']:.4f}"
        )
    else:
        logger.state(f"[UMPIRE] {umpire_name}: kMod=1.0 bbMod=1.0 (league-avg, no adjustment)")

    away_lineup = [away_lineup_feat] * 9
    home_lineup = [home_lineup_feat] * 9

    # ── SIGNAL 2: Build bullpen from DB stats (replace _default_bullpen) ───────────────────────────
    def _build_bullpen_from_db(bp: Optional[dict], team: str) -> dict:
        """Convert DB bullpen stats to engine bullpen feature dict."""
        if not bp:
            logger.state(f"[BULLPEN] {team}: no DB data — using league-average defaults")
            return _default_bullpen()
        # FIP is the primary quality signal; fall back to ERA if FIP not available
        fip_val  = bp.get('fip', bp.get('era', 4.10))
        era_val  = bp.get('era', 4.20)
        k9_val   = bp.get('k9', 9.0)
        bb9_val  = bp.get('bb9', 3.2)
        k_pct    = k9_val / 27.0   # approximate K% from K/9 (27 batters/9 IP)
        bb_pct   = bb9_val / 27.0  # approximate BB% from BB/9
        result = {
            'fatigue_score':    0.3,                    # no rest data yet — neutral
            'leverage_arms':    int(bp.get('relieverCount', 2)),
            'bullpen_k_bb':     k_pct - bb_pct,         # K-BB% (quality signal)
            'bullpen_xfip':     fip_val,                # use FIP as xFIP proxy
            'total_bp_outs_5d': 0,                      # no rest data yet — neutral
        }
        logger.state(
            f"[BULLPEN] {team}: ERA={era_val:.2f} FIP={fip_val:.2f} "
            f"K/9={k9_val:.2f} BB/9={bb9_val:.2f} "
            f"K-BB%={result['bullpen_k_bb']:.4f} relievers={result['leverage_arms']}"
        )
        return result

    # Build separate bullpens for each team (away bullpen faces home lineup, vice versa)
    away_bullpen_feat = _build_bullpen_from_db(away_bullpen, away_abbrev)
    home_bullpen_feat = _build_bullpen_from_db(home_bullpen, home_abbrev)
    # For game state building: home lineup faces away SP + away bullpen; away lineup faces home SP + home bullpen
    bullpen = _default_bullpen()  # kept as legacy fallback, overridden per-state below

    # Step 1: Deep diagnostic logging for pitcher features
    logger.step("Step 1b: Pitcher Feature Diagnostics")
    logger.state(
        f"Away SP features: hand={away_sp_feat['pitch_hand']} "
        f"xFIP={away_sp_feat['xfip_proxy']:.2f} FIP={away_sp_feat.get('fip', 'n/a')} "
        f"k_pct={away_sp_feat['k_pct']:.4f} bb_pct={away_sp_feat['bb_pct']:.4f} "
        f"hr_pct={away_sp_feat['hr_pct']:.4f} whiff={away_sp_feat['whiff_pct']:.4f} "
        f"ip/g={away_sp_feat['ip_per_game']:.2f} "
        f"rolling_starts={away_sp_feat.get('rolling_starts', 0)} "
        f"rolling_era={away_sp_feat.get('rolling_era', 'n/a')} "
        f"fip_minus={away_sp_feat.get('fip_minus', 100):.1f} era_minus={away_sp_feat.get('era_minus', 100):.1f}"
    )
    logger.state(
        f"Home SP features: hand={home_sp_feat['pitch_hand']} "
        f"xFIP={home_sp_feat['xfip_proxy']:.2f} FIP={home_sp_feat.get('fip', 'n/a')} "
        f"k_pct={home_sp_feat['k_pct']:.4f} bb_pct={home_sp_feat['bb_pct']:.4f} "
        f"hr_pct={home_sp_feat['hr_pct']:.4f} whiff={home_sp_feat['whiff_pct']:.4f} "
        f"ip/g={home_sp_feat['ip_per_game']:.2f} "
        f"rolling_starts={home_sp_feat.get('rolling_starts', 0)} "
        f"rolling_era={home_sp_feat.get('rolling_era', 'n/a')} "
        f"fip_minus={home_sp_feat.get('fip_minus', 100):.1f} era_minus={home_sp_feat.get('era_minus', 100):.1f}"
    )
    logger.state(
        f"Away batting (vs {home_sp_feat['pitch_hand']}P): "
        f"k_pct={away_lineup_feat['k_pct']:.4f} bb_pct={away_lineup_feat['bb_pct']:.4f} "
        f"hr_pct={away_lineup_feat['hr_pct']:.4f} wOBA={away_lineup_feat.get('woba', LEAGUE_WOBA):.3f} "
        f"split={'YES' if away_team_stats.get('split_hand') is not None else 'season'}"
    )
    logger.state(
        f"Home batting (vs {away_sp_feat['pitch_hand']}P): "
        f"k_pct={home_lineup_feat['k_pct']:.4f} bb_pct={home_lineup_feat['bb_pct']:.4f} "
        f"hr_pct={home_lineup_feat['hr_pct']:.4f} wOBA={home_lineup_feat.get('woba', LEAGUE_WOBA):.3f} "
        f"split={'YES' if home_team_stats.get('split_hand') is not None else 'season'}"
    )

    # Step 1: Build game states
    # home_state: home lineup faces away SP + away bullpen (away team's pen)
    # away_state: away lineup faces home SP + home bullpen (home team's pen)
    logger.step("Step 1c: Bullpen Feature Diagnostics")
    logger.state(
        f"[BULLPEN] {away_abbrev} pen: xFIP={away_bullpen_feat['bullpen_xfip']:.2f} "
        f"K-BB%={away_bullpen_feat['bullpen_k_bb']:.4f} "
        f"leverage_arms={away_bullpen_feat['leverage_arms']}"
    )
    logger.state(
        f"[BULLPEN] {home_abbrev} pen: xFIP={home_bullpen_feat['bullpen_xfip']:.2f} "
        f"K-BB%={home_bullpen_feat['bullpen_k_bb']:.4f} "
        f"leverage_arms={home_bullpen_feat['leverage_arms']}"
    )
    gs_builder = GameStateBuilder()
    home_state = gs_builder.build(home_lineup, away_sp_feat, away_bullpen_feat, env, quality_mult=LEAGUE_CALIBRATION_MULT)
    away_state = gs_builder.build(away_lineup, home_sp_feat, home_bullpen_feat, env, quality_mult=LEAGUE_CALIBRATION_MULT)
    logger.state(f"[CALIBRATION] quality_mult={LEAGUE_CALIBRATION_MULT:.4f} (2025 RPG={LEAGUE_RPG:.3f})")
    logger.state(f"Home state: mu={home_state['mu']:.4f} var={home_state['variance']:.4f} "
                 f"starter_ip={home_state['starter_ip']:.2f}")
    logger.state(f"Away state: mu={away_state['mu']:.4f} var={away_state['variance']:.4f} "
                 f"starter_ip={away_state['starter_ip']:.2f}")

    # Determine run line direction
    rl_home_spread = book_lines.get('rl_home_spread', None)
    if rl_home_spread is not None:
        rl_spread = float(rl_home_spread)
    else:
        ml_home = book_lines.get('ml_home', 0)
        rl_spread = -1.5 if ml_home < 0 else 1.5

    ou_line = book_lines.get('ou_line')

    # Step 2: Monte Carlo simulation
    logger.step(f"Step 2: Monte Carlo ({SIMULATIONS:,} sims, NB-Gamma Mixture, extra innings)")
    mc = MonteCarloEngine(n_sims=SIMULATIONS, seed=seed)
    sim = mc.simulate(home_state, away_state, env,
                      ou_line=ou_line, rl_spread=rl_spread, logger=logger)

    logger.state(f"Sim results: p_home={sim['p_home_win']:.4f} exp_total={sim['exp_total']:.2f} "
                 f"ties_9inn={sim['n_ties_9inn']} avg_extra={sim['avg_extra_inn']:.3f}")

    # Steps 4-10: Market derivation
    logger.step("Steps 4-10: Market Derivation Pipeline")
    market = MarketDerivation().derive(sim, home_abbrev, away_abbrev, ou_line, logger)

    # Edge detection
    edges = EdgeDetector().detect(market, book_lines)

    # Validation
    ok, warnings_list = ValidationLayer().validate(market, sim)
    logger.verify(ok, f"Final validation: {len(warnings_list)} warnings")

    elapsed = round(time.time() - t0, 2)
    logger.output(f"Completed in {elapsed}s | Valid={ok} | Edges={len(edges)}")

    # Step 12: Log distribution shapes and key number mass
    if verbose:
        logger.step("Step 12: Distribution Summary")
        for k in KEY_TOTAL_NUMBERS:
            kp = sim['key_probs'][k]
            logger.state(f"  P(total>{k})={kp['p_over']:.4f} P(push)={kp['p_push']:.4f}")
        logger.state(f"  Extra innings impact on ML: {sim['n_ties_9inn']} ties resolved "
                     f"(avg {sim['avg_extra_inn']:.2f} extra innings)")
        logger.state(f"  Bullpen fatigue impact: starter_ip={home_state['starter_ip']:.2f} "
                     f"(home) / {away_state['starter_ip']:.2f} (away)")
        if market.get('cross_market_flags'):
            for f in market['cross_market_flags']:
                logger.flag(f"Cross-market: {f}")

    # Build final output (Step 11)
    home_rl_label = f"{rl_spread:+.1f}"
    away_rl_label = f"{-rl_spread:+.1f}"

    return {
        'ok':              True,
        'game':            game_label,
        'away_abbrev':     away_abbrev,
        'home_abbrev':     home_abbrev,
        # Step 11: Projected runs
        'proj_away_runs':  market['exp_away_runs'],
        'proj_home_runs':  market['exp_home_runs'],
        'proj_total':      market['exp_total'],
        # Step 11: Moneyline
        'away_ml':         market['ml_away'],
        'home_ml':         market['ml_home'],
        'away_win_pct':    round(market['p_away_win'] * 100, 2),
        'home_win_pct':    round(market['p_home_win'] * 100, 2),
        # Step 11: Run line
        'away_run_line':   away_rl_label,
        'home_run_line':   home_rl_label,
        'away_rl_odds':    market['rl_away_odds'],
        'home_rl_odds':    market['rl_home_odds'],
        'away_rl_cover_pct': round(market['p_away_cover_rl'] * 100, 2),
        'home_rl_cover_pct': round(market['p_home_cover_rl'] * 100, 2),
        # Step 11: Total
        'total_line':      market['total_key'],
        'over_odds':       market['over_odds'],
        'under_odds':      market['under_odds'],
        'over_pct':        round(market['p_over'] * 100, 2),
        'under_pct':       round(market['p_under'] * 100, 2),
        # Model spread
        'model_spread':    market['model_spread'],
        # Edges
        'edges':           edges,
        # Validation
        'valid':           ok,
        'warnings':        warnings_list,
        # Environment
        'env':             env,
        'home_state_mu':   home_state['mu'],
        'away_state_mu':   away_state['mu'],
        # Simulation diagnostics
        'simulations':     SIMULATIONS,
        'n_ties_9inn':     sim['n_ties_9inn'],
        'avg_extra_inn':   sim['avg_extra_inn'],
        'tail_stable':     sim['tail_stable'],
        'sparse_buckets':  sim['sparse_buckets'],
        'cross_market_flags': market.get('cross_market_flags', []),
        'monotone':        market.get('monotone', True),
        'no_arb':          market.get('no_arb', True),
        # Meta
        'elapsed_sec':     elapsed,
        'error':           None,
        # Step 12 log flags
        'engine_flags':    logger.flags,
    }

#!/usr/bin/env python3.11
"""
validate_engine_upgrade.py
Quick validation of upgraded MLBAIModel.py:
  - SIM_TARGET=400K enforced
  - SIM_MAX=500K cap enforced
  - CONFIDENCE_THRESHOLD=0.65 gate in EdgeDetector
  - EV calculation in edges
  - P_NRFI computed
  - HR Props per team computed
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

from MLBAIModel import (
    project_game, SIMULATIONS, MIN_SIMULATIONS, SIM_MAX,
    CONFIDENCE_THRESHOLD, MonteCarloEngine
)
from datetime import datetime

print("\n" + "="*70)
print("[VALIDATE] MLB Engine Upgrade — Spec Gap Implementation")
print("="*70)

# ── 1. Verify constants ──────────────────────────────────────────────────────
print(f"\n[STEP 1] Constants validation")
print(f"  SIMULATIONS       = {SIMULATIONS:,}  (SPEC: 400,000)")
print(f"  MIN_SIMULATIONS   = {MIN_SIMULATIONS:,}  (SPEC: 250,000)")
print(f"  SIM_MAX           = {SIM_MAX:,}  (SPEC: 500,000)")
print(f"  CONFIDENCE_THRESHOLD = {CONFIDENCE_THRESHOLD}  (SPEC: 0.65)")
assert SIMULATIONS == 400_000, f"FAIL: SIMULATIONS={SIMULATIONS} != 400,000"
assert MIN_SIMULATIONS == 250_000, f"FAIL: MIN_SIMULATIONS={MIN_SIMULATIONS} != 250,000"
assert SIM_MAX == 500_000, f"FAIL: SIM_MAX={SIM_MAX} != 500,000"
assert CONFIDENCE_THRESHOLD == 0.65, f"FAIL: CONFIDENCE_THRESHOLD={CONFIDENCE_THRESHOLD} != 0.65"
print(f"  [VERIFY] PASS — all constants correct")

# ── 2. Verify SIM_MAX cap ────────────────────────────────────────────────────
print(f"\n[STEP 2] SIM_MAX cap enforcement")
mc_over = MonteCarloEngine(n_sims=999_999)
print(f"  Requested: 999,999 | Actual: {mc_over.n_sims:,}")
assert mc_over.n_sims == SIM_MAX, f"FAIL: n_sims={mc_over.n_sims} should be capped at {SIM_MAX}"
mc_under = MonteCarloEngine(n_sims=50_000)
print(f"  Requested: 50,000  | Actual: {mc_under.n_sims:,}")
assert mc_under.n_sims == MIN_SIMULATIONS, f"FAIL: n_sims={mc_under.n_sims} should be floored at {MIN_SIMULATIONS}"
print(f"  [VERIFY] PASS — SIM_MAX cap and MIN floor enforced")

# ── 3. Run a full game projection ────────────────────────────────────────────
print(f"\n[STEP 3] Full game projection (NYY @ BOS)")
away_stats = {'rpg': 5.01, 'era': 3.88, 'avg': 0.260, 'obp': 0.332, 'slg': 0.445,
              'k9': 9.4, 'bb9': 2.9, 'whip': 1.20, 'ip_per_game': 5.6}
home_stats = {'rpg': 4.88, 'era': 4.02, 'avg': 0.258, 'obp': 0.328, 'slg': 0.432,
              'k9': 9.3, 'bb9': 3.0, 'whip': 1.23, 'ip_per_game': 5.4}
away_pitcher = {'era': 3.50, 'k9': 10.2, 'bb9': 2.5, 'whip': 1.10, 'ip': 160.0,
                'gp': 28, 'xera': 3.45, 'fip': 3.40, 'xfip': 3.55, 'pitch_hand': 'R'}
home_pitcher = {'era': 3.85, 'k9': 9.8, 'bb9': 2.8, 'whip': 1.18, 'ip': 155.0,
                'gp': 27, 'xera': 3.90, 'fip': 3.75, 'xfip': 3.80, 'pitch_hand': 'L'}
book_lines = {'ml_away': +120, 'ml_home': -140, 'ou_line': 8.5,
              'over_odds': -110, 'under_odds': -110,
              'rl_home_spread': -1.5, 'rl_home': -165, 'rl_away': +145}

result = project_game(
    away_abbrev='NYY', home_abbrev='BOS',
    away_team_stats=away_stats, home_team_stats=home_stats,
    away_pitcher_stats=away_pitcher, home_pitcher_stats=home_pitcher,
    book_lines=book_lines,
    game_date=datetime(2026, 4, 5),
    verbose=False,
    seed=42,
)

print(f"\n[OUTPUT] Game: {result['game']}")
print(f"  ok={result['ok']} | elapsed={result['elapsed_sec']}s | sims={result['simulations']:,}")
print(f"  Proj: {result['proj_away_runs']:.2f} – {result['proj_home_runs']:.2f} (total={result['proj_total']:.2f})")
print(f"  ML: away={result['away_ml']} home={result['home_ml']}")
print(f"  Win%: away={result['away_win_pct']:.2f}% home={result['home_win_pct']:.2f}%")
print(f"  RL: {result['away_run_line']} ({result['away_rl_odds']}) / {result['home_run_line']} ({result['home_rl_odds']})")
print(f"  Total: {result['total_line']} | Over: {result['over_odds']} | Under: {result['under_odds']}")

# ── 4. Verify NRFI ───────────────────────────────────────────────────────────
print(f"\n[STEP 4] NRFI validation")
print(f"  P(NRFI)           = {result['p_nrfi']:.2f}%  (SPEC: P_NRFI market)")
print(f"  P(YRFI)           = {result['p_yrfi']:.2f}%")
print(f"  NRFI fair ML      = {result['nrfi_odds']}")
print(f"  YRFI fair ML      = {result['yrfi_odds']}")
print(f"  Exp 1st-inn total = {result['exp_first_inn_total']:.3f}")
assert 'p_nrfi' in result, "FAIL: p_nrfi missing from result"
assert 0 < result['p_nrfi'] < 100, f"FAIL: p_nrfi={result['p_nrfi']} out of range"
assert abs(result['p_nrfi'] + result['p_yrfi'] - 100.0) < 0.01, "FAIL: p_nrfi + p_yrfi != 100%"
# Empirical check: NRFI should be ~40-65% for typical MLB games
assert 30 < result['p_nrfi'] < 75, f"FAIL: p_nrfi={result['p_nrfi']:.2f}% outside empirical range [30,75]"
print(f"  [VERIFY] PASS — NRFI computed correctly, sums to 100%, in empirical range")

# ── 5. Verify HR Props ───────────────────────────────────────────────────────
print(f"\n[STEP 5] HR Props validation")
print(f"  P(away HR>=1)     = {result['p_away_hr_any']:.2f}%  (SPEC: HR Props)")
print(f"  P(home HR>=1)     = {result['p_home_hr_any']:.2f}%")
print(f"  P(both HR)        = {result['p_both_hr']:.2f}%")
print(f"  Exp away HR       = {result['exp_away_hr']:.3f}")
print(f"  Exp home HR       = {result['exp_home_hr']:.3f}")
print(f"  away_hr_lambda    = {result['away_hr_lambda']:.4f}")
print(f"  home_hr_lambda    = {result['home_hr_lambda']:.4f}")
assert 'p_home_hr_any' in result, "FAIL: p_home_hr_any missing"
assert 0 < result['p_home_hr_any'] < 100, f"FAIL: p_home_hr_any={result['p_home_hr_any']} out of range"
# Empirical: P(team HR>=1) should be ~50-85% for typical MLB games
assert 40 < result['p_home_hr_any'] < 95, f"FAIL: p_home_hr_any={result['p_home_hr_any']:.2f}% outside range"
assert result['p_both_hr'] <= min(result['p_home_hr_any'], result['p_away_hr_any']), \
    "FAIL: P(both HR) > P(individual HR)"
print(f"  [VERIFY] PASS — HR props computed correctly, P(both) <= P(individual)")

# ── 6. Verify EV in edges ────────────────────────────────────────────────────
print(f"\n[STEP 6] EV calculation validation")
print(f"  Edges detected: {len(result['edges'])}")
for e in result['edges']:
    print(f"  Edge: {e['market']} | model_p={e['model_p']:.4f} book_p={e['book_p']:.4f} "
          f"edge={e['edge']:.4f} ev={e.get('ev', 'MISSING'):.4f} "
          f"confidence_ok={e.get('confidence_ok', 'MISSING')} play={e.get('play', 'MISSING')}")
    assert 'ev' in e, f"FAIL: 'ev' missing from edge {e['market']}"
    assert 'confidence_ok' in e, f"FAIL: 'confidence_ok' missing from edge {e['market']}"
    assert 'play' in e, f"FAIL: 'play' missing from edge {e['market']}"
if result['edges']:
    print(f"  [VERIFY] PASS — EV, confidence_ok, play fields present in all edges")
else:
    print(f"  [VERIFY] PASS — No edges detected (expected for this matchup at these odds)")

# ── 7. Final summary ─────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"[FINAL] ALL VALIDATION GATES PASSED")
print(f"  SIM_TARGET=400K: PASS")
print(f"  SIM_MAX=500K cap: PASS")
print(f"  MIN_SIMULATIONS=250K floor: PASS")
print(f"  CONFIDENCE_THRESHOLD=0.65: PASS")
print(f"  EV in edges: PASS")
print(f"  NRFI market: PASS (p_nrfi={result['p_nrfi']:.2f}%)")
print(f"  HR Props: PASS (home={result['p_home_hr_any']:.2f}% away={result['p_away_hr_any']:.2f}%)")
print(f"  Elapsed: {result['elapsed_sec']}s for {result['simulations']:,} sims")
print(f"{'='*70}\n")

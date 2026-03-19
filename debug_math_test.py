#!/usr/bin/env python3.11
"""
Mock test: verify the spread sign convention and rounding math
without needing KenPom login. Injects mock team stats directly.
"""
import sys
sys.path.insert(0, '/home/ubuntu/ai-sports-betting/server')

import numpy as np
import json

# Import the functions we need to test
exec(open('/home/ubuntu/ai-sports-betting/server/model_v9_engine.py').read().split('def run_engine')[0])

print("=== MATH VALIDATION TEST ===")
print()

# Simulate TCU @ Ohio St.:
# mkt_sp = +2.5 (TCU is away +2.5 underdog, Ohio St. is home -2.5 favorite)
# margins = home - away convention
# If model says Ohio St. wins by 2.0: model_sp_rounded = +2.0 (home wins by 2)
# Expected: away_sp_display = +2.0 (TCU is underdog), home_sp_display = -2.0 (Ohio St. is favorite)

mkt_sp = 2.5   # TCU +2.5 (away underdog)
mkt_to = 145.5

# Simulate 250k games where Ohio St. wins by ~2 on average
np.random.seed(42)
mean_a = 71.5  # TCU avg score
mean_h = 73.5  # Ohio St. avg score (wins by ~2)
sig_a = 10.0
sig_h = 10.0
n = 250000

scores_a = np.clip(np.random.normal(mean_a, sig_a, n), 40, 135)
scores_h = np.clip(np.random.normal(mean_h, sig_h, n), 40, 135)
margins = scores_h - scores_a
totals  = scores_a + scores_h

sp_med = float(np.median(margins))
to_mean = float(np.mean(totals))

print(f"Simulation: mean_h={mean_h}, mean_a={mean_a}")
print(f"Median margin (home-away): {sp_med:.4f}  (positive = home wins)")
print(f"Mean total: {to_mean:.4f}")
print()

# Apply round_to_half
model_sp_rounded = round_to_half(sp_med)
model_to_rounded = round_to_half(to_mean)

print(f"model_sp_rounded = {model_sp_rounded}  (home-perspective)")
print(f"model_to_rounded = {model_to_rounded}")
print()

# Betting display convention
# margins = home - away
# model_sp_rounded > 0 means home wins → home is FAVORITE → home_sp_display = NEGATIVE
# away is UNDERDOG → away_sp_display = POSITIVE
home_sp_display = -model_sp_rounded
away_sp_display = +model_sp_rounded

print(f"SPREAD DISPLAY:")
print(f"  TCU (away) spread: {away_sp_display:+.1f}  ← should be POSITIVE (underdog)")
print(f"  Ohio St. (home) spread: {home_sp_display:+.1f}  ← should be NEGATIVE (favorite)")
print()

# Verify: away_sp should match mkt_sp direction (both positive for away underdog)
if mkt_sp > 0 and away_sp_display > 0:
    print("✓ PASS: Both book and model have away as underdog (positive spread)")
elif mkt_sp < 0 and away_sp_display < 0:
    print("✓ PASS: Both book and model have away as favorite (negative spread)")
elif mkt_sp > 0 and away_sp_display < 0:
    print("✗ FAIL: Book has away as underdog (+) but model shows away as favorite (-)")
elif mkt_sp < 0 and away_sp_display > 0:
    print("✗ FAIL: Book has away as favorite (-) but model shows away as underdog (+)")
print()

# Compute fair odds at derived model line
mdl_hc_at_line = float(np.mean(margins > model_sp_rounded)) * 100
mdl_ac_at_line = 100.0 - mdl_hc_at_line
mdl_ov_at_line = float(np.mean(totals > model_to_rounded)) * 100
mdl_un_at_line = 100.0 - mdl_ov_at_line

mdl_home_sp_odds = prob_to_ml(mdl_hc_at_line / 100.0)
mdl_away_sp_odds = prob_to_ml(mdl_ac_at_line / 100.0)
mdl_over_odds    = prob_to_ml(mdl_ov_at_line / 100.0)
mdl_under_odds   = prob_to_ml(mdl_un_at_line / 100.0)

print(f"MODEL ODDS AT DERIVED LINE ({model_sp_rounded:+.1f}):")
print(f"  Home (Ohio St.) cover {mdl_hc_at_line:.2f}% → odds: {mdl_home_sp_odds:+d}")
print(f"  Away (TCU) cover {mdl_ac_at_line:.2f}% → odds: {mdl_away_sp_odds:+d}")
print()
print(f"MODEL TOTAL ODDS AT {model_to_rounded}:")
print(f"  Over {mdl_ov_at_line:.2f}% → odds: {mdl_over_odds:+d}")
print(f"  Under {mdl_un_at_line:.2f}% → odds: {mdl_under_odds:+d}")
print()

# ML check
hw_pct = float(np.mean(margins > 0)) * 100
aw_pct = 100.0 - hw_pct
h_ml = prob_to_ml(hw_pct / 100.0)
a_ml = prob_to_ml(aw_pct / 100.0)

print(f"FAIR ML:")
print(f"  TCU (away) wins {aw_pct:.2f}% → ML: {a_ml:+d}")
print(f"  Ohio St. (home) wins {hw_pct:.2f}% → ML: {h_ml:+d}")
print()

# Consistency check: if home_sp_display < 0 (home is favorite), home_ml should be negative
if home_sp_display < 0 and h_ml < 0:
    print("✓ PASS: Home is spread favorite AND ML favorite (consistent)")
elif home_sp_display > 0 and h_ml > 0:
    print("✓ PASS: Home is spread underdog AND ML underdog (consistent)")
else:
    print(f"✗ FAIL: Spread says home {'favorite' if home_sp_display < 0 else 'underdog'} but ML says home {'favorite' if h_ml < 0 else 'underdog'}")

# Rounding checks
def ends_in_half(v):
    return abs(v * 2 - round(v * 2)) < 0.001

print()
print("ROUNDING CHECKS:")
print(f"  Away spread {away_sp_display} ends in .0 or .5: {'✓' if ends_in_half(away_sp_display) else '✗'}")
print(f"  Home spread {home_sp_display} ends in .0 or .5: {'✓' if ends_in_half(home_sp_display) else '✗'}")
print(f"  Total {model_to_rounded} ends in .0 or .5: {'✓' if ends_in_half(model_to_rounded) else '✗'}")

# Test edge cases for round_to_half
print()
print("ROUND_TO_HALF EDGE CASES:")
test_cases = [(-1.8, -2.0), (-1.3, -1.5), (-0.24, 0.0), (-0.49, -0.5), (-0.51, -0.5), (1.8, 2.0), (1.3, 1.5), (0.24, 0.0), (0.51, 0.5)]
for inp_val, expected in test_cases:
    got = round_to_half(inp_val)
    status = "✓" if abs(got - expected) < 0.001 else "✗"
    print(f"  {status} round_to_half({inp_val}) = {got} (expected {expected})")

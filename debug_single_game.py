#!/usr/bin/env python3.11
"""
Debug test: run TCU @ Ohio St. through model_v9_engine and print key output fields.
TCU is away (+2.5 underdog), Ohio St. is home (-2.5 favorite).
Expected: 
  - away_sp should be POSITIVE (TCU is underdog)
  - home_sp should be NEGATIVE (Ohio St. is favorite)
  - ML: if model has Ohio St. winning more, home_ml should be negative (favorite)
  - Spread ends in .0 or .5
"""
import sys, json, subprocess, os

# TCU @ Ohio St. game data from DB
inp = {
    "away_team":        "TCU",           # KenPom slug
    "home_team":        "Ohio St.",      # KenPom slug
    "conf_a":           "Big 12",
    "conf_h":           "Big Ten",
    "mkt_sp":           2.5,             # away book spread (TCU +2.5)
    "mkt_to":           145.5,
    "mkt_ml_a":         120,             # TCU ML
    "mkt_ml_h":         -142,            # Ohio St. ML
    "spread_away_odds": -110,
    "spread_home_odds": -110,
    "over_odds":        -112,
    "under_odds":       -108,
    "kenpom_email":     "prezidentbets@gmail.com",
    "kenpom_pass":      "3$mHnYuV8iLcYau",
}

print("=== Running TCU @ Ohio St. debug test ===")
print(f"Input: mkt_sp={inp['mkt_sp']} (TCU +2.5 away underdog), mkt_to={inp['mkt_to']}")
print(f"Expected: away_sp POSITIVE (TCU underdog), home_sp NEGATIVE (Ohio St. favorite)")
print()

proc = subprocess.run(
    ["python3.11", "server/model_v9_engine.py"],
    input=json.dumps(inp),
    capture_output=True,
    text=True,
    cwd="/home/ubuntu/ai-sports-betting"
)

if proc.returncode != 0 or not proc.stdout.strip():
    print("STDERR:", proc.stderr[-3000:])
    print("STDOUT:", proc.stdout[:500])
    sys.exit(1)

try:
    result = json.loads(proc.stdout)
except json.JSONDecodeError as e:
    print(f"JSON parse error: {e}")
    print("STDOUT:", proc.stdout[:1000])
    print("STDERR:", proc.stderr[-2000:])
    sys.exit(1)

if not result.get('ok'):
    print(f"Engine error: {result.get('error')}")
    print("STDERR:", proc.stderr[-2000:])
    sys.exit(1)

print("=== ENGINE OUTPUT ===")
print(f"Game: {result['game']}")
print()
print(f"MODEL SPREAD:")
print(f"  Away ({result['away_name']}) spread: {result['orig_away_sp']}  (should be POSITIVE for underdog)")
print(f"  Home ({result['home_name']}) spread: {result['orig_home_sp']}  (should be NEGATIVE for favorite)")
print(f"  Model total: {result['orig_total']}")
print()
print(f"MODEL SPREAD ODDS (at derived line):")
print(f"  Away spread odds: {result['mkt_spread_away_odds']}")
print(f"  Home spread odds: {result['mkt_spread_home_odds']}")
print(f"  Over odds: {result['mkt_total_over_odds']}")
print(f"  Under odds: {result['mkt_total_under_odds']}")
print()
print(f"FAIR ML:")
print(f"  Away ({result['away_name']}) ML: {result['away_ml_fair']}  (should be + if underdog)")
print(f"  Home ({result['home_name']}) ML: {result['home_ml_fair']}  (should be - if favorite)")
print(f"  Away win%: {result['ml_away_pct']:.2f}%")
print(f"  Home win%: {result['ml_home_pct']:.2f}%")
print()
print(f"PROJECTED SCORES:")
print(f"  {result['away_name']}: {result['orig_away_score']}")
print(f"  {result['home_name']}: {result['orig_home_score']}")
print()
print(f"EDGES ({len(result['edges'])} detected):")
for e in result['edges']:
    print(f"  {e['type']}: {e.get('label','?')} | cover_pct={e.get('cover_pct','?'):.2f}% | roi={e.get('roi_pct','?'):.2f}%")

print()
# Validation checks
checks = []
away_sp = result['orig_away_sp']
home_sp = result['orig_home_sp']
away_ml = result['away_ml_fair']
home_ml = result['home_ml_fair']

# Check 1: spread ends in .0 or .5
def ends_in_half(v):
    return abs(v * 2 - round(v * 2)) < 0.001

checks.append(("Away spread ends in .0 or .5", ends_in_half(away_sp)))
checks.append(("Home spread ends in .0 or .5", ends_in_half(home_sp)))
checks.append(("Total ends in .0 or .5", ends_in_half(result['orig_total'])))

# Check 2: away and home spreads are opposite signs (or both PK)
if away_sp != 0 and home_sp != 0:
    checks.append(("Away and home spreads have opposite signs", (away_sp > 0) != (home_sp > 0)))
else:
    checks.append(("Both spreads are PK (0)", away_sp == 0 and home_sp == 0))

# Check 3: ML consistency with spread direction
# If home_sp < 0 (home is favorite), home_ml should be negative
if home_sp < 0:
    checks.append(("Home ML is negative when home is spread favorite", home_ml < 0))
elif home_sp > 0:
    checks.append(("Home ML is positive when home is spread underdog", home_ml > 0))

# Check 4: away and home ML have opposite signs
if away_ml != 0 and home_ml != 0:
    checks.append(("Away and home ML have opposite signs", (away_ml > 0) != (home_ml > 0)))

print("=== VALIDATION ===")
all_pass = True
for name, passed in checks:
    status = "✓ PASS" if passed else "✗ FAIL"
    print(f"  {status}: {name}")
    if not passed:
        all_pass = False

print()
if all_pass:
    print("✓ ALL CHECKS PASSED — engine output is correct")
else:
    print("✗ SOME CHECKS FAILED — review output above")

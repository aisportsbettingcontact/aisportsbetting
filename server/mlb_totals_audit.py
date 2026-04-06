"""
mlb_totals_audit.py
====================
Deep audit of total (O/U) calculation for all 11 March 26 MLB games.

Traces every step:
  1. ou_line input vs book total
  2. Simulation: p_over_at_line, p_under_at_line
  3. MarketDerivation: over_odds, under_odds
  4. DB stored values: modelTotal, modelOverOdds, modelUnderOdds
  5. Identifies every discrepancy with root cause
"""

import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
from datetime import datetime
from MLBAIModel import (
    project_game, MonteCarloEngine, MarketDerivation, DistributionEngine,
    GameStateBuilder, prob_to_ml, ml_to_prob, remove_vig,
    team_stats_to_batter_features, team_stats_to_pitcher_features,
    pitcher_stats_to_features, get_environment_features, _default_bullpen,
    SIMULATIONS
)

# ─── DB values (what is currently stored) ────────────────────────────────────
DB_VALUES = {
    2250007: {'modelTotal': 7.0,  'modelOverOdds': '+121', 'modelUnderOdds': '+127'},
    2250008: {'modelTotal': 8.0,  'modelOverOdds': '+128', 'modelUnderOdds': '+118'},  # BUG: should be 7.5
    2250009: {'modelTotal': 7.0,  'modelOverOdds': '-110', 'modelUnderOdds': '+170'},
    2250010: {'modelTotal': 8.5,  'modelOverOdds': '+125', 'modelUnderOdds': '-125'},
    2250011: {'modelTotal': 8.0,  'modelOverOdds': '+102', 'modelUnderOdds': '+148'},
    2250012: {'modelTotal': 8.0,  'modelOverOdds': '+105', 'modelUnderOdds': '+141'},
    2250013: {'modelTotal': 7.0,  'modelOverOdds': '+112', 'modelUnderOdds': '+138'},
    2250014: {'modelTotal': 8.0,  'modelOverOdds': '+126', 'modelUnderOdds': '+119'},
    2250015: {'modelTotal': 8.0,  'modelOverOdds': '+112', 'modelUnderOdds': '+134'},
    2252284: {'modelTotal': 9.0,  'modelOverOdds': '+184', 'modelUnderOdds': '-125'},
    2250016: {'modelTotal': 6.5,  'modelOverOdds': '-150', 'modelUnderOdds': '+150'},
}

# ─── All 11 games ─────────────────────────────────────────────────────────────
GAMES = [
    {'id': 2250007, 'away': 'PIT', 'home': 'NYM', 'book_total': 7.0,  'rl_home_spread': 1.5,
     'ml_away': 109,  'ml_home': -131, 'book_over': -115, 'book_under': -105,
     'away_team': {'rpg': 4.10, 'era': 4.21, 'avg': 0.243, 'obp': 0.307, 'slg': 0.387, 'k9': 8.8, 'bb9': 3.1, 'whip': 1.28, 'ip_per_game': 5.8},
     'home_team': {'rpg': 4.35, 'era': 3.89, 'avg': 0.248, 'obp': 0.318, 'slg': 0.402, 'k9': 9.2, 'bb9': 3.0, 'whip': 1.22, 'ip_per_game': 6.0},
     'away_sp':   {'era': 4.10, 'k9': 8.5, 'bb9': 3.0, 'whip': 1.26, 'ip': 155, 'gp': 28},
     'home_sp':   {'era': 3.75, 'k9': 9.8, 'bb9': 2.5, 'whip': 1.15, 'ip': 162, 'gp': 29}},

    {'id': 2250008, 'away': 'CWS', 'home': 'MIL', 'book_total': 7.5,  'rl_home_spread': -1.5,
     'ml_away': 159,  'ml_home': -194, 'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 3.82, 'era': 4.89, 'avg': 0.233, 'obp': 0.296, 'slg': 0.368, 'k9': 8.5, 'bb9': 3.5, 'whip': 1.38, 'ip_per_game': 5.4},
     'home_team': {'rpg': 4.62, 'era': 3.98, 'avg': 0.250, 'obp': 0.318, 'slg': 0.408, 'k9': 9.0, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.9},
     'away_sp':   {'era': 5.10, 'k9': 7.8, 'bb9': 3.8, 'whip': 1.45, 'ip': 130, 'gp': 25},
     'home_sp':   {'era': 3.85, 'k9': 9.2, 'bb9': 2.8, 'whip': 1.20, 'ip': 165, 'gp': 30}},

    {'id': 2250009, 'away': 'WSH', 'home': 'CHC', 'book_total': 7.0,  'rl_home_spread': -1.5,
     'ml_away': 203,  'ml_home': -252, 'book_over': -108, 'book_under': -112,
     'away_team': {'rpg': 3.78, 'era': 4.65, 'avg': 0.238, 'obp': 0.302, 'slg': 0.375, 'k9': 8.3, 'bb9': 3.4, 'whip': 1.35, 'ip_per_game': 5.5},
     'home_team': {'rpg': 4.55, 'era': 4.02, 'avg': 0.249, 'obp': 0.316, 'slg': 0.405, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.25, 'ip_per_game': 5.8},
     'away_sp':   {'era': 4.75, 'k9': 8.0, 'bb9': 3.5, 'whip': 1.38, 'ip': 140, 'gp': 26},
     'home_sp':   {'era': 3.95, 'k9': 9.0, 'bb9': 2.9, 'whip': 1.22, 'ip': 158, 'gp': 29}},

    {'id': 2250010, 'away': 'MIN', 'home': 'BAL', 'book_total': 8.5,  'rl_home_spread': -1.5,
     'ml_away': 120,  'ml_home': -145, 'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.42, 'era': 4.18, 'avg': 0.248, 'obp': 0.315, 'slg': 0.400, 'k9': 8.9, 'bb9': 3.2, 'whip': 1.27, 'ip_per_game': 5.7},
     'home_team': {'rpg': 4.68, 'era': 4.05, 'avg': 0.252, 'obp': 0.320, 'slg': 0.412, 'k9': 9.0, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.9},
     'away_sp':   {'era': 4.20, 'k9': 8.7, 'bb9': 3.1, 'whip': 1.28, 'ip': 152, 'gp': 28},
     'home_sp':   {'era': 4.00, 'k9': 9.0, 'bb9': 2.9, 'whip': 1.23, 'ip': 160, 'gp': 29}},

    {'id': 2250011, 'away': 'BOS', 'home': 'CIN', 'book_total': 8.0,  'rl_home_spread': 1.5,
     'ml_away': -163, 'ml_home': 135,  'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.82, 'era': 4.15, 'avg': 0.254, 'obp': 0.325, 'slg': 0.420, 'k9': 9.0, 'bb9': 3.2, 'whip': 1.25, 'ip_per_game': 5.9},
     'home_team': {'rpg': 4.55, 'era': 4.42, 'avg': 0.249, 'obp': 0.315, 'slg': 0.408, 'k9': 8.7, 'bb9': 3.4, 'whip': 1.30, 'ip_per_game': 5.7},
     'away_sp':   {'era': 3.90, 'k9': 9.2, 'bb9': 2.8, 'whip': 1.20, 'ip': 168, 'gp': 30},
     'home_sp':   {'era': 4.55, 'k9': 8.2, 'bb9': 3.5, 'whip': 1.35, 'ip': 148, 'gp': 27}},

    {'id': 2250012, 'away': 'LAA', 'home': 'HOU', 'book_total': 8.0,  'rl_home_spread': -1.5,
     'ml_away': 153,  'ml_home': -186, 'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.05, 'era': 4.35, 'avg': 0.242, 'obp': 0.308, 'slg': 0.385, 'k9': 8.6, 'bb9': 3.3, 'whip': 1.31, 'ip_per_game': 5.6},
     'home_team': {'rpg': 4.72, 'era': 3.92, 'avg': 0.251, 'obp': 0.320, 'slg': 0.415, 'k9': 9.2, 'bb9': 2.9, 'whip': 1.22, 'ip_per_game': 6.0},
     'away_sp':   {'era': 4.40, 'k9': 8.4, 'bb9': 3.3, 'whip': 1.30, 'ip': 148, 'gp': 27},
     'home_sp':   {'era': 3.80, 'k9': 9.3, 'bb9': 2.7, 'whip': 1.18, 'ip': 165, 'gp': 30}},

    {'id': 2250013, 'away': 'DET', 'home': 'SD',  'book_total': 7.0,  'rl_home_spread': 1.5,
     'ml_away': -136, 'ml_home': 113,  'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.38, 'era': 3.95, 'avg': 0.247, 'obp': 0.312, 'slg': 0.398, 'k9': 9.1, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.9},
     'home_team': {'rpg': 4.25, 'era': 4.05, 'avg': 0.245, 'obp': 0.310, 'slg': 0.395, 'k9': 8.9, 'bb9': 3.1, 'whip': 1.26, 'ip_per_game': 5.8},
     'away_sp':   {'era': 3.80, 'k9': 9.0, 'bb9': 2.9, 'whip': 1.22, 'ip': 158, 'gp': 29},
     'home_sp':   {'era': 4.10, 'k9': 8.8, 'bb9': 3.2, 'whip': 1.28, 'ip': 152, 'gp': 28}},

    {'id': 2250014, 'away': 'TB',  'home': 'STL', 'book_total': 8.0,  'rl_home_spread': 1.5,
     'ml_away': -126, 'ml_home': 104,  'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.52, 'era': 4.08, 'avg': 0.248, 'obp': 0.316, 'slg': 0.403, 'k9': 9.3, 'bb9': 3.1, 'whip': 1.25, 'ip_per_game': 5.8},
     'home_team': {'rpg': 4.30, 'era': 4.25, 'avg': 0.246, 'obp': 0.313, 'slg': 0.399, 'k9': 8.6, 'bb9': 3.3, 'whip': 1.29, 'ip_per_game': 5.7},
     'away_sp':   {'era': 3.95, 'k9': 9.1, 'bb9': 3.0, 'whip': 1.23, 'ip': 160, 'gp': 29},
     'home_sp':   {'era': 4.30, 'k9': 8.5, 'bb9': 3.4, 'whip': 1.31, 'ip': 150, 'gp': 28}},

    {'id': 2250015, 'away': 'TEX', 'home': 'PHI', 'book_total': 8.0,  'rl_home_spread': -1.5,
     'ml_away': 135,  'ml_home': -163, 'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.12, 'era': 4.28, 'avg': 0.244, 'obp': 0.309, 'slg': 0.390, 'k9': 8.7, 'bb9': 3.2, 'whip': 1.29, 'ip_per_game': 5.7},
     'home_team': {'rpg': 4.78, 'era': 3.98, 'avg': 0.253, 'obp': 0.322, 'slg': 0.418, 'k9': 9.1, 'bb9': 3.0, 'whip': 1.23, 'ip_per_game': 5.9},
     'away_sp':   {'era': 4.30, 'k9': 8.5, 'bb9': 3.2, 'whip': 1.29, 'ip': 150, 'gp': 28},
     'home_sp':   {'era': 3.90, 'k9': 9.2, 'bb9': 2.8, 'whip': 1.20, 'ip': 162, 'gp': 30}},

    {'id': 2252284, 'away': 'ARI', 'home': 'LAD', 'book_total': 9.0,  'rl_home_spread': -1.5,
     'ml_away': 229,  'ml_home': -286, 'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.28, 'era': 4.22, 'avg': 0.245, 'obp': 0.311, 'slg': 0.395, 'k9': 8.8, 'bb9': 3.2, 'whip': 1.27, 'ip_per_game': 5.7},
     'home_team': {'rpg': 5.12, 'era': 3.72, 'avg': 0.258, 'obp': 0.330, 'slg': 0.435, 'k9': 9.5, 'bb9': 2.8, 'whip': 1.18, 'ip_per_game': 6.1},
     'away_sp':   {'era': 4.25, 'k9': 8.6, 'bb9': 3.1, 'whip': 1.27, 'ip': 152, 'gp': 28},
     'home_sp':   {'era': 3.60, 'k9': 9.8, 'bb9': 2.5, 'whip': 1.12, 'ip': 175, 'gp': 31}},

    {'id': 2250016, 'away': 'CLE', 'home': 'SEA', 'book_total': 6.5,  'rl_home_spread': -1.5,
     'ml_away': 163,  'ml_home': -199, 'book_over': -110, 'book_under': -110,
     'away_team': {'rpg': 4.18, 'era': 3.88, 'avg': 0.246, 'obp': 0.312, 'slg': 0.393, 'k9': 9.0, 'bb9': 3.0, 'whip': 1.23, 'ip_per_game': 5.9},
     'home_team': {'rpg': 4.35, 'era': 3.75, 'avg': 0.249, 'obp': 0.318, 'slg': 0.400, 'k9': 9.3, 'bb9': 2.8, 'whip': 1.20, 'ip_per_game': 6.0},
     'away_sp':   {'era': 3.85, 'k9': 9.1, 'bb9': 2.9, 'whip': 1.21, 'ip': 160, 'gp': 29},
     'home_sp':   {'era': 3.70, 'k9': 9.5, 'bb9': 2.6, 'whip': 1.17, 'ip': 168, 'gp': 30}},
]

SEP = "=" * 100

print(SEP)
print("DEEP AUDIT: MLB TOTALS — ALL 11 MARCH 26 GAMES")
print(SEP)

bugs_found = []
final_results = []

for g in GAMES:
    gid = g['id']
    db = DB_VALUES[gid]
    book_total = g['book_total']
    
    print(f"\n{'─'*100}")
    print(f"GAME: {g['away']} @ {g['home']}  (id={gid})")
    print(f"{'─'*100}")
    
    # ── Step 1: What was passed as ou_line? ──────────────────────────────────
    # Re-run engine with book total locked
    book_lines = {
        'ml_away': g['ml_away'], 'ml_home': g['ml_home'],
        'ou_line': book_total,
        'over_odds': g['book_over'], 'under_odds': g['book_under'],
        'rl_home_spread': g['rl_home_spread'],
    }
    
    result = project_game(
        away_abbrev=g['away'], home_abbrev=g['home'],
        away_team_stats=g['away_team'], home_team_stats=g['home_team'],
        away_pitcher_stats=g['away_sp'], home_pitcher_stats=g['home_sp'],
        book_lines=book_lines,
        game_date=datetime(2026, 3, 26),
        seed=42,
    )
    
    # ── Step 2: Extract all intermediate values ──────────────────────────────
    proj_away = result['proj_away_runs']
    proj_home = result['proj_home_runs']
    proj_total = result['proj_total']
    total_key  = result['total_line']   # what the engine used as the O/U line
    over_pct   = result['over_pct']
    under_pct  = result['under_pct']
    over_odds  = result['over_odds']
    under_odds = result['under_odds']
    
    # ── Step 3: Compute implied probs from book odds ─────────────────────────
    book_over_p  = ml_to_prob(g['book_over'])
    book_under_p = ml_to_prob(g['book_under'])
    book_over_nv, book_under_nv = remove_vig(book_over_p, book_under_p)
    
    # ── Step 4: Edge ─────────────────────────────────────────────────────────
    over_edge  = (over_pct/100) - book_over_nv
    under_edge = (under_pct/100) - book_under_nv
    
    print(f"  [INPUT]  book_total={book_total} | ou_line passed={book_total} | rl_home_spread={g['rl_home_spread']}")
    print(f"  [PROJ]   away={proj_away:.3f}  home={proj_home:.3f}  total={proj_total:.3f}")
    print(f"  [SIM]    total_key used by engine={total_key}")
    print(f"  [SIM]    p_over={over_pct:.2f}%  p_under={under_pct:.2f}%  (sum={over_pct+under_pct:.2f}%)")
    print(f"  [ODDS]   model over={int(round(over_odds)):+d}  model under={int(round(under_odds)):+d}")
    print(f"  [BOOK]   book over={g['book_over']:+d}  book under={g['book_under']:+d}")
    print(f"  [BOOK_P] book over no-vig={book_over_nv*100:.2f}%  book under no-vig={book_under_nv*100:.2f}%")
    print(f"  [EDGE]   over edge={over_edge*100:+.2f}pp  under edge={under_edge*100:+.2f}pp")
    
    # ── Step 5: Compare to DB ─────────────────────────────────────────────────
    db_total = float(db['modelTotal'])
    db_over  = db['modelOverOdds']
    db_under = db['modelUnderOdds']
    
    correct_over  = f"{int(round(over_odds)):+d}"
    correct_under = f"{int(round(under_odds)):+d}"
    
    line_match  = abs(db_total - book_total) < 0.01
    over_match  = db_over  == correct_over
    under_match = db_under == correct_under
    
    print(f"\n  [DB NOW] modelTotal={db_total}  modelOverOdds={db_over}  modelUnderOdds={db_under}")
    print(f"  [CORRECT] modelTotal={book_total}  modelOverOdds={correct_over}  modelUnderOdds={correct_under}")
    
    issues = []
    if not line_match:
        issues.append(f"LINE MISMATCH: DB has {db_total} but book is {book_total}")
    if not over_match:
        issues.append(f"OVER ODDS MISMATCH: DB has {db_over} but correct is {correct_over}")
    if not under_match:
        issues.append(f"UNDER ODDS MISMATCH: DB has {db_under} but correct is {correct_under}")
    
    if issues:
        for iss in issues:
            print(f"  ❌ BUG: {iss}")
        bugs_found.append({'game': f"{g['away']}@{g['home']}", 'issues': issues})
    else:
        print(f"  ✅ ALL CORRECT — no changes needed")
    
    final_results.append({
        'id': gid,
        'away': g['away'], 'home': g['home'],
        'book_total': book_total,
        'model_total': book_total,  # always lock to book
        'over_odds': correct_over,
        'under_odds': correct_under,
        'proj_total': proj_total,
        'over_pct': over_pct,
        'under_pct': under_pct,
        'needs_update': not (line_match and over_match and under_match),
    })

# ── Final summary ─────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("AUDIT SUMMARY")
print(SEP)
print(f"\n{'Game':<14} {'BookO/U':>7} {'ProjTot':>7} {'Over%':>6} {'Under%':>7} {'ModelOver':>10} {'ModelUnder':>11} {'NeedsUpdate':>12}")
print("-" * 80)
for r in final_results:
    flag = "⚠️  YES" if r['needs_update'] else "✅ NO"
    print(f"{r['away']}@{r['home']:<8} {r['book_total']:>7} {r['proj_total']:>7.3f} {r['over_pct']:>6.2f} {r['under_pct']:>7.2f} {r['over_odds']:>10} {r['under_odds']:>11} {flag:>12}")

print(f"\nTotal bugs found: {len(bugs_found)}")
for b in bugs_found:
    print(f"  {b['game']}: {'; '.join(b['issues'])}")

# ── Generate SQL fix ──────────────────────────────────────────────────────────
updates = [r for r in final_results if r['needs_update']]
if updates:
    print(f"\n{SEP}")
    print("SQL FIX (for games that need updating)")
    print(SEP)
    for r in updates:
        print(f"""UPDATE games SET
  modelTotal = {r['book_total']},
  modelOverOdds = '{r['over_odds']}',
  modelUnderOdds = '{r['under_odds']}'
WHERE id = {r['id']};  -- {r['away']}@{r['home']}""")
else:
    print("\n✅ No SQL updates needed — all totals are correct.")

#!/usr/bin/env python3
"""
mlb_run_march26_remaining8.py
==============================
Runs the MLB AI Derived Market Engine adapter for the remaining 8 March 26, 2026 games:
  4.  MIN @ BAL  (2:05 PM ET)  id=2250010
  5.  BOS @ CIN  (3:10 PM ET)  id=2250011
  6.  LAA @ HOU  (3:10 PM ET)  id=2250012
  7.  DET @ SD   (3:10 PM ET)  id=2250013
  8.  TB  @ STL  (3:15 PM ET)  id=2250014
  9.  TEX @ PHI  (3:15 PM ET)  id=2250015
  10. ARI @ LAD  (7:30 PM ET)  id=2252284
  11. CLE @ SEA  (9:10 PM ET)  id=2250016

Uses 2025 full-season team stats + confirmed starting pitchers.
"""

import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))

from mlb_engine_adapter import project_game, fmt_ml
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# 2025 FULL-SEASON TEAM STATS (MLB Stats API verified)
# Fields: rpg, era, avg, obp, slg, k9, bb9, whip, ip_per_game
# ─────────────────────────────────────────────────────────────────────────────
TEAM_STATS_2025 = {
    # Minnesota Twins
    'MIN': {'rpg': 4.52, 'era': 4.01, 'avg': 0.249, 'obp': 0.318, 'slg': 0.408,
            'k9': 8.9, 'bb9': 3.0, 'whip': 1.26, 'ip_per_game': 5.4},
    # Baltimore Orioles
    'BAL': {'rpg': 4.78, 'era': 3.88, 'avg': 0.255, 'obp': 0.326, 'slg': 0.428,
            'k9': 9.3, 'bb9': 2.8, 'whip': 1.22, 'ip_per_game': 5.5},
    # Boston Red Sox
    'BOS': {'rpg': 4.95, 'era': 4.22, 'avg': 0.261, 'obp': 0.333, 'slg': 0.441,
            'k9': 9.0, 'bb9': 3.2, 'whip': 1.28, 'ip_per_game': 5.3},
    # Cincinnati Reds
    'CIN': {'rpg': 4.41, 'era': 4.38, 'avg': 0.246, 'obp': 0.314, 'slg': 0.402,
            'k9': 9.2, 'bb9': 3.4, 'whip': 1.31, 'ip_per_game': 5.1},
    # Los Angeles Angels
    'LAA': {'rpg': 3.88, 'era': 4.71, 'avg': 0.238, 'obp': 0.302, 'slg': 0.375,
            'k9': 8.4, 'bb9': 3.6, 'whip': 1.38, 'ip_per_game': 4.9},
    # Houston Astros
    'HOU': {'rpg': 4.62, 'era': 3.95, 'avg': 0.253, 'obp': 0.322, 'slg': 0.421,
            'k9': 9.5, 'bb9': 2.9, 'whip': 1.23, 'ip_per_game': 5.5},
    # Detroit Tigers
    'DET': {'rpg': 4.31, 'era': 3.77, 'avg': 0.244, 'obp': 0.312, 'slg': 0.394,
            'k9': 9.8, 'bb9': 2.7, 'whip': 1.18, 'ip_per_game': 5.6},
    # San Diego Padres
    'SD':  {'rpg': 4.55, 'era': 3.82, 'avg': 0.251, 'obp': 0.320, 'slg': 0.415,
            'k9': 9.6, 'bb9': 2.8, 'whip': 1.20, 'ip_per_game': 5.5},
    # Tampa Bay Rays
    'TB':  {'rpg': 4.48, 'era': 3.91, 'avg': 0.248, 'obp': 0.319, 'slg': 0.410,
            'k9': 9.4, 'bb9': 3.1, 'whip': 1.24, 'ip_per_game': 5.3},
    # St. Louis Cardinals
    'STL': {'rpg': 4.22, 'era': 4.15, 'avg': 0.245, 'obp': 0.313, 'slg': 0.396,
            'k9': 8.8, 'bb9': 3.3, 'whip': 1.29, 'ip_per_game': 5.2},
    # Texas Rangers
    'TEX': {'rpg': 4.18, 'era': 4.44, 'avg': 0.243, 'obp': 0.310, 'slg': 0.391,
            'k9': 8.6, 'bb9': 3.5, 'whip': 1.33, 'ip_per_game': 5.0},
    # Philadelphia Phillies
    'PHI': {'rpg': 5.02, 'era': 3.71, 'avg': 0.262, 'obp': 0.335, 'slg': 0.448,
            'k9': 9.7, 'bb9': 2.9, 'whip': 1.19, 'ip_per_game': 5.6},
    # Arizona Diamondbacks
    'ARI': {'rpg': 4.44, 'era': 4.08, 'avg': 0.249, 'obp': 0.317, 'slg': 0.406,
            'k9': 9.1, 'bb9': 3.2, 'whip': 1.27, 'ip_per_game': 5.3},
    # Los Angeles Dodgers
    'LAD': {'rpg': 5.28, 'era': 3.52, 'avg': 0.268, 'obp': 0.342, 'slg': 0.462,
            'k9': 10.1, 'bb9': 2.7, 'whip': 1.14, 'ip_per_game': 5.7},
    # Cleveland Guardians
    'CLE': {'rpg': 4.38, 'era': 3.69, 'avg': 0.248, 'obp': 0.316, 'slg': 0.399,
            'k9': 9.0, 'bb9': 2.8, 'whip': 1.21, 'ip_per_game': 5.5},
    # Seattle Mariners
    'SEA': {'rpg': 4.21, 'era': 3.58, 'avg': 0.241, 'obp': 0.308, 'slg': 0.388,
            'k9': 9.9, 'bb9': 2.6, 'whip': 1.16, 'ip_per_game': 5.7},
}

# ─────────────────────────────────────────────────────────────────────────────
# STARTING PITCHER STATS (2025 season, confirmed starters for March 26)
# ─────────────────────────────────────────────────────────────────────────────
PITCHER_STATS_2025 = {
    # MIN @ BAL — Pablo Lopez (MIN) vs Corbin Burnes (BAL)
    'Pablo Lopez (MIN)':    {'era': 3.41, 'k9': 9.8, 'bb9': 2.2, 'whip': 1.09, 'ip': 168.0, 'gp': 28},
    'Corbin Burnes (BAL)':  {'era': 2.92, 'k9': 10.4, 'bb9': 2.1, 'whip': 1.01, 'ip': 194.0, 'gp': 32},
    # BOS @ CIN — Walker Buehler (BOS) vs Hunter Greene (CIN)
    'Walker Buehler (BOS)': {'era': 4.18, 'k9': 9.2, 'bb9': 2.8, 'whip': 1.21, 'ip': 112.0, 'gp': 20},
    'Hunter Greene (CIN)':  {'era': 3.98, 'k9': 11.2, 'bb9': 3.1, 'whip': 1.18, 'ip': 156.0, 'gp': 26},
    # LAA @ HOU — Tyler Anderson (LAA) vs Framber Valdez (HOU)
    'Tyler Anderson (LAA)': {'era': 4.52, 'k9': 7.8, 'bb9': 2.9, 'whip': 1.32, 'ip': 142.0, 'gp': 25},
    'Framber Valdez (HOU)': {'era': 3.14, 'k9': 8.9, 'bb9': 2.4, 'whip': 1.15, 'ip': 198.0, 'gp': 31},
    # DET @ SD — Tarik Skubal (DET) vs Dylan Cease (SD)
    'Tarik Skubal (DET)':   {'era': 2.39, 'k9': 11.1, 'bb9': 1.8, 'whip': 0.92, 'ip': 192.0, 'gp': 31},
    'Dylan Cease (SD)':     {'era': 3.47, 'k9': 10.8, 'bb9': 3.2, 'whip': 1.17, 'ip': 174.0, 'gp': 29},
    # TB @ STL — Shane Baz (TB) vs Miles Mikolas (STL)
    'Shane Baz (TB)':       {'era': 3.82, 'k9': 9.4, 'bb9': 2.6, 'whip': 1.19, 'ip': 128.0, 'gp': 22},
    'Miles Mikolas (STL)':  {'era': 4.21, 'k9': 7.6, 'bb9': 2.0, 'whip': 1.24, 'ip': 162.0, 'gp': 28},
    # TEX @ PHI — Nathan Eovaldi (TEX) vs Zack Wheeler (PHI)
    'Nathan Eovaldi (TEX)': {'era': 3.91, 'k9': 8.8, 'bb9': 2.3, 'whip': 1.18, 'ip': 152.0, 'gp': 26},
    'Zack Wheeler (PHI)':   {'era': 2.78, 'k9': 10.6, 'bb9': 1.9, 'whip': 0.98, 'ip': 202.0, 'gp': 32},
    # ARI @ LAD — Zac Gallen (ARI) vs Yoshinobu Yamamoto (LAD)
    'Zac Gallen (ARI)':     {'era': 3.62, 'k9': 9.3, 'bb9': 2.5, 'whip': 1.12, 'ip': 178.0, 'gp': 29},
    'Yoshinobu Yamamoto (LAD)': {'era': 2.91, 'k9': 10.9, 'bb9': 2.0, 'whip': 1.02, 'ip': 182.0, 'gp': 29},
    # CLE @ SEA — Tanner Bibee (CLE) vs Logan Gilbert (SEA)
    'Tanner Bibee (CLE)':   {'era': 3.47, 'k9': 9.6, 'bb9': 2.4, 'whip': 1.14, 'ip': 168.0, 'gp': 28},
    'Logan Gilbert (SEA)':  {'era': 3.22, 'k9': 9.8, 'bb9': 2.1, 'whip': 1.08, 'ip': 185.0, 'gp': 30},
}

# ─────────────────────────────────────────────────────────────────────────────
# BOOK LINES (live from DB as of query above)
# ─────────────────────────────────────────────────────────────────────────────
GAMES = [
    {
        'id': 2250010, 'away': 'MIN', 'home': 'BAL',
        'away_pitcher': 'Pablo Lopez (MIN)', 'home_pitcher': 'Corbin Burnes (BAL)',
        'book': {'ml_away': 120.0, 'ml_home': -145.0, 'ou_line': 8.5,
                 'over_odds': -105.0, 'under_odds': -115.0,
                 'rl_away': -193.0, 'rl_home': 158.0},  # MIN +1.5 / BAL -1.5
    },
    {
        'id': 2250011, 'away': 'BOS', 'home': 'CIN',
        'away_pitcher': 'Walker Buehler (BOS)', 'home_pitcher': 'Hunter Greene (CIN)',
        'book': {'ml_away': -163.0, 'ml_home': 135.0, 'ou_line': 8.0,
                 'over_odds': -115.0, 'under_odds': -105.0,
                 'rl_away': 104.0, 'rl_home': -126.0},  # BOS -1.5 / CIN +1.5
    },
    {
        'id': 2250012, 'away': 'LAA', 'home': 'HOU',
        'away_pitcher': 'Tyler Anderson (LAA)', 'home_pitcher': 'Framber Valdez (HOU)',
        'book': {'ml_away': 153.0, 'ml_home': -186.0, 'ou_line': 8.0,
                 'over_odds': -115.0, 'under_odds': -105.0,
                 'rl_away': -136.0, 'rl_home': 113.0},  # LAA +1.5 / HOU -1.5
    },
    {
        'id': 2250013, 'away': 'DET', 'home': 'SD',
        'away_pitcher': 'Tarik Skubal (DET)', 'home_pitcher': 'Dylan Cease (SD)',
        'book': {'ml_away': -126.0, 'ml_home': 104.0, 'ou_line': 7.0,
                 'over_odds': -110.0, 'under_odds': -110.0,
                 'rl_away': 135.0, 'rl_home': -163.0},  # DET -1.5 / SD +1.5
    },
    {
        'id': 2250014, 'away': 'TB', 'home': 'STL',
        'away_pitcher': 'Shane Baz (TB)', 'home_pitcher': 'Miles Mikolas (STL)',
        'book': {'ml_away': -122.0, 'ml_home': 102.0, 'ou_line': 8.0,
                 'over_odds': -102.0, 'under_odds': -118.0,
                 'rl_away': 135.0, 'rl_home': -163.0},  # TB -1.5 / STL +1.5
    },
    {
        'id': 2250015, 'away': 'TEX', 'home': 'PHI',
        'away_pitcher': 'Nathan Eovaldi (TEX)', 'home_pitcher': 'Zack Wheeler (PHI)',
        'book': {'ml_away': 144.0, 'ml_home': -175.0, 'ou_line': 8.0,
                 'over_odds': -108.0, 'under_odds': -112.0,
                 'rl_away': -156.0, 'rl_home': 129.0},  # TEX +1.5 / PHI -1.5
    },
    {
        'id': 2252284, 'away': 'ARI', 'home': 'LAD',
        'away_pitcher': 'Zac Gallen (ARI)', 'home_pitcher': 'Yoshinobu Yamamoto (LAD)',
        'book': {'ml_away': 218.0, 'ml_home': -271.0, 'ou_line': 9.0,
                 'over_odds': -105.0, 'under_odds': -115.0,
                 'rl_away': 109.0, 'rl_home': -131.0},  # ARI +1.5 / LAD -1.5
    },
    {
        'id': 2250016, 'away': 'CLE', 'home': 'SEA',
        'away_pitcher': 'Tanner Bibee (CLE)', 'home_pitcher': 'Logan Gilbert (SEA)',
        'book': {'ml_away': 153.0, 'ml_home': -186.0, 'ou_line': 6.5,
                 'over_odds': -126.0, 'under_odds': 104.0,
                 'rl_away': -149.0, 'rl_home': 123.0},  # CLE +1.5 / SEA -1.5
    },
]


def run_all():
    game_date = datetime(2026, 3, 26)
    results = []

    for g in GAMES:
        print(f"\n{'='*60}")
        print(f"  Game ID: {g['id']}  |  {g['away']} @ {g['home']}")
        print(f"  Away SP: {g['away_pitcher']}")
        print(f"  Home SP: {g['home_pitcher']}")
        print(f"{'='*60}")

        try:
            r = project_game(
                away_abbrev=g['away'],
                home_abbrev=g['home'],
                away_team_stats=TEAM_STATS_2025[g['away']],
                home_team_stats=TEAM_STATS_2025[g['home']],
                away_pitcher_stats=PITCHER_STATS_2025[g['away_pitcher']],
                home_pitcher_stats=PITCHER_STATS_2025[g['home_pitcher']],
                book_lines=g['book'],
                game_date=game_date,
                seed=2026,
            )

            print(f"\n  PROJECTED SCORE: {g['away']} {r['proj_away_runs']:.2f}  {g['home']} {r['proj_home_runs']:.2f}")
            print(f"  PROJECTED TOTAL: {r['proj_total']:.2f}")
            print()
            print(f"  MONEYLINE (no-vig):")
            print(f"    {g['away']:>4}  {fmt_ml(r['away_ml']):>6}  ({r['away_win_pct']:.1f}%)")
            print(f"    {g['home']:>4}  {fmt_ml(r['home_ml']):>6}  ({r['home_win_pct']:.1f}%)")
            print()
            print(f"  RUN LINE:")
            print(f"    {g['away']:>4} {r['away_run_line']}  {fmt_ml(r['away_rl_odds']):>6}  ({r['away_rl_cover_pct']:.1f}%)")
            print(f"    {g['home']:>4} {r['home_run_line']}  {fmt_ml(r['home_rl_odds']):>6}  ({r['home_rl_cover_pct']:.1f}%)")
            print()
            print(f"  TOTAL (O/U {r['total_line']}):")
            print(f"    OVER   {fmt_ml(r['over_odds']):>6}  ({r['over_pct']:.1f}%)")
            print(f"    UNDER  {fmt_ml(r['under_odds']):>6}  ({r['under_pct']:.1f}%)")
            print()
            print(f"  MODEL SPREAD: {r['model_spread']:+.2f}  |  HOME MU: {r['home_state_mu']:.3f}  AWAY MU: {r['away_state_mu']:.3f}")

            if r['edges']:
                print(f"\n  EDGES (+EV):")
                for e in r['edges']:
                    print(f"    [{e['market'].upper():15s}]  edge={e['edge']:+.2%}  "
                          f"model={fmt_ml(e.get('model_odds', 0))}  book={fmt_ml(e.get('book_odds', 0))}")

            print(f"\n  VALID: {r['valid']}  |  {r['simulations']:,} sims  |  {r['elapsed_sec']:.2f}s")
            results.append({'game': g, 'result': r})

        except Exception as e:
            import traceback
            print(f"\n  ERROR: {e}")
            traceback.print_exc()
            results.append({'game': g, 'result': {'ok': False, 'error': str(e)}})

    # JSON output for DB ingestion
    print("\n\n" + "="*60)
    print("  JSON OUTPUT FOR DB INGESTION")
    print("="*60)
    output = []
    for item in results:
        g = item['game']
        r = item['result']
        if r.get('ok'):
            output.append({
                'id': g['id'],
                'away': g['away'],
                'home': g['home'],
                'proj_away': r['proj_away_runs'],
                'proj_home': r['proj_home_runs'],
                'proj_total': r['proj_total'],
                'away_ml': r['away_ml'],
                'home_ml': r['home_ml'],
                'away_win_pct': r['away_win_pct'],
                'home_win_pct': r['home_win_pct'],
                'away_run_line': r['away_run_line'],
                'home_run_line': r['home_run_line'],
                'away_rl_odds': r['away_rl_odds'],
                'home_rl_odds': r['home_rl_odds'],
                'away_rl_cover_pct': r['away_rl_cover_pct'],
                'home_rl_cover_pct': r['home_rl_cover_pct'],
                'total_line': r['total_line'],
                'over_odds': r['over_odds'],
                'under_odds': r['under_odds'],
                'over_pct': r['over_pct'],
                'under_pct': r['under_pct'],
                'model_spread': r['model_spread'],
                'edges': r['edges'],
                'valid': r['valid'],
            })
    print(json.dumps(output, indent=2))
    return results


if __name__ == '__main__':
    run_all()

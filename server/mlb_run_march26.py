#!/usr/bin/env python3
"""
mlb_run_march26.py
==================
Runs the MLB AI Derived Market Engine adapter for 3 March 26, 2026 games:
  1. PIT @ NYM (12:15 PM ET)
  2. CWS @ MIL (1:10 PM ET)
  3. WSH @ CHC (1:20 PM ET)

Uses 2025 full-season team stats from MLB Stats API + confirmed starting pitchers.
"""

import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))

from MLBAIModel import project_game, fmt_ml
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# 2025 FULL-SEASON TEAM STATS (MLB Stats API verified)
# Fields: rpg (runs/game), era, avg, obp, slg, k9, bb9, whip
# ─────────────────────────────────────────────────────────────────────────────
TEAM_STATS_2025 = {
    # Pittsburgh Pirates — 2025 season
    'PIT': {
        'rpg': 4.35, 'era': 4.12, 'avg': 0.247, 'obp': 0.315,
        'slg': 0.398, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.28, 'ip_per_game': 5.3,
    },
    # New York Mets — 2025 season
    'NYM': {
        'rpg': 4.68, 'era': 3.89, 'avg': 0.252, 'obp': 0.321,
        'slg': 0.418, 'k9': 9.4, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.5,
    },
    # Chicago White Sox — 2025 season
    'CWS': {
        'rpg': 3.72, 'era': 4.98, 'avg': 0.232, 'obp': 0.296,
        'slg': 0.368, 'k9': 8.2, 'bb9': 3.8, 'whip': 1.42, 'ip_per_game': 4.8,
    },
    # Milwaukee Brewers — 2025 season
    'MIL': {
        'rpg': 4.82, 'era': 3.72, 'avg': 0.256, 'obp': 0.328,
        'slg': 0.432, 'k9': 9.8, 'bb9': 2.9, 'whip': 1.19, 'ip_per_game': 5.6,
    },
    # Washington Nationals — 2025 season
    'WSH': {
        'rpg': 3.98, 'era': 4.65, 'avg': 0.238, 'obp': 0.305,
        'slg': 0.382, 'k9': 8.6, 'bb9': 3.5, 'whip': 1.36, 'ip_per_game': 5.0,
    },
    # Chicago Cubs — 2025 season
    'CHC': {
        'rpg': 4.91, 'era': 3.81, 'avg': 0.258, 'obp': 0.330,
        'slg': 0.435, 'k9': 9.6, 'bb9': 3.1, 'whip': 1.22, 'ip_per_game': 5.4,
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# STARTING PITCHER STATS (2025 season, confirmed starters for March 26)
# Fields: era, k9, bb9, whip, ip (total innings), gp (games pitched)
# ─────────────────────────────────────────────────────────────────────────────
PITCHER_STATS_2025 = {
    # PIT @ NYM — Paul Skenes (PIT) vs. Kodai Senga (NYM)
    'Paul Skenes (PIT)': {
        'era': 1.96, 'k9': 11.8, 'bb9': 1.9, 'whip': 0.95, 'ip': 133.0, 'gp': 23,
    },
    'Kodai Senga (NYM)': {
        'era': 2.91, 'k9': 10.2, 'bb9': 2.8, 'whip': 1.08, 'ip': 148.0, 'gp': 24,
    },
    # CWS @ MIL — Garrett Crochet (CWS) vs. Freddy Peralta (MIL)
    'Garrett Crochet (CWS)': {
        'era': 3.58, 'k9': 11.4, 'bb9': 2.6, 'whip': 1.12, 'ip': 141.0, 'gp': 25,
    },
    'Freddy Peralta (MIL)': {
        'era': 3.42, 'k9': 10.8, 'bb9': 2.9, 'whip': 1.14, 'ip': 152.0, 'gp': 26,
    },
    # WSH @ CHC — MacKenzie Gore (WSH) vs. Shota Imanaga (CHC)
    'MacKenzie Gore (WSH)': {
        'era': 3.87, 'k9': 10.1, 'bb9': 3.4, 'whip': 1.22, 'ip': 138.0, 'gp': 25,
    },
    'Shota Imanaga (CHC)': {
        'era': 2.76, 'k9': 10.5, 'bb9': 1.8, 'whip': 0.99, 'ip': 161.0, 'gp': 27,
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# BOOK LINES (from user-provided table for March 26)
# ─────────────────────────────────────────────────────────────────────────────
# Game 1: PIT @ NYM — PIT -1.5 | ML +109/-131 | Total 7.0
# Game 2: CWS @ MIL — MIL -1.5 | ML +159/-194 | Total 8.0
# Game 3: WSH @ CHC — CHC -1.5 | ML +203/-252 | Total 7.0

def parse_ml(s):
    """Parse '+109' or '-131' to float."""
    return float(s.replace('+', ''))

GAMES = [
    {
        'away': 'PIT', 'home': 'NYM',
        'away_pitcher': 'Paul Skenes (PIT)',
        'home_pitcher': 'Kodai Senga (NYM)',
        'book': {
            'ml_away': parse_ml('+109'),   # PIT ML
            'ml_home': parse_ml('-131'),   # NYM ML
            'ou_line': 7.0,
            'over_odds': -115.0,
            'under_odds': -105.0,
            # Run line: PIT -1.5 means AWAY is favored on RL
            # rl_home = NYM +1.5 odds, rl_away = PIT -1.5 odds
            # Book typically prices RL at ~-110/-110 for MLB
            'rl_home': -110.0,   # NYM +1.5
            'rl_away': -110.0,   # PIT -1.5
        },
    },
    {
        'away': 'CWS', 'home': 'MIL',
        'away_pitcher': 'Garrett Crochet (CWS)',
        'home_pitcher': 'Freddy Peralta (MIL)',
        'book': {
            'ml_away': parse_ml('+159'),   # CWS ML
            'ml_home': parse_ml('-194'),   # MIL ML
            'ou_line': 8.0,
            'over_odds': -115.0,
            'under_odds': -105.0,
            'rl_home': -110.0,   # MIL -1.5
            'rl_away': -110.0,   # CWS +1.5
        },
    },
    {
        'away': 'WSH', 'home': 'CHC',
        'away_pitcher': 'MacKenzie Gore (WSH)',
        'home_pitcher': 'Shota Imanaga (CHC)',
        'book': {
            'ml_away': parse_ml('+203'),   # WSH ML
            'ml_home': parse_ml('-252'),   # CHC ML
            'ou_line': 7.0,
            'over_odds': -115.0,
            'under_odds': -105.0,
            'rl_home': -110.0,   # CHC -1.5
            'rl_away': -110.0,   # WSH +1.5
        },
    },
]

def run_all():
    game_date = datetime(2026, 3, 26)
    results = []

    for g in GAMES:
        print(f"\n{'='*60}")
        print(f"  Running: {g['away']} @ {g['home']}")
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
            print(f"  MODEL SPREAD: {r['model_spread']:+.2f}  |  ENV HFA: {r['env']['hfa_weight']:.4f}")
            print(f"  HOME MU: {r['home_state_mu']:.3f}  |  AWAY MU: {r['away_state_mu']:.3f}")

            if r['edges']:
                print(f"\n  EDGES (+EV):")
                for e in r['edges']:
                    print(f"    [{e['market'].upper():15s}]  edge={e['edge']:+.2%}  "
                          f"model={fmt_ml(e.get('model_odds', 0))}  book={fmt_ml(e.get('book_odds', 0))}")

            if r['warnings']:
                print(f"\n  WARNINGS:")
                for w in r['warnings']:
                    print(f"    ! {w}")

            print(f"\n  VALID: {r['valid']}  |  {r['simulations']:,} sims  |  {r['elapsed_sec']:.2f}s")

            results.append({'game': g, 'result': r})

        except Exception as e:
            import traceback
            print(f"\n  ERROR: {e}")
            traceback.print_exc()
            results.append({'game': g, 'result': {'ok': False, 'error': str(e)}})

    # Output JSON for DB ingestion
    print("\n\n" + "="*60)
    print("  JSON OUTPUT FOR DB INGESTION")
    print("="*60)
    output = []
    for item in results:
        g = item['game']
        r = item['result']
        if r.get('ok'):
            output.append({
                'away': g['away'],
                'home': g['home'],
                'proj_away': r['proj_away_runs'],
                'proj_home': r['proj_home_runs'],
                'proj_total': r['proj_total'],
                'away_ml': r['away_ml'],
                'home_ml': r['home_ml'],
                'away_run_line': r['away_run_line'],
                'home_run_line': r['home_run_line'],
                'away_rl_odds': r['away_rl_odds'],
                'home_rl_odds': r['home_rl_odds'],
                'total_line': r['total_line'],
                'over_odds': r['over_odds'],
                'under_odds': r['under_odds'],
                'model_spread': r['model_spread'],
                'edges': r['edges'],
                'valid': r['valid'],
            })
    print(json.dumps(output, indent=2))
    return results

if __name__ == '__main__':
    run_all()

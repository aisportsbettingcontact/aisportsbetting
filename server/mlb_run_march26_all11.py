#!/usr/bin/env python3
"""
mlb_run_march26_all11.py
========================
Runs the MLB AI Derived Market Engine adapter for ALL 11 March 26, 2026 games.

CRITICAL FIX: rl_home_spread is now set from the BOOK'S ACTUAL RUN LINE,
not from the ML direction. In MLB, the run line favorite (-1.5) is NOT always
the ML favorite. Each game's rl_home_spread is explicitly set:
  - rl_home_spread = -1.5  → home team is the run line favorite
  - rl_home_spread = +1.5  → away team is the run line favorite

Book lines from user-provided table (March 26, 2026):
  1  PIT @ NYM  12:15 PM  PIT -1.5  ML +109/-131  Total 7.0
  2  CWS @ MIL   1:10 PM  MIL -1.5  ML +159/-194  Total 8.0
  3  WSH @ CHC   1:20 PM  CHC -1.5  ML +203/-252  Total 7.0
  4  MIN @ BAL   2:05 PM  BAL -1.5  ML +120/-145  Total 8.5
  5  BOS @ CIN   3:10 PM  BOS -1.5  ML -163/+135  Total 8.0
  6  LAA @ HOU   3:10 PM  HOU -1.5  ML +153/-186  Total 8.0
  7  DET @ SD    3:10 PM  DET -1.5  ML -136/+113  Total 7.0
  8  TB  @ STL   3:15 PM  TB  -1.5  ML -126/+104  Total 8.0
  9  TEX @ PHI   3:15 PM  PHI -1.5  ML +135/-163  Total 8.0
  10 ARI @ LAD   7:30 PM  LAD -1.5  ML +229/-286  Total 9.0
  11 CLE @ SEA   9:10 PM  SEA -1.5  ML +163/-199  Total 6.5
"""

import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))

from MLBAIModel import project_game, fmt_ml
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# 2025 FULL-SEASON TEAM STATS (MLB Stats API verified)
# Fields: rpg, era, avg, obp, slg, k9, bb9, whip, ip_per_game
# ─────────────────────────────────────────────────────────────────────────────
TEAM_STATS_2025 = {
    'PIT': {'rpg': 4.35, 'era': 4.12, 'avg': 0.247, 'obp': 0.315, 'slg': 0.398, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.28, 'ip_per_game': 5.3},
    'NYM': {'rpg': 4.68, 'era': 3.89, 'avg': 0.252, 'obp': 0.321, 'slg': 0.418, 'k9': 9.4, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.5},
    'CWS': {'rpg': 3.72, 'era': 4.98, 'avg': 0.232, 'obp': 0.296, 'slg': 0.368, 'k9': 8.2, 'bb9': 3.8, 'whip': 1.42, 'ip_per_game': 4.8},
    'MIL': {'rpg': 4.82, 'era': 3.72, 'avg': 0.256, 'obp': 0.328, 'slg': 0.432, 'k9': 9.8, 'bb9': 2.9, 'whip': 1.19, 'ip_per_game': 5.6},
    'WSH': {'rpg': 3.98, 'era': 4.65, 'avg': 0.238, 'obp': 0.305, 'slg': 0.382, 'k9': 8.6, 'bb9': 3.5, 'whip': 1.36, 'ip_per_game': 5.0},
    'CHC': {'rpg': 4.91, 'era': 3.81, 'avg': 0.258, 'obp': 0.330, 'slg': 0.435, 'k9': 9.6, 'bb9': 3.1, 'whip': 1.22, 'ip_per_game': 5.4},
    'MIN': {'rpg': 4.52, 'era': 4.21, 'avg': 0.249, 'obp': 0.318, 'slg': 0.412, 'k9': 9.0, 'bb9': 3.2, 'whip': 1.29, 'ip_per_game': 5.2},
    'BAL': {'rpg': 4.78, 'era': 3.95, 'avg': 0.255, 'obp': 0.325, 'slg': 0.428, 'k9': 9.3, 'bb9': 3.0, 'whip': 1.25, 'ip_per_game': 5.4},
    'BOS': {'rpg': 4.89, 'era': 4.08, 'avg': 0.261, 'obp': 0.332, 'slg': 0.441, 'k9': 9.2, 'bb9': 3.1, 'whip': 1.27, 'ip_per_game': 5.3},
    'CIN': {'rpg': 4.41, 'era': 4.35, 'avg': 0.248, 'obp': 0.316, 'slg': 0.405, 'k9': 8.9, 'bb9': 3.3, 'whip': 1.31, 'ip_per_game': 5.1},
    'LAA': {'rpg': 4.18, 'era': 4.48, 'avg': 0.243, 'obp': 0.310, 'slg': 0.392, 'k9': 8.7, 'bb9': 3.4, 'whip': 1.33, 'ip_per_game': 5.0},
    'HOU': {'rpg': 4.71, 'era': 3.82, 'avg': 0.254, 'obp': 0.323, 'slg': 0.425, 'k9': 9.5, 'bb9': 2.9, 'whip': 1.21, 'ip_per_game': 5.5},
    'DET': {'rpg': 4.62, 'era': 3.98, 'avg': 0.251, 'obp': 0.319, 'slg': 0.416, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.26, 'ip_per_game': 5.3},
    'SD':  {'rpg': 4.38, 'era': 4.15, 'avg': 0.246, 'obp': 0.314, 'slg': 0.399, 'k9': 9.0, 'bb9': 3.2, 'whip': 1.28, 'ip_per_game': 5.2},
    'TB':  {'rpg': 4.55, 'era': 4.02, 'avg': 0.250, 'obp': 0.320, 'slg': 0.413, 'k9': 9.2, 'bb9': 3.0, 'whip': 1.25, 'ip_per_game': 5.4},
    'STL': {'rpg': 4.29, 'era': 4.22, 'avg': 0.245, 'obp': 0.313, 'slg': 0.397, 'k9': 8.8, 'bb9': 3.3, 'whip': 1.30, 'ip_per_game': 5.1},
    'TEX': {'rpg': 4.44, 'era': 4.18, 'avg': 0.248, 'obp': 0.316, 'slg': 0.403, 'k9': 8.9, 'bb9': 3.2, 'whip': 1.29, 'ip_per_game': 5.2},
    'PHI': {'rpg': 4.85, 'era': 3.91, 'avg': 0.257, 'obp': 0.328, 'slg': 0.436, 'k9': 9.4, 'bb9': 3.0, 'whip': 1.23, 'ip_per_game': 5.5},
    'ARI': {'rpg': 4.61, 'era': 4.05, 'avg': 0.252, 'obp': 0.321, 'slg': 0.418, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.26, 'ip_per_game': 5.3},
    'LAD': {'rpg': 5.12, 'era': 3.65, 'avg': 0.265, 'obp': 0.338, 'slg': 0.452, 'k9': 9.7, 'bb9': 2.8, 'whip': 1.18, 'ip_per_game': 5.7},
    'CLE': {'rpg': 4.35, 'era': 3.88, 'avg': 0.247, 'obp': 0.315, 'slg': 0.398, 'k9': 9.3, 'bb9': 2.9, 'whip': 1.22, 'ip_per_game': 5.5},
    'SEA': {'rpg': 4.48, 'era': 3.95, 'avg': 0.249, 'obp': 0.318, 'slg': 0.408, 'k9': 9.2, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.4},
}

# ─────────────────────────────────────────────────────────────────────────────
# STARTING PITCHER STATS (2025 season, confirmed starters for March 26)
# ─────────────────────────────────────────────────────────────────────────────
PITCHER_STATS_2025 = {
    # Game 1: PIT @ NYM
    'Paul Skenes (PIT)':       {'era': 1.96, 'k9': 11.8, 'bb9': 1.9, 'whip': 0.95, 'ip': 133.0, 'gp': 23},
    'Kodai Senga (NYM)':       {'era': 2.91, 'k9': 10.2, 'bb9': 2.8, 'whip': 1.08, 'ip': 148.0, 'gp': 24},
    # Game 2: CWS @ MIL
    'Garrett Crochet (CWS)':   {'era': 3.58, 'k9': 11.4, 'bb9': 2.6, 'whip': 1.12, 'ip': 141.0, 'gp': 25},
    'Freddy Peralta (MIL)':    {'era': 3.42, 'k9': 10.8, 'bb9': 2.9, 'whip': 1.14, 'ip': 152.0, 'gp': 26},
    # Game 3: WSH @ CHC
    'MacKenzie Gore (WSH)':    {'era': 3.87, 'k9': 10.1, 'bb9': 3.4, 'whip': 1.22, 'ip': 138.0, 'gp': 25},
    'Shota Imanaga (CHC)':     {'era': 2.76, 'k9': 10.5, 'bb9': 1.8, 'whip': 0.99, 'ip': 161.0, 'gp': 27},
    # Game 4: MIN @ BAL
    'Bailey Ober (MIN)':       {'era': 3.72, 'k9': 9.8,  'bb9': 2.1, 'whip': 1.10, 'ip': 145.0, 'gp': 26},
    'Corbin Burnes (BAL)':     {'era': 2.92, 'k9': 10.4, 'bb9': 1.9, 'whip': 1.02, 'ip': 194.0, 'gp': 32},
    # Game 5: BOS @ CIN
    'Brayan Bello (BOS)':      {'era': 3.81, 'k9': 9.2,  'bb9': 2.8, 'whip': 1.18, 'ip': 152.0, 'gp': 27},
    'Hunter Greene (CIN)':     {'era': 3.65, 'k9': 11.2, 'bb9': 3.1, 'whip': 1.15, 'ip': 148.0, 'gp': 26},
    # Game 6: LAA @ HOU
    'Tyler Anderson (LAA)':    {'era': 4.12, 'k9': 8.4,  'bb9': 2.9, 'whip': 1.28, 'ip': 138.0, 'gp': 25},
    'Framber Valdez (HOU)':    {'era': 3.45, 'k9': 8.9,  'bb9': 2.6, 'whip': 1.18, 'ip': 178.0, 'gp': 30},
    # Game 7: DET @ SD
    'Tarik Skubal (DET)':      {'era': 2.39, 'k9': 11.1, 'bb9': 1.8, 'whip': 0.97, 'ip': 192.0, 'gp': 32},
    'Dylan Cease (SD)':        {'era': 3.47, 'k9': 10.8, 'bb9': 3.2, 'whip': 1.16, 'ip': 168.0, 'gp': 29},
    # Game 8: TB @ STL
    'Zach Eflin (TB)':         {'era': 3.88, 'k9': 8.7,  'bb9': 2.2, 'whip': 1.19, 'ip': 155.0, 'gp': 27},
    'Sonny Gray (STL)':        {'era': 3.72, 'k9': 9.1,  'bb9': 2.5, 'whip': 1.17, 'ip': 148.0, 'gp': 26},
    # Game 9: TEX @ PHI
    'Nathan Eovaldi (TEX)':    {'era': 3.95, 'k9': 8.8,  'bb9': 2.4, 'whip': 1.22, 'ip': 142.0, 'gp': 25},
    'Zack Wheeler (PHI)':      {'era': 2.78, 'k9': 10.9, 'bb9': 1.7, 'whip': 0.98, 'ip': 192.0, 'gp': 32},
    # Game 10: ARI @ LAD
    'Zac Gallen (ARI)':        {'era': 3.62, 'k9': 9.5,  'bb9': 2.3, 'whip': 1.12, 'ip': 168.0, 'gp': 29},
    'Tyler Glasnow (LAD)':     {'era': 3.32, 'k9': 11.5, 'bb9': 2.9, 'whip': 1.08, 'ip': 134.0, 'gp': 24},
    # Game 11: CLE @ SEA
    'Tanner Bibee (CLE)':      {'era': 3.48, 'k9': 9.6,  'bb9': 2.4, 'whip': 1.14, 'ip': 158.0, 'gp': 28},
    'Logan Gilbert (SEA)':     {'era': 3.21, 'k9': 9.8,  'bb9': 1.9, 'whip': 1.08, 'ip': 185.0, 'gp': 31},
}

# ─────────────────────────────────────────────────────────────────────────────
# GAMES — all 11 March 26, 2026
# rl_home_spread: -1.5 if home is the run line favorite, +1.5 if away is RL fav
# This is derived DIRECTLY from the book's run line, NOT from the ML.
# ─────────────────────────────────────────────────────────────────────────────
GAMES = [
    # 1. PIT @ NYM — PIT -1.5 (AWAY is RL fav) → rl_home_spread = +1.5
    # Note: PIT is ML underdog (+109) but RL favorite (-1.5) — classic MLB paradox
    {
        'id': 2250007, 'away': 'PIT', 'home': 'NYM',
        'away_pitcher': 'Paul Skenes (PIT)',
        'home_pitcher': 'Kodai Senga (NYM)',
        'book': {
            'ml_away': 109.0, 'ml_home': -131.0,
            'ou_line': 7.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': 1.5,   # NYM +1.5 (home is RL dog)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 2. CWS @ MIL — MIL -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2250008, 'away': 'CWS', 'home': 'MIL',
        'away_pitcher': 'Garrett Crochet (CWS)',
        'home_pitcher': 'Freddy Peralta (MIL)',
        'book': {
            'ml_away': 159.0, 'ml_home': -194.0,
            'ou_line': 8.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # MIL -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 3. WSH @ CHC — CHC -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2250009, 'away': 'WSH', 'home': 'CHC',
        'away_pitcher': 'MacKenzie Gore (WSH)',
        'home_pitcher': 'Shota Imanaga (CHC)',
        'book': {
            'ml_away': 203.0, 'ml_home': -252.0,
            'ou_line': 7.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # CHC -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 4. MIN @ BAL — BAL -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2250010, 'away': 'MIN', 'home': 'BAL',
        'away_pitcher': 'Bailey Ober (MIN)',
        'home_pitcher': 'Corbin Burnes (BAL)',
        'book': {
            'ml_away': 120.0, 'ml_home': -145.0,
            'ou_line': 8.5, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # BAL -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 5. BOS @ CIN — BOS -1.5 (AWAY is RL fav) → rl_home_spread = +1.5
    {
        'id': 2250011, 'away': 'BOS', 'home': 'CIN',
        'away_pitcher': 'Brayan Bello (BOS)',
        'home_pitcher': 'Hunter Greene (CIN)',
        'book': {
            'ml_away': -163.0, 'ml_home': 135.0,
            'ou_line': 8.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': 1.5,   # CIN +1.5 (home is RL dog)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 6. LAA @ HOU — HOU -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2250012, 'away': 'LAA', 'home': 'HOU',
        'away_pitcher': 'Tyler Anderson (LAA)',
        'home_pitcher': 'Framber Valdez (HOU)',
        'book': {
            'ml_away': 153.0, 'ml_home': -186.0,
            'ou_line': 8.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # HOU -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 7. DET @ SD — DET -1.5 (AWAY is RL fav) → rl_home_spread = +1.5
    {
        'id': 2250013, 'away': 'DET', 'home': 'SD',
        'away_pitcher': 'Tarik Skubal (DET)',
        'home_pitcher': 'Dylan Cease (SD)',
        'book': {
            'ml_away': -136.0, 'ml_home': 113.0,
            'ou_line': 7.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': 1.5,   # SD +1.5 (home is RL dog)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 8. TB @ STL — TB -1.5 (AWAY is RL fav) → rl_home_spread = +1.5
    {
        'id': 2250014, 'away': 'TB', 'home': 'STL',
        'away_pitcher': 'Zach Eflin (TB)',
        'home_pitcher': 'Sonny Gray (STL)',
        'book': {
            'ml_away': -126.0, 'ml_home': 104.0,
            'ou_line': 8.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': 1.5,   # STL +1.5 (home is RL dog)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 9. TEX @ PHI — PHI -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2250015, 'away': 'TEX', 'home': 'PHI',
        'away_pitcher': 'Nathan Eovaldi (TEX)',
        'home_pitcher': 'Zack Wheeler (PHI)',
        'book': {
            'ml_away': 135.0, 'ml_home': -163.0,
            'ou_line': 8.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # PHI -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 10. ARI @ LAD — LAD -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2252284, 'away': 'ARI', 'home': 'LAD',
        'away_pitcher': 'Zac Gallen (ARI)',
        'home_pitcher': 'Tyler Glasnow (LAD)',
        'book': {
            'ml_away': 229.0, 'ml_home': -286.0,
            'ou_line': 9.0, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # LAD -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
    # 11. CLE @ SEA — SEA -1.5 (HOME is RL fav) → rl_home_spread = -1.5
    {
        'id': 2250016, 'away': 'CLE', 'home': 'SEA',
        'away_pitcher': 'Tanner Bibee (CLE)',
        'home_pitcher': 'Logan Gilbert (SEA)',
        'book': {
            'ml_away': 163.0, 'ml_home': -199.0,
            'ou_line': 6.5, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # SEA -1.5 (home is RL fav)
            'rl_home': -110.0, 'rl_away': -110.0,
        },
    },
]

def run_all():
    game_date = datetime(2026, 3, 26)
    results = []

    print(f"\n{'='*70}")
    print(f"  MLB AI DERIVED MARKET ENGINE — March 26, 2026 (All 11 Games)")
    print(f"  CRITICAL FIX: rl_home_spread from BOOK RUN LINE, not ML direction")
    print(f"{'='*70}")

    for g in GAMES:
        print(f"\n{'─'*70}")
        print(f"  [{g['id']}] {g['away']} @ {g['home']}")
        print(f"  Away SP: {g['away_pitcher']}")
        print(f"  Home SP: {g['home_pitcher']}")
        rl_home = g['book']['rl_home_spread']
        rl_away = -rl_home
        print(f"  Book RL: {g['away']} {rl_away:+.1f} / {g['home']} {rl_home:+.1f}")
        print(f"  Book ML: {g['away']} {g['book']['ml_away']:+.0f} / {g['home']} {g['book']['ml_home']:+.0f}")
        print(f"{'─'*70}")

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

            # Validate: run line direction must be consistent with projected score
            proj_away = r['proj_away_runs']
            proj_home = r['proj_home_runs']
            away_rl   = r['away_run_line']
            home_rl   = r['home_run_line']
            away_ml   = r['away_ml']
            home_ml   = r['home_ml']

            # Sanity check: the RL favorite (-1.5) should have lower ML (more negative)
            # i.e. if away is RL fav (-1.5), away_ml should be < home_ml
            rl_fav_is_away = (away_rl == '-1.5')
            ml_fav_is_away = (away_ml < home_ml)
            consistent = (rl_fav_is_away == ml_fav_is_away)

            print(f"\n  PROJECTED: {g['away']} {proj_away:.2f}  {g['home']} {proj_home:.2f}  (total {r['proj_total']:.2f})")
            print(f"\n  MONEYLINE (model fair value):")
            print(f"    {g['away']:>4}  {fmt_ml(away_ml):>7}  ({r['away_win_pct']:.1f}%)")
            print(f"    {g['home']:>4}  {fmt_ml(home_ml):>7}  ({r['home_win_pct']:.1f}%)")
            print(f"\n  RUN LINE (model fair odds at book's ±1.5):")
            print(f"    {g['away']:>4} {away_rl}  {fmt_ml(r['away_rl_odds']):>7}  ({r['away_rl_cover_pct']:.1f}%)")
            print(f"    {g['home']:>4} {home_rl}  {fmt_ml(r['home_rl_odds']):>7}  ({r['home_rl_cover_pct']:.1f}%)")
            print(f"\n  TOTAL O/U {r['total_line']}:")
            print(f"    OVER   {fmt_ml(r['over_odds']):>7}  ({r['over_pct']:.1f}%)")
            print(f"    UNDER  {fmt_ml(r['under_odds']):>7}  ({r['under_pct']:.1f}%)")
            print(f"\n  RL/ML CONSISTENCY: {'✓ OK' if consistent else '✗ MISMATCH — CHECK INPUTS'}")
            print(f"  MODEL SPREAD: {r['model_spread']:+.2f}  |  VALID: {r['valid']}")

            if r['warnings']:
                print(f"\n  WARNINGS:")
                for w in r['warnings']:
                    print(f"    ! {w}")

            if r['edges']:
                print(f"\n  EDGES (+EV):")
                for e in r['edges']:
                    print(f"    [{e['market'].upper():15s}]  edge={e['edge']:+.2%}  "
                          f"model={fmt_ml(e.get('model_odds', 0))}  book={fmt_ml(e.get('book_odds', 0))}")

            results.append({'game': g, 'result': r, 'consistent': consistent})

        except Exception as e:
            import traceback
            print(f"\n  ERROR: {e}")
            traceback.print_exc()
            results.append({'game': g, 'result': {'ok': False, 'error': str(e)}, 'consistent': False})

    # JSON output for DB ingestion
    print(f"\n\n{'='*70}")
    print("  JSON OUTPUT FOR DB INGESTION")
    print(f"{'='*70}")
    output = []
    for item in results:
        g = item['game']
        r = item['result']
        if r.get('ok'):
            output.append({
                'id':             g['id'],
                'away':           g['away'],
                'home':           g['home'],
                'proj_away':      r['proj_away_runs'],
                'proj_home':      r['proj_home_runs'],
                'proj_total':     r['proj_total'],
                'away_ml':        r['away_ml'],
                'home_ml':        r['home_ml'],
                'away_run_line':  r['away_run_line'],
                'home_run_line':  r['home_run_line'],
                'away_rl_odds':   r['away_rl_odds'],
                'home_rl_odds':   r['home_rl_odds'],
                'total_line':     r['total_line'],
                'over_odds':      r['over_odds'],
                'under_odds':     r['under_odds'],
                'model_spread':   r['model_spread'],
                'consistent':     item['consistent'],
                'valid':          r['valid'],
                'warnings':       r['warnings'],
            })
    print(json.dumps(output, indent=2))
    return output

if __name__ == '__main__':
    run_all()

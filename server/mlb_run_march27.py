#!/usr/bin/env python3
"""
mlb_run_march27.py — MLB Model Runner for March 27, 2026
=========================================================
8 Games:
  1. NYY @ SF     — Cam Schlittler vs Robbie Ray         3:35 PM ET
  2. ATH @ TOR    — Luis Severino vs Kevin Gausman        6:07 PM ET
  3. COL @ MIA    — Kyle Freeland vs Sandy Alcantara      6:10 PM ET
  4. KC @ ATL     — Cole Ragans vs Chris Sale             6:15 PM ET
  5. LAA @ HOU    — Yusei Kikuchi vs Mike Burrows         7:15 PM ET
  6. DET @ SD     — Framber Valdez vs Michael King        8:40 PM ET
  7. CLE @ SEA    — Gavin Williams vs George Kirby        8:45 PM ET
  8. ARI @ LAD    — Ryne Nelson vs Emmet Sheehan          9:10 PM ET

Deep logging: all intermediate values, simulation parameters,
edge calculations. DB write via TypeScript adapter.
"""

import sys
import os
import json
import time
import traceback
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from MLBAIModel import project_game

# ─── TEAM STATS (2025 full season) ───────────────────────────────────────────
TEAM_STATS_2025 = {
    'NYY': {'rpg': 5.01, 'era': 3.88, 'avg': 0.260, 'obp': 0.332, 'slg': 0.445, 'k9': 9.4, 'bb9': 2.9, 'whip': 1.20, 'ip_per_game': 5.6},
    'SF':  {'rpg': 4.52, 'era': 4.12, 'avg': 0.251, 'obp': 0.320, 'slg': 0.415, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.27, 'ip_per_game': 5.3},
    'ATH': {'rpg': 4.21, 'era': 4.38, 'avg': 0.244, 'obp': 0.312, 'slg': 0.395, 'k9': 8.8, 'bb9': 3.3, 'whip': 1.30, 'ip_per_game': 5.1},
    'TOR': {'rpg': 4.68, 'era': 4.05, 'avg': 0.255, 'obp': 0.325, 'slg': 0.422, 'k9': 9.2, 'bb9': 3.0, 'whip': 1.25, 'ip_per_game': 5.4},
    'COL': {'rpg': 5.18, 'era': 5.42, 'avg': 0.271, 'obp': 0.340, 'slg': 0.458, 'k9': 8.2, 'bb9': 3.6, 'whip': 1.42, 'ip_per_game': 4.8},
    'MIA': {'rpg': 3.89, 'era': 4.28, 'avg': 0.238, 'obp': 0.305, 'slg': 0.378, 'k9': 9.0, 'bb9': 3.2, 'whip': 1.29, 'ip_per_game': 5.2},
    'KC':  {'rpg': 4.55, 'era': 4.15, 'avg': 0.252, 'obp': 0.320, 'slg': 0.410, 'k9': 8.9, 'bb9': 3.1, 'whip': 1.28, 'ip_per_game': 5.2},
    'ATL': {'rpg': 5.08, 'era': 3.78, 'avg': 0.263, 'obp': 0.335, 'slg': 0.448, 'k9': 9.6, 'bb9': 2.8, 'whip': 1.19, 'ip_per_game': 5.6},
    'LAA': {'rpg': 4.18, 'era': 4.48, 'avg': 0.243, 'obp': 0.310, 'slg': 0.392, 'k9': 8.7, 'bb9': 3.4, 'whip': 1.33, 'ip_per_game': 5.0},
    'HOU': {'rpg': 4.71, 'era': 3.82, 'avg': 0.254, 'obp': 0.323, 'slg': 0.425, 'k9': 9.5, 'bb9': 2.9, 'whip': 1.21, 'ip_per_game': 5.5},
    'DET': {'rpg': 4.62, 'era': 3.98, 'avg': 0.251, 'obp': 0.319, 'slg': 0.416, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.26, 'ip_per_game': 5.3},
    'SD':  {'rpg': 4.38, 'era': 4.15, 'avg': 0.246, 'obp': 0.314, 'slg': 0.399, 'k9': 9.0, 'bb9': 3.2, 'whip': 1.28, 'ip_per_game': 5.2},
    'CLE': {'rpg': 4.35, 'era': 3.88, 'avg': 0.247, 'obp': 0.315, 'slg': 0.398, 'k9': 9.3, 'bb9': 2.9, 'whip': 1.22, 'ip_per_game': 5.5},
    'SEA': {'rpg': 4.48, 'era': 3.95, 'avg': 0.249, 'obp': 0.318, 'slg': 0.408, 'k9': 9.2, 'bb9': 3.0, 'whip': 1.24, 'ip_per_game': 5.4},
    'ARI': {'rpg': 4.61, 'era': 4.05, 'avg': 0.252, 'obp': 0.321, 'slg': 0.418, 'k9': 9.1, 'bb9': 3.1, 'whip': 1.26, 'ip_per_game': 5.3},
    'LAD': {'rpg': 5.12, 'era': 3.65, 'avg': 0.265, 'obp': 0.338, 'slg': 0.452, 'k9': 9.7, 'bb9': 2.8, 'whip': 1.18, 'ip_per_game': 5.7},
}

# ─── PITCHER STATS (2025 season) ─────────────────────────────────────────────
PITCHER_STATS_2025 = {
    # Game 1: NYY @ SF
    'Cam Schlittler (NYY)':   {'era': 2.96, 'k9': 8.8,  'bb9': 3.1, 'whip': 1.18, 'ip': 91.1,  'gp': 16, 'xera': 4.11},
    'Robbie Ray (SF)':        {'era': 3.42, 'k9': 10.2, 'bb9': 3.4, 'whip': 1.22, 'ip': 158.1, 'gp': 27, 'xera': 3.65},
    # Game 2: ATH @ TOR
    'Luis Severino (ATH)':    {'era': 4.52, 'k9': 6.8,  'bb9': 3.2, 'whip': 1.35, 'ip': 142.0, 'gp': 25, 'xera': 4.38},
    'Kevin Gausman (TOR)':    {'era': 3.28, 'k9': 9.4,  'bb9': 1.8, 'whip': 1.10, 'ip': 193.0, 'gp': 32, 'xera': 3.41},
    # Game 3: COL @ MIA
    'Kyle Freeland (COL)':    {'era': 5.18, 'k9': 7.2,  'bb9': 3.5, 'whip': 1.44, 'ip': 138.0, 'gp': 25, 'xera': 5.02},
    'Sandy Alcantara (MIA)':  {'era': 3.88, 'k9': 8.9,  'bb9': 2.4, 'whip': 1.22, 'ip': 162.0, 'gp': 28, 'xera': 3.72},
    # Game 4: KC @ ATL
    'Cole Ragans (KC)':       {'era': 4.67, 'k9': 10.1, 'bb9': 3.0, 'whip': 1.28, 'ip': 168.0, 'gp': 29, 'xera': 2.67},
    'Chris Sale (ATL)':       {'era': 2.58, 'k9': 9.8,  'bb9': 2.2, 'whip': 1.02, 'ip': 178.0, 'gp': 30, 'xera': 2.85},
    # Game 5: LAA @ HOU
    'Yusei Kikuchi (LAA)':    {'era': 4.22, 'k9': 9.1,  'bb9': 3.2, 'whip': 1.28, 'ip': 152.0, 'gp': 27, 'xera': 4.01},
    'Mike Burrows (HOU)':     {'era': 3.92, 'k9': 9.4,  'bb9': 3.1, 'whip': 1.24, 'ip': 118.0, 'gp': 22, 'xera': 3.78},
    # Game 6: DET @ SD
    'Framber Valdez (DET)':   {'era': 3.45, 'k9': 8.9,  'bb9': 2.6, 'whip': 1.18, 'ip': 178.0, 'gp': 30, 'xera': 3.38},
    'Michael King (SD)':      {'era': 3.12, 'k9': 10.8, 'bb9': 2.8, 'whip': 1.08, 'ip': 168.0, 'gp': 29, 'xera': 3.24},
    # Game 7: CLE @ SEA
    'Gavin Williams (CLE)':   {'era': 3.05, 'k9': 9.2,  'bb9': 3.4, 'whip': 1.18, 'ip': 148.0, 'gp': 26, 'xera': 4.29},
    'George Kirby (SEA)':     {'era': 3.38, 'k9': 8.8,  'bb9': 1.4, 'whip': 1.05, 'ip': 192.0, 'gp': 32, 'xera': 3.21},
    # Game 8: ARI @ LAD
    'Ryne Nelson (ARI)':      {'era': 3.39, 'k9': 8.4,  'bb9': 2.8, 'whip': 1.18, 'ip': 158.0, 'gp': 28, 'xera': 3.93},
    'Emmet Sheehan (LAD)':    {'era': 3.62, 'k9': 10.3, 'bb9': 3.2, 'whip': 1.22, 'ip': 128.0, 'gp': 24, 'xera': 3.48},
}

# ─── GAMES — March 27, 2026 (DB IDs + DK NJ lines confirmed from DB) ─────────
GAMES = [
    # 1. NYY @ SF — NYY -1.5 (away RL fav) → rl_home_spread = +1.5
    # DB: awayML='-136', homeML='+113', bookTotal='8.5', overOdds='-108', underOdds='-112'
    # awaySpreadOdds='+123' (NYY +1.5 pays +123), homeSpreadOdds='-149' (SF +1.5 costs -149)
    {
        'db_id': 2250017,
        'away': 'NYY', 'home': 'SF',
        'away_pitcher': 'Cam Schlittler (NYY)',
        'home_pitcher': 'Robbie Ray (SF)',
        'start_time': '3:35 PM ET',
        'book': {
            'ml_away': -136.0, 'ml_home': 113.0,
            'ou_line': 8.5, 'over_odds': -108.0, 'under_odds': -112.0,
            'rl_home_spread': 1.5,   # NYY -1.5 (away RL fav)
            'rl_home': 123.0, 'rl_away': -149.0,
        },
    },
    # 2. ATH @ TOR — TOR -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+149', homeML='-181', bookTotal='8.5', overOdds='-120', underOdds='+100'
    # awaySpreadOdds='-136' (ATH +1.5 costs -136), homeSpreadOdds='+113' (TOR +1.5 pays +113)
    {
        'db_id': 2250018,
        'away': 'ATH', 'home': 'TOR',
        'away_pitcher': 'Luis Severino (ATH)',
        'home_pitcher': 'Kevin Gausman (TOR)',
        'start_time': '6:07 PM ET',
        'book': {
            'ml_away': 149.0, 'ml_home': -181.0,
            'ou_line': 8.5, 'over_odds': -120.0, 'under_odds': 100.0,
            'rl_home_spread': -1.5,  # TOR -1.5 (home RL fav)
            'rl_home': -136.0, 'rl_away': 113.0,
        },
    },
    # 3. COL @ MIA — MIA -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+163', homeML='-199', bookTotal='8.0', overOdds='-103', underOdds='-117'
    # awaySpreadOdds='-131' (COL +1.5 costs -131), homeSpreadOdds='+109' (MIA +1.5 pays +109)
    {
        'db_id': 2250019,
        'away': 'COL', 'home': 'MIA',
        'away_pitcher': 'Kyle Freeland (COL)',
        'home_pitcher': 'Sandy Alcantara (MIA)',
        'start_time': '6:10 PM ET',
        'book': {
            'ml_away': 163.0, 'ml_home': -199.0,
            'ou_line': 8.0, 'over_odds': -103.0, 'under_odds': -117.0,
            'rl_home_spread': -1.5,  # MIA -1.5 (home RL fav)
            'rl_home': -131.0, 'rl_away': 109.0,
        },
    },
    # 4. KC @ ATL — ATL -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+119', homeML='-143', bookTotal='7.5', overOdds='-105', underOdds='-115'
    # awaySpreadOdds='-186' (KC +1.5 costs -186), homeSpreadOdds='+153' (ATL +1.5 pays +153)
    {
        'db_id': 2250020,
        'away': 'KC', 'home': 'ATL',
        'away_pitcher': 'Cole Ragans (KC)',
        'home_pitcher': 'Chris Sale (ATL)',
        'start_time': '6:15 PM ET',
        'book': {
            'ml_away': 119.0, 'ml_home': -143.0,
            'ou_line': 7.5, 'over_odds': -105.0, 'under_odds': -115.0,
            'rl_home_spread': -1.5,  # ATL -1.5 (home RL fav)
            'rl_home': -186.0, 'rl_away': 153.0,
        },
    },
    # 5. LAA @ HOU — HOU -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+135', homeML='-163', bookTotal='8.5', overOdds='-115', underOdds='-105'
    # awaySpreadOdds='-156' (LAA +1.5 costs -156), homeSpreadOdds='+129' (HOU +1.5 pays +129)
    {
        'db_id': 2250021,
        'away': 'LAA', 'home': 'HOU',
        'away_pitcher': 'Yusei Kikuchi (LAA)',
        'home_pitcher': 'Mike Burrows (HOU)',
        'start_time': '7:15 PM ET',
        'book': {
            'ml_away': 135.0, 'ml_home': -163.0,
            'ou_line': 8.5, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # HOU -1.5 (home RL fav)
            'rl_home': -156.0, 'rl_away': 129.0,
        },
    },
    # 6. DET @ SD — SD -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+109', homeML='-131', bookTotal='7.5', overOdds='-105', underOdds='-115'
    # awaySpreadOdds='-207' (DET +1.5 costs -207), homeSpreadOdds='+169' (SD +1.5 pays +169)
    {
        'db_id': 2250022,
        'away': 'DET', 'home': 'SD',
        'away_pitcher': 'Framber Valdez (DET)',
        'home_pitcher': 'Michael King (SD)',
        'start_time': '8:40 PM ET',
        'book': {
            'ml_away': 109.0, 'ml_home': -131.0,
            'ou_line': 7.5, 'over_odds': -105.0, 'under_odds': -115.0,
            'rl_home_spread': -1.5,  # SD -1.5 (home RL fav)
            'rl_home': -207.0, 'rl_away': 169.0,
        },
    },
    # 7. CLE @ SEA — SEA -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+141', homeML='-171', bookTotal='7.0', overOdds='-105', underOdds='-115'
    # awaySpreadOdds='-156' (CLE +1.5 costs -156), homeSpreadOdds='+129' (SEA +1.5 pays +129)
    {
        'db_id': 2250023,
        'away': 'CLE', 'home': 'SEA',
        'away_pitcher': 'Gavin Williams (CLE)',
        'home_pitcher': 'George Kirby (SEA)',
        'start_time': '8:45 PM ET',
        'book': {
            'ml_away': 141.0, 'ml_home': -171.0,
            'ou_line': 7.0, 'over_odds': -105.0, 'under_odds': -115.0,
            'rl_home_spread': -1.5,  # SEA -1.5 (home RL fav)
            'rl_home': -156.0, 'rl_away': 129.0,
        },
    },
    # 8. ARI @ LAD — LAD -1.5 (home RL fav) → rl_home_spread = -1.5
    # DB: awayML='+209', homeML='-259', bookTotal='8.5', overOdds='-115', underOdds='-105'
    # awaySpreadOdds='+102' (ARI +1.5 pays +102), homeSpreadOdds='-122' (LAD +1.5 costs -122)
    {
        'db_id': 2252293,
        'away': 'ARI', 'home': 'LAD',
        'away_pitcher': 'Ryne Nelson (ARI)',
        'home_pitcher': 'Emmet Sheehan (LAD)',
        'start_time': '9:10 PM ET',
        'book': {
            'ml_away': 209.0, 'ml_home': -259.0,
            'ou_line': 8.5, 'over_odds': -115.0, 'under_odds': -105.0,
            'rl_home_spread': -1.5,  # LAD -1.5 (home RL fav)
            'rl_home': 102.0, 'rl_away': -122.0,
        },
    },
]

GAME_DATE = datetime(2026, 3, 27)
LOG_FILE  = '/tmp/march27_mlb_model_run.log'


def fmt_ml(ml):
    return f"+{ml}" if ml > 0 else str(ml)


def log(msg, f=None):
    print(msg)
    if f:
        f.write(msg + '\n')
        f.flush()


def run_all():
    results = []

    with open(LOG_FILE, 'w') as f:
        log(f"\n{'='*72}", f)
        log(f"  MLB AI DERIVED MARKET ENGINE — March 27, 2026 (8 Games)", f)
        log(f"  Run started: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}", f)
        log(f"  Engine: MLBAIModel.py (200,000 Monte Carlo simulations)", f)
        log(f"  Pitcher data: 2025 full season (Baseball Reference / FanGraphs / Savant)", f)
        log(f"  Team data: 2025 full season (MLB.com / Baseball Reference)", f)
        log(f"  DB write: via TypeScript Drizzle ORM adapter (post-run)", f)
        log(f"{'='*72}\n", f)

        for idx, g in enumerate(GAMES, 1):
            log(f"\n{'─'*72}", f)
            log(f"  GAME {idx}/8: [{g['db_id']}] {g['away']} @ {g['home']}  |  {g['start_time']}", f)
            log(f"  Away SP: {g['away_pitcher']}", f)
            log(f"  Home SP: {g['home_pitcher']}", f)
            log(f"{'─'*72}", f)

            # ── STEP 1: Input validation ───────────────────────────────────
            log(f"\n  [STEP 1] INPUT VALIDATION", f)
            away_stats = TEAM_STATS_2025.get(g['away'])
            home_stats = TEAM_STATS_2025.get(g['home'])
            away_sp    = PITCHER_STATS_2025.get(g['away_pitcher'])
            home_sp    = PITCHER_STATS_2025.get(g['home_pitcher'])

            if not away_stats:
                log(f"  [ERROR] No team stats for {g['away']}", f)
                results.append({'game': g, 'result': {'ok': False, 'error': f'No team stats for {g["away"]}'}})
                continue
            if not home_stats:
                log(f"  [ERROR] No team stats for {g['home']}", f)
                results.append({'game': g, 'result': {'ok': False, 'error': f'No team stats for {g["home"]}'}})
                continue
            if not away_sp:
                log(f"  [ERROR] No pitcher stats for {g['away_pitcher']}", f)
                results.append({'game': g, 'result': {'ok': False, 'error': f'No pitcher stats for {g["away_pitcher"]}'}})
                continue
            if not home_sp:
                log(f"  [ERROR] No pitcher stats for {g['home_pitcher']}", f)
                results.append({'game': g, 'result': {'ok': False, 'error': f'No pitcher stats for {g["home_pitcher"]}'}})
                continue

            log(f"  {g['away']} team: RPG={away_stats['rpg']:.2f}  ERA={away_stats['era']:.2f}  OBP={away_stats['obp']:.3f}  SLG={away_stats['slg']:.3f}  K/9={away_stats['k9']:.1f}", f)
            log(f"  {g['home']} team: RPG={home_stats['rpg']:.2f}  ERA={home_stats['era']:.2f}  OBP={home_stats['obp']:.3f}  SLG={home_stats['slg']:.3f}  K/9={home_stats['k9']:.1f}", f)
            log(f"  {g['away_pitcher']}: ERA={away_sp['era']:.2f}  xERA={away_sp.get('xera','N/A')}  K/9={away_sp['k9']:.1f}  BB/9={away_sp['bb9']:.1f}  WHIP={away_sp['whip']:.2f}  IP={away_sp['ip']:.1f}", f)
            log(f"  {g['home_pitcher']}: ERA={home_sp['era']:.2f}  xERA={home_sp.get('xera','N/A')}  K/9={home_sp['k9']:.1f}  BB/9={home_sp['bb9']:.1f}  WHIP={home_sp['whip']:.2f}  IP={home_sp['ip']:.1f}", f)

            # ── STEP 2: Book lines audit ───────────────────────────────────
            log(f"\n  [STEP 2] BOOK LINES AUDIT (DK NJ via Action Network)", f)
            book = g['book']
            rl_home = book['rl_home_spread']
            rl_away = -rl_home
            log(f"  ML:    {g['away']} {fmt_ml(int(book['ml_away']))} / {g['home']} {fmt_ml(int(book['ml_home']))}", f)
            log(f"  RL:    {g['away']} {rl_away:+.1f} ({fmt_ml(int(book['rl_away']))}) / {g['home']} {rl_home:+.1f} ({fmt_ml(int(book['rl_home']))})", f)
            log(f"  Total: {book['ou_line']} (O: {fmt_ml(int(book['over_odds']))} / U: {fmt_ml(int(book['under_odds']))})", f)

            # RL/ML consistency note
            ml_fav_is_away = (book['ml_away'] < book['ml_home'])
            rl_fav_is_away = (rl_away == -1.5)
            if ml_fav_is_away != rl_fav_is_away:
                log(f"  [NOTE] RL/ML SPLIT: ML fav={g['away'] if ml_fav_is_away else g['home']} but RL fav={g['away'] if rl_fav_is_away else g['home']} — using book RL direction", f)
            else:
                log(f"  [OK] RL/ML consistent: {g['away'] if ml_fav_is_away else g['home']} is both ML and RL favorite", f)

            # ── STEP 3: Run model ──────────────────────────────────────────
            log(f"\n  [STEP 3] RUNNING MODEL (200,000 simulations, seed=20260327)...", f)
            t0 = time.time()
            try:
                r = project_game(
                    away_abbrev=g['away'],
                    home_abbrev=g['home'],
                    away_team_stats=away_stats,
                    home_team_stats=home_stats,
                    away_pitcher_stats=away_sp,
                    home_pitcher_stats=home_sp,
                    book_lines=book,
                    game_date=GAME_DATE,
                    seed=20260327,
                )
                elapsed = time.time() - t0
                log(f"  [OK] Model completed in {elapsed:.2f}s", f)
            except Exception as e:
                log(f"  [ERROR] Model failed: {e}", f)
                traceback.print_exc(file=f)
                results.append({'game': g, 'result': {'ok': False, 'error': str(e)}})
                continue

            # ── STEP 4: Results audit ──────────────────────────────────────
            log(f"\n  [STEP 4] MODEL OUTPUT AUDIT", f)
            log(f"  Projected scores: {g['away']} {r['proj_away_runs']:.2f}  {g['home']} {r['proj_home_runs']:.2f}  (total {r['proj_total']:.2f})", f)
            log(f"  Book total: {book['ou_line']}  |  Model total: {r['proj_total']:.2f}  |  Diff: {r['proj_total'] - book['ou_line']:+.2f}", f)
            log(f"  Away state mu: {r.get('away_state_mu', 'N/A')}  |  Home state mu: {r.get('home_state_mu', 'N/A')}", f)
            log(f"\n  MONEYLINE (model fair value):", f)
            log(f"    {g['away']:>4}  {fmt_ml(r['away_ml']):>7}  ({r['away_win_pct']:.2f}%)  |  Book: {fmt_ml(int(book['ml_away']))}", f)
            log(f"    {g['home']:>4}  {fmt_ml(r['home_ml']):>7}  ({r['home_win_pct']:.2f}%)  |  Book: {fmt_ml(int(book['ml_home']))}", f)
            log(f"\n  RUN LINE (model fair odds at ±1.5):", f)
            log(f"    {g['away']:>4} {r['away_run_line']}  {fmt_ml(r['away_rl_odds']):>7}  ({r['away_rl_cover_pct']:.2f}%)", f)
            log(f"    {g['home']:>4} {r['home_run_line']}  {fmt_ml(r['home_rl_odds']):>7}  ({r['home_rl_cover_pct']:.2f}%)", f)
            log(f"\n  TOTAL O/U {r['total_line']}:", f)
            log(f"    OVER   {fmt_ml(r['over_odds']):>7}  ({r['over_pct']:.2f}%)", f)
            log(f"    UNDER  {fmt_ml(r['under_odds']):>7}  ({r['under_pct']:.2f}%)", f)
            log(f"\n  MODEL SPREAD (home perspective): {r['model_spread']:+.2f}", f)
            log(f"  VALID: {r['valid']}  |  Simulations: {r.get('simulations', 200000):,}", f)

            # ── STEP 5: Edge detection ─────────────────────────────────────
            log(f"\n  [STEP 5] EDGE DETECTION", f)
            if r.get('edges'):
                for e in r['edges']:
                    log(f"    [{e['market'].upper():15s}]  edge={e['edge']:+.2%}  model={fmt_ml(e.get('model_odds', 0))}  book={fmt_ml(e.get('book_odds', 0))}", f)
            else:
                log(f"    No significant edges detected", f)

            # ── STEP 6: Warnings ───────────────────────────────────────────
            if r.get('warnings'):
                log(f"\n  [STEP 6] WARNINGS:", f)
                for w in r['warnings']:
                    log(f"    ! {w}", f)

            results.append({'game': g, 'result': r})

        # ── SUMMARY ───────────────────────────────────────────────────────
        log(f"\n\n{'='*72}", f)
        log(f"  MARCH 27, 2026 MLB MODEL SUMMARY", f)
        log(f"{'='*72}", f)
        log(f"  {'GAME':<22} {'PROJ':>10} {'BOOK':>6} {'DIFF':>6} {'AWAY ML':>8} {'HOME ML':>8} {'OVER%':>7} {'UNDER%':>7}", f)
        log(f"  {'-'*72}", f)
        for item in results:
            g = item['game']
            r = item['result']
            if not r.get('ok', True) and r.get('error'):
                log(f"  {g['away']+' @ '+g['home']:<22} ERROR: {r['error']}", f)
                continue
            game_label = f"{g['away']} @ {g['home']}"
            proj_str   = f"{r['proj_away_runs']:.2f}-{r['proj_home_runs']:.2f}"
            diff       = r['proj_total'] - g['book']['ou_line']
            log(f"  {game_label:<22} {proj_str:>10} {g['book']['ou_line']:>6.1f} {diff:>+6.2f} {fmt_ml(r['away_ml']):>8} {fmt_ml(r['home_ml']):>8} {r['over_pct']:>7.2f} {r['under_pct']:>7.2f}", f)

        modeled = len([x for x in results if x['result'].get('ok', True) and not x['result'].get('error')])
        log(f"\n  Games modeled: {modeled}/8", f)
        log(f"  Run completed: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}", f)
        log(f"{'='*72}\n", f)

        # ── JSON output for TS adapter ─────────────────────────────────────
        output = []
        for item in results:
            g = item['game']
            r = item['result']
            if r.get('ok', True) and not r.get('error'):
                model_spread_home = r.get('model_spread', 0.0)
                output.append({
                    'db_id':            g['db_id'],
                    'away':             g['away'],
                    'home':             g['home'],
                    'away_pitcher':     g['away_pitcher'].replace(f" ({g['away']})", ''),
                    'home_pitcher':     g['home_pitcher'].replace(f" ({g['home']})", ''),
                    'proj_away':        round(r['proj_away_runs'], 2),
                    'proj_home':        round(r['proj_home_runs'], 2),
                    'proj_total':       round(r['proj_total'], 2),
                    'book_total':       g['book']['ou_line'],
                    'total_diff':       round(r['proj_total'] - g['book']['ou_line'], 2),
                    'away_model_spread': round(-model_spread_home, 1),
                    'home_model_spread': round(model_spread_home, 1),
                    'away_ml':          r['away_ml'],
                    'home_ml':          r['home_ml'],
                    'away_win_pct':     r['away_win_pct'],
                    'home_win_pct':     r['home_win_pct'],
                    'away_run_line':    r['away_run_line'],
                    'home_run_line':    r['home_run_line'],
                    'away_rl_odds':     r['away_rl_odds'],
                    'home_rl_odds':     r['home_rl_odds'],
                    'away_rl_cover_pct': r['away_rl_cover_pct'],
                    'home_rl_cover_pct': r['home_rl_cover_pct'],
                    'total_line':       r['total_line'],
                    'over_odds':        r['over_odds'],
                    'under_odds':       r['under_odds'],
                    'over_pct':         r['over_pct'],
                    'under_pct':        r['under_pct'],
                    'model_spread':     r['model_spread'],
                    'edges':            r.get('edges', []),
                    'warnings':         r.get('warnings', []),
                    'valid':            r['valid'],
                })
        with open('/tmp/march27_mlb_results.json', 'w') as jf:
            json.dump(output, jf, indent=2)
        log(f"[JSON] Results written to /tmp/march27_mlb_results.json ({len(output)} games)", f)

    return output


if __name__ == '__main__':
    run_all()

"""checkPf2026.py — Inspect 2026 game counts and park factors for all teams."""
import os, re, sys
sys.path.insert(0, '/home/ubuntu/ai-sports-betting/server')
from dotenv import load_dotenv
load_dotenv(dotenv_path='/home/ubuntu/ai-sports-betting/.env')
import pymysql

url = os.environ.get('DATABASE_URL', '')
m = re.match(r'mysql[^:]*://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)', url)
user, pw, host, port, db = m.groups()
conn = pymysql.connect(host=host, user=user, password=pw, database=db,
                       port=int(port or 3306), ssl={'ssl': {}})
cur = conn.cursor()
cur.execute(
    'SELECT teamAbbrev, games2026, runs2026, avgRpg2026, pf2026, pf2025, pf2024, parkFactor3yr '
    'FROM mlb_park_factors ORDER BY teamAbbrev'
)
MIN_GAMES = 10
print(f'\n[INPUT] Minimum games threshold for pf2026 inclusion: {MIN_GAMES}')
print(f'{"TEAM":5s} {"g26":>4s} {"pf2026":>8s} {"pf2025":>8s} {"pf2024":>8s} {"pf3yr_db":>10s} {"pf3yr_new":>10s} {"include_2026":>12s}')
print('-' * 75)

def compute_pf3yr(pf24, pf25, pf26, min_games, g26):
    """Compute weighted 3yr PF with minimum games guard on 2026."""
    WEIGHTS = {2024: 0.20, 2025: 0.30, 2026: 0.50}
    avail = []
    if pf24 is not None: avail.append((pf24, WEIGHTS[2024]))
    if pf25 is not None: avail.append((pf25, WEIGHTS[2025]))
    # Only include 2026 if minimum sample threshold is met
    if pf26 is not None and g26 is not None and g26 >= min_games:
        avail.append((pf26, WEIGHTS[2026]))
    if not avail:
        return 1.0
    total_w = sum(w for _, w in avail)
    return sum(pf * (w / total_w) for pf, w in avail)

out_of_range_old = []
out_of_range_new = []

for row in cur.fetchall():
    abbrev, g26, r26, rpg26, pf26, pf25, pf24, pf3yr_db = row
    g26_n = int(g26) if g26 is not None else 0
    include_2026 = (pf26 is not None and g26_n >= MIN_GAMES)
    pf3yr_new = compute_pf3yr(pf24, pf25, pf26, MIN_GAMES, g26_n)
    pf26_s = f'{float(pf26):.4f}' if pf26 is not None else 'N/A'
    pf25_s = f'{float(pf25):.4f}' if pf25 is not None else 'N/A'
    pf24_s = f'{float(pf24):.4f}' if pf24 is not None else 'N/A'
    flag = '' if 0.70 <= pf3yr_new <= 1.55 else ' ← OUT OF RANGE'
    flag_old = '' if 0.70 <= float(pf3yr_db) <= 1.55 else ' ← OUT OF RANGE (old)'
    print(f'{abbrev:5s} {g26_n:4d} {pf26_s:>8s} {pf25_s:>8s} {pf24_s:>8s} '
          f'{float(pf3yr_db):10.6f} {pf3yr_new:10.6f} {str(include_2026):>12s}{flag}{flag_old}')
    if not (0.70 <= float(pf3yr_db) <= 1.55):
        out_of_range_old.append((abbrev, float(pf3yr_db)))
    if not (0.70 <= pf3yr_new <= 1.55):
        out_of_range_new.append((abbrev, pf3yr_new))

print(f'\n[VERIFY] Old formula out-of-range: {out_of_range_old}')
print(f'[VERIFY] New formula (min_games={MIN_GAMES}) out-of-range: {out_of_range_new}')
conn.close()

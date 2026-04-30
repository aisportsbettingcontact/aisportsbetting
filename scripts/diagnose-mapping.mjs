/**
 * diagnose-mapping.mjs
 * Full diagnostic: compare DB stored awayTeam/homeTeam/scores against actual MLB Stats API data.
 * Identifies every bet where the stored team mapping is wrong.
 *
 * Logging convention:
 *   [DIAGNOSE][INPUT]  — raw DB data
 *   [DIAGNOSE][STEP]   — API fetch
 *   [DIAGNOSE][STATE]  — comparison
 *   [DIAGNOSE][ERROR]  — mismatch found
 *   [DIAGNOSE][OK]     — correct match
 *   [DIAGNOSE][OUTPUT] — summary
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const urlObj = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: urlObj.hostname,
  port: parseInt(urlObj.port) || 3306,
  user: urlObj.username,
  password: urlObj.password,
  database: urlObj.pathname.replace('/', ''),
  ssl: { rejectUnauthorized: false },
});

// ─── MLB Stats API ────────────────────────────────────────────────────────────

async function fetchMlbGames(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`;
  console.log(`[DIAGNOSE][STEP] MLB API fetch: ${url}`);
  const res = await fetch(url);
  const json = await res.json();
  const games = [];
  for (const day of (json.dates ?? [])) {
    for (const g of (day.games ?? [])) {
      const away = g.teams.away.team.abbreviation;
      const home = g.teams.home.team.abbreviation;
      const awayScore = g.teams.away.score ?? null;
      const homeScore = g.teams.home.score ?? null;
      const status = g.status.detailedState;
      games.push({ gameId: g.gamePk, away, home, awayScore, homeScore, status });
    }
  }
  console.log(`[DIAGNOSE][STATE] MLB date=${date}: ${games.length} games → ${games.map(g => `${g.away}@${g.home}(${g.awayScore}-${g.homeScore})`).join(', ')}`);
  return games;
}

// ─── Normalizer (mirrors scoreGrader.ts) ─────────────────────────────────────

const ALIASES = {
  'KC': 'KC', 'TB': 'TB', 'ATH': 'ATH', 'WSH': 'WSH', 'SD': 'SD', 'SF': 'SF',
  'VGK': 'VGK', 'SJS': 'SJS', 'SJ': 'SJS', 'TBL': 'TBL', 'NJD': 'NJD', 'NJ': 'NJD',
  'GS': 'GSW', 'GSW': 'GSW', 'SA': 'SAS', 'SAS': 'SAS', 'NO': 'NOP', 'NOP': 'NOP',
};
function norm(abbrev) {
  if (!abbrev) return '';
  return ALIASES[abbrev.toUpperCase()] ?? abbrev.toUpperCase();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[DIAGNOSE][INPUT] Fetching all bets from DB...');
  const [rows] = await db.execute(
    `SELECT id, sport, gameDate, awayTeam, homeTeam, pick, pickSide, market, timeframe, result, awayScore, homeScore, anGameId
     FROM tracked_bets
     ORDER BY gameDate ASC, id ASC`
  );
  const bets = rows;
  console.log(`[DIAGNOSE][INPUT] Total bets: ${bets.length}`);

  // Cache MLB API results by date
  const mlbCache = {};
  async function getMlbGames(date) {
    if (!mlbCache[date]) mlbCache[date] = await fetchMlbGames(date);
    return mlbCache[date];
  }

  const mismatches = [];
  const correct = [];

  for (const bet of bets) {
    if (bet.sport !== 'MLB') continue;

    const date = bet.gameDate instanceof Date
      ? bet.gameDate.toISOString().slice(0, 10)
      : String(bet.gameDate).slice(0, 10);

    const storedAway = bet.awayTeam;
    const storedHome = bet.homeTeam;
    const storedAwayScore = bet.awayScore;
    const storedHomeScore = bet.homeScore;

    // Extract pickTeam from the `pick` column (e.g. "STL ML" → "STL")
    const pickTeam = bet.pick ? bet.pick.split(' ')[0].toUpperCase() : null;

    const actualGames = await getMlbGames(date);

    // Find the actual game that contains the pickTeam
    const actualGame = actualGames.find(g =>
      norm(g.away) === norm(pickTeam) || norm(g.home) === norm(pickTeam)
    );

    if (!actualGame) {
      console.log(`[DIAGNOSE][WARN] betId=${bet.id} pick=${pickTeam} date=${date} — no actual game found for pickTeam`);
      continue;
    }

    const teamMismatch =
      norm(actualGame.away) !== norm(storedAway) ||
      norm(actualGame.home) !== norm(storedHome);

    const scoreMismatch =
      String(actualGame.awayScore) !== String(storedAwayScore) ||
      String(actualGame.homeScore) !== String(storedHomeScore);

    if (teamMismatch || scoreMismatch) {
      mismatches.push({
        id: bet.id,
        date,
        pick: bet.pick,
        pickTeam,
        storedAway,
        storedHome,
        storedAwayScore,
        storedHomeScore,
        actualAway: actualGame.away,
        actualHome: actualGame.home,
        actualAwayScore: actualGame.awayScore,
        actualHomeScore: actualGame.homeScore,
        teamMismatch,
        scoreMismatch,
      });
      console.log(`[DIAGNOSE][ERROR] betId=${bet.id} date=${date} pick=${bet.pick}`);
      if (teamMismatch) {
        console.log(`  TEAM MISMATCH: stored=${storedAway}@${storedHome} actual=${actualGame.away}@${actualGame.home}`);
      }
      if (scoreMismatch) {
        console.log(`  SCORE MISMATCH: stored=${storedAwayScore}-${storedHomeScore} actual=${actualGame.awayScore}-${actualGame.homeScore}`);
      }
    } else {
      correct.push(bet.id);
      console.log(`[DIAGNOSE][OK] betId=${bet.id} date=${date} pick=${bet.pick} stored=${storedAway}@${storedHome} ${storedAwayScore}-${storedHomeScore} ✓`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[DIAGNOSE][OUTPUT] Total MLB bets checked: ${bets.filter(b => b.sport === 'MLB').length}`);
  console.log(`[DIAGNOSE][OUTPUT] Correct: ${correct.length}`);
  console.log(`[DIAGNOSE][OUTPUT] Mismatches: ${mismatches.length}`);

  if (mismatches.length > 0) {
    console.log('\n[DIAGNOSE][OUTPUT] Mismatches detail:');
    for (const m of mismatches) {
      console.log(`  betId=${m.id} date=${m.date} pick=${m.pick}`);
      if (m.teamMismatch) console.log(`    TEAMS: stored=${m.storedAway}@${m.storedHome} → correct=${m.actualAway}@${m.actualHome}`);
      if (m.scoreMismatch) console.log(`    SCORES: stored=${m.storedAwayScore}-${m.storedHomeScore} → correct=${m.actualAwayScore}-${m.actualHomeScore}`);
    }
  }

  await db.end();
  process.exit(0);
}

main().catch(e => { console.error('[DIAGNOSE][ERROR]', e); process.exit(1); });

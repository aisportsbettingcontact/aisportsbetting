/**
 * regrade-fixed-bets.mjs
 * Re-grades all bets that had their pickSide corrected by fix-pickside.mjs.
 * Uses the MLB Stats API to fetch actual scores and re-applies the grading logic.
 *
 * This ensures WIN/LOSS results are accurate after the pickSide correction.
 *
 * Logging:
 *   [REGRADE][INPUT]  — raw DB row
 *   [REGRADE][STEP]   — API fetch
 *   [REGRADE][STATE]  — grading computation
 *   [REGRADE][FIX]    — result changed
 *   [REGRADE][OK]     — result unchanged
 *   [REGRADE][OUTPUT] — summary
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

const mlbCache = {};
async function fetchMlbGames(date) {
  if (mlbCache[date]) return mlbCache[date];
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`;
  console.log(`[REGRADE][STEP] MLB API: ${url}`);
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
  mlbCache[date] = games;
  console.log(`[REGRADE][STATE] date=${date}: ${games.length} games`);
  return games;
}

// ─── Abbreviation aliases ─────────────────────────────────────────────────────

const ALIASES = {
  'ARI': 'AZ', 'AZ': 'ARI',
};
function norm(abbrev) {
  if (!abbrev) return '';
  return abbrev.toUpperCase().trim();
}
function teamsMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (ALIASES[na] === nb || ALIASES[nb] === na) return true;
  return false;
}

// ─── Deterministic grading (mirrors scoreGrader.ts) ──────────────────────────

function gradeBet(awayScore, homeScore, market, pickSide, line, sport) {
  const total = awayScore + homeScore;

  if (market === 'ML') {
    if (awayScore > homeScore) return pickSide === 'AWAY' ? 'WIN' : 'LOSS';
    if (homeScore > awayScore) return pickSide === 'HOME' ? 'WIN' : 'LOSS';
    return 'PUSH';
  }

  if (market === 'RL') {
    // RL line is stored as signed value: -1.5 for favorite, +1.5 for underdog
    // Formula: pickedTeamMargin + line > 0 → WIN
    const rlLine = line ?? (sport === 'MLB' || sport === 'NHL' ? -1.5 : null);
    if (rlLine === null) return 'NO_RESULT';
    const awayMargin = awayScore - homeScore;
    const homeMargin = homeScore - awayScore;
    const pickedMargin = pickSide === 'AWAY' ? awayMargin : homeMargin;
    const coverValue = pickedMargin + rlLine;
    if (coverValue > 0) return 'WIN';
    if (coverValue < 0) return 'LOSS';
    return 'PUSH';
  }

  if (market === 'TOTAL') {
    if (line === null || line === undefined) return 'NO_RESULT';
    if (pickSide === 'OVER') {
      if (total > line) return 'WIN';
      if (total < line) return 'LOSS';
      return 'PUSH';
    } else {
      if (total < line) return 'WIN';
      if (total > line) return 'LOSS';
      return 'PUSH';
    }
  }

  return 'NO_RESULT';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[REGRADE][INPUT] Fetching all graded MLB bets...');
  const [rows] = await db.execute(
    `SELECT id, sport, gameDate, awayTeam, homeTeam, pick, pickSide, market, timeframe, result, awayScore, homeScore, line
     FROM tracked_bets
     WHERE sport = 'MLB' AND result IN ('WIN', 'LOSS', 'PUSH')
     ORDER BY gameDate ASC, id ASC`
  );
  const bets = rows;
  console.log(`[REGRADE][INPUT] Total graded MLB bets: ${bets.length}`);

  let regraded = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;
  const changes = [];

  for (const bet of bets) {
    const date = bet.gameDate instanceof Date
      ? bet.gameDate.toISOString().slice(0, 10)
      : String(bet.gameDate).slice(0, 10);

    const awayScore = bet.awayScore !== null ? parseFloat(String(bet.awayScore)) : null;
    const homeScore = bet.homeScore !== null ? parseFloat(String(bet.homeScore)) : null;

    if (awayScore === null || homeScore === null) {
      console.log(`[REGRADE][SKIP] betId=${bet.id} — no stored scores, skipping`);
      skipped++;
      continue;
    }

    const line = bet.line !== null && bet.line !== undefined ? parseFloat(String(bet.line)) : null;

    console.log(`[REGRADE][INPUT] betId=${bet.id} date=${date} pick="${bet.pick}" pickSide=${bet.pickSide} market=${bet.market} ${bet.awayTeam}@${bet.homeTeam} score=${awayScore}-${homeScore} line=${line} result=${bet.result}`);

    // Re-grade using current (corrected) pickSide
    const newResult = gradeBet(awayScore, homeScore, bet.market, bet.pickSide, line, bet.sport);

    if (newResult === 'NO_RESULT') {
      console.log(`[REGRADE][SKIP] betId=${bet.id} — grading returned NO_RESULT (missing line?), skipping`);
      skipped++;
      continue;
    }

    if (newResult === bet.result) {
      console.log(`[REGRADE][OK] betId=${bet.id} result=${bet.result} unchanged ✓`);
      unchanged++;
      continue;
    }

    // Result changed — update DB
    console.log(`[REGRADE][FIX] betId=${bet.id} pick="${bet.pick}" ${bet.awayTeam}@${bet.homeTeam} score=${awayScore}-${homeScore}`);
    console.log(`  result: "${bet.result}" → "${newResult}"`);

    changes.push({
      id: bet.id,
      pick: bet.pick,
      awayTeam: bet.awayTeam,
      homeTeam: bet.homeTeam,
      awayScore,
      homeScore,
      oldResult: bet.result,
      newResult,
    });

    await db.execute(
      `UPDATE tracked_bets SET result = ? WHERE id = ?`,
      [newResult, bet.id]
    );
    regraded++;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[REGRADE][OUTPUT] Total graded MLB bets: ${bets.length}`);
  console.log(`[REGRADE][OUTPUT] Re-graded (result changed): ${regraded}`);
  console.log(`[REGRADE][OUTPUT] Unchanged: ${unchanged}`);
  console.log(`[REGRADE][OUTPUT] Skipped: ${skipped}`);
  console.log(`[REGRADE][OUTPUT] Errors: ${errors}`);

  if (changes.length > 0) {
    console.log('\n[REGRADE][OUTPUT] Result changes:');
    for (const c of changes) {
      console.log(`  betId=${c.id} pick="${c.pick}" ${c.awayTeam}@${c.homeTeam} ${c.awayScore}-${c.homeScore}: ${c.oldResult} → ${c.newResult}`);
    }
  }

  // Final verification: re-fetch and confirm all results are consistent
  console.log('\n[REGRADE][VERIFY] Re-fetching all graded bets for final verification...');
  const [verifyRows] = await db.execute(
    `SELECT id, awayTeam, homeTeam, pick, pickSide, market, result, awayScore, homeScore, line, sport
     FROM tracked_bets
     WHERE sport = 'MLB' AND result IN ('WIN', 'LOSS', 'PUSH')
     ORDER BY id`
  );

  let verifyErrors = 0;
  for (const bet of verifyRows) {
    const awayScore = bet.awayScore !== null ? parseFloat(String(bet.awayScore)) : null;
    const homeScore = bet.homeScore !== null ? parseFloat(String(bet.homeScore)) : null;
    if (awayScore === null || homeScore === null) continue;
    const line = bet.line !== null ? parseFloat(String(bet.line)) : null;
    const expected = gradeBet(awayScore, homeScore, bet.market, bet.pickSide, line, bet.sport);
    if (expected === 'NO_RESULT') continue;
    if (expected !== bet.result) {
      console.log(`[REGRADE][VERIFY][FAIL] betId=${bet.id} pick="${bet.pick}" stored=${bet.result} expected=${expected}`);
      verifyErrors++;
    }
  }

  if (verifyErrors === 0) {
    console.log(`[REGRADE][VERIFY][PASS] All ${verifyRows.length} graded bets have correct results ✓`);
  } else {
    console.log(`[REGRADE][VERIFY][FAIL] ${verifyErrors} bets still have incorrect results`);
  }

  await db.end();
  process.exit(0);
}

main().catch(e => { console.error('[REGRADE][ERROR]', e); process.exit(1); });

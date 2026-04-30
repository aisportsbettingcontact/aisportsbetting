/**
 * mlbHistoricalBackfill.mjs
 *
 * Backfills actualAwayScore, actualHomeScore, actualF5AwayScore, actualF5HomeScore,
 * and nrfiActualResult for all final MLB games from April 6–19, 2026.
 *
 * Then triggers runMultiMarketBacktest for all eligible games (those with model probs set).
 *
 * Run: cd /home/ubuntu/ai-sports-betting && node server/mlbHistoricalBackfill.mjs
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const TAG = '[MLBHistoricalBackfill]';

// Dates that need backfill (March 26–April 5 already have actualAwayScore populated)
const BACKFILL_DATES = [
  '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09',
  '2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13',
  '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
  '2026-04-18', '2026-04-19',
];

const MLB_STATS_API_BASE = 'https://statsapi.mlb.com/api/v1';
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.mlb.com/',
};

// Team abbreviation normalization (API → DB)
const ABBREV_MAP = { AZ: 'ARI', OAK: 'ATH' };
function normalizeAbbrev(abbrev) {
  return ABBREV_MAP[abbrev] ?? abbrev;
}

// ─── MLB Stats API fetch ──────────────────────────────────────────────────────
async function fetchMlbLinescores(dateStr) {
  const url = `${MLB_STATS_API_BASE}/schedule?sportId=1&date=${dateStr}&hydrate=linescore&language=en`;
  console.log(`${TAG} [STEP] Fetching MLB API for ${dateStr}`);
  const resp = await fetch(url, { headers: FETCH_HEADERS });
  if (!resp.ok) throw new Error(`MLB Stats API HTTP ${resp.status} for ${dateStr}`);
  const data = await resp.json();
  const dateEntry = data.dates?.find(d => d.date === dateStr);
  const apiGames = dateEntry?.games ?? [];
  console.log(`${TAG} [STATE] API returned ${apiGames.length} games for ${dateStr}`);
  return apiGames;
}

// ─── Parse linescore into FG + F5 + NRFI ────────────────────────────────────
function parseGameScores(apiGame) {
  const ls = apiGame.linescore ?? {};
  const innings = ls.innings ?? [];
  const status = apiGame.status?.abstractGameState ?? '';

  if (status !== 'Final') return null;

  const awayRuns = ls.teams?.away?.runs ?? null;
  const homeRuns = ls.teams?.home?.runs ?? null;

  let awayF5 = null, homeF5 = null;
  if (innings.length >= 5) {
    awayF5 = innings.slice(0, 5).reduce((s, inn) => s + (inn.away?.runs ?? 0), 0);
    homeF5 = innings.slice(0, 5).reduce((s, inn) => s + (inn.home?.runs ?? 0), 0);
  }

  let nrfi = null;
  if (innings.length >= 1) {
    const inn1Away = innings[0].away?.runs ?? 0;
    const inn1Home = innings[0].home?.runs ?? 0;
    nrfi = (inn1Away === 0 && inn1Home === 0) ? 'NRFI' : 'YRFI';
  }

  const rawAway = apiGame.teams?.away?.team?.abbreviation ?? '';
  const rawHome = apiGame.teams?.home?.team?.abbreviation ?? '';

  return {
    gamePk: apiGame.gamePk,
    awayAbbrev: normalizeAbbrev(rawAway),
    homeAbbrev: normalizeAbbrev(rawHome),
    awayRuns, homeRuns,
    awayF5, homeF5,
    nrfi,
    inningsCount: innings.length,
  };
}

// ─── Backfill one date ────────────────────────────────────────────────────────
async function backfillDate(conn, dateStr) {
  console.log(`\n${TAG} ══ ${dateStr} ══════════════════════════════════════════`);

  let apiGames;
  try {
    apiGames = await fetchMlbLinescores(dateStr);
  } catch (err) {
    console.error(`${TAG} [ERROR] API fetch failed for ${dateStr}: ${err.message}`);
    return { date: dateStr, written: 0, skipped: 0, errors: 1, backtestGameIds: [] };
  }

  const parsedGames = apiGames.map(g => parseGameScores(g)).filter(Boolean);
  console.log(`${TAG} [STATE] ${parsedGames.length} final games parsed`);

  const [dbGames] = await conn.execute(
    `SELECT id, mlbGamePk, awayTeam, homeTeam,
            actualAwayScore, actualF5AwayScore, nrfiActualResult, modelHomeWinPct
     FROM games
     WHERE gameDate = ? AND sport = 'MLB' AND gameStatus = 'final'`,
    [dateStr]
  );
  console.log(`${TAG} [STATE] ${dbGames.length} final MLB games in DB`);

  const dbByGamePk = new Map();
  const dbByTeams = new Map();
  for (const g of dbGames) {
    if (g.mlbGamePk) dbByGamePk.set(Number(g.mlbGamePk), g);
    dbByTeams.set(`${g.awayTeam}@${g.homeTeam}`, g);
  }

  let written = 0, skipped = 0, errors = 0;
  const backtestGameIds = [];

  for (const pg of parsedGames) {
    try {
      let dbGame = dbByGamePk.get(pg.gamePk) ?? dbByTeams.get(`${pg.awayAbbrev}@${pg.homeAbbrev}`);
      if (!dbGame) {
        console.warn(`${TAG} [WARN] NO_MATCH: gamePk=${pg.gamePk} ${pg.awayAbbrev}@${pg.homeAbbrev}`);
        skipped++;
        continue;
      }

      const needsFg = dbGame.actualAwayScore === null && pg.awayRuns !== null;
      const needsF5 = dbGame.actualF5AwayScore === null && pg.awayF5 !== null;
      const needsNrfi = dbGame.nrfiActualResult === null && pg.nrfi !== null;

      if (!needsFg && !needsF5 && !needsNrfi) {
        console.log(`${TAG} [SKIP] id=${dbGame.id} ${pg.awayAbbrev}@${pg.homeAbbrev} — already populated`);
        skipped++;
        if (dbGame.modelHomeWinPct !== null) backtestGameIds.push(dbGame.id);
        continue;
      }

      const updateFields = {};
      const logParts = [];
      if (needsFg) {
        updateFields.actualAwayScore = pg.awayRuns;
        updateFields.actualHomeScore = pg.homeRuns;
        logParts.push(`FG=${pg.awayRuns}-${pg.homeRuns}`);
      }
      if (needsF5) {
        updateFields.actualF5AwayScore = pg.awayF5;
        updateFields.actualF5HomeScore = pg.homeF5;
        logParts.push(`F5=${pg.awayF5}-${pg.homeF5}`);
      }
      if (needsNrfi) {
        updateFields.nrfiActualResult = pg.nrfi;
        logParts.push(`NRFI=${pg.nrfi}`);
      }

      const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
      const setValues = Object.values(updateFields);

      console.log(`${TAG} [STEP] UPDATE id=${dbGame.id} ${pg.awayAbbrev}@${pg.homeAbbrev} | ${logParts.join(' | ')} | innings=${pg.inningsCount}`);
      await conn.execute(`UPDATE games SET ${setClauses} WHERE id = ?`, [...setValues, dbGame.id]);

      // Post-write verification
      const [verify] = await conn.execute(
        `SELECT actualAwayScore, actualHomeScore, actualF5AwayScore, actualF5HomeScore, nrfiActualResult FROM games WHERE id = ?`,
        [dbGame.id]
      );
      const v = verify[0];
      const fgOk = !needsFg || (v.actualAwayScore === pg.awayRuns && v.actualHomeScore === pg.homeRuns);
      const f5Ok = !needsF5 || (v.actualF5AwayScore === pg.awayF5 && v.actualF5HomeScore === pg.homeF5);
      const nrfiOk = !needsNrfi || v.nrfiActualResult === pg.nrfi;

      if (fgOk && f5Ok && nrfiOk) {
        console.log(`${TAG} [VERIFY PASS] id=${dbGame.id} | FG=${v.actualAwayScore}-${v.actualHomeScore} | F5=${v.actualF5AwayScore ?? 'null'}-${v.actualF5HomeScore ?? 'null'} | NRFI=${v.nrfiActualResult ?? 'null'}`);
        written++;
        if (dbGame.modelHomeWinPct !== null) backtestGameIds.push(dbGame.id);
      } else {
        console.error(`${TAG} [VERIFY FAIL] id=${dbGame.id} fgOk=${fgOk} f5Ok=${f5Ok} nrfiOk=${nrfiOk}`);
        errors++;
      }
    } catch (err) {
      console.error(`${TAG} [ERROR] gamePk=${pg.gamePk}: ${err.message}`);
      errors++;
    }
  }

  console.log(`${TAG} [OUTPUT] ${dateStr}: written=${written} skipped=${skipped} errors=${errors} backtest_eligible=${backtestGameIds.length}`);
  return { date: dateStr, written, skipped, errors, backtestGameIds };
}

// ─── Trigger multi-market backtest ───────────────────────────────────────────
async function triggerBacktest(conn, gameId) {
  // Check if already backtested
  const [existing] = await conn.execute(
    `SELECT COUNT(*) as cnt FROM mlb_game_backtest WHERE gameId = ?`, [gameId]
  );
  if (existing[0].cnt > 0) {
    console.log(`${TAG} [BACKTEST] id=${gameId} already has ${existing[0].cnt} entries — skipping`);
    return 'skip';
  }

  // Validate scores present
  const [gameCheck] = await conn.execute(
    `SELECT id, awayTeam, homeTeam, actualAwayScore, actualHomeScore, modelHomeWinPct FROM games WHERE id = ?`,
    [gameId]
  );
  if (!gameCheck.length) { console.warn(`${TAG} [BACKTEST] id=${gameId} not found`); return 'skip'; }
  const g = gameCheck[0];
  if (g.actualAwayScore === null) { console.warn(`${TAG} [BACKTEST] id=${gameId} — no actual scores`); return 'skip'; }
  if (g.modelHomeWinPct === null) { console.log(`${TAG} [BACKTEST] id=${gameId} — no model probs`); return 'skip'; }

  console.log(`${TAG} [BACKTEST] Triggering id=${gameId} ${g.awayTeam}@${g.homeTeam} | FG=${g.actualAwayScore}-${g.actualHomeScore}`);

  try {
    const { runMultiMarketBacktest } = await import('./mlbMultiMarketBacktest.js');
    await runMultiMarketBacktest(gameId);
    console.log(`${TAG} [BACKTEST] ✅ id=${gameId}`);
    return 'success';
  } catch (err) {
    console.error(`${TAG} [BACKTEST] ❌ id=${gameId}: ${err.message}`);
    return 'fail';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ╔══════════════════════════════════════════════════════╗`);
  console.log(`${TAG} ║  MLB HISTORICAL BACKFILL — April 6–19, 2026          ║`);
  console.log(`${TAG} ╚══════════════════════════════════════════════════════╝`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Phase 1: Score backfill
  console.log(`\n${TAG} ═══ PHASE 1: SCORE BACKFILL ════════════════════════════`);
  const summary = [];
  const allBacktestIds = [];

  for (const date of BACKFILL_DATES) {
    const result = await backfillDate(conn, date);
    summary.push(result);
    allBacktestIds.push(...(result.backtestGameIds ?? []));
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }

  // Phase 2: Multi-market backtest
  console.log(`\n${TAG} ═══ PHASE 2: MULTI-MARKET BACKTEST ════════════════════`);
  console.log(`${TAG} [INPUT] ${allBacktestIds.length} games eligible`);

  let btSuccess = 0, btSkip = 0, btFail = 0;
  for (const gameId of allBacktestIds) {
    const result = await triggerBacktest(conn, gameId);
    if (result === 'success') btSuccess++;
    else if (result === 'skip') btSkip++;
    else btFail++;
    await new Promise(r => setTimeout(r, 50));
  }

  // Final summary
  console.log(`\n${TAG} ═══ FINAL SUMMARY ══════════════════════════════════════`);
  let totalWritten = 0, totalSkipped = 0, totalErrors = 0;
  for (const s of summary) {
    totalWritten += s.written;
    totalSkipped += s.skipped;
    totalErrors += s.errors;
    console.log(`${TAG}   ${s.date}: written=${s.written} skipped=${s.skipped} errors=${s.errors}`);
  }
  console.log(`${TAG} ─────────────────────────────────────────────────────────`);
  console.log(`${TAG} SCORES: written=${totalWritten} skipped=${totalSkipped} errors=${totalErrors}`);
  console.log(`${TAG} BACKTEST: success=${btSuccess} skipped=${btSkip} failed=${btFail}`);
  console.log(`${TAG} ✅ DONE`);

  await conn.end();
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});

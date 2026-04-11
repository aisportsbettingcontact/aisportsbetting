/**
 * audit_home_away.mjs
 *
 * ROOT CAUSE ANALYSIS: Home/Away designation bug
 *
 * PROBLEM: DB shows ARI as 1 home game (0-1) and 13 away games (4-9)
 *          Reality: ARI is 5-2 home SU and 3-4 away SU
 *
 * HYPOTHESIS: The AN API teams[] ordering may NOT be teams[0]=away, teams[1]=home
 *             OR the DB has away_team_id / home_team_id fields that should be used
 *             instead of teams[] array position.
 *
 * INVESTIGATION:
 *   1. Fetch a KNOWN home game for ARI from the AN API and inspect the raw response
 *   2. Cross-check DB rows for ARI games against known game results
 *   3. Check if away_team_id / home_team_id fields exist in the AN API response
 *   4. Verify the upsert logic in fetchMlbScheduleForDate
 *
 * Run: node scripts/audit_home_away.mjs
 */

import { createConnection } from 'mysql2/promise';
import axios from 'axios';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[AUDIT][FATAL] DATABASE_URL not set');
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);
const SEASON_START = '2026-03-26';
const AN_V1_BASE = 'https://api.actionnetwork.com/web/v1/scoreboard/mlb';
const DK_NJ_BOOK_ID = 68;
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/',
};

// ─── Step 1: Pull ALL ARI games from DB and show raw home/away fields ─────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 1] All ARI games in DB — raw awaySlug / homeSlug');
console.log('═══════════════════════════════════════════════════════════════');

const [ariGames] = await conn.query(`
  SELECT 
    id, gameDate, anGameId, awaySlug, homeSlug, awayAbbr, homeAbbr,
    awayScore, homeScore, awayWon,
    awayRunLineCovered, homeRunLineCovered,
    dkAwayML, dkHomeML, totalResult,
    away_team_id, home_team_id
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND (awaySlug = 'arizona-diamondbacks' OR homeSlug = 'arizona-diamondbacks')
  ORDER BY gameDate ASC
`, [SEASON_START]).catch(async () => {
  // Try without away_team_id / home_team_id if columns don't exist
  return conn.query(`
    SELECT 
      id, gameDate, anGameId, awaySlug, homeSlug, awayAbbr, homeAbbr,
      awayScore, homeScore, awayWon,
      awayRunLineCovered, homeRunLineCovered,
      dkAwayML, dkHomeML, totalResult
    FROM mlb_schedule_history
    WHERE gameDate >= ? AND gameStatus = 'complete'
      AND (awaySlug = 'arizona-diamondbacks' OR homeSlug = 'arizona-diamondbacks')
    ORDER BY gameDate ASC
  `, [SEASON_START]);
});

console.log(`\n[AUDIT][STEP 1] ARI completed games in DB: ${ariGames.length}`);
console.log(`\n  ${'DATE'.padEnd(12)} ${'AWAY'.padEnd(6)} ${'HOME'.padEnd(6)} ${'SCORE'.padEnd(8)} ${'DB_ARI_ROLE'.padEnd(12)} ${'ARI_WON'.padEnd(8)} ${'ML'.padEnd(10)}`);
console.log(`  ${'─'.repeat(12)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(10)}`);

let dbHomeCount = 0, dbAwayCount = 0;
let dbHomeW = 0, dbHomeL = 0, dbAwayW = 0, dbAwayL = 0;

for (const g of ariGames) {
  const isAway = g.awaySlug === 'arizona-diamondbacks';
  const aw = g.awayWon === true || g.awayWon === 1 || (Buffer.isBuffer(g.awayWon) && g.awayWon[0] === 1);
  const ariWon = g.awayWon != null ? (isAway ? aw : !aw) : null;
  const myML = isAway ? g.dkAwayML : g.dkHomeML;
  const role = isAway ? 'AWAY' : 'HOME';
  
  if (isAway) { dbAwayCount++; if (ariWon) dbAwayW++; else dbAwayL++; }
  else { dbHomeCount++; if (ariWon) dbHomeW++; else dbHomeL++; }
  
  console.log(`  ${g.gameDate.padEnd(12)} ${g.awayAbbr.padEnd(6)} ${g.homeAbbr.padEnd(6)} ${String(g.awayScore)+'-'+String(g.homeScore).padEnd(8)} ${role.padEnd(12)} ${String(ariWon).padEnd(8)} ${String(myML).padEnd(10)}`);
}

console.log(`\n[AUDIT][STEP 1] DB Summary:`);
console.log(`  DB Home: ${dbHomeCount} games (${dbHomeW}-${dbHomeL})`);
console.log(`  DB Away: ${dbAwayCount} games (${dbAwayW}-${dbAwayL})`);
console.log(`\n  EXPECTED (per user): Home 5-2, Away 3-4`);
console.log(`  DB SHOWS:            Home ${dbHomeW}-${dbHomeL}, Away ${dbAwayW}-${dbAwayL}`);
console.log(`  DISCREPANCY: ${dbHomeCount === 1 ? '⚠️  CRITICAL — DB has wrong home/away designation' : '✅ Counts match'}`);

// ─── Step 2: Fetch live AN API for a known ARI home game date ─────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 2] Fetch AN API for ARI home game — inspect raw teams[] ordering');
console.log('═══════════════════════════════════════════════════════════════');

// ARI played PHI at home on 2026-04-10 (PHI@ARI in DB = ARI is home)
// But the DB shows awaySlug=PHI, homeSlug=ARI — let's verify with the API
const testDate = '20260410';
console.log(`\n[AUDIT][STEP 2] Fetching AN API for date=${testDate} (PHI@ARI game)`);

try {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${testDate}`;
  const res = await axios.get(url, { headers: AN_HEADERS, timeout: 15000 });
  const games = res.data.games ?? [];
  
  console.log(`[AUDIT][STEP 2] API returned ${games.length} games for ${testDate}`);
  
  for (const game of games) {
    const teams = game.teams ?? [];
    const awayTeam = teams[0];
    const homeTeam = teams[1];
    
    // Find ARI game
    const hasAri = teams.some(t => t.url_slug === 'arizona-diamondbacks');
    if (!hasAri) continue;
    
    console.log(`\n[AUDIT][STEP 2] FOUND ARI GAME:`);
    console.log(`  game.id: ${game.id}`);
    console.log(`  game.status: ${game.status}`);
    console.log(`  game.away_team_id: ${game.away_team_id}`);
    console.log(`  game.home_team_id: ${game.home_team_id}`);
    console.log(`\n  teams[0] (DB stores as AWAY):`);
    console.log(`    id: ${awayTeam?.id}`);
    console.log(`    abbr: ${awayTeam?.abbr}`);
    console.log(`    url_slug: ${awayTeam?.url_slug}`);
    console.log(`    full_name: ${awayTeam?.full_name}`);
    console.log(`\n  teams[1] (DB stores as HOME):`);
    console.log(`    id: ${homeTeam?.id}`);
    console.log(`    abbr: ${homeTeam?.abbr}`);
    console.log(`    url_slug: ${homeTeam?.url_slug}`);
    console.log(`    full_name: ${homeTeam?.full_name}`);
    
    // Check if away_team_id matches teams[0].id
    if (game.away_team_id && awayTeam?.id) {
      const awayMatch = game.away_team_id === awayTeam.id;
      const homeMatch = game.home_team_id === homeTeam?.id;
      console.log(`\n  away_team_id(${game.away_team_id}) === teams[0].id(${awayTeam.id}): ${awayMatch}`);
      console.log(`  home_team_id(${game.home_team_id}) === teams[1].id(${homeTeam?.id}): ${homeMatch}`);
      
      if (!awayMatch) {
        console.log(`\n  ⚠️  CRITICAL BUG CONFIRMED: away_team_id does NOT match teams[0]`);
        console.log(`  The correct away team is the one whose id matches away_team_id`);
        
        // Find which teams[] entry matches away_team_id
        const correctAway = teams.find(t => t.id === game.away_team_id);
        const correctHome = teams.find(t => t.id === game.home_team_id);
        console.log(`  Correct AWAY: ${correctAway?.url_slug} (${correctAway?.abbr})`);
        console.log(`  Correct HOME: ${correctHome?.url_slug} (${correctHome?.abbr})`);
      } else {
        console.log(`\n  ✅ teams[0]=away, teams[1]=home is CORRECT for this game`);
      }
    }
    
    // Also check boxscore
    console.log(`\n  boxscore: ${JSON.stringify(game.boxscore)}`);
    
    // Check all raw team fields
    console.log(`\n  Full teams[0]: ${JSON.stringify(awayTeam)}`);
    console.log(`  Full teams[1]: ${JSON.stringify(homeTeam)}`);
  }
} catch (err) {
  console.error(`[AUDIT][STEP 2] API fetch failed: ${err.message}`);
}

// ─── Step 3: Fetch AN API for a known ARI AWAY game ──────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 3] Fetch AN API for ARI away game — verify teams[] ordering');
console.log('═══════════════════════════════════════════════════════════════');

// ARI was at NYM on 2026-04-09
const testDate2 = '20260409';
console.log(`\n[AUDIT][STEP 3] Fetching AN API for date=${testDate2} (ARI@NYM game)`);

try {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${testDate2}`;
  const res = await axios.get(url, { headers: AN_HEADERS, timeout: 15000 });
  const games = res.data.games ?? [];
  
  console.log(`[AUDIT][STEP 3] API returned ${games.length} games for ${testDate2}`);
  
  for (const game of games) {
    const teams = game.teams ?? [];
    const hasAri = teams.some(t => t.url_slug === 'arizona-diamondbacks');
    if (!hasAri) continue;
    
    const awayTeam = teams[0];
    const homeTeam = teams[1];
    
    console.log(`\n[AUDIT][STEP 3] FOUND ARI GAME:`);
    console.log(`  game.id: ${game.id}`);
    console.log(`  game.away_team_id: ${game.away_team_id}`);
    console.log(`  game.home_team_id: ${game.home_team_id}`);
    console.log(`  teams[0]: ${awayTeam?.url_slug} (${awayTeam?.abbr}) id=${awayTeam?.id}`);
    console.log(`  teams[1]: ${homeTeam?.url_slug} (${homeTeam?.abbr}) id=${homeTeam?.id}`);
    
    if (game.away_team_id && awayTeam?.id) {
      const awayMatch = game.away_team_id === awayTeam.id;
      console.log(`  away_team_id(${game.away_team_id}) === teams[0].id(${awayTeam.id}): ${awayMatch}`);
      if (awayMatch) {
        console.log(`  ✅ teams[0]=away confirmed for ARI away game`);
      } else {
        console.log(`  ⚠️  teams[0] is NOT the away team`);
      }
    }
  }
} catch (err) {
  console.error(`[AUDIT][STEP 3] API fetch failed: ${err.message}`);
}

// ─── Step 4: Check DB for ARI home games that SHOULD exist ───────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 4] Cross-reference DB vs known ARI schedule');
console.log('═══════════════════════════════════════════════════════════════');

// Known ARI home games (at Chase Field, Phoenix):
// Mar 26-28: ARI vs LAD (ARI is home)
// Apr 1-3: ARI vs DET (ARI is home)
// Apr 4-6: ARI vs ATL (ARI is home)
// Apr 10-12: ARI vs PHI (ARI is home)
// Known ARI away games:
// Mar 26-28: at LAD (ARI is away) — wait, let's check

console.log('\n[AUDIT][STEP 4] ARI games in DB with homeSlug=arizona-diamondbacks:');
const [ariHomeGames] = await conn.query(`
  SELECT gameDate, awayAbbr, homeAbbr, awayScore, homeScore, awayWon
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND homeSlug = 'arizona-diamondbacks'
  ORDER BY gameDate ASC
`, [SEASON_START]);

console.log(`  ARI as HOME team in DB: ${ariHomeGames.length} games`);
for (const g of ariHomeGames) {
  const aw = g.awayWon === true || g.awayWon === 1 || (Buffer.isBuffer(g.awayWon) && g.awayWon[0] === 1);
  console.log(`    ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore} ariWon=${!aw}`);
}

console.log('\n[AUDIT][STEP 4] ARI games in DB with awaySlug=arizona-diamondbacks:');
const [ariAwayGames] = await conn.query(`
  SELECT gameDate, awayAbbr, homeAbbr, awayScore, homeScore, awayWon
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND awaySlug = 'arizona-diamondbacks'
  ORDER BY gameDate ASC
`, [SEASON_START]);

console.log(`  ARI as AWAY team in DB: ${ariAwayGames.length} games`);
for (const g of ariAwayGames) {
  const aw = g.awayWon === true || g.awayWon === 1 || (Buffer.isBuffer(g.awayWon) && g.awayWon[0] === 1);
  console.log(`    ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore} ariWon=${aw}`);
}

// ─── Step 5: Fetch AN API for a known ARI home series (Mar 26-28 vs LAD) ─────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 5] Fetch AN API for Mar 26 — ARI opening series');
console.log('═══════════════════════════════════════════════════════════════');

// The DB shows ARI@LAD on Mar 26-28 (ARI as away). But was ARI actually at LAD?
// Let's verify with the API
const testDate3 = '20260326';
try {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${testDate3}`;
  const res = await axios.get(url, { headers: AN_HEADERS, timeout: 15000 });
  const games = res.data.games ?? [];
  
  console.log(`[AUDIT][STEP 5] API returned ${games.length} games for ${testDate3}`);
  
  for (const game of games) {
    const teams = game.teams ?? [];
    const hasAri = teams.some(t => t.url_slug === 'arizona-diamondbacks');
    if (!hasAri) continue;
    
    const awayTeam = teams[0];
    const homeTeam = teams[1];
    
    console.log(`\n[AUDIT][STEP 5] FOUND ARI GAME on ${testDate3}:`);
    console.log(`  game.id: ${game.id}`);
    console.log(`  game.away_team_id: ${game.away_team_id}`);
    console.log(`  game.home_team_id: ${game.home_team_id}`);
    console.log(`  teams[0]: ${awayTeam?.url_slug} (${awayTeam?.abbr}) id=${awayTeam?.id}`);
    console.log(`  teams[1]: ${homeTeam?.url_slug} (${homeTeam?.abbr}) id=${homeTeam?.id}`);
    console.log(`  boxscore: ${JSON.stringify(game.boxscore)}`);
    
    // Check away_team_id
    if (game.away_team_id) {
      const correctAway = teams.find(t => t.id === game.away_team_id);
      const correctHome = teams.find(t => t.id === game.home_team_id);
      console.log(`\n  By away_team_id: AWAY=${correctAway?.url_slug}, HOME=${correctHome?.url_slug}`);
      console.log(`  By teams[0]/[1]: AWAY=${awayTeam?.url_slug}, HOME=${homeTeam?.url_slug}`);
      
      if (correctAway?.url_slug !== awayTeam?.url_slug) {
        console.log(`  ⚠️  MISMATCH: away_team_id says ${correctAway?.url_slug} is away but teams[0] says ${awayTeam?.url_slug}`);
      } else {
        console.log(`  ✅ MATCH: away_team_id and teams[0] agree on away team`);
      }
    }
  }
} catch (err) {
  console.error(`[AUDIT][STEP 5] API fetch failed: ${err.message}`);
}

// ─── Step 6: Check the anGameId field and look up a specific game ─────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 6] Check anGameId for ARI games — look up in AN API');
console.log('═══════════════════════════════════════════════════════════════');

const [ariGameIds] = await conn.query(`
  SELECT gameDate, anGameId, awayAbbr, homeAbbr, awayScore, homeScore
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND (awaySlug = 'arizona-diamondbacks' OR homeSlug = 'arizona-diamondbacks')
  ORDER BY gameDate ASC
  LIMIT 5
`, [SEASON_START]);

console.log('\n  ARI game IDs in DB:');
for (const g of ariGameIds) {
  console.log(`    ${g.gameDate} anGameId=${g.anGameId} ${g.awayAbbr}@${g.homeAbbr} ${g.awayScore}-${g.homeScore}`);
}

await conn.end();
console.log('\n[AUDIT][DONE] Home/Away audit complete.');

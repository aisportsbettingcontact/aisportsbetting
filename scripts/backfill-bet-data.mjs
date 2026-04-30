/**
 * backfill-bet-data.mjs
 *
 * Backfills missing homeTeam and awayScore/homeScore for all tracked_bets rows
 * that have homeTeam = "OPP" or null scores.
 *
 * Strategy:
 *   1. Group affected bets by (sport, gameDate)
 *   2. For each group, fetch the MLB Stats API schedule for that date
 *   3. Match each bet's awayTeam abbreviation to a game in the schedule
 *   4. Update homeTeam, awayScore, homeScore in the DB
 *
 * MLB Stats API: https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=linescore,team
 *
 * Logging convention:
 *   [INPUT]  — raw bet data
 *   [STEP]   — operation in progress
 *   [STATE]  — intermediate values
 *   [MATCH]  — game match result
 *   [UPDATE] — DB update result
 *   [VERIFY] — validation pass/fail
 *   [ERROR]  — failure with context
 */

import { createConnection } from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }

// ─── MLB abbreviation normalization ──────────────────────────────────────────
// MLB Stats API uses different abbreviations than what users type
// Map common variants to canonical MLB Stats API abbreviations
const ABBREV_NORMALIZE = {
  'ATH': 'ATH',  // Oakland Athletics (now Athletics)
  'OAK': 'ATH',
  'WSH': 'WSH',
  'WAS': 'WSH',
  'TB':  'TB',
  'TBR': 'TB',
  'TBD': 'TB',
  'KC':  'KC',
  'KCR': 'KC',
  'SF':  'SF',
  'SFG': 'SF',
  'SD':  'SD',
  'SDP': 'SD',
  'NYY': 'NYY',
  'NYM': 'NYM',
  'LAD': 'LAD',
  'LAA': 'LAA',
  'CWS': 'CWS',
  'CHW': 'CWS',
  'CHC': 'CHC',
  'STL': 'STL',
  'MIL': 'MIL',
  'MIN': 'MIN',
  'DET': 'DET',
  'CLE': 'CLE',
  'PIT': 'PIT',
  'CIN': 'CIN',
  'ATL': 'ATL',
  'MIA': 'MIA',
  'MRL': 'MIA',
  'PHI': 'PHI',
  'BOS': 'BOS',
  'BAL': 'BAL',
  'TOR': 'TOR',
  'HOU': 'HOU',
  'TEX': 'TEX',
  'SEA': 'SEA',
  'OAK': 'ATH',
  'COL': 'COL',
  'ARI': 'ARI',
  'AZ':  'ARI',
};

function normalizeAbbrev(abbrev) {
  if (!abbrev) return null;
  const upper = abbrev.toUpperCase().trim();
  return ABBREV_NORMALIZE[upper] ?? upper;
}

// ─── Fetch MLB schedule for a date ───────────────────────────────────────────
async function fetchMlbSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`;
  console.log(`[STEP] Fetching MLB schedule: GET ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`[ERROR] MLB API returned status=${res.status} for date=${date}`);
      return [];
    }
    const json = await res.json();
    const games = json.dates?.[0]?.games ?? [];
    console.log(`[STATE] MLB schedule date=${date}: ${games.length} games found`);
    return games;
  } catch (e) {
    console.error(`[ERROR] MLB fetch failed for date=${date}:`, e.message);
    return [];
  }
}

// ─── Match a bet's awayTeam to a game in the schedule ────────────────────────
function matchGame(games, awayAbbrev) {
  const norm = normalizeAbbrev(awayAbbrev);
  console.log(`[STEP] Matching awayTeam="${awayAbbrev}" (normalized="${norm}") against ${games.length} games`);

  for (const g of games) {
    const apiAway = g.teams?.away?.team?.abbreviation ?? '';
    const apiHome = g.teams?.home?.team?.abbreviation ?? '';
    const normApiAway = normalizeAbbrev(apiAway);
    const normApiHome = normalizeAbbrev(apiHome);

    console.log(`[STATE]   Checking game ${g.gamePk}: ${apiAway}@${apiHome} (norm: ${normApiAway}@${normApiHome})`);

    // Match: bet's awayTeam could be either the away OR home team in the actual game
    // (some bets were entered with the picked team as "awayTeam" regardless of actual side)
    if (normApiAway === norm) {
      console.log(`[MATCH] FOUND: ${awayAbbrev} is AWAY in game ${g.gamePk} (${apiAway}@${apiHome})`);
      return { game: g, betTeamIsAway: true };
    }
    if (normApiHome === norm) {
      console.log(`[MATCH] FOUND: ${awayAbbrev} is HOME in game ${g.gamePk} (${apiAway}@${apiHome})`);
      return { game: g, betTeamIsAway: false };
    }
  }

  // Try partial match (first 3 chars)
  for (const g of games) {
    const apiAway = g.teams?.away?.team?.abbreviation ?? '';
    const apiHome = g.teams?.home?.team?.abbreviation ?? '';
    if (apiAway.startsWith(norm.slice(0, 3)) || norm.startsWith(apiAway.slice(0, 3))) {
      console.log(`[MATCH] PARTIAL MATCH (away): ${awayAbbrev} ~ ${apiAway} in game ${g.gamePk}`);
      return { game: g, betTeamIsAway: true };
    }
    if (apiHome.startsWith(norm.slice(0, 3)) || norm.startsWith(apiHome.slice(0, 3))) {
      console.log(`[MATCH] PARTIAL MATCH (home): ${awayAbbrev} ~ ${apiHome} in game ${g.gamePk}`);
      return { game: g, betTeamIsAway: false };
    }
  }

  console.log(`[MATCH] NO MATCH for awayTeam="${awayAbbrev}" on this date`);
  return null;
}

// ─── Extract scores from a game ───────────────────────────────────────────────
function extractScores(game) {
  const awayScore = game.teams?.away?.score ?? null;
  const homeScore = game.teams?.home?.score ?? null;
  const state = game.status?.detailedState ?? 'Unknown';
  const isFinal = state === 'Final' || state === 'Game Over';
  return { awayScore, homeScore, state, isFinal };
}

// ─── Main backfill logic ──────────────────────────────────────────────────────
const conn = await createConnection(DATABASE_URL);

// Fetch all bets that need backfilling
const [bets] = await conn.execute(
  `SELECT id, sport, gameDate, awayTeam, homeTeam, pick, pickSide, result, awayScore, homeScore, anGameId
   FROM tracked_bets
   WHERE sport = 'MLB'
   ORDER BY gameDate ASC`
);

console.log(`[INPUT] Total MLB bets to process: ${bets.length}`);

// Identify bets that need fixing
const needsTeam  = bets.filter(b => !b.homeTeam || b.homeTeam === 'OPP' || b.homeTeam.trim() === '');
const needsScore = bets.filter(b =>
  b.result !== 'PENDING' && b.result !== 'VOID' &&
  (b.awayScore === null || b.homeScore === null)
);

console.log(`[STATE] Bets needing homeTeam fix: ${needsTeam.length}`);
console.log(`[STATE] Bets needing score backfill: ${needsScore.length}`);

// Collect all unique dates
const allDates = new Set([
  ...needsTeam.map(b => b.gameDate),
  ...needsScore.map(b => b.gameDate),
]);

console.log(`[STATE] Unique dates to fetch: ${allDates.size} (${Array.from(allDates).join(', ')})`);

// Fetch schedules for all dates
const scheduleByDate = new Map();
for (const date of allDates) {
  const games = await fetchMlbSchedule(date);
  scheduleByDate.set(date, games);
  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 200));
}

// ─── Process bets needing homeTeam fix ───────────────────────────────────────
let teamFixed = 0;
let teamFailed = 0;

console.log('\n[STEP] === FIXING MISSING HOME TEAMS ===');
for (const bet of needsTeam) {
  console.log(`\n[INPUT] Bet id=${bet.id} date=${bet.gameDate} awayTeam="${bet.awayTeam}" homeTeam="${bet.homeTeam}" pick="${bet.pick}"`);
  const games = scheduleByDate.get(bet.gameDate) ?? [];
  const match = matchGame(games, bet.awayTeam);

  if (!match) {
    console.log(`[ERROR] Could not find game for bet id=${bet.id} awayTeam="${bet.awayTeam}" date=${bet.gameDate}`);
    teamFailed++;
    continue;
  }

  const { game, betTeamIsAway } = match;
  const apiAway = game.teams.away.team.abbreviation;
  const apiHome = game.teams.home.team.abbreviation;
  const scores = extractScores(game);

  // Determine correct awayTeam and homeTeam based on actual game positions
  // The bet's awayTeam field stores the PICKED team, not necessarily the actual away team
  // We need to store the actual away and home teams
  const actualAwayTeam = apiAway;
  const actualHomeTeam = apiHome;

  console.log(`[STATE] Game ${game.gamePk}: actual=${apiAway}@${apiHome} betTeamIsAway=${betTeamIsAway}`);
  console.log(`[STATE] Scores: away=${scores.awayScore} home=${scores.homeScore} state=${scores.state} isFinal=${scores.isFinal}`);

  // Update homeTeam (and awayTeam if needed) to actual values
  const updates = { homeTeam: actualHomeTeam, awayTeam: actualAwayTeam };
  if (scores.isFinal && bet.result !== 'PENDING' && bet.result !== 'VOID') {
    updates.awayScore = String(scores.awayScore ?? 0);
    updates.homeScore = String(scores.homeScore ?? 0);
  }

  const setClauses = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), bet.id];

  await conn.execute(`UPDATE tracked_bets SET ${setClauses} WHERE id = ?`, values);
  console.log(`[UPDATE] PASS — bet id=${bet.id}: awayTeam=${actualAwayTeam} homeTeam=${actualHomeTeam} awayScore=${updates.awayScore ?? 'unchanged'} homeScore=${updates.homeScore ?? 'unchanged'}`);
  teamFixed++;
}

// ─── Process bets needing score backfill ─────────────────────────────────────
let scoreFixed = 0;
let scoreFailed = 0;

console.log('\n[STEP] === BACKFILLING MISSING SCORES ===');
for (const bet of needsScore) {
  // Skip if already fixed in the team fix pass
  if (needsTeam.some(b => b.id === bet.id)) {
    console.log(`[STEP] Bet id=${bet.id} already processed in team fix pass — skipping`);
    continue;
  }

  console.log(`\n[INPUT] Bet id=${bet.id} date=${bet.gameDate} ${bet.awayTeam}@${bet.homeTeam} result=${bet.result}`);
  const games = scheduleByDate.get(bet.gameDate) ?? [];
  const match = matchGame(games, bet.awayTeam);

  if (!match) {
    console.log(`[ERROR] Could not find game for bet id=${bet.id} awayTeam="${bet.awayTeam}" date=${bet.gameDate}`);
    scoreFailed++;
    continue;
  }

  const { game } = match;
  const scores = extractScores(game);

  if (!scores.isFinal) {
    console.log(`[STATE] Game not final (state=${scores.state}) for bet id=${bet.id} — skipping score update`);
    scoreFailed++;
    continue;
  }

  await conn.execute(
    'UPDATE tracked_bets SET awayScore = ?, homeScore = ? WHERE id = ?',
    [String(scores.awayScore ?? 0), String(scores.homeScore ?? 0), bet.id]
  );
  console.log(`[UPDATE] PASS — bet id=${bet.id}: awayScore=${scores.awayScore} homeScore=${scores.homeScore}`);
  scoreFixed++;
}

// ─── Final verification ───────────────────────────────────────────────────────
console.log('\n[STEP] === FINAL VERIFICATION ===');
const [remaining] = await conn.execute(
  `SELECT id, gameDate, awayTeam, homeTeam, result, awayScore, homeScore
   FROM tracked_bets
   WHERE sport = 'MLB'
   AND (homeTeam IS NULL OR homeTeam = 'OPP' OR homeTeam = ''
        OR (result NOT IN ('PENDING','VOID') AND (awayScore IS NULL OR homeScore IS NULL)))
   ORDER BY gameDate DESC`
);

console.log(`\n[VERIFY] Remaining bets with issues: ${remaining.length}`);
for (const r of remaining) {
  console.log(`[VERIFY] FAIL — id=${r.id} date=${r.gameDate} ${r.awayTeam}@${r.homeTeam} result=${r.result} scores=${r.awayScore}-${r.homeScore}`);
}

console.log('\n[SUMMARY]');
console.log(`  Team fixes:  ${teamFixed} fixed, ${teamFailed} failed`);
console.log(`  Score fixes: ${scoreFixed} fixed, ${scoreFailed} failed`);
console.log(`  Remaining issues: ${remaining.length}`);

await conn.end();

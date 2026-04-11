/**
 * fix_mar25.mjs
 * Re-ingests the Mar 25, 2026 NYY@SF game with corrected home/away designation.
 * AN API confirms: away_team_id=191 (NYY), home_team_id=209 (SF Giants)
 * DB currently has it inverted: awaySlug=sf-giants, homeSlug=nyyankees
 */
import mysql from 'mysql2/promise';
import axios from 'axios';

const TAG = '[FixMar25]';
const BOOK_FALLBACK = [68, 15, 21, 30];
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/'
};

function fmtOdds(v) {
  if (v == null) return null;
  const r = Math.round(v);
  return r >= 0 ? `+${r}` : String(r);
}
function fmtLine(v) {
  if (v == null) return null;
  return v >= 0 ? `+${v}` : String(v);
}
function utcToEstDate(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2');
}

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

console.log(`${TAG}[INPUT] Re-ingesting Mar 25, 2026 (NYY @ SF Giants)`);

// Step 1: Check current DB state
const [before] = await conn.execute(
  `SELECT awaySlug, homeSlug, awayScore, homeScore, awayWon FROM mlb_schedule_history WHERE gameDate='2026-03-25'`
);
console.log(`${TAG}[STATE] Before fix: ${JSON.stringify(before[0])}`);

// Step 2: Fetch from AN API
const url = 'https://api.actionnetwork.com/web/v1/scoreboard/mlb?period=game&bookIds=68&date=20260325';
console.log(`${TAG}[STEP] Fetching AN API: ${url}`);
const res = await axios.get(url, { headers: AN_HEADERS, timeout: 15000 });
const games = res.data.games || [];
console.log(`${TAG}[STATE] AN API returned ${games.length} games for Mar 25`);

if (games.length === 0) {
  console.error(`${TAG}[ERROR] No games returned from AN API for Mar 25`);
  process.exit(1);
}

for (const game of games) {
  const teams = game.teams || [];

  // Use authoritative away_team_id / home_team_id
  let awayTeam = teams.find(t => t.id === game.away_team_id);
  let homeTeam = teams.find(t => t.id === game.home_team_id);

  if (!awayTeam || !homeTeam) {
    console.warn(`${TAG}[WARN] id-based lookup failed, falling back to positional`);
    awayTeam = teams[0];
    homeTeam = teams[1];
  }

  console.log(`${TAG}[STATE] game=${game.id} | away=${awayTeam?.abbr}(id=${game.away_team_id}) home=${homeTeam?.abbr}(id=${game.home_team_id})`);

  // Find odds via fallback chain
  const oddsList = game.odds || [];
  let dk = null;
  let usedBook = null;
  for (const bookId of BOOK_FALLBACK) {
    dk = oddsList.find(o => o.book_id === bookId) || null;
    if (dk) { usedBook = bookId; break; }
  }
  console.log(`${TAG}[STATE] Odds: book=${usedBook} ml_away=${dk?.ml_away} ml_home=${dk?.ml_home} spread_away=${dk?.spread_away} total=${dk?.total}`);

  const bs = game.boxscore || {};
  const awayScore = bs.total_away_points ?? null;
  const homeScore = bs.total_home_points ?? null;
  const spreadAway = dk?.spread_away ?? null;
  const spreadHome = dk?.spread_home ?? null;
  const total = dk?.total ?? null;

  // Derive results
  const awayRunLineCovered = (awayScore != null && homeScore != null && spreadAway != null)
    ? (awayScore + spreadAway > homeScore) : null;
  const homeRunLineCovered = (awayScore != null && homeScore != null && spreadHome != null)
    ? (homeScore + spreadHome > awayScore) : null;
  let totalResult = null;
  if (awayScore != null && homeScore != null && total != null) {
    const combined = awayScore + homeScore;
    totalResult = combined > total ? 'OVER' : combined < total ? 'UNDER' : 'PUSH';
  }
  const awayWon = (awayScore != null && homeScore != null) ? (awayScore > homeScore) : null;
  const gameDate = utcToEstDate(game.start_time);
  const gameStatus = (game.status === 'complete' || game.real_status === 'complete') ? 'complete' : game.status;

  console.log(`${TAG}[STATE] Derived: awayScore=${awayScore} homeScore=${homeScore} awayWon=${awayWon} RL=${awayRunLineCovered} total=${totalResult}`);

  const row = {
    gameId: String(game.id),
    gameDate,
    gameStatus,
    awaySlug: awayTeam?.url_slug || null,
    homeSlug: homeTeam?.url_slug || null,
    awayAbbr: awayTeam?.abbr || null,
    homeAbbr: homeTeam?.abbr || null,
    awayScore,
    homeScore,
    awayWon: awayWon === null ? null : (awayWon ? 1 : 0),
    dkAwayML: fmtOdds(dk?.ml_away),
    dkHomeML: fmtOdds(dk?.ml_home),
    dkAwayRunLine: fmtLine(spreadAway),
    dkAwayRunLineOdds: fmtOdds(dk?.spread_away_line),
    dkHomeRunLine: fmtLine(spreadHome),
    dkHomeRunLineOdds: fmtOdds(dk?.spread_home_line),
    dkTotal: total != null ? String(total) : null,
    dkOverOdds: fmtOdds(dk?.over),
    dkUnderOdds: fmtOdds(dk?.under),
    awayRunLineCovered: awayRunLineCovered === null ? null : (awayRunLineCovered ? 1 : 0),
    homeRunLineCovered: homeRunLineCovered === null ? null : (homeRunLineCovered ? 1 : 0),
    totalResult,
  };

  await conn.execute(`
    INSERT INTO mlb_schedule_history
      (gameId, gameDate, gameStatus, awaySlug, homeSlug, awayAbbr, homeAbbr,
       awayScore, homeScore, awayWon,
       dkAwayML, dkHomeML, dkAwayRunLine, dkAwayRunLineOdds, dkHomeRunLine, dkHomeRunLineOdds,
       dkTotal, dkOverOdds, dkUnderOdds,
       awayRunLineCovered, homeRunLineCovered, totalResult)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      gameStatus=VALUES(gameStatus), awaySlug=VALUES(awaySlug), homeSlug=VALUES(homeSlug),
      awayAbbr=VALUES(awayAbbr), homeAbbr=VALUES(homeAbbr),
      awayScore=VALUES(awayScore), homeScore=VALUES(homeScore), awayWon=VALUES(awayWon),
      dkAwayML=VALUES(dkAwayML), dkHomeML=VALUES(dkHomeML),
      dkAwayRunLine=VALUES(dkAwayRunLine), dkAwayRunLineOdds=VALUES(dkAwayRunLineOdds),
      dkHomeRunLine=VALUES(dkHomeRunLine), dkHomeRunLineOdds=VALUES(dkHomeRunLineOdds),
      dkTotal=VALUES(dkTotal), dkOverOdds=VALUES(dkOverOdds), dkUnderOdds=VALUES(dkUnderOdds),
      awayRunLineCovered=VALUES(awayRunLineCovered), homeRunLineCovered=VALUES(homeRunLineCovered),
      totalResult=VALUES(totalResult)
  `, [row.gameId, row.gameDate, row.gameStatus, row.awaySlug, row.homeSlug, row.awayAbbr, row.homeAbbr,
      row.awayScore, row.homeScore, row.awayWon,
      row.dkAwayML, row.dkHomeML, row.dkAwayRunLine, row.dkAwayRunLineOdds, row.dkHomeRunLine, row.dkHomeRunLineOdds,
      row.dkTotal, row.dkOverOdds, row.dkUnderOdds,
      row.awayRunLineCovered, row.homeRunLineCovered, row.totalResult]);

  console.log(`${TAG}[OUTPUT] Upserted game=${game.id} | away=${row.awaySlug} home=${row.homeSlug}`);
}

// Step 3: Verify
const [after] = await conn.execute(
  `SELECT awaySlug, homeSlug, awayScore, homeScore, awayWon, dkAwayML FROM mlb_schedule_history WHERE gameDate='2026-03-25'`
);
console.log(`${TAG}[VERIFY] After fix: ${JSON.stringify(after[0])}`);

const fixed = after[0];
const pass = fixed.awaySlug === 'new-york-yankees' && fixed.homeSlug === 'san-francisco-giants';
console.log(`${TAG}[VERIFY] ${pass ? '✅ PASS' : '❌ FAIL'} — awaySlug=${fixed.awaySlug} homeSlug=${fixed.homeSlug}`);
if (!pass) {
  console.error(`${TAG}[ERROR] Expected awaySlug=new-york-yankees homeSlug=san-francisco-giants`);
  process.exit(1);
}

await conn.end();
console.log(`${TAG}[OUTPUT] Mar 25 home/away corrected successfully`);

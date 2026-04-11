/**
 * validate_all_teams.mjs
 *
 * Full 30-team validation audit after the home/away backfill fix.
 * For each team, computes:
 *   - Overall SU W-L
 *   - Home SU W-L
 *   - Away SU W-L
 *   - Last 10 SU W-L
 *   - Overall ATS W-L
 *   - Overall O/U W-L-P
 *   - Favorite SU W-L
 *   - Underdog SU W-L
 *
 * Also cross-checks ARI specifically against the user-provided data:
 *   Home: 3-0, Away: 0-3 (first 6 games)
 *
 * Run: DATABASE_URL=... node scripts/validate_all_teams.mjs
 */

import { createConnection } from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('[FATAL] DATABASE_URL not set'); process.exit(1); }

const conn = await createConnection(DATABASE_URL);
const SEASON_START = '2026-03-26';

// All 30 MLB team slugs
const TEAMS = [
  { slug: 'arizona-diamondbacks',  abbr: 'ARI' },
  { slug: 'atlanta-braves',        abbr: 'ATL' },
  { slug: 'baltimore-orioles',     abbr: 'BAL' },
  { slug: 'boston-red-sox',        abbr: 'BOS' },
  { slug: 'chicago-cubs',          abbr: 'CHC' },
  { slug: 'chicago-white-sox',     abbr: 'CWS' },
  { slug: 'cincinnati-reds',       abbr: 'CIN' },
  { slug: 'cleveland-guardians',   abbr: 'CLE' },
  { slug: 'colorado-rockies',      abbr: 'COL' },
  { slug: 'detroit-tigers',        abbr: 'DET' },
  { slug: 'houston-astros',        abbr: 'HOU' },
  { slug: 'kansas-city-royals',    abbr: 'KC'  },
  { slug: 'los-angeles-angels',    abbr: 'LAA' },
  { slug: 'los-angeles-dodgers',   abbr: 'LAD' },
  { slug: 'miami-marlins',         abbr: 'MIA' },
  { slug: 'milwaukee-brewers',     abbr: 'MIL' },
  { slug: 'minnesota-twins',       abbr: 'MIN' },
  { slug: 'new-york-mets',         abbr: 'NYM' },
  { slug: 'new-york-yankees',      abbr: 'NYY' },
  { slug: 'oakland-athletics',     abbr: 'ATH' },
  { slug: 'philadelphia-phillies', abbr: 'PHI' },
  { slug: 'pittsburgh-pirates',    abbr: 'PIT' },
  { slug: 'san-diego-padres',      abbr: 'SD'  },
  { slug: 'san-francisco-giants',  abbr: 'SF'  },
  { slug: 'seattle-mariners',      abbr: 'SEA' },
  { slug: 'st-louis-cardinals',    abbr: 'STL' },  // normalized (no period)
  { slug: 'tampa-bay-rays',        abbr: 'TB'  },
  { slug: 'texas-rangers',         abbr: 'TEX' },
  { slug: 'toronto-blue-jays',     abbr: 'TOR' },
  { slug: 'washington-nationals',  abbr: 'WSH' },
];

function boolVal(v) {
  if (v === true || v === 1) return true;
  if (Buffer.isBuffer(v) && v[0] === 1) return true;
  return false;
}

console.log('═══════════════════════════════════════════════════════════════════════════════════');
console.log('[VALIDATE] Full 30-Team MLB TRENDS Audit — Post Home/Away Fix');
console.log(`[VALIDATE] Season filter: gameDate >= ${SEASON_START}, gameStatus = complete`);
console.log('═══════════════════════════════════════════════════════════════════════════════════');
console.log('');
console.log(`${'TEAM'.padEnd(5)} ${'G'.padEnd(3)} ${'HOME'.padEnd(7)} ${'AWAY'.padEnd(7)} ${'OVERALL'.padEnd(8)} ${'L10'.padEnd(7)} ${'FAV'.padEnd(7)} ${'DOG'.padEnd(7)} ${'ATS'.padEnd(7)} ${'O/U'.padEnd(9)}`);
console.log(`${'─'.repeat(5)} ${'─'.repeat(3)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(8)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(9)}`);

let teamsWithNoData = [];

for (const team of TEAMS) {
  const [rows] = await conn.query(`
    SELECT 
      awaySlug, homeSlug, awayScore, homeScore, awayWon,
      awayRunLineCovered, homeRunLineCovered,
      dkAwayML, dkHomeML, totalResult
    FROM mlb_schedule_history
    WHERE gameDate >= ? AND gameStatus = 'complete'
      AND (awaySlug = ? OR homeSlug = ?)
    ORDER BY gameDate DESC
    LIMIT 162
  `, [SEASON_START, team.slug, team.slug]);

  if (rows.length === 0) {
    teamsWithNoData.push(team.abbr);
    console.log(`${team.abbr.padEnd(5)} ${'0'.padEnd(3)} ${'—'.padEnd(7)} ${'—'.padEnd(7)} ${'—'.padEnd(8)} ${'—'.padEnd(7)} ${'—'.padEnd(7)} ${'—'.padEnd(7)} ${'—'.padEnd(7)} ${'—'.padEnd(9)} ⚠️ NO DATA`);
    continue;
  }

  let homeW=0,homeL=0,awayW=0,awayL=0;
  let overallW=0,overallL=0;
  let favW=0,favL=0,dogW=0,dogL=0;
  let atsW=0,atsL=0;
  let ouW=0,ouL=0,ouP=0;

  for (const g of rows) {
    const isAway = g.awaySlug === team.slug;
    const aw = boolVal(g.awayWon);
    const won = g.awayWon != null ? (isAway ? aw : !aw) : null;
    const ml = isAway ? g.dkAwayML : g.dkHomeML;
    const isFav = ml != null && parseInt(ml, 10) < 0;
    const covered = isAway
      ? (g.awayRunLineCovered != null ? boolVal(g.awayRunLineCovered) : null)
      : (g.homeRunLineCovered != null ? boolVal(g.homeRunLineCovered) : null);

    if (won === true)  { overallW++; isAway ? awayW++ : homeW++; isFav ? favW++ : dogW++; }
    if (won === false) { overallL++; isAway ? awayL++ : homeL++; isFav ? favL++ : dogL++; }
    if (covered === true)  atsW++;
    if (covered === false) atsL++;
    if (g.totalResult === 'OVER')  ouW++;
    if (g.totalResult === 'UNDER') ouL++;
    if (g.totalResult === 'PUSH')  ouP++;
  }

  const last10 = rows.slice(0, 10);
  let l10W=0,l10L=0;
  for (const g of last10) {
    const isAway = g.awaySlug === team.slug;
    const aw = boolVal(g.awayWon);
    const won = g.awayWon != null ? (isAway ? aw : !aw) : null;
    if (won === true)  l10W++;
    if (won === false) l10L++;
  }

  const ouStr = ouP > 0 ? `${ouW}-${ouL}-${ouP}` : `${ouW}-${ouL}`;
  
  console.log(`${team.abbr.padEnd(5)} ${String(rows.length).padEnd(3)} ${(homeW+'-'+homeL).padEnd(7)} ${(awayW+'-'+awayL).padEnd(7)} ${(overallW+'-'+overallL).padEnd(8)} ${(l10W+'-'+l10L).padEnd(7)} ${(favW+'-'+favL).padEnd(7)} ${(dogW+'-'+dogL).padEnd(7)} ${(atsW+'-'+atsL).padEnd(7)} ${ouStr.padEnd(9)}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════════════════════════');
console.log('[VALIDATE] ARI DEEP-DIVE: Cross-check against user-provided data');
console.log('  User reports: Home 3-0, Away 0-3 (first 6 games: 3 at LAD + 3 vs DET)');
console.log('═══════════════════════════════════════════════════════════════════════════════════');

const [ariRows] = await conn.query(`
  SELECT gameDate, awaySlug, homeSlug, awayAbbr, homeAbbr, awayScore, homeScore, awayWon
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND (awaySlug = 'arizona-diamondbacks' OR homeSlug = 'arizona-diamondbacks')
  ORDER BY gameDate ASC
`, [SEASON_START]);

console.log(`\n[VALIDATE][ARI] All ${ariRows.length} completed games:\n`);
console.log(`  ${'DATE'.padEnd(12)} ${'MATCHUP'.padEnd(12)} ${'SCORE'.padEnd(10)} ${'ARI_ROLE'.padEnd(10)} ${'ARI_SCORE'.padEnd(11)} ${'RESULT'}`);
console.log(`  ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(11)} ${'─'.repeat(6)}`);

let ariHomeW=0,ariHomeL=0,ariAwayW=0,ariAwayL=0;
for (const g of ariRows) {
  const isAway = g.awaySlug === 'arizona-diamondbacks';
  const aw = boolVal(g.awayWon);
  const ariWon = g.awayWon != null ? (isAway ? aw : !aw) : null;
  const role = isAway ? 'AWAY' : 'HOME';
  const ariScore = isAway ? g.awayScore : g.homeScore;
  const oppScore = isAway ? g.homeScore : g.awayScore;
  const opp = isAway ? g.homeAbbr : g.awayAbbr;
  const result = ariWon === true ? 'W' : ariWon === false ? 'L' : '?';
  
  if (isAway) { ariWon ? ariAwayW++ : ariAwayL++; }
  else { ariWon ? ariHomeW++ : ariHomeL++; }
  
  console.log(`  ${g.gameDate.padEnd(12)} ${'ARI vs '+opp.padEnd(12)} ${String(ariScore)+'-'+String(oppScore).padEnd(10)} ${role.padEnd(10)} ${String(ariScore).padEnd(11)} ${result}`);
}

console.log(`\n[VALIDATE][ARI] SUMMARY:`);
console.log(`  Home: ${ariHomeW}-${ariHomeL} (expected: 3-0 after first 3 home games)`);
console.log(`  Away: ${ariAwayW}-${ariAwayL} (expected: 0-3 after first 3 away games at LAD)`);
console.log(`  Overall: ${ariHomeW+ariAwayW}-${ariHomeL+ariAwayL}`);

const homeOk = ariHomeW >= 3 && ariHomeL === 0;
const awayOk = ariAwayL >= 3 && ariAwayW === 0;
console.log(`\n  Home 3-0 check: ${homeOk ? '✅ PASS' : '⚠️  FAIL — expected ≥3W-0L'}`);
console.log(`  Away 0-3 check: ${awayOk ? '✅ PASS' : '⚠️  FAIL — expected 0W-≥3L'}`);

if (teamsWithNoData.length > 0) {
  console.log(`\n[VALIDATE] ⚠️  Teams with NO data: ${teamsWithNoData.join(', ')}`);
} else {
  console.log(`\n[VALIDATE] ✅ All 30 teams have data`);
}

await conn.end();
console.log('\n[VALIDATE][DONE] Full 30-team audit complete.');

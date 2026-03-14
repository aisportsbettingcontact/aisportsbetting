/**
 * Deep audit of March 13 NCAAM games vs NCAA.com ground truth.
 * Checks: presence, status, scores, odds, and fixes issues.
 */
import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });

// Ground truth from NCAA.com
const NCAA_D1_GAMES = [
  // LIVE (at time of snapshot)
  { status: 'live', away: 'seton_hall', home: 'st_johns', awayScore: 59, homeScore: 69, clock: '02:08 2nd', network: 'FOX' },
  { status: 'live', away: 's_carolina_st', home: 'howard', awayScore: 46, homeScore: 55, clock: '08:04 2nd', network: 'ESPN+' },
  { status: 'live', away: 'iowa_st', home: 'arizona', awayScore: 31, homeScore: 28, clock: '04:48 1st', network: 'ESPN' },
  { status: 'live', away: 'purdue', home: 'nebraska', awayScore: 48, homeScore: 31, clock: '16:20 2nd', network: 'BIGTEN' },
  { status: 'live', away: 'miami_fl', home: 'virginia', awayScore: 17, homeScore: 21, clock: '03:54 1st', network: 'ESPN2' },
  { status: 'live', away: 'mississippi', home: 'alabama', awayScore: 14, homeScore: 14, clock: '13:43 1st', network: 'SEC Network' },
  // UPCOMING
  { status: 'upcoming', away: 'csu_northridge', home: 'uc_irvine', clock: '6:00 PM PDT', network: 'ESPNU' },
  { status: 'upcoming', away: 'texas_arlington', home: 'utah_valley', clock: '6:00 PM PDT', network: 'ESPN+' },
  { status: 'upcoming', away: 'clemson', home: 'duke', clock: '6:30 PM PDT', network: 'ESPN2' },
  { status: 'upcoming', away: 'nevada', home: 'utah_st', clock: '6:30 PM PDT', network: 'CBSSPORTS' },
  { status: 'upcoming', away: 'kent', home: 'akron', clock: '4:30 PM PDT', network: 'CBSSPORTS' },
  { status: 'upcoming', away: 'georgetown', home: 'connecticut', clock: '5:00 PM PDT', network: 'FS1' },
  { status: 'upcoming', away: 'southern_u', home: 'florida_a_and_m', clock: '5:30 PM PDT', network: 'ESPN+' },
  { status: 'upcoming', away: 'kansas', home: 'houston', clock: '6:30 PM PDT', network: 'ESPN' },
  { status: 'upcoming', away: 'csu_fullerton', home: 'hawaii', clock: '8:30 PM PDT', network: 'ESPN2' },
  { status: 'upcoming', away: 'utah_tech', home: 'california_baptist', clock: '8:30 PM PDT', network: 'ESPN+' },
  { status: 'upcoming', away: 'davidson', home: 'st_josephs', clock: '4:30 PM PDT', network: 'CNBC' },
  { status: 'upcoming', away: 'delaware_st', home: 'nc_central', clock: '5:00 PM PDT', network: 'ESPN+' },
  { status: 'upcoming', away: 'ucla', home: 'michigan_st', clock: '6:00 PM PDT', network: 'BIGTEN' },
  { status: 'upcoming', away: 'oklahoma', home: 'arkansas', clock: '6:30 PM PDT', network: 'SEC Network' },
  // FINAL
  { status: 'final', away: 'george_washington', home: 'saint_louis', awayScore: 81, homeScore: 88 },
  { status: 'final', away: 'ohio_st', home: 'michigan', awayScore: 67, homeScore: 71 },
  { status: 'final', away: 'kentucky', home: 'florida', awayScore: 63, homeScore: 71 },
  { status: 'final', away: 'kennesaw_st', home: 'sam_houston_st', awayScore: 79, homeScore: 73 },
  { status: 'final', away: 'duquesne', home: 'va_commonwealth', awayScore: 66, homeScore: 71 },
  { status: 'final', away: 'north_texas', home: 'tulsa', awayScore: 84, homeScore: 90 },
  { status: 'final', away: 'missouri_st', home: 'louisiana_tech', awayScore: 66, homeScore: 69 },
  { status: 'final', away: 'charlotte', home: 'uab', awayScore: 83, homeScore: 78 },
  { status: 'final', away: 'st_bonaventure', home: 'dayton', awayScore: 63, homeScore: 68 },
  { status: 'final', away: 'wisconsin', home: 'illinois', awayScore: 91, homeScore: 88 },
  { status: 'final', away: 'tennessee', home: 'vanderbilt', awayScore: 68, homeScore: 75 },
  { status: 'final', away: 'massachusetts', home: 'toledo', awayScore: 67, homeScore: 77 },
  { status: 'final', away: 'prairie_view_a_and_m', home: 'alabama_a_and_m', awayScore: 74, homeScore: 55 },
];

console.log('\n' + '='.repeat(80));
console.log('DEEP AUDIT: March 13 NCAAM Games vs NCAA.com Ground Truth');
console.log('='.repeat(80));
console.log(`NCAA.com D1 games: ${NCAA_D1_GAMES.length} (LIVE:6, UPCOMING:14, FINAL:13)`);

// Fetch all NCAAM games for March 13 from DB
const [dbRows] = await pool.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, gameStatus, 
          awayScore, homeScore, gameClock,
          awayBookSpread, homeBookSpread, bookTotal, 
          awaySpreadOdds, homeSpreadOdds, overOdds, underOdds,
          awayML, homeML, publishedToFeed, sortOrder
   FROM games 
   WHERE sport='NCAAM' AND gameDate='2026-03-13' 
   ORDER BY sortOrder, startTimeEst`
);

console.log(`\nDB games for 2026-03-13: ${dbRows.length}`);
console.log('-'.repeat(80));

// Build lookup maps
const dbByKey = new Map();
for (const row of dbRows) {
  dbByKey.set(`${row.awayTeam}@${row.homeTeam}`, row);
}

const ncaaByKey = new Map();
for (const g of NCAA_D1_GAMES) {
  ncaaByKey.set(`${g.away}@${g.home}`, g);
}

// ===== CHECK 1: Missing games (in NCAA.com but not in DB) =====
console.log('\n[CHECK 1] MISSING GAMES (NCAA.com has them, DB does not):');
let missingCount = 0;
for (const g of NCAA_D1_GAMES) {
  const key = `${g.away}@${g.home}`;
  if (!dbByKey.has(key)) {
    console.log(`  ❌ MISSING: [${g.status.toUpperCase()}] ${g.away} @ ${g.home}`);
    missingCount++;
  }
}
if (missingCount === 0) console.log('  ✅ All 33 D1 games are present in DB');

// ===== CHECK 2: Extra games (in DB but not on NCAA.com March 13) =====
console.log('\n[CHECK 2] EXTRA GAMES IN DB (not on NCAA.com March 13):');
let extraCount = 0;
for (const row of dbRows) {
  const key = `${row.awayTeam}@${row.homeTeam}`;
  if (!ncaaByKey.has(key)) {
    console.log(`  ⚠️  EXTRA: ${row.awayTeam} @ ${row.homeTeam} | status:${row.gameStatus} | id:${row.id}`);
    extraCount++;
  }
}
if (extraCount === 0) console.log('  ✅ No extra games in DB');

// ===== CHECK 3: Score accuracy for FINAL games =====
console.log('\n[CHECK 3] SCORE ACCURACY (FINAL games):');
let scoreErrors = 0;
for (const g of NCAA_D1_GAMES.filter(g => g.status === 'final')) {
  const key = `${g.away}@${g.home}`;
  const row = dbByKey.get(key);
  if (!row) continue;
  
  const dbAway = row.awayScore;
  const dbHome = row.homeScore;
  const dbStatus = row.gameStatus;
  
  const scoreOk = dbAway === g.awayScore && dbHome === g.homeScore;
  const statusOk = dbStatus === 'final';
  
  if (!scoreOk || !statusOk) {
    console.log(`  ❌ ${g.away} @ ${g.home}:`);
    if (!scoreOk) console.log(`     Score: DB=${dbAway}-${dbHome}, NCAA=${g.awayScore}-${g.homeScore}`);
    if (!statusOk) console.log(`     Status: DB=${dbStatus}, expected=final`);
    scoreErrors++;
  } else {
    console.log(`  ✅ ${g.away} @ ${g.home}: ${dbAway}-${dbHome} FINAL`);
  }
}

// ===== CHECK 4: Live game scores and status =====
console.log('\n[CHECK 4] LIVE GAME STATUS & SCORES:');
for (const g of NCAA_D1_GAMES.filter(g => g.status === 'live')) {
  const key = `${g.away}@${g.home}`;
  const row = dbByKey.get(key);
  if (!row) continue;
  
  const scoreOk = row.awayScore === g.awayScore && row.homeScore === g.homeScore;
  const statusOk = row.gameStatus === 'live';
  
  const scoreStr = `${row.awayScore ?? '?'}-${row.homeScore ?? '?'}`;
  const ncaaScore = `${g.awayScore}-${g.homeScore}`;
  
  if (!statusOk) {
    console.log(`  ❌ ${g.away} @ ${g.home}: Status=${row.gameStatus} (expected live), Score=${scoreStr}`);
  } else if (!scoreOk) {
    console.log(`  ⚠️  ${g.away} @ ${g.home}: LIVE ✓ | Score DB=${scoreStr} vs NCAA=${ncaaScore} (may have updated)`);
  } else {
    console.log(`  ✅ ${g.away} @ ${g.home}: LIVE | ${scoreStr} | clock:${row.gameClock ?? 'N/A'}`);
  }
}

// ===== CHECK 5: Upcoming game status =====
console.log('\n[CHECK 5] UPCOMING GAME STATUS:');
for (const g of NCAA_D1_GAMES.filter(g => g.status === 'upcoming')) {
  const key = `${g.away}@${g.home}`;
  const row = dbByKey.get(key);
  if (!row) continue;
  
  const statusOk = row.gameStatus === 'upcoming';
  if (!statusOk) {
    console.log(`  ❌ ${g.away} @ ${g.home}: Status=${row.gameStatus} (expected upcoming)`);
  } else {
    console.log(`  ✅ ${g.away} @ ${g.home}: upcoming | time:${row.startTimeEst}`);
  }
}

// ===== CHECK 6: Odds coverage =====
console.log('\n[CHECK 6] ODDS COVERAGE (awayBookSpread populated):');
let oddsCount = 0;
let noOddsCount = 0;
for (const g of NCAA_D1_GAMES) {
  const key = `${g.away}@${g.home}`;
  const row = dbByKey.get(key);
  if (!row) continue;
  
  if (row.awayBookSpread !== null) {
    oddsCount++;
    const spreadStr = `${row.awayBookSpread}(${row.awaySpreadOdds ?? 'null'}) / ${row.homeBookSpread}(${row.homeSpreadOdds ?? 'null'})`;
    const totalStr = `${row.bookTotal}(o:${row.overOdds ?? 'null'}/u:${row.underOdds ?? 'null'})`;
    const mlStr = `${row.awayML ?? 'null'}/${row.homeML ?? 'null'}`;
    console.log(`  ✅ [${g.status.toUpperCase()}] ${g.away} @ ${g.home}: spread=${spreadStr} | total=${totalStr} | ML=${mlStr}`);
  } else {
    noOddsCount++;
    const mlStr = `${row.awayML ?? 'null'}/${row.homeML ?? 'null'}`;
    console.log(`  ⚠️  [${g.status.toUpperCase()}] ${g.away} @ ${g.home}: NO SPREAD/TOTAL | ML=${mlStr}`);
  }
}
console.log(`\n  Odds coverage: ${oddsCount}/${NCAA_D1_GAMES.length} games have spread/total`);
console.log(`  Games with ML only: ${noOddsCount}`);

// ===== CHECK 7: publishedToFeed =====
console.log('\n[CHECK 7] publishedToFeed STATUS:');
let notPublished = [];
for (const row of dbRows) {
  if (!ncaaByKey.has(`${row.awayTeam}@${row.homeTeam}`)) continue;
  if (!row.publishedToFeed) {
    notPublished.push(`${row.awayTeam} @ ${row.homeTeam}`);
  }
}
if (notPublished.length === 0) {
  console.log('  ✅ All D1 games are published to feed');
} else {
  console.log(`  ⚠️  ${notPublished.length} games NOT published to feed:`);
  notPublished.forEach(g => console.log(`    - ${g}`));
}

// ===== SUMMARY =====
console.log('\n' + '='.repeat(80));
console.log('AUDIT SUMMARY');
console.log('='.repeat(80));
console.log(`Total D1 games on NCAA.com: 33`);
console.log(`Total D1 games in DB: ${dbRows.filter(r => ncaaByKey.has(`${r.awayTeam}@${r.homeTeam}`)).length}`);
console.log(`Missing from DB: ${missingCount}`);
console.log(`Extra in DB (not on NCAA.com): ${extraCount}`);
console.log(`Score errors (FINAL): ${scoreErrors}`);
console.log(`Games with spread/total odds: ${oddsCount}/33`);
console.log(`Games not published to feed: ${notPublished.length}`);

await pool.end();

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });

// NCAA.com March 13 D1 games (from our scrape)
const ncaaGames = [
  // LIVE
  { away: 'iowa_st', home: 'arizona', status: 'live' },
  { away: 'purdue', home: 'nebraska', status: 'live' },
  { away: 'mississippi', home: 'alabama', status: 'live' },
  { away: 'seton_hall', home: 'st_johns', status: 'live' },
  { away: 's_carolina_st', home: 'howard', status: 'live' },
  { away: 'miami_fl', home: 'virginia', status: 'live' },
  // UPCOMING
  { away: 'ucla', home: 'michigan_st', status: 'upcoming' },
  { away: 'oklahoma', home: 'arkansas', status: 'upcoming' },
  { away: 'kent', home: 'akron', status: 'upcoming' },
  { away: 'davidson', home: 'st_josephs', status: 'upcoming' },
  { away: 'delaware_st', home: 'nc_central', status: 'upcoming' },
  { away: 'georgetown', home: 'connecticut', status: 'upcoming' },
  { away: 'southern_u', home: 'florida_a_and_m', status: 'upcoming' },
  { away: 'csu_northridge', home: 'uc_irvine', status: 'upcoming' },
  { away: 'texas_arlington', home: 'utah_valley', status: 'upcoming' },
  { away: 'clemson', home: 'duke', status: 'upcoming' },
  { away: 'kansas', home: 'houston', status: 'upcoming' },
  { away: 'nevada', home: 'utah_st', status: 'upcoming' },
  { away: 'utah_tech', home: 'california_baptist', status: 'upcoming' },
  { away: 'csu_fullerton', home: 'hawaii', status: 'upcoming' },
  // FINAL
  { away: 'george_washington', home: 'saint_louis', status: 'final' },
  { away: 'ohio_st', home: 'michigan', status: 'final' },
  { away: 'kennesaw_st', home: 'sam_houston_st', status: 'final' },
  { away: 'duquesne', home: 'va_commonwealth', status: 'final' },
  { away: 'north_texas', home: 'tulsa', status: 'final' },
  { away: 'missouri_st', home: 'louisiana_tech', status: 'final' },
  { away: 'charlotte', home: 'uab', status: 'final' },
  { away: 'st_bonaventure', home: 'dayton', status: 'final' },
  { away: 'wisconsin', home: 'illinois', status: 'final' },
  { away: 'tennessee', home: 'vanderbilt', status: 'final' },
  { away: 'massachusetts', home: 'toledo', status: 'final' },
  { away: 'prairie_view_a_and_m', home: 'alabama_a_and_m', status: 'final' },
  { away: 'kentucky', home: 'florida', status: 'final' },
];

const [dbRows] = await pool.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, gameStatus, awayScore, homeScore, 
          awayBookSpread, homeBookSpread, bookTotal, awaySpreadOdds, homeSpreadOdds, overOdds, underOdds,
          awayML, homeML, publishedToFeed
   FROM games WHERE sport='NCAAM' AND gameDate='2026-03-13' ORDER BY sortOrder, startTimeEst`
);

console.log(`\n=== DB has ${dbRows.length} NCAAM games for 2026-03-13 ===`);
console.log(`=== NCAA.com has ${ncaaGames.length} D1 games for March 13 ===\n`);

// Check for extra games in DB not on NCAA.com
const dbGameKeys = new Set(dbRows.map(r => `${r.awayTeam}@${r.homeTeam}`));
const ncaaGameKeys = new Set(ncaaGames.map(g => `${g.away}@${g.home}`));

console.log('--- EXTRA IN DB (not on NCAA.com March 13) ---');
for (const r of dbRows) {
  const key = `${r.awayTeam}@${r.homeTeam}`;
  if (!ncaaGameKeys.has(key)) {
    console.log(`  EXTRA: ${r.awayTeam} @ ${r.homeTeam} | date:${r.gameDate} | status:${r.gameStatus}`);
  }
}

console.log('\n--- MISSING FROM DB (on NCAA.com but not in DB) ---');
for (const g of ncaaGames) {
  const key = `${g.away}@${g.home}`;
  if (!dbGameKeys.has(key)) {
    console.log(`  MISSING: ${g.away} @ ${g.home} | expected status:${g.status}`);
  }
}

console.log('\n--- GAMES WITH NO ODDS (awayBookSpread IS NULL) ---');
for (const r of dbRows) {
  if (!r.awayBookSpread && ncaaGameKeys.has(`${r.awayTeam}@${r.homeTeam}`)) {
    console.log(`  NO-ODDS: [${r.gameStatus}] ${r.awayTeam} @ ${r.homeTeam} | score:${r.awayScore}-${r.homeScore} | ML:${r.awayML}/${r.homeML}`);
  }
}

console.log('\n--- GAMES WITH ODDS (awayBookSpread IS NOT NULL) ---');
for (const r of dbRows) {
  if (r.awayBookSpread) {
    console.log(`  OK: [${r.gameStatus}] ${r.awayTeam} @ ${r.homeTeam} | spread:${r.awayBookSpread}(${r.awaySpreadOdds}) | total:${r.bookTotal}(${r.overOdds}) | ML:${r.awayML}/${r.homeML}`);
  }
}

console.log('\n--- SCORE ACCURACY CHECK (FINAL games) ---');
const finalGames = [
  { away: 'george_washington', home: 'saint_louis', awayScore: 81, homeScore: 88 },
  { away: 'ohio_st', home: 'michigan', awayScore: 67, homeScore: 71 },
  { away: 'kennesaw_st', home: 'sam_houston_st', awayScore: 79, homeScore: 73 },
  { away: 'duquesne', home: 'va_commonwealth', awayScore: 66, homeScore: 71 },
  { away: 'north_texas', home: 'tulsa', awayScore: 84, homeScore: 90 },
  { away: 'missouri_st', home: 'louisiana_tech', awayScore: 66, homeScore: 69 },
  { away: 'charlotte', home: 'uab', awayScore: 83, homeScore: 78 },
  { away: 'st_bonaventure', home: 'dayton', awayScore: 63, homeScore: 68 },
  { away: 'wisconsin', home: 'illinois', awayScore: 91, homeScore: 88 },
  { away: 'tennessee', home: 'vanderbilt', awayScore: 68, homeScore: 75 },
  { away: 'massachusetts', home: 'toledo', awayScore: 67, homeScore: 77 },
  { away: 'prairie_view_a_and_m', home: 'alabama_a_and_m', awayScore: 74, homeScore: 55 },
  { away: 'kentucky', home: 'florida', awayScore: 63, homeScore: 71 },
];

for (const expected of finalGames) {
  const dbGame = dbRows.find(r => r.awayTeam === expected.away && r.homeTeam === expected.home);
  if (!dbGame) {
    console.log(`  MISSING: ${expected.away} @ ${expected.home}`);
  } else if (dbGame.awayScore !== expected.awayScore || dbGame.homeScore !== expected.homeScore) {
    console.log(`  SCORE MISMATCH: ${expected.away} @ ${expected.home} | DB:${dbGame.awayScore}-${dbGame.homeScore} | NCAA:${expected.awayScore}-${expected.homeScore}`);
  } else {
    console.log(`  OK: ${expected.away} @ ${expected.home} | ${dbGame.awayScore}-${dbGame.homeScore} ✓`);
  }
}

await pool.end();

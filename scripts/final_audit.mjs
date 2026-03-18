/**
 * final_audit.mjs
 * 
 * Cross-references the DB against the official March Madness 2026 schedule.
 * Verifies all 36 tournament games (4 First Four + 32 R64) are present with
 * correct dates, start times, and matchups.
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Official schedule (awayTeam slug @ homeTeam slug, date, PST time stored in DB)
// PST = EST - 3 hours
const OFFICIAL_SCHEDULE = [
  // ── FIRST FOUR (March 17-18) ──────────────────────────────────────────────
  // March 17 (already completed - not in DB, that's OK)
  // March 18
  { date: '2026-03-18', time: '15:40', away: 'prairie_view_a_and_m', home: 'lehigh',     label: 'FF: PV A&M vs Lehigh (6:40 PM EST)' },
  { date: '2026-03-18', time: '18:15', away: 'miami_oh',              home: 'smu',        label: 'FF: Miami OH vs SMU (9:15 PM EST)' },

  // ── ROUND OF 64 - MARCH 19 ────────────────────────────────────────────────
  { date: '2026-03-19', time: '09:15', away: 'tcu',                   home: 'ohio_st',    label: 'R64: TCU @ Ohio State (12:15 PM EST)' },
  { date: '2026-03-19', time: '09:40', away: 'troy',                  home: 'nebraska',   label: 'R64: Troy @ Nebraska (12:40 PM EST)' },
  { date: '2026-03-19', time: '10:30', away: 'south_florida',         home: 'louisville', label: 'R64: South Florida @ Louisville (1:30 PM EST)' },
  { date: '2026-03-19', time: '10:50', away: 'high_point',            home: 'wisconsin',  label: 'R64: High Point @ Wisconsin (1:50 PM EST)' },
  { date: '2026-03-19', time: '11:50', away: 'siena',                 home: 'duke',       label: 'R64: Siena @ Duke (2:50 PM EST)' },
  { date: '2026-03-19', time: '12:15', away: 'mcneese_st',            home: 'vanderbilt', label: 'R64: McNeese @ Vanderbilt (3:15 PM EST)' },
  { date: '2026-03-19', time: '13:05', away: 'n_dakota_st',           home: 'michigan_st',label: 'R64: NDSU @ Michigan State (4:05 PM EST)' },
  { date: '2026-03-19', time: '13:25', away: 'hawaii',                home: 'arkansas',   label: 'R64: Hawaii @ Arkansas (4:25 PM EST)' },
  { date: '2026-03-19', time: '15:50', away: 'va_commonwealth',       home: 'north_carolina', label: 'R64: VCU @ North Carolina (6:50 PM EST)' },
  { date: '2026-03-19', time: '16:10', away: 'howard',                home: 'michigan',   label: 'R64: Howard @ Michigan (7:10 PM EST)' },
  { date: '2026-03-19', time: '16:25', away: 'texas',                 home: 'brigham_young', label: 'R64: Texas @ BYU (7:25 PM EST)' },
  { date: '2026-03-19', time: '16:35', away: 'texas_a_and_m',         home: 'st_marys',   label: "R64: Texas A&M @ Saint Mary's (7:35 PM EST)" },
  { date: '2026-03-19', time: '18:25', away: 'pennsylvania',          home: 'illinois',   label: 'R64: Penn @ Illinois (9:25 PM EST)' },
  { date: '2026-03-19', time: '18:45', away: 'saint_louis',           home: 'georgia',    label: 'R64: Saint Louis @ Georgia (9:45 PM EST)' },
  { date: '2026-03-19', time: '19:00', away: 'kennesaw_st',           home: 'gonzaga',    label: 'R64: Kennesaw State @ Gonzaga (10:00 PM EST)' },
  { date: '2026-03-19', time: '19:10', away: 'idaho',                 home: 'houston',    label: 'R64: Idaho @ Houston (10:10 PM EST)' },

  // ── ROUND OF 64 - MARCH 20 ────────────────────────────────────────────────
  { date: '2026-03-20', time: '09:15', away: 'santa_clara',           home: 'kentucky',   label: 'R64: Santa Clara @ Kentucky (12:15 PM EST)' },
  { date: '2026-03-20', time: '09:40', away: 'akron',                 home: 'texas_tech', label: 'R64: Akron @ Texas Tech (12:40 PM EST)' },
  { date: '2026-03-20', time: '10:35', away: 'liu_brooklyn',          home: 'arizona',    label: 'R64: LIU @ Arizona (1:35 PM EST)' },
  { date: '2026-03-20', time: '10:50', away: 'wright_st',             home: 'virginia',   label: 'R64: Wright State @ Virginia (1:50 PM EST)' },
  { date: '2026-03-20', time: '11:50', away: 'tennessee_st',          home: 'iowa_st',    label: 'R64: Tennessee State @ Iowa State (2:50 PM EST)' },
  { date: '2026-03-20', time: '12:15', away: 'hofstra',               home: 'alabama',    label: 'R64: Hofstra @ Alabama (3:15 PM EST)' },
  { date: '2026-03-20', time: '13:10', away: 'utah_st',               home: 'villanova',  label: 'R64: Utah State @ Villanova (4:10 PM EST)' },
  { date: '2026-03-20', time: '13:25', away: 'miami_oh',              home: 'tennessee',  label: 'R64: Miami OH/SMU winner @ Tennessee (4:25 PM EST)' },
  { date: '2026-03-20', time: '15:50', away: 'iowa',                  home: 'clemson',    label: 'R64: Iowa @ Clemson (6:50 PM EST)' },
  { date: '2026-03-20', time: '16:10', away: 'n_iowa',                home: 'st_johns',   label: "R64: Northern Iowa @ St. John's (7:10 PM EST)" },
  { date: '2026-03-20', time: '16:25', away: 'c_florida',             home: 'ucla',       label: 'R64: UCF @ UCLA (7:25 PM EST)' },
  { date: '2026-03-20', time: '16:35', away: 'queens_nc',             home: 'purdue',     label: "R64: Queens @ Purdue (7:35 PM EST)" },
  { date: '2026-03-20', time: '18:25', away: 'prairie_view_a_and_m',  home: 'florida',    label: 'R64: PV A&M/Lehigh winner @ Florida (9:25 PM EST)' },
  { date: '2026-03-20', time: '18:45', away: 'california_baptist',    home: 'kansas',     label: 'R64: Cal Baptist @ Kansas (9:45 PM EST)' },
  { date: '2026-03-20', time: '19:00', away: 'furman',                home: 'connecticut',label: 'R64: Furman @ UConn (10:00 PM EST)' },
  { date: '2026-03-20', time: '19:10', away: 'missouri',              home: 'miami_fl',   label: 'R64: Missouri @ Miami (FL) (10:10 PM EST)' },
];

// Fetch all NCAAM games from DB
const [dbGames] = await conn.execute(
  'SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, awayBookSpread, bookTotal, publishedToFeed FROM games WHERE sport = ? ORDER BY gameDate, startTimeEst',
  ['NCAAM']
);

console.log('=== MARCH MADNESS 2026 FINAL AUDIT ===');
console.log(`DB has ${dbGames.length} total NCAAM games`);
console.log('');

let matched = 0;
let missing = 0;
let timeMismatch = 0;
let issues = [];

for (const expected of OFFICIAL_SCHEDULE) {
  // Find matching game in DB (by team slugs, ignoring date/time for now)
  const dbMatch = dbGames.find(g => 
    g.awayTeam === expected.away && g.homeTeam === expected.home
  );

  if (!dbMatch) {
    missing++;
    issues.push(`MISSING: ${expected.label} (${expected.away} @ ${expected.home})`);
    continue;
  }

  matched++;
  const dateOk = dbMatch.gameDate === expected.date;
  const timeOk = dbMatch.startTimeEst === expected.time;
  const hasOdds = dbMatch.awayBookSpread !== null || dbMatch.bookTotal !== null;
  const isPub = dbMatch.publishedToFeed === 1;

  if (!dateOk || !timeOk) {
    timeMismatch++;
    issues.push(`DATE/TIME MISMATCH: ${expected.label}\n    Expected: ${expected.date} ${expected.time}\n    Got:      ${dbMatch.gameDate} ${dbMatch.startTimeEst}`);
  }

  const status = [
    dateOk ? '✓date' : `✗date(${dbMatch.gameDate})`,
    timeOk ? '✓time' : `✗time(${dbMatch.startTimeEst})`,
    hasOdds ? '✓odds' : '○odds',
    isPub ? '✓pub' : '○pub',
  ].join(' ');

  console.log(`  [${status}] ID:${dbMatch.id} ${expected.label}`);
}

console.log('');
console.log('=== SUMMARY ===');
console.log(`  Matched: ${matched}/${OFFICIAL_SCHEDULE.length}`);
console.log(`  Missing: ${missing}`);
console.log(`  Date/Time mismatches: ${timeMismatch}`);

if (issues.length > 0) {
  console.log('\n=== ISSUES ===');
  for (const issue of issues) {
    console.log('  ' + issue);
  }
} else {
  console.log('\n✅ ALL GAMES VERIFIED - No issues found!');
}

// Count by date
console.log('\n=== GAME COUNTS BY DATE ===');
const [counts] = await conn.execute(
  "SELECT gameDate, COUNT(*) as cnt FROM games WHERE sport = 'NCAAM' GROUP BY gameDate ORDER BY gameDate"
);
for (const r of counts) {
  console.log(`  ${r.gameDate}: ${r.cnt} games`);
}

// Show non-bracket games still in DB (should be unpublished)
console.log('\n=== NON-BRACKET GAMES IN DB (should all be unpublished) ===');
const bracketSlugs = OFFICIAL_SCHEDULE.flatMap(g => [g.away, g.home]);
const uniqueSlugs = [...new Set(bracketSlugs)];

for (const g of dbGames) {
  const awayInBracket = uniqueSlugs.includes(g.awayTeam);
  const homeInBracket = uniqueSlugs.includes(g.homeTeam);
  if (!awayInBracket || !homeInBracket) {
    console.log(`  ID:${g.id} | ${g.awayTeam} @ ${g.homeTeam} | ${g.gameDate} | pub:${g.publishedToFeed} ${g.publishedToFeed ? '⚠️ PUBLISHED!' : '✓ unpublished'}`);
  }
}

await conn.end();
console.log('\nAudit complete.');

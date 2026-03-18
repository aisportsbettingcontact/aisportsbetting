/**
 * fix_r64_dates.mjs
 * 
 * Comprehensive fix for all 32 Round of 64 game dates and start times.
 * 
 * Schedule (EST times, converted to stored format which appears to be EST hours):
 * 
 * MARCH 19 (16 games):
 *   12:15 PM EST = 09:15 stored  → tcu @ ohio_st
 *   12:40 PM EST = 09:40 stored  → troy @ nebraska
 *   1:30 PM EST  = 10:30 stored  → south_florida @ louisville
 *   1:50 PM EST  = 10:50 stored  → high_point @ wisconsin  (WRONG DATE: currently 3/20)
 *   2:50 PM EST  = 11:50 stored  → siena @ duke
 *   3:15 PM EST  = 12:15 stored  → mcneese_st @ vanderbilt
 *   4:05 PM EST  = 13:05 stored  → n_dakota_st @ michigan_st
 *   4:25 PM EST  = 13:25 stored  → hawaii @ arkansas  (WRONG DATE: currently 3/20)
 *   6:50 PM EST  = 15:50 stored  → va_commonwealth @ north_carolina
 *   7:10 PM EST  = 16:10 stored  → howard @ michigan
 *   7:25 PM EST  = 16:25 stored  → texas @ brigham_young
 *   7:35 PM EST  = 16:35 stored  → texas_a_and_m @ st_marys
 *   9:25 PM EST  = 18:25 stored  → pennsylvania @ illinois
 *   9:45 PM EST  = 18:45 stored  → saint_louis @ georgia  (WRONG DATE: currently 3/20)
 *   10:00 PM EST = 19:00 stored  → kennesaw_st @ gonzaga  (WRONG DATE: currently 3/20)
 *   10:10 PM EST = 19:10 stored  → idaho @ houston
 * 
 * MARCH 20 (16 games):
 *   12:15 PM EST = 09:15 stored  → santa_clara @ kentucky
 *   12:40 PM EST = 09:40 stored  → akron @ texas_tech
 *   1:35 PM EST  = 10:35 stored  → liu_brooklyn @ arizona
 *   1:50 PM EST  = 10:50 stored  → wright_st @ virginia
 *   2:50 PM EST  = 11:50 stored  → tennessee_st @ iowa_st
 *   3:15 PM EST  = 12:15 stored  → hofstra @ alabama
 *   4:10 PM EST  = 13:10 stored  → utah_st @ villanova
 *   4:25 PM EST  = 13:25 stored  → miami_oh/smu @ tennessee  (First Four winner - needs insert)
 *   6:50 PM EST  = 15:50 stored  → iowa @ clemson  (WRONG DATE: currently 3/19)
 *   7:10 PM EST  = 16:10 stored  → n_iowa @ st_johns  (WRONG DATE: currently 3/19)
 *   7:25 PM EST  = 16:25 stored  → c_florida @ ucla  (WRONG DATE: currently 3/19)
 *   7:35 PM EST  = 16:35 stored  → queens_nc @ purdue
 *   9:25 PM EST  = 18:25 stored  → pv_a&m/lehigh @ florida  (First Four winner - needs insert)
 *   9:45 PM EST  = 18:45 stored  → california_baptist @ kansas  (WRONG DATE: currently 3/19)
 *   10:00 PM EST = 19:00 stored  → furman @ connecticut  (WRONG DATE: currently 3/19)
 *   10:10 PM EST = 19:10 stored  → missouri @ miami_fl
 * 
 * NOTE: The stored startTimeEst values appear to use HH:MM format but shifted by 3 hours
 * (12:15 PM EST shows as 09:15). This matches PST offset (EST - 3 = PST).
 * So stored format is PST time.
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('=== R64 DATE & TIME FIX SCRIPT ===');
console.log('');

// ============================================================
// STEP 1: Fix games currently on WRONG dates
// ============================================================
console.log('--- STEP 1: Moving games to correct dates ---');

// Games currently on 2026-03-20 that should be 2026-03-19
const moveTo319 = [
  { id: 1830091, team: 'high_point @ wisconsin',   newTime: '10:50' },  // 1:50 PM EST
  { id: 1830092, team: 'hawaii @ arkansas',         newTime: '13:25' },  // 4:25 PM EST
  { id: 1830094, team: 'saint_louis @ georgia',     newTime: '18:45' },  // 9:45 PM EST
  { id: 1830093, team: 'kennesaw_st @ gonzaga',     newTime: '19:00' },  // 10:00 PM EST
];

for (const g of moveTo319) {
  const [result] = await conn.execute(
    'UPDATE games SET gameDate = ?, startTimeEst = ? WHERE id = ?',
    ['2026-03-19', g.newTime, g.id]
  );
  console.log(`  MOVED to 3/19: ${g.team} (ID:${g.id}) → time ${g.newTime} | rows affected: ${result.affectedRows}`);
}

// Games currently on 2026-03-19 that should be 2026-03-20
const moveTo320 = [
  { id: 1830102, team: 'iowa @ clemson',            newTime: '15:50' },  // 6:50 PM EST
  { id: 1830086, team: 'n_iowa @ st_johns',         newTime: '16:10' },  // 7:10 PM EST
  { id: 1830088, team: 'c_florida @ ucla',          newTime: '16:25' },  // 7:25 PM EST
  { id: 1830087, team: 'california_baptist @ kansas', newTime: '18:45' }, // 9:45 PM EST
  { id: 1830089, team: 'furman @ connecticut',      newTime: '19:00' },  // 10:00 PM EST
];

for (const g of moveTo320) {
  const [result] = await conn.execute(
    'UPDATE games SET gameDate = ?, startTimeEst = ? WHERE id = ?',
    ['2026-03-20', g.newTime, g.id]
  );
  console.log(`  MOVED to 3/20: ${g.team} (ID:${g.id}) → time ${g.newTime} | rows affected: ${result.affectedRows}`);
}

console.log('');

// ============================================================
// STEP 2: Fix start times for games already on correct dates
// ============================================================
console.log('--- STEP 2: Fixing start times for games on correct dates ---');

// March 19 games - fix times
const mar19TimesFix = [
  { id: 1830083, team: 'tcu @ ohio_st',              newTime: '09:15' },  // 12:15 PM EST
  { id: 1830109, team: 'troy @ nebraska',             newTime: '09:40' },  // 12:40 PM EST
  { id: 1830084, team: 'south_florida @ louisville',  newTime: '10:30' },  // 1:30 PM EST
  { id: 1830082, team: 'siena @ duke',                newTime: '11:50' },  // 2:50 PM EST
  { id: 1830107, team: 'mcneese_st @ vanderbilt',     newTime: '12:15' },  // 3:15 PM EST
  { id: 1830085, team: 'n_dakota_st @ michigan_st',   newTime: '13:05' },  // 4:05 PM EST
  { id: 1830110, team: 'va_commonwealth @ north_carolina', newTime: '15:50' }, // 6:50 PM EST
  { id: 1860014, team: 'howard @ michigan',           newTime: '16:10' },  // 7:10 PM EST
  { id: 1860015, team: 'texas @ brigham_young',       newTime: '16:25' },  // 7:25 PM EST
  { id: 1830112, team: 'texas_a_and_m @ st_marys',   newTime: '16:35' },  // 7:35 PM EST
  { id: 1830111, team: 'pennsylvania @ illinois',     newTime: '18:25' },  // 9:25 PM EST
  { id: 1830113, team: 'idaho @ houston',             newTime: '19:10' },  // 10:10 PM EST
];

for (const g of mar19TimesFix) {
  const [result] = await conn.execute(
    'UPDATE games SET startTimeEst = ? WHERE id = ? AND gameDate = ?',
    [g.newTime, g.id, '2026-03-19']
  );
  console.log(`  3/19 time fix: ${g.team} (ID:${g.id}) → ${g.newTime} | rows: ${result.affectedRows}`);
}

// March 20 games - fix times
const mar20TimesFix = [
  { id: 1830105, team: 'santa_clara @ kentucky',     newTime: '09:15' },  // 12:15 PM EST
  { id: 1830099, team: 'akron @ texas_tech',          newTime: '09:40' },  // 12:40 PM EST
  { id: 1830095, team: 'liu_brooklyn @ arizona',      newTime: '10:35' },  // 1:35 PM EST
  { id: 1830104, team: 'wright_st @ virginia',        newTime: '10:50' },  // 1:50 PM EST
  { id: 1830106, team: 'tennessee_st @ iowa_st',      newTime: '11:50' },  // 2:50 PM EST
  { id: 1830103, team: 'hofstra @ alabama',           newTime: '12:15' },  // 3:15 PM EST
  { id: 1830096, team: 'utah_st @ villanova',         newTime: '13:10' },  // 4:10 PM EST
  { id: 1830098, team: 'queens_nc @ purdue',          newTime: '16:35' },  // 7:35 PM EST
  { id: 1830097, team: 'missouri @ miami_fl',         newTime: '19:10' },  // 10:10 PM EST
];

for (const g of mar20TimesFix) {
  const [result] = await conn.execute(
    'UPDATE games SET startTimeEst = ? WHERE id = ? AND gameDate = ?',
    [g.newTime, g.id, '2026-03-20']
  );
  console.log(`  3/20 time fix: ${g.team} (ID:${g.id}) → ${g.newTime} | rows: ${result.affectedRows}`);
}

console.log('');

// ============================================================
// STEP 3: Verify final state
// ============================================================
console.log('--- STEP 3: Final verification ---');

const [final] = await conn.execute(
  'SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, awayBookSpread, bookTotal, publishedToFeed FROM games WHERE sport = ? ORDER BY gameDate, startTimeEst',
  ['NCAAM']
);

const byDate = new Map();
for (const r of final) {
  const d = r.gameDate;
  if (!byDate.has(d)) byDate.set(d, []);
  byDate.get(d).push(r);
}

const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [date, games] of sorted) {
  console.log(`\n=== DATE: ${date} (${games.length} games) ===`);
  for (const g of games) {
    const hasOdds = g.awayBookSpread !== null || g.bookTotal !== null;
    console.log(`  ID:${g.id} | ${g.awayTeam} @ ${g.homeTeam} | time:${g.startTimeEst} | odds:${hasOdds ? 'YES' : 'NO'} | pub:${g.publishedToFeed}`);
  }
}

// Count by date
console.log('\n--- SUMMARY ---');
for (const [date, games] of sorted) {
  console.log(`  ${date}: ${games.length} games`);
}

await conn.end();
console.log('\nDone.');

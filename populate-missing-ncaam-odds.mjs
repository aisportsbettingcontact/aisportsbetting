/**
 * Populate spread/total for 16 NCAAM March 13 games that are missing this data.
 * VSiN has the spread numbers (but not the juice) for all of them.
 */
import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';
import { scrapeVsinOdds } from './server/vsinScraper.ts';

const conn = await mysql.createConnection(process.env.DATABASE_URL || '');

console.log('Fetching VSiN NCAAM odds...');
const games = await scrapeVsinOdds('ALL');
console.log(`VSiN returned ${games.length} NCAAM games`);

// The 16 games missing spread/total in DB for March 13
const MISSING_SPREAD = [
  { away: 'seton_hall', home: 'st_johns' },
  { away: 'iowa_st', home: 'arizona' },
  { away: 'purdue', home: 'nebraska' },
  { away: 'miami_fl', home: 'virginia' },
  { away: 'mississippi', home: 'alabama' },
  { away: 'clemson', home: 'duke' },
  { away: 'nevada', home: 'utah_st' },
  { away: 'kent', home: 'akron' },
  { away: 'georgetown', home: 'connecticut' },
  { away: 'southern_u', home: 'florida_a_and_m' },
  { away: 'kansas', home: 'houston' },
  { away: 'utah_tech', home: 'california_baptist' },
  { away: 'davidson', home: 'st_josephs' },
  { away: 'delaware_st', home: 'nc_central' },
  { away: 'ucla', home: 'michigan_st' },
  { away: 'oklahoma', home: 'arkansas' },
];

let updated = 0;
let notFound = 0;

for (const { away, home } of MISSING_SPREAD) {
  // Find in VSiN data
  const vsinGame = games.find(g => g.awaySlug === away && g.homeSlug === home);
  
  if (!vsinGame) {
    console.log(`  ❌ VSiN: ${away} @ ${home} NOT FOUND`);
    notFound++;
    continue;
  }
  
  // Find in DB
  const [rows] = await conn.execute(
    'SELECT id, awayBookSpread, bookTotal FROM games WHERE awayTeam=? AND homeTeam=? AND gameDate="2026-03-13" AND sport="NCAAM"',
    [away, home]
  );
  
  if (!rows.length) {
    console.log(`  ❌ DB: ${away} @ ${home} NOT FOUND`);
    notFound++;
    continue;
  }
  
  const dbGame = rows[0];
  
  // Only update if spread/total are null
  if (dbGame.awayBookSpread !== null && dbGame.bookTotal !== null) {
    console.log(`  ⏭️  ${away} @ ${home} already has spread=${dbGame.awayBookSpread} total=${dbGame.bookTotal}`);
    continue;
  }
  
  // awaySpread from VSiN is the away team's spread (positive = underdog, negative = favorite)
  const awaySpread = vsinGame.awaySpread;
  const homeSpread = awaySpread !== null ? -awaySpread : null;
  const total = vsinGame.total;
  const awayML = vsinGame.awayML;
  const homeML = vsinGame.homeML;
  
  // Build update fields
  const updates = {};
  if (awaySpread !== null && dbGame.awayBookSpread === null) {
    updates.awayBookSpread = String(awaySpread);
    updates.homeBookSpread = String(homeSpread);
  }
  if (total !== null && dbGame.bookTotal === null) {
    updates.bookTotal = String(total);
  }
  if (awayML !== null) updates.awayML = String(awayML);
  if (homeML !== null) updates.homeML = String(homeML);
  
  if (Object.keys(updates).length === 0) {
    console.log(`  ⏭️  ${away} @ ${home} no updates needed`);
    continue;
  }
  
  const setClauses = Object.keys(updates).map(k => `${k}=?`).join(', ');
  const values = [...Object.values(updates), dbGame.id];
  
  await conn.execute(`UPDATE games SET ${setClauses} WHERE id=?`, values);
  console.log(`  ✅ Updated ${away} @ ${home}: spread=${awaySpread}/${homeSpread} total=${total} ml=${awayML}/${homeML}`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${notFound} not found`);
await conn.end();

/**
 * insert_ff_winner_games.mjs
 * 
 * Inserts the 2 R64 games on March 20 that depend on First Four winners:
 * 
 * 1. 4:25 PM EST (13:25 PST) on March 20:
 *    No. 6 Tennessee vs. No. 11 Miami (Ohio) or SMU
 *    → awayTeam = 'miami_oh' or 'smu' (First Four winner), homeTeam = 'tennessee'
 *    → We insert with placeholder awayTeam = 'miami_oh' (tonight's First Four game winner)
 *    → VSiN will post the actual line once winner is known
 * 
 * 2. 9:25 PM EST (18:25 PST) on March 20:
 *    No. 16 Prairie View A&M or Lehigh vs. No. 1 Florida
 *    → awayTeam = 'prairie_view_a_and_m' or 'lehigh' (First Four winner), homeTeam = 'florida'
 *    → We insert with placeholder awayTeam = 'prairie_view_a_and_m' (tonight's First Four game winner)
 * 
 * NOTE: These will be updated once VSiN posts the actual lines with the correct team slug.
 * The isValidGame() filter in routers.ts checks both teams against MARCH_MADNESS_DB_SLUGS,
 * so both placeholder teams are in the allowlist and will pass the filter.
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('=== INSERT FIRST FOUR WINNER R64 GAMES ===');
console.log('');

// Check if these games already exist to avoid duplicates
const [existing] = await conn.execute(
  "SELECT id, awayTeam, homeTeam, gameDate FROM games WHERE sport = 'NCAAM' AND homeTeam IN ('tennessee', 'florida') AND gameDate = '2026-03-20'"
);

if (existing.length > 0) {
  console.log('Games already exist:');
  for (const g of existing) {
    console.log(`  ID:${g.id} | ${g.awayTeam} @ ${g.homeTeam} | ${g.gameDate}`);
  }
  console.log('Skipping insert to avoid duplicates.');
  await conn.end();
  process.exit(0);
}

// Insert Game 1: Miami OH/SMU winner @ Tennessee (4:25 PM EST = 13:25 PST on March 20)
// Using miami_oh as placeholder (First Four game is miami_oh @ smu)
const [r1] = await conn.execute(
  `INSERT INTO games 
   (fileId, awayTeam, homeTeam, gameDate, startTimeEst, sport, gameType, publishedToFeed)
   VALUES (0, 'miami_oh', 'tennessee', '2026-03-20', '13:25', 'NCAAM', 'regular_season', 0)`,
);
console.log(`INSERTED: miami_oh @ tennessee | 2026-03-20 13:25 | ID: ${r1.insertId}`);

// Insert Game 2: PV A&M/Lehigh winner @ Florida (9:25 PM EST = 18:25 PST on March 20)
// Using prairie_view_a_and_m as placeholder (First Four game is prairie_view_a_and_m @ lehigh)
const [r2] = await conn.execute(
  `INSERT INTO games 
   (fileId, awayTeam, homeTeam, gameDate, startTimeEst, sport, gameType, publishedToFeed)
   VALUES (0, 'prairie_view_a_and_m', 'florida', '2026-03-20', '18:25', 'NCAAM', 'regular_season', 0)`,
);
console.log(`INSERTED: prairie_view_a_and_m @ florida | 2026-03-20 18:25 | ID: ${r2.insertId}`);

console.log('');

// Final count verification
const [final] = await conn.execute(
  "SELECT gameDate, COUNT(*) as cnt FROM games WHERE sport = 'NCAAM' GROUP BY gameDate ORDER BY gameDate"
);
console.log('--- Final game counts by date ---');
for (const r of final) {
  console.log(`  ${r.gameDate}: ${r.cnt} games`);
}

await conn.end();
console.log('\nDone.');

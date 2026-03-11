import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n=== DEEP PIPELINE AUDIT ===\n');
console.log(`[ENV] DATABASE_URL set: ${!!process.env.DATABASE_URL}`);

// 1. All games today
const [allGames] = await conn.execute(
  `SELECT id, gameDate, awayTeam, homeTeam, startTimeEst, sortOrder,
          awayBookSpread, bookTotal, awayModelSpread, modelTotal, publishedToFeed
   FROM games WHERE gameDate = CURDATE() ORDER BY sortOrder`
);
console.log(`[DB] Total games today: ${allGames.length}`);

const withOdds = allGames.filter(g => g.awayBookSpread !== null || g.bookTotal !== null);
const withoutOdds = allGames.filter(g => g.awayBookSpread === null && g.bookTotal === null);
console.log(`[DB] Games WITH odds: ${withOdds.length}`);
console.log(`[DB] Games WITHOUT odds: ${withoutOdds.length}`);

// 2. Find duplicates - same team pair regardless of home/away order
const pairMap = new Map();
for (const g of allGames) {
  const key = [g.awayTeam, g.homeTeam].sort().join('|');
  if (!pairMap.has(key)) pairMap.set(key, []);
  pairMap.get(key).push(g);
}
const duplicates = [...pairMap.entries()].filter(([, games]) => games.length > 1);
console.log(`\n[DUPLICATES] Found ${duplicates.length} duplicate team pairs today:`);
for (const [key, games] of duplicates) {
  console.log(`  Pair: ${key}`);
  for (const g of games) {
    console.log(`    ID=${g.id} away=${g.awayTeam} home=${g.homeTeam} sortOrder=${g.sortOrder} spread=${g.awayBookSpread} total=${g.bookTotal} startTime=${g.startTimeEst}`);
  }
}

// 3. Games without odds
console.log(`\n[MISSING ODDS] ${withoutOdds.length} games have no book odds:`);
for (const g of withoutOdds) {
  console.log(`  ID=${g.id} ${g.awayTeam} vs ${g.homeTeam} sortOrder=${g.sortOrder} startTime=${g.startTimeEst}`);
}

// 4. Check all recent dates for reversed pairs
const [allDates] = await conn.execute(
  `SELECT DISTINCT gameDate FROM games ORDER BY gameDate DESC LIMIT 7`
);
console.log(`\n[DATES] Checking ${allDates.length} dates for reversed pairs...`);
for (const dateRow of allDates) {
  const [dateGames] = await conn.execute(
    `SELECT id, gameDate, awayTeam, homeTeam, sortOrder, awayBookSpread, bookTotal, startTimeEst
     FROM games WHERE gameDate = ? ORDER BY sortOrder`,
    [dateRow.gameDate]
  );
  const datePairMap = new Map();
  for (const g of dateGames) {
    const key = [g.awayTeam, g.homeTeam].sort().join('|');
    if (!datePairMap.has(key)) datePairMap.set(key, []);
    datePairMap.get(key).push(g);
  }
  const dateDups = [...datePairMap.entries()].filter(([, gs]) => gs.length > 1);
  if (dateDups.length > 0) {
    console.log(`  Date ${dateRow.gameDate}: ${dateDups.length} duplicate pairs`);
    for (const [, gs] of dateDups) {
      for (const g of gs) {
        console.log(`    ID=${g.id} away=${g.awayTeam} home=${g.homeTeam} spread=${g.awayBookSpread} total=${g.bookTotal} time=${g.startTimeEst}`);
      }
    }
  } else {
    console.log(`  Date ${dateRow.gameDate}: no duplicates (${dateGames.length} games)`);
  }
}

// 5. Show all today's games for full picture
console.log(`\n[ALL GAMES TODAY] Full list:`);
for (const g of allGames) {
  const hasOdds = g.awayBookSpread !== null ? 'HAS_ODDS' : 'NO_ODDS';
  console.log(`  ID=${g.id} [${hasOdds}] ${g.awayTeam} @ ${g.homeTeam} | spread=${g.awayBookSpread} total=${g.bookTotal} | time=${g.startTimeEst} sortOrder=${g.sortOrder}`);
}

await conn.end();
console.log('\n=== AUDIT COMPLETE ===\n');

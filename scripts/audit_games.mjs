import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  'SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, awayBookSpread, bookTotal, publishedToFeed FROM games WHERE sport = ? ORDER BY gameDate, startTimeEst',
  ['NCAAM']
);

console.log('Total NCAAM games in DB:', rows.length);
console.log('');

const byDate = new Map();
for (const r of rows) {
  const d = r.gameDate;
  if (!byDate.has(d)) byDate.set(d, []);
  byDate.get(d).push(r);
}

const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [date, games] of sorted) {
  console.log(`=== DATE: ${date} (${games.length} games) ===`);
  for (const g of games) {
    const hasOdds = g.awayBookSpread !== null || g.bookTotal !== null;
    console.log(`  ID:${g.id} | ${g.awayTeam} @ ${g.homeTeam} | time:${g.startTimeEst} | odds:${hasOdds ? 'YES' : 'NO'} | pub:${g.publishedToFeed}`);
  }
  console.log('');
}

await conn.end();

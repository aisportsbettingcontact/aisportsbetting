import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(`
  SELECT bracketGameId, bracketRound, bracketRegion, bracketSlot, 
         awayTeam, homeTeam, gameDate, gameStatus, awayScore, homeScore
  FROM games 
  WHERE sport='NCAAM' AND bracketGameId IS NOT NULL 
  ORDER BY bracketGameId
`);
console.log(`Total bracket games: ${rows.length}`);
rows.forEach(r => {
  const score = r.awayScore !== null ? `${r.awayScore}-${r.homeScore}` : 'TBD';
  console.log(`${String(r.bracketGameId).padStart(3)} [${r.bracketRound.padEnd(10)}/${r.bracketRegion.padEnd(8)}] slot=${r.bracketSlot} | ${r.awayTeam}@${r.homeTeam} | ${r.gameDate} | ${r.gameStatus} | ${score}`);
});
await conn.end();

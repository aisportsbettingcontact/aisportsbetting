import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  'SELECT id, awayTeam, homeTeam, modelRunAt, awayModelSpread, modelTotal, modelAwayML FROM games WHERE gameDate = "2026-04-17" AND sport = "MLB" ORDER BY id'
);
let done = 0, pending = 0;
for (const r of rows) {
  const s = r.modelRunAt ? 'DONE' : 'PENDING';
  console.log(`[${s}] ${r.awayTeam}@${r.homeTeam} spread=${r.awayModelSpread} total=${r.modelTotal} ML=${r.modelAwayML}`);
  if (r.modelRunAt) done++; else pending++;
}
console.log(`[OUTPUT] done=${done} pending=${pending}`);
await conn.end();

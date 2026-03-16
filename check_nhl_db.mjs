import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  `SELECT id, awayTeam, homeTeam, awayBookSpread, homeBookSpread, awayML, homeML, modelAwayPuckLine, modelHomePuckLine 
   FROM games WHERE sport = 'NHL' AND gameDate = '2026-03-15' ORDER BY id`
);
console.log(JSON.stringify(rows, null, 2));
await conn.end();

import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      DATE_FORMAT(gameDate, '%Y-%m-%d') as date,
      COUNT(*) as total,
      SUM(CASE WHEN modelF5AwayWinPct IS NOT NULL THEN 1 ELSE 0 END) as hasF5Model,
      SUM(CASE WHEN f5AwayML IS NOT NULL THEN 1 ELSE 0 END) as hasF5Odds,
      SUM(CASE WHEN f5MlResult IS NOT NULL THEN 1 ELSE 0 END) as hasF5Result,
      SUM(CASE WHEN actualF5AwayScore IS NOT NULL THEN 1 ELSE 0 END) as hasActuals,
      SUM(CASE WHEN nrfiActualResult IS NOT NULL THEN 1 ELSE 0 END) as hasNrfiResult,
      SUM(CASE WHEN modelPNrfi IS NOT NULL THEN 1 ELSE 0 END) as hasNrfiModel
    FROM games WHERE sport='MLB' AND gameDate BETWEEN '2026-03-25' AND '2026-04-05'
    GROUP BY gameDate ORDER BY gameDate
  `);
  console.log("Date         | Total | F5Model | F5Odds | F5Result | Actuals | NrfiModel | NrfiResult");
  console.log("-------------|-------|---------|--------|----------|---------|-----------|----------");
  for (const r of rows) {
    console.log(`${r.date} | ${String(r.total).padStart(5)} | ${String(r.hasF5Model).padStart(7)} | ${String(r.hasF5Odds).padStart(6)} | ${String(r.hasF5Result).padStart(8)} | ${String(r.hasActuals).padStart(7)} | ${String(r.hasNrfiModel).padStart(9)} | ${String(r.hasNrfiResult).padStart(10)}`);
  }
  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

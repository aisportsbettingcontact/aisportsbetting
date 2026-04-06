// db_audit_april6.ts - DB audit for April 6, 2026
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

const DATE = "2026-04-06";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT
        (SELECT COUNT(*) FROM games WHERE gameDate = '${DATE}') as games,
        (SELECT COUNT(*) FROM mlb_strikeout_props sp JOIN games g ON g.id = sp.gameId WHERE g.gameDate = '${DATE}') as kProps,
        (SELECT COUNT(*) FROM mlb_strikeout_props sp JOIN games g ON g.id = sp.gameId WHERE g.gameDate = '${DATE}' AND sp.kProj IS NOT NULL) as kPropsModeled,
        (SELECT COUNT(*) FROM mlb_strikeout_props sp JOIN games g ON g.id = sp.gameId WHERE g.gameDate = '${DATE}' AND sp.verdict IN ('OVER','UNDER')) as kPropsEdges,
        (SELECT COUNT(*) FROM mlb_hr_props hp JOIN games g ON g.id = hp.gameId WHERE g.gameDate = '${DATE}') as hrProps,
        (SELECT COUNT(*) FROM mlb_hr_props hp JOIN games g ON g.id = hp.gameId WHERE g.gameDate = '${DATE}' AND hp.modelPHr IS NOT NULL) as hrPropsModeled,
        (SELECT COUNT(*) FROM mlb_hr_props hp JOIN games g ON g.id = hp.gameId WHERE g.gameDate = '${DATE}' AND hp.verdict = 'OVER') as hrPropsEdges
    `);
    console.log(`\n=== DB AUDIT: ${DATE} ===`);
    console.log(JSON.stringify(rows[0], null, 2));

    // Show K-Props edges
    const [kEdges] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT sp.pitcherName, sp.bookLine, sp.kProj, sp.edgeOver, sp.evOver, sp.verdict
      FROM mlb_strikeout_props sp
      JOIN games g ON g.id = sp.gameId
      WHERE g.gameDate = '${DATE}' AND sp.verdict IN ('OVER','UNDER')
      ORDER BY sp.evOver DESC
    `);
    console.log(`\n=== K-PROPS EDGES (${DATE}) ===`);
    for (const r of kEdges) {
      console.log(`  ${r.pitcherName}: line=${r.bookLine} proj=${r.kProj} edge=${r.edgeOver} ev=${r.evOver} verdict=${r.verdict}`);
    }
  } finally {
    await conn.end();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

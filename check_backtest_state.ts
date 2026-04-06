import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  
  const [r1] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'"
  );
  const [r2] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'"
  );
  const [r3] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND sp.actualKs IS NOT NULL"
  );
  const [r4] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND hp.actualHr IS NOT NULL"
  );
  const [r5] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND sp.kProj IS NOT NULL"
  );
  const [r6] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND hp.modelPHr IS NOT NULL"
  );
  const [r7] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM games WHERE sport='MLB' AND gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND actualF5AwayScore IS NOT NULL"
  );
  const [r8] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM games WHERE sport='MLB' AND gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND nrfiActualResult IS NOT NULL"
  );
  const [r9] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND sp.backtestResult IS NOT NULL"
  );
  const [r10] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05' AND hp.backtestResult IS NOT NULL"
  );
  
  console.log("=== BACKTEST STATE (March 25 - April 5) ===");
  console.log(`K-Props total:           ${r1[0].cnt}`);
  console.log(`K-Props modeled:         ${r5[0].cnt}`);
  console.log(`K-Props with actualKs:   ${r3[0].cnt}`);
  console.log(`K-Props backtested:      ${r9[0].cnt}`);
  console.log(`HR Props total:          ${r2[0].cnt}`);
  console.log(`HR Props modeled:        ${r6[0].cnt}`);
  console.log(`HR Props with actualHr:  ${r4[0].cnt}`);
  console.log(`HR Props backtested:     ${r10[0].cnt}`);
  console.log(`Games with F5 actuals:   ${r7[0].cnt}`);
  console.log(`Games with NRFI result:  ${r8[0].cnt}`);
  
  // Per-date K-Props breakdown
  const [kByDate] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT g.gameDate, COUNT(*) as total, 
           SUM(CASE WHEN sp.kProj IS NOT NULL THEN 1 ELSE 0 END) as modeled,
           SUM(CASE WHEN sp.actualKs IS NOT NULL THEN 1 ELSE 0 END) as actual
    FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
    GROUP BY g.gameDate ORDER BY g.gameDate
  `);
  console.log("\n=== K-PROPS PER DATE ===");
  for (const r of kByDate) {
    console.log(`  ${r.gameDate}: total=${r.total} modeled=${r.modeled} actual=${r.actual}`);
  }
  
  // Per-date HR Props breakdown
  const [hrByDate] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT g.gameDate, COUNT(*) as total,
           SUM(CASE WHEN hp.modelPHr IS NOT NULL THEN 1 ELSE 0 END) as modeled,
           SUM(CASE WHEN hp.actualHr IS NOT NULL THEN 1 ELSE 0 END) as actual
    FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
    GROUP BY g.gameDate ORDER BY g.gameDate
  `);
  console.log("\n=== HR PROPS PER DATE ===");
  for (const r of hrByDate) {
    console.log(`  ${r.gameDate}: total=${r.total} modeled=${r.modeled} actual=${r.actual}`);
  }
  
  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

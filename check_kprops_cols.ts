import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const [cols] = await conn.execute<mysql2.RowDataPacket[]>("SHOW COLUMNS FROM mlb_strikeout_props");
  const colNames = cols.map((c) => c.Field as string);
  console.log("K-Props columns:", colNames.filter((c) => 
    c.toLowerCase().includes("edge") || 
    c.toLowerCase().includes("ev") || 
    c.toLowerCase().includes("verdict") || 
    c.toLowerCase().includes("kproj") ||
    c.toLowerCase().includes("model")
  ));
  
  // Show sample row
  const [rows] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT pitcherName, bookLine, kProj, verdict FROM mlb_strikeout_props sp JOIN games g ON g.id = sp.gameId WHERE g.gameDate = '2026-04-06' AND sp.verdict IN ('OVER','UNDER') LIMIT 5"
  );
  console.log("\nSample K-Props edges:");
  for (const r of rows) {
    console.log(` ${r.pitcherName}: line=${r.bookLine} proj=${r.kProj} verdict=${r.verdict}`);
  }
  
  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

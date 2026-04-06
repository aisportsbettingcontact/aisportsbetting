// check_april6_games.ts
import * as mysql2 from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute(
    "SELECT id, awayTeam, homeTeam, gameDate FROM games WHERE gameDate = ? AND sport = ? ORDER BY id",
    ["2026-04-06", "MLB"]
  );
  console.log("DB games for 2026-04-06:");
  for (const r of rows as any[]) {
    console.log(`  id=${r.id} | ${r.awayTeam} @ ${r.homeTeam}`);
  }
  
  const [kRows] = await conn.execute(
    "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON sp.gameId = g.id WHERE g.gameDate = ?",
    ["2026-04-06"]
  );
  console.log("K-Props rows for 2026-04-06:", (kRows as any[])[0].cnt);
  
  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

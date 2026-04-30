import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { like } from "drizzle-orm";

const db = await getDb();
const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  modelF5HomeWinPct: games.modelF5HomeWinPct,
  modelF5AwayWinPct: games.modelF5AwayWinPct,
  modelF5OverRate: games.modelF5OverRate,
  modelF5PushPct: games.modelF5PushPct,
  modelF5Total: games.modelF5Total,
}).from(games).where(like(games.gameDate, "2026-04-15%"));

for (const r of rows.filter(r => r.modelF5OverRate != null)) {
  console.log(`[${r.id}] ${r.awayTeam}@${r.homeTeam}`);
  console.log(`  F5HomeWin=${r.modelF5HomeWinPct}  F5AwayWin=${r.modelF5AwayWinPct}`);
  console.log(`  F5OverRate=${r.modelF5OverRate}  F5PushPct=${r.modelF5PushPct}  F5Total=${r.modelF5Total}`);
}

process.exit(0);

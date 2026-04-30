import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const db = await getDb();
const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  mlbGamePk: games.mlbGamePk,
  startTimeEst: games.startTimeEst,
  sortOrder: games.sortOrder,
  fileId: games.fileId,
}).from(games).where(eq(games.gameDate, "2026-04-15"));

for (const r of rows.filter(r => r.awayTeam === "COL" || r.homeTeam === "HOU" || r.awayTeam === "HOU" || r.homeTeam === "COL")) {
  console.log("COL/HOU:", JSON.stringify(r));
}
// Show a sample MLB game to understand the structure
const mlb = rows.filter(r => r.mlbGamePk);
if (mlb.length > 0) console.log("Sample MLB game:", JSON.stringify(mlb[0]));
else console.log("No games with mlbGamePk yet");
console.log("All games count:", rows.length);
process.exit(0);

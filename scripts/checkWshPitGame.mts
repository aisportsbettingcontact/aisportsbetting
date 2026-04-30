import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const db = await getDb();
const [row] = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayStartingPitcher: games.awayStartingPitcher,
  homeStartingPitcher: games.homeStartingPitcher,
  bookTotal: games.bookTotal,
  awayML: games.awayML,
  awayRunLine: games.awayRunLine,
  modelRunAt: games.modelRunAt,
}).from(games).where(eq(games.id, 2250249));

console.log("[INPUT] WSH@PIT game row:");
console.log(JSON.stringify(row, null, 2));
process.exit(0);

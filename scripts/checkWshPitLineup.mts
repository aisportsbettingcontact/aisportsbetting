import { getDb } from "../server/db";
import { mlbLineups } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const db = await getDb();
const rows = await db.select().from(mlbLineups).where(eq(mlbLineups.gameId, 2250249));
console.log("[INPUT] WSH@PIT (id=2250249) lineup rows:", rows.length);
for (const r of rows) {
  console.log(JSON.stringify({
    id: r.id,
    gameId: r.gameId,
    awayPitcherName: r.awayPitcherName,
    homePitcherName: r.homePitcherName,
    awayPitcherHand: r.awayPitcherHand,
    homePitcherHand: r.homePitcherHand,
    awayPitcherEra: r.awayPitcherEra,
    homePitcherEra: r.homePitcherEra,
    confirmedAt: r.confirmedAt,
  }));
}
if (rows.length === 0) {
  console.log("[STATE] No lineup rows found — starters not yet in DB");
}
process.exit(0);

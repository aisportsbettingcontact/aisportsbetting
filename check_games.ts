import { db } from "./server/db.ts";
import { games } from "./drizzle/schema.ts";
import { eq } from "drizzle-orm";

const rows = await db
  .select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    sport: games.sport,
    rotNums: games.rotNums,
  })
  .from(games)
  .where(eq(games.gameDate, "2026-03-14"))
  .limit(10);

console.log("Sample games for 2026-03-14:");
rows.forEach((r) =>
  console.log(" ", r.id, `"${r.awayTeam}"`, "@", `"${r.homeTeam}"`, r.sport, "rot:", r.rotNums)
);
process.exit(0);

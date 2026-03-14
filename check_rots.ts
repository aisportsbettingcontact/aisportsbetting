import { getDb } from "./server/db.ts";
import { games } from "./drizzle/schema.ts";
import { eq } from "drizzle-orm";

const db = await getDb();
const rows = await db
  .select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    rotNums: games.rotNums,
    sport: games.sport,
  })
  .from(games)
  .where(eq(games.gameDate, "2026-03-14"))
  .orderBy(games.sortOrder);

console.log(`Games for 2026-03-14: ${rows.length}`);
rows.forEach((r) =>
  console.log(
    `  [${r.id}] ${r.awayTeam} @ ${r.homeTeam} | rotNums="${r.rotNums}" | ${r.sport}`
  )
);

// Check if rotNums are populated
const withRots = rows.filter((r) => r.rotNums);
console.log(`\nGames with rotNums: ${withRots.length}/${rows.length}`);
process.exit(0);

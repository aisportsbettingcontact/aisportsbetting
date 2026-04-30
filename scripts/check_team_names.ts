import { db } from "../server/db";
import { games } from "../drizzle/schema";
import { and, gte, lte, eq } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameDate: games.gameDate,
    awayML: games.awayML,
    homeML: games.homeML,
    awayRunLine: games.awayRunLine,
    bookTotal: games.bookTotal,
    oddsSource: games.oddsSource,
    publishedModel: games.publishedModel,
  }).from(games).where(
    and(
      gte(games.gameDate, "2026-04-12"),
      lte(games.gameDate, "2026-04-12"),
      eq(games.sport, "MLB")
    )
  );

  console.log(`[CHECK] Found ${rows.length} Apr 12 MLB games in DB:`);
  for (const r of rows) {
    console.log(
      `  id=${r.id} | ${r.awayTeam} @ ${r.homeTeam} | ` +
      `ML=${r.awayML}/${r.homeML} RL=${r.awayRunLine} T=${r.bookTotal} | ` +
      `src=${r.oddsSource ?? 'NULL'} model=${r.publishedModel ? 'YES' : 'NO'}`
    );
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

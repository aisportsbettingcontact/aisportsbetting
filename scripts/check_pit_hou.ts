/**
 * check_pit_hou.ts — Full row audit for PIT@CHC and HOU@SEA Apr 12
 * Run: npx tsx scripts/check_pit_hou.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("DB not available"); process.exit(1); }

  const rows = await db.select().from(games).where(inArray(games.id, [2250218, 2250220]));

  for (const r of rows) {
    console.log(`\n=== ${r.awayTeam}@${r.homeTeam} (id=${r.id}) ===`);
    console.log(`[SPREAD]  awaySpread=${r.awaySpread} | homeSpread=${r.homeSpread}`);
    console.log(`[TOTAL]   overUnder=${r.overUnder}`);
    console.log(`[ML]      awayML=${r.awayML} | homeML=${r.homeML}`);
    console.log(`[MODEL]   awayModelSpread=${r.awayModelSpread} | homeModelSpread=${r.homeModelSpread}`);
    console.log(`[MODEL]   modelOverUnder=${r.modelOverUnder}`);
    console.log(`[STATUS]  publishedModel=${r.publishedModel} | publishedToFeed=${r.publishedToFeed}`);
    console.log(`[GAME]    gameStatus=${r.gameStatus} | startTime=${r.startTime}`);
    console.log(`[PITCHERS] away=${r.awayStartingPitcher} | home=${r.homeStartingPitcher}`);
    console.log(`[SORT]    sortOrder=${r.sortOrder} | gameDate=${r.gameDate}`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

/**
 * check_apr12_model.ts
 * Checks current model projection state for Apr 12 MLB games.
 *
 * BUG FIX (2026-04-14): Original used gte+lte on string gameDate column which
 * returned 0 rows due to Drizzle ORM type coercion on string date columns.
 * Fixed to use eq() for exact string match. Also fixed sport value to "MLB"
 * (uppercase, matching the DB schema enum value).
 *
 * Run: npx tsx scripts/check_apr12_model.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("[ERROR] DB not available"); process.exit(1); }

  // CRITICAL: Use eq() for exact string date match — gte/lte on string columns
  // causes Drizzle ORM type coercion issues and returns 0 rows incorrectly.
  // Also: sport is stored as uppercase "MLB" in the DB, not "mlb".
  const rows = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayML: games.awayML,
    homeML: games.homeML,
    awayRunLine: games.awayRunLine,
    bookTotal: games.bookTotal,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    modelTotal: games.modelTotal,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    publishedModel: games.publishedModel,
    oddsSource: games.oddsSource,
    gameDate: games.gameDate,
    sport: games.sport,
  }).from(games).where(
    and(
      eq(games.gameDate, "2026-04-12"),
      eq(games.sport, "MLB")   // uppercase — DB stores "MLB", not "mlb"
    )
  );

  console.log(`[INPUT] Apr 12 MLB games in DB: ${rows.length}`);
  let modelOk = 0;
  let noModel = 0;
  let hasPitchersCount = 0;
  let noPitchersCount = 0;

  for (const r of rows) {
    const hasModel = r.awayModelSpread && r.homeModelSpread && r.modelTotal;
    const hasPitchers = r.awayStartingPitcher && r.homeStartingPitcher;
    const status = hasModel ? "MODEL_OK" : "NO_MODEL";
    if (hasModel) modelOk++; else noModel++;
    if (hasPitchers) hasPitchersCount++; else noPitchersCount++;
    console.log(
      `  [${status}] id=${r.id} | ${r.awayTeam}@${r.homeTeam} | ` +
      `ML=${r.awayML ?? "NULL"}/${r.homeML ?? "NULL"} RL=${r.awayRunLine ?? "NULL"} T=${r.bookTotal ?? "NULL"} | ` +
      `modelSpread=${r.awayModelSpread ?? "NULL"}/${r.homeModelSpread ?? "NULL"} modelTotal=${r.modelTotal ?? "NULL"} | ` +
      `SP=${r.awayStartingPitcher ?? "TBD"}/${r.homeStartingPitcher ?? "TBD"} | ` +
      `src=${r.oddsSource ?? "NULL"} pub=${r.publishedModel}`
    );
  }

  console.log(`\n[OUTPUT] MODEL_OK=${modelOk} NO_MODEL=${noModel}`);
  console.log(`[OUTPUT] HAS_PITCHERS=${hasPitchersCount} NO_PITCHERS=${noPitchersCount}`);
  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

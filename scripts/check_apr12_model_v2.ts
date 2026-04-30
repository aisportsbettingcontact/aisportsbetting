/**
 * check_apr12_model_v2.ts
 * Checks model projection state for Apr 12 MLB games using exact string match.
 * Run: npx tsx scripts/check_apr12_model_v2.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("[ERROR] DB not available"); process.exit(1); }

  // Use exact string equality — no gte/lte to avoid any type coercion issues
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
      eq(games.sport, "MLB")
    )
  );

  console.log(`[INPUT] Apr 12 MLB games in DB: ${rows.length}`);
  let modelOk = 0;
  let noModel = 0;
  let hasPitchers = 0;
  let noPitchers = 0;
  let hasOdds = 0;
  let noOdds = 0;

  for (const r of rows) {
    const hasModelData = r.awayModelSpread && r.homeModelSpread && r.modelTotal;
    const hasPitcherData = r.awayStartingPitcher && r.homeStartingPitcher;
    const hasOddsData = r.awayML && r.homeML;
    if (hasModelData) modelOk++; else noModel++;
    if (hasPitcherData) hasPitchers++; else noPitchers++;
    if (hasOddsData) hasOdds++; else noOdds++;
    const status = hasModelData ? "MODEL_OK" : "NO_MODEL";
    console.log(
      `  [${status}] id=${r.id} | ${r.awayTeam}@${r.homeTeam} | ` +
      `ML=${r.awayML ?? "NULL"}/${r.homeML ?? "NULL"} RL=${r.awayRunLine ?? "NULL"} T=${r.bookTotal ?? "NULL"} | ` +
      `modelSpread=${r.awayModelSpread ?? "NULL"}/${r.homeModelSpread ?? "NULL"} modelTotal=${r.modelTotal ?? "NULL"} | ` +
      `SP=${r.awayStartingPitcher ?? "TBD"}/${r.homeStartingPitcher ?? "TBD"} | ` +
      `src=${r.oddsSource ?? "NULL"} pub=${r.publishedModel}`
    );
  }

  console.log(`\n[OUTPUT] Summary:`);
  console.log(`  MODEL_OK=${modelOk} NO_MODEL=${noModel}`);
  console.log(`  HAS_PITCHERS=${hasPitchers} NO_PITCHERS=${noPitchers}`);
  console.log(`  HAS_ODDS=${hasOdds} NO_ODDS=${noOdds}`);
  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

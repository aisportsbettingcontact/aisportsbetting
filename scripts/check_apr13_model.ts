/**
 * check_apr13_model.ts
 * Checks model projection state for Apr 13 MLB games.
 * IMPORTANT: Uses eq() for exact string date match (not gte/lte — Drizzle ORM bug on string columns).
 * IMPORTANT: Uses uppercase "MLB" — DB stores sport as uppercase enum value.
 * Run: npx tsx scripts/check_apr13_model.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("[ERROR] DB not available"); process.exit(1); }

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
    gameStatus: games.gameStatus,
    oddsSource: games.oddsSource,
    gameDate: games.gameDate,
  }).from(games).where(
    and(
      eq(games.gameDate, "2026-04-13"),
      eq(games.sport, "MLB")  // MUST be uppercase — DB stores "MLB" not "mlb"
    )
  );

  console.log(`[INPUT] Apr 13 MLB games in DB: ${rows.length}`);
  let ok = 0, noModel = 0, noPitchers = 0, noOdds = 0;

  for (const r of rows) {
    const hasModel = r.awayModelSpread !== null && r.homeModelSpread !== null && r.modelTotal !== null;
    const hasPitchers = r.awayStartingPitcher && r.homeStartingPitcher;
    const hasOdds = r.awayML !== null && r.homeML !== null && r.bookTotal !== null;
    const status = hasModel ? "MODEL_OK" : "NO_MODEL";
    if (hasModel) ok++; else noModel++;
    if (!hasPitchers) noPitchers++;
    if (!hasOdds) noOdds++;
    console.log(
      `  [${status}] id=${r.id} | ${r.awayTeam}@${r.homeTeam} | ` +
      `ML=${r.awayML ?? "NULL"}/${r.homeML ?? "NULL"} RL=${r.awayRunLine ?? "NULL"} T=${r.bookTotal ?? "NULL"} | ` +
      `model=${r.awayModelSpread ?? "NULL"}/${r.homeModelSpread ?? "NULL"} mT=${r.modelTotal ?? "NULL"} | ` +
      `SP=${r.awayStartingPitcher ?? "TBD"}/${r.homeStartingPitcher ?? "TBD"} | ` +
      `status=${r.gameStatus ?? "NULL"} src=${r.oddsSource ?? "NULL"} pub=${r.publishedModel}`
    );
  }

  console.log(`\n[OUTPUT] MODEL_OK=${ok} NO_MODEL=${noModel}`);
  console.log(`[OUTPUT] NO_PITCHERS=${noPitchers} NO_ODDS=${noOdds}`);
  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

/**
 * injectColHouStarters.ts
 * Manually inject starting pitchers for COL @ HOU (game 2250242) and trigger model run.
 *
 * Starters confirmed from Rotowire (April 14, 2026):
 *   COL (away): Michael Lorenzen — 1-1, 8.36 ERA
 *   HOU (home): Colton Gordon — 0-0, 0.00 ERA (MLB debut/limited sample)
 *
 * Run: npx tsx scripts/injectColHouStarters.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { runMlbModelForDate } from "../server/mlbModelRunner";

const GAME_ID = 2250242;
const DATE = "2026-04-14";

async function main() {
  const db = await getDb();

  console.log("[INJECT] Setting starters for COL @ HOU (game " + GAME_ID + ")...");

  await db
    .update(games)
    .set({
      awayStartingPitcher: "Michael Lorenzen",
      homeStartingPitcher: "Colton Gordon",
      awayPitcherConfirmed: true,
      homePitcherConfirmed: true,
    })
    .where(eq(games.id, GAME_ID));

  console.log("[INJECT] awayStartingPitcher = 'Michael Lorenzen'");
  console.log("[INJECT] homeStartingPitcher = 'Colton Gordon'");
  console.log("[INJECT] Both confirmed = true");

  // Verify the update
  const rows = await db.select({
    id: games.id,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    awayPitcherConfirmed: games.awayPitcherConfirmed,
    homePitcherConfirmed: games.homePitcherConfirmed,
    awayRunLine: games.awayRunLine,
    bookTotal: games.bookTotal,
  }).from(games).where(eq(games.id, GAME_ID));

  const g = rows[0];
  console.log("[VERIFY] awayStartingPitcher:", g.awayStartingPitcher);
  console.log("[VERIFY] homeStartingPitcher:", g.homeStartingPitcher);
  console.log("[VERIFY] awayRunLine:", g.awayRunLine);
  console.log("[VERIFY] bookTotal:", g.bookTotal);

  if (!g.awayStartingPitcher || !g.homeStartingPitcher) {
    console.error("[ERROR] Starter injection failed — aborting model run");
    process.exit(1);
  }

  console.log("\n[MODEL] Triggering MLB model run for " + DATE + " (COL @ HOU only will be picked up)...");
  console.log("[MODEL] Note: Colton Gordon has no DB stats — will use team SP average fallback (HOU)");
  console.log("[MODEL] Note: Michael Lorenzen has 3yr NRFI data in mlb_pitcher_stats");

  const result = await runMlbModelForDate(DATE);

  console.log("\n[RESULT] Model run complete:");
  console.log("  total:", result.total);
  console.log("  written:", result.written);
  console.log("  skipped:", result.skipped);
  console.log("  errors:", result.errors);
  console.log("  validation passed:", result.validation.passed);
  if (result.validation.issues.length > 0) {
    console.log("  issues:", result.validation.issues);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

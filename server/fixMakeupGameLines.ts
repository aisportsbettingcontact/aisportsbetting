/**
 * fixMakeupGameLines.ts
 *
 * Populates awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds for the
 * 2 April 30 makeup doubleheader games (gameNumber=2), then re-runs the model
 * for those specific game IDs and publishes them.
 *
 * Run: npx tsx server/fixMakeupGameLines.ts
 */

import { getDb, setGamePublished, setGameModelPublished } from "./db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { runMlbModelForDate } from "./mlbModelRunner";

const DATE = "2026-04-30";

async function main() {
  const db = await getDb();

  // ── Step 1: Find the 2 makeup game IDs ───────────────────────────────────────
  console.log("[INPUT] Finding HOU@BAL G2 and SF@PHI G2 in DB");
  const makeupGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    gameNumber: games.gameNumber,
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    awayBookSpread: games.awayBookSpread,
    bookTotal: games.bookTotal,
    awayML: games.awayML,
    homeML: games.homeML,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    modelRunAt: games.modelRunAt,
  }).from(games).where(
    and(eq(games.gameDate, DATE), eq(games.sport, "MLB"))
  );

  const houBal2 = makeupGames.find((g: typeof makeupGames[0]) => g.awayTeam === "HOU" && g.homeTeam === "BAL" && g.gameNumber === 2);
  const sfPhi2  = makeupGames.find((g: typeof makeupGames[0]) => g.awayTeam === "SF"  && g.homeTeam === "PHI" && g.gameNumber === 2);

  if (!houBal2) {
    console.error("[ERROR] HOU@BAL G2 not found in DB — run insertMakeupGames.ts first");
    process.exit(1);
  }
  if (!sfPhi2) {
    console.error("[ERROR] SF@PHI G2 not found in DB — run insertMakeupGames.ts first");
    process.exit(1);
  }

  console.log(`[STATE] HOU@BAL G2: id=${houBal2.id} | awayRunLine=${houBal2.awayRunLine} | awayRunLineOdds=${houBal2.awayRunLineOdds}`);
  console.log(`[STATE] SF@PHI G2:  id=${sfPhi2.id} | awayRunLine=${sfPhi2.awayRunLine} | awayRunLineOdds=${sfPhi2.awayRunLineOdds}`);

  // ── Step 2: Populate run line fields from AN API data ────────────────────────
  // AN API (id=290399): HOU@BAL G2 | RL away=1.5(-194) home=-1.5(155) | Total O8.5(-124) U8.5(102)
  // AN API (id=290400): SF@PHI G2  | RL away=1.5(-190) home=-1.5(155) | Total O7(-105) U7(-115)

  if (!houBal2.awayRunLine) {
    console.log(`[STEP] Populating run line for HOU@BAL G2 (id=${houBal2.id})`);
    await db.update(games).set({
      awayRunLine: "1.5",
      homeRunLine: "-1.5",
      awayRunLineOdds: "-194",
      homeRunLineOdds: "+155",
      // Also set awayBookSpread/homeBookSpread as the model may read those too
      awayBookSpread: "1.5",
      homeBookSpread: "-1.5",
    }).where(eq(games.id, houBal2.id));
    console.log(`[OUTPUT] HOU@BAL G2 run line populated: RL 1.5(-194) / -1.5(+155)`);
  } else {
    console.log(`[STATE] HOU@BAL G2 run line already populated: ${houBal2.awayRunLine} / ${houBal2.awayRunLineOdds}`);
  }

  if (!sfPhi2.awayRunLine) {
    console.log(`[STEP] Populating run line for SF@PHI G2 (id=${sfPhi2.id})`);
    await db.update(games).set({
      awayRunLine: "1.5",
      homeRunLine: "-1.5",
      awayRunLineOdds: "-190",
      homeRunLineOdds: "+155",
      awayBookSpread: "1.5",
      homeBookSpread: "-1.5",
    }).where(eq(games.id, sfPhi2.id));
    console.log(`[OUTPUT] SF@PHI G2 run line populated: RL 1.5(-190) / -1.5(+155)`);
  } else {
    console.log(`[STATE] SF@PHI G2 run line already populated: ${sfPhi2.awayRunLine} / ${sfPhi2.awayRunLineOdds}`);
  }

  // ── Step 3: Run model for the 2 specific game IDs ────────────────────────────
  const targetIds = [houBal2.id, sfPhi2.id];
  console.log(`[STEP] Running MLB model for game IDs: ${targetIds.join(', ')}`);
  const modelResult = await runMlbModelForDate(DATE, { targetGameIds: targetIds, forceRerun: true });
  console.log(`[OUTPUT] Model run complete: written=${modelResult.written} skipped=${modelResult.skipped} errors=${modelResult.errors} total=${modelResult.total}`);

  if (modelResult.errors > 0) {
    console.error(`[ERROR] Model run had ${modelResult.errors} errors — check logs above`);
  }

  // ── Step 4: Publish both games ────────────────────────────────────────────────
  const finalGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    gameNumber: games.gameNumber,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    modelRunAt: games.modelRunAt,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    modelTotal: games.modelTotal,
    modelAwayML: games.modelAwayML,
    modelHomeML: games.modelHomeML,
  }).from(games).where(
    and(eq(games.gameDate, DATE), eq(games.sport, "MLB"))
  );

  let publishedCount = 0;
  let modelApprovedCount = 0;

  for (const g of finalGames) {
    if (!g.publishedToFeed) {
      await setGamePublished(g.id, true);
      publishedCount++;
      console.log(`[STEP] Published to feed: [${g.id}] ${g.awayTeam} @ ${g.homeTeam} G${g.gameNumber ?? 1}`);
    }
    if (!g.publishedModel && g.modelRunAt) {
      await setGameModelPublished(g.id, true);
      modelApprovedCount++;
      console.log(`[STEP] Model approved: [${g.id}] ${g.awayTeam} @ ${g.homeTeam} G${g.gameNumber ?? 1} | spread=${g.awayModelSpread} total=${g.modelTotal} ml=${g.modelAwayML}/${g.modelHomeML}`);
    }
  }

  console.log(`[OUTPUT] Published ${publishedCount} games to feed | Model approved: ${modelApprovedCount}`);

  // ── Step 5: Final verification ────────────────────────────────────────────────
  console.log(`\n[VERIFY] Final state — all ${finalGames.length} MLB games for ${DATE}:`);
  let allPublished = true;
  let allModeled = true;

  for (const g of finalGames) {
    const modeled = !!g.modelRunAt;
    const pubFeed = !!g.publishedToFeed;
    const pubModel = !!g.publishedModel;
    if (!pubFeed) allPublished = false;
    if (!modeled) allModeled = false;
    const status = pubFeed && pubModel ? "LIVE" : pubFeed && !pubModel ? "FEED_ONLY" : "UNPUBLISHED";
    console.log(`  [${status}] [${g.id}] ${g.awayTeam} @ ${g.homeTeam} G${g.gameNumber ?? 1} | ${g.startTimeEst}`);
    if (modeled) {
      console.log(`           Model: spread=${g.awayModelSpread}/${g.homeModelSpread} total=${g.modelTotal} ml=${g.modelAwayML}/${g.modelHomeML}`);
    } else {
      console.log(`           Model: NOT RUN`);
    }
  }

  console.log(`\n[VERIFY] Total: ${finalGames.length}/11 | All published: ${allPublished} | All modeled: ${allModeled}`);
  if (finalGames.length === 11 && allPublished && allModeled) {
    console.log("[VERIFY] PASS — all 11 MLB games for 2026-04-30 are modeled and live on the feed");
  } else {
    console.log(`[VERIFY] FAIL — total=${finalGames.length}/11 published=${allPublished} modeled=${allModeled}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error("[ERROR]", e.message);
  console.error(e.stack);
  process.exit(1);
});

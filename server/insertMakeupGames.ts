/**
 * insertMakeupGames.ts
 *
 * Inserts the 2 April 30 MLB makeup doubleheader games missing from the DB:
 *   1. HOU @ BAL Game 2 — 4:05 PM ET (makeup of 4/29 PPD) — AN id=290399
 *   2. SF @ PHI Game 2  — 5:35 PM ET (makeup of 4/29 PPD) — AN id=290400
 *
 * IMPORTANT: These are Game 2 of doubleheaders. The unique index is
 * (gameDate, awayTeam, homeTeam, gameNumber). Game 1 records already exist
 * with gameNumber=1 (default). These inserts use gameNumber=2.
 *
 * Also restores the Game 1 start times that were overwritten by the previous
 * failed insert attempt (which used gameNumber=1 and hit the upsert path).
 *
 * Run: npx tsx server/insertMakeupGames.ts
 */

import { getDb, insertGames, setGamePublished, setGameModelPublished } from "./db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { runMlbModelForDate } from "./mlbModelRunner";
import type { InsertGame } from "../drizzle/schema";

const DATE = "2026-04-30";

async function main() {
  const db = await getDb();

  // ── Step 1: Check current state ──────────────────────────────────────────────
  console.log("[INPUT] Checking current DB state for 2026-04-30 MLB games");
  const existing = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    gameNumber: games.gameNumber,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    modelRunAt: games.modelRunAt,
  }).from(games).where(
    and(eq(games.gameDate, DATE), eq(games.sport, "MLB"))
  );

  console.log(`[STATE] Found ${existing.length} existing MLB games for ${DATE}`);
  for (const g of existing) {
    const modelTs = g.modelRunAt ? new Date(g.modelRunAt).toISOString() : "NOT RUN";
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} G${g.gameNumber ?? 1} | ${g.startTimeEst} | feed=${g.publishedToFeed} model=${g.publishedModel} | modelRunAt=${modelTs}`);
  }

  // ── Step 2: Restore Game 1 start times if they were overwritten ──────────────
  // The previous failed insert (without gameNumber=2) overwrote HOU@BAL and SF@PHI
  // Game 1 start times. Restore them to their correct values.
  const houBal1 = existing.find((g: typeof existing[0]) => g.awayTeam === "HOU" && g.homeTeam === "BAL" && (g.gameNumber === 1 || g.gameNumber === null));
  const sfPhi1  = existing.find((g: typeof existing[0]) => g.awayTeam === "SF"  && g.homeTeam === "PHI" && (g.gameNumber === 1 || g.gameNumber === null));

  if (houBal1 && houBal1.startTimeEst !== "12:35 PM ET") {
    console.log(`[STEP] Restoring HOU@BAL G1 start time: ${houBal1.startTimeEst} → 12:35 PM ET`);
    await db.update(games).set({ startTimeEst: "12:35 PM ET" }).where(eq(games.id, houBal1.id));
    console.log(`[OUTPUT] HOU@BAL G1 start time restored`);
  } else if (houBal1) {
    console.log(`[STATE] HOU@BAL G1 start time already correct: ${houBal1.startTimeEst}`);
  }

  if (sfPhi1 && sfPhi1.startTimeEst !== "1:05 PM ET") {
    console.log(`[STEP] Restoring SF@PHI G1 start time: ${sfPhi1.startTimeEst} → 1:05 PM ET`);
    await db.update(games).set({ startTimeEst: "1:05 PM ET" }).where(eq(games.id, sfPhi1.id));
    console.log(`[OUTPUT] SF@PHI G1 start time restored`);
  } else if (sfPhi1) {
    console.log(`[STATE] SF@PHI G1 start time already correct: ${sfPhi1.startTimeEst}`);
  }

  // ── Step 3: Identify missing Game 2 records ──────────────────────────────────
  const hasHouBal2 = existing.some((g: typeof existing[0]) => g.awayTeam === "HOU" && g.homeTeam === "BAL" && g.gameNumber === 2);
  const hasSfPhi2  = existing.some((g: typeof existing[0]) => g.awayTeam === "SF"  && g.homeTeam === "PHI" && g.gameNumber === 2);

  console.log(`[VERIFY] HOU@BAL G2 in DB: ${hasHouBal2}`);
  console.log(`[VERIFY] SF@PHI G2 in DB:  ${hasSfPhi2}`);

  // ── Step 4: Insert missing Game 2 records ────────────────────────────────────
  const toInsert: InsertGame[] = [];

  if (!hasHouBal2) {
    console.log("[STEP] Inserting HOU @ BAL Game 2 (4:05 PM ET, gameNumber=2, makeup 4/29 PPD)");
    toInsert.push({
      fileId: 0,
      gameDate: DATE,
      startTimeEst: "4:05 PM ET",
      awayTeam: "HOU",
      homeTeam: "BAL",
      gameNumber: 2,
      awayBookSpread: "1.5",
      homeBookSpread: "-1.5",
      bookTotal: "8.5",
      awayModelSpread: null,
      homeModelSpread: null,
      modelTotal: null,
      spreadEdge: null,
      spreadDiff: null,
      totalEdge: null,
      totalDiff: null,
      sport: "MLB",
      gameType: "regular_season",
      conference: null,
      publishedToFeed: false,
      rotNums: null,
      sortOrder: 9999,
      // Book ML from AN API (DK book 15)
      awayML: "+108",
      homeML: "-126",
      awaySpreadOdds: "-194",
      homeSpreadOdds: "+155",
      overOdds: "-124",
      underOdds: "+102",
      openAwayML: "+108",
      openHomeML: "-126",
      openAwaySpread: "1.5",
      openHomeSpread: "-1.5",
      openTotal: "8.5",
      // Rotowire starters
      awayStartingPitcher: "Lance McCullers",
      homeStartingPitcher: "Brandon Young",
      awayPitcherConfirmed: false,
      homePitcherConfirmed: false,
    } as InsertGame);
  }

  if (!hasSfPhi2) {
    console.log("[STEP] Inserting SF @ PHI Game 2 (5:35 PM ET, gameNumber=2, makeup 4/29 PPD)");
    toInsert.push({
      fileId: 0,
      gameDate: DATE,
      startTimeEst: "5:35 PM ET",
      awayTeam: "SF",
      homeTeam: "PHI",
      gameNumber: 2,
      awayBookSpread: "1.5",
      homeBookSpread: "-1.5",
      bookTotal: "7.0",
      awayModelSpread: null,
      homeModelSpread: null,
      modelTotal: null,
      spreadEdge: null,
      spreadDiff: null,
      totalEdge: null,
      totalDiff: null,
      sport: "MLB",
      gameType: "regular_season",
      conference: null,
      publishedToFeed: false,
      rotNums: null,
      sortOrder: 9999,
      awayML: "+120",
      homeML: "-145",
      awaySpreadOdds: "-190",
      homeSpreadOdds: "+155",
      overOdds: "-105",
      underOdds: "-115",
      openAwayML: "+120",
      openHomeML: "-145",
      openAwaySpread: "1.5",
      openHomeSpread: "-1.5",
      openTotal: "7.0",
      awayStartingPitcher: "Adrian Houser",
      homeStartingPitcher: "Andrew Painter",
      awayPitcherConfirmed: false,
      homePitcherConfirmed: false,
    } as InsertGame);
  }

  if (toInsert.length > 0) {
    await insertGames(toInsert);
    console.log(`[OUTPUT] Inserted ${toInsert.length} new game(s) into DB`);
  } else {
    console.log("[STATE] Both makeup games already in DB — skipping insertion");
  }

  // ── Step 5: Re-query to confirm all 11 games are present ─────────────────────
  const allGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    gameNumber: games.gameNumber,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    modelRunAt: games.modelRunAt,
  }).from(games).where(
    and(eq(games.gameDate, DATE), eq(games.sport, "MLB"))
  );

  console.log(`[STATE] Total MLB games for ${DATE} after insertion: ${allGames.length}`);
  for (const g of allGames) {
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} G${g.gameNumber ?? 1} | ${g.startTimeEst} | feed=${g.publishedToFeed} model=${g.publishedModel}`);
  }

  if (allGames.length !== 11) {
    console.warn(`[WARN] Expected 11 games, found ${allGames.length} — check for missing games`);
  }

  // ── Step 6: Run model for the full date (only unmodeled games) ────────────────
  console.log(`[STEP] Running MLB model for ${DATE} (forceRerun=false — only unmodeled games)`);
  const modelResult = await runMlbModelForDate(DATE, { forceRerun: false });
  console.log(`[OUTPUT] Model run complete: written=${modelResult.written} skipped=${modelResult.skipped} errors=${modelResult.errors} total=${modelResult.total}`);

  // ── Step 7: Publish all modeled games to feed ──────────────────────────────
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

  // ── Step 8: Final verification ────────────────────────────────────────────
  const verifyGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    gameNumber: games.gameNumber,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    modelRunAt: games.modelRunAt,
    awayModelSpread: games.awayModelSpread,
    modelTotal: games.modelTotal,
    modelAwayML: games.modelAwayML,
    modelHomeML: games.modelHomeML,
  }).from(games).where(
    and(eq(games.gameDate, DATE), eq(games.sport, "MLB"))
  );

  console.log(`\n[VERIFY] Final state — ${verifyGames.length} MLB games for ${DATE}:`);
  let allPublished = true;
  let allModeled = true;

  for (const g of verifyGames) {
    const modeled = !!g.modelRunAt;
    const pubFeed = !!g.publishedToFeed;
    const pubModel = !!g.publishedModel;
    if (!pubFeed) allPublished = false;
    if (!modeled) allModeled = false;
    const status = pubFeed && pubModel ? "LIVE" : pubFeed && !pubModel ? "FEED_ONLY" : "UNPUBLISHED";
    console.log(`  [${status}] [${g.id}] ${g.awayTeam} @ ${g.homeTeam} G${g.gameNumber ?? 1} | ${g.startTimeEst}`);
    console.log(`           Model: spread=${g.awayModelSpread} total=${g.modelTotal} ml=${g.modelAwayML}/${g.modelHomeML}`);
  }

  console.log(`\n[VERIFY] Total games: ${verifyGames.length} | All published: ${allPublished} | All modeled: ${allModeled}`);
  if (verifyGames.length === 11 && allPublished && allModeled) {
    console.log("[VERIFY] PASS — all 11 MLB games for 2026-04-30 are modeled and live on the feed");
  } else {
    console.log(`[VERIFY] FAIL — expected 11 games, found ${verifyGames.length} | published=${allPublished} modeled=${allModeled}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error("[ERROR]", e.message);
  console.error(e.stack);
  process.exit(1);
});

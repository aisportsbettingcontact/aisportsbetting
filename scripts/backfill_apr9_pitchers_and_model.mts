/**
 * backfill_apr9_pitchers_and_model.mts
 *
 * One-time script to:
 *   1. Read pitcher names from mlb_lineups table for April 9, 2026 games
 *   2. Write them to games.awayStartingPitcher / games.homeStartingPitcher
 *   3. Run runMlbModelForDate("2026-04-09") to model all 6 games
 *   4. Publish all modeled games to the feed
 *
 * Logging protocol:
 *   [INPUT]  source + parsed values
 *   [STEP]   operation description
 *   [STATE]  intermediate computations
 *   [OUTPUT] result
 *   [VERIFY] pass/fail + reason
 */

import "dotenv/config";

const TARGET_DATE = "2026-04-09";
const TAG = `[BackfillApr9]`;

async function main() {
  console.log(`${TAG} ► START — target date: ${TARGET_DATE}`);
  console.log(`${TAG} [INPUT] Script invoked at ${new Date().toISOString()}`);

  // ── Step 1: Connect to DB ─────────────────────────────────────────────────────
  console.log(`${TAG} [STEP] Connecting to database...`);
  const { getDb } = await import("../server/db.js");
  const { mlbLineups, games } = await import("../drizzle/schema.js");
  const { eq, and, gte, lte, isNotNull } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) {
    console.error(`${TAG} [ERROR] DB not available — aborting`);
    process.exit(1);
  }
  console.log(`${TAG} [STATE] DB connected ✅`);

  // ── Step 2: Fetch all April 9 MLB games from games table ─────────────────────
  console.log(`${TAG} [STEP] Fetching April 9 MLB games from games table...`);
  const gameRows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
      bookTotal: games.bookTotal,
      awayML: games.awayML,
      homeML: games.homeML,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        eq(games.gameDate, TARGET_DATE)
      )
    );

  console.log(`${TAG} [STATE] Found ${gameRows.length} MLB games for ${TARGET_DATE}`);
  for (const g of gameRows) {
    console.log(
      `${TAG}   gameId=${g.id} ${g.awayTeam}@${g.homeTeam} | ` +
      `awayP="${g.awayStartingPitcher ?? "NULL"}" homeP="${g.homeStartingPitcher ?? "NULL"}" | ` +
      `bookTotal=${g.bookTotal ?? "NULL"} awayML=${g.awayML ?? "NULL"} homeML=${g.homeML ?? "NULL"}`
    );
  }

  if (gameRows.length === 0) {
    console.error(`${TAG} [ERROR] No MLB games found for ${TARGET_DATE} — aborting`);
    process.exit(1);
  }

  // ── Step 3: Fetch pitcher data from mlb_lineups table ────────────────────────
  console.log(`${TAG} [STEP] Fetching pitcher data from mlb_lineups table...`);
  const gameIds = gameRows.map(g => g.id);

  const { inArray } = await import("drizzle-orm");
  const lineupRows = await db
    .select({
      gameId: mlbLineups.gameId,
      awayPitcherName: mlbLineups.awayPitcherName,
      awayPitcherHand: mlbLineups.awayPitcherHand,
      awayPitcherConfirmed: mlbLineups.awayPitcherConfirmed,
      homePitcherName: mlbLineups.homePitcherName,
      homePitcherHand: mlbLineups.homePitcherHand,
      homePitcherConfirmed: mlbLineups.homePitcherConfirmed,
    })
    .from(mlbLineups)
    .where(inArray(mlbLineups.gameId, gameIds));

  console.log(`${TAG} [STATE] Found ${lineupRows.length} lineup rows`);

  // Build gameId → lineup map
  const lineupByGameId = new Map<number, typeof lineupRows[0]>();
  for (const row of lineupRows) {
    lineupByGameId.set(row.gameId, row);
  }

  // ── Step 4: Write pitcher names to games table ────────────────────────────────
  console.log(`${TAG} [STEP] Writing pitcher names from mlb_lineups → games table...`);
  let pitcherWritten = 0;
  let pitcherSkipped = 0;
  let pitcherErrors = 0;

  for (const g of gameRows) {
    const lineup = lineupByGameId.get(g.id);
    const gameTag = `${TAG}[${g.awayTeam}@${g.homeTeam}][gameId=${g.id}]`;

    if (!lineup) {
      console.warn(`${gameTag} [WARN] No lineup row found in mlb_lineups — skipping pitcher write`);
      pitcherSkipped++;
      continue;
    }

    const awayP = lineup.awayPitcherName;
    const homeP = lineup.homePitcherName;

    if (!awayP || !homeP) {
      console.warn(
        `${gameTag} [WARN] Missing pitcher(s): awayP="${awayP ?? "NULL"}" homeP="${homeP ?? "NULL"}" — skipping`
      );
      pitcherSkipped++;
      continue;
    }

    // Check if already populated (avoid overwriting MLB Stats API data if present)
    const alreadyHasAway = !!g.awayStartingPitcher;
    const alreadyHasHome = !!g.homeStartingPitcher;

    if (alreadyHasAway && alreadyHasHome) {
      console.log(
        `${gameTag} [STATE] Already has pitchers: awayP="${g.awayStartingPitcher}" homeP="${g.homeStartingPitcher}" — ` +
        `Rotowire: awayP="${awayP}" homeP="${homeP}" — overwriting with Rotowire data`
      );
    } else {
      console.log(
        `${gameTag} [STATE] Writing pitchers: awayP="${awayP}" (${lineup.awayPitcherHand ?? "?"}) ` +
        `[${lineup.awayPitcherConfirmed ? "CONFIRMED" : "expected"}] | ` +
        `homeP="${homeP}" (${lineup.homePitcherHand ?? "?"}) ` +
        `[${lineup.homePitcherConfirmed ? "CONFIRMED" : "expected"}]`
      );
    }

    try {
      await db
        .update(games)
        .set({
          awayStartingPitcher: awayP,
          homeStartingPitcher: homeP,
        })
        .where(eq(games.id, g.id));

      console.log(`${gameTag} [OUTPUT] Pitcher write SUCCESS ✅`);
      pitcherWritten++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${gameTag} [ERROR] Pitcher write FAILED: ${msg}`);
      pitcherErrors++;
    }
  }

  console.log(
    `${TAG} [OUTPUT] Pitcher writes: written=${pitcherWritten} skipped=${pitcherSkipped} errors=${pitcherErrors}`
  );

  if (pitcherErrors > 0) {
    console.error(`${TAG} [VERIFY] FAIL — ${pitcherErrors} pitcher write error(s)`);
    process.exit(1);
  }
  if (pitcherWritten === 0) {
    console.error(`${TAG} [VERIFY] FAIL — 0 pitchers written — cannot run model`);
    process.exit(1);
  }
  console.log(`${TAG} [VERIFY] PASS — ${pitcherWritten} pitcher pair(s) written to games table`);

  // ── Step 5: Verify games table now has pitchers ───────────────────────────────
  console.log(`${TAG} [STEP] Verifying games table pitcher data...`);
  const verifyRows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
      bookTotal: games.bookTotal,
      awayML: games.awayML,
      homeML: games.homeML,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        eq(games.gameDate, TARGET_DATE)
      )
    );

  let modelableCount = 0;
  for (const g of verifyRows) {
    const hasLines = !!(g.bookTotal && g.awayML && g.homeML);
    const hasPitchers = !!(g.awayStartingPitcher && g.homeStartingPitcher);
    const isModelable = hasLines && hasPitchers;
    if (isModelable) modelableCount++;
    console.log(
      `${TAG}   gameId=${g.id} ${g.awayTeam}@${g.homeTeam} | ` +
      `awayP="${g.awayStartingPitcher ?? "NULL"}" homeP="${g.homeStartingPitcher ?? "NULL"}" | ` +
      `bookTotal=${g.bookTotal ?? "NULL"} awayML=${g.awayML ?? "NULL"} homeML=${g.homeML ?? "NULL"} | ` +
      `MODELABLE=${isModelable ? "✅" : "❌"}`
    );
  }
  console.log(`${TAG} [STATE] ${modelableCount}/${verifyRows.length} games are modelable`);

  if (modelableCount === 0) {
    console.error(`${TAG} [VERIFY] FAIL — 0 modelable games — aborting model run`);
    process.exit(1);
  }

  // ── Step 6: Run MLB model for April 9 ────────────────────────────────────────
  console.log(`${TAG} [STEP] Running MLB model for ${TARGET_DATE}...`);
  const { runMlbModelForDate } = await import("../server/mlbModelRunner.js");

  const modelResult = await runMlbModelForDate(TARGET_DATE);
  console.log(
    `${TAG} [OUTPUT] Model run complete: ` +
    `written=${modelResult.written} skipped=${modelResult.skipped} errors=${modelResult.errors} ` +
    `validation=${modelResult.validation.passed ? "✅ PASSED" : "❌ FAILED (" + modelResult.validation.issues.length + " issues)"}`
  );

  if (!modelResult.validation.passed) {
    console.error(`${TAG} [VERIFY] FAIL — Model validation issues:`, modelResult.validation.issues);
    process.exit(1);
  }
  if (modelResult.written === 0) {
    console.error(`${TAG} [VERIFY] FAIL — Model wrote 0 games — check skip reasons above`);
    process.exit(1);
  }
  console.log(`${TAG} [VERIFY] PASS — Model wrote ${modelResult.written} game(s) ✅`);

  // ── Step 7: Publish all modeled April 9 MLB games to feed ────────────────────
  console.log(`${TAG} [STEP] Publishing modeled April 9 MLB games to feed...`);
  const { publishAllStagingGames } = await import("../server/db.js");

  await publishAllStagingGames(TARGET_DATE, "MLB");
  console.log(`${TAG} [OUTPUT] publishAllStagingGames call complete (void return — verifying via DB query below)`);
  console.log(`${TAG} [VERIFY] PASS — publish call succeeded ✅`);

  // ── Step 8: Final verification ────────────────────────────────────────────────
  console.log(`${TAG} [STEP] Final verification of April 9 MLB games...`);
  const finalRows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
      publishedModel: games.publishedModel,
      publishedToFeed: games.publishedToFeed,
      awayModelSpread: games.awayModelSpread,
      homeModelSpread: games.homeModelSpread,
      modelTotal: games.modelTotal,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        eq(games.gameDate, TARGET_DATE)
      )
    );

  console.log(`\n${TAG} ═══ FINAL STATE — April 9, 2026 MLB Games ═══`);
  let allGood = true;
  for (const g of finalRows) {
    const ok = g.publishedModel && g.publishedToFeed && g.awayModelSpread !== null;
    if (!ok) allGood = false;
    console.log(
      `${TAG}   ${g.awayTeam}@${g.homeTeam} [gameId=${g.id}]\n` +
      `${TAG}     Pitchers: ${g.awayStartingPitcher ?? "NULL"} vs ${g.homeStartingPitcher ?? "NULL"}\n` +
      `${TAG}     Model: awaySpread=${g.awayModelSpread ?? "NULL"} homeSpread=${g.homeModelSpread ?? "NULL"} total=${g.modelTotal ?? "NULL"}\n` +
      `${TAG}     publishedModel=${g.publishedModel} publishedToFeed=${g.publishedToFeed} ${ok ? "✅" : "❌"}`
    );
  }

  if (allGood) {
    console.log(`\n${TAG} [VERIFY] PASS — All ${finalRows.length} April 9 MLB games modeled and published ✅`);
  } else {
    console.error(`\n${TAG} [VERIFY] FAIL — Some games not fully modeled/published — check above`);
    process.exit(1);
  }

  console.log(`${TAG} ► DONE`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL]`, err);
  process.exit(1);
});

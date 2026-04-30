/**
 * bridge_pitchers_apr12.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Directly writes pitcher names from mlb_lineups → games.awayStartingPitcher
 * for all Apr 12 games, then runs the MLB model.
 *
 * This is needed when the lineup watcher already ran (hash unchanged) but
 * the pitcher bridge didn't fire because there was no hash change.
 *
 * Run with: npx tsx scripts/bridge_pitchers_apr12.ts
 */

import { getDb } from "../server/db.js";
import { games, mlbLineups } from "../drizzle/schema.js";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import { runMlbModelForDate } from "../server/mlbModelRunner.js";

const TARGET_DATE = "2026-04-12";

async function main() {
  console.log("\n========================================");
  console.log("  APR 12 PITCHER BRIDGE + MODEL RUN");
  console.log(`  Target date: ${TARGET_DATE}`);
  console.log("========================================\n");

  const db = await getDb();
  if (!db) {
    console.error("[FATAL] DB not available");
    process.exit(1);
  }

  // ── STEP 1: Get Apr 12 game IDs, then fetch pitcher data from mlb_lineups ──
  console.log("[STEP 1/3] Fetching pitcher data from mlb_lineups for Apr 12...");

  // First get all Apr 12 game IDs from games table
  const apr12Games = await db
    .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games)
    .where(and(eq(games.gameDate, TARGET_DATE), eq(games.sport, "MLB")));

  const apr12GameIds = apr12Games.map(g => g.id);
  console.log(`[STEP 1/3] Found ${apr12GameIds.length} Apr 12 MLB games: ${apr12Games.map(g => `${g.awayTeam}@${g.homeTeam}`).join(", ")}`);

  if (apr12GameIds.length === 0) {
    console.error("[STEP 1/3] No Apr 12 MLB games found in DB");
    process.exit(1);
  }

  // Now fetch lineup rows for those game IDs
  const lineupRows = await db
    .select({
      gameId: mlbLineups.gameId,
      awayPitcherName: mlbLineups.awayPitcherName,
      homePitcherName: mlbLineups.homePitcherName,
    })
    .from(mlbLineups)
    .where(
      and(
        inArray(mlbLineups.gameId, apr12GameIds),
        isNotNull(mlbLineups.awayPitcherName),
        isNotNull(mlbLineups.homePitcherName),
      )
    );

  console.log(`[STEP 1/3] Found ${lineupRows.length} lineup rows with both pitchers`);

  if (lineupRows.length === 0) {
    console.error("[STEP 1/3] No lineup rows found — run trigger_apr12.ts first");
    process.exit(1);
  }

  // ── STEP 2: Write pitcher names to games.awayStartingPitcher / homeStartingPitcher ─
  console.log("\n[STEP 2/3] Bridging pitcher names to games table...");
  let written = 0;
  let errors = 0;

  for (const row of lineupRows) {
    if (!row.gameId || !row.awayPitcherName || !row.homePitcherName) continue;
    try {
      await db
        .update(games)
        .set({
          awayStartingPitcher: row.awayPitcherName,
          homeStartingPitcher: row.homePitcherName,
        })
        .where(eq(games.id, row.gameId));
      console.log(`  [WRITTEN] gameId=${row.gameId} awayP="${row.awayPitcherName}" homeP="${row.homePitcherName}"`);
      written++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] gameId=${row.gameId}: ${msg}`);
      errors++;
    }
  }

  console.log(`[STEP 2/3] Bridge complete — written=${written} errors=${errors}`);

  // ── STEP 3: Run MLB model for Apr 12 ──────────────────────────────────────
  console.log("\n[STEP 3/3] Running MLB model for Apr 12...");
  try {
    const mlbResult = await runMlbModelForDate(TARGET_DATE);
    console.log(`[STEP 3/3] DONE — total=${mlbResult.total} written=${mlbResult.written} skipped=${mlbResult.skipped} errors=${mlbResult.errors}`);
    if (mlbResult.validation?.issues?.length > 0) {
      for (const e of mlbResult.validation.issues) {
        console.error(`  [ISSUE] ${e}`);
      }
    }
  } catch (err) {
    console.error("[STEP 3/3] FATAL:", err instanceof Error ? err.message : String(err));
  }

  console.log("\n========================================");
  console.log("  APR 12 BRIDGE + MODEL COMPLETE");
  console.log("========================================\n");

  process.exit(0);
}

main().catch(err => {
  console.error("[FATAL] Unhandled error:", err);
  process.exit(1);
});

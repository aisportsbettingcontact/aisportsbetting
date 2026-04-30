/**
 * reseed_apr12_full.ts
 *
 * Full Apr 12 re-seed with the new Open-line fallback + oddsSource labeling.
 * Steps:
 *   1. Trigger refreshAnApiOdds for Apr 12 (MLB + NHL) — writes Open-line fallback + DK
 *   2. Run completeness gate — report any games with null primary fields
 *   3. Bridge pitchers for MLB games (awayStartingPitcher / homeStartingPitcher)
 *   4. Run MLB model for Apr 12
 *   5. Run NHL model sync for Apr 12
 *   6. Final DB completeness report
 */

import * as dotenv from "dotenv";
dotenv.config();

const TARGET_DATE = "2026-04-12";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`[RESEED][INPUT] Full Apr 12 re-seed — date=${TARGET_DATE}`);
  console.log("═══════════════════════════════════════════════════════════════");

  // ── Step 1: Refresh AN API odds (MLB + NHL) for Apr 12 ─────────────────────
  console.log("\n[RESEED][STEP 1] Refreshing AN API odds for Apr 12 (MLB + NHL)…");
  try {
    const { refreshAnApiOdds } = await import("../server/vsinAutoRefresh");
    const result = await (refreshAnApiOdds as any)(TARGET_DATE, ["mlb", "nhl"], "manual");
    console.log(
      `[RESEED][STATE] AN odds: updated=${result.updated} skipped=${result.skipped} ` +
      `frozen=${result.frozen} errors=${result.errors.length}`
    );
    if (result.errors.length > 0) {
      console.warn("[RESEED][WARN] AN odds errors:", result.errors);
    }
    // Log completeness report from the gate
    if (result.completenessReport) {
      console.log("[RESEED][STATE] Completeness report:", JSON.stringify(result.completenessReport, null, 2));
    }
  } catch (err) {
    console.error("[RESEED][ERROR] AN odds refresh failed:", err);
  }

  // ── Step 2: Bridge pitchers for MLB Apr 12 games ───────────────────────────
  console.log("\n[RESEED][STEP 2] Bridging pitchers for MLB Apr 12 games…");
  try {
    const { getDb } = await import("../server/db");
    const { games, mlbLineups } = await import("../drizzle/schema");
    const { eq, and, gte, lte } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    // Get all Apr 12 MLB games
    const mlbGames = await db
      .select({
        id: games.id,
        awayTeam: games.awayTeam,
        homeTeam: games.homeTeam,
        awayStartingPitcher: games.awayStartingPitcher,
        homeStartingPitcher: games.homeStartingPitcher,
      })
      .from(games)
      .where(
        and(
          eq(games.gameDate, TARGET_DATE),
          eq(games.sport, "MLB")
        )
      );

    console.log(`[RESEED][STATE] Found ${mlbGames.length} MLB games for ${TARGET_DATE}`);

    let bridged = 0;
    for (const game of mlbGames) {
      // Get lineup record for this game
      const lineupRows = await db
        .select({
          awayPitcher: mlbLineups.awayPitcher,
          homePitcher: mlbLineups.homePitcher,
        })
        .from(mlbLineups)
        .where(eq(mlbLineups.gameId, game.id))
        .limit(1);

      if (lineupRows.length === 0) {
        console.log(`[RESEED][STATE] ${game.awayTeam}@${game.homeTeam} (id=${game.id}): no lineup record`);
        continue;
      }

      const lineup = lineupRows[0]!;
      const awayPitcher = lineup.awayPitcher;
      const homePitcher = lineup.homePitcher;

      if (!awayPitcher && !homePitcher) {
        console.log(`[RESEED][STATE] ${game.awayTeam}@${game.homeTeam} (id=${game.id}): lineup has no pitchers`);
        continue;
      }

      // Only bridge if pitchers are missing from games table
      const needsBridge =
        (!game.awayStartingPitcher || game.awayStartingPitcher === "TBD") ||
        (!game.homeStartingPitcher || game.homeStartingPitcher === "TBD");

      if (!needsBridge) {
        console.log(
          `[RESEED][STATE] ${game.awayTeam}@${game.homeTeam} (id=${game.id}): ` +
          `pitchers already set (away=${game.awayStartingPitcher} home=${game.homeStartingPitcher})`
        );
        continue;
      }

      // Write pitchers to games table
      const updateData: Record<string, string | null> = {};
      if (awayPitcher && (!game.awayStartingPitcher || game.awayStartingPitcher === "TBD")) {
        updateData.awayStartingPitcher = awayPitcher;
      }
      if (homePitcher && (!game.homeStartingPitcher || game.homeStartingPitcher === "TBD")) {
        updateData.homeStartingPitcher = homePitcher;
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(games).set(updateData as any).where(eq(games.id, game.id));
        bridged++;
        console.log(
          `[RESEED][STATE] BRIDGED ${game.awayTeam}@${game.homeTeam} (id=${game.id}): ` +
          `away=${updateData.awayStartingPitcher ?? game.awayStartingPitcher} ` +
          `home=${updateData.homeStartingPitcher ?? game.homeStartingPitcher}`
        );
      }
    }
    console.log(`[RESEED][OUTPUT] Pitcher bridge: ${bridged} games updated`);
  } catch (err) {
    console.error("[RESEED][ERROR] Pitcher bridge failed:", err);
  }

  // ── Step 3: Run MLB model for Apr 12 ───────────────────────────────────────
  console.log("\n[RESEED][STEP 3] Running MLB model for Apr 12…");
  try {
    const { runMlbModelForDate } = await import("../server/mlbModelRunner");
    const result = await runMlbModelForDate(TARGET_DATE);
    console.log(
      `[RESEED][OUTPUT] MLB model: written=${result.written} skipped=${result.skipped} errors=${result.errors} ` +
      `validation=${result.validation.passed ? "✅ PASSED" : "❌ FAILED (" + result.validation.issues.length + " issues)"}`
    );
    if (!result.validation.passed) {
      console.error("[RESEED][ERROR] MLB validation issues:", result.validation.issues);
    }
    // Log skipped games with reasons
    if (result.skippedGames && result.skippedGames.length > 0) {
      console.log("[RESEED][STATE] Skipped games:");
      for (const sg of result.skippedGames) {
        console.log(`  ↳ ${sg.awayTeam}@${sg.homeTeam} (id=${sg.id}): ${sg.reason}`);
      }
    }
  } catch (err) {
    console.error("[RESEED][ERROR] MLB model run failed:", err);
  }

  // ── Step 4: Run NHL model sync for Apr 12 ─────────────────────────────────
  console.log("\n[RESEED][STEP 4] Running NHL model sync for Apr 12…");
  try {
    const { syncNhlModelForToday } = await import("../server/nhlModelSync");
    const result = await syncNhlModelForToday("manual", true, true, TARGET_DATE);
    console.log(
      `[RESEED][OUTPUT] NHL model: synced=${result.synced} skipped=${result.skipped} errors=${result.errors.length}`
    );
    if (result.errors.length > 0) {
      console.warn("[RESEED][WARN] NHL model errors:", result.errors);
    }
  } catch (err) {
    console.error("[RESEED][ERROR] NHL model sync failed:", err);
  }

  // ── Step 5: Final DB completeness report ──────────────────────────────────
  console.log("\n[RESEED][STEP 5] Final DB completeness report for Apr 12…");
  try {
    const { getDb } = await import("../server/db");
    const { games } = await import("../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    const allGames = await db
      .select({
        id: games.id,
        sport: games.sport,
        awayTeam: games.awayTeam,
        homeTeam: games.homeTeam,
        awayBookSpread: games.awayBookSpread,
        homeBookSpread: games.homeBookSpread,
        awaySpreadOdds: games.awaySpreadOdds,
        homeSpreadOdds: games.homeSpreadOdds,
        bookTotal: games.bookTotal,
        overOdds: games.overOdds,
        underOdds: games.underOdds,
        awayML: games.awayML,
        homeML: games.homeML,
        oddsSource: (games as any).oddsSource,
        publishedModel: games.publishedModel,
        awayStartingPitcher: games.awayStartingPitcher,
        homeStartingPitcher: games.homeStartingPitcher,
      })
      .from(games)
      .where(eq(games.gameDate, TARGET_DATE));

    console.log(`\n[RESEED][OUTPUT] ═══ Apr 12 Completeness Report (${allGames.length} games) ═══`);

    const PRIMARY_FIELDS = [
      "awayBookSpread", "homeBookSpread", "awaySpreadOdds", "homeSpreadOdds",
      "bookTotal", "overOdds", "underOdds", "awayML", "homeML"
    ] as const;

    let allComplete = true;
    for (const g of allGames) {
      const nullFields = PRIMARY_FIELDS.filter(f => (g as any)[f] == null || (g as any)[f] === "0");
      const isComplete = nullFields.length === 0;
      if (!isComplete) allComplete = false;

      const pitcherStatus = g.sport === "MLB"
        ? ` | pitchers: away=${g.awayStartingPitcher ?? "NULL"} home=${g.homeStartingPitcher ?? "NULL"}`
        : "";

      console.log(
        `  ${isComplete ? "✅" : "❌"} [${g.sport}] ${g.awayTeam}@${g.homeTeam} (id=${g.id}) ` +
        `| source=${(g as any).oddsSource ?? "null"} | published=${g.publishedModel}` +
        (nullFields.length > 0 ? ` | MISSING: [${nullFields.join(", ")}]` : " | ALL FIELDS OK") +
        pitcherStatus
      );
    }

    console.log(
      `\n[RESEED][VERIFY] ${allComplete ? "✅ PASS" : "❌ FAIL"} — ` +
      `${allGames.filter(g => {
        const nf = PRIMARY_FIELDS.filter(f => (g as any)[f] == null || (g as any)[f] === "0");
        return nf.length === 0;
      }).length}/${allGames.length} games fully populated`
    );
  } catch (err) {
    console.error("[RESEED][ERROR] Final completeness check failed:", err);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("[RESEED][OUTPUT] DONE");
  console.log("═══════════════════════════════════════════════════════════════");
  process.exit(0);
}

main().catch(err => {
  console.error("[RESEED][FATAL]", err);
  process.exit(1);
});

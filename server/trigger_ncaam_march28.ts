/**
 * trigger_ncaam_march28.ts
 * One-shot script to run the NCAAM model for March 28, 2026 with maximum
 * granularity, precision, and accuracy.
 *
 * Usage: npx tsx server/trigger_ncaam_march28.ts
 */

import "dotenv/config";
import { syncModelForDate } from "./ncaamModelSync.js";
import {
  listGamesByDate,
  setGameModelPublished,
  setGamePublished,
  getDb,
} from "./db.js";
import { games } from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";

const DATE = "2026-03-28";

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`NCAAM MODEL TRIGGER — ${DATE}`);
  console.log(`${"=".repeat(70)}\n`);

  // Step 1: Pre-run audit
  console.log("[AUDIT] Fetching current game state from DB...");
  const ncaamGames = await listGamesByDate(DATE, "NCAAM");

  console.log(`[AUDIT] Found ${ncaamGames.length} NCAAM games for ${DATE}:`);
  for (const g of ncaamGames) {
    const modelAge = g.modelRunAt
      ? `${Math.round((Date.now() - Number(g.modelRunAt)) / 60000)}m ago`
      : "never";
    console.log(
      `  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ` +
      `Start: ${g.startTimeEst} EST | ` +
      `Spread: ${g.awayBookSpread} | Total: ${g.bookTotal} | ` +
      `ML: ${g.awayML}/${g.homeML} | ` +
      `SpreadOdds: ${g.awaySpreadOdds}/${g.homeSpreadOdds} | ` +
      `O/U Odds: ${g.overOdds}/${g.underOdds} | ` +
      `Model: ${g.awayModelSpread ?? "none"} | ` +
      `ModelRunAt: ${modelAge} | ` +
      `Published: feed=${g.publishedToFeed} model=${g.publishedModel}`
    );
  }

  // Step 2: Run model (force re-run with fresh KenPom data + updated totals)
  console.log(`\n[MODEL] Running syncModelForDate("${DATE}", { skipExisting: false, concurrency: 1 })...`);
  console.log("[MODEL] This will fetch live KenPom data for all 4 teams and run 250k Monte Carlo sims per game.\n");

  const result = await syncModelForDate(DATE, {
    skipExisting: false,  // force re-run even if already modeled
    concurrency: 1,       // sequential to avoid KenPom rate limits
  });

  console.log(`\n${"=".repeat(70)}`);
  console.log(`MODEL RUN COMPLETE`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Date:      ${result.date}`);
  console.log(`Total:     ${result.totalGames} games`);
  console.log(`Ran:       ${result.ran}`);
  console.log(`Skipped:   ${result.skipped}`);
  console.log(`Failed:    ${result.failed}`);
  console.log(`Duration:  ${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.errors.length > 0) {
    console.log(`\nERRORS (${result.errors.length}):`);
    for (const e of result.errors) {
      console.log(`  ✗ ${e.game}: ${e.error}`);
    }
  }

  if (result.failed > 0) {
    console.error("\n[FATAL] Model run had failures — NOT publishing to feed.");
    process.exit(1);
  }

  // Step 3: Approve and publish both games to feed
  console.log(`\n[PUBLISH] Approving and publishing both games to feed...`);
  const gameIds = ncaamGames.map((g) => g.id);

  for (const id of gameIds) {
    await setGameModelPublished(id, true);
    await setGamePublished(id, true);
    console.log(`[PUBLISH] ✓ Game ${id}: publishedModel=true, publishedToFeed=true`);
  }

  console.log(`[PUBLISH] ✓ Published ${gameIds.length} games to feed: ${gameIds.join(", ")}`);

  // Step 4: Post-run validation
  console.log(`\n[VALIDATE] Fetching final DB state...`);
  const finalGames = await listGamesByDate(DATE, "NCAAM");

  console.log(`\n${"=".repeat(70)}`);
  console.log(`FINAL VALIDATION — ${DATE} NCAAM`);
  console.log(`${"=".repeat(70)}`);

  let allPassed = true;
  for (const g of finalGames as typeof finalGames) {
    const passed =
      g.awayModelSpread !== null &&
      g.modelTotal !== null &&
      g.modelAwayML !== null &&
      g.modelAwayScore !== null &&
      g.publishedToFeed === true &&
      g.publishedModel === true;

    if (!passed) allPassed = false;

    console.log(`\n  [${g.id}] ${g.awayTeam} @ ${g.homeTeam}`);
    console.log(`    Book:  Spread=${g.awayBookSpread} | Total=${g.bookTotal}`);
    console.log(`    Model: Spread=${g.awayModelSpread}/${g.homeModelSpread} | Total=${g.modelTotal}`);
    console.log(`    ML:    Away=${g.modelAwayML} | Home=${g.modelHomeML}`);
    console.log(`    Score: Away=${g.modelAwayScore} | Home=${g.modelHomeScore}`);
    console.log(`    Win%:  Away=${g.modelAwayWinPct}% | Home=${g.modelHomeWinPct}%`);
    console.log(`    O/U:   Over=${g.modelOverRate}% | Under=${g.modelUnderRate}%`);
    console.log(`    Fair Odds at Book Line: Spread=${g.modelAwaySpreadOdds}/${g.modelHomeSpreadOdds} | O/U=${g.modelOverOdds}/${g.modelUnderOdds}`);
    console.log(`    Spread Edge: ${g.spreadEdge ?? "none"}`);
    console.log(`    Total Edge:  ${g.totalEdge ?? "none"}`);
    console.log(`    Published:   feed=${g.publishedToFeed} model=${g.publishedModel} ${passed ? "✅" : "❌"}`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`OVERALL: ${allPassed ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);
  console.log(`${"=".repeat(70)}\n`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

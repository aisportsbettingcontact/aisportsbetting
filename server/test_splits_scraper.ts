/**
 * test_splits_scraper.ts
 * 
 * Live validation test for the rewritten vsinBettingSplitsScraper.ts
 * Tests both the unified scraper and the MLB-specific function.
 * 
 * Run: npx tsx server/test_splits_scraper.ts
 */

import { scrapeVsinBettingSplits, scrapeVsinMlbBettingSplits } from "./vsinBettingSplitsScraper";

async function main() {
  console.log("=".repeat(70));
  console.log("LIVE SCRAPER VALIDATION TEST — VSiN Betting Splits (sp-table format)");
  console.log("=".repeat(70));

  // ── Test 1: Unified scraper, all sports ──────────────────────────────────
  console.log("\n[TEST 1] scrapeVsinBettingSplits('front') — ALL SPORTS");
  console.log("-".repeat(60));
  
  let allGames;
  try {
    allGames = await scrapeVsinBettingSplits("front");
    console.log(`\n✅ Total games returned: ${allGames.length}`);
    
    const bySport: Record<string, number> = {};
    for (const g of allGames) {
      bySport[g.sport] = (bySport[g.sport] ?? 0) + 1;
    }
    console.log("Games by sport:", bySport);
    
    // Check for null percentages
    let nullCount = 0;
    for (const g of allGames) {
      const fields = [g.spreadAwayMoneyPct, g.spreadAwayBetsPct, g.totalOverMoneyPct, g.totalOverBetsPct, g.mlAwayMoneyPct, g.mlAwayBetsPct];
      if (fields.some(f => f === null)) nullCount++;
    }
    console.log(`Games with any null percentage: ${nullCount}/${allGames.length}`);
    
    // Validate percentages are in 0-100 range
    let outOfRange = 0;
    for (const g of allGames) {
      const fields = [g.spreadAwayMoneyPct, g.spreadAwayBetsPct, g.totalOverMoneyPct, g.totalOverBetsPct, g.mlAwayMoneyPct, g.mlAwayBetsPct];
      if (fields.some(f => f !== null && (f < 0 || f > 100))) outOfRange++;
    }
    console.log(`Games with out-of-range percentage: ${outOfRange}/${allGames.length}`);
    
  } catch (err) {
    console.error("❌ TEST 1 FAILED:", err);
    process.exit(1);
  }

  // ── Test 2: MLB-specific function ────────────────────────────────────────
  console.log("\n[TEST 2] scrapeVsinMlbBettingSplits() — MLB ONLY");
  console.log("-".repeat(60));
  
  let mlbGames;
  try {
    mlbGames = await scrapeVsinMlbBettingSplits();
    console.log(`\n✅ MLB games returned: ${mlbGames.length}`);
    
    if (mlbGames.length === 0) {
      console.error("❌ CRITICAL: MLB scraper returned 0 games — splits will not populate");
      process.exit(1);
    }
    
    // Print all MLB games with their splits
    console.log("\nMLB Games Detail:");
    for (const g of mlbGames) {
      const allPopulated = [g.spreadAwayMoneyPct, g.spreadAwayBetsPct, g.totalOverMoneyPct, g.totalOverBetsPct, g.mlAwayMoneyPct, g.mlAwayBetsPct].every(f => f !== null);
      const status = allPopulated ? "✅" : "⚠️ ";
      console.log(
        `  ${status} ${g.gameId} | ${g.awayName} @ ${g.homeName}` +
        ` | RL: ${g.spreadAwayMoneyPct}%H/${g.spreadAwayBetsPct}%B` +
        ` | Tot: ${g.totalOverMoneyPct}%H/${g.totalOverBetsPct}%B` +
        ` | ML: ${g.mlAwayMoneyPct}%H/${g.mlAwayBetsPct}%B`
      );
    }
    
  } catch (err) {
    console.error("❌ TEST 2 FAILED:", err);
    process.exit(1);
  }

  // ── Test 3: Sport-filtered scrape ────────────────────────────────────────
  console.log("\n[TEST 3] scrapeVsinBettingSplits('front', 'NBA') — NBA FILTER");
  console.log("-".repeat(60));
  
  try {
    const nbaGames = await scrapeVsinBettingSplits("front", "NBA");
    console.log(`✅ NBA games returned: ${nbaGames.length}`);
    
    const nonNba = nbaGames.filter(g => g.sport !== "NBA");
    if (nonNba.length > 0) {
      console.error(`❌ Filter broken: ${nonNba.length} non-NBA games returned`);
    } else {
      console.log("✅ Sport filter working correctly — all returned games are NBA");
    }
  } catch (err) {
    console.error("❌ TEST 3 FAILED:", err);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log(`SUMMARY: ${allGames!.length} total games, ${mlbGames!.length} MLB games`);
  console.log(`MLB splits ready to populate: ${mlbGames!.length > 0 ? "✅ YES" : "❌ NO"}`);
  console.log("=".repeat(70));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

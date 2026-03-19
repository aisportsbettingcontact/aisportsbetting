/**
 * Debug script: scrape VSiN NHL page and log all games/slugs/splits
 * to identify why NYI@OTT and NYR@CBJ are missing splits.
 */
import "dotenv/config";
import { scrapeNhlVsinOdds } from "../server/nhlVsinScraper";

async function main() {
  console.log("=== VSiN NHL Debug Scrape — March 19 ===");
  console.log(`Time: ${new Date().toISOString()}`);
  try {
    const results = await scrapeNhlVsinOdds("today");
    console.log(`\nTotal games returned: ${results.length}`);
    for (const r of results) {
      console.log(`\n  GAME: ${r.awaySlug} @ ${r.homeSlug}`);
      console.log(`    spreadBets:  away=${r.awaySpreadBetsPct}% home=${r.homeSpreadBetsPct ?? (r.awaySpreadBetsPct != null ? 100 - r.awaySpreadBetsPct : null)}%`);
      console.log(`    spreadMoney: away=${r.awaySpreadMoneyPct}%`);
      console.log(`    totalOver:   bets=${r.overBetsPct}% money=${r.overMoneyPct}%`);
      console.log(`    ml:          away=${r.awayMlBetsPct}% money=${r.awayMlMoneyPct}%`);
    }

    // Check specifically for the missing teams
    const missing = ['new_york_islanders', 'new_york_rangers', 'ottawa_senators', 'columbus_blue_jackets'];
    console.log('\n=== Missing team check ===');
    for (const slug of missing) {
      const found = results.find(r => r.awaySlug === slug || r.homeSlug === slug);
      console.log(`  ${slug}: ${found ? `FOUND in ${found.awaySlug} @ ${found.homeSlug}` : 'NOT FOUND'}`);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}
main();

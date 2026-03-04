/**
 * Direct test of scrapeVsinOdds to see what it returns.
 */
import dotenv from "dotenv";
dotenv.config();

// Use tsx to import TypeScript
const { scrapeVsinOdds } = await import("../server/vsinScraper.ts");

console.log("Calling scrapeVsinOdds('Mar 4')...");
const results = await scrapeVsinOdds("Mar 4");
console.log(`\nReturned ${results.length} games`);
if (results.length > 0) {
  console.log("\nFirst 5 results:");
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.awayTeam} vs ${r.homeTeam} — spread: ${r.awaySpread}, total: ${r.total}`);
  });
} else {
  console.log("No results returned!");
}
process.exit(0);

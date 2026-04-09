/**
 * test_vsin_live.mts
 * Live test of the VSiN betting splits scraper.
 * Run: npx tsx scripts/test_vsin_live.mts
 */
import { scrapeVsinBettingSplitsBothDays } from "../server/vsinBettingSplitsScraper.js";

console.log("[INPUT] Fetching VSiN betting splits (front + tomorrow)...");
const startTime = Date.now();

const results = await scrapeVsinBettingSplitsBothDays();

console.log(`[OUTPUT] Total games scraped: ${results.length} in ${Date.now() - startTime}ms`);

const bySport = results.reduce((acc, g) => {
  acc[g.sport] = (acc[g.sport] || 0) + 1;
  return acc;
}, {} as Record<string, number>);
console.log("[OUTPUT] By sport:", JSON.stringify(bySport));

let nullSpreads = 0, nullTotals = 0, nullMl = 0;
for (const g of results) {
  if (g.spreadAwayBetsPct === null) nullSpreads++;
  if (g.totalOverBetsPct === null) nullTotals++;
  if (g.mlAwayBetsPct === null) nullMl++;
  console.log(
    `[STATE] ${g.sport} | ${g.gameId} | ${g.awayVsinSlug} @ ${g.homeVsinSlug}` +
    ` | spread: ${g.spreadAwayBetsPct ?? "NULL"}%B / ${g.spreadAwayMoneyPct ?? "NULL"}%H` +
    ` | total: ${g.totalOverBetsPct ?? "NULL"}%B / ${g.totalOverMoneyPct ?? "NULL"}%H` +
    ` | ml: ${g.mlAwayBetsPct ?? "NULL"}%B / ${g.mlAwayMoneyPct ?? "NULL"}%H`
  );
}

console.log(`[VERIFY] Null spread: ${nullSpreads}/${results.length} | Null total: ${nullTotals}/${results.length} | Null ml: ${nullMl}/${results.length}`);
if (nullSpreads === 0 && nullTotals === 0 && nullMl === 0) {
  console.log("[VERIFY] PASS — All splits populated for all games");
} else {
  console.log("[VERIFY] WARN — Some splits are null (may be normal for early-day data)");
}

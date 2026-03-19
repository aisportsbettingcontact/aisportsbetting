/**
 * One-shot script: scrape VSiN NHL splits for 2026-03-19 and write to DB.
 * Run: npx tsx scripts/populateNhlSplitsMarch19.ts
 */
import { scrapeNhlVsinOdds } from "../server/nhlVsinScraper";
import { listStagingGames, updateBookOdds } from "../server/db";

async function main() {
  const gameDate = "2026-03-19";
  const dateLabel = "20260319";

  console.log("[NhlSplits] Scraping VSiN NHL for", dateLabel);
  const scraped = await scrapeNhlVsinOdds(dateLabel);
  console.log(`[NhlSplits] Scraped ${scraped.length} games from VSiN:`);
  for (const s of scraped) {
    console.log(`  ${s.awaySlug} @ ${s.homeSlug} | spread: ${s.awaySpread}/${s.homeSpread} | total: ${s.total} | ML: ${s.awayML}/${s.homeML}`);
    console.log(`    splits: spread ${s.spreadAwayBetsPct}%/${s.spreadAwayMoneyPct}% | total ${s.totalOverBetsPct}%/${s.totalOverMoneyPct}% | ml ${s.mlAwayBetsPct}%/${s.mlAwayMoneyPct}%`);
  }

  const dbGames = await listStagingGames(gameDate);
  const nhlGames = dbGames.filter(g => g.sport === "NHL");
  console.log(`\n[NhlSplits] Found ${nhlGames.length} NHL games in DB for ${gameDate}`);

  let updated = 0;
  let noMatch = 0;
  for (const game of nhlGames) {
    const match = scraped.find(
      (s) => s.awaySlug === game.awayTeam && s.homeSlug === game.homeTeam
    );
    if (match) {
      await updateBookOdds(game.id, {
        awayBookSpread: match.awaySpread,
        homeBookSpread: match.homeSpread,
        bookTotal: match.total,
        spreadAwayBetsPct: match.spreadAwayBetsPct,
        spreadAwayMoneyPct: match.spreadAwayMoneyPct,
        totalOverBetsPct: match.totalOverBetsPct,
        totalOverMoneyPct: match.totalOverMoneyPct,
        mlAwayBetsPct: match.mlAwayBetsPct,
        mlAwayMoneyPct: match.mlAwayMoneyPct,
        awayML: match.awayML,
        homeML: match.homeML,
      });
      console.log(`  [OK] ${game.awayTeam} @ ${game.homeTeam}`);
      updated++;
    } else {
      console.warn(`  [NO_MATCH] ${game.awayTeam} @ ${game.homeTeam}`);
      console.warn(`    Available: ${scraped.map(s => `${s.awaySlug}@${s.homeSlug}`).join(", ")}`);
      noMatch++;
    }
  }

  console.log(`\n[NhlSplits] Done: ${updated} updated, ${noMatch} no_match`);
  process.exit(0);
}

main().catch(err => {
  console.error("[NhlSplits] Fatal:", err);
  process.exit(1);
});

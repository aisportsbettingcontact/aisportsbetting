/**
 * One-shot script: scrape VSiN NHL splits for today and write to DB.
 * Run with: npx tsx server/discord/runNhlSplits.mts
 */
import { scrapeNhlVsinOdds } from "../nhlVsinScraper.js";
import { getDb } from "../db.js";
import { games } from "../../drizzle/schema.js";
import { and, eq } from "drizzle-orm";

const TARGET_DATE = "20260323"; // YYYYMMDD for VSiN

async function main() {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  NHL Splits Manual Refresh — ${TARGET_DATE}`);
  console.log(`══════════════════════════════════════════\n`);

  // 1. Scrape VSiN
  const scraped = await scrapeNhlVsinOdds(TARGET_DATE);
  console.log(`\n[runNhlSplits] Scraped ${scraped.length} game(s) from VSiN`);

  if (scraped.length === 0) {
    console.warn("[runNhlSplits] ⚠️  No games returned — VSiN may not have NHL splits posted yet for this date.");
    return;
  }

  // 2. Write to DB
  const db = await getDb();
  let updated = 0;
  let notFound = 0;

  for (const g of scraped) {
    console.log(`\n[runNhlSplits] Processing: ${g.awayTeam} (${g.awaySlug}) @ ${g.homeTeam} (${g.homeSlug})`);
    console.log(`  spreadBets=${g.spreadAwayBetsPct ?? "null"}% spreadMoney=${g.spreadAwayMoneyPct ?? "null"}%`);
    console.log(`  overBets=${g.totalOverBetsPct ?? "null"}%   overMoney=${g.totalOverMoneyPct ?? "null"}%`);
    console.log(`  mlBets=${g.mlAwayBetsPct ?? "null"}%     mlMoney=${g.mlAwayMoneyPct ?? "null"}%`);
    console.log(`  awayML=${g.awayML ?? "null"}  homeML=${g.homeML ?? "null"}`);

    // Convert YYYYMMDD → YYYY-MM-DD for DB
    const dbDate = `${g.gameDate.slice(0, 4)}-${g.gameDate.slice(4, 6)}-${g.gameDate.slice(6, 8)}`;

    const result = await db
      .update(games)
      .set({
        spreadAwayBetsPct:  g.spreadAwayBetsPct,
        spreadAwayMoneyPct: g.spreadAwayMoneyPct,
        totalOverBetsPct:   g.totalOverBetsPct,
        totalOverMoneyPct:  g.totalOverMoneyPct,
        mlAwayBetsPct:      g.mlAwayBetsPct,
        mlAwayMoneyPct:     g.mlAwayMoneyPct,
        awayML:             g.awayML,
        homeML:             g.homeML,
        ...(g.awaySpread !== null ? { spreadAway: g.awaySpread } : {}),
        ...(g.homeSpread !== null ? { spreadHome: g.homeSpread } : {}),
        ...(g.total !== null ? { total: g.total } : {}),
      })
      .where(
        and(
          eq(games.awayTeam, g.awaySlug),
          eq(games.homeTeam, g.homeSlug),
          eq(games.gameDate, dbDate),
          eq(games.sport, "NHL")
        )
      );

    // Drizzle with mysql2 returns [{fieldCount, affectedRows, ...}]
    const rowsAffected = (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
    if (rowsAffected > 0) {
      console.log(`  ✅ DB updated (${rowsAffected} row)`);
      updated++;
    } else {
      console.warn(`  ⚠️  No DB row matched for ${g.awaySlug} @ ${g.homeSlug} on ${dbDate}`);
      notFound++;
    }
  }

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Done — updated=${updated}  notFound=${notFound}`);
  console.log(`══════════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error("[runNhlSplits] FATAL:", err);
  process.exit(1);
});

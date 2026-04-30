/**
 * rerun_missing_odds.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Check Apr 12 games that were skipped due to "missing book lines" and
 * re-run the model for any that now have odds.
 *
 * Run with: npx tsx scripts/rerun_missing_odds.ts
 */

import { getDb } from "../server/db.js";
import { games } from "../drizzle/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { runMlbModelForDate } from "../server/mlbModelRunner.js";

const TARGET_DATE = "2026-04-12";

async function main() {
  const db = await getDb();
  if (!db) { console.error("[FATAL] DB not available"); process.exit(1); }

  // Check all Apr 12 MLB games — show odds status
  const rows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayML: games.awayML,
      homeML: games.homeML,
      bookTotal: games.bookTotal,
      awayRunLine: games.awayRunLine,
      homeRunLine: games.homeRunLine,
      awayRunLineOdds: games.awayRunLineOdds,
      homeRunLineOdds: games.homeRunLineOdds,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
      publishedModel: games.publishedModel,
    })
    .from(games)
    .where(and(eq(games.gameDate, TARGET_DATE), eq(games.sport, "MLB")));

  console.log(`\nApr 12 MLB games: ${rows.length}\n`);
  for (const r of rows) {
    const hasML = r.awayML && r.homeML;
    const hasTotal = r.bookTotal && parseFloat(String(r.bookTotal)) > 0;
    const hasRunLine = r.awayRunLine && r.homeRunLine;
    const hasLines = hasML && hasTotal;
    const hasPitchers = r.awayStartingPitcher && r.homeStartingPitcher;
    const status = r.publishedModel ? "✅ PUBLISHED" : hasLines && hasPitchers ? "🟡 READY (not yet modeled)" : `❌ SKIP (${!hasLines ? "no odds" : ""}${!hasPitchers ? " no pitchers" : ""})`;
    console.log(`  [${r.id}] ${r.awayTeam}@${r.homeTeam}: ML=${r.awayML ?? "null"}/${r.homeML ?? "null"} total=${r.bookTotal ?? "null"} RL=${r.awayRunLine ?? "null"} — ${status}`);
  }

  // Re-run model — it will pick up any newly-available games
  console.log("\nRe-running MLB model for Apr 12...");
  const result = await runMlbModelForDate(TARGET_DATE);
  console.log(`\nResult: total=${result.total} written=${result.written} skipped=${result.skipped} errors=${result.errors}`);

  process.exit(0);
}

main().catch(err => { console.error("[FATAL]", err); process.exit(1); });

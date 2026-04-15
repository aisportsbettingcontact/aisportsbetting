/**
 * checkF5WinPct.mts — Quick DB check to verify modelF5AwayWinPct / modelF5HomeWinPct scale and values.
 * Run: npx tsx scripts/checkF5WinPct.mts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, isNotNull, isNull } from "drizzle-orm";

const db = await getDb();

// Sample 3 April 15 games
const sample = await db
  .select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameDate: games.gameDate,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    modelF5HomeWinPct: games.modelF5HomeWinPct,
  })
  .from(games)
  .where(eq(games.gameDate, "2026-04-15"))
  .limit(3);

console.log("[SAMPLE] April 15 games (first 3):");
for (const r of sample) {
  console.log(`  id=${r.id} ${r.awayTeam}@${r.homeTeam} | F5Away=${r.modelF5AwayWinPct} | F5Home=${r.modelF5HomeWinPct}`);
}

// Count nulls across all 2026 games
const allGames = await db
  .select({
    id: games.id,
    gameDate: games.gameDate,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    modelF5HomeWinPct: games.modelF5HomeWinPct,
    modelRunAt: games.modelRunAt,
  })
  .from(games)
  .where(eq(games.sport, "MLB"));

const modeled = allGames.filter(g => g.modelRunAt !== null);
const nullAway = modeled.filter(g => g.modelF5AwayWinPct === null);
const nullHome = modeled.filter(g => g.modelF5HomeWinPct === null);

console.log(`\n[SUMMARY] Total MLB games: ${allGames.length}`);
console.log(`[SUMMARY] Modeled (modelRunAt != null): ${modeled.length}`);
console.log(`[SUMMARY] NULL modelF5AwayWinPct: ${nullAway.length}`);
console.log(`[SUMMARY] NULL modelF5HomeWinPct: ${nullHome.length}`);

if (nullAway.length > 0) {
  console.log("\n[NULL AWAY] First 10 games missing modelF5AwayWinPct:");
  for (const g of nullAway.slice(0, 10)) {
    console.log(`  id=${g.id} ${g.gameDate} ${g.awayTeam}@${g.homeTeam}`);
  }
}

process.exit(0);

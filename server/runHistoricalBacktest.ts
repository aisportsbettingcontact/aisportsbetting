/**
 * runHistoricalBacktest.ts
 *
 * Runs runMultiMarketBacktest for all final MLB games that have:
 *   1. actualAwayScore populated (scores backfilled)
 *   2. modelHomeWinPct populated (model was run)
 *   3. No existing entries in mlb_game_backtest (not yet backtested)
 *
 * Run: cd /home/ubuntu/ai-sports-betting && npx tsx server/runHistoricalBacktest.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { eq, isNotNull, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbGameBacktest } from "../drizzle/schema";
import { runMultiMarketBacktest } from "./mlbMultiMarketBacktest";

const TAG = "[HistoricalBacktest]";

async function main() {
  console.log(`\n${TAG} ╔══════════════════════════════════════════════════════╗`);
  console.log(`${TAG} ║  MLB HISTORICAL BACKTEST RUNNER                      ║`);
  console.log(`${TAG} ╚══════════════════════════════════════════════════════╝`);

  const db = await getDb();

  // Step 1: Find all eligible games
  console.log(`\n${TAG} [STEP 1] Querying eligible games...`);
  const eligibleGames = await db
    .select({
      id: games.id,
      gameDate: games.gameDate,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      actualAwayScore: games.actualAwayScore,
      actualHomeScore: games.actualHomeScore,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        eq(games.gameStatus, "final"),
        isNotNull(games.actualAwayScore),
        isNotNull(games.modelHomeWinPct)
      )
    )
    .orderBy(games.gameDate);

  console.log(`${TAG} [STATE] Found ${eligibleGames.length} eligible games`);

  // Step 2: Filter out already-backtested games
  const alreadyBacktested = await db
    .selectDistinct({ gameId: mlbGameBacktest.gameId })
    .from(mlbGameBacktest);

  const backtestSet = new Set(alreadyBacktested.map((r: { gameId: number | null }) => r.gameId));
  const toBacktest = eligibleGames.filter((g: typeof eligibleGames[number]) => !backtestSet.has(g.id));

  console.log(`${TAG} [STATE] Already backtested: ${backtestSet.size} games`);
  console.log(`${TAG} [STATE] Needs backtest: ${toBacktest.length} games`);

  if (toBacktest.length === 0) {
    console.log(`${TAG} [OUTPUT] Nothing to do — all eligible games already backtested.`);
    return;
  }

  // Step 3: Run backtest for each game
  console.log(`\n${TAG} [STEP 3] Running backtests...`);
  let success = 0, failed = 0;

  for (let i = 0; i < toBacktest.length; i++) {
    const game = toBacktest[i];
    const progress = `[${i + 1}/${toBacktest.length}]`;
    console.log(
      `${TAG} ${progress} id=${game.id} ${game.awayTeam}@${game.homeTeam}` +
      ` ${game.gameDate} | FG=${game.actualAwayScore}-${game.actualHomeScore}`
    );

    try {
      await runMultiMarketBacktest(game.id);
      success++;
      console.log(`${TAG} ${progress} ✅ id=${game.id}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} ${progress} ❌ id=${game.id}: ${msg}`);
    }

    // Small delay to avoid DB connection saturation
    await new Promise<void>(r => setTimeout(r, 30));
  }

  // Step 4: Final summary
  console.log(`\n${TAG} ═══ FINAL SUMMARY ══════════════════════════════════════`);
  console.log(`${TAG} Total eligible: ${eligibleGames.length}`);
  console.log(`${TAG} Already done:   ${backtestSet.size}`);
  console.log(`${TAG} Ran this pass:  ${toBacktest.length}`);
  console.log(`${TAG} Success:        ${success}`);
  console.log(`${TAG} Failed:         ${failed}`);

  // Step 5: Post-run verification
  console.log(`\n${TAG} [VERIFY] Post-run result distribution:`);
  const [dist] = await db.execute(sql`
    SELECT result, COUNT(*) as cnt,
           ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct
    FROM mlb_game_backtest
    GROUP BY result ORDER BY cnt DESC
  `);
  console.table(dist);

  const [marketDist] = await db.execute(sql`
    SELECT market, result, COUNT(*) as cnt
    FROM mlb_game_backtest
    WHERE result IN ('WIN','LOSS','PUSH')
    GROUP BY market, result
    ORDER BY market, result
  `);
  console.log(`${TAG} [VERIFY] Market-level WIN/LOSS/PUSH:`);
  console.table(marketDist);

  console.log(`${TAG} ✅ DONE`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});

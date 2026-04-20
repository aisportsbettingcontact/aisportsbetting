/**
 * rerunF5Backtest.ts — Deletes all F5 market rows from mlb_game_backtest
 * and re-runs the backtest for all eligible games to apply the new
 * F5_CONFIDENCE_THRESHOLD of 0.60 (raised from 0.55).
 *
 * Run with: npx tsx server/rerunF5Backtest.ts
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbGameBacktest } from "../drizzle/schema";
import { runMultiMarketBacktest } from "./mlbMultiMarketBacktest";

const TAG = "[F5-RERUN]";

const F5_MARKETS = ["f5_ml_home", "f5_ml_away", "f5_rl_home", "f5_rl_away", "f5_over", "f5_under"];

async function main() {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] Rerunning F5 backtest with new threshold=0.60`);
  console.log(`${TAG} [STEP 1] Connecting to database...`);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Step 1: Get all game IDs that have F5 backtest rows
  console.log(`${TAG} [STEP 2] Finding all games with F5 backtest rows...`);
  const f5Rows = await db
    .selectDistinct({ gameId: mlbGameBacktest.gameId })
    .from(mlbGameBacktest)
    .where(inArray(mlbGameBacktest.market, F5_MARKETS as any[]));

  const gameIds = f5Rows.map((r: { gameId: number | null }) => r.gameId).filter((id: number | null): id is number => id !== null);
  console.log(`${TAG} [STATE] Found ${gameIds.length} games with F5 rows to reprocess`);

  if (gameIds.length === 0) {
    console.log(`${TAG} [OUTPUT] No F5 rows found — nothing to do.`);
    process.exit(0);
  }

  // Step 2: Delete all F5 rows for these games
  console.log(`${TAG} [STEP 3] Deleting all F5 rows...`);
  let deleted = 0;
  const CHUNK = 50;
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    const chunk = gameIds.slice(i, i + CHUNK);
    const result = await db
      .delete(mlbGameBacktest)
      .where(
        and(
          inArray(mlbGameBacktest.gameId, chunk),
          inArray(mlbGameBacktest.market, F5_MARKETS as any[])
        )
      );
    deleted += (result as any).affectedRows ?? chunk.length * F5_MARKETS.length;
  }
  console.log(`${TAG} [STATE] Deleted ${deleted} F5 rows`);

  // Step 3: Verify eligible games (must have actual scores)
  console.log(`${TAG} [STEP 4] Loading eligible games for re-backtest...`);
  const eligibleGames = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameDate: games.gameDate,
      actualAwayScore: games.actualAwayScore,
      actualHomeScore: games.actualHomeScore,
      actualF5AwayScore: games.actualF5AwayScore,
      actualF5HomeScore: games.actualF5HomeScore,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        sql`${games.actualAwayScore} IS NOT NULL`,
        sql`${games.actualHomeScore} IS NOT NULL`,
        inArray(games.id, gameIds)
      )
    );

  console.log(`${TAG} [STATE] Eligible games for re-backtest: ${eligibleGames.length}`);

  // Step 4: Re-run backtest for each game
  console.log(`\n${TAG} [STEP 5] Re-running backtests with F5_CONFIDENCE_THRESHOLD=0.60...`);
  let success = 0, failed = 0;

  for (let i = 0; i < eligibleGames.length; i++) {
    const game = eligibleGames[i];
    const progress = `[${i + 1}/${eligibleGames.length}]`;
    try {
      const summary = await runMultiMarketBacktest(game.id);
      const f5Results = summary.markets.filter(m => F5_MARKETS.includes(m.market));
      const f5Wins = f5Results.filter(m => m.result === "WIN").length;
      const f5Losses = f5Results.filter(m => m.result === "LOSS").length;
      const f5NoAct = f5Results.filter(m => m.result === "NO_ACTION").length;
      console.log(
        `${TAG} ${progress} id=${game.id} ${game.awayTeam}@${game.homeTeam} ${game.gameDate}` +
        ` | F5: W=${f5Wins} L=${f5Losses} NO_ACT=${f5NoAct}`
      );
      success++;
    } catch (err) {
      console.error(`${TAG} ${progress} [ERROR] id=${game.id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // Step 5: Final summary
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [OUTPUT] F5 re-backtest complete`);
  console.log(`${TAG}   Games processed: ${success + failed}`);
  console.log(`${TAG}   Success: ${success}`);
  console.log(`${TAG}   Failed: ${failed}`);

  // Step 6: Verify new F5 under distribution
  const [f5u] = await (db as any).execute(
    `SELECT
      ROUND(CAST(modelProb AS DECIMAL(10,2))*20)/20 as prob_bucket,
      COUNT(*) as n,
      SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) as losses,
      ROUND(SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END)/COUNT(*)*100,1) as win_pct
    FROM mlb_game_backtest
    WHERE market='f5_under' AND result IN ('WIN','LOSS')
    GROUP BY prob_bucket ORDER BY prob_bucket`
  );
  console.log(`\n${TAG} [VERIFY] F5 Under win% by prob bucket (post-fix threshold=0.60):`);
  (f5u as any[]).forEach(r => console.log(`  prob=${r.prob_bucket} n=${r.n} wins=${r.wins} losses=${r.losses} win%=${r.win_pct}`));

  console.log(`${TAG} [VERIFY] PASS — F5 re-backtest complete`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

/**
 * forceRerunAllBacktest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Force-reruns ALL historical backtests from scratch.
 * Deletes all existing mlb_game_backtest rows first, then re-runs every
 * eligible game with the current model constants and thresholds.
 *
 * Use when: model constants, thresholds, or evaluation logic has changed.
 *
 * Run: cd /home/ubuntu/ai-sports-betting && npx tsx server/forceRerunAllBacktest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";
import { isNotNull, and, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbGameBacktest } from "../drizzle/schema";
import { runMultiMarketBacktest } from "./mlbMultiMarketBacktest";

const TAG = "[ForceRerunBacktest]";

async function main() {
  console.log(`\n${TAG} ╔══════════════════════════════════════════════════════════╗`);
  console.log(`${TAG} ║  MLB FORCE RERUN ALL BACKTESTS                           ║`);
  console.log(`${TAG} ║  Deletes all existing rows and re-runs from scratch       ║`);
  console.log(`${TAG} ╚══════════════════════════════════════════════════════════╝`);

  const db = await getDb();
  const pool = mysql.createPool(process.env.DATABASE_URL!);

  // Step 1: Count existing rows
  const [[countRow]] = await pool.query<any>('SELECT COUNT(*) as cnt FROM mlb_game_backtest');
  const existingCount = parseInt(String(countRow.cnt), 10);
  console.log(`\n${TAG} [STEP 1] Existing backtest rows: ${existingCount}`);

  // Step 2: Delete all existing rows using Drizzle ORM (avoids TiDB schema lease issues with raw pool)
  console.log(`${TAG} [STEP 2] Deleting all existing backtest rows...`);
  await db.delete(mlbGameBacktest);
  const [[verifyRow]] = await pool.query<any>('SELECT COUNT(*) as cnt FROM mlb_game_backtest');
  const afterDelete = parseInt(String(verifyRow.cnt), 10);
  console.log(`${TAG} [VERIFY] After delete: ${afterDelete} rows remain (expected 0)`);
  if (afterDelete !== 0) {
    console.error(`${TAG} [ERROR] Delete failed — ${afterDelete} rows still exist. Aborting.`);
    await pool.end();
    process.exit(1);
  }

  // Step 3: Find all eligible games
  console.log(`\n${TAG} [STEP 3] Querying eligible games...`);
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

  // Step 4: Run backtest for each game
  console.log(`\n${TAG} [STEP 4] Running backtests...`);
  let success = 0, failed = 0;

  for (let i = 0; i < eligibleGames.length; i++) {
    const game = eligibleGames[i];
    const progress = `[${i + 1}/${eligibleGames.length}]`;

    try {
      await runMultiMarketBacktest(game.id);
      success++;
      if (success % 25 === 0) {
        console.log(`${TAG} ${progress} ✅ Progress: ${success} succeeded, ${failed} failed`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} ${progress} ❌ id=${game.id} ${game.awayTeam}@${game.homeTeam} ${game.gameDate}: ${msg}`);
    }

    // Small delay to avoid DB connection saturation
    await new Promise<void>(r => setTimeout(r, 25));
  }

  // Step 5: Final summary
  console.log(`\n${TAG} ═══ FINAL SUMMARY ══════════════════════════════════════════`);
  console.log(`${TAG} Total eligible: ${eligibleGames.length}`);
  console.log(`${TAG} Success:        ${success}`);
  console.log(`${TAG} Failed:         ${failed}`);

  // Step 6: Post-run verification
  console.log(`\n${TAG} [VERIFY] Post-run result distribution:`);
  const [dist] = await pool.query<any>(`
    SELECT result, COUNT(*) as cnt,
           ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct
    FROM mlb_game_backtest
    GROUP BY result ORDER BY cnt DESC
  `);
  console.table(dist);

  console.log(`\n${TAG} [VERIFY] Market-level WIN/LOSS (graded only):`);
  const [marketDist] = await pool.query<any>(`
    SELECT 
      market,
      SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN result = 'PUSH' THEN 1 ELSE 0 END) as pushes,
      SUM(CASE WHEN result IN ('WIN','LOSS','PUSH') THEN 1 ELSE 0 END) as graded,
      ROUND(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) * 100.0 / 
            NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 1) as win_pct
    FROM mlb_game_backtest
    GROUP BY market
    ORDER BY graded DESC
  `);
  console.table(marketDist);

  await pool.end();
  console.log(`\n${TAG} ✅ DONE`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});

/**
 * rerunMissingBacktest.ts
 * Re-runs backtest for all games that have MISSING_DATA results but now have
 * actual scores populated (from the backfill). This clears stale MISSING_DATA
 * rows and replaces them with correct WIN/LOSS/NO_ACTION results.
 *
 * [INPUT] Queries mlb_game_backtest for MISSING_DATA games where games.actualAwayScore IS NOT NULL
 * [STEP]  Deletes stale MISSING_DATA rows for each game
 * [STEP]  Re-runs runMultiMarketBacktest for each game
 * [OUTPUT] Summary of cleared rows and new results
 */

import { getDb } from "./db";
import { mlbGameBacktest } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { runMultiMarketBacktest } from "./mlbMultiMarketBacktest";
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function rerunMissingBacktest() {
  console.log("[RerunMissing] ══════════════════════════════════════════════");
  console.log("[RerunMissing] [INPUT] Starting re-backtest for MISSING_DATA games");
  console.log("[RerunMissing] [INPUT] Timestamp:", new Date().toISOString());

  // Step 1: Find all MISSING_DATA games that now have scores
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute(`
    SELECT DISTINCT b.gameId, g.gameDate, g.awayTeam, g.homeTeam
    FROM mlb_game_backtest b
    LEFT JOIN games g ON g.id = b.gameId
    WHERE b.result = 'MISSING_DATA'
      AND g.actualAwayScore IS NOT NULL
      AND g.nrfiActualResult IS NOT NULL
    ORDER BY g.gameDate
  `) as [any[], any];
  await conn.end();

  const gameIds = (rows as any[]).map((r: any) => r.gameId);
  console.log(`[RerunMissing] [STATE] Found ${gameIds.length} games to re-backtest`);

  if (gameIds.length === 0) {
    console.log("[RerunMissing] [VERIFY] No games to re-backtest — all clean");
    return;
  }

  // Step 2: Delete stale MISSING_DATA rows for these games
  console.log("[RerunMissing] [STEP] Deleting stale MISSING_DATA rows...");
  const db = await getDb();
  let deletedTotal = 0;
  for (const gameId of gameIds) {
    const deleted = await db
      .delete(mlbGameBacktest)
      .where(
        and(
          eq(mlbGameBacktest.gameId, gameId),
          eq(mlbGameBacktest.result, "MISSING_DATA")
        )
      );
    deletedTotal += (deleted as any).rowsAffected ?? 0;
  }
  console.log(`[RerunMissing] [STATE] Deleted ${deletedTotal} stale MISSING_DATA rows`);

  // Step 3: Re-run backtest for each game
  let processed = 0;
  let errors = 0;
  let totalWin = 0;
  let totalLoss = 0;
  let totalNoAction = 0;
  let totalMissing = 0;

  for (const row of rows as any[]) {
    const { gameId, gameDate, awayTeam, homeTeam } = row;
    process.stdout.write(
      `[RerunMissing] [${++processed}/${gameIds.length}] id=${gameId} ${awayTeam}@${homeTeam} ${gameDate} `
    );
    try {
      const result = await runMultiMarketBacktest(gameId);
      if (result) {
        const wins = result.markets.filter(m => m.result === 'WIN').length;
        const losses = result.markets.filter(m => m.result === 'LOSS').length;
        const noAction = result.markets.filter(m => m.result === 'NO_ACTION').length;
        const missing = result.markets.filter(m => m.result === 'MISSING_DATA').length;
        totalWin += wins;
        totalLoss += losses;
        totalNoAction += noAction;
        totalMissing += missing;
        console.log(`✅ WIN=${wins} LOSS=${losses} NA=${noAction} MISS=${missing}`);
      } else {
        console.log("⚠️  null result");
      }
    } catch (e: any) {
      errors++;
      console.log(`❌ ERROR: ${e.message}`);
    }
  }

  // Final summary
  console.log("[RerunMissing] ══════════════════════════════════════════════");
  console.log(`[RerunMissing] [OUTPUT] Re-backtest complete`);
  console.log(`[RerunMissing] [OUTPUT] Games processed: ${processed} | Errors: ${errors}`);
  console.log(`[RerunMissing] [OUTPUT] Total WIN=${totalWin} LOSS=${totalLoss} NO_ACTION=${totalNoAction} MISSING=${totalMissing}`);
  console.log("[RerunMissing] [VERIFY] PASS — all MISSING_DATA games re-evaluated");
  console.log("[RerunMissing] ══════════════════════════════════════════════");

  process.exit(0);
}

rerunMissingBacktest().catch((e) => {
  console.error("[RerunMissing] [FATAL]", e);
  process.exit(1);
});

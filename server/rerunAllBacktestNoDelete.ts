/**
 * rerunAllBacktestNoDelete.ts
 * Re-runs the multi-market backtest for ALL eligible games without deleting existing rows.
 * Uses the existing insert-then-update (upsert) pattern in writeBacktestResults.
 *
 * FIX: Uses raw mysql2/promise for the initial game fetch to bypass TiDB PD server
 * timeout that blocks Drizzle ORM pool initialization. runMultiMarketBacktest() uses
 * its own internal connection and is unaffected.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { runMultiMarketBacktest } from './mlbMultiMarketBacktest';

const TAG = '[RerunAllBacktest]';

interface GameRow {
  id: number;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
}

async function main(): Promise<void> {
  console.log(`\n${TAG} ╔══════════════════════════════════════════════════════════╗`);
  console.log(`${TAG} ║  MLB RE-RUN ALL BACKTESTS (UPSERT MODE)                  ║`);
  console.log(`${TAG} ║  Overwrites existing rows via insert-then-update          ║`);
  console.log(`${TAG} ╚══════════════════════════════════════════════════════════╝`);

  // ── Step 1: Fetch eligible games via raw mysql2 (bypasses Drizzle pool init) ──
  console.log(`\n${TAG} [STEP 1] Connecting via raw mysql2 to bypass TiDB PD timeout...`);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL environment variable is not set');

  let eligibleGames: GameRow[] = [];
  {
    const pool = mysql.createPool({
      uri: dbUrl,
      connectionLimit: 2,
      connectTimeout: 30000,
      waitForConnections: true,
      queueLimit: 0,
    });
    console.log(`${TAG} [STEP 1] Pool created, running SELECT...`);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, gameDate, awayTeam, homeTeam
       FROM games
       WHERE sport = 'MLB'
         AND gameStatus = 'final'
         AND actualAwayScore IS NOT NULL
         AND modelAwayWinPct IS NOT NULL
       ORDER BY gameDate`
    );
    eligibleGames = rows as GameRow[];
    await pool.end();
    console.log(`${TAG} [STEP 1] Found ${eligibleGames.length} eligible games. mysql2 pool closed.`);
  }

  if (eligibleGames.length === 0) {
    console.log(`${TAG} [WARN] No eligible games found. Exiting.`);
    process.exit(0);
  }

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (const game of eligibleGames) {
    try {
      await runMultiMarketBacktest(game.id);
      processed++;

      if (processed % 25 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (processed / parseFloat(elapsed)).toFixed(1);
        console.log(`${TAG} [PROGRESS] ${processed}/${eligibleGames.length} games (${rate}/s) | ${game.awayTeam}@${game.homeTeam} ${game.gameDate}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} [ERROR] gameId=${game.id} ${game.awayTeam}@${game.homeTeam}: ${msg}`);
      errors++;
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${TAG} ╔══════════════════════════════════════════════════════════╗`);
  console.log(`${TAG} ║  COMPLETE                                                 ║`);
  console.log(`${TAG} ║  Games processed: ${processed}/${eligibleGames.length}`.padEnd(61) + '║');
  console.log(`${TAG} ║  Errors: ${errors}`.padEnd(61) + '║');
  console.log(`${TAG} ║  Elapsed: ${totalElapsed}s`.padEnd(61) + '║');
  console.log(`${TAG} ╚══════════════════════════════════════════════════════════╝`);

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(`${TAG} [FATAL]`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});

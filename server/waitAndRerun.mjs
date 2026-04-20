/**
 * waitAndRerun.mjs
 * Polls TiDB every 30 seconds until connectivity is restored,
 * then auto-launches the full re-backtest.
 *
 * Usage: node server/waitAndRerun.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const TAG = '[WaitAndRerun]';
const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 120; // 60 minutes max wait

async function testDbConnection() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 1,
    connectTimeout: 10000,
    waitForConnections: true,
    queueLimit: 0,
  });
  try {
    const [rows] = await pool.query('SELECT 1 as ok');
    return rows[0]?.ok === 1;
  } catch {
    return false;
  } finally {
    try { await pool.end(); } catch {}
  }
}

async function main() {
  console.log(`${TAG} Starting TiDB connectivity monitor...`);
  console.log(`${TAG} Will poll every ${POLL_INTERVAL_MS / 1000}s for up to ${MAX_ATTEMPTS} attempts`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ts = new Date().toISOString();
    const isUp = await testDbConnection();

    if (isUp) {
      console.log(`\n${TAG} [${ts}] ✅ TiDB is ONLINE after ${attempt} attempts!`);
      console.log(`${TAG} Launching rerunAllBacktestNoDelete.ts...`);

      // Launch the backtest
      const { spawn } = await import('child_process');
      const child = spawn(
        'npx', ['tsx', 'server/rerunAllBacktestNoDelete.ts'],
        {
          cwd: '/home/ubuntu/ai-sports-betting',
          stdio: 'inherit',
          env: process.env,
        }
      );

      child.on('close', (code) => {
        console.log(`${TAG} Backtest process exited with code ${code}`);
        process.exit(code ?? 0);
      });

      child.on('error', (err) => {
        console.error(`${TAG} Failed to spawn backtest: ${err.message}`);
        process.exit(1);
      });

      return; // Don't continue polling
    } else {
      console.log(`${TAG} [${ts}] Attempt ${attempt}/${MAX_ATTEMPTS}: TiDB still down. Retrying in ${POLL_INTERVAL_MS / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  console.error(`${TAG} [FATAL] TiDB did not recover after ${MAX_ATTEMPTS} attempts. Giving up.`);
  process.exit(1);
}

main().catch(err => {
  console.error(`${TAG} [FATAL]`, err.message);
  process.exit(1);
});

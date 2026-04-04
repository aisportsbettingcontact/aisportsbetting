/**
 * run_ncaam_model_apr4.ts
 * Run NCAAM model for April 4, 2026 Final Four games
 */
import { triggerModelWatcherForDate } from "../server/ncaamModelWatcher.js";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DATE = "2026-04-04";
const TAG = "[NCAAM-Model-Apr4]";

async function main() {
  console.log(`${TAG} Running NCAAM model for ${DATE}...`);
  
  const result = await triggerModelWatcherForDate(DATE, { forceRerun: true });
  console.log(`${TAG} [OUTPUT] triggered=${result.triggered} skipped=${result.skipped}`);
  
  // Verify
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<any[]>(
    `SELECT id, awayTeam, homeTeam, awayModelSpread, modelTotal, modelAwayWinPct, modelHomeWinPct, bracketRound, publishedToFeed
     FROM games WHERE sport='NCAAM' AND gameDate=? AND publishedToFeed=1`,
    [DATE]
  );
  console.log(`${TAG} [VERIFY] Published NCAAM games with model: ${rows.length}`);
  rows.forEach(g => {
    const model = g.awayModelSpread
      ? `spread=${g.awayModelSpread} total=${g.modelTotal} win=${g.modelAwayWinPct}%/${g.modelHomeWinPct}%`
      : "⚠ NO MODEL";
    console.log(`  [${g.bracketRound}] id=${g.id} | ${g.awayTeam}@${g.homeTeam} | ${model} | published=${g.publishedToFeed}`);
  });
  await conn.end();
}

main().catch(e => {
  console.error(`${TAG} [ERROR]`, e.message);
  process.exit(1);
});

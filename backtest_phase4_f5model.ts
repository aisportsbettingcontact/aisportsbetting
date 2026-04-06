/**
 * backtest_phase4_f5model.ts
 * ==========================
 * Retroactive F5/NRFI pipeline for March 25 – April 5, 2026.
 *
 * For each date:
 *   Step 1: scrapeAndStoreF5Nrfi(date)     → pull AN F5/NRFI odds into games table
 *   Step 2: runMlbModelForDate(date)        → run full MLB model (F5 model included)
 *   Step 3: runMultiMarketBacktestForDate(date) → evaluate F5 ML/RL/Total results
 *
 * Logs every step with [INPUT], [STEP], [STATE], [OUTPUT], [VERIFY] format.
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

const DATES = [
  "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29",
  "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03",
  "2026-04-04", "2026-04-05"
];

async function checkF5State(conn: mysql2.Connection, date: string) {
  const [rows] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN f5AwayML IS NOT NULL THEN 1 ELSE 0 END) as hasOdds,
      SUM(CASE WHEN modelF5AwayWinPct IS NOT NULL THEN 1 ELSE 0 END) as hasModel,
      SUM(CASE WHEN f5MlResult IS NOT NULL THEN 1 ELSE 0 END) as hasResult,
      SUM(CASE WHEN actualF5AwayScore IS NOT NULL THEN 1 ELSE 0 END) as hasActuals,
      SUM(CASE WHEN nrfiActualResult IS NOT NULL THEN 1 ELSE 0 END) as hasNrfiResult,
      SUM(CASE WHEN modelPNrfi IS NOT NULL THEN 1 ELSE 0 END) as hasNrfiModel
    FROM games WHERE sport='MLB' AND gameDate=?
  `, [date]);
  return rows[0] as any;
}

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

  console.log("[INPUT] Retroactive F5/NRFI pipeline: March 25 – April 5, 2026");
  console.log(`[INPUT] Dates: ${DATES.join(", ")}`);
  console.log("");

  let totalOddsScraped = 0;
  let totalModeled = 0;
  let totalBacktested = 0;
  let totalErrors = 0;

  for (const date of DATES) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`[STEP] Processing ${date}`);

    // Check current state
    const state = await checkF5State(conn, date);
    console.log(`[STATE] ${date}: total=${state.total} hasOdds=${state.hasOdds} hasModel=${state.hasModel} hasResult=${state.hasResult} hasActuals=${state.hasActuals} hasNrfiModel=${state.hasNrfiModel} hasNrfiResult=${state.hasNrfiResult}`);

    // ── Step 1: Scrape F5/NRFI odds from AN ──────────────────────────────────
    if (Number(state.hasOdds) < Number(state.total)) {
      console.log(`[STEP] ${date} Step 1: Scraping F5/NRFI odds from Action Network...`);
      try {
        const { scrapeAndStoreF5Nrfi } = await import("./server/mlbF5NrfiScraper");
        const r = await scrapeAndStoreF5Nrfi(date);
        console.log(`[OUTPUT] ${date} F5 scrape: matched=${r.matched} updated=${r.updated} errors=${r.errors}`);
        totalOddsScraped += r.updated;
      } catch (err) {
        console.error(`[VERIFY] FAIL ${date} F5 scrape: ${err instanceof Error ? err.message : String(err)}`);
        totalErrors++;
        // Continue — partial data is still useful
      }
    } else {
      console.log(`[STATE] ${date} Step 1: F5 odds already present (${state.hasOdds}/${state.total}), skipping`);
    }

    // ── Step 2: Run MLB model for date ────────────────────────────────────────
    if (Number(state.hasModel) < Number(state.total) && Number(state.hasOdds) > 0) {
      // Re-check odds after scrape
      const stateAfterScrape = await checkF5State(conn, date);
      if (Number(stateAfterScrape.hasOdds) > 0) {
        console.log(`[STEP] ${date} Step 2: Running MLB model...`);
        try {
          const { runMlbModelForDate } = await import("./server/mlbModelRunner");
          const r = await runMlbModelForDate(date);
          console.log(`[OUTPUT] ${date} MLB model: gamesModeled=${r.gamesModeled} gamesSkipped=${r.gamesSkipped} errors=${r.errors?.length ?? 0}`);
          totalModeled += r.gamesModeled;
        } catch (err) {
          console.error(`[VERIFY] FAIL ${date} MLB model: ${err instanceof Error ? err.message : String(err)}`);
          totalErrors++;
        }
      } else {
        console.log(`[STATE] ${date} Step 2: No F5 odds available after scrape, skipping model`);
      }
    } else if (Number(state.hasModel) >= Number(state.total)) {
      console.log(`[STATE] ${date} Step 2: Model already run (${state.hasModel}/${state.total}), skipping`);
    } else {
      console.log(`[STATE] ${date} Step 2: No F5 odds available, skipping model`);
    }

    // ── Step 3: Run multi-market backtest ─────────────────────────────────────
    if (Number(state.hasActuals) > 0 && Number(state.hasResult) < Number(state.total)) {
      console.log(`[STEP] ${date} Step 3: Running multi-market backtest...`);
      try {
        const { runMultiMarketBacktestForDate } = await import("./server/mlbMultiMarketBacktest");
        const r = await runMultiMarketBacktestForDate(date);
        console.log(`[OUTPUT] ${date} Backtest: gamesEvaluated=${r.gamesEvaluated} f5Results=${r.f5Results} nrfiResults=${r.nrfiResults}`);
        totalBacktested += r.gamesEvaluated;
      } catch (err) {
        console.error(`[VERIFY] FAIL ${date} backtest: ${err instanceof Error ? err.message : String(err)}`);
        totalErrors++;
      }
    } else if (Number(state.hasResult) >= Number(state.total)) {
      console.log(`[STATE] ${date} Step 3: Backtest already run (${state.hasResult}/${state.total}), skipping`);
    } else {
      console.log(`[STATE] ${date} Step 3: No actuals available, skipping backtest`);
    }

    // Final state check
    const finalState = await checkF5State(conn, date);
    console.log(`[VERIFY] ${date} FINAL: odds=${finalState.hasOdds}/${finalState.total} model=${finalState.hasModel}/${finalState.total} result=${finalState.hasResult}/${finalState.total} nrfiModel=${finalState.hasNrfiModel}/${finalState.total} nrfiResult=${finalState.hasNrfiResult}/${finalState.total}`);

    // Small delay between dates to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("[OUTPUT] PIPELINE COMPLETE");
  console.log(`  F5 odds scraped:    ${totalOddsScraped}`);
  console.log(`  Games modeled:      ${totalModeled}`);
  console.log(`  Games backtested:   ${totalBacktested}`);
  console.log(`  Total errors:       ${totalErrors}`);
  console.log(`[VERIFY] ${totalErrors === 0 ? "PASS — all steps completed without errors" : `WARN — ${totalErrors} errors encountered (check logs above)`}`);

  await conn.end();
  process.exit(0);
}

main().catch(e => {
  console.error("[FATAL]", e instanceof Error ? e.message : String(e));
  console.error(e instanceof Error ? e.stack : "");
  process.exit(1);
});

/**
 * backtest_phase3_actuals.ts
 * Fetch actual outcomes from MLB Stats API for all Final games March 25 - April 5
 * Populates: actualF5AwayScore, actualF5HomeScore, nrfiActualResult (games table)
 *            actualKs (mlb_strikeout_props)
 *            actualHr (mlb_hr_props)
 */
import * as dotenv from "dotenv";
dotenv.config();
import { fetchRetroactiveOutcomes } from "./server/mlbRetroactiveOutcomesFetcher";

async function main() {
  console.log("[PHASE 3] Fetching actual outcomes for March 25 - April 5...");
  
  try {
    const result = await fetchRetroactiveOutcomes("2026-03-25", "2026-04-05");
    console.log("\n[PHASE 3] COMPLETE");
    console.log(`  Games processed:    ${result.gamesProcessed}`);
    console.log(`  Games failed:       ${result.gamesFailed}`);
    console.log(`  K-Props updated:    ${result.kPropsUpdated}`);
    console.log(`  HR Props updated:   ${result.hrPropsUpdated}`);
    console.log(`  F5 backtest run:    ${result.f5BacktestRun}`);
    console.log(`  NRFI backtest run:  ${result.nrfiBacktestRun}`);
    console.log(`  Errors:             ${result.errors.length}`);
    if (result.errors.length > 0) {
      result.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
    }
  } catch (err) {
    console.error("[PHASE 3] FATAL ERROR:", err instanceof Error ? err.message : String(err));
    console.error(err instanceof Error ? err.stack : "");
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

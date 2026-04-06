// run_hr_backtest_test.ts - Test HR Props backtest for April 5, 2026 (yesterday's Final games)
import { fetchAndStoreActualHrResults } from "./server/mlbHrPropsBacktestService";
import * as dotenv from "dotenv";
dotenv.config();

const DATE = "2026-04-05";

async function main() {
  console.log(`[HR-BACKTEST-TEST] Running HR Props backtest for ${DATE}`);
  const result = await fetchAndStoreActualHrResults(DATE);
  console.log(`[HR-BACKTEST-TEST] DONE: gamesProcessed=${result.gamesProcessed} propsUpdated=${result.propsUpdated} skipped=${result.propsSkipped} errors=${result.errors}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[HR-BACKTEST-TEST] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

/**
 * run_nhl_model_apr9.mts
 * Triggers the NHL model sync for April 9, 2026 games.
 * Uses dateOverride to run for tomorrow's games.
 */
import { syncNhlModelForToday } from "../server/nhlModelSync.ts";

const TARGET_DATE = "2026-04-09";

console.log(`\n${"=".repeat(70)}`);
console.log(`[RunNhlModel] ► Triggering NHL model for ${TARGET_DATE}`);
console.log(`${"=".repeat(70)}`);

try {
  const result = await syncNhlModelForToday(
    "manual",
    true,          // forceRerun = true — clear modelRunAt so all games are processed
    true,          // runAllStatuses = true — include upcoming games
    TARGET_DATE    // dateOverride
  );

  console.log(`\n${"=".repeat(70)}`);
  console.log(`[RunNhlModel] ✅ COMPLETE`);
  console.log(`  synced:   ${result.synced}`);
  console.log(`  skipped:  ${result.skipped}`);
  console.log(`  errors:   ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error(`[RunNhlModel] ❌ Errors:`);
    result.errors.forEach((e, i) => console.error(`  [${i + 1}] ${e}`));
  }
  console.log(`${"=".repeat(70)}\n`);

  process.exit(result.errors.length > 0 ? 1 : 0);
} catch (err) {
  console.error(`[RunNhlModel] ❌ FATAL:`, err);
  process.exit(1);
}

/**
 * runNhlModelNow.ts
 * One-shot script: run the NHL model for today's games and auto-approve all results.
 * Usage: npx tsx scripts/runNhlModelNow.ts [--force] [--all-statuses]
 *
 * --force         Clear modelRunAt before running (re-run even if already modeled)
 * --all-statuses  Include live/final games (not just upcoming)
 */

import "dotenv/config";
import { syncNhlModelForToday } from "../server/nhlModelSync.js";
import { bulkApproveModels } from "../server/db.js";

const forceRerun = process.argv.includes("--force");
const runAllStatuses = process.argv.includes("--all-statuses");

// Today's date in ET (same logic as nhlModelSync)
function getTodayDateET(): string {
  const now = new Date();
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

async function main() {
  const gameDate = getTodayDateET();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[RunNhlModelNow] ► Running NHL model for ${gameDate}`);
  console.log(`[RunNhlModelNow]   forceRerun=${forceRerun} runAllStatuses=${runAllStatuses}`);
  console.log(`${"=".repeat(70)}\n`);

  // Step 1: Run the model
  const result = await syncNhlModelForToday("manual", forceRerun, runAllStatuses);

  console.log(`\n[RunNhlModelNow] Model sync complete:`);
  console.log(`  Synced:  ${result.synced}`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  Errors:  ${result.errors.length > 0 ? result.errors.join("; ") : "none"}`);

  if (result.synced === 0 && result.errors.length > 0) {
    console.error("[RunNhlModelNow] ✗ Model run failed — not approving");
    process.exit(1);
  }

  // Step 2: Auto-approve all NHL projections for today
  console.log(`\n[RunNhlModelNow] Auto-approving all NHL projections for ${gameDate}...`);
  const approved = await bulkApproveModels(gameDate, "NHL");
  console.log(`[RunNhlModelNow] ✅ Approved ${approved} NHL game projection(s) for ${gameDate}`);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`[RunNhlModelNow] ✅ DONE — ${result.synced} modeled, ${approved} approved`);
  console.log(`${"=".repeat(70)}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error("[RunNhlModelNow] Fatal error:", err);
  process.exit(1);
});

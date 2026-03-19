/**
 * Trigger NHL model sync for March 19, 2026 (all 11 games).
 * Uses forceRerun=true to clear any stale modelRunAt and re-run all upcoming games.
 */
import "dotenv/config";
import { syncNhlModelForToday } from "../server/nhlModelSync";

async function main() {
  console.log("=== March 19 NHL Model Run ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    const result = await syncNhlModelForToday("manual", true, false);
    console.log("\n=== RESULT ===");
    console.log(`Synced:  ${result.synced}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Errors:  ${result.errors.length}`);
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.error("  ERROR:", e));
    }
    console.log(`Completed at: ${new Date().toISOString()}`);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();

/**
 * trigger_ncaam_march29.ts
 * One-shot script: re-model all March 29, 2026 NCAAM games with fresh KenPom data
 * and publish both to the feed.
 */
import { syncModelForDate } from "./ncaamModelSync";

async function main() {
  console.log("=== NCAAM March 29, 2026 Model Run ===");
  console.log(`Start: ${new Date().toISOString()}`);

  try {
    const result = await syncModelForDate("2026-03-29", { skipExisting: false, concurrency: 1 });
    console.log("\n=== RESULTS ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }

  console.log(`\nEnd: ${new Date().toISOString()}`);
  process.exit(0);
}

main();

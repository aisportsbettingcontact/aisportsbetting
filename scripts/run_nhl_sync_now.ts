/**
 * Standalone script: force-rerun NHL model for today's games.
 * Run with: npx tsx scripts/run_nhl_sync_now.ts
 */
import "dotenv/config";
import { syncNhlModelForToday } from "../server/nhlModelSync";

async function main() {
  console.log("[RunNhlSync] Starting force-rerun for today's NHL games...");
  // forceRerun=true, includeAllStatuses=true — rerun ALL games regardless of status
  const result = await syncNhlModelForToday("manual", true, true);
  console.log("[RunNhlSync] DONE:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[RunNhlSync] FATAL:", err);
  process.exit(1);
});

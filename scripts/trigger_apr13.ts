/**
 * trigger_apr13.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs and publishes all Apr 13 2026 games:
 *   1. MLB: Run model for all 10 Apr 13 games (already have DK odds + pitchers)
 *   2. NHL: Run model for all 10 Apr 13 games (just seeded DK odds + have goalies)
 *
 * Run with: npx tsx scripts/trigger_apr13.ts
 */

import { runMlbModelForDate } from "../server/mlbModelRunner";
import { syncNhlModelForToday } from "../server/nhlModelSync";

const TARGET_DATE = "2026-04-13";

async function main() {
  console.log("\n========================================");
  console.log("  APR 13 MODEL TRIGGER — MANUAL RUN");
  console.log(`  Target date: ${TARGET_DATE}`);
  console.log("========================================\n");

  // ── STEP 1: MLB Model Run for Apr 13 ─────────────────────────────────────
  console.log("[STEP 1/2] MLB: Running model for Apr 13...");
  try {
    const mlbResult = await runMlbModelForDate(TARGET_DATE);
    console.log(
      `[STEP 1/2] MLB DONE — total=${mlbResult.total} written=${mlbResult.written} ` +
      `skipped=${mlbResult.skipped} errors=${mlbResult.errors} ` +
      `validation=${mlbResult.validation.passed ? "✅ PASSED" : "❌ FAILED (" + mlbResult.validation.issues.length + " issues)"}`
    );
    if (!mlbResult.validation.passed) {
      for (const issue of mlbResult.validation.issues) {
        console.error(`  [ISSUE] ${issue}`);
      }
    }
    if (mlbResult.validation.warnings?.length > 0) {
      for (const w of mlbResult.validation.warnings) {
        console.warn(`  [WARN] ${w}`);
      }
    }
  } catch (err) {
    console.error("[STEP 1/2] MLB FATAL:", err instanceof Error ? err.message : String(err));
  }

  // ── STEP 2: NHL Model Run for Apr 13 ─────────────────────────────────────
  console.log("\n[STEP 2/2] NHL: Running model for Apr 13 (dateOverride)...");
  try {
    const nhlResult = await syncNhlModelForToday("manual", false, false, TARGET_DATE);
    console.log(
      `[STEP 2/2] NHL DONE — synced=${nhlResult.synced} skipped=${nhlResult.skipped} errors=${nhlResult.errors.length}`
    );
    if (nhlResult.errors.length > 0) {
      for (const e of nhlResult.errors) {
        console.error(`  [ERROR] ${e}`);
      }
    }
  } catch (err) {
    console.error("[STEP 2/2] NHL FATAL:", err instanceof Error ? err.message : String(err));
  }

  console.log("\n========================================");
  console.log("  APR 13 TRIGGER COMPLETE");
  console.log("========================================\n");

  process.exit(0);
}

main().catch(err => {
  console.error("[FATAL] Unhandled error:", err);
  process.exit(1);
});

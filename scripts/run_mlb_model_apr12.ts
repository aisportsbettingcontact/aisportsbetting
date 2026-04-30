/**
 * run_mlb_model_apr12.ts
 * Runs the MLB model for 2026-04-12 to fill in model projections for
 * PIT@CHC (id=2250218) and HOU@SEA (id=2250220) which were seeded late
 * via patch_apr12_missing.ts and missed the original model cycle.
 *
 * Run: npx tsx scripts/run_mlb_model_apr12.ts
 */
import { runMlbModelForDate } from "../server/mlbModelRunner";

const TARGET_DATE = "2026-04-12";

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log(`[INPUT] MLB model run for ${TARGET_DATE}`);
  console.log(`[INPUT] Target games: PIT@CHC (id=2250218), HOU@SEA (id=2250220)`);
  console.log("════════════════════════════════════════════════════════════");

  try {
    const result = await runMlbModelForDate(TARGET_DATE);
    console.log("\n[OUTPUT] Model run complete:");
    console.log(`  written=${result.written} skipped=${result.skipped} errors=${result.errors.length}`);
    if (result.errors.length > 0) {
      console.error("[OUTPUT] Errors:");
      for (const e of result.errors) {
        console.error(`  ${e}`);
      }
    }
    if (result.written === 0 && result.skipped > 0) {
      console.warn("[WARN] All games skipped — check if pitchers are populated");
    }
  } catch (err) {
    console.error("[ERROR] Model run failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});

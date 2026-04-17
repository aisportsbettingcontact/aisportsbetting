/**
 * run_mlb_apr17.ts
 * Triggers the MLB model for 2026-04-17 with deep logging.
 * Run: npx tsx scripts/run_mlb_apr17.ts
 */
import { runMlbModelForDate } from "../server/mlbModelRunner.js";

async function main() {
  const dateStr = "2026-04-17";
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[INPUT] Triggering MLB model for date=${dateStr}`);
  console.log(`[INPUT] Timestamp: ${new Date().toISOString()}`);
  console.log(`${"=".repeat(70)}\n`);

  const result = await runMlbModelForDate(dateStr);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`[OUTPUT] MLB model run complete for ${dateStr}`);
  console.log(`[OUTPUT] total=${result.total} written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
  console.log(`[VERIFY] validation.passed=${result.validation.passed}`);
  if (!result.validation.passed) {
    console.error(`[VERIFY] FAIL — ${result.validation.issues.length} issues:`);
    for (const issue of result.validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  } else {
    console.log(`[VERIFY] PASS — all ${result.written} games validated`);
  }
  if (result.validation.warnings.length > 0) {
    console.warn(`[VERIFY] ${result.validation.warnings.length} warnings:`);
    for (const w of result.validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }
  console.log(`${"=".repeat(70)}\n`);
  process.exit(0);
}

main().catch(e => {
  console.error("[FAIL]", e);
  process.exit(1);
});

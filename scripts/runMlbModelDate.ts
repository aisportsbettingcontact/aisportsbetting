/**
 * runMlbModelDate.ts
 * Generic MLB model runner — accepts a date argument (YYYY-MM-DD).
 * Usage: npx tsx scripts/runMlbModelDate.ts 2026-04-03
 */

import { runMlbModelForDate } from "../server/mlbModelRunner";

const DATE = process.argv[2];
if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error("[FATAL] Usage: npx tsx scripts/runMlbModelDate.ts YYYY-MM-DD");
  process.exit(1);
}

console.log("\n" + "═".repeat(72));
console.log(`  MLB MODEL RUN — ${DATE}`);
console.log("  " + new Date().toISOString());
console.log("═".repeat(72) + "\n");

try {
  console.log(`[STEP] Running MLB model for ${DATE}...`);
  const result = await runMlbModelForDate(DATE);

  console.log("\n" + "═".repeat(72));
  console.log("  MODEL RUN COMPLETE");
  console.log("═".repeat(72));
  console.log(`[OUTPUT] Date:     ${DATE}`);
  console.log(`[OUTPUT] Written:  ${result?.modeled ?? "see logs above"}`);
  console.log(`[OUTPUT] Skipped:  ${result?.skipped ?? 0}`);
  console.log(`[OUTPUT] Errors:   ${result?.errors?.length ?? 0}`);
  console.log(`[OUTPUT] Published: ${result?.published ?? "see logs above"}`);

  if (result?.errors?.length > 0) {
    console.log("\n[ERRORS]:");
    for (const e of result.errors) {
      console.error("  ❌", e);
    }
  }
  console.log("\n[VERIFY] ✅ Model run complete for", DATE);
} catch (err) {
  console.error("[FATAL] Model run failed:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error("[STACK]", err.stack);
  }
  process.exit(1);
}

console.log("\n" + "═".repeat(72) + "\n");

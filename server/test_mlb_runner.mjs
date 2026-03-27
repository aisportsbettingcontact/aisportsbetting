/**
 * test_mlb_runner.mjs
 * Quick end-to-end test of mlbModelRunner.ts for March 27, 2026
 * Run with: node --loader ts-node/esm server/test_mlb_runner.mjs
 * Or: npx tsx server/test_mlb_runner.mjs
 */
import { runMlbModelForDate, validateMlbModelResults } from "./mlbModelRunner.ts";

const date = "2026-03-27";
console.log(`\n${"=".repeat(80)}`);
console.log(`  MLB MODEL RUNNER — END-TO-END TEST | date: ${date}`);
console.log(`${"=".repeat(80)}\n`);

try {
  const result = await runMlbModelForDate(date);
  console.log(`\n${"=".repeat(80)}`);
  console.log(`  SUMMARY`);
  console.log(`${"=".repeat(80)}`);
  console.log(`  Date:       ${result.date}`);
  console.log(`  Total:      ${result.total}`);
  console.log(`  Written:    ${result.written}`);
  console.log(`  Skipped:    ${result.skipped}`);
  console.log(`  Errors:     ${result.errors}`);
  console.log(`  Validation: ${result.validation.passed ? "✅ PASSED" : "❌ FAILED"}`);
  if (!result.validation.passed) {
    console.log(`  Issues:`);
    for (const issue of result.validation.issues) {
      console.log(`    ✗ ${issue}`);
    }
  }
  if (result.validation.warnings.length > 0) {
    console.log(`  Warnings:`);
    for (const w of result.validation.warnings) {
      console.log(`    ⚠ ${w}`);
    }
  }
  console.log(`${"=".repeat(80)}\n`);
  process.exit(result.errors > 0 || !result.validation.passed ? 1 : 0);
} catch (err) {
  console.error("FATAL:", err);
  process.exit(1);
}

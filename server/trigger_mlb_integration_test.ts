/**
 * trigger_mlb_integration_test.ts
 * Full pipeline integration test: mlbModelRunner → Python engine → DB write → validation
 */
import { runMlbModelForDate } from "./mlbModelRunner";

const dateStr = "2026-03-31";

console.log("=" .repeat(70));
console.log(`MLB INTEGRATION TEST — ${dateStr}`);
console.log("=".repeat(70));

(async () => {
  try {
    const result = await runMlbModelForDate(dateStr);

    console.log("\n" + "=".repeat(70));
    console.log("INTEGRATION TEST RESULTS");
    console.log("=".repeat(70));
    console.log(`Date:    ${result.date}`);
    console.log(`Total:   ${result.total} games in DB`);
    console.log(`Written: ${result.written}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Errors:  ${result.errors}`);
    console.log(`Validation passed: ${result.validation.passed}`);

    if (result.validation.issues.length > 0) {
      console.error("\nVALIDATION ISSUES:");
      result.validation.issues.forEach(i => console.error("  ✗", i));
    }
    if (result.validation.warnings.length > 0) {
      console.warn("\nVALIDATION WARNINGS:");
      result.validation.warnings.forEach(w => console.warn("  ⚠", w));
    }

    const allGood = result.written > 0 && result.errors === 0 && result.validation.passed;
    console.log("\n" + (allGood ? "✅ INTEGRATION TEST PASSED" : "❌ INTEGRATION TEST FAILED"));
    process.exit(allGood ? 0 : 1);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }
})();

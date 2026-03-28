/**
 * trigger_mlb_march28.ts
 * One-shot script to run the MLB model for March 28, 2026
 * Usage: npx tsx server/trigger_mlb_march28.ts
 */

import "dotenv/config";
import { runMlbModelForDate } from "./mlbModelRunner";

const DATE = "2026-03-28";

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`MLB MODEL TRIGGER — ${DATE}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const summary = await runMlbModelForDate(DATE);

    console.log(`\n${"=".repeat(70)}`);
    console.log(`SUMMARY`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Date:    ${summary.date}`);
    console.log(`Total:   ${summary.total} games`);
    console.log(`Written: ${summary.written}`);
    console.log(`Skipped: ${summary.skipped}`);
    console.log(`Errors:  ${summary.errors}`);
    console.log(`\nValidation: ${summary.validation.passed ? "✅ PASSED" : "❌ FAILED"}`);
    if (summary.validation.issues.length > 0) {
      console.log(`Issues (${summary.validation.issues.length}):`);
      for (const issue of summary.validation.issues) {
        console.log(`  ✗ ${issue}`);
      }
    }
    if (summary.validation.warnings.length > 0) {
      console.log(`Warnings (${summary.validation.warnings.length}):`);
      for (const w of summary.validation.warnings) {
        console.log(`  ⚠ ${w}`);
      }
    }
    console.log(`${"=".repeat(70)}\n`);

    process.exit(summary.errors > 0 ? 1 : 0);
  } catch (err) {
    console.error("FATAL ERROR:", err);
    process.exit(1);
  }
}

main();

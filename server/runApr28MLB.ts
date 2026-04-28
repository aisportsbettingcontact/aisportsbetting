import { runMlbModelForDate } from "./mlbModelRunner.js";

async function main() {
  const dateStr = "2026-04-28";
  console.log(`[RunApr28MLB] ► START — Running MLB model for ${dateStr} (15 games)`);
  console.log(`[RunApr28MLB] Pipeline: 400K Monte Carlo sims | Park factors | Bullpen stats | Umpire modifiers | NRFI/YRFI | F5 markets | HR props`);
  console.log(`[RunApr28MLB] Unconfirmed pitchers: COL Sugano(0), PIT Ashcraft(0), ATH Civale(0) — model will use team ERA/FIP fallback`);

  const result = await runMlbModelForDate(dateStr, { forceRerun: false });

  console.log(`\n[RunApr28MLB] ► COMPLETE`);
  console.log(`[RunApr28MLB] Written: ${result.written} | Skipped: ${result.skipped} | Errors: ${result.errors}`);
  console.log(`[RunApr28MLB] Validation passed: ${result.validation.passed}`);

  if (result.validation.issues && result.validation.issues.length > 0) {
    console.error(`[RunApr28MLB] ❌ VALIDATION ISSUES (${result.validation.issues.length}):`);
    for (const issue of result.validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  }

  if (result.validation.warnings && result.validation.warnings.length > 0) {
    console.warn(`[RunApr28MLB] ⚠ WARNINGS (${result.validation.warnings.length}):`);
    for (const w of result.validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  if (result.validation.passed) {
    console.log(`[RunApr28MLB] ✅ All games validated and written to DB`);
  } else {
    console.error(`[RunApr28MLB] ❌ Validation FAILED — check issues above`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(`[RunApr28MLB] FATAL ERROR:`, e);
  process.exit(1);
});

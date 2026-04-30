import { runMlbModelForDate } from "./mlbModelRunner.js";

async function main() {
  const dateStr = "2026-04-27";
  console.log(`[RunApr27MLB] ► START — Running MLB model for ${dateStr} (8 games)`);
  console.log(`[RunApr27MLB] Pipeline: 400K Monte Carlo sims | Park factors | Bullpen stats | Umpire modifiers | NRFI/YRFI | F5 markets | HR props`);

  const result = await runMlbModelForDate(dateStr, { forceRerun: false });

  console.log(`\n[RunApr27MLB] ► COMPLETE`);
  console.log(`[RunApr27MLB] Written: ${result.written} | Skipped: ${result.skipped} | Errors: ${result.errors}`);
  console.log(`[RunApr27MLB] Validation: passed=${result.validation.passed}`);

  if (!result.validation.passed) {
    console.error(`[RunApr27MLB] ❌ VALIDATION ISSUES:`);
    for (const issue of result.validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  }

  if (result.validation.warnings.length > 0) {
    console.warn(`[RunApr27MLB] ⚠ WARNINGS:`);
    for (const w of result.validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  if (result.validation.passed) {
    console.log(`[RunApr27MLB] ✅ All games validated and written to DB`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(`[RunApr27MLB] FATAL ERROR:`, e);
  process.exit(1);
});

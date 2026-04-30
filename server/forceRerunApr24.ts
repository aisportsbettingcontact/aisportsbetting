/**
 * Force-rerun MLB model for ALL 14 April 24, 2026 games.
 * modelRunAt has been cleared for all 14 games — this will model every one.
 */
import { runMlbModelForDate } from "./mlbModelRunner.js";

const DATE = "2026-04-24";

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[ForceRerun] April 24, 2026 — Full MLB Model (14 games)`);
  console.log(`[ForceRerun] All modelRunAt cleared — every game will be modeled`);
  console.log(`${'='.repeat(70)}\n`);

  const result = await runMlbModelForDate(DATE);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[ForceRerun] ✅ COMPLETE`);
  console.log(`  Written:  ${result.written}`);
  console.log(`  Skipped:  ${result.skipped}`);
  console.log(`  Errors:   ${result.errors}`);
  console.log(`  Validation passed: ${result.validation.passed}`);
  if (!result.validation.passed) {
    for (const issue of result.validation.issues) console.error(`  ✗ ${issue}`);
  }
  for (const w of result.validation.warnings) console.warn(`  ⚠ ${w}`);
  console.log(`${'='.repeat(70)}\n`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

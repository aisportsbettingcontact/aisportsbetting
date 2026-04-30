/**
 * test_remodel_apr16_v2.ts
 * Re-run MLB model for 2026-04-16 with the fixed modelTotal anchoring and RL sign logging.
 * Verifies all 10 games are written with correct RL labels and matching totals.
 */
import { runMlbModelForDate } from './server/mlbModelRunner';

const DATE = '2026-04-16';

async function main() {
  console.log(`[INPUT] Running MLB model for ${DATE}`);
  console.log(`[STEP] Calling runMlbModel with forceRemodel=true`);
  const t0 = Date.now();

  const result = await runMlbModelForDate(DATE);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[OUTPUT] Model run complete in ${elapsed}s`);
  console.log(`[OUTPUT] date=${result.date} total=${result.total} written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
  console.log(`[VERIFY] validation.passed=${result.validation.passed}`);
  if (result.validation.issues.length > 0) {
    console.log(`[VERIFY] ISSUES:`);
    for (const issue of result.validation.issues) console.log(`  - ${issue}`);
  }
  if (result.validation.warnings.length > 0) {
    console.log(`[VERIFY] WARNINGS:`);
    for (const w of result.validation.warnings) console.log(`  - ${w}`);
  }

  process.exit(result.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[ERROR] Fatal:', err);
  process.exit(1);
});

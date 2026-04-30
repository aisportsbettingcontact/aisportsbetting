/**
 * One-off: Re-run MLB model for 2026-04-14 with v2.1 constants
 * Populates modelF5PushPct and modelF5PushRaw for all 15 games.
 */
import { runMlbModelForDate } from "../server/mlbModelRunner.js";

const DATE = "2026-04-14";

console.log(`[INPUT]  date=${DATE}`);
console.log(`[STEP]   Invoking runMlbModelForDate("${DATE}")...`);

const result = await runMlbModelForDate(DATE);

console.log(`[OUTPUT] written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
console.log(`[VERIFY] validation.passed=${result.validation.passed}`);

if (!result.validation.passed) {
  for (const issue of result.validation.issues) {
    console.error(`  [FAIL] ${issue}`);
  }
}
if (result.validation.warnings.length > 0) {
  for (const w of result.validation.warnings) {
    console.warn(`  [WARN] ${w}`);
  }
}

console.log(`[STATE]  gameResults=${JSON.stringify(result.gameResults?.map(g => ({
  game: g.game,
  ok: g.ok,
  p_f5_push: g.p_f5_push,
  p_f5_push_raw: g.p_f5_push_raw,
})), null, 2)}`);

process.exit(result.errors > 0 ? 1 : 0);

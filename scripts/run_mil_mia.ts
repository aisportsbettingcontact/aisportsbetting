/**
 * Targeted model run for MIL@MIA (id=2250276) on 2026-04-17
 * Robert Gasser teamAbbrev fixed to MIL — re-run with forceRerun via DB reset
 */
import { runMlbModelForDate } from '../server/mlbModelRunner';
import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

async function main() {
  console.log('======================================================================');
  console.log('[INPUT] Targeted model run: MIL@MIA (id=2250276) — 2026-04-17');
  console.log('[STEP] Resetting modelRunAt for MIL@MIA to force re-run');
  console.log('[STATE] Gasser teamAbbrev fixed: UNK → MIL');
  console.log('[STATE] Expected: league-avg pitcher stats (ERA=4.50, no rolling5 blend — only 2 starts)');
  console.log('======================================================================');

  const db = await getDb();

  // Reset modelRunAt so the model runner picks it up
  await db.update(games)
    .set({ modelRunAt: null, publishedToFeed: false, publishedModel: false } as any)
    .where(eq(games.id, 2250276));
  console.log('[STEP] Reset modelRunAt=null for id=2250276 (MIL@MIA)');

  const result = await runMlbModelForDate('2026-04-17', { targetGameIds: [2250276] });

  console.log('======================================================================');
  console.log('[OUTPUT] Model run complete for 2026-04-17');
  console.log('[OUTPUT] written:', result.written, 'skipped:', result.skipped, 'errors:', result.errors);
  console.log('[OUTPUT] validation.passed:', result.validation?.passed);
  if (result.validation?.issues?.length) {
    console.log('[VERIFY] Issues:', result.validation.issues);
  }
  if (result.validation?.warnings?.length) {
    console.log('[VERIFY] Warnings:', result.validation.warnings);
  }
  console.log('======================================================================');
  process.exit(0);
}

main().catch(e => {
  console.error('[FAIL]', e.message);
  process.exit(1);
});

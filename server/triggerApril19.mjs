/**
 * triggerApril19.mjs
 * Force-run both MLB and NHL models for 2026-04-19 with maximum granularity.
 * Clears modelRunAt for all 04/19 games before running to guarantee a fresh pass.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load dotenv
const dotenv = require('dotenv');
dotenv.config();

// Dynamic import of TS-compiled server modules (tsx watch already compiles them)
const { runMlbModelForDate } = await import('./mlbModelRunner.js');
const { syncNhlModelForToday } = await import('./nhlModelSync.js');
const { getDb } = await import('./db.js');

const TARGET_DATE = '2026-04-19';

console.log('='.repeat(72));
console.log(`[April19Trigger] TARGET DATE: ${TARGET_DATE}`);
console.log('='.repeat(72));

// ── Step 0: Clear modelRunAt for all 04/19 games (force fresh run) ──────────
console.log('\n[April19Trigger] Step 0: Clearing modelRunAt for all 04/19 games...');
const db = await getDb();

// Use raw SQL via drizzle to clear both sports
const { games } = await import('../drizzle/schema.js');
const { and, eq } = await import('drizzle-orm');

const cleared = await db
  .update(games)
  .set({ modelRunAt: null })
  .where(eq(games.gameDate, TARGET_DATE));
console.log(`[April19Trigger] Cleared modelRunAt for all ${TARGET_DATE} games.`);

// ── Step 1: NHL Model ────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log(`[April19Trigger] Step 1: Running NHL model for ${TARGET_DATE}...`);
console.log('='.repeat(72));

let nhlResult;
try {
  nhlResult = await syncNhlModelForToday('manual', true, false, TARGET_DATE);
  console.log(`\n[April19Trigger] NHL RESULT:`);
  console.log(`  synced  : ${nhlResult.synced}`);
  console.log(`  skipped : ${nhlResult.skipped}`);
  console.log(`  errors  : ${nhlResult.errors.length}`);
  if (nhlResult.errors.length > 0) {
    nhlResult.errors.forEach(e => console.error(`  ✗ ${e}`));
  }
} catch (err) {
  console.error(`[April19Trigger] NHL model FAILED:`, err);
  nhlResult = { synced: 0, skipped: 0, errors: [String(err)] };
}

// ── Step 2: MLB Model ────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log(`[April19Trigger] Step 2: Running MLB model for ${TARGET_DATE}...`);
console.log('='.repeat(72));

let mlbResult;
try {
  mlbResult = await runMlbModelForDate(TARGET_DATE, { forceRerun: true });
  console.log(`\n[April19Trigger] MLB RESULT:`);
  console.log(`  written   : ${mlbResult.written}`);
  console.log(`  skipped   : ${mlbResult.skipped}`);
  console.log(`  errors    : ${mlbResult.errors}`);
  console.log(`  validation: passed=${mlbResult.validation.passed}`);
  if (!mlbResult.validation.passed) {
    mlbResult.validation.issues.forEach(i => console.error(`  ✗ ${i}`));
  }
  if (mlbResult.validation.warnings?.length > 0) {
    mlbResult.validation.warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }
} catch (err) {
  console.error(`[April19Trigger] MLB model FAILED:`, err);
  mlbResult = { written: 0, skipped: 0, errors: 1, validation: { passed: false, issues: [String(err)], warnings: [] } };
}

// ── Step 3: Publish all modeled 04/19 games ──────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log(`[April19Trigger] Step 3: Publishing all modeled 04/19 games...`);
console.log('='.repeat(72));

const { isNotNull } = await import('drizzle-orm');
const publishResult = await db
  .update(games)
  .set({ publishedModel: 1, publishedToFeed: 1 })
  .where(
    and(
      eq(games.gameDate, TARGET_DATE),
      isNotNull(games.modelRunAt)
    )
  );
console.log(`[April19Trigger] Published all modeled 04/19 games.`);

// ── Step 4: Final DB verification ────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log(`[April19Trigger] Step 4: Final DB verification for ${TARGET_DATE}...`);
console.log('='.repeat(72));

const finalGames = await db
  .select({
    id: games.id,
    sport: games.sport,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    modelRunAt: games.modelRunAt,
    modelAwayScore: games.modelAwayScore,
    modelHomeScore: games.modelHomeScore,
    modelTotal: games.modelTotal,
    modelAwayML: games.modelAwayML,
    modelHomeML: games.modelHomeML,
    publishedModel: games.publishedModel,
  })
  .from(games)
  .where(eq(games.gameDate, TARGET_DATE))
  .orderBy(games.sport, games.id);

let nhlModeled = 0, mlbModeled = 0, nhlTotal = 0, mlbTotal = 0;
for (const g of finalGames) {
  const status = g.modelRunAt ? '✅ MODELED' : '❌ NOT MODELED';
  const pub = g.publishedModel ? '[PUBLISHED]' : '[UNPUBLISHED]';
  console.log(`  [${g.sport}] ${g.awayTeam} @ ${g.homeTeam} | ${status} ${pub} | away=${g.modelAwayScore ?? 'null'} home=${g.modelHomeScore ?? 'null'} total=${g.modelTotal ?? 'null'} awayML=${g.modelAwayML ?? 'null'} homeML=${g.modelHomeML ?? 'null'}`);
  if (g.sport === 'NHL') { nhlTotal++; if (g.modelRunAt) nhlModeled++; }
  if (g.sport === 'MLB') { mlbTotal++; if (g.modelRunAt) mlbModeled++; }
}

console.log('\n' + '='.repeat(72));
console.log(`[April19Trigger] SUMMARY:`);
console.log(`  NHL: ${nhlModeled}/${nhlTotal} modeled`);
console.log(`  MLB: ${mlbModeled}/${mlbTotal} modeled`);
console.log(`  TOTAL: ${nhlModeled + mlbModeled}/${nhlTotal + mlbTotal} modeled`);
console.log('='.repeat(72));

process.exit(0);

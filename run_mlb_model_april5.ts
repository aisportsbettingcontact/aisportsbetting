/**
 * run_mlb_model_april5.ts
 * Runs the MLB Monte Carlo model for all games on 2026-04-05 with deep logging.
 * Run: npx tsx run_mlb_model_april5.ts
 */
import { runMlbModelForDate } from './server/mlbModelRunner';
import { getDb } from './server/db';
import { games } from './drizzle/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(80));
  console.log('[PIPELINE] Phase 3: MLB Monte Carlo Model — 2026-04-05');
  console.log('='.repeat(80));

  // ── Pre-run audit ────────────────────────────────────────────────────────────
  const db = await getDb();
  const preGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameNumber: games.gameNumber,
    doubleHeader: games.doubleHeader,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    awayBookSpread: games.awayBookSpread,
    bookTotal: games.bookTotal,
    awayML: games.awayML,
    modelRunAt: games.modelRunAt,
  }).from(games).where(and(eq(games.gameDate, '2026-04-05'), eq(games.sport, 'MLB')));

  console.log(`\n[PRE-RUN AUDIT] ${preGames.length} MLB games found`);
  for (const g of preGames) {
    const dh = (g.doubleHeader && g.doubleHeader !== 'N') ? ` [DH-G${g.gameNumber}]` : '';
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam}${dh}`);
    console.log(`         Pitchers: ${g.awayStartingPitcher ?? 'MISSING'} vs ${g.homeStartingPitcher ?? 'MISSING'}`);
    console.log(`         Spread:${g.awayBookSpread ?? 'NULL'} | Total:${g.bookTotal ?? 'NULL'} | ML:${g.awayML ?? 'NULL'}`);
    console.log(`         PreModeled: ${g.modelRunAt ? 'YES (will re-run)' : 'NO'}`);
  }

  // ── Run the model ────────────────────────────────────────────────────────────
  console.log('\n[STEP] Executing runMlbModelForDate("2026-04-05")...');
  const startMs = Date.now();
  const result = await runMlbModelForDate('2026-04-05');
  const elapsedMs = Date.now() - startMs;

  console.log(`\n[MODEL RUN COMPLETE] Elapsed: ${elapsedMs}ms`);
  console.log('[RESULT SUMMARY]', JSON.stringify({
    date: result.date,
    total: result.total,
    written: result.written,
    skipped: result.skipped,
    errors: result.errors,
    validationPassed: result.validation?.passed,
    validationIssues: result.validation?.issues?.length ?? 0,
    validationWarnings: result.validation?.warnings?.length ?? 0,
  }, null, 2));

  if (result.validation?.issues?.length) {
    console.warn('[VALIDATION ISSUES]');
    for (const issue of result.validation.issues) {
      console.warn(`  - ${issue}`);
    }
  }
  if (result.validation?.warnings?.length) {
    console.warn('[VALIDATION WARNINGS]');
    for (const w of result.validation.warnings) {
      console.warn(`  - ${w}`);
    }
  }

  // ── Post-run audit ───────────────────────────────────────────────────────────
  const postGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameNumber: games.gameNumber,
    doubleHeader: games.doubleHeader,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    modelTotal: games.modelTotal,
    modelAwayWinPct: games.modelAwayWinPct,
    modelHomeWinPct: games.modelHomeWinPct,
    modelAwayScore: games.modelAwayScore,
    modelHomeScore: games.modelHomeScore,
    modelOverRate: games.modelOverRate,
    modelUnderRate: games.modelUnderRate,
    spreadEdge: games.spreadEdge,
    totalEdge: games.totalEdge,
    modelCoverDirection: games.modelCoverDirection,
    modelRunAt: games.modelRunAt,
    publishedModel: games.publishedModel,
  }).from(games).where(and(eq(games.gameDate, '2026-04-05'), eq(games.sport, 'MLB')));

  console.log(`\n[POST-RUN AUDIT] ${postGames.length} MLB games`);
  console.log('='.repeat(80));
  let modeledCount = 0;
  for (const g of postGames) {
    const dh = (g.doubleHeader && g.doubleHeader !== 'N') ? ` [DH-G${g.gameNumber}]` : '';
    const isModeled = g.modelRunAt !== null;
    if (isModeled) modeledCount++;
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam}${dh} | Modeled:${isModeled ? 'YES' : 'NO'}`);
    if (isModeled) {
      console.log(`         ModelSpread: ${g.awayModelSpread ?? 'NULL'} / ${g.homeModelSpread ?? 'NULL'}`);
      console.log(`         ModelTotal: ${g.modelTotal ?? 'NULL'} (Over:${g.modelOverRate ?? 'NULL'} Under:${g.modelUnderRate ?? 'NULL'})`);
      console.log(`         ModelScore: ${g.modelAwayScore ?? 'NULL'} - ${g.modelHomeScore ?? 'NULL'}`);
      console.log(`         WinPct: Away:${g.modelAwayWinPct ?? 'NULL'} Home:${g.modelHomeWinPct ?? 'NULL'}`);
      console.log(`         SpreadEdge: ${g.spreadEdge ?? 'NULL'} | TotalEdge: ${g.totalEdge ?? 'NULL'} | Cover: ${g.modelCoverDirection ?? 'NULL'}`);
    }
  }
  console.log(`\n[FINAL] Modeled: ${modeledCount}/${postGames.length} games`);
  console.log('[PIPELINE] Phase 3 COMPLETE.');
  process.exit(0);
}

main().catch(e => { console.error('[FATAL]', e.message, '\n', e.stack); process.exit(1); });

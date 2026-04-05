/**
 * run_refresh_april5.ts
 * Triggers VSiN MLB + NHL refresh for 2026-04-05 with full logging.
 * Run: npx tsx run_refresh_april5.ts
 */
import { runVsinRefreshManual } from './server/vsinAutoRefresh';
import { getDb } from './server/db';
import { games } from './drizzle/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(80));
  console.log('[PIPELINE] Phase 2: VSiN MLB Refresh for 2026-04-05');
  console.log('='.repeat(80));

  // ── Step 1: MLB VSiN refresh ─────────────────────────────────────────────────
  console.log('\n[STEP 1] Running runVsinRefreshManual(MLB)...');
  const mlbResult = await runVsinRefreshManual('MLB');
  console.log('\n[MLB REFRESH RESULT]', JSON.stringify(mlbResult, null, 2));

  // ── Step 2: NHL VSiN refresh ─────────────────────────────────────────────────
  console.log('\n[STEP 2] Running runVsinRefreshManual(NHL)...');
  const nhlResult = await runVsinRefreshManual('NHL');
  console.log('\n[NHL REFRESH RESULT]', JSON.stringify(nhlResult, null, 2));

  // ── Step 3: Verify final game state ─────────────────────────────────────────
  const db = await getDb();
  
  const mlbGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    gameNumber: games.gameNumber,
    doubleHeader: games.doubleHeader,
    awayBookSpread: games.awayBookSpread,
    bookTotal: games.bookTotal,
    awayML: games.awayML,
    homeML: games.homeML,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    modelRunAt: games.modelRunAt,
  }).from(games).where(and(eq(games.gameDate, '2026-04-05'), eq(games.sport, 'MLB')));

  console.log(`\n[VERIFY MLB] Games in DB after refresh: ${mlbGames.length}`);
  let mlbWithOdds = 0, mlbWithPitchers = 0;
  for (const g of mlbGames) {
    const dh = (g.doubleHeader && g.doubleHeader !== 'N') ? ` [DH-G${g.gameNumber}]` : '';
    const hasOdds = g.awayBookSpread !== null && g.bookTotal !== null && g.awayML !== null;
    const hasPitchers = g.awayStartingPitcher !== null && g.homeStartingPitcher !== null;
    if (hasOdds) mlbWithOdds++;
    if (hasPitchers) mlbWithPitchers++;
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam}${dh} | ${g.startTimeEst ?? 'TBD'}`);
    console.log(`         Spread:${g.awayBookSpread ?? 'NULL'} | Total:${g.bookTotal ?? 'NULL'} | ML:${g.awayML ?? 'NULL'}/${g.homeML ?? 'NULL'}`);
    console.log(`         Pitchers: ${g.awayStartingPitcher ?? 'MISSING'} vs ${g.homeStartingPitcher ?? 'MISSING'}`);
    console.log(`         Odds:${hasOdds ? 'OK' : 'MISSING'} | Pitchers:${hasPitchers ? 'OK' : 'MISSING'} | Modeled:${g.modelRunAt ? 'YES' : 'NO'}`);
  }
  console.log(`\n[MLB SUMMARY] Total:${mlbGames.length} | WithOdds:${mlbWithOdds} | WithPitchers:${mlbWithPitchers}`);

  const nhlGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    startTimeEst: games.startTimeEst,
    awayBookSpread: games.awayBookSpread,
    bookTotal: games.bookTotal,
    awayML: games.awayML,
    homeML: games.homeML,
    modelRunAt: games.modelRunAt,
  }).from(games).where(and(eq(games.gameDate, '2026-04-05'), eq(games.sport, 'NHL')));

  console.log(`\n[VERIFY NHL] Games in DB after refresh: ${nhlGames.length}`);
  let nhlWithOdds = 0;
  for (const g of nhlGames) {
    const hasOdds = g.awayBookSpread !== null && g.bookTotal !== null && g.awayML !== null;
    if (hasOdds) nhlWithOdds++;
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst ?? 'TBD'}`);
    console.log(`         Spread:${g.awayBookSpread ?? 'NULL'} | Total:${g.bookTotal ?? 'NULL'} | ML:${g.awayML ?? 'NULL'}/${g.homeML ?? 'NULL'}`);
    console.log(`         Odds:${hasOdds ? 'OK' : 'MISSING'} | Modeled:${g.modelRunAt ? 'YES' : 'NO'}`);
  }
  console.log(`\n[NHL SUMMARY] Total:${nhlGames.length} | WithOdds:${nhlWithOdds}`);

  console.log('\n[PIPELINE] Phase 2 COMPLETE.');
  process.exit(0);
}

main().catch(e => { console.error('[FATAL]', e.message, '\n', e.stack); process.exit(1); });

/**
 * finalAudit.ts
 * Validates that all April 14 games have been modeled with the integrated model.
 * Checks: modelTotal, awayModelSpread, nrfiCombinedSignal, nrfiFilterPass
 */
import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { and, gte, lt } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  const today    = new Date('2026-04-14');
  const tomorrow = new Date('2026-04-15');

  const rows = await db.select({
    away:               games.awayTeam,
    home:               games.homeTeam,
    modelTotal:         games.modelTotal,
    awayModelSpread:    games.awayModelSpread,
    nrfiCombinedSignal: games.nrfiCombinedSignal,
    nrfiFilterPass:     games.nrfiFilterPass,
    awayRunLineOdds:    games.awayRunLineOdds,
    homeRunLineOdds:    games.homeRunLineOdds,
  }).from(games)
    .where(and(gte(games.gameDate, today), lt(games.gameDate, tomorrow)));

  console.log(`[VALIDATION] April 14 games in DB: ${rows.length}`);
  let modeled = 0, unmodeled = 0, nrfiPopulated = 0;

  for (const r of rows) {
    const hasModel = r.modelTotal !== null && r.awayModelSpread !== null;
    const hasRL    = r.awayRunLineOdds !== null && r.homeRunLineOdds !== null;
    const hasNrfi  = r.nrfiCombinedSignal !== null;
    const status   = hasModel ? '✅ MODELED' : '❌ UNMODELED';
    const nrfiStr  = hasNrfi
      ? `signal=${Number(r.nrfiCombinedSignal).toFixed(4)} pass=${r.nrfiFilterPass}`
      : 'signal=null (no pitcher data)';
    const rlStr    = hasRL ? `RL=${r.awayRunLineOdds}/${r.homeRunLineOdds}` : 'RL=null';

    console.log(`  ${r.away}@${r.home}: ${status} | total=${r.modelTotal} | spread=${r.awayModelSpread} | ${nrfiStr} | ${rlStr}`);

    if (hasModel) modeled++;
    else unmodeled++;
    if (hasNrfi) nrfiPopulated++;
  }

  console.log('');
  console.log(`[RESULT] total=${rows.length} modeled=${modeled} unmodeled=${unmodeled} nrfi_populated=${nrfiPopulated}`);
  console.log(`[VERDICT] ${modeled === rows.length ? '✅ ALL GAMES MODELED' : `❌ ${unmodeled} GAMES MISSING MODEL`}`);
  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });

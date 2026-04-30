/**
 * auditCheatSheetData.ts
 * Audits the DB for all fields needed by the CHEAT SHEETS tab:
 * - Inning-by-inning distributions (I1-I9 per team)
 * - F5 model lines (ML, RL, Total, scores)
 * - NRFI/YRFI model odds and probabilities
 * - Action Network F5 book odds
 */
import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { and, gte, lt } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  const today    = new Date('2026-04-14');
  const tomorrow = new Date('2026-04-15');

  const rows = await db.select({
    id:                      games.id,
    away:                    games.awayTeam,
    home:                    games.homeTeam,
    // Inning distributions
    modelInningHomeExp:      games.modelInningHomeExp,
    modelInningAwayExp:      games.modelInningAwayExp,
    modelInningTotalExp:     games.modelInningTotalExp,
    modelInningPHomeScores:  games.modelInningPHomeScores,
    modelInningPAwayScores:  games.modelInningPAwayScores,
    modelInningPNeitherScores: games.modelInningPNeitherScores,
    // F5 model lines
    modelF5AwayScore:        games.modelF5AwayScore,
    modelF5HomeScore:        games.modelF5HomeScore,
    modelF5Total:            games.modelF5Total,
    modelF5AwayML:           games.modelF5AwayML,
    modelF5HomeML:           games.modelF5HomeML,
    modelF5AwayWinPct:       games.modelF5AwayWinPct,
    modelF5HomeWinPct:       games.modelF5HomeWinPct,
    modelF5OverRate:         games.modelF5OverRate,
    modelF5UnderRate:        games.modelF5UnderRate,
    modelF5OverOdds:         games.modelF5OverOdds,
    modelF5UnderOdds:        games.modelF5UnderOdds,
    modelF5AwayRLCoverPct:   games.modelF5AwayRLCoverPct,
    modelF5HomeRLCoverPct:   games.modelF5HomeRLCoverPct,
    // F5 book odds (Action Network / FanDuel)
    f5AwayML:                games.f5AwayML,
    f5HomeML:                games.f5HomeML,
    f5AwayRunLine:           games.f5AwayRunLine,
    f5HomeRunLine:           games.f5HomeRunLine,
    f5AwayRunLineOdds:       games.f5AwayRunLineOdds,
    f5HomeRunLineOdds:       games.f5HomeRunLineOdds,
    f5Total:                 games.f5Total,
    f5OverOdds:              games.f5OverOdds,
    f5UnderOdds:             games.f5UnderOdds,
    // NRFI/YRFI model
    modelPNrfi:              games.modelPNrfi,
    modelNrfiOdds:           games.modelNrfiOdds,
    modelYrfiOdds:           games.modelYrfiOdds,
    // NRFI/YRFI book odds
    nrfiOverOdds:            games.nrfiOverOdds,
    yrfiUnderOdds:           games.yrfiUnderOdds,
    nrfiCombinedSignal:      games.nrfiCombinedSignal,
    nrfiFilterPass:          games.nrfiFilterPass,
  }).from(games)
    .where(and(gte(games.gameDate, today), lt(games.gameDate, tomorrow)));

  // Filter to MLB only (NHL/NBA teams use underscore slugs like new_jersey_devils)
  const mlbRows = rows.filter(r => !r.away.includes('_') && !r.home.includes('_'));

  console.log(`\n[AUDIT] April 14 MLB games: ${mlbRows.length}`);
  console.log('='.repeat(80));

  let innDistOk = 0, f5ModelOk = 0, nrfiModelOk = 0, f5BookOk = 0, nrfiBookOk = 0;

  for (const r of mlbRows) {
    const tag = `${r.away}@${r.home}`;

    // Parse inning distributions
    const innHome    = r.modelInningHomeExp    ? JSON.parse(r.modelInningHomeExp)    : null;
    const innAway    = r.modelInningAwayExp    ? JSON.parse(r.modelInningAwayExp)    : null;
    const innNeither = r.modelInningPNeitherScores ? JSON.parse(r.modelInningPNeitherScores) : null;

    const hasInnDist  = innHome?.length === 9 && innAway?.length === 9;
    const hasF5Model  = r.modelF5AwayScore !== null && r.modelF5HomeScore !== null && r.modelF5Total !== null;
    const hasNrfiModel = r.modelPNrfi !== null && r.modelNrfiOdds !== null;
    const hasF5Book   = r.f5AwayML !== null || r.f5Total !== null;
    const hasNrfiBook = r.nrfiOverOdds !== null;

    if (hasInnDist)  innDistOk++;
    if (hasF5Model)  f5ModelOk++;
    if (hasNrfiModel) nrfiModelOk++;
    if (hasF5Book)   f5BookOk++;
    if (hasNrfiBook) nrfiBookOk++;

    console.log(`\n  [GAME] ${tag}`);
    console.log(`    INN_DIST: ${hasInnDist ? '✅' : '❌ MISSING'} | F5_MODEL: ${hasF5Model ? '✅' : '❌ MISSING'} | NRFI_MODEL: ${hasNrfiModel ? '✅' : '❌ MISSING'} | F5_BOOK: ${hasF5Book ? '✅' : '❌ MISSING'} | NRFI_BOOK: ${hasNrfiBook ? '✅' : '❌ MISSING'}`);

    if (hasInnDist) {
      const f5Home = innHome.slice(0,5).reduce((a: number, b: number) => a + b, 0);
      const f5Away = innAway.slice(0,5).reduce((a: number, b: number) => a + b, 0);
      console.log(`    I1-I5 Home: [${innHome.slice(0,5).map((v: number) => v.toFixed(3)).join(', ')}] → F5 sum=${f5Home.toFixed(3)}`);
      console.log(`    I1-I5 Away: [${innAway.slice(0,5).map((v: number) => v.toFixed(3)).join(', ')}] → F5 sum=${f5Away.toFixed(3)}`);
    }
    if (innNeither) {
      console.log(`    I1 P(neither): ${innNeither[0].toFixed(4)} | modelPNrfi: ${r.modelPNrfi}`);
    }
    if (hasF5Model) {
      console.log(`    F5 Model: away=${r.modelF5AwayScore} home=${r.modelF5HomeScore} total=${r.modelF5Total} | ML: ${r.modelF5AwayML}/${r.modelF5HomeML} | OverOdds: ${r.modelF5OverOdds}/${r.modelF5UnderOdds}`);
    }
    if (hasNrfiModel) {
      const pNrfi = Number(r.modelPNrfi);
      const pYrfi = (100 - pNrfi).toFixed(2);
      console.log(`    NRFI Model: P(NRFI)=${pNrfi.toFixed(2)}% P(YRFI)=${pYrfi}% | nrfiOdds=${r.modelNrfiOdds} yrfiOdds=${r.modelYrfiOdds}`);
    }
    if (hasF5Book) {
      console.log(`    F5 Book: ML=${r.f5AwayML}/${r.f5HomeML} | RL=${r.f5AwayRunLine}(${r.f5AwayRunLineOdds})/${r.f5HomeRunLine}(${r.f5HomeRunLineOdds}) | Total=${r.f5Total} O${r.f5OverOdds}/U${r.f5UnderOdds}`);
    }
    if (hasNrfiBook) {
      console.log(`    NRFI Book: NRFI=${r.nrfiOverOdds} YRFI=${r.yrfiUnderOdds} | signal=${r.nrfiCombinedSignal} pass=${r.nrfiFilterPass}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`[SUMMARY] ${mlbRows.length} MLB games`);
  console.log(`  Inning distributions: ${innDistOk}/${mlbRows.length} ${innDistOk === mlbRows.length ? '✅' : '❌'}`);
  console.log(`  F5 model lines:       ${f5ModelOk}/${mlbRows.length} ${f5ModelOk === mlbRows.length ? '✅' : '❌'}`);
  console.log(`  NRFI model odds:      ${nrfiModelOk}/${mlbRows.length} ${nrfiModelOk === mlbRows.length ? '✅' : '❌'}`);
  console.log(`  F5 book odds:         ${f5BookOk}/${mlbRows.length} ${f5BookOk > 0 ? '✅' : '❌ (AN scraper not yet run)'}`);
  console.log(`  NRFI book odds:       ${nrfiBookOk}/${mlbRows.length} ${nrfiBookOk > 0 ? '✅' : '❌ (AN scraper not yet run)'}`);
  console.log('');
  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });

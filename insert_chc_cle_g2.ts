/**
 * insert_chc_cle_g2.ts
 * Inserts Cubs @ Guardians Doubleheader Game 2 for 2026-04-05
 * and corrects pitcher data for all games based on MLB Stats API.
 * Run: npx tsx insert_chc_cle_g2.ts
 */
import { getDb } from './server/db';
import { games } from './drizzle/schema';
import { eq, and } from 'drizzle-orm';

// MLB API confirmed data for April 5, 2026
const MLB_API_PITCHERS: Record<number, { awayPitcher: string; homePitcher: string }> = {
  824459: { awayPitcher: 'Edward Cabrera',         homePitcher: 'Slade Cecconi' },
  824460: { awayPitcher: 'Shota Imanaga',           homePitcher: 'Parker Messick' },
  822756: { awayPitcher: 'Roki Sasaki',             homePitcher: 'Foster Griffin' },
  823405: { awayPitcher: 'Chris Bassitt',           homePitcher: 'Braxton Ashcraft' },
  824781: { awayPitcher: 'Walker Buehler',          homePitcher: 'Ranger Suarez' },
  823566: { awayPitcher: 'Chris Paddack',           homePitcher: 'Max Fried' },
  823729: { awayPitcher: 'Nick Martinez',           homePitcher: 'Simeon Woods Richardson' },
  824620: { awayPitcher: 'Eric Lauer',              homePitcher: 'Davis Martin' },
  824131: { awayPitcher: 'Kyle Harrison',           homePitcher: 'Kris Bubic' },
  822917: { awayPitcher: 'Chase Burns',             homePitcher: 'Jack Leiter' },
  824379: { awayPitcher: 'Taijuan Walker',          homePitcher: 'Tomoyuki Sugano' },
  825025: { awayPitcher: 'Lance McCullers Jr.',     homePitcher: 'Jacob Lopez' },
  823238: { awayPitcher: 'Kodai Senga',             homePitcher: 'Logan Webb' },
  824053: { awayPitcher: 'Luis Castillo',           homePitcher: 'Ryan Johnson' },
  825102: { awayPitcher: 'Martín Pérez',            homePitcher: 'Brandon Pfaadt' },
  824296: { awayPitcher: 'Kyle Leahy',              homePitcher: 'Keider Montero' },
};

async function main() {
  console.log('='.repeat(80));
  console.log('[PIPELINE] Insert CHC@CLE G2 + Validate All Pitchers — 2026-04-05');
  console.log('='.repeat(80));

  const db = await getDb();

  // ── Step 1: Get all current MLB games for April 5 ───────────────────────────
  const existing = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    mlbGamePk: games.mlbGamePk,
    gameNumber: games.gameNumber,
    doubleHeader: games.doubleHeader,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    awayBookSpread: games.awayBookSpread,
    homeBookSpread: games.homeBookSpread,
    awaySpreadOdds: games.awaySpreadOdds,
    homeSpreadOdds: games.homeSpreadOdds,
    bookTotal: games.bookTotal,
    overOdds: games.overOdds,
    underOdds: games.underOdds,
    awayML: games.awayML,
    homeML: games.homeML,
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    startTimeEst: games.startTimeEst,
    venue: games.venue,
    modelRunAt: games.modelRunAt,
  }).from(games).where(and(eq(games.gameDate, '2026-04-05'), eq(games.sport, 'MLB')));

  console.log(`\n[STEP 1] Found ${existing.length} existing MLB games`);

  // ── Step 2: Validate and fix pitchers for all existing games ────────────────
  console.log('\n[STEP 2] Validating pitcher data against MLB API...');
  let pitcherFixes = 0;
  for (const g of existing) {
    const pk = g.mlbGamePk;
    if (!pk) {
      console.warn(`  [WARN] Game id:${g.id} ${g.awayTeam}@${g.homeTeam} has no mlbGamePk — skipping pitcher validation`);
      continue;
    }
    const apiPitchers = MLB_API_PITCHERS[pk];
    if (!apiPitchers) {
      console.warn(`  [WARN] No MLB API pitcher data for PK:${pk} (${g.awayTeam}@${g.homeTeam})`);
      continue;
    }
    const awayMatch = g.awayStartingPitcher === apiPitchers.awayPitcher;
    const homeMatch = g.homeStartingPitcher === apiPitchers.homePitcher;
    if (!awayMatch || !homeMatch) {
      console.log(`  [FIX] id:${g.id} ${g.awayTeam}@${g.homeTeam} PK:${pk}`);
      if (!awayMatch) console.log(`    Away: DB="${g.awayStartingPitcher}" → API="${apiPitchers.awayPitcher}"`);
      if (!homeMatch) console.log(`    Home: DB="${g.homeStartingPitcher}" → API="${apiPitchers.homePitcher}"`);
      await db.update(games).set({
        awayStartingPitcher: apiPitchers.awayPitcher,
        homeStartingPitcher: apiPitchers.homePitcher,
        awayPitcherConfirmed: true,
        homePitcherConfirmed: true,
      }).where(eq(games.id, g.id));
      pitcherFixes++;
      // If pitchers changed, clear modelRunAt so it re-runs
      if (g.modelRunAt) {
        console.log(`    [RESET] Clearing modelRunAt for id:${g.id} — pitchers changed, model must re-run`);
        await db.update(games).set({ modelRunAt: null }).where(eq(games.id, g.id));
      }
    } else {
      console.log(`  [OK] id:${g.id} ${g.awayTeam}@${g.homeTeam} — pitchers confirmed correct`);
    }
  }
  console.log(`\n[STEP 2 RESULT] Pitcher fixes applied: ${pitcherFixes}`);

  // ── Step 3: Check if Game 2 already exists ───────────────────────────────────
  console.log('\n[STEP 3] Checking if CHC@CLE Game 2 (PK:824460) already exists...');
  const g2Existing = existing.find(g => g.mlbGamePk === 824460);
  if (g2Existing) {
    console.log(`  [ALREADY EXISTS] id:${g2Existing.id} — skipping insert`);
  } else {
    // ── Step 4: Get Game 1 as template for Game 2 ───────────────────────────────
    const g1 = existing.find(g => g.mlbGamePk === 824459);
    if (!g1) {
      throw new Error('CHC@CLE Game 1 not found in DB — cannot create Game 2 template');
    }
    console.log(`  [TEMPLATE] Using Game 1 id:${g1.id} as template`);

    // VSiN confirmed Game 2 odds:
    // Cubs G2: Spread -1.5 (85%/51%), Total 7.5 (43%/54%), ML -124 (59%/63%)
    // Guardians G2: Spread +1.5 (15%/49%), ML +109 (41%/37%)
    const g2Data = {
      fileId: null as any,
      gameDate: '2026-04-05',
      startTimeEst: '1:45 PM ET',
      awayTeam: 'CHC',
      homeTeam: 'CLE',
      sport: 'MLB',
      gameType: 'regular',
      doubleHeader: 'Y',
      gameNumber: 2,
      mlbGamePk: 824460,
      venue: 'Progressive Field',
      awayStartingPitcher: 'Shota Imanaga',
      homeStartingPitcher: 'Parker Messick',
      awayPitcherConfirmed: true,
      homePitcherConfirmed: true,
      // Book odds from VSiN
      awayBookSpread: '-1.5',
      homeBookSpread: '1.5',
      awaySpreadOdds: g1.awaySpreadOdds,  // Use G1 odds as proxy until VSiN posts G2 odds
      homeSpreadOdds: g1.homeSpreadOdds,
      bookTotal: '7.5',
      overOdds: g1.overOdds,
      underOdds: g1.underOdds,
      awayML: '-124',
      homeML: '+109',
      awayRunLine: '-1.5',
      homeRunLine: '1.5',
      awayRunLineOdds: g1.awayRunLineOdds,
      homeRunLineOdds: g1.homeRunLineOdds,
      // Betting splits from VSiN
      spreadAwayBetsPct: 85,
      spreadAwayMoneyPct: 51,
      totalOverBetsPct: 43,
      totalOverMoneyPct: 54,
      mlAwayBetsPct: 59,
      mlAwayMoneyPct: 63,
      gameStatus: 'upcoming',
      publishedToFeed: false,
      publishedModel: false,
      sortOrder: (g1.startTimeEst ?? '') + '_G2',
    };

    console.log(`  [INSERT] Inserting CHC@CLE Game 2 with PK:824460...`);
    console.log(`    Pitchers: ${g2Data.awayStartingPitcher} vs ${g2Data.homeStartingPitcher}`);
    console.log(`    Spread: ${g2Data.awayBookSpread}/${g2Data.homeBookSpread} | Total: ${g2Data.bookTotal} | ML: ${g2Data.awayML}/${g2Data.homeML}`);
    
    await db.insert(games).values(g2Data as any);
    console.log(`  [SUCCESS] CHC@CLE Game 2 inserted`);
  }

  // ── Step 5: Final verification ───────────────────────────────────────────────
  const finalGames = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    mlbGamePk: games.mlbGamePk,
    gameNumber: games.gameNumber,
    doubleHeader: games.doubleHeader,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    awayBookSpread: games.awayBookSpread,
    bookTotal: games.bookTotal,
    awayML: games.awayML,
    modelRunAt: games.modelRunAt,
  }).from(games).where(and(eq(games.gameDate, '2026-04-05'), eq(games.sport, 'MLB')));

  console.log(`\n[FINAL VERIFICATION] ${finalGames.length} MLB games for 2026-04-05`);
  console.log('='.repeat(80));
  let modeled = 0;
  for (const g of finalGames.sort((a, b) => (a.startTimeEst ?? '').localeCompare(b.startTimeEst ?? '') || (a.gameNumber ?? 1) - (b.gameNumber ?? 1))) {
    const dh = (g.doubleHeader && g.doubleHeader !== 'N') ? ` [DH-G${g.gameNumber}]` : '';
    if (g.modelRunAt) modeled++;
    console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam}${dh} | PK:${g.mlbGamePk}`);
    console.log(`         Pitchers: ${g.awayStartingPitcher ?? 'MISSING'} vs ${g.homeStartingPitcher ?? 'MISSING'}`);
    console.log(`         Spread:${g.awayBookSpread ?? 'NULL'} | Total:${g.bookTotal ?? 'NULL'} | ML:${g.awayML ?? 'NULL'}`);
    console.log(`         Modeled: ${g.modelRunAt ? 'YES' : 'NO'}`);
  }
  console.log(`\n[SUMMARY] Total:${finalGames.length} | Modeled:${modeled}`);
  console.log('[PIPELINE] Insert + Validation COMPLETE.');
  process.exit(0);
}

main().catch(e => { console.error('[FATAL]', e.message, '\n', e.stack); process.exit(1); });

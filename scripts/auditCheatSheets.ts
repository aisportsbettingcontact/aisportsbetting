/**
 * auditCheatSheets.ts
 * 
 * Validates that all MLB games for today have the required CHEAT SHEETS data:
 * 1. F5 book odds (ML/RL/Total) from Action Network
 * 2. F5 model projections (ML/RL/Total/scores)
 * 3. NRFI/YRFI book odds from Action Network
 * 4. NRFI/YRFI model projections (pNrfi, modelNrfiOdds, modelYrfiOdds)
 * 5. Inning distributions (I1-I9 for both teams)
 * 
 * [OUTPUT] Prints a structured audit table for every game.
 * [VERIFY] PASS/FAIL per game per section.
 */

import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TODAY = new Date().toISOString().slice(0, 10);

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[INPUT] CHEAT SHEETS AUDIT — ${TODAY}`);
  console.log(`${'='.repeat(80)}\n`);

  const db = await getDb();
  if (!db) { console.error('[ERROR] DB not available'); process.exit(1); }

  const rows = await db.select().from(games).where(
    and(eq(games.gameDate, TODAY), eq(games.sport, 'MLB'))
  ).orderBy(games.sortOrder);

  console.log(`[INPUT] Games found: ${rows.length}\n`);

  let passCount = 0;
  let failCount = 0;
  const issues: string[] = [];

  for (const g of rows) {
    const matchup = `${g.awayTeam} @ ${g.homeTeam}`;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[GAME] ${matchup} | ${g.startTimeEst}`);
    console.log(`${'─'.repeat(60)}`);

    // ── F5 Book Odds ──────────────────────────────────────────────
    const f5BookOk = !!(g.f5AwayML || g.f5Total || g.f5OverOdds);
    console.log(`[STEP] F5 Book Odds (Action Network)`);
    console.log(`  [STATE] f5AwayML=${g.f5AwayML ?? 'NULL'} | f5HomeML=${g.f5HomeML ?? 'NULL'}`);
    console.log(`  [STATE] f5RL: ${g.f5AwayRunLine ?? 'NULL'}(${g.f5AwayRunLineOdds ?? 'NULL'}) / ${g.f5HomeRunLine ?? 'NULL'}(${g.f5HomeRunLineOdds ?? 'NULL'})`);
    console.log(`  [STATE] f5Total=${g.f5Total ?? 'NULL'} | f5OverOdds=${g.f5OverOdds ?? 'NULL'} | f5UnderOdds=${g.f5UnderOdds ?? 'NULL'}`);
    console.log(`  [VERIFY] F5 Book: ${f5BookOk ? '✅ PASS' : '⚠️  MISSING (odds not yet posted)'}`);

    // ── F5 Model Projections ──────────────────────────────────────
    const f5ModelOk = !!(g.modelF5AwayScore && g.modelF5HomeScore && g.modelF5Total && g.modelF5AwayML && g.modelF5HomeML);
    console.log(`[STEP] F5 Model Projections`);
    console.log(`  [STATE] modelF5Scores: ${g.modelF5AwayScore ?? 'NULL'} - ${g.modelF5HomeScore ?? 'NULL'} | modelF5Total=${g.modelF5Total ?? 'NULL'}`);
    console.log(`  [STATE] modelF5AwayML=${g.modelF5AwayML ?? 'NULL'} | modelF5HomeML=${g.modelF5HomeML ?? 'NULL'}`);
    console.log(`  [STATE] modelF5AwayWinPct=${g.modelF5AwayWinPct ?? 'NULL'} | modelF5HomeWinPct=${g.modelF5HomeWinPct ?? 'NULL'}`);
    console.log(`  [STATE] modelF5AwayRLCoverPct=${g.modelF5AwayRLCoverPct ?? 'NULL'} | modelF5HomeRLCoverPct=${g.modelF5HomeRLCoverPct ?? 'NULL'}`);
    console.log(`  [STATE] modelF5AwayRlOdds=${(g as any).modelF5AwayRlOdds ?? 'NULL'} | modelF5HomeRlOdds=${(g as any).modelF5HomeRlOdds ?? 'NULL'}`);
    console.log(`  [STATE] modelF5OverOdds=${g.modelF5OverOdds ?? 'NULL'} | modelF5UnderOdds=${g.modelF5UnderOdds ?? 'NULL'}`);
    console.log(`  [VERIFY] F5 Model: ${f5ModelOk ? '✅ PASS' : '❌ FAIL — missing model F5 projections'}`);
    if (!f5ModelOk) issues.push(`${matchup}: Missing F5 model projections`);

    // ── NRFI/YRFI Book Odds ───────────────────────────────────────
    const nrfiBookOk = !!(g.nrfiOverOdds || g.yrfiUnderOdds);
    console.log(`[STEP] NRFI/YRFI Book Odds (Action Network)`);
    console.log(`  [STATE] nrfiOverOdds=${g.nrfiOverOdds ?? 'NULL'} | yrfiUnderOdds=${g.yrfiUnderOdds ?? 'NULL'}`);
    console.log(`  [VERIFY] NRFI Book: ${nrfiBookOk ? '✅ PASS' : '⚠️  MISSING (odds not yet posted)'}`);

    // ── NRFI/YRFI Model ───────────────────────────────────────────
    const nrfiModelOk = !!(g.modelPNrfi && g.modelNrfiOdds && g.modelYrfiOdds);
    console.log(`[STEP] NRFI/YRFI Model Projections`);
    console.log(`  [STATE] modelPNrfi=${g.modelPNrfi ?? 'NULL'} | modelNrfiOdds=${g.modelNrfiOdds ?? 'NULL'} | modelYrfiOdds=${g.modelYrfiOdds ?? 'NULL'}`);
    console.log(`  [STATE] nrfiCombinedSignal=${g.nrfiCombinedSignal ?? 'NULL'} | nrfiFilterPass=${g.nrfiFilterPass ?? 'NULL'}`);
    console.log(`  [VERIFY] NRFI Model: ${nrfiModelOk ? '✅ PASS' : '❌ FAIL — missing NRFI model projections'}`);
    if (!nrfiModelOk) issues.push(`${matchup}: Missing NRFI model projections`);

    // ── Inning Distributions ──────────────────────────────────────
    let innDistOk = false;
    let awayArr: number[] | null = null;
    let homeArr: number[] | null = null;
    let pNeitherArr: number[] | null = null;
    try {
      if (g.modelInningAwayExp) awayArr = JSON.parse(g.modelInningAwayExp);
      if (g.modelInningHomeExp) homeArr = JSON.parse(g.modelInningHomeExp);
      if (g.modelInningPNeitherScores) pNeitherArr = JSON.parse(g.modelInningPNeitherScores);
      innDistOk = !!(awayArr && homeArr && awayArr.length >= 9 && homeArr.length >= 9);
    } catch { /* parse error */ }

    console.log(`[STEP] Inning Distributions (I1-I9)`);
    if (awayArr && homeArr) {
      const awayStr = awayArr.slice(0, 9).map((v, i) => `I${i+1}:${v.toFixed(3)}`).join(' ');
      const homeStr = homeArr.slice(0, 9).map((v, i) => `I${i+1}:${v.toFixed(3)}`).join(' ');
      const neitherStr = pNeitherArr ? pNeitherArr.slice(0, 9).map((v, i) => `I${i+1}:${(v*100).toFixed(1)}%`).join(' ') : 'NULL';
      console.log(`  [STATE] AWAY: ${awayStr}`);
      console.log(`  [STATE] HOME: ${homeStr}`);
      console.log(`  [STATE] P(NEITHER): ${neitherStr}`);
    } else {
      console.log(`  [STATE] modelInningAwayExp=${g.modelInningAwayExp ? 'POPULATED' : 'NULL'}`);
      console.log(`  [STATE] modelInningHomeExp=${g.modelInningHomeExp ? 'POPULATED' : 'NULL'}`);
    }
    console.log(`  [VERIFY] Inning Dist: ${innDistOk ? '✅ PASS' : '❌ FAIL — inning distributions not yet populated (model re-run in progress)'}`);
    if (!innDistOk) issues.push(`${matchup}: Inning distributions pending model re-run`);

    // ── Overall game verdict ──────────────────────────────────────
    const gamePass = f5ModelOk && nrfiModelOk;
    if (gamePass) passCount++;
    else failCount++;
    console.log(`\n  [OUTPUT] GAME VERDICT: ${gamePass ? '✅ PASS' : '❌ FAIL'}`);
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[OUTPUT] AUDIT SUMMARY`);
  console.log(`  Games audited: ${rows.length}`);
  console.log(`  Model data PASS: ${passCount}/${rows.length}`);
  console.log(`  Model data FAIL: ${failCount}/${rows.length}`);
  if (issues.length > 0) {
    console.log(`\n  Issues:`);
    issues.forEach(i => console.log(`    ⚠️  ${i}`));
  }
  console.log(`\n[VERIFY] Overall: ${failCount === 0 ? '✅ ALL PASS' : `❌ ${failCount} FAILURES`}`);
  console.log(`${'='.repeat(80)}\n`);

  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });

/**
 * fixRlInversions2026.mts
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE: Fix two legacy RL sign inversions in 2026 historical data.
 *
 * ROOT CAUSE: Both games have awayBookSpread=-1.5 (away team is favorite)
 * but awayModelSpread=+1.5 (model incorrectly shows away as dog). This is
 * a pre-v2 calibration artifact — the fg_rl_away_cover inversion bug that
 * was fixed in v2 (0.3189→0.6430) caused the model to assign the wrong
 * RL sign when the away team was the favorite.
 *
 * GAMES AFFECTED:
 *   id=2250061 | SF @ SD | 2026-03-30 | awayModelSpread=+1.5 → should be -1.5
 *   id=2250071 | TB @ MIL | 2026-03-31 | awayModelSpread=+1.5 → should be -1.5
 *
 * FIX: Swap awayModelSpread/homeModelSpread and awayRunLine/homeRunLine signs
 * to align with book (awayBookSpread=-1.5 = away is favorite).
 *
 * VALIDATION: After fix, awayModelSpread sign must match awayBookSpread sign.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const GAMES_TO_FIX = [
  { id: 2250061, matchup: 'SF @ SD',  date: '2026-03-30' },
  { id: 2250071, matchup: 'TB @ MIL', date: '2026-03-31' },
  { id: 2250113, matchup: 'MIL @ KC', date: '2026-04-04' },
  { id: 2250122, matchup: 'BAL @ PIT', date: '2026-04-05' },
  { id: 2250128, matchup: 'MIL @ KC', date: '2026-04-05' },
  { id: 2250135, matchup: 'CHC @ TB', date: '2026-04-06' },
  { id: 2250136, matchup: 'KC @ CLE', date: '2026-04-06' },
  { id: 2250142, matchup: 'DET @ MIN', date: '2026-04-06' },
  { id: 2250150, matchup: 'CHC @ TB', date: '2026-04-07' },
  { id: 2250176, matchup: 'CIN @ MIA', date: '2026-04-09' },
];

const db = await getDb();

for (const target of GAMES_TO_FIX) {
  console.log(`\n[STEP] Fixing RL inversion: id=${target.id} | ${target.matchup} | ${target.date}`);

  // ── Pre-fix state ──────────────────────────────────────────────────────────
  const before = await db.select({
    awayBookSpread:  games.awayBookSpread,
    homeBookSpread:  games.homeBookSpread,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    modelF5PushPct:  games.modelF5PushPct,
    modelF5PushRaw:  games.modelF5PushRaw,
  }).from(games).where(eq(games.id, target.id));

  const g = before[0];
  if (!g) {
    console.error(`  [FAIL] Game id=${target.id} not found in DB`);
    continue;
  }

  const awayBookNum  = parseFloat(String(g.awayBookSpread ?? '0'));
  const awayModelNum = parseFloat(String(g.awayModelSpread ?? '0'));

  console.log(`  [INPUT] awayBookSpread=${g.awayBookSpread} | awayModelSpread=${g.awayModelSpread}`);
  console.log(`  [INPUT] awayRunLine=${g.awayRunLine} | homeRunLine=${g.homeRunLine}`);
  console.log(`  [INPUT] awayRunLineOdds=${g.awayRunLineOdds} | homeRunLineOdds=${g.homeRunLineOdds}`);
  console.log(`  [INPUT] modelF5PushPct=${g.modelF5PushPct} | modelF5PushRaw=${g.modelF5PushRaw}`);

  // ── Verify inversion exists ────────────────────────────────────────────────
  const bookSign  = awayBookNum  < 0 ? -1 : 1;
  const modelSign = awayModelNum < 0 ? -1 : 1;

  if (bookSign === modelSign) {
    console.log(`  [VERIFY] PASS — No inversion detected. awayBookSpread and awayModelSpread signs match. Skipping.`);
    continue;
  }

  console.log(`  [STATE] Inversion confirmed: book=${bookSign > 0 ? 'HOME_FAV' : 'AWAY_FAV'} model=${modelSign > 0 ? 'HOME_FAV' : 'AWAY_FAV'}`);

  // ── Compute corrected values ───────────────────────────────────────────────
  // The fix: negate awayModelSpread and homeModelSpread to align with book sign.
  // awayRunLine and homeRunLine are the display labels ("+1.5" / "-1.5") — swap them.
  // awayRunLineOdds and homeRunLineOdds: swap the odds to match the corrected sides.
  const newAwayModelSpread = String(awayModelNum * -1);  // +1.5 → -1.5
  const newHomeModelSpread = String(parseFloat(String(g.homeModelSpread ?? '0')) * -1);  // -1.5 → +1.5

  // Swap run line labels
  const newAwayRunLine = g.homeRunLine;  // was home's label, now away's
  const newHomeRunLine = g.awayRunLine;  // was away's label, now home's

  // Swap run line odds (the odds belong to the side, not the label)
  const newAwayRunLineOdds = g.homeRunLineOdds;
  const newHomeRunLineOdds = g.awayRunLineOdds;

  console.log(`  [STEP] Applying correction:`);
  console.log(`    awayModelSpread: ${g.awayModelSpread} → ${newAwayModelSpread}`);
  console.log(`    homeModelSpread: ${g.homeModelSpread} → ${newHomeModelSpread}`);
  console.log(`    awayRunLine: ${g.awayRunLine} → ${newAwayRunLine}`);
  console.log(`    homeRunLine: ${g.homeRunLine} → ${newHomeRunLine}`);
  console.log(`    awayRunLineOdds: ${g.awayRunLineOdds} → ${newAwayRunLineOdds}`);
  console.log(`    homeRunLineOdds: ${g.homeRunLineOdds} → ${newHomeRunLineOdds}`);

  // ── Apply DB update ────────────────────────────────────────────────────────
  await db.update(games).set({
    awayModelSpread: newAwayModelSpread,
    homeModelSpread: newHomeModelSpread,
    awayRunLine:     newAwayRunLine,
    homeRunLine:     newHomeRunLine,
    awayRunLineOdds: newAwayRunLineOdds,
    homeRunLineOdds: newHomeRunLineOdds,
  }).where(eq(games.id, target.id));

  // ── Post-fix verification ──────────────────────────────────────────────────
  const after = await db.select({
    awayBookSpread:  games.awayBookSpread,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
  }).from(games).where(eq(games.id, target.id));

  const a = after[0];
  const newBookSign  = parseFloat(String(a.awayBookSpread ?? '0')) < 0 ? -1 : 1;
  const newModelSign = parseFloat(String(a.awayModelSpread ?? '0')) < 0 ? -1 : 1;

  if (newBookSign === newModelSign) {
    console.log(`  [VERIFY] PASS — RL inversion corrected. awayBookSpread=${a.awayBookSpread} awayModelSpread=${a.awayModelSpread} signs now match.`);
    console.log(`  [OUTPUT] awayRunLine=${a.awayRunLine} homeRunLine=${a.homeRunLine}`);
    console.log(`  [OUTPUT] awayRunLineOdds=${a.awayRunLineOdds} homeRunLineOdds=${a.homeRunLineOdds}`);
  } else {
    console.error(`  [FAIL] RL inversion still present after fix! awayBookSpread=${a.awayBookSpread} awayModelSpread=${a.awayModelSpread}`);
  }
}

console.log('\n[OUTPUT] RL inversion fix complete.');
process.exit(0);

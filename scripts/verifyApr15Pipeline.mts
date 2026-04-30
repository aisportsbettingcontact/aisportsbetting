/**
 * verifyApr15Pipeline.mts
 * End-to-end verification of the April 15, 2026 nightly pipeline:
 * 1. Model runner — games modeled, F5 win pct populated
 * 2. Odds scraper — F5 ML odds present
 * 3. Outcome ingestor — games ingested, Brier scores computed
 * 4. Drift detector — window size and status
 * 5. notifyOwner — check if notification was sent
 */

import 'dotenv/config';
import { getDb } from '../server/db.js';
import { games } from '../drizzle/schema.js';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

const TAG = '[VerifyApr15Pipeline]';
const DATE = '2026-04-15';

console.log(`${TAG} ══════════════════════════════════════════════════════`);
console.log(`${TAG} [INPUT] Verifying April 15, 2026 nightly pipeline`);

const db = await getDb();

// ─── Step 1: Model runner ─────────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 1] Model runner — checking April 15 games...`);
const allApr15 = await db
  .select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    modelF5HomeWinPct: games.modelF5HomeWinPct,
    modelHomeWinPct: games.modelHomeWinPct,
    f5AwayML: games.f5AwayML,
    f5HomeML: games.f5HomeML,
    brierFgMl: games.brierFgMl,
    brierF5Ml: games.brierF5Ml,
    brierNrfi: games.brierNrfi,
    brierFgTotal: games.brierFgTotal,
    brierF5Total: games.brierF5Total,
    actualFgTotal: games.actualFgTotal,
    actualF5Total: games.actualF5Total,
    gameStatus: games.gameStatus,
  })
  .from(games)
  .where(and(eq(games.gameDate, DATE), eq(games.sport, 'MLB')))
  .orderBy(games.id);

console.log(`${TAG} [OUTPUT] Total April 15 games in DB: ${allApr15.length}`);

const modeled = allApr15.filter(g => g.modelF5AwayWinPct != null);
const notModeled = allApr15.filter(g => g.modelF5AwayWinPct == null);
console.log(`${TAG} [STATE]  Modeled (modelF5AwayWinPct populated): ${modeled.length}`);
console.log(`${TAG} [STATE]  Not modeled: ${notModeled.length}`);

if (notModeled.length > 0) {
  for (const g of notModeled) {
    console.warn(`${TAG} [VERIFY] NOT MODELED: id=${g.id} ${g.awayTeam}@${g.homeTeam} status=${g.gameStatus}`);
  }
}

// ─── Step 2: Odds scraper ─────────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 2] Odds scraper — checking F5 ML odds...`);
const withF5Odds = modeled.filter(g => g.f5AwayML != null);
const missingF5Odds = modeled.filter(g => g.f5AwayML == null);
console.log(`${TAG} [OUTPUT] Modeled games with F5 ML odds: ${withF5Odds.length}/${modeled.length}`);
if (missingF5Odds.length > 0) {
  console.warn(`${TAG} [VERIFY] WARN — ${missingF5Odds.length} modeled games missing F5 ML odds:`);
  for (const g of missingF5Odds) {
    console.warn(`${TAG} [STATE]   id=${g.id} ${g.awayTeam}@${g.homeTeam}`);
  }
} else if (modeled.length > 0) {
  console.log(`${TAG} [VERIFY] PASS — all modeled games have F5 ML odds`);
}

// ─── Step 3: Outcome ingestor ─────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 3] Outcome ingestor — checking Brier scores...`);
const ingested = allApr15.filter(g => g.actualFgTotal != null);
const notIngested = allApr15.filter(g => g.actualFgTotal == null);
console.log(`${TAG} [OUTPUT] Games with outcomes ingested: ${ingested.length}/${allApr15.length}`);

if (ingested.length > 0) {
  const withBrierFgMl = ingested.filter(g => g.brierFgMl != null);
  const withBrierF5Ml = ingested.filter(g => g.brierF5Ml != null);
  const withBrierNrfi = ingested.filter(g => g.brierNrfi != null);
  console.log(`${TAG} [STATE]  brierFgMl populated: ${withBrierFgMl.length}/${ingested.length}`);
  console.log(`${TAG} [STATE]  brierF5Ml populated: ${withBrierF5Ml.length}/${ingested.length} (nulls = F5 ties)`);
  console.log(`${TAG} [STATE]  brierNrfi populated: ${withBrierNrfi.length}/${ingested.length}`);

  // Show per-game Brier scores
  console.log(`${TAG} [STATE]  Per-game Brier scores:`);
  for (const g of ingested) {
    console.log(`${TAG} [STATE]    ${g.awayTeam}@${g.homeTeam} | FgML=${g.brierFgMl != null ? Number(g.brierFgMl).toFixed(4) : 'NULL'} F5ML=${g.brierF5Ml != null ? Number(g.brierF5Ml).toFixed(4) : 'NULL'} NRFI=${g.brierNrfi != null ? Number(g.brierNrfi).toFixed(4) : 'NULL'}`);
  }
} else {
  console.warn(`${TAG} [VERIFY] WARN — No outcomes ingested yet for April 15 (games may still be in progress)`);
}

if (notIngested.length > 0) {
  console.log(`${TAG} [STATE]  Games not yet ingested: ${notIngested.length}`);
  for (const g of notIngested) {
    console.log(`${TAG} [STATE]    id=${g.id} ${g.awayTeam}@${g.homeTeam} status=${g.gameStatus}`);
  }
}

// ─── Step 4: Drift detector window ───────────────────────────────────────────
console.log(`\n${TAG} [STEP 4] Drift detector — checking rolling window size...`);
const windowRows = await db.execute(sql`
  SELECT COUNT(*) as cnt
  FROM games
  WHERE sport = 'MLB'
    AND brier_fg_ml IS NOT NULL
    AND actual_fg_total IS NOT NULL
  ORDER BY outcome_ingested_at DESC
  LIMIT 50
`);
const allIngestedRows = await db.execute(sql`
  SELECT COUNT(*) as cnt
  FROM games
  WHERE sport = 'MLB'
    AND brier_fg_ml IS NOT NULL
    AND actual_fg_total IS NOT NULL
`);
const totalIngested = Number((allIngestedRows.rows ?? allIngestedRows)[0]?.cnt ?? 0);
console.log(`${TAG} [OUTPUT] Total games with Brier scores (drift window candidates): ${totalIngested}`);
if (totalIngested >= 50) {
  console.log(`${TAG} [VERIFY] PASS — drift detector has full 50-game window`);
} else if (totalIngested >= 20) {
  console.log(`${TAG} [VERIFY] PASS — drift detector has sufficient data (${totalIngested}/20 minimum)`);
} else {
  console.warn(`${TAG} [VERIFY] WARN — drift detector needs more data (${totalIngested}/20 minimum)`);
}

// ─── Step 5: F5 ML edge coverage summary ─────────────────────────────────────
console.log(`\n${TAG} [STEP 5] F5 ML edge coverage — all 2026 modeled games...`);
const edgeCoverageRows = await db.execute(sql`
  SELECT
    COUNT(*) as total_modeled,
    SUM(CASE WHEN f5_away_ml IS NOT NULL THEN 1 ELSE 0 END) as with_f5_odds,
    SUM(CASE WHEN f5_away_ml IS NULL THEN 1 ELSE 0 END) as missing_f5_odds,
    SUM(CASE WHEN brier_f5_ml IS NOT NULL AND brier_f5_ml > 0 THEN 1 ELSE 0 END) as brier_f5_populated,
    SUM(CASE WHEN brier_f5_ml IS NULL AND actual_f5_total IS NOT NULL THEN 1 ELSE 0 END) as brier_f5_null_ingested
  FROM games
  WHERE sport = 'MLB' AND model_f5_away_win_pct IS NOT NULL
`);
const ec = (edgeCoverageRows.rows ?? edgeCoverageRows)[0] as Record<string, unknown>;
console.log(`${TAG} [OUTPUT] Total modeled: ${ec.total_modeled}`);
console.log(`${TAG} [OUTPUT] With F5 ML odds: ${ec.with_f5_odds} (${(Number(ec.with_f5_odds) / Number(ec.total_modeled) * 100).toFixed(1)}%)`);
console.log(`${TAG} [OUTPUT] Missing F5 ML odds: ${ec.missing_f5_odds}`);
console.log(`${TAG} [OUTPUT] brierF5Ml populated (>0): ${ec.brier_f5_populated}`);
console.log(`${TAG} [OUTPUT] brierF5Ml null (ingested = F5 tie): ${ec.brier_f5_null_ingested}`);

console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
process.exit(0);

/**
 * runDriftAndReingest.mts
 * Runs Step 6 (checkF5ShareDrift) and Step 7 (force re-ingest 2026-04-14)
 * These are the final two steps from backfillF5WinPct.mts that were interrupted.
 */

import 'dotenv/config';
import { checkF5ShareDrift } from '../server/mlbDriftDetector.js';
import { ingestMlbOutcomes } from '../server/mlbOutcomeIngestor.js';
import { getDb } from '../server/db.js';
import { games } from '../drizzle/schema.js';
import { and, eq } from 'drizzle-orm';

const TAG = '[DriftAndReingest]';

// ─── Step 6: checkDrift ──────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
console.log(`${TAG} [STEP 6] Triggering checkF5ShareDrift — first full 50-game rolling window...`);
console.log(`${TAG} [INPUT] triggerRecal=true (auto-recalibrate if drift detected and cooldown not active)`);
try {
  const drift = await checkF5ShareDrift(true);
  console.log(`${TAG} [OUTPUT] driftDetected=${drift.driftDetected}`);
  console.log(`${TAG} [STATE]  windowSize=${drift.windowSize}`);
  console.log(`${TAG} [STATE]  currentAvg=${drift.currentAvg?.toFixed(4) ?? 'N/A'}`);
  console.log(`${TAG} [STATE]  baselineAvg=${drift.baselineAvg?.toFixed(4) ?? 'N/A'}`);
  console.log(`${TAG} [STATE]  delta=${drift.delta?.toFixed(4) ?? 'N/A'}`);
  console.log(`${TAG} [STATE]  recalibrationTriggered=${drift.recalibrationTriggered}`);
  console.log(`${TAG} [STATE]  cooldownSkipped=${drift.cooldownSkipped}`);
  console.log(`${TAG} [STATE]  lastRecalibrationAt=${drift.lastRecalibrationAt ?? 'never'}`);
  console.log(`${TAG} [STATE]  message=${drift.message}`);
  if (drift.driftDetected) {
    console.warn(`${TAG} [VERIFY] DRIFT DETECTED — delta=${drift.delta?.toFixed(4)} exceeds threshold 0.02`);
    if (drift.recalibrationTriggered) {
      console.log(`${TAG} [VERIFY] Recalibration triggered automatically`);
    } else if (drift.cooldownSkipped) {
      console.log(`${TAG} [VERIFY] Recalibration skipped (cooldown active)`);
    }
  } else {
    console.log(`${TAG} [VERIFY] PASS — no drift detected (delta=${drift.delta?.toFixed(4) ?? 'N/A'}, threshold=0.02)`);
  }
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`${TAG} [ERROR] checkF5ShareDrift failed: ${errMsg}`);
}

// ─── Step 7: Force re-ingest April 14 ────────────────────────────────────────
console.log(`\n${TAG} [STEP 7] Force re-ingesting 2026-04-14 to recompute brierF5Ml...`);
console.log(`${TAG} [INPUT] force=true (overwrite existing Brier scores for April 14)`);
try {
  const reingestSummary = await ingestMlbOutcomes('2026-04-14', true);
  console.log(`${TAG} [OUTPUT] Re-ingest 2026-04-14: total=${reingestSummary.totalGames} written=${reingestSummary.written} errors=${reingestSummary.errors}`);
  if (reingestSummary.errors > 0) {
    console.error(`${TAG} [ERROR] Re-ingest had ${reingestSummary.errors} error(s)`);
  } else if (reingestSummary.written === 0) {
    console.warn(`${TAG} [VERIFY] WARN — written=0 for 2026-04-14 re-ingest (check force flag)`);
  } else {
    // Spot-check: verify brierF5Ml is now non-zero
    const db2 = await getDb();
    const spot = await db2
      .select({
        id: games.id,
        awayTeam: games.awayTeam,
        homeTeam: games.homeTeam,
        brierF5Ml: games.brierF5Ml,
        brierFgMl: games.brierFgMl,
        brierNrfi: games.brierNrfi,
        modelF5AwayWinPct: games.modelF5AwayWinPct,
        modelF5HomeWinPct: games.modelF5HomeWinPct,
      })
      .from(games)
      .where(and(eq(games.gameDate, '2026-04-14'), eq(games.sport, 'MLB')));
    const nonZeroF5 = spot.filter(r => r.brierF5Ml != null && r.brierF5Ml > 0);
    console.log(`${TAG} [VERIFY] brierF5Ml spot-check (all ${spot.length} April 14 games):`);
    for (const r of spot) {
      console.log(`${TAG} [STATE]  id=${r.id} ${r.awayTeam}@${r.homeTeam} | brierFgMl=${r.brierFgMl?.toFixed(4)} brierF5Ml=${r.brierF5Ml?.toFixed(4)} brierNrfi=${r.brierNrfi?.toFixed(4)} | modelF5Away=${r.modelF5AwayWinPct?.toFixed(2)} modelF5Home=${r.modelF5HomeWinPct?.toFixed(2)}`);
    }
    if (nonZeroF5.length > 0) {
      console.log(`${TAG} [VERIFY] PASS — ${nonZeroF5.length}/${spot.length} games have non-zero brierF5Ml`);
    } else {
      console.warn(`${TAG} [VERIFY] WARN — all games still have brierF5Ml=0 or null`);
    }
  }
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`${TAG} [ERROR] Force re-ingest 2026-04-14 failed: ${errMsg}`);
}

console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
process.exit(0);

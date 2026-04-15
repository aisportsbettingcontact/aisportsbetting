/**
 * backfillF5WinPct.mts
 *
 * PURPOSE:
 *   Backfills modelF5HomeWinPct and modelF5AwayWinPct for all 2026 MLB games
 *   that were modeled before the fix in mlbModelRunner.ts (2026-04-15).
 *
 *   These two fields were never being written prior to the April 15 fix.
 *   This script re-runs the Python engine for each affected date and writes
 *   all model fields (idempotent — safe to re-run; overwrites with correct values).
 *
 * SCOPE:
 *   - All MLB games with modelRunAt != null AND modelF5AwayWinPct IS NULL
 *   - Covers 2026-03-26 through 2026-04-14 (256 games as of audit)
 *   - April 15 games already have correct values — skipped automatically
 *
 * APPROACH:
 *   1. Query all affected games (modeled but missing F5 win pct)
 *   2. Group by date for efficient Python batch processing
 *   3. For each date: call runMlbModelForDate() (same path as production runner)
 *   4. Post-run verify modelF5HomeWinPct + modelF5AwayWinPct are now populated
 *   5. Final DB validation: count remaining NULLs
 *
 * LOGGING CONVENTION:
 *   [INPUT]   trigger parameters
 *   [STEP]    operation in progress
 *   [STATE]   per-game intermediate values
 *   [OUTPUT]  write result per game
 *   [VERIFY]  post-write validation
 *   [SUMMARY] batch summary
 *   [ERROR]   failure with context
 *   [SKIP]    game skipped with reason
 *
 * USAGE:
 *   npx tsx scripts/backfillF5WinPct.mts
 *   npx tsx scripts/backfillF5WinPct.mts --dry-run   (log only, no DB writes)
 *   npx tsx scripts/backfillF5WinPct.mts --force     (re-run even if already populated)
 */

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { runMlbModelForDate } from "../server/mlbModelRunner";
import { checkF5ShareDrift } from "../server/mlbDriftDetector";
import { ingestMlbOutcomes } from "../server/mlbOutcomeIngestor";

const TAG = "[BackfillF5WinPct]";
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE   = process.argv.includes("--force");

// ─── Step 0: Banner ───────────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
console.log(`${TAG} [INPUT] DRY_RUN=${DRY_RUN} FORCE=${FORCE}`);
console.log(`${TAG} [INPUT] Purpose: backfill modelF5HomeWinPct + modelF5AwayWinPct for pre-fix games`);
if (DRY_RUN) {
  console.log(`${TAG} [INPUT] ⚠️  DRY RUN — no DB writes will be performed`);
}

// ─── Step 1: Query all affected games ─────────────────────────────────────────
console.log(`\n${TAG} [STEP 1] Querying DB for modeled games missing F5 win pct...`);
const db = await getDb();

const whereClause = FORCE
  ? and(
      eq(games.sport, "MLB"),
      isNotNull(games.modelRunAt),
    )
  : and(
      eq(games.sport, "MLB"),
      isNotNull(games.modelRunAt),
      isNull(games.modelF5AwayWinPct),
    );

const affectedGames = await db
  .select({
    id:               games.id,
    gameDate:         games.gameDate,
    awayTeam:         games.awayTeam,
    homeTeam:         games.homeTeam,
    modelRunAt:       games.modelRunAt,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    modelF5HomeWinPct: games.modelF5HomeWinPct,
  })
  .from(games)
  .where(whereClause);

console.log(`${TAG} [STATE] Found ${affectedGames.length} games to backfill`);

if (affectedGames.length === 0) {
  console.log(`${TAG} [VERIFY] PASS — no games need backfill`);
  console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
  process.exit(0);
}

// ─── Step 2: Group by date ────────────────────────────────────────────────────
const dateGroups = new Map<string, typeof affectedGames>();
for (const g of affectedGames) {
  const date = g.gameDate ?? "unknown";
  if (!dateGroups.has(date)) dateGroups.set(date, []);
  dateGroups.get(date)!.push(g);
}

const sortedDates = [...dateGroups.keys()].sort();
console.log(`${TAG} [STATE] Dates to process: ${sortedDates.join(", ")}`);
console.log(`${TAG} [STATE] Total dates: ${sortedDates.length} | Total games: ${affectedGames.length}`);

// ─── Step 3: Process each date ────────────────────────────────────────────────
let totalWritten = 0;
let totalSkipped = 0;
let totalErrors  = 0;

const dateResults: Array<{
  date: string;
  games: number;
  written: number;
  skipped: number;
  errors: number;
  verifyPass: number;
  verifyFail: number;
}> = [];

for (const dateStr of sortedDates) {
  const gamesForDate = dateGroups.get(dateStr)!;
  console.log(`\n${TAG} ── ${dateStr} (${gamesForDate.length} games) ──────────────────────────────`);

  // Log the games being processed
  for (const g of gamesForDate) {
    console.log(`${TAG} [STATE]  id=${g.id} ${g.awayTeam}@${g.homeTeam} | F5Away=${g.modelF5AwayWinPct ?? "NULL"} F5Home=${g.modelF5HomeWinPct ?? "NULL"}`);
  }

  if (DRY_RUN) {
    console.log(`${TAG} [SKIP] DRY RUN — skipping Python engine for ${dateStr}`);
    totalSkipped += gamesForDate.length;
    dateResults.push({ date: dateStr, games: gamesForDate.length, written: 0, skipped: gamesForDate.length, errors: 0, verifyPass: 0, verifyFail: 0 });
    continue;
  }

  // ── Step 3a: Re-run the full model for this date ──────────────────────────
  // runMlbModelForDate is idempotent — it overwrites all model fields with correct values.
  // This is the same code path as the production nightly runner.
  console.log(`${TAG} [STEP 3a] Running Python engine for ${dateStr}...`);
  const startMs = Date.now();

  let dateWritten = 0;
  let dateSkipped = 0;
  let dateErrors  = 0;
  let verifyPass  = 0;
  let verifyFail  = 0;

  try {
    const summary = await runMlbModelForDate(dateStr);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`${TAG} [OUTPUT] ${dateStr}: total=${summary.total} written=${summary.written} skipped=${summary.skipped} errors=${summary.errors} elapsed=${elapsed}s`);

    if (summary.errors > 0) {
      console.error(`${TAG} [ERROR] ${dateStr}: ${summary.errors} engine error(s)`);
      dateErrors += summary.errors;
    }
    dateSkipped = summary.skipped;

    // ── Step 3b: Post-run verify F5 win pct was written ────────────────────
    console.log(`${TAG} [STEP 3b] Verifying F5 win pct written for ${dateStr}...`);
    const verifyRows = await db
      .select({
        id:               games.id,
        awayTeam:         games.awayTeam,
        homeTeam:         games.homeTeam,
        modelF5AwayWinPct: games.modelF5AwayWinPct,
        modelF5HomeWinPct: games.modelF5HomeWinPct,
        modelRunAt:       games.modelRunAt,
      })
      .from(games)
      .where(
        and(
          eq(games.gameDate, dateStr),
          eq(games.sport, "MLB"),
          isNotNull(games.modelRunAt),
        )
      );

    for (const row of verifyRows) {
      const matchup = `${row.awayTeam}@${row.homeTeam}`;
      if (row.modelF5AwayWinPct !== null && row.modelF5HomeWinPct !== null) {
        console.log(`${TAG} [VERIFY] PASS — id=${row.id} ${matchup} | F5Away=${row.modelF5AwayWinPct} F5Home=${row.modelF5HomeWinPct}`);
        verifyPass++;
        dateWritten++;
      } else {
        console.error(`${TAG} [VERIFY] FAIL — id=${row.id} ${matchup} | F5Away=${row.modelF5AwayWinPct ?? "NULL"} F5Home=${row.modelF5HomeWinPct ?? "NULL"}`);
        verifyFail++;
        dateErrors++;
      }
    }

    console.log(`${TAG} [STATE] ${dateStr}: verify_pass=${verifyPass} verify_fail=${verifyFail}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] ${dateStr}: ${msg}`);
    dateErrors = gamesForDate.length;
  }

  totalWritten += dateWritten;
  totalSkipped += dateSkipped;
  totalErrors  += dateErrors;
  dateResults.push({ date: dateStr, games: gamesForDate.length, written: dateWritten, skipped: dateSkipped, errors: dateErrors, verifyPass, verifyFail });
}

// ─── Step 4: Final summary ────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
console.log(`${TAG} [SUMMARY] Backfill complete`);
console.log(`${TAG} [SUMMARY] dates=${sortedDates.length} | totalGames=${affectedGames.length} | written=${totalWritten} | skipped=${totalSkipped} | errors=${totalErrors}`);
console.log(`\n${TAG} [SUMMARY] Per-date breakdown:`);
for (const r of dateResults) {
  const status = r.errors > 0 ? "ERROR" : r.verifyPass > 0 ? "OK" : "SKIP";
  console.log(`${TAG} [STATE]  ${r.date}: games=${r.games} written=${r.written} skipped=${r.skipped} errors=${r.errors} verify_pass=${r.verifyPass} verify_fail=${r.verifyFail} [${status}]`);
}

// ─── Step 5: Final DB validation ─────────────────────────────────────────────
if (!DRY_RUN) {
  console.log(`\n${TAG} [STEP 5] Final DB validation — counting remaining NULLs...`);
  const remainingNull = await db
    .select({
      id:       games.id,
      gameDate: games.gameDate,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        isNotNull(games.modelRunAt),
        isNull(games.modelF5AwayWinPct),
      )
    );

  console.log(`${TAG} [VERIFY] Remaining NULL modelF5AwayWinPct after backfill: ${remainingNull.length}`);
  if (remainingNull.length > 0) {
    console.error(`${TAG} [VERIFY] FAIL — ${remainingNull.length} games still missing F5 win pct:`);
    for (const g of remainingNull.slice(0, 20)) {
      console.error(`${TAG} [VERIFY]   id=${g.id} ${g.gameDate} ${g.awayTeam}@${g.homeTeam}`);
    }
    if (remainingNull.length > 20) {
      console.error(`${TAG} [VERIFY]   ... and ${remainingNull.length - 20} more`);
    }
    console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
    process.exit(1);
  } else {
    console.log(`${TAG} [VERIFY] PASS — all modeled games now have modelF5AwayWinPct populated`);
  }
}

if (totalErrors > 0) {
  console.error(`${TAG} [VERIFY] FAIL — ${totalErrors} error(s) during backfill`);
  console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
  process.exit(1);
}

console.log(`${TAG} [VERIFY] PASS — backfill complete with 0 errors`);

// ─── Step 6: Trigger checkDrift — first full 50-game rolling window evaluation ──────────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 6] Triggering checkF5ShareDrift — first full 50-game rolling window...`);
console.log(`${TAG} [INPUT] triggerRecal=true (auto-recalibrate if drift detected and cooldown not active)`);
try {
  const drift = await checkF5ShareDrift(true);
  console.log(`${TAG} [OUTPUT] checkF5ShareDrift complete`);
  console.log(`${TAG} [STATE]  windowSize=${drift.windowSize}`);
  console.log(`${TAG} [STATE]  rollingF5Share=${drift.rollingF5Share ?? 'null'}`);
  console.log(`${TAG} [STATE]  baselineF5Share=${drift.baselineF5Share}`);
  console.log(`${TAG} [STATE]  delta=${drift.delta ?? 'null'}`);
  console.log(`${TAG} [STATE]  driftDetected=${drift.driftDetected}`);
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
  // Non-fatal: backfill succeeded, drift check failure does not block exit
}

// ─── Step 7: Force re-ingest April 14 — recompute brierF5Ml now that F5 win pct is populated ────
// April 14 was ingested before the backfill ran, so brierF5Ml was 0.0000 (modelF5HomeWinPct was NULL).
// Now that all 15 April 14 games have correct modelF5HomeWinPct/modelF5AwayWinPct values,
// re-ingesting with force=true will recompute the correct Brier scores.
console.log(`\n${TAG} [STEP 7] Force re-ingesting 2026-04-14 to recompute brierF5Ml...`);
console.log(`${TAG} [INPUT] force=true (overwrite existing Brier scores for April 14)`);
try {
  const reingestSummary = await ingestMlbOutcomes('2026-04-14', true);
  console.log(`${TAG} [OUTPUT] Re-ingest 2026-04-14: total=${reingestSummary.totalGames} written=${reingestSummary.written} errors=${reingestSummary.errors}`);
  if (reingestSummary.errors > 0) {
    console.error(`${TAG} [ERROR] Re-ingest had ${reingestSummary.errors} error(s)`);
  } else if (reingestSummary.written === 0) {
    console.warn(`${TAG} [VERIFY] WARN — written=0 for 2026-04-14 re-ingest (check force flag in ingestMlbOutcomes)`);
  } else {
    // Spot-check: verify brierF5Ml is now non-zero for at least one game
    const db2 = await getDb();
    const spot = await db2
      .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam, brierF5Ml: games.brierF5Ml, modelF5AwayWinPct: games.modelF5AwayWinPct })
      .from(games)
      .where(and(eq(games.gameDate, '2026-04-14'), eq(games.sport, 'MLB')))
      .limit(5);
    const nonZero = spot.filter(r => r.brierF5Ml != null && r.brierF5Ml > 0);
    console.log(`${TAG} [VERIFY] brierF5Ml spot-check (first 5 games):`);
    for (const r of spot) {
      console.log(`${TAG} [STATE]  id=${r.id} ${r.awayTeam}@${r.homeTeam} | brierF5Ml=${r.brierF5Ml} modelF5Away=${r.modelF5AwayWinPct}`);
    }
    if (nonZero.length > 0) {
      console.log(`${TAG} [VERIFY] PASS — ${nonZero.length}/${spot.length} sampled games have non-zero brierF5Ml`);
    } else {
      console.warn(`${TAG} [VERIFY] WARN — all sampled games still have brierF5Ml=0 or null (check ingestor logic)`);
    }
  }
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`${TAG} [ERROR] Force re-ingest 2026-04-14 failed: ${errMsg}`);
  // Non-fatal: backfill and drift check succeeded
}

console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
process.exit(0);

/**
 * backfillF5Push2026.mts
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE: Backfill modelF5PushPct + modelF5PushRaw for all 2026 MLB games
 *          from 2026-03-25 through 2026-04-13 that have NULL push values.
 *
 * STRATEGY:
 *   1. Query DB for all MLB games in the date range where modelF5PushPct IS NULL
 *      AND modelRunAt IS NOT NULL (i.e., already modeled but missing push field).
 *   2. For each unique gameDate, call runMlbModelForDate() to re-run the full
 *      Monte Carlo engine for that slate.
 *   3. After each date, run validateMlbModelResults() and log PASS/FAIL.
 *   4. After all dates, print a final audit: count of games with NULL push values.
 *
 * EXECUTION:
 *   cd /home/ubuntu/ai-sports-betting
 *   npx tsx scripts/backfillF5Push2026.mts 2>&1 | tee /tmp/backfill_f5push_2026.log
 *
 * ESTIMATED TIME: ~16 min per date × 20 dates ≈ 5-6 hours total
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { runMlbModelForDate, validateMlbModelResults } from "../server/mlbModelRunner";
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { and, eq, isNull, isNotNull, between, sql } from "drizzle-orm";

// ── Date range: 2026-03-25 through 2026-04-13 (April 14 is already complete) ──
const START_DATE = "2026-03-25";
const END_DATE   = "2026-04-13";

// ── Build ordered list of dates in range ──────────────────────────────────────
function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T12:00:00Z");
  const fin = new Date(end   + "T12:00:00Z");
  while (cur <= fin) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// ── Pre-flight: count games needing backfill ──────────────────────────────────
async function countNullPushGames(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  const rows = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        between(games.gameDate, START_DATE, END_DATE),
        isNull(games.modelF5PushPct),
        isNotNull(games.modelRunAt),
      )
    );
  return Number(rows[0]?.cnt ?? 0);
}

// ── Check which dates have at least one NULL push game ────────────────────────
async function getDatesNeedingBackfill(
  db: Awaited<ReturnType<typeof getDb>>,
  allDates: string[]
): Promise<string[]> {
  const needsWork: string[] = [];
  for (const d of allDates) {
    const rows = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(games)
      .where(
        and(
          eq(games.sport, "MLB"),
          eq(games.gameDate, d),
          isNull(games.modelF5PushPct),
          isNotNull(games.modelRunAt),
        )
      );
    const cnt = Number(rows[0]?.cnt ?? 0);
    if (cnt > 0) {
      needsWork.push(d);
      console.log(`  [PREFLIGHT] ${d}: ${cnt} game(s) need push backfill`);
    } else {
      console.log(`  [PREFLIGHT] ${d}: already complete (0 NULL push games)`);
    }
  }
  return needsWork;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startTs = Date.now();
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" MLB F5 Push Backfill 2026 — v2.1 Model");
  console.log(` Date range : ${START_DATE} → ${END_DATE}`);
  console.log(` Started at : ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════");

  const db = await getDb();
  const allDates = buildDateRange(START_DATE, END_DATE);
  console.log(`\n[INPUT] Total dates in range: ${allDates.length}`);

  // ── Pre-flight audit ───────────────────────────────────────────────────────
  console.log("\n[STEP] Pre-flight: scanning for NULL modelF5PushPct games...");
  const totalNullBefore = await countNullPushGames(db);
  console.log(`[STATE] Total games with NULL modelF5PushPct: ${totalNullBefore}`);

  if (totalNullBefore === 0) {
    console.log("\n[OUTPUT] All games in range already have modelF5PushPct populated.");
    console.log("[VERIFY] PASS — No backfill required.");
    process.exit(0);
  }

  const datesToRun = await getDatesNeedingBackfill(db, allDates);
  console.log(`\n[STATE] Dates requiring re-run: ${datesToRun.length} of ${allDates.length}`);

  // ── Per-date execution loop ────────────────────────────────────────────────
  const results: Array<{
    date: string;
    written: number;
    skipped: number;
    errors: number;
    validationPassed: boolean;
    validationIssues: string[];
    elapsedMin: number;
  }> = [];

  for (let i = 0; i < datesToRun.length; i++) {
    const d = datesToRun[i];
    const dateStart = Date.now();
    const pct = (((i + 1) / datesToRun.length) * 100).toFixed(1);

    console.log("\n───────────────────────────────────────────────────────────────");
    console.log(`[STEP] Processing ${d}  (${i + 1}/${datesToRun.length}, ${pct}% of backfill)`);
    console.log(`       Overall progress: ${i}/${datesToRun.length} complete`);
    console.log(`       Elapsed total: ${((Date.now() - startTs) / 60000).toFixed(1)} min`);

    let summary = { written: 0, skipped: 0, errors: 0 };
    try {
      summary = await runMlbModelForDate(d);
      console.log(`  [OUTPUT] written=${summary.written} skipped=${summary.skipped} errors=${summary.errors}`);
    } catch (err) {
      console.error(`  [FAIL] runMlbModelForDate(${d}) threw:`, err);
      results.push({
        date: d,
        written: 0,
        skipped: 0,
        errors: 1,
        validationPassed: false,
        validationIssues: [`runMlbModelForDate threw: ${String(err)}`],
        elapsedMin: (Date.now() - dateStart) / 60000,
      });
      continue;
    }

    // ── Post-run validation ────────────────────────────────────────────────
    let valResult = { passed: false, issues: [] as string[], warnings: [] as string[] };
    try {
      valResult = await validateMlbModelResults(d);
      if (valResult.passed) {
        console.log(`  [VERIFY] PASS — ${d} validation clean`);
      } else {
        console.warn(`  [VERIFY] FAIL — ${d} has ${valResult.issues.length} issue(s):`);
        valResult.issues.forEach(iss => console.warn(`    • ${iss}`));
      }
      if (valResult.warnings.length > 0) {
        valResult.warnings.forEach(w => console.log(`    [WARN] ${w}`));
      }
    } catch (err) {
      console.error(`  [FAIL] validateMlbModelResults(${d}) threw:`, err);
      valResult.issues.push(`validateMlbModelResults threw: ${String(err)}`);
    }

    const elapsedMin = (Date.now() - dateStart) / 60000;
    results.push({
      date: d,
      written: summary.written,
      skipped: summary.skipped,
      errors: summary.errors,
      validationPassed: valResult.passed,
      validationIssues: valResult.issues,
      elapsedMin,
    });

    // ── ETA estimate ──────────────────────────────────────────────────────
    const avgMinPerDate = (Date.now() - startTs) / 60000 / (i + 1);
    const remaining = datesToRun.length - (i + 1);
    const etaMin = avgMinPerDate * remaining;
    console.log(`  [STATE] Date elapsed: ${elapsedMin.toFixed(1)} min | ETA remaining: ${etaMin.toFixed(0)} min`);
  }

  // ── Final audit ────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(" BACKFILL COMPLETE — Final Audit");
  console.log("═══════════════════════════════════════════════════════════════");

  const totalNullAfter = await countNullPushGames(db);
  const totalElapsedMin = (Date.now() - startTs) / 60000;

  console.log(`\n[OUTPUT] Summary:`);
  console.log(`  Dates processed    : ${datesToRun.length}`);
  console.log(`  Total elapsed      : ${totalElapsedMin.toFixed(1)} min`);
  console.log(`  NULL push before   : ${totalNullBefore}`);
  console.log(`  NULL push after    : ${totalNullAfter}`);
  console.log(`  Games backfilled   : ${totalNullBefore - totalNullAfter}`);

  console.log(`\n[OUTPUT] Per-date results:`);
  console.log(`  ${"DATE".padEnd(12)} ${"WRITTEN".padEnd(8)} ${"SKIP".padEnd(6)} ${"ERR".padEnd(5)} ${"VALID".padEnd(6)} ${"MIN".padEnd(6)}`);
  console.log(`  ${"-".repeat(55)}`);
  for (const r of results) {
    const validStr = r.validationPassed ? "PASS" : "FAIL";
    console.log(
      `  ${r.date.padEnd(12)} ${String(r.written).padEnd(8)} ${String(r.skipped).padEnd(6)} ` +
      `${String(r.errors).padEnd(5)} ${validStr.padEnd(6)} ${r.elapsedMin.toFixed(1).padEnd(6)}`
    );
    if (!r.validationPassed && r.validationIssues.length > 0) {
      r.validationIssues.forEach(iss => console.log(`    ↳ ${iss}`));
    }
  }

  const failedDates = results.filter(r => !r.validationPassed || r.errors > 0);
  if (failedDates.length > 0) {
    console.log(`\n[VERIFY] FAIL — ${failedDates.length} date(s) had issues:`);
    failedDates.forEach(r => console.log(`  • ${r.date}`));
  } else if (totalNullAfter === 0) {
    console.log(`\n[VERIFY] PASS — All 2026 games (${START_DATE}–${END_DATE}) now have modelF5PushPct populated.`);
  } else {
    console.log(`\n[VERIFY] PARTIAL — ${totalNullAfter} game(s) still have NULL modelF5PushPct.`);
    console.log("  These may be games with no model run (postponed, cancelled, or pre-season).");
  }

  process.exit(failedDates.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});

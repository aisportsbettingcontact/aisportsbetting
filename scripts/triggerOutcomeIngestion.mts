/**
 * triggerOutcomeIngestion.mts
 *
 * PURPOSE:
 *   Manually triggers MLB outcome ingestion for one or more dates.
 *   Calls ingestMlbOutcomes() directly (same code path as the tRPC admin procedure).
 *   Writes actualFgTotal, actualF5Total, actualNrfiBinary, and 5 Brier scores to DB.
 *
 * USAGE:
 *   npx tsx scripts/triggerOutcomeIngestion.mts [date] [--force]
 *   npx tsx scripts/triggerOutcomeIngestion.mts 2026-04-14
 *   npx tsx scripts/triggerOutcomeIngestion.mts 2026-04-14 --force
 *   npx tsx scripts/triggerOutcomeIngestion.mts 2026-03-26 2026-04-14          (range)
 *   npx tsx scripts/triggerOutcomeIngestion.mts 2026-03-26 2026-04-14 --force  (range + force)
 *
 * LOGGING:
 *   [INPUT]   trigger parameters
 *   [STEP]    operation in progress
 *   [STATE]   per-game intermediate values
 *   [OUTPUT]  write result per game
 *   [VERIFY]  post-write validation
 *   [SUMMARY] batch summary
 *   [ERROR]   failure with context
 */

import { ingestMlbOutcomes, ingestMlbOutcomesRange } from "../server/mlbOutcomeIngestor";

const TAG = "[TriggerOutcomeIngestion]";

// ─── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== "--force");
const force = process.argv.includes("--force");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(d: string): void {
  if (!DATE_RE.test(d)) {
    console.error(`${TAG} [ERROR] Invalid date format: "${d}" — expected YYYY-MM-DD`);
    process.exit(1);
  }
  const parsed = new Date(d + "T00:00:00Z");
  if (isNaN(parsed.getTime())) {
    console.error(`${TAG} [ERROR] Unparseable date: "${d}"`);
    process.exit(1);
  }
}

async function main() {
  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] args=${JSON.stringify(process.argv.slice(2))}`);
  console.log(`${TAG} [INPUT] force=${force}`);

  if (args.length === 0) {
    // Default: today's date
    const today = new Date().toISOString().slice(0, 10);
    console.log(`${TAG} [INPUT] No date provided — defaulting to today: ${today}`);
    args.push(today);
  }

  if (args.length === 1) {
    // Single date
    const dateStr = args[0]!;
    validateDate(dateStr);
    console.log(`${TAG} [STEP] Single-date ingestion: ${dateStr} force=${force}`);
    const summary = await ingestMlbOutcomes(dateStr, force);
    console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
    console.log(`${TAG} [OUTPUT] date=${summary.date}`);
    console.log(`${TAG} [OUTPUT] total=${summary.totalGames} | written=${summary.written} | skipped_ingested=${summary.skippedAlreadyIngested} | skipped_not_final=${summary.skippedNotFinal} | skipped_no_pk=${summary.skippedNoGamePk} | skipped_no_match=${summary.skippedNoApiMatch} | errors=${summary.errors}`);
    console.log(`${TAG} [OUTPUT] runAt=${new Date(summary.runAt).toISOString()}`);
    if (summary.errors > 0) {
      console.error(`${TAG} [VERIFY] FAIL — ${summary.errors} error(s) during ingestion`);
      process.exit(1);
    }
    console.log(`${TAG} [VERIFY] PASS — all games processed successfully`);
    console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
    process.exit(0);

  } else if (args.length === 2) {
    // Date range
    const startDate = args[0]!;
    const endDate = args[1]!;
    validateDate(startDate);
    validateDate(endDate);
    if (new Date(startDate) > new Date(endDate)) {
      console.error(`${TAG} [ERROR] startDate (${startDate}) is after endDate (${endDate})`);
      process.exit(1);
    }
    console.log(`${TAG} [STEP] Range ingestion: ${startDate} → ${endDate} force=${force}`);
    const summaries = await ingestMlbOutcomesRange(startDate, endDate, force);
    const totalWritten = summaries.reduce((s, r) => s + r.written, 0);
    const totalErrors = summaries.reduce((s, r) => s + r.errors, 0);
    const totalGames = summaries.reduce((s, r) => s + r.totalGames, 0);
    console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
    console.log(`${TAG} [OUTPUT] Range: ${startDate} → ${endDate}`);
    console.log(`${TAG} [OUTPUT] dates=${summaries.length} | totalGames=${totalGames} | written=${totalWritten} | errors=${totalErrors}`);
    for (const s of summaries) {
      const status = s.errors > 0 ? "ERROR" : s.written > 0 ? "WRITTEN" : "SKIPPED";
      console.log(`${TAG} [STATE]  ${s.date}: total=${s.totalGames} written=${s.written} skipped_ingested=${s.skippedAlreadyIngested} skipped_not_final=${s.skippedNotFinal} errors=${s.errors} [${status}]`);
    }
    if (totalErrors > 0) {
      console.error(`${TAG} [VERIFY] FAIL — ${totalErrors} error(s) across range`);
      process.exit(1);
    }
    console.log(`${TAG} [VERIFY] PASS — range ingestion complete`);
    console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
    process.exit(0);

  } else {
    console.error(`${TAG} [ERROR] Too many arguments. Usage:`);
    console.error(`  npx tsx scripts/triggerOutcomeIngestion.mts [date]`);
    console.error(`  npx tsx scripts/triggerOutcomeIngestion.mts [startDate] [endDate]`);
    console.error(`  Add --force to re-ingest already-ingested games`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${TAG} [ERROR] Unhandled exception:`, err);
  process.exit(1);
});

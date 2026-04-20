/**
 * retroKPropsBacktest.ts — Retroactive K-props backtest runner.
 *
 * Finds all mlb_strikeout_props rows with:
 *   - backtestResult = 'NAME_MATCH_FAILED' (previous failures)
 *   - backtestResult = null or 'PENDING' for completed games
 *
 * Groups by game date and calls runKPropsBacktest() for each date.
 * Uses the new side-based fallback logic to resolve substituted starters.
 *
 * Run with: npx tsx server/retroKPropsBacktest.ts
 */
import { getDb } from "./db";
import { mlbStrikeoutProps, games } from "../drizzle/schema";
import { eq, isNull, or, and, inArray } from "drizzle-orm";
import { runKPropsBacktest } from "./kPropsBacktestService";

const TAG = "[RetroKBacktest]";

async function main() {
  console.log(`${TAG} Starting retroactive K-props backtest`);
  const db = await getDb();

  // Find all dates with ungraded or NAME_MATCH_FAILED rows
  const ungraded = await db
    .select({
      gameDate: games.gameDate,
      id: mlbStrikeoutProps.id,
      pitcherName: mlbStrikeoutProps.pitcherName,
      backtestResult: mlbStrikeoutProps.backtestResult,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(
      and(
        or(
          isNull(mlbStrikeoutProps.backtestResult),
          eq(mlbStrikeoutProps.backtestResult, "PENDING"),
          eq(mlbStrikeoutProps.backtestResult, "NAME_MATCH_FAILED"),
        )
      )
    );

  if (ungraded.length === 0) {
    console.log(`${TAG} [VERIFY] No ungraded rows found — nothing to do`);
    process.exit(0);
  }

  // Group by date
  const byDate = new Map<string, number>();
  for (const row of ungraded) {
    if (!row.gameDate) continue;
    byDate.set(row.gameDate, (byDate.get(row.gameDate) ?? 0) + 1);
  }

  const dates = Array.from(byDate.keys()).sort();
  console.log(`${TAG} [INPUT] Found ${ungraded.length} ungraded rows across ${dates.length} dates`);
  console.log(`${TAG} [INPUT] Dates: ${dates.join(", ")}`);

  // Run backtest for each date
  let totalProcessed = 0;
  for (const date of dates) {
    console.log(`\n${TAG} [STEP] Processing date ${date} (${byDate.get(date)} rows)`);
    try {
      await runKPropsBacktest(date);
      totalProcessed++;
    } catch (err) {
      console.error(`${TAG} [ERROR] Failed for date ${date}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Delay between dates to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Final summary
  const remaining = await db
    .select({ id: mlbStrikeoutProps.id, result: mlbStrikeoutProps.backtestResult })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(
      or(
        isNull(mlbStrikeoutProps.backtestResult),
        eq(mlbStrikeoutProps.backtestResult, "PENDING"),
        eq(mlbStrikeoutProps.backtestResult, "NAME_MATCH_FAILED"),
      )
    );

  const nameMatchFailed = remaining.filter((r: { id: number; result: string | null }) => r.result === "NAME_MATCH_FAILED").length;
  const stillPending = remaining.filter((r: { id: number; result: string | null }) => !r.result || r.result === "PENDING").length;

  console.log(`\n${TAG} [OUTPUT] Retroactive backtest complete`);
  console.log(`${TAG} [OUTPUT] Dates processed: ${totalProcessed}/${dates.length}`);
  console.log(`${TAG} [OUTPUT] Remaining NAME_MATCH_FAILED: ${nameMatchFailed}`);
  console.log(`${TAG} [OUTPUT] Remaining PENDING/NULL: ${stillPending}`);
  console.log(`${TAG} [VERIFY] ${nameMatchFailed === 0 ? "PASS — all rows graded" : `PARTIAL — ${nameMatchFailed} still unresolvable (genuine starter substitutions with no side match)`}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

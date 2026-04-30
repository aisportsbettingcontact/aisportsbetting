/**
 * betAutoGradeScheduler.ts — Automated bet grading background scheduler.
 *
 * Strategy: two-layer approach for maximum coverage:
 *
 *   Layer 1 — Continuous polling (every 15 minutes) during game hours:
 *     Active window: 10:00 AM – 2:00 AM PST (covers all MLB/NHL/NBA/NCAAM games)
 *     Grades all PENDING bets for today + yesterday (handles late-night games)
 *
 *   Layer 2 — Nightly sweep at 11:59 PM PST (HARDCODED):
 *     Fires at exactly 23:59 PST = 07:59 UTC (PST = UTC-8, PDT = UTC-7 handled via Intl)
 *     Grades ALL PENDING bets across ALL dates (catches any missed bets)
 *     Runs regardless of game hours — always fires at 11:59 PM PST
 *
 * Logging convention:
 *   [BetAutoGrade][INPUT]  — scheduler trigger + context
 *   [BetAutoGrade][STEP]   — operation in progress
 *   [BetAutoGrade][STATE]  — intermediate values
 *   [BetAutoGrade][OUTPUT] — grading result
 *   [BetAutoGrade][VERIFY] — validation pass/fail
 *   [BetAutoGrade][ERROR]  — failure with context
 */

import { getDb } from "./db";
import { trackedBets } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  gradeTrackedBet,
  fetchScores,
  type Sport as GraderSport,
  type Timeframe as GraderTimeframe,
  type Market as GraderMarket,
  type PickSide as GraderPickSide,
} from "./scoreGrader";

// ─── PST/PDT helpers ─────────────────────────────────────────────────────────

/** Get current time in PST/PDT as { hour, minute, dateStr } */
function nowPst(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  // PST = UTC-8, PDT = UTC-7; use Intl to handle DST automatically
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pst = new Date(pstStr);
  const hour   = pst.getHours();
  const minute = pst.getMinutes();
  // Date string YYYY-MM-DD in PST/PDT
  const y = pst.getFullYear();
  const m = String(pst.getMonth() + 1).padStart(2, "0");
  const d = String(pst.getDate()).padStart(2, "0");
  return { hour, minute, dateStr: `${y}-${m}-${d}` };
}

/** Get yesterday's date string in PST/PDT (YYYY-MM-DD) */
function yesterdayPst(): string {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pst = new Date(pstStr);
  pst.setDate(pst.getDate() - 1);
  const y = pst.getFullYear();
  const m = String(pst.getMonth() + 1).padStart(2, "0");
  const d = String(pst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Core grading engine ──────────────────────────────────────────────────────

interface GradeSummary {
  date: string;
  total: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  stillPending: number;
  errors: number;
}

/**
 * Grade all PENDING bets for a specific date across all users.
 * Persists awayScore + homeScore on each settled bet.
 */
async function gradeAllPendingForDate(date: string, trigger: string): Promise<GradeSummary> {
  console.log(`[BetAutoGrade][INPUT] gradeAllPendingForDate: date=${date} trigger=${trigger}`);

  const db = await getDb();

  // Fetch all PENDING bets for this date
  const pending = await db.select().from(trackedBets).where(
    and(
      eq(trackedBets.result, "PENDING"),
      eq(trackedBets.gameDate, date),
    )
  );

  if (pending.length === 0) {
    console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: 0 PENDING bets for date=${date} — skipping`);
    return { date, total: 0, graded: 0, wins: 0, losses: 0, pushes: 0, stillPending: 0, errors: 0 };
  }

  console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: ${pending.length} PENDING bets for date=${date}`);

  // Pre-fetch scores for all sports in parallel (warm the cache)
  const sportsNeeded = Array.from(new Set(pending.map((b: { sport: string }) => b.sport))) as GraderSport[];
  console.log(`[BetAutoGrade][STEP] gradeAllPendingForDate: pre-fetching scores for sports=[${sportsNeeded.join(",")}]`);

  await Promise.all(sportsNeeded.map(s => fetchScores(s, date).catch(err => {
    console.log(`[BetAutoGrade][ERROR] score pre-fetch failed: sport=${s} date=${date} err=${(err as Error).message}`);
  })));
  console.log(`[BetAutoGrade][STATE] gradeAllPendingForDate: score pre-fetch complete for ${sportsNeeded.length} sports`);

  let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0, errors = 0;

  for (const bet of pending) {
    try {
      const gradeOut = await gradeTrackedBet({
        sport:     bet.sport as GraderSport,
        gameDate:  bet.gameDate,
        awayTeam:  bet.awayTeam ?? "",
        homeTeam:  bet.homeTeam ?? "",
        timeframe: (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
        market:    (bet.market ?? "ML") as GraderMarket,
        pickSide:  (bet.pickSide ?? "AWAY") as GraderPickSide,
        odds:      bet.odds,
        line:      bet.line != null ? parseFloat(String(bet.line)) : null,
        anGameId:  bet.anGameId,
      });

      if (gradeOut.result === "PENDING") {
        stillPending++;
        console.log(`[BetAutoGrade][STATE] betId=${bet.id} still PENDING: ${gradeOut.reason}`);
        continue;
      }

      // Persist result + scores
      await db.update(trackedBets)
        .set({
          result:    gradeOut.result,
          awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
          homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
        })
        .where(eq(trackedBets.id, bet.id));

      graded++;
      if (gradeOut.result === "WIN")  wins++;
      if (gradeOut.result === "LOSS") losses++;
      if (gradeOut.result === "PUSH") pushes++;

      console.log(`[BetAutoGrade][OUTPUT] betId=${bet.id} userId=${bet.userId} sport=${bet.sport} ${bet.awayTeam}@${bet.homeTeam} → ${gradeOut.result} | score=${gradeOut.awayScore}-${gradeOut.homeScore} | ${gradeOut.reason}`);
      console.log(`[BetAutoGrade][VERIFY] betId=${bet.id} PASS — result=${gradeOut.result} persisted`);

    } catch (err) {
      errors++;
      console.log(`[BetAutoGrade][ERROR] betId=${bet.id} grading failed: ${(err as Error).message}`);
    }
  }

  const summary: GradeSummary = { date, total: pending.length, graded, wins, losses, pushes, stillPending, errors };
  console.log(`[BetAutoGrade][OUTPUT] gradeAllPendingForDate: COMPLETE date=${date} total=${pending.length} graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending} errors=${errors}`);
  console.log(`[BetAutoGrade][VERIFY] gradeAllPendingForDate: ${errors === 0 ? "PASS" : "WARN"} — ${errors} errors`);
  return summary;
}

/**
 * Grade ALL PENDING bets across ALL dates (nightly sweep).
 * Used for the 11:30 PM EST nightly job to catch any missed bets.
 */
async function gradeAllPendingAllDates(trigger: string): Promise<void> {
  console.log(`[BetAutoGrade][INPUT] gradeAllPendingAllDates: trigger=${trigger}`);

  const db = await getDb();

  // Fetch all PENDING bets regardless of date
  const pending = await db.select().from(trackedBets).where(eq(trackedBets.result, "PENDING"));

  if (pending.length === 0) {
    console.log(`[BetAutoGrade][STATE] gradeAllPendingAllDates: 0 PENDING bets — nothing to grade`);
    return;
  }

  // Group by date for efficient score fetching
  const byDate = new Map<string, typeof pending>();
  for (const bet of pending as Array<typeof pending[0]>) {
    const arr = byDate.get(bet.gameDate) ?? [];
    arr.push(bet);
    byDate.set(bet.gameDate, arr);
  }

  const dates = Array.from(byDate.keys()).sort();
  console.log(`[BetAutoGrade][STATE] gradeAllPendingAllDates: ${pending.length} PENDING bets across ${dates.length} dates: [${dates.join(", ")}]`);

  let totalGraded = 0, totalStillPending = 0, totalErrors = 0;

  for (const date of dates) {
    const summary = await gradeAllPendingForDate(date, trigger);
    totalGraded       += summary.graded;
    totalStillPending += summary.stillPending;
    totalErrors       += summary.errors;
  }

  console.log(`[BetAutoGrade][OUTPUT] gradeAllPendingAllDates: COMPLETE — totalGraded=${totalGraded} totalStillPending=${totalStillPending} totalErrors=${totalErrors}`);
  console.log(`[BetAutoGrade][VERIFY] gradeAllPendingAllDates: ${totalErrors === 0 ? "PASS" : "WARN"} — ${totalErrors} errors across all dates`);
}

// ─── Scheduler state ──────────────────────────────────────────────────────────

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let nightlySweepInterval: ReturnType<typeof setInterval> | null = null;
let isGrading = false; // Mutex: prevent concurrent grade runs

// ─── Game hours check ─────────────────────────────────────────────────────────

/**
 * Returns true if the current PST/PDT time is within game hours.
 * Game hours: 07:00 AM – 11:59 PM PST (covers all MLB/NHL/NBA/NCAAM games in PST).
 * Earliest MLB games start ~10 AM ET = 7 AM PST.
 * Latest NBA/NHL games end ~1 AM ET = 10 PM PST.
 * We extend to 11:59 PM PST to ensure the nightly sweep catches all games.
 */
function isWithinGameHours(): boolean {
  const { hour } = nowPst();
  // 7 AM (7) through 11 PM (23) PST
  return hour >= 7 && hour <= 23;
}

// ─── Polling job (every 15 minutes during game hours) ────────────────────────

async function runPollingGrade(): Promise<void> {
  if (isGrading) {
    console.log(`[BetAutoGrade][STEP] runPollingGrade: SKIP — grade already in progress`);
    return;
  }

  const { hour, dateStr } = nowPst();
  const yesterday = yesterdayPst();

  if (!isWithinGameHours()) {
    console.log(`[BetAutoGrade][STEP] runPollingGrade: SKIP — outside game hours (EST hour=${hour})`);
    return;
  }

  isGrading = true;
  console.log(`[BetAutoGrade][INPUT] runPollingGrade: TRIGGERED at PST hour=${hour} — grading today=${dateStr} + yesterday=${yesterday}`);

  try {
    // Grade today's bets
    const todaySummary = await gradeAllPendingForDate(dateStr, "polling");

    // Grade yesterday's bets (handles late-night games that finished after midnight)
    const yesterdaySummary = await gradeAllPendingForDate(yesterday, "polling_yesterday");

    const totalGraded = todaySummary.graded + yesterdaySummary.graded;
    const totalPending = todaySummary.stillPending + yesterdaySummary.stillPending;

    console.log(`[BetAutoGrade][OUTPUT] runPollingGrade: COMPLETE — today_graded=${todaySummary.graded} yesterday_graded=${yesterdaySummary.graded} totalGraded=${totalGraded} stillPending=${totalPending}`);
  } catch (err) {
    console.log(`[BetAutoGrade][ERROR] runPollingGrade: FAILED — ${(err as Error).message}`);
  } finally {
    isGrading = false;
  }
}

// ─── Nightly sweep job (11:59 PM PST — HARDCODED) ───────────────────────────

async function runNightlySweep(): Promise<void> {
  const { hour, minute } = nowPst();

  // HARDCODED: fire at exactly 11:59 PM PST.
  // Window: 23:57 – 23:59 PST (3-minute window for the 1-minute check interval).
  // PST = UTC-8 (winter) / PDT = UTC-7 (summer) — handled automatically by Intl.
  const isNightlyWindow = hour === 23 && minute >= 57 && minute <= 59;

  if (!isNightlyWindow) return;

  if (isGrading) {
    console.log(`[BetAutoGrade][STEP] runNightlySweep: SKIP — grade already in progress`);
    return;
  }

  isGrading = true;
  console.log(`[BetAutoGrade][INPUT] runNightlySweep: TRIGGERED at 11:59 PM PST — grading ALL PENDING bets across ALL dates`);

  try {
    await gradeAllPendingAllDates("nightly_sweep_11:59PM_PST");
    console.log(`[BetAutoGrade][VERIFY] runNightlySweep: PASS — nightly sweep complete`);
  } catch (err) {
    console.log(`[BetAutoGrade][ERROR] runNightlySweep: FAILED — ${(err as Error).message}`);
  } finally {
    isGrading = false;
  }
}

// ─── Public: start the scheduler ─────────────────────────────────────────────

/**
 * Start the automated bet grading scheduler.
 * Called once on server startup.
 *
 * Schedules:
 *   - Every 15 minutes: poll and grade PENDING bets for today + yesterday (during game hours)
 *   - Every 1 minute:   check if it's 11:30 PM EST for the nightly sweep
 *   - On startup:       immediate grade run for today + yesterday
 */
export function startBetAutoGradeScheduler(): void {
  console.log(`[BetAutoGrade][INPUT] startBetAutoGradeScheduler: STARTING`);

  // Immediate startup run — grade today + yesterday right away
  const { dateStr } = nowPst();
  const yesterday = yesterdayPst();
  console.log(`[BetAutoGrade][STEP] startBetAutoGradeScheduler: startup grade for today=${dateStr} yesterday=${yesterday}`);

  // Delay 10s to let DB connection pool warm up
  setTimeout(async () => {
    if (isGrading) return;
    isGrading = true;
    try {
      await gradeAllPendingForDate(dateStr, "startup");
      await gradeAllPendingForDate(yesterday, "startup_yesterday");
    } catch (err) {
      console.log(`[BetAutoGrade][ERROR] startup grade failed: ${(err as Error).message}`);
    } finally {
      isGrading = false;
    }
  }, 10_000);

  // Layer 1: 15-minute polling during game hours
  const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  pollingInterval = setInterval(() => {
    runPollingGrade().catch(err => {
      console.log(`[BetAutoGrade][ERROR] polling interval error: ${(err as Error).message}`);
    });
  }, POLL_INTERVAL_MS);

  // Layer 2: 1-minute check for 11:30 PM EST nightly sweep
  const NIGHTLY_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
  nightlySweepInterval = setInterval(() => {
    runNightlySweep().catch(err => {
      console.log(`[BetAutoGrade][ERROR] nightly sweep check error: ${(err as Error).message}`);
    });
  }, NIGHTLY_CHECK_INTERVAL_MS);

  console.log(`[BetAutoGrade][OUTPUT] startBetAutoGradeScheduler: STARTED`);
  console.log(`[BetAutoGrade][STATE] Polling: every 15 min during game hours (7AM–11:59PM PST)`);
  console.log(`[BetAutoGrade][STATE] Nightly sweep: 11:59 PM PST (HARDCODED) — grades ALL PENDING bets across ALL dates`);
  console.log(`[BetAutoGrade][VERIFY] startBetAutoGradeScheduler: PASS — scheduler running`);
}

/**
 * Stop the scheduler (for testing or graceful shutdown).
 */
export function stopBetAutoGradeScheduler(): void {
  if (pollingInterval)     { clearInterval(pollingInterval);     pollingInterval = null; }
  if (nightlySweepInterval){ clearInterval(nightlySweepInterval); nightlySweepInterval = null; }
  console.log(`[BetAutoGrade][OUTPUT] stopBetAutoGradeScheduler: STOPPED`);
}

/**
 * Exported for direct use in autoGrade/autoGradeAll tRPC procedures
 * to persist scores when grading via the UI button as well.
 */
export { gradeAllPendingForDate, gradeAllPendingAllDates };

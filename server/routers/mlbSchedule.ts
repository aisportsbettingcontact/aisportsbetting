/**
 * mlbSchedule.ts — tRPC router for MLB schedule history and Last 5 Games data
 *
 * Procedures:
 *   mlbSchedule.getLast5ForMatchup        — public — Last 5 completed games for both teams in a matchup
 *   mlbSchedule.getTeamSchedule           — public — Full schedule for a single team (all games)
 *   mlbSchedule.getSituationalStats       — public — Situational records (ML/RL/Total tabs)
 *   mlbSchedule.refreshScheduleForDate    — owner-only — Refresh a specific date
 *   mlbSchedule.backfillSchedule          — owner-only — Rolling window backfill (last N days)
 *   mlbSchedule.fullHistoricalBackfill    — owner-only — Full Phase 1 backfill (2023-03-30 → today)
 *
 * Data source: Action Network v1 API, DraftKings NJ (book_id=68) exclusively
 *
 * Logging: [MlbScheduleRouter][PROCEDURE] plain-English, fully traceable
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { ownerProcedure } from "./appUsers";
import {
  getLast5ForMatchup,
  getFullScheduleForTeam,
  getMlbSituationalStats,
  getMlbH2HGames,
  refreshMlbScheduleForDate,
  refreshMlbScheduleLastNDays,
  backfillMlbScheduleHistory,
  type MlbScheduleRefreshResult,
} from "../mlbScheduleHistoryService";
import { runMlbNightlyTrendsRefresh } from "../mlbNightlyTrendsRefresh";
import { ingestMlbOutcomes } from "../mlbOutcomeIngestor";
import { checkF5ShareDrift, triggerRecalibration } from "../mlbDriftDetector";
import { getDb } from "../db";
import { games as gamesTable, type Game } from "../../drizzle/schema";
import { and, eq, isNotNull, asc } from "drizzle-orm";

const TAG = "[MlbScheduleRouter]";

// ─── Zod validators ───────────────────────────────────────────────────────────

/** AN url_slug format: lowercase letters, digits, hyphens only */
const zodAnSlug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Invalid team slug — must be lowercase letters, digits, and hyphens only");

/** YYYYMMDD date string for the AN API */
const zodAnDate = z
  .string()
  .length(8)
  .regex(/^\d{8}$/, "Date must be in YYYYMMDD format");

// ─── Router ───────────────────────────────────────────────────────────────────

export const mlbScheduleRouter = router({
  /**
   * Get the last 5 completed games for both teams in a matchup.
   * Powers the "Last 5 Games" panel on each MLB matchup card.
   */
  getLast5ForMatchup: publicProcedure
    .input(
      z.object({
        awaySlug: zodAnSlug,
        homeSlug: zodAnSlug,
      })
    )
    .query(async ({ input }) => {
      console.log(
        `${TAG}[getLast5ForMatchup] Fetching Last 5 for matchup:` +
        ` away="${input.awaySlug}" vs home="${input.homeSlug}"`
      );

      try {
        const { awayLast5, homeLast5 } = await getLast5ForMatchup(
          input.awaySlug,
          input.homeSlug
        );

        console.log(
          `${TAG}[getLast5ForMatchup] Returning` +
          ` away=${awayLast5.length} games, home=${homeLast5.length} games`
        );

        return { awayLast5, homeLast5 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getLast5ForMatchup] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch Last 5 games: ${msg}`,
        });
      }
    }),

  /**
   * Get the full schedule for a single MLB team (all games, any status).
   * Powers the Team Schedule page when a user clicks on a team logo.
   */
  getTeamSchedule: publicProcedure
    .input(
      z.object({
        teamSlug: zodAnSlug,
      })
    )
    .query(async ({ input }) => {
      console.log(
        `${TAG}[getTeamSchedule] Fetching full schedule for team="${input.teamSlug}"`
      );

      try {
        const games = await getFullScheduleForTeam(input.teamSlug);

        console.log(
          `${TAG}[getTeamSchedule] Returning ${games.length} games for team="${input.teamSlug}"`
        );

        return { games, teamSlug: input.teamSlug };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getTeamSchedule] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch team schedule: ${msg}`,
        });
      }
    }),

  /**
   * Get situational records for a single MLB team.
   * Powers the "Situational Results" panel (ML/Run Line/Total tabs).
   */
  getSituationalStats: publicProcedure
    .input(
      z.object({
        teamSlug: zodAnSlug,
      })
    )
    .query(async ({ input }) => {
      console.log(
        `${TAG}[getSituationalStats] Computing situational stats for team="${input.teamSlug}"`
      );
      try {
        const stats = await getMlbSituationalStats(input.teamSlug);
        console.log(
          `${TAG}[getSituationalStats] Returning stats for team="${input.teamSlug}"` +
          ` gamesAnalyzed=${stats.gamesAnalyzed}`
        );
        return stats;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getSituationalStats] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to compute MLB situational stats: ${msg}`,
        });
      }
    }),

  /**
   * Get the last N head-to-head games between two specific MLB teams.
   * Powers the "Head-to-Head" tab in the Recent Schedule panel.
   */
  getH2HGames: publicProcedure
    .input(
      z.object({
        slugA: zodAnSlug,
        slugB: zodAnSlug,
        limit: z.number().int().min(1).max(20).default(10),
      })
    )
    .query(async ({ input }) => {
      console.log(
        `${TAG}[getH2HGames] Fetching H2H games: "${input.slugA}" vs "${input.slugB}" limit=${input.limit}`
      );
      try {
        const games = await getMlbH2HGames(input.slugA, input.slugB, input.limit);
        console.log(
          `${TAG}[getH2HGames] Returning ${games.length} H2H games` +
          ` between "${input.slugA}" and "${input.slugB}"`
        );
        return { games };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getH2HGames] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch H2H games: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Refresh MLB schedule history for a specific date.
   * Fetches from AN DK NJ API and upserts into mlb_schedule_history.
   */
  refreshScheduleForDate: ownerProcedure
    .input(
      z.object({
        date: zodAnDate,
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        `${TAG}[refreshScheduleForDate] Manual refresh triggered for date=${input.date}`
      );

      try {
        const result = await refreshMlbScheduleForDate(input.date);

        console.log(
          `${TAG}[refreshScheduleForDate] Complete:` +
          ` fetched=${result.fetched} upserted=${result.upserted}` +
          ` errors=${result.errors.length}`
        );

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[refreshScheduleForDate] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Schedule refresh failed: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Rolling window backfill for the last N days.
   * Uses refreshMlbScheduleLastNDays (returns array of per-date results).
   *
   * Input:
   *   daysBack — Number of days to backfill (default: 30, max: 60)
   */
  backfillSchedule: ownerProcedure
    .input(
      z.object({
        daysBack: z.number().int().min(1).max(60).default(30),
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        `${TAG}[backfillSchedule] Rolling window backfill triggered for last ${input.daysBack} days`
      );

      try {
        const results = await refreshMlbScheduleLastNDays(input.daysBack);

        const totalFetched = results.reduce((s: number, r: MlbScheduleRefreshResult) => s + r.fetched, 0);
        const totalUpserted = results.reduce((s: number, r: MlbScheduleRefreshResult) => s + r.upserted, 0);
        const totalErrors = results.reduce((s: number, r: MlbScheduleRefreshResult) => s + r.errors.length, 0);

        console.log(
          `${TAG}[backfillSchedule] Complete:` +
          ` dates=${results.length} totalFetched=${totalFetched}` +
          ` totalUpserted=${totalUpserted} totalErrors=${totalErrors}`
        );

        return { results, totalFetched, totalUpserted, totalErrors };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[backfillSchedule] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Backfill failed: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Full historical backfill from 2023-03-30 through today.
   *
   * This is the Phase 1 backfill covering all MLB seasons with DK NJ odds:
   *   - 2023: 2023-03-30 → 2023-10-01 (full regular season + postseason)
   *   - 2024: 2024-03-20 → 2024-09-29 (full regular season)
   *   - 2025: 2025-03-27 → present
   *   - 2026: 2026-03-26 → present (if applicable)
   *
   * Input:
   *   startDate — "YYYY-MM-DD" format (default: "2023-03-30")
   *   endDate   — "YYYY-MM-DD" format (default: today)
   *   delayMs   — Delay between API calls in ms (default: 400)
   */
  fullHistoricalBackfill: ownerProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2023-03-30"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        delayMs: z.number().int().min(200).max(2000).default(400),
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        `${TAG}[fullHistoricalBackfill] Full Phase 1 backfill triggered` +
        ` | startDate=${input.startDate} endDate=${input.endDate ?? "today"} delayMs=${input.delayMs}`
      );

      try {
        const result = await backfillMlbScheduleHistory(
          input.startDate,
          input.endDate,
          input.delayMs
        );

        console.log(
          `${TAG}[fullHistoricalBackfill] COMPLETE:` +
          ` totalDates=${result.totalDates}` +
          ` totalFetched=${result.totalFetched}` +
          ` totalUpserted=${result.totalUpserted}` +
          ` totalErrors=${result.totalErrors}`
        );

        return {
          totalDates: result.totalDates,
          totalFetched: result.totalFetched,
          totalUpserted: result.totalUpserted,
          totalErrors: result.totalErrors,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[fullHistoricalBackfill] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Full historical backfill failed: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Manually trigger the nightly MLB TRENDS refresh for a specific date.
   *
   * Runs the full pipeline:
   *   1. Re-ingests yesterday + today from AN API (fallback book chain 68→15→21→30)
   *   2. Per-row validation: re-derives awayWon, ATS, O/U from raw scores
   *   3. 30-team cross-validation across all 3 markets × 6 situations
   *   4. Sends owner notification with pass/fail summary
   *
   * Input:
   *   targetDate — "YYYYMMDD" format (default: yesterday EST)
   */
  triggerNightlyTrendsRefresh: ownerProcedure
    .input(
      z.object({
        targetDate: z.string().regex(/^\d{8}$/).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const tag = `${TAG}[triggerNightlyTrendsRefresh]`;
      console.log(
        `${tag} Manual trigger invoked` +
        ` | targetDate=${input.targetDate ?? "yesterday EST (default)"}`
      );
      try {
        await runMlbNightlyTrendsRefresh(input.targetDate);
        console.log(`${tag} COMPLETE`);
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Nightly TRENDS refresh failed: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Manually trigger outcome ingestion for a specific date.
   * Fetches innings-level linescore from MLB Stats API, writes actualFgTotal,
   * actualF5Total, actualNrfiBinary, and 5 Brier scores to the games table.
   *
   * Input:
   *   dateStr — "YYYY-MM-DD" format
   *   force   — if true, re-ingest games that already have outcomeIngestedAt set
   */
  triggerOutcomeIngestion: ownerProcedure
    .input(
      z.object({
        dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        force: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const tag = `${TAG}[triggerOutcomeIngestion]`;
      console.log(`${tag} Manual trigger: dateStr=${input.dateStr} force=${input.force}`);
      try {
        const summary = await ingestMlbOutcomes(input.dateStr, input.force);
        console.log(`${tag} COMPLETE: written=${summary.written} errors=${summary.errors}`);
        return summary;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} ERROR: ${msg}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Outcome ingestion failed: ${msg}` });
      }
    }),

  /**
   * Owner-only: Run the f5_share drift check and optionally trigger recalibration.
   * Returns the full DriftCheckResult with rolling f5_share, delta, and recalibration status.
   *
   * Input:
   *   triggerRecal — if true and drift detected, triggers full recalibration run
   */
  checkDrift: ownerProcedure
    .input(
      z.object({
        triggerRecal: z.boolean().optional().default(false),
      })
    )
    .query(async ({ input }) => {
      const tag = `${TAG}[checkDrift]`;
      console.log(`${tag} Manual drift check: triggerRecal=${input.triggerRecal}`);
      try {
        const result = await checkF5ShareDrift(input.triggerRecal);
        console.log(`${tag} COMPLETE: driftDetected=${result.driftDetected} delta=${result.delta}`);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} ERROR: ${msg}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Drift check failed: ${msg}` });
      }
    }),

  /**
   * Owner-only: Rolling Brier score trend for the Admin Brier chart.
   *
   * Returns per-game Brier scores (FG ML, F5 ML, NRFI, FG Total, F5 Total)
   * plus rolling N-game averages, ordered chronologically by gameDate.
   *
   * Only includes games with outcomeIngestedAt IS NOT NULL.
   * Games missing a specific Brier field have null for that market.
   *
   * Output:
   *   games:   Array<{ gameIndex, gameDate, matchup, brierFgMl, brierF5Ml, brierNrfi, brierFgTotal, brierF5Total }>
   *   rolling: Array<{ gameIndex, rollFgMl, rollF5Ml, rollNrfi, rollFgTotal, rollF5Total }>
   *   summary: { totalGames, avgFgMl, avgF5Ml, avgNrfi, windowSize }
   */
  getBrierTrend: ownerProcedure
    .input(
      z.object({
        windowSize: z.number().int().min(5).max(100).optional().default(20),
        sport: z.enum(["MLB"]).optional().default("MLB"),
      })
    )
    .query(async ({ input }) => {
      const tag = `${TAG}[getBrierTrend]`;
      console.log(`${tag} [INPUT] windowSize=${input.windowSize} sport=${input.sport}`);
      const db = await getDb();

      // ── Step 1: Fetch all outcome-ingested games with Brier scores, ordered chronologically
      const rows = await db
        .select({
          id:                gamesTable.id,
          gameDate:          gamesTable.gameDate,
          awayTeam:          gamesTable.awayTeam,
          homeTeam:          gamesTable.homeTeam,
          brierFgMl:         gamesTable.brierFgMl,
          brierF5Ml:         gamesTable.brierF5Ml,
          brierNrfi:         gamesTable.brierNrfi,
          brierFgTotal:      gamesTable.brierFgTotal,
          brierF5Total:      gamesTable.brierF5Total,
          outcomeIngestedAt: gamesTable.outcomeIngestedAt,
        })
        .from(gamesTable)
        .where(
          and(
            eq(gamesTable.sport, input.sport),
            isNotNull(gamesTable.outcomeIngestedAt),
          )
        )
        .orderBy(asc(gamesTable.gameDate), asc(gamesTable.id));

      console.log(`${tag} [STATE] ingested rows: ${rows.length}`);

      if (rows.length === 0) {
        console.log(`${tag} [OUTPUT] No ingested games found`);
        return {
          games: [] as Array<{
            gameIndex: number; gameDate: string; matchup: string;
            brierFgMl: number | null; brierF5Ml: number | null; brierNrfi: number | null;
            brierFgTotal: number | null; brierF5Total: number | null;
          }>,
          rolling: [] as Array<{
            gameIndex: number;
            rollFgMl: number | null; rollF5Ml: number | null; rollNrfi: number | null;
            rollFgTotal: number | null; rollF5Total: number | null;
          }>,
          summary: { totalGames: 0, avgFgMl: null as number | null, avgF5Ml: null as number | null, avgNrfi: null as number | null, windowSize: input.windowSize },
        };
      }

      // ── Step 2: Build per-game array with sequential index
      type GamePoint = {
        gameIndex: number; gameDate: string; matchup: string;
        brierFgMl: number | null; brierF5Ml: number | null; brierNrfi: number | null;
        brierFgTotal: number | null; brierF5Total: number | null;
      };
      type BrierRow = Pick<Game, "id" | "gameDate" | "awayTeam" | "homeTeam" | "brierFgMl" | "brierF5Ml" | "brierNrfi" | "brierFgTotal" | "brierF5Total" | "outcomeIngestedAt">;
      const gamePoints: GamePoint[] = (rows as BrierRow[]).map((r: BrierRow, i: number) => ({
        gameIndex:    i + 1,
        gameDate:     r.gameDate ?? "",
        matchup:      `${r.awayTeam}@${r.homeTeam}`,
        brierFgMl:    r.brierFgMl    !== null ? parseFloat(String(r.brierFgMl))    : null,
        brierF5Ml:    r.brierF5Ml    !== null ? parseFloat(String(r.brierF5Ml))    : null,
        brierNrfi:    r.brierNrfi    !== null ? parseFloat(String(r.brierNrfi))    : null,
        brierFgTotal: r.brierFgTotal !== null ? parseFloat(String(r.brierFgTotal)) : null,
        brierF5Total: r.brierF5Total !== null ? parseFloat(String(r.brierF5Total)) : null,
      }));

      // ── Step 3: Compute rolling averages (window = last N games including current)
      const W = input.windowSize;
      type BrierField = "brierFgMl" | "brierF5Ml" | "brierNrfi" | "brierFgTotal" | "brierF5Total";
      const rolling = gamePoints.map((_: GamePoint, i: number) => {
        const window = gamePoints.slice(Math.max(0, i - W + 1), i + 1);
        const avg = (field: BrierField): number | null => {
          const vals = window.map((g: GamePoint) => g[field]).filter((v: number | null): v is number => v !== null);
          return vals.length > 0
            ? parseFloat((vals.reduce((s: number, v: number) => s + v, 0) / vals.length).toFixed(6))
            : null;
        };
        return {
          gameIndex:   gamePoints[i].gameIndex,
          rollFgMl:    avg("brierFgMl"),
          rollF5Ml:    avg("brierF5Ml"),
          rollNrfi:    avg("brierNrfi"),
          rollFgTotal: avg("brierFgTotal"),
          rollF5Total: avg("brierF5Total"),
        };
      });

      // ── Step 4: All-time averages for summary cards
      const allAvg = (field: BrierField): number | null => {
        const vals = gamePoints.map((g: GamePoint) => g[field]).filter((v: number | null): v is number => v !== null);
        return vals.length > 0
          ? parseFloat((vals.reduce((s: number, v: number) => s + v, 0) / vals.length).toFixed(6))
          : null;
      };
      const summary = {
        totalGames:  gamePoints.length,
        avgFgMl:     allAvg("brierFgMl"),
        avgF5Ml:     allAvg("brierF5Ml"),
        avgNrfi:     allAvg("brierNrfi"),
        avgFgTotal:  allAvg("brierFgTotal"),
        avgF5Total:  allAvg("brierF5Total"),
        windowSize: W,
      };

      console.log(
        `${tag} [OUTPUT] games=${gamePoints.length} ` +
        `avgFgMl=${summary.avgFgMl ?? "null"} ` +
        `avgF5Ml=${summary.avgF5Ml ?? "null"} ` +
        `avgNrfi=${summary.avgNrfi ?? "null"} ` +
        `avgFgTotal=${summary.avgFgTotal ?? "null"} ` +
        `avgF5Total=${summary.avgF5Total ?? "null"}`
      );
      return { games: gamePoints, rolling, summary };
    }),

  /**
   * Owner-only: Manually trigger a full recalibration run.
   * Runs runMlbBacktest2.py, updates mlb_calibration_constants.json,
   * and patches EMPIRICAL_PRIORS in MLBAIModel.py.
   *
   * Input:
   *   reason — 'MANUAL' (default) | 'SCHEDULED' | 'DRIFT_DETECTED'
   */
  triggerRecalibration: ownerProcedure
    .input(
      z.object({
        reason: z.enum(["MANUAL", "SCHEDULED", "DRIFT_DETECTED"]).optional().default("MANUAL"),
      })
    )
    .mutation(async ({ input }) => {
      const tag = `${TAG}[triggerRecalibration]`;
      console.log(`${tag} Manual recalibration trigger: reason=${input.reason}`);
      try {
        const result = await triggerRecalibration(input.reason);
        console.log(`${tag} COMPLETE: success=${result.success} constantsPatched=${result.constantsPatched}`);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} ERROR: ${msg}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Recalibration failed: ${msg}` });
      }
    }),
});

export type MlbScheduleRouter = typeof mlbScheduleRouter;

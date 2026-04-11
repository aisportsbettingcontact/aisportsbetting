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
});

export type MlbScheduleRouter = typeof mlbScheduleRouter;

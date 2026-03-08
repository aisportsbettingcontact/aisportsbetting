import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  deleteModelFile,
  getModelFileById,
  insertGames,
  insertModelFile,
  listGames,
  listModelFiles,
  updateModelFileStatus,
  listStagingGames,
  listStagingGamesRange,
  updateGameProjections,
  setGamePublished,
  publishAllStagingGames,
} from "./db";
import { storagePut } from "./storage";
import { parseFileBuffer, detectSportFromFilename, detectDateFromFilename } from "./fileParser";
import { nanoid } from "nanoid";
import { appUsersRouter, ownerProcedure } from "./routers/appUsers";
import { updateBookOdds, listNbaTeams, getNbaTeamByDbSlug, getGameTeamColors } from "./db";
import { getLastRefreshResult, runVsinRefresh, refreshAllScoresNow } from "./vsinAutoRefresh";
import { VALID_DB_SLUGS } from "@shared/ncaamTeams";
import { NBA_VALID_DB_SLUGS } from "@shared/nbaTeams";

/** Returns true if both teams are in the appropriate registry for the given sport */
function isValidGame(awayTeam: string, homeTeam: string, sport?: string | null): boolean {
  if (sport === "NBA") {
    return NBA_VALID_DB_SLUGS.has(awayTeam) && NBA_VALID_DB_SLUGS.has(homeTeam);
  }
  // Default: NCAAM check
  return VALID_DB_SLUGS.has(awayTeam) && VALID_DB_SLUGS.has(homeTeam);
}

export const appRouter = router({
  system: systemRouter,
  appUsers: appUsersRouter,

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Files ─────────────────────────────────────────────────────────────────
  files: router({
    /**
     * Upload a CSV or XLSX model file to S3 and ingest rows into the games table.
     */
    upload: protectedProcedure
      .input(
        z.object({
          filename: z.string().min(1).max(255),
          contentBase64: z.string(),
          sizeBytes: z.number().int().positive(),
          sport: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const sport = input.sport ?? detectSportFromFilename(input.filename);
        const gameDate = detectDateFromFilename(input.filename);

        const buffer = Buffer.from(input.contentBase64, "base64");
        const suffix = nanoid(10);
        const fileKey = `model-files/${ctx.user.id}/${suffix}-${input.filename}`;

        const mimeType = input.filename.toLowerCase().endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv";
        const { url: fileUrl } = await storagePut(fileKey, buffer, mimeType);

        await insertModelFile({
          uploadedBy: ctx.user.id,
          filename: input.filename,
          fileKey,
          fileUrl,
          mimeType,
          sizeBytes: input.sizeBytes,
          sport,
          gameDate: gameDate ?? undefined,
          status: "processing",
          rowsImported: 0,
        });

        const files = await listModelFiles(ctx.user.id);
        const fileRecord = files.find((f) => f.fileKey === fileKey);
        if (!fileRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "File record not found after insert",
          });
        }

        try {
          const gameRows = parseFileBuffer(buffer, input.filename, fileRecord.id, sport);
          if (gameRows.length > 0) {
            await insertGames(gameRows);
          }
          await updateModelFileStatus(fileRecord.id, "done", gameRows.length);

          return {
            success: true,
            fileId: fileRecord.id,
            filename: input.filename,
            sport,
            rowsImported: gameRows.length,
            fileUrl,
          };
        } catch (err) {
          await updateModelFileStatus(fileRecord.id, "error", 0);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `File uploaded but parsing failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return listModelFiles(ctx.user.id);
    }),

    delete: protectedProcedure
      .input(z.object({ fileId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const file = await getModelFileById(input.fileId);
        if (!file) {
          throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
        }
        if (file.uploadedBy !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your file" });
        }
        await deleteModelFile(input.fileId);
        return { success: true };
      }),
  }),

  // ─── NBA Teams ─────────────────────────────────────────────────────
  nbaTeams: router({
    /** List all 30 NBA teams from DB. */
    list: publicProcedure.query(async () => {
      return listNbaTeams();
    }),

    /** Get a single NBA team by its DB slug (e.g. "boston_celtics"). */
    byDbSlug: publicProcedure
      .input(z.object({ dbSlug: z.string() }))
      .query(async ({ input }) => {
        return getNbaTeamByDbSlug(input.dbSlug);
      }),
  }),

  // ─── Games ─────────────────────────────────────────────────────────────────
  games: router({
    /**
     * List all games, optionally filtered by sport and/or date.
     */
    list: publicProcedure
      .input(
        z
          .object({
            sport: z.string().optional(),
            gameDate: z.string().optional(),
            gameStatus: z.enum(['upcoming', 'live', 'final']).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const games = await listGames(input ?? {});
        // Filter by the appropriate registry based on sport
        let filtered = games.filter(g => isValidGame(g.awayTeam, g.homeTeam, g.sport));
        // Filter by game status if provided
        if (input?.gameStatus) {
          filtered = filtered.filter(g => g.gameStatus === input.gameStatus);
        }
        return filtered;
      }),

    /**
     * List all staging games for a given date.
     * Owner-only — used by the Publish Model Projections page.
     */
    listStaging: ownerProcedure
      .input(z.object({ gameDate: z.string(), sport: z.string().optional() }))
      .query(async ({ input }) => {
        const games = await listStagingGames(input.gameDate, input.sport);
        return games.filter(g => isValidGame(g.awayTeam, g.homeTeam, g.sport));
      }),

    /**
     * Update model projections (spreads, total, edge labels) for a single game.
     * Owner-only.
     */
    updateProjections: ownerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          awayModelSpread: z.string().nullable().optional(),
          homeModelSpread: z.string().nullable().optional(),
          modelTotal: z.string().nullable().optional(),
          spreadEdge: z.string().nullable().optional(),
          spreadDiff: z.string().nullable().optional(),
          totalEdge: z.string().nullable().optional(),
          totalDiff: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateGameProjections(id, data);
        return { success: true };
      }),

    /**
     * Toggle publishedToFeed for a single game.
     * Owner-only.
     */
    setPublished: ownerProcedure
      .input(z.object({ id: z.number().int().positive(), published: z.boolean() }))
      .mutation(async ({ input }) => {
        await setGamePublished(input.id, input.published);
        return { success: true };
      }),

    /**
     * Publish all staging games for a date at once.
     * Owner-only.
     */
    publishAll: ownerProcedure
      .input(z.object({ gameDate: z.string(), sport: z.string().optional() }))
      .mutation(async ({ input }) => {
        await publishAllStagingGames(input.gameDate, input.sport);
        return { success: true };
      }),

    /**
     * List all staging games for a date range (inclusive).
     * Owner-only — used by Publish Projections for multi-day view.
     */
    listStagingRange: ownerProcedure
      .input(z.object({ fromDate: z.string(), toDate: z.string(), sport: z.string().optional() }))
      .query(async ({ input }) => {
        const games = await listStagingGamesRange(input.fromDate, input.toDate, input.sport);
        return games.filter(g => isValidGame(g.awayTeam, g.homeTeam, g.sport));
      }),

    /** Returns the result of the last auto-refresh run (null if never run). */
    lastRefresh: publicProcedure.query(() => {
      return getLastRefreshResult();
    }),

    /**
     * Manually trigger an immediate VSiN + NCAA refresh.
     * Owner-only.
     */
    triggerRefresh: ownerProcedure.mutation(async () => {
      // Run VSiN odds/lines refresh first, then immediately refresh all scores
      const [result] = await Promise.allSettled([runVsinRefresh()]);
      // Always refresh scores regardless of whether VSiN succeeded
      await refreshAllScoresNow();
      const now = new Date().toISOString();
      const oddsResult = result.status === 'fulfilled' ? result.value : null;
      return oddsResult ?? { refreshedAt: now, scoresRefreshedAt: now, updated: 0, inserted: 0, ncaaInserted: 0, nbaUpdated: 0, nbaInserted: 0, nbaScheduleInserted: 0, total: 0, nbaTotal: 0, gameDate: "" };
    }),
  }),

  // ─── Team Colors ─────────────────────────────────────────────────────────────
  teamColors: router({
    /**
     * Fetch primary/secondary/tertiary hex colors for both teams in a game.
     * Used by BettingSplitsPanel to color the split bars with real team branding.
     */
    getForGame: publicProcedure
      .input(z.object({
        awayTeam: z.string(),
        homeTeam: z.string(),
        sport: z.string(),
      }))
      .query(async ({ input }) => {
        return getGameTeamColors(input.awayTeam, input.homeTeam, input.sport);
      }),
  }),
});

export type AppRouter = typeof appRouter;

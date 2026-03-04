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
  updateGameProjections,
  setGamePublished,
  publishAllStagingGames,
} from "./db";
import { storagePut } from "./storage";
import { parseFileBuffer, detectSportFromFilename, detectDateFromFilename } from "./fileParser";
import { syncEspnTeams, buildEspnLogoUrl } from "./espnScraper";
import { listEspnTeams, getEspnTeamBySlug } from "./db";
import { nanoid } from "nanoid";
import { appUsersRouter, ownerProcedure } from "./routers/appUsers";
import { scrapeVsinOdds, matchTeam } from "./vsinScraper";
import { updateBookOdds } from "./db";

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

  // ─── ESPN Teams ───────────────────────────────────────────────────────────
  teams: router({
    /**
     * List all ESPN teams from DB (auto-synced on startup).
     * Returns slug, displayName, espnId, conference, sport, and logoUrl.
     */
    list: publicProcedure
      .input(z.object({ sport: z.string().optional() }).optional())
      .query(async ({ input }) => {
        const teams = await listEspnTeams(input?.sport ?? "NCAAM");
        return teams.map((t) => ({
          ...t,
          logoUrl: buildEspnLogoUrl(t.espnId),
        }));
      }),

    /**
     * Get a single team by slug with its ESPN logo URL.
     */
    bySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const team = await getEspnTeamBySlug(input.slug);
        if (!team) return null;
        return { ...team, logoUrl: buildEspnLogoUrl(team.espnId) };
      }),

    /**
     * Manually trigger an ESPN sync (admin only).
     */
    sync: protectedProcedure
      .input(z.object({ sport: z.string().optional() }).optional())
      .mutation(async ({ input }) => {
        const count = await syncEspnTeams(input?.sport ?? "NCAAM");
        return { success: true, teamsUpserted: count };
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
          })
          .optional()
      )
      .query(async ({ input }) => {
        return listGames(input ?? {});
      }),

    /**
     * List all staging games for a given date.
     * Owner-only — used by the Publish Model Projections page.
     */
    listStaging: ownerProcedure
      .input(z.object({ gameDate: z.string() }))
      .query(async ({ input }) => {
        return listStagingGames(input.gameDate);
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
      .input(z.object({ gameDate: z.string() }))
      .mutation(async ({ input }) => {
        await publishAllStagingGames(input.gameDate);
        return { success: true };
      }),

    /**
     * Scrape live VSiN CBB betting splits and update the Books column for all
     * games on the given date. Matches by team name.
     * Owner-only. Takes ~15-30 seconds.
     */
    refreshBooks: ownerProcedure
      .input(z.object({ gameDate: z.string() }))
      .mutation(async ({ input }) => {
        // 1. Fetch all games for the date
        const allGames = await listStagingGames(input.gameDate);

        if (allGames.length === 0) {
          return { updated: 0, message: "No games found for " + input.gameDate };
        }

        // 2. Scrape VSiN
        const d = new Date(input.gameDate + "T12:00:00Z");
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const dateLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`;
        const scraped = await scrapeVsinOdds(dateLabel);

        // 3. Match each game by team name and update
        let updated = 0;
        for (const game of allGames) {
          const odds = scraped.find(
            (s) => matchTeam(s.awayTeam, game.awayTeam) && matchTeam(s.homeTeam, game.homeTeam)
          );
          if (!odds) continue;

          await updateBookOdds(game.id, {
            awayBookSpread: odds.awaySpread,
            homeBookSpread: odds.homeSpread,
            bookTotal: odds.total,
          });
          updated++;
        }

        return { updated, total: allGames.length };
      }),
  }),
});

export type AppRouter = typeof appRouter;

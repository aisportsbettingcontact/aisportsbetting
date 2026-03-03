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
  upsertSheetGames,
  updateModelFileStatus,
} from "./db";
import { storagePut } from "./storage";
import { parseFileBuffer, detectSportFromFilename, detectDateFromFilename } from "./fileParser";
import { fetchLatestSheetGames, fetchAllSheetsGames, SHEETS_FILE_ID } from "./sheetsSync";
import { syncEspnTeams, buildEspnLogoUrl } from "./espnScraper";
import { listEspnTeams, getEspnTeamBySlug } from "./db";
import { nanoid } from "nanoid";

export const appRouter = router({
  system: systemRouter,

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Google Sheets Sync ────────────────────────────────────────────────────
  sheets: router({
    /**
     * Fetch the latest sheet from Google Sheets and upsert games into the DB.
     * Public so the dashboard can auto-sync on load.
     */
    syncLatest: publicProcedure.mutation(async () => {
      const { games, sheetName } = await fetchLatestSheetGames();
      if (games.length === 0) {
        return { success: true, gamesUpserted: 0, sheetName: null };
      }
      await upsertSheetGames(games);
      return {
        success: true,
        gamesUpserted: games.length,
        sheetName,
      };
    }),

    /**
     * Fetch ALL historical sheets and upsert all games.
     * Protected — only authenticated users can trigger a full sync.
     */
    syncAll: protectedProcedure.mutation(async () => {
      const { games, result } = await fetchAllSheetsGames();
      if (games.length > 0) {
        await upsertSheetGames(games);
      }
      return {
        success: true,
        ...result,
      };
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
  }),
});

export type AppRouter = typeof appRouter;

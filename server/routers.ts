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
  setGameModelPublished,
  bulkApproveModels,
  publishAllStagingGames,
  getActiveSports,
} from "./db";
import { storagePut } from "./storage";
import { parseFileBuffer, detectSportFromFilename, detectDateFromFilename } from "./fileParser";
import { nanoid } from "nanoid";
import { appUsersRouter, ownerProcedure, appUserProcedure } from "./routers/appUsers";
import { updateBookOdds, listNbaTeams, getNbaTeamByDbSlug, getGameTeamColors, deleteGameById, getFavoriteGameIds, getFavoriteGamesWithDates, toggleFavoriteGame, updateAnOdds, listGamesByDate, listOddsHistory, getBracketGames, auditAndAdvanceAllBracketWinners, getMlbLineupsByGameIds, getStrikeoutPropsByGame, getStrikeoutPropsByGames, getMlbGameEnvSignals } from "./db";
import { runStrikeoutModel, type StrikeoutRunnerInput } from "./strikeoutModelRunner";
import { getLastRefreshResult, runVsinRefresh, runVsinRefreshManual, refreshAllScoresNow } from "./vsinAutoRefresh";
import { syncNbaModelFromSheet, getLastNbaModelSyncResult } from "./nbaModelSync";
import { triggerModelWatcherForDate } from "./ncaamModelWatcher";
import { syncNhlModelForToday, getLastNhlSyncResult } from "./nhlModelSync";
import { checkGoalieChanges, getLastGoalieWatchResult } from "./nhlGoalieWatcher";
import { VALID_DB_SLUGS, NCAAM_TEAMS, BY_AN_SLUG as NCAAM_BY_AN_SLUG } from "@shared/ncaamTeams";
import { MARCH_MADNESS_DB_SLUGS } from "@shared/marchMadnessTeams";
import { parseAnAllMarketsHtml, type AnSport } from "./anHtmlParser";
import { NBA_VALID_DB_SLUGS, NBA_TEAMS } from "@shared/nbaTeams";
import { NHL_VALID_DB_SLUGS, NHL_TEAMS } from "@shared/nhlTeams";
import { MLB_BY_ABBREV, MLB_VALID_DB_SLUGS, MLB_VALID_ABBREVS } from "@shared/mlbTeams";

/** Returns true if both teams are in the appropriate registry for the given sport */
function isValidGame(awayTeam: string, homeTeam: string, sport?: string | null): boolean {
  if (sport === "NBA") {
    return NBA_VALID_DB_SLUGS.has(awayTeam) && NBA_VALID_DB_SLUGS.has(homeTeam);
  }
  if (sport === "NHL") {
    return NHL_VALID_DB_SLUGS.has(awayTeam) && NHL_VALID_DB_SLUGS.has(homeTeam);
  }
  if (sport === "MLB") {
    // Teams may be stored as abbreviations (e.g. "NYY") from the schedule seeder
    // or as dbSlugs (e.g. "yankees") from VSiN. Accept both.
    const awayOk = MLB_VALID_ABBREVS.has(awayTeam) || MLB_VALID_DB_SLUGS.has(awayTeam);
    const homeOk = MLB_VALID_ABBREVS.has(homeTeam) || MLB_VALID_DB_SLUGS.has(homeTeam);
    return awayOk && homeOk;
  }
  // NCAAM: only show March Madness bracket teams
  return MARCH_MADNESS_DB_SLUGS.has(awayTeam) && MARCH_MADNESS_DB_SLUGS.has(homeTeam);
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
        const fileRecord = files.find((f: { fileKey: string }) => f.fileKey === fileKey);
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
          modelAwayML: z.string().nullable().optional(),
          modelHomeML: z.string().nullable().optional(),
          spreadEdge: z.string().nullable().optional(),
          spreadDiff: z.string().nullable().optional(),
          totalEdge: z.string().nullable().optional(),
          totalDiff: z.string().nullable().optional(),
          // NHL-specific odds fields
          awaySpreadOdds: z.string().nullable().optional(),
          homeSpreadOdds: z.string().nullable().optional(),
          overOdds: z.string().nullable().optional(),
          underOdds: z.string().nullable().optional(),
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
     * Approve or retract model projections for a single NCAAM game.
     * Owner-only. When approved (published=true), model fields become visible on the public feed.
     */
    setModelPublished: ownerProcedure
      .input(z.object({ id: z.number().int().positive(), published: z.boolean() }))
      .mutation(async ({ input }) => {
        await setGameModelPublished(input.id, input.published);
        return { success: true };
      }),

    /**
     * Bulk-approve all pending model projections for a date.
     * Only approves games that have model data (awayModelSpread + modelTotal not null)
     * and are not yet approved (publishedModel = false).
     * Owner-only.
     */
    bulkApproveModels: ownerProcedure
      .input(z.object({ gameDate: z.string(), sport: z.string().optional() }))
      .mutation(async ({ input }) => {
        const count = await bulkApproveModels(input.gameDate, input.sport);
        console.log(`[tRPC] games.bulkApproveModels: gameDate=${input.gameDate} sport=${input.sport ?? 'all'} — approved ${count} games`);
        return { success: true, approved: count };
      }),

    /**
     * Publish all staging games for a date at once.
     * Owner-only.
     */
    publishAll: ownerProcedure
      .input(z.object({ gameDate: z.string(), sport: z.string().optional() }))
      .mutation(async ({ input }) => {
        const sportLabel = input.sport ?? "ALL";
        console.log(
          `[tRPC][publishAll] ► Owner triggered Publish All — scope: ${sportLabel} | ` +
          `date: ${input.gameDate} | timestamp: ${new Date().toISOString()}`
        );
        await publishAllStagingGames(input.gameDate, input.sport);
        console.log(
          `[tRPC][publishAll] ✅ Complete — all ${sportLabel} games for ${input.gameDate} published to feed`
        );
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

    /**
     * Returns which sports have at least one game on today's UTC date or tomorrow's UTC date.
     * Used by the frontend to hide sport tabs when there are no upcoming games.
     */
    activeSports: publicProcedure.query(async () => {
      return getActiveSports();
    }),

    /** Returns the result of the last auto-refresh run (null if never run). */
    lastRefresh: publicProcedure.query(() => {
      return getLastRefreshResult();
    }),

    /**
     * Hard-delete a single game by ID. Owner-only. Irreversible.
     */
    deleteGame: ownerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteGameById(input.id);
        return { success: true, deletedId: input.id };
      }),

    /**
     * Returns the result of the last NBA model sheet sync (null if never run).
     * Owner-only.
     */
    lastNbaModelSync: ownerProcedure.query(() => {
      return getLastNbaModelSyncResult();
    }),

    /**
     * Manually trigger an immediate NBA model sheet sync.
     * Owner-only.
     */
    triggerNbaModelSync: ownerProcedure.mutation(async () => {
      const result = await syncNbaModelFromSheet();
      return result;
    }),

    /**
     * Ingest Action Network "All Markets" HTML paste.
     * Parses Open lines + DK NJ lines for all games and writes them to the DB.
     * Owner-only.
     */
    ingestAnHtml: ownerProcedure
      .input(z.object({
        html: z.string().min(100, "HTML too short — paste the full AN best-odds table HTML"),
        gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "gameDate must be YYYY-MM-DD"),
        sport: z.enum(["NCAAM", "NBA", "NHL"]).default("NCAAM"),
      }))
      .mutation(async ({ input }) => {
        const { html, gameDate, sport } = input;

        // Map sport string to AnSport type
        const anSport: AnSport = sport === "NBA" ? "nba" : sport === "NHL" ? "nhl" : "ncaab";

        // ── Parse HTML ──
        const parseResult = parseAnAllMarketsHtml(html, anSport);
        if (!parseResult.games.length) {
          return { updated: 0, skipped: 0, warnings: parseResult.warnings, errors: ["No games found in HTML"] };
        }

        // ── Build URL-slug → dbSlug lookup ──
        // The AN game URL uses shortened combined slugs (e.g. "saint-josephs-vcu").
        // We need to split them into individual team slugs and match to dbSlug.
        const byNormSlug = new Map<string, string>();

        if (sport === "NCAAM") {
          // NCAAM-specific URL-slug aliases
          const NCAAM_URL_ALIASES: Record<string, string> = {
            "wichita-state": "wichita_st",
            "san-diego-state": "san_diego_st",
            "utah-state": "utah_st",
            "prairie-view-am": "prairie_view_a_and_m",
            "southern-university": "southern_u",
            "kennesaw-state": "kennesaw_st",
            "north-carolina-central": "nc_central",
            "cal-baptist": "california_baptist",
            "utah-valley": "utah_valley",
            "penn": "pennsylvania",
            "ole-miss": "mississippi",
            "uconn": "connecticut",
            "vcu": "va_commonwealth",
          };
          for (const [alias, dbSlug] of Object.entries(NCAAM_URL_ALIASES)) {
            byNormSlug.set(alias, dbSlug);
          }
          for (const t of NCAAM_TEAMS) {
            byNormSlug.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
            byNormSlug.set(t.ncaaSlug, t.dbSlug);
            byNormSlug.set(t.vsinSlug, t.dbSlug);
            byNormSlug.set(t.anSlug, t.dbSlug);
          }
        } else if (sport === "NBA") {
          // NBA URL-slug aliases (short nicknames used in AN game URLs)
          const NBA_URL_ALIASES: Record<string, string> = {
            "wizards": "washington_wizards",
            "celtics": "boston_celtics",
            "magic": "orlando_magic",
            "heat": "miami_heat",
            "nuggets": "denver_nuggets",
            "lakers": "los_angeles_lakers",
            "kings": "sacramento_kings",
            "clippers": "los_angeles_clippers",
            "bucks": "milwaukee_bucks",
            "hawks": "atlanta_hawks",
            "hornets": "charlotte_hornets",
            "spurs": "san_antonio_spurs",
            "nets": "brooklyn_nets",
            "76ers": "philadelphia_76ers",
            "knicks": "new_york_knicks",
            "raptors": "toronto_raptors",
            "bulls": "chicago_bulls",
            "cavaliers": "cleveland_cavaliers",
            "pistons": "detroit_pistons",
            "pacers": "indiana_pacers",
            "timberwolves": "minnesota_timberwolves",
            "thunder": "oklahoma_city_thunder",
            "jazz": "utah_jazz",
            "trail-blazers": "portland_trail_blazers",
            "warriors": "golden_state_warriors",
            "suns": "phoenix_suns",
            "mavericks": "dallas_mavericks",
            "rockets": "houston_rockets",
            "grizzlies": "memphis_grizzlies",
            "pelicans": "new_orleans_pelicans",
          };
          for (const [alias, dbSlug] of Object.entries(NBA_URL_ALIASES)) {
            byNormSlug.set(alias, dbSlug);
          }
          for (const t of NBA_TEAMS) {
            byNormSlug.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
            byNormSlug.set(t.anSlug, t.dbSlug);
            byNormSlug.set(t.nbaSlug, t.dbSlug);
            byNormSlug.set(t.vsinSlug, t.dbSlug);
          }
        } else if (sport === "NHL") {
          // NHL URL-slug aliases (short nicknames used in AN game URLs)
          const NHL_URL_ALIASES: Record<string, string> = {
            "rangers": "new_york_rangers",
            "wild": "minnesota_wild",
            "kings": "los_angeles_kings",
            "devils": "new_jersey_devils",
            "sharks": "san_jose_sharks",
            "canadiens": "montreal_canadiens",
            "hurricanes": "carolina_hurricanes",
            "lightning": "tampa_bay_lightning",
            "maple-leafs": "toronto_maple_leafs",
            "sabres": "buffalo_sabres",
            "flames": "calgary_flames",
            "islanders": "new_york_islanders",
            "blue-jackets": "columbus_blue_jackets",
            "flyers": "philadelphia_flyers",
            "red-wings": "detroit_red_wings",
            "stars": "dallas_stars",
            "penguins": "pittsburgh_penguins",
            "mammoth": "utah_mammoth",
            "utah-hockey-club": "utah_mammoth",
            "blackhawks": "chicago_blackhawks",
            "golden-knights": "vegas_golden_knights",
            "kraken": "seattle_kraken",
            "canucks": "vancouver_canucks",
            "bruins": "boston_bruins",
            "capitals": "washington_capitals",
            "avalanche": "colorado_avalanche",
            "jets": "winnipeg_jets",
            "ducks": "anaheim_ducks",
            "senators": "ottawa_senators",
            "oilers": "edmonton_oilers",
            "predators": "nashville_predators",
            "blues": "st_louis_blues",
            "panthers": "florida_panthers",
          };
          for (const [alias, dbSlug] of Object.entries(NHL_URL_ALIASES)) {
            byNormSlug.set(alias, dbSlug);
          }
          for (const t of NHL_TEAMS) {
            byNormSlug.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
            byNormSlug.set(t.anSlug, t.dbSlug);
            byNormSlug.set(t.vsinSlug, t.dbSlug);
            byNormSlug.set(t.nhlSlug, t.dbSlug);
          }
        }

        function splitCombinedSlug(combined: string): [string, string] | null {
          const parts = combined.split("-");
          for (let i = 1; i < parts.length; i++) {
            const awayPart = parts.slice(0, i).join("-");
            const homePart = parts.slice(i).join("-");
            if (byNormSlug.has(awayPart) && byNormSlug.has(homePart)) {
              return [byNormSlug.get(awayPart)!, byNormSlug.get(homePart)!];
            }
          }
          return null;
        }

        // ── Load existing DB games for the date ──
        const existingGames = await listGamesByDate(gameDate, sport);

        let updated = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const g of parseResult.games) {
          // Extract combined slug from game URL
          const urlParts = g.gameUrl.split("/");
          const gamePart = urlParts[2] || "";
          const combined = gamePart.replace(/-score-odds-.*$/, "");
          const slugMatch = splitCombinedSlug(combined);

          if (!slugMatch) {
            const msg = `NO_SLUG: cannot split "${combined}" (game ${g.anGameId}: ${g.awayName} @ ${g.homeName})`;
            errors.push(msg);
            console.warn(`[ingestAnHtml] ${msg}`);
            skipped++;
            continue;
          }

          const [awayDbSlug, homeDbSlug] = slugMatch;
          const dbGame = existingGames.find(
            (e) => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
          );

          if (!dbGame) {
            const msg = `NO_MATCH: ${awayDbSlug} @ ${homeDbSlug} on ${gameDate} (game ${g.anGameId})`;
            errors.push(msg);
            console.warn(`[ingestAnHtml] ${msg}`);
            skipped++;
            continue;
          }

          // Write open lines (AN HTML open column) AND DK NJ current lines
          // DK lines are stored in the primary book columns (awayBookSpread IS the DK line)
          await updateAnOdds(dbGame.id, {
            // Open lines
            openAwaySpread: g.openAwaySpread?.line ?? null,
            openAwaySpreadOdds: g.openAwaySpread?.juice ?? null,
            openHomeSpread: g.openHomeSpread?.line ?? null,
            openHomeSpreadOdds: g.openHomeSpread?.juice ?? null,
            openTotal: g.openOver?.line?.replace(/^[ou]/i, "") ?? null,
            openOverOdds: g.openOver?.juice ?? null,
            openUnderOdds: g.openUnder?.juice ?? null,
            openAwayML: g.openAwayML?.line ?? null,
            openHomeML: g.openHomeML?.line ?? null,
            // DK NJ current lines — stored in primary book columns
            awayBookSpread: g.dkAwaySpread?.line ?? null,
            awaySpreadOdds: g.dkAwaySpread?.juice ?? null,
            homeBookSpread: g.dkHomeSpread?.line ?? null,
            homeSpreadOdds: g.dkHomeSpread?.juice ?? null,
            bookTotal: g.dkOver?.line?.replace(/^[ou]/i, "") ?? null,
            overOdds: g.dkOver?.juice ?? null,
            underOdds: g.dkUnder?.juice ?? null,
            awayML: g.dkAwayML?.line ?? null,
            homeML: g.dkHomeML?.line ?? null,
          });

          updated++;
          console.log(
            `[ingestAnHtml] Updated: ${awayDbSlug} @ ${homeDbSlug} (${gameDate}) | ` +
            `spread=${g.dkAwaySpread?.line}/${g.dkHomeSpread?.line} ` +
            `total=${g.dkOver?.line} ml=${g.dkAwayML?.line}/${g.dkHomeML?.line}`
          );
        }

        console.log(`[ingestAnHtml] Done: updated=${updated} skipped=${skipped} errors=${errors.length}`);
        return { updated, skipped, warnings: parseResult.warnings, errors };
      }),

    /**
     * Manually trigger an immediate VSiN + AN odds refresh.
     * Owner-only.
     *
     * @param sport - Optional scope. When provided, only that sport is refreshed.
     *                When omitted, all three sports (NCAAM, NBA, NHL) are refreshed.
     */
    triggerRefresh: ownerProcedure
      .input(
        z.object({
          sport: z.enum(["NCAAM", "NBA", "NHL", "MLB"]).optional(),
        }).optional()
      )
      .mutation(async ({ input }) => {
        const sport = input?.sport;
        const sportLabel = sport ?? "ALL";
        console.log(
          `[tRPC][triggerRefresh] Owner triggered manual refresh — scope: ${sportLabel} | ` +
          `timestamp: ${new Date().toISOString()}`
        );

        // Run VSiN odds/lines refresh first (manual variant tags history rows as source='manual'),
        // then immediately refresh all scores
        const [result] = await Promise.allSettled([runVsinRefreshManual(sport)]);

        // Always refresh scores regardless of whether VSiN succeeded
        console.log(`[tRPC][triggerRefresh] Refreshing scores (all sports, always)…`);
        await refreshAllScoresNow();
        console.log(`[tRPC][triggerRefresh] Score refresh complete.`);

        const now = new Date().toISOString();
        const oddsResult = result.status === 'fulfilled' ? result.value : null;

        if (result.status === 'rejected') {
          console.error(`[tRPC][triggerRefresh] runVsinRefreshManual failed:`, result.reason);
        } else {
          console.log(
            `[tRPC][triggerRefresh] ✅ Manual refresh complete — scope: ${sportLabel} | ` +
            `NCAAM updated: ${oddsResult?.updated ?? 0} | ` +
            `NBA updated: ${oddsResult?.nbaUpdated ?? 0} | ` +
            `NHL updated: ${oddsResult?.nhlUpdated ?? 0}`
          );
        }

        return oddsResult ?? {
          refreshedAt: now,
          scoresRefreshedAt: now,
          updated: 0,
          inserted: 0,
          ncaaInserted: 0,
          nbaUpdated: 0,
          nbaInserted: 0,
          nbaScheduleInserted: 0,
          total: 0,
          nbaTotal: 0,
          nhlUpdated: 0,
          nhlInserted: 0,
          nhlScheduleInserted: 0,
          nhlTotal: 0,
          gameDate: "",
        };
      }),

    /**
     * Fetch MLB lineups for a list of game IDs.
     * Returns a map of gameId → lineup row (pitcher, batting order, weather, umpire).
     * Public — lineups are visible to all users.
     */
    mlbLineups: publicProcedure
      .input(z.object({ gameIds: z.array(z.number().int().positive()) }))
      .query(async ({ input }) => {
        if (input.gameIds.length === 0) return {};
        const map = await getMlbLineupsByGameIds(input.gameIds);
        // Convert Map to plain object for JSON serialization
        const result: Record<number, unknown> = {};
        for (const [gameId, row] of Array.from(map.entries())) {
          result[gameId] = row;
        }
        return result;
      }),
    /**
     * Fetch MLB environment signals (park factor, bullpen ERA/FIP, umpire K/BB modifiers)
     * for a single game. Used by the MlbLineupCard detail view.
     * Returns nulls for any signal not yet seeded.
     */
    mlbEnvSignals: publicProcedure
      .input(z.object({
        homeTeam: z.string().min(2).max(8),
        awayTeam: z.string().min(2).max(8),
        umpireName: z.string().nullable().optional(),
      }))
      .query(async ({ input }) => {
        return getMlbGameEnvSignals({
          homeTeam: input.homeTeam,
          awayTeam: input.awayTeam,
          umpireName: input.umpireName ?? null,
        });
      }),
  }),

  // ─── Favorites ──────────────────────────────────────────────────────────────
  // NOTE: Uses appUserProcedure (custom app_session cookie auth), NOT protectedProcedure
  // (Manus OAuth). Custom-auth users have ctx.user = null, so protectedProcedure would
  // always throw UNAUTHORIZED for them.
  favorites: router({
    /** Get all favorited game IDs for the current user. */
    getMyFavorites: appUserProcedure.query(async ({ ctx }) => {
      const ids = await getFavoriteGameIds(ctx.appUser.id);
      return { favoriteGameIds: ids };
    }),
    /** Get favorited game IDs with their game dates (for 11:00 UTC expiry). */
    getMyFavoritesWithDates: appUserProcedure.query(async ({ ctx }) => {
      const rows = await getFavoriteGamesWithDates(ctx.appUser.id);
      return { favorites: rows };
    }),
    /** Toggle a game as favorited/unfavorited for the current user. */
    toggle: appUserProcedure
      .input(z.object({ gameId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return toggleFavoriteGame(ctx.appUser.id, input.gameId);
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

  // ─── NCAAM Model v9 ───────────────────────────────────────────────────────────────────────────────────────
  model: router({
    /**
     * Manually trigger model v9 for a specific date.
     * Owner-only — dispatches via the dedicated ModelWatcher.
     * skipExisting=false forces a full re-run even for already-projected games.
     */
    runForDate: ownerProcedure
      .input(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
          forceRerun: z.boolean().optional().default(false),
        })
      )
      .mutation(async ({ input }) => {
        const result = await triggerModelWatcherForDate(input.date, {
          forceRerun: input.forceRerun,
        });
        return result;
      }),
  }),
  // ─── NHL Model Sync ─────────────────────────────────────────────────────────
  nhlModel: router({
    /**
     * Manually trigger the NHL model sync for today's games.
     * Owner-only — re-runs the model for all unmodeled games.
     */
    triggerSync: ownerProcedure
      .mutation(async () => {
        const result = await syncNhlModelForToday("manual");
        return result;
      }),
    /**
     * Get the last NHL model sync result.
     */
    getLastSyncResult: ownerProcedure
      .query(() => {
        return getLastNhlSyncResult();
      }),
    /**
     * Manually trigger the goalie change watcher.
     * Owner-only — checks RotoWire for goalie changes and re-runs model if needed.
     */
    checkGoalies: ownerProcedure
      .mutation(async () => {
        const result = await checkGoalieChanges("manual");
        return result;
      }),
    /**
     * Get the last goalie watch result.
     */
    getLastGoalieCheck: ownerProcedure
      .query(() => {
        return getLastGoalieWatchResult();
      }),
    /**
     * Force re-run the NHL model for today's games, even if already modeled.
     * Owner-only — clears modelRunAt and re-runs the model for all upcoming games.
     * Use this after schema changes or model engine updates.
     */
    forceRerun: ownerProcedure
      .mutation(async () => {
        const result = await syncNhlModelForToday("manual", true);
        return result;
      }),
    /**
     * Force re-run the NHL model for ALL today's games regardless of status.
     * Owner-only — runs model for upcoming + live + final games.
     * Use this to backfill correct model values after engine fixes.
     */
    forceRerunAll: ownerProcedure
      .mutation(async () => {
        const result = await syncNhlModelForToday("manual", true, true);
        return result;
      }),
  }),
  // ─── Odds History ────────────────────────────────────────────────────────────────────────────
  oddsHistory: router({
    /**
     * List all odds snapshots for a specific game, newest first.
     * Owner-only — used in Publish Projections odds history table.
     */
    listForGame: ownerProcedure
      .input(z.object({ gameId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const rows = await listOddsHistory(input.gameId);
        return { history: rows };
      }),
  }),
  // ─── MLB Strikeout Props ──────────────────────────────────────────────────────────────────────
  strikeoutProps: router({
    /**
     * Fetch strikeout prop projections for a single game.
     * Returns 0–2 rows (away pitcher, home pitcher).
     */
    getByGame: publicProcedure
      .input(z.object({ gameId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const rows = await getStrikeoutPropsByGame(input.gameId);
        return { props: rows };
      }),

    /**
     * Fetch strikeout props for multiple games at once.
     * Returns a record of gameId → rows[].
     */
    getByGames: publicProcedure
      .input(z.object({ gameIds: z.array(z.number().int().positive()) }))
      .query(async ({ input }) => {
        const map = await getStrikeoutPropsByGames(input.gameIds);
        // Convert Map to plain object for serialization
        const result: Record<number, typeof map extends Map<number, infer V> ? V : never> = {};
        Array.from(map.entries()).forEach(([k, v]) => {
          result[k] = v;
        });
        return { propsByGame: result };
      }),

    /**
     * Fetch rolling calibration metrics across all completed K-props.
     * Returns accuracy, MAE, mean error, calibration factor, and tier breakdown.
     */
    getCalibrationMetrics: ownerProcedure
      .query(async () => {
        const { getRollingCalibrationMetrics } = await import("./kPropsBacktestService");
        const metrics = await getRollingCalibrationMetrics();
        return { metrics };
      }),

    /**
     * Fetch daily backtest results for a specific date.
     * Returns all K-prop rows with actualKs, backtestResult, modelCorrect, modelError.
     */
    getDailyBacktest: ownerProcedure
      .input(z.object({ gameDate: z.string() }))
      .query(async ({ input }) => {
        const { getDailyBacktestResults } = await import("./kPropsBacktestService");
        const results = await getDailyBacktestResults(input.gameDate);
        return { results };
      }),
    /**
     * Owner-only: fetch rich daily backtest results with team names, headshots, and edge data.
     * Used exclusively by the Model Results backend page.
     */
    getRichDailyBacktest: ownerProcedure
      .input(z.object({ gameDate: z.string() }))
      .query(async ({ input }) => {
        const { getRichDailyBacktestResults } = await import("./kPropsBacktestService");
        const results = await getRichDailyBacktestResults(input.gameDate);
        return { results };
      }),

    /**
     * Owner-only: run the StrikeoutModel.py for a specific game.
     * Requires file paths to Retrosheet plays, Statcast JSON, and crosswalk CSV.
     */
    runModel: ownerProcedure
      .input(
        z.object({
          gameId: z.number().int().positive(),
          gameDate: z.string(),
          awayTeam: z.string(),
          homeTeam: z.string(),
          awayPitcherRsId: z.string(),
          homePitcherRsId: z.string(),
          playsPath: z.string(),
          statcastPath: z.string(),
          crosswalkPath: z.string(),
          awayMarketLine: z.number().optional(),
          awayMarketOverOdds: z.string().optional(),
          awayMarketUnderOdds: z.string().optional(),
          homeMarketLine: z.number().optional(),
          homeMarketOverOdds: z.string().optional(),
          homeMarketUnderOdds: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await runStrikeoutModel(input as StrikeoutRunnerInput);
        return result;
      }),
  }),

  // ─── March Madness Bracket ─────────────────────────────────────────────────────────────────────
  bracket: router({
    /**
     * Fetch all tournament games with bracket metadata.
     * Returns every game from First Four through Championship.
     * Accessible to all authenticated app users.
     */
    getGames: publicProcedure
      .query(async () => {
        const rows = await getBracketGames();
        return { games: rows };
      }),
    /**
     * Owner-only: audit all final bracket games and advance winners to next round.
     * Idempotent — safe to call multiple times.
     */
    auditAdvancement: ownerProcedure
      .mutation(async () => {
        const advanced = await auditAndAdvanceAllBracketWinners();
        return { advanced };
      }),
  }),
});
export type AppRouter = typeof appRouter;


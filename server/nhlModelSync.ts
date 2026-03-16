/**
 * nhlModelSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NHL model auto-detect cron.
 *
 * Execution flow:
 *   1. Detect all NHL games in the DB for today that have NOT yet been modeled
 *      (modelRunAt IS NULL) and are not live/final (gameStatus = 'upcoming')
 *   2. Scrape NaturalStatTrick team stats + goalie stats
 *   3. Scrape RotoWire starting goalies
 *   4. For each unmodeled game, build the engine input and run the Python model
 *   5. Write model output back to the games table (model fields only)
 *   6. Auto-approve projection (publishedModel = true) — owner has approved NHL model output
 *      Projections go live on the feed immediately after each successful model run.
 *
 * Schedule: runs every 30 minutes, 9AM–9PM PST (same window as NBA model sync)
 *
 * Manual trigger: call syncNhlModelForToday() directly from the tRPC procedure
 */

import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { bulkApproveModels } from "./db.js";
import { games } from "../drizzle/schema.js";
import type { Game } from "../drizzle/schema.js";
import { scrapeNhlTeamStats, scrapeNhlGoalieStats, getDefaultGoalieStats } from "./nhlNaturalStatScraper.js";
import { scrapeNhlStartingGoalies, matchGoalieName } from "./nhlRotoWireScraper.js";
import { runNhlModelForGame, buildTeamStatsDict, formatNhlML } from "./nhlModelEngine.js";
import type { NhlModelEngineInput } from "./nhlModelEngine.js";
import { NHL_BY_DB_SLUG } from "../shared/nhlTeams.js";
import { computeNhlRestDays } from "./nhlHockeyRefScraper.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlModelSyncResult {
  synced:   number;
  skipped:  number;
  errors:   string[];
  syncedAt: string;
}

let lastSyncResult: NhlModelSyncResult | null = null;

export function getLastNhlSyncResult(): NhlModelSyncResult | null {
  return lastSyncResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  const now = new Date();
  // Use Eastern time for game date (NHL games are typically scheduled in ET)
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  // Convert MM/DD/YYYY → YYYY-MM-DD
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

function getPSTHour(): number {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(pstStr, 10);
}

function isWithinSyncWindow(): boolean {
  const h = getPSTHour();
  return h >= 9 && h < 21;
}

/** Convert American odds to break-even probability (0–1). */
const americanOddsToBreakEven = (odds: number | null): number | null => {
  if (odds === null) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
};

/** Minimum edge (probability points above break-even) to flag a bet. */
const EDGE_THRESHOLD = 0.03;

/** Round a spread to nearest 0.5 */
function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Format a decimal ML to integer string with sign */
function fmtML(ml: number): string {
  const rounded = Math.round(ml);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

/**
 * Run the NHL model for all unmodeled games today.
 * Called by the scheduler and by the manual triggerRefresh tRPC procedure.
 */
export async function syncNhlModelForToday(
  source: "auto" | "manual" = "auto",
  forceRerun = false,
  runAllStatuses = false
): Promise<NhlModelSyncResult> {
  const gameDate = getTodayDate();
  const tag = source === "manual" ? "[MANUAL]" : "[AUTO]";

  console.log(`\n${"=".repeat(70)}`);
  console.log(`[NhlModelSync]${tag} ► START — date: ${gameDate}`);
  console.log(`${"=".repeat(70)}`);

  const result: NhlModelSyncResult = {
    synced: 0, skipped: 0, errors: [], syncedAt: new Date().toISOString(),
  };

  // ── Step 1: Find unmodeled NHL games for today ─────────────────────────────
  console.log(`[NhlModelSync]${tag} Step 1: Querying DB for unmodeled NHL games on ${gameDate}...`);

  const db = await getDb();

  // If forceRerun, clear modelRunAt for today's NHL games
  // runAllStatuses=true clears ALL statuses (upcoming + live + final)
  // forceRerun=true (without runAllStatuses) only clears upcoming
  if (forceRerun || runAllStatuses) {
    const statusMsg = runAllStatuses ? "ALL statuses (upcoming + live + final)" : "upcoming only";
    console.log(`[NhlModelSync]${tag}   forceRerun=true — clearing modelRunAt for NHL games today (${statusMsg})`);
    const clearWhere = runAllStatuses
      ? and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"))
      : and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"), eq(games.gameStatus, "upcoming"));
    await db.update(games).set({ modelRunAt: null }).where(clearWhere);
  }

  // Query games to model — runAllStatuses=true includes live/final games
  const statusFilter = runAllStatuses
    ? and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"), or(isNull(games.modelRunAt), isNull(games.modelAwayScore)))
    : and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"), eq(games.gameStatus, "upcoming"), or(isNull(games.modelRunAt), isNull(games.modelAwayScore)));

  const unmodeled = await db
    .select()
    .from(games)
    .where(statusFilter);

  console.log(`[NhlModelSync]${tag}   Found ${unmodeled.length} unmodeled NHL game(s) for ${gameDate}`);

  if (unmodeled.length === 0) {
    // Also check if there are any NHL games at all today
    const allNhl = await db
      .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam, gameStatus: games.gameStatus, modelRunAt: games.modelRunAt })
      .from(games)
      .where(and(eq(games.gameDate, gameDate), eq(games.sport, "NHL")));

    console.log(`[NhlModelSync]${tag}   Total NHL games today: ${allNhl.length}`);
    allNhl.forEach((g: Pick<Game, 'awayTeam' | 'homeTeam' | 'gameStatus' | 'modelRunAt'>) => {
      console.log(`[NhlModelSync]${tag}     ${g.awayTeam} @ ${g.homeTeam} | status=${g.gameStatus} | modelRunAt=${g.modelRunAt ?? "null"}`);
    });

    if (allNhl.length === 0) {
      console.log(`[NhlModelSync]${tag} ✅ No NHL games today — nothing to model`);
    } else {
      console.log(`[NhlModelSync]${tag} ✅ All NHL games already modeled or live/final — skipping`);
    }
    result.syncedAt = new Date().toISOString();
    lastSyncResult = result;
    return result;
  }

  // Log all games to be modeled
  unmodeled.forEach((g: Game, i: number) => {
    console.log(`[NhlModelSync]${tag}   [${i + 1}/${unmodeled.length}] ${g.awayTeam} @ ${g.homeTeam} | bookSpread=${g.awayBookSpread}/${g.homeBookSpread} | total=${g.bookTotal} | ML=${g.awayML}/${g.homeML}`);
  });

  // ── Step 2: Scrape NaturalStatTrick team + goalie stats ───────────────────
  console.log(`\n[NhlModelSync]${tag} Step 2: Scraping NaturalStatTrick team + goalie stats...`);

  let teamStatsMap = new Map<string, import("./nhlNaturalStatScraper.js").NhlTeamStats>();
  let goalieStatsMap = new Map<string, import("./nhlNaturalStatScraper.js").NhlGoalieStats>();

  // Fetch team stats and goalie stats independently so one failure doesn't block the other
  const [teamStatsResult, goalieStatsResult] = await Promise.allSettled([
    scrapeNhlTeamStats(),
    scrapeNhlGoalieStats(),
  ]);

  if (teamStatsResult.status === "fulfilled") {
    teamStatsMap = teamStatsResult.value;
    console.log(`[NhlModelSync]${tag}   ✅ Team stats: ${teamStatsMap.size} teams`);
  } else {
    const msg = teamStatsResult.reason instanceof Error ? teamStatsResult.reason.message : String(teamStatsResult.reason);
    console.error(`[NhlModelSync]${tag}   ⚠ Team stats scrape failed: ${msg} — using defaults`);
    result.errors.push(`Team stats scrape failed: ${msg}`);
  }

  if (goalieStatsResult.status === "fulfilled") {
    goalieStatsMap = goalieStatsResult.value;
    console.log(`[NhlModelSync]${tag}   ✅ Goalie stats: ${Math.floor(goalieStatsMap.size / 2)} goalies`);
  } else {
    const msg = goalieStatsResult.reason instanceof Error ? goalieStatsResult.reason.message : String(goalieStatsResult.reason);
    console.error(`[NhlModelSync]${tag}   ⚠ Goalie stats scrape failed: ${msg} — using defaults`);
    result.errors.push(`Goalie stats scrape failed: ${msg}`);
  }

  // ── Step 3: Scrape RotoWire starting goalies ──────────────────────────────
  console.log(`\n[NhlModelSync]${tag} Step 3: Scraping RotoWire starting goalies...`);

  const goalieByTeam = new Map<string, { name: string; confirmed: boolean }>();

  try {
    const rotoGames = await scrapeNhlStartingGoalies();
    console.log(`[NhlModelSync]${tag}   RotoWire returned ${rotoGames.length} games`);

    for (const rg of rotoGames) {
      if (rg.awayGoalie) {
        goalieByTeam.set(rg.awayTeam, { name: rg.awayGoalie.name, confirmed: rg.awayGoalie.confirmed });
        console.log(`[NhlModelSync]${tag}     ${rg.awayTeam} (away): ${rg.awayGoalie.name} (${rg.awayGoalie.confirmed ? "CONFIRMED" : "PROJECTED"})`);
      }
      if (rg.homeGoalie) {
        goalieByTeam.set(rg.homeTeam, { name: rg.homeGoalie.name, confirmed: rg.homeGoalie.confirmed });
        console.log(`[NhlModelSync]${tag}     ${rg.homeTeam} (home): ${rg.homeGoalie.name} (${rg.homeGoalie.confirmed ? "CONFIRMED" : "PROJECTED"})`);
      }
    }
    console.log(`[NhlModelSync]${tag}   ✅ Goalies mapped for ${goalieByTeam.size} teams`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NhlModelSync]${tag}   ⚠ RotoWire scrape failed: ${msg}`);
    console.error(`[NhlModelSync]${tag}   Proceeding without starting goalie data`);
    result.errors.push(`RotoWire scrape failed: ${msg}`);
  }

  // ── Step 4: Run model for each unmodeled game ─────────────────────────────
  console.log(`\n[NhlModelSync]${tag} Step 4: Running NHL model for ${unmodeled.length} game(s)...`);

  for (let i = 0; i < unmodeled.length; i++) {
    const game = unmodeled[i];

    // Resolve 3-letter abbrev from dbSlug (e.g. "boston_bruins" → "BOS")
    // The teamStatsMap from NaturalStatTrick is keyed by 3-letter abbrev.
    const awayTeamEntry = NHL_BY_DB_SLUG.get(game.awayTeam);
    const homeTeamEntry = NHL_BY_DB_SLUG.get(game.homeTeam);
    const awayAbbrev = awayTeamEntry?.abbrev ?? game.awayTeam.toUpperCase();
    const homeAbbrev = homeTeamEntry?.abbrev ?? game.homeTeam.toUpperCase();
    const gameLabel  = `${awayAbbrev} @ ${homeAbbrev}`;

    console.log(`\n[NhlModelSync]${tag} ── Game ${i + 1}/${unmodeled.length}: ${gameLabel} (${game.awayTeam} @ ${game.homeTeam}) ──`);

    try {
      // Resolve team stats — required, no fallback
      const awayStats = teamStatsMap.get(awayAbbrev);
      const homeStats = teamStatsMap.get(homeAbbrev);
      if (!awayStats || !homeStats) {
        const missing = [!awayStats && awayAbbrev, !homeStats && homeAbbrev].filter(Boolean).join(", ");
        throw new Error(`Team stats not available for: ${missing}. NST scrape may have failed or team abbreviation mismatch.`);
      }

      console.log(`[NhlModelSync]${tag}   Away (${awayAbbrev}): xGF%=${awayStats.xGF_pct} xGF/60=${awayStats.xGF_60} HDCF/60=${awayStats.HDCF_60} SCF/60=${awayStats.SCF_60} CF/60=${awayStats.CF_60}`);
      console.log(`[NhlModelSync]${tag}   Home (${homeAbbrev}): xGF%=${homeStats.xGF_pct} xGF/60=${homeStats.xGF_60} HDCF/60=${homeStats.HDCF_60} SCF/60=${homeStats.SCF_60} CF/60=${homeStats.CF_60}`);

      // Resolve starting goalies (keyed by 3-letter abbrev from RotoWire scraper)
      const awayGoalieInfo = goalieByTeam.get(awayAbbrev) ?? null;
      const homeGoalieInfo = goalieByTeam.get(homeAbbrev) ?? null;

      const awayGoalieName = awayGoalieInfo?.name ?? null;
      const homeGoalieName = homeGoalieInfo?.name ?? null;

      // Look up goalie stats from NaturalStatTrick
      const awayGoalieStats = awayGoalieName
        ? (matchGoalieName(awayGoalieName, goalieStatsMap) ?? getDefaultGoalieStats(awayGoalieName, awayAbbrev))
        : getDefaultGoalieStats("TBD", awayAbbrev);

      const homeGoalieStats = homeGoalieName
        ? (matchGoalieName(homeGoalieName, goalieStatsMap) ?? getDefaultGoalieStats(homeGoalieName, homeAbbrev))
        : getDefaultGoalieStats("TBD", homeAbbrev);

      console.log(`[NhlModelSync]${tag}   Away goalie: ${awayGoalieName ?? "TBD"} | GSAx=${awayGoalieStats.gsax.toFixed(2)} SV%=${awayGoalieStats.sv_pct} GP=${awayGoalieStats.gp}`);
      console.log(`[NhlModelSync]${tag}   Home goalie: ${homeGoalieName ?? "TBD"} | GSAx=${homeGoalieStats.gsax.toFixed(2)} SV%=${homeGoalieStats.sv_pct} GP=${homeGoalieStats.gp}`);

      // Parse book lines from DB
      const mktAwayPLOdds  = game.awaySpreadOdds ? parseInt(game.awaySpreadOdds, 10) : null;
      const mktHomePLOdds  = game.homeSpreadOdds ? parseInt(game.homeSpreadOdds, 10) : null;
      const mktTotal       = game.bookTotal ? parseFloat(String(game.bookTotal)) : null;
      const mktOverOdds    = game.overOdds ? parseInt(game.overOdds, 10) : null;
      const mktUnderOdds   = game.underOdds ? parseInt(game.underOdds, 10) : null;
      const mktAwayML      = game.awayML ? parseInt(game.awayML, 10) : null;
      const mktHomeML      = game.homeML ? parseInt(game.homeML, 10) : null;

      console.log(`[NhlModelSync]${tag}   Market lines: PL=${mktAwayPLOdds}/${mktHomePLOdds} Total=${mktTotal} (${mktOverOdds}/${mktUnderOdds}) ML=${mktAwayML}/${mktHomeML}`);

      // Compute real rest days from Hockey Reference schedule
      const restDays = await computeNhlRestDays(game.awayTeam, game.homeTeam, gameDate);
      console.log(`[NhlModelSync]${tag}   Rest days: away=${restDays.awayRestDays}d home=${restDays.homeRestDays}d`);

      // Build engine input
      const engineInput: NhlModelEngineInput = {
        away_team:                awayAbbrev,
        home_team:                homeAbbrev,
        away_abbrev:              awayAbbrev,
        home_abbrev:              homeAbbrev,
        away_goalie:              awayGoalieName,
        home_goalie:              homeGoalieName,
        away_goalie_gp:           awayGoalieStats.gp,
        home_goalie_gp:           homeGoalieStats.gp,
        away_goalie_gsax:         awayGoalieStats.gsax,
        home_goalie_gsax:         homeGoalieStats.gsax,
        // Shots faced (for workload/fatigue goalie multiplier)
        away_goalie_shots_faced:  awayGoalieStats.shots ?? undefined,
        home_goalie_shots_faced:  homeGoalieStats.shots ?? undefined,
        // Rest days from Hockey Reference schedule (back-to-back detection)
        away_rest_days:           restDays.awayRestDays,
        home_rest_days:           restDays.homeRestDays,
        mkt_puck_line:            1.5,
        // Book's signed spread for away team: +1.5 if home is the -1.5 favorite, -1.5 if away is the -1.5 favorite.
        // Used by Python engine to determine book_fav_is_home reliably (odds-based detection fails
        // when underdog's +1.5 odds are more negative than favorite's -1.5 odds).
        mkt_away_spread:          game.awayBookSpread != null ? parseFloat(String(game.awayBookSpread)) : null,
        mkt_away_pl_odds:         mktAwayPLOdds,
        mkt_home_pl_odds:         mktHomePLOdds,
        mkt_total:                mktTotal,
        mkt_over_odds:            mktOverOdds,
        mkt_under_odds:           mktUnderOdds,
        mkt_away_ml:              mktAwayML,
        mkt_home_ml:              mktHomeML,
        team_stats:               buildTeamStatsDict(awayAbbrev, homeAbbrev, teamStatsMap),
      };

      // Run the Python model
      const modelResult = await runNhlModelForGame(engineInput);

      if (!modelResult.ok) {
        console.error(`[NhlModelSync]${tag}   ✗ Model failed for ${gameLabel}: ${modelResult.error}`);
        result.errors.push(`Model failed for ${gameLabel}: ${modelResult.error}`);
        result.skipped++;
        continue;
      }

      // ── Extract edges from Python Sharp Edge Detection Engine ───────────────────────────
      // The Python model already implements the full Sharp Edge Detection spec:
      //   - Distribution-translated probabilities at market threshold
      //   - Vig removal (true no-vig market probabilities)
      //   - EV calculation, price edge, edge classification
      // We read the results directly instead of re-computing in TypeScript.

      // ── Market values from simulation distribution (NOT goal differential) ──
      // modelResult.away_puck_line / home_puck_line = "+1.5" / "-1.5" (or ±2.5)
      // derived from P(margin >= 2) and P(margin >= 3) in the simulation.
      // modelResult.total_line = mean of total distribution, rounded to nearest 0.5.
      // NEVER use proj_away_goals - proj_home_goals as the spread.
      const modelAwayPL  = modelResult.away_puck_line;   // e.g. "+1.5" or "-2.5"
      const modelHomePL  = modelResult.home_puck_line;   // e.g. "-1.5" or "+2.5"
      const modelTotalVal = modelResult.total_line;       // from simulation distribution

      // Find the best puck line edge from model output
      const plEdges = modelResult.edges.filter(e => e.type === "PUCK_LINE");
      const bestPLEdge = plEdges.sort((a, b) => b.edge_vs_be - a.edge_vs_be)[0] ?? null;

      let spreadEdge: string | null = null;
      let spreadDiff: string | null = null;

      if (bestPLEdge && bestPLEdge.classification !== "NO EDGE") {
        // Use the BOOK's puck line for the edge label — must mirror what DK actually offers.
        // e.g. if DK has STL +1.5 (away underdog), label must say "STL +1.5", not "STL -1.5".
        const fmtSpread = (v: number | string | null | undefined): string => {
          if (v == null) return "±1.5";
          const n = parseFloat(String(v));
          return isNaN(n) ? "±1.5" : (n >= 0 ? `+${n}` : String(n));
        };
        const bookAwayPLLabel = fmtSpread(game.awayBookSpread);
        const bookHomePLLabel = fmtSpread(game.homeBookSpread);
        const sideLabel = bestPLEdge.side.startsWith("AWAY")
          ? `${awayAbbrev} ${bookAwayPLLabel}`
          : `${homeAbbrev} ${bookHomePLLabel}`;
        spreadEdge = `${sideLabel} [${bestPLEdge.classification}]`;
        spreadDiff = String(bestPLEdge.edge_vs_be);  // probability edge in pp
      } else if (mktAwayPLOdds !== null) {
        // No edge but market odds exist — compute raw probability diff for display
        const awayPLCoverPct = modelResult.away_pl_cover_pct / 100;
        const mktAwayBreakEven = americanOddsToBreakEven(mktAwayPLOdds);
        if (mktAwayBreakEven !== null) {
          const diff = awayPLCoverPct - mktAwayBreakEven;
          spreadDiff = String(roundToHalf(diff * 100));  // in probability points
        }
      }

      // Find the best total edge from model output
      const totalEdges = modelResult.edges.filter(e => e.type === "TOTAL");
      const bestTotalEdge = totalEdges.sort((a, b) => b.edge_vs_be - a.edge_vs_be)[0] ?? null;

      let totalEdge: string | null = null;
      let totalDiff: string | null = null;

      if (bestTotalEdge && bestTotalEdge.classification !== "NO EDGE") {
        totalEdge = `${bestTotalEdge.side} [${bestTotalEdge.classification}]`;
        totalDiff = String(bestTotalEdge.edge_vs_be);
      } else if (mktTotal !== null) {
        // No edge but market total exists — compute raw diff between model and market line
        const diff = modelTotalVal - mktTotal;
        totalDiff = String(roundToHalf(diff));
        if (Math.abs(diff) >= 0.5) {
          totalEdge = diff > 0 ? `OVER ${roundToHalf(modelTotalVal)}` : `UNDER ${roundToHalf(modelTotalVal)}`;
        }
      }

      console.log(`[NhlModelSync]${tag}   Model result: Goals=${modelResult.proj_away_goals}/${modelResult.proj_home_goals} | PL=${modelAwayPL}/${modelHomePL} (edge=${spreadEdge ?? "NONE"}) | Total=${modelTotalVal} (edge=${totalEdge ?? "NONE"})`);
      console.log(`[NhlModelSync]${tag}   PL odds: ${modelResult.away_puck_line_odds}/${modelResult.home_puck_line_odds} | ML: ${modelResult.away_ml}/${modelResult.home_ml} | O/U odds: ${modelResult.over_odds}/${modelResult.under_odds}`);
      console.log(`[NhlModelSync]${tag}   Win%: away=${modelResult.away_win_pct}% home=${modelResult.home_win_pct}% | PL cover%: away=${modelResult.away_pl_cover_pct}% home=${modelResult.home_pl_cover_pct}%`);
      if (modelResult.edges.length > 0) {
        console.log(`[NhlModelSync]${tag}   Edges: ${modelResult.edges.map(e => `${e.type}:${e.side}(${e.classification}, EV=${e.ev?.toFixed(1)}%, edge=${e.edge_vs_be}pp)`).join(" | ")}`);
      } else {
        console.log(`[NhlModelSync]${tag}   Edges: none`);
      }

      // ── Write to DB ──────────────────────────────────────────────────────
      await db
        .update(games)
        .set({
          // Spread (puck line) — derived from simulation P(margin >= 2), NOT goal differential
          // modelAwayPL / modelHomePL are "+1.5"/"-1.5" (or "±2.5") from the Python engine
          awayModelSpread:     modelAwayPL,
          homeModelSpread:     modelHomePL,
          spreadEdge:          spreadEdge ?? undefined,
          spreadDiff:          spreadDiff ?? undefined,
          // Total
          modelTotal:          String(roundToHalf(modelTotalVal)),
          totalEdge:           totalEdge ?? undefined,
          totalDiff:           totalDiff ?? undefined,
          // Moneylines
          modelAwayML:         fmtML(modelResult.away_ml),
          modelHomeML:         fmtML(modelResult.home_ml),
          // Scores
          modelAwayScore:      String(modelResult.proj_away_goals),
          modelHomeScore:      String(modelResult.proj_home_goals),
          // Win/cover probabilities
          modelAwayWinPct:     String(modelResult.away_win_pct),
          modelHomeWinPct:     String(modelResult.home_win_pct),
          modelOverRate:       String(modelResult.over_pct),
          modelUnderRate:      String(modelResult.under_pct),
          modelAwayPLCoverPct: String(modelResult.away_pl_cover_pct),
          modelHomePLCoverPct: String(modelResult.home_pl_cover_pct),
          // Puck line spread for MODEL column must MIRROR the BOOK's spread (not model's own origination).
          // e.g. if book has STL +1.5 (away underdog), model must show +1.5 (not -1.5).
          // The model's fair odds for that side are mkt_pl_away_odds / mkt_pl_home_odds.
          // game.awayBookSpread is a decimal (e.g. 1.5 or -1.5); format as "+1.5" or "-1.5".
          modelAwayPuckLine:   game.awayBookSpread != null
            ? (parseFloat(String(game.awayBookSpread)) >= 0 ? `+${parseFloat(String(game.awayBookSpread))}` : String(parseFloat(String(game.awayBookSpread))))
            : modelResult.away_puck_line,
          modelHomePuckLine:   game.homeBookSpread != null
            ? (parseFloat(String(game.homeBookSpread)) >= 0 ? `+${parseFloat(String(game.homeBookSpread))}` : String(parseFloat(String(game.homeBookSpread))))
            : modelResult.home_puck_line,
          // Model fair odds AT the BOOK's ±1.5 puck line (for side-by-side display)
          // e.g. book shows +1.5 (-198), model shows +1.5 (-143) → edge detected
          modelAwayPLOdds:     fmtML(modelResult.mkt_pl_away_odds ?? modelResult.away_puck_line_odds),
          modelHomePLOdds:     fmtML(modelResult.mkt_pl_home_odds ?? modelResult.home_puck_line_odds),
          // Model fair odds AT the BOOK's total line (for side-by-side display)
          // e.g. book shows O/U 6.5 (-115/-105), model shows O/U 6.5 (+138/-138) → edge detected
          modelOverOdds:       fmtML(modelResult.mkt_total_over_odds ?? modelResult.over_odds),
          modelUnderOdds:      fmtML(modelResult.mkt_total_under_odds ?? modelResult.under_odds),
          // Goalie info
          awayGoalie:          awayGoalieName ?? undefined,
          homeGoalie:          homeGoalieName ?? undefined,
          awayGoalieConfirmed: awayGoalieInfo?.confirmed ?? false,
          homeGoalieConfirmed: homeGoalieInfo?.confirmed ?? false,
          // Metadata
          modelRunAt:          Date.now(),
          // Puck line odds (update from model if book odds not available)
          awaySpreadOdds:      game.awaySpreadOdds ?? fmtML(modelResult.away_puck_line_odds),
          homeSpreadOdds:      game.homeSpreadOdds ?? fmtML(modelResult.home_puck_line_odds),
          overOdds:            game.overOdds ?? fmtML(modelResult.over_odds),
          underOdds:           game.underOdds ?? fmtML(modelResult.under_odds),
        })
        .where(eq(games.id, game.id));

      console.log(`[NhlModelSync]${tag}   ✅ DB updated for game ID=${game.id} (${gameLabel})`);
      result.synced++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NhlModelSync]${tag}   ✗ Error processing ${gameLabel}: ${msg}`);
      result.errors.push(`${gameLabel}: ${msg}`);
      result.skipped++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[NhlModelSync]${tag} ✅ DONE — Synced: ${result.synced} | Skipped: ${result.skipped} | Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.warn(`[NhlModelSync]${tag} Errors:`, result.errors.join("; "));
  }
  console.log(`${"=".repeat(70)}\n`);

  // ── Auto-approve: publish all newly modeled NHL games immediately ───────────
  // Owner has approved the NHL model output — projections go live automatically.
  // This runs even if result.synced === 0 (idempotent: approves any still-pending games).
  try {
    const approved = await bulkApproveModels(gameDate, "NHL");
    if (approved > 0) {
      console.log(`[NhlModelSync]${tag} ✅ Auto-approved ${approved} NHL projection(s) for ${gameDate} — live on feed`);
    } else {
      console.log(`[NhlModelSync]${tag}   Auto-approve: 0 pending projections (all already published or no model data)`);
    }
  } catch (approveErr) {
    const msg = approveErr instanceof Error ? approveErr.message : String(approveErr);
    console.error(`[NhlModelSync]${tag} ⚠ Auto-approve failed: ${msg}`);
    result.errors.push(`Auto-approve failed: ${msg}`);
  }

  result.syncedAt = new Date().toISOString();
  lastSyncResult = result;
  return result;
}
// ─── Scheduler ───────────────────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startNhlModelSyncScheduler(): void {
  if (syncInterval) return;

  const THIRTY_MIN_MS = 30 * 60 * 1000;

  if (isWithinSyncWindow()) {
    console.log("[NhlModelSync] Within sync window — starting initial sync...");
    syncNhlModelForToday("auto").catch(err =>
      console.error("[NhlModelSync] Initial sync error:", err)
    );
  } else {
    console.log("[NhlModelSync] Outside sync window (9AM–9PM PST), skipping initial sync.");
  }

  syncInterval = setInterval(() => {
    if (isWithinSyncWindow()) {
      console.log("[NhlModelSync] Scheduled sync triggered...");
      syncNhlModelForToday("auto").catch(err =>
        console.error("[NhlModelSync] Scheduled sync error:", err)
      );
    } else {
      console.log("[NhlModelSync] Outside sync window (9AM–9PM PST), skipping scheduled sync.");
    }
  }, THIRTY_MIN_MS);

  console.log("[NhlModelSync] Scheduler started (every 30 min, 9AM–9PM PST).");
}

export function stopNhlModelSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[NhlModelSync] Scheduler stopped.");
  }
}

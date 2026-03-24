/**
 * mlbScoreRefresh.ts
 *
 * Fetches live MLB game scores, status, and pitcher info from the official
 * MLB Stats API (statsapi.mlb.com).  Runs on a 10-minute cron alongside the
 * VSiN splits and AN odds refreshes.
 *
 * ─── API endpoints ───────────────────────────────────────────────────────────
 *
 *   Schedule (today's games + basic linescore):
 *     https://statsapi.mlb.com/api/v1/schedule
 *       ?sportId=1
 *       &date=YYYY-MM-DD
 *       &hydrate=linescore,probablePitcher(note),decisions,broadcasts(all)
 *       &language=en
 *
 *   Response shape (per game):
 *     game.gamePk              — unique game ID (matches our mlbGamePk column)
 *     game.status.abstractGameState  — "Preview" | "Live" | "Final"
 *     game.status.detailedState      — "Scheduled" | "In Progress" | "Final" | "Postponed" etc.
 *     game.status.codedGameState     — "S" | "L" | "F" | "P" | "D" | "U"
 *     game.linescore.currentInning   — current inning number (int)
 *     game.linescore.inningHalf      — "Top" | "Bottom" | "Middle" | "End"
 *     game.linescore.teams.away.runs — away runs
 *     game.linescore.teams.home.runs — home runs
 *     game.teams.away.team.abbreviation — e.g. "NYY"
 *     game.teams.home.team.abbreviation — e.g. "SF"
 *     game.decisions.winner.fullName  — winning pitcher full name
 *     game.decisions.loser.fullName   — losing pitcher full name
 *     game.probablePitchers.away.fullName — probable away starter
 *     game.probablePitchers.home.fullName — probable home starter
 *
 * ─── Status mapping ──────────────────────────────────────────────────────────
 *   abstractGameState "Preview"  → DB gameStatus "upcoming"
 *   abstractGameState "Live"     → DB gameStatus "live"
 *   abstractGameState "Final"    → DB gameStatus "final"
 *   detailedState "Postponed"    → DB gameStatus "upcoming" (game not played)
 *   detailedState "Suspended"    → DB gameStatus "upcoming"
 *
 * ─── Game clock string ───────────────────────────────────────────────────────
 *   Live:  "Top 3rd" | "Bot 3rd" | "Mid 3rd" | "End 3rd"
 *   Final: "Final" | "Final/10" (extra innings)
 *   Upcoming: null
 *
 * ─── Team matching ───────────────────────────────────────────────────────────
 *   DB stores teams as MLB abbreviations (e.g. "NYY", "SF").
 *   We match by mlbGamePk (primary) or by awayTeam+homeTeam abbreviation (fallback).
 */

import { MLB_BY_ABBREV, MLB_BY_ID } from "../shared/mlbTeams";
import { listGamesByDate, updateNcaaStartTime, updateBookOdds } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

const MLB_STATS_API_BASE = "https://statsapi.mlb.com/api/v1";

const MLB_SCHEDULE_HYDRATE = [
  "linescore",
  "probablePitcher(note)",
  "decisions",
  "broadcasts(all)",
].join(",");

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.mlb.com/",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MlbLiveGame {
  /** MLB Stats API game PK — matches our mlbGamePk column */
  gamePk: number;
  /** Away team abbreviation as stored in DB (e.g. "NYY") */
  awayAbbrev: string;
  /** Home team abbreviation as stored in DB (e.g. "SF") */
  homeAbbrev: string;
  /** Away team runs (null if game not started) */
  awayRuns: number | null;
  /** Home team runs (null if game not started) */
  homeRuns: number | null;
  /**
   * Mapped DB game status:
   *   "upcoming" — not yet started (Preview, Scheduled, Postponed, Suspended, Warmup, Delayed)
   *   "live"     — in progress (Live, In Progress)
   *   "final"    — completed (Final, Game Over, Completed Early)
   */
  gameStatus: "upcoming" | "live" | "final";
  /**
   * Human-readable game clock string for display:
   *   Live:    "Top 3rd" | "Bot 3rd" | "Mid 3rd" | "End 3rd" | "Top 10th (Extra)" etc.
   *   Final:   "Final" | "Final/10" (extra innings suffix)
   *   Upcoming: null
   */
  gameClock: string | null;
  /** Probable away starting pitcher full name (e.g. "Gerrit Cole") — null if TBD */
  awayProbablePitcher: string | null;
  /** Probable home starting pitcher full name — null if TBD */
  homeProbablePitcher: string | null;
  /** Winning pitcher full name (only for final games) */
  winningPitcher: string | null;
  /** Losing pitcher full name (only for final games) */
  losingPitcher: string | null;
  /** Raw abstractGameState from MLB API: "Preview" | "Live" | "Final" */
  rawAbstractState: string;
  /** Raw detailedState from MLB API: "Scheduled" | "In Progress" | "Final" | "Postponed" etc. */
  rawDetailedState: string;
  /** Total innings played (for extra-inning detection) */
  totalInnings: number | null;
}

// ─── Raw API types ────────────────────────────────────────────────────────────

interface MlbApiTeamInfo {
  team: {
    id: number;
    name: string;
    // NOTE: 'abbreviation' is NOT returned by the schedule endpoint — only id/name/link.
    // Use MLB_BY_ID.get(team.id)?.abbrev for team resolution.
    abbreviation?: string;
  };
  score?: number;
  // probablePitcher is nested under teams.away/home in the schedule hydration
  probablePitcher?: MlbApiPitcher;
}

interface MlbApiLinescore {
  currentInning?: number;
  currentInningOrdinal?: string;
  inningHalf?: string;
  teams?: {
    away?: { runs?: number; hits?: number; errors?: number };
    home?: { runs?: number; hits?: number; errors?: number };
  };
  innings?: Array<{
    num: number;
    ordinalNum: string;
    away?: { runs?: number };
    home?: { runs?: number };
  }>;
}

interface MlbApiPitcher {
  id: number;
  fullName: string;
}

interface MlbApiGame {
  gamePk: number;
  status: {
    abstractGameState: string;
    detailedState: string;
    codedGameState: string;
    statusCode: string;
  };
  teams: {
    away: MlbApiTeamInfo;
    home: MlbApiTeamInfo;
  };
  linescore?: MlbApiLinescore;
  probablePitchers?: {
    away?: MlbApiPitcher;
    home?: MlbApiPitcher;
  };
  decisions?: {
    winner?: MlbApiPitcher;
    loser?: MlbApiPitcher;
    save?: MlbApiPitcher;
  };
}

interface MlbApiScheduleResponse {
  dates: Array<{
    date: string;
    games: MlbApiGame[];
  }>;
  totalGames?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps MLB API abstractGameState + detailedState to our DB gameStatus enum.
 *
 * Detailed mapping:
 *   abstractGameState="Preview"  → "upcoming"  (includes: Scheduled, Pre-Game, Warmup, Delayed Start)
 *   abstractGameState="Live"     → "live"       (includes: In Progress, Manager Challenge, Replay Review)
 *   abstractGameState="Final"    → "final"      (includes: Final, Game Over, Completed Early)
 *   detailedState="Postponed"    → "upcoming"   (override: game not played today)
 *   detailedState="Suspended"    → "upcoming"   (override: game suspended, not final)
 *   detailedState="Cancelled"    → "upcoming"   (override: treat as not played)
 */
function mapMlbStatus(
  abstractState: string,
  detailedState: string
): "upcoming" | "live" | "final" {
  // Explicit overrides for special states
  const detailedLower = detailedState.toLowerCase();
  if (
    detailedLower.includes("postponed") ||
    detailedLower.includes("suspended") ||
    detailedLower.includes("cancelled") ||
    detailedLower.includes("canceled")
  ) {
    return "upcoming";
  }

  switch (abstractState) {
    case "Live":
      return "live";
    case "Final":
      return "final";
    case "Preview":
    default:
      return "upcoming";
  }
}

/**
 * Builds a human-readable game clock string from the MLB linescore.
 *
 * Examples:
 *   Live, top of 3rd  → "Top 3rd"
 *   Live, bottom 7th  → "Bot 7th"
 *   Live, middle 3rd  → "Mid 3rd"  (between half-innings)
 *   Live, end of 9th  → "End 9th"
 *   Final, 9 innings  → "Final"
 *   Final, 12 innings → "Final/12"
 *   Upcoming          → null
 */
function buildMlbGameClock(
  status: "upcoming" | "live" | "final",
  linescore: MlbApiLinescore | undefined,
  totalInnings: number | null
): string | null {
  if (status === "upcoming") return null;

  if (status === "final") {
    if (totalInnings != null && totalInnings > 9) {
      return `Final/${totalInnings}`;
    }
    return "Final";
  }

  // Live game
  if (!linescore) return "Live";

  const inning = linescore.currentInningOrdinal ?? String(linescore.currentInning ?? "?");
  const half = linescore.inningHalf ?? "";

  if (half === "Top") return `Top ${inning}`;
  if (half === "Bottom") return `Bot ${inning}`;
  if (half === "Middle") return `Mid ${inning}`;
  if (half === "End") return `End ${inning}`;

  // Fallback: just show inning
  return `${inning}`;
}

/**
 * Counts the total number of innings played from the linescore innings array.
 * Returns null if no innings data is available.
 */
function countTotalInnings(linescore: MlbApiLinescore | undefined): number | null {
  if (!linescore?.innings || linescore.innings.length === 0) return null;
  return linescore.innings.length;
}

/**
 * Normalizes an MLB abbreviation from the Stats API to match our DB format.
 * The API uses "AZ" for Arizona Diamondbacks; we store "ARI".
 * The API uses "OAK" for Athletics; we store "ATH" (Sacramento).
 */
function normalizeAbbrev(apiAbbrev: string): string {
  const MAP: Record<string, string> = {
    AZ: "ARI",   // Diamondbacks: API uses AZ, we use ARI
    OAK: "ATH",  // Athletics: relocated to Sacramento, we use ATH
  };
  return MAP[apiAbbrev] ?? apiAbbrev;
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetches today's MLB games from the Stats API with full linescore hydration.
 *
 * @param dateStr - Date in YYYY-MM-DD format (ET/local date)
 * @returns Array of MlbLiveGame objects for all games on that date
 */
export async function fetchMlbLiveScores(dateStr: string): Promise<MlbLiveGame[]> {
  const url =
    `${MLB_STATS_API_BASE}/schedule` +
    `?sportId=1` +
    `&date=${dateStr}` +
    `&hydrate=${encodeURIComponent(MLB_SCHEDULE_HYDRATE)}` +
    `&language=en`;

  console.log(
    `[MLBScoreRefresh] ► Fetching MLB Stats API for ${dateStr}` +
    ` | URL: ${url}`
  );

  const fetchStart = Date.now();
  const resp = await fetch(url, { headers: FETCH_HEADERS });
  const fetchMs = Date.now() - fetchStart;

  if (!resp.ok) {
    throw new Error(
      `[MLBScoreRefresh] MLB Stats API returned HTTP ${resp.status} for ${dateStr} (${fetchMs}ms)`
    );
  }

  const data = (await resp.json()) as MlbApiScheduleResponse;
  const dateEntry = data.dates?.find((d) => d.date === dateStr);
  const apiGames: MlbApiGame[] = dateEntry?.games ?? [];

  console.log(
    `[MLBScoreRefresh] API response: ${apiGames.length} games for ${dateStr}` +
    ` (HTTP ${resp.status}, ${fetchMs}ms)`
  );

  const results: MlbLiveGame[] = [];
  let skippedUnknownTeam = 0;
  let skippedNoLinescore = 0;

  for (const g of apiGames) {
    // The schedule endpoint returns team.id + team.name but NOT team.abbreviation.
    // Resolve via MLB_BY_ID (keyed by MLB Stats API team ID, e.g. 147 = Yankees).
    const awayTeamId = g.teams.away.team.id;
    const homeTeamId = g.teams.home.team.id;
    const awayTeamEntry = MLB_BY_ID.get(awayTeamId);
    const homeTeamEntry = MLB_BY_ID.get(homeTeamId);

    // Fallback: if ID lookup fails, try abbreviation field (future-proofing)
    const rawAwayAbbrev = g.teams.away.team.abbreviation ?? awayTeamEntry?.abbrev ?? "";
    const rawHomeAbbrev = g.teams.home.team.abbreviation ?? homeTeamEntry?.abbrev ?? "";
    const awayAbbrev = awayTeamEntry?.abbrev ?? normalizeAbbrev(rawAwayAbbrev);
    const homeAbbrev = homeTeamEntry?.abbrev ?? normalizeAbbrev(rawHomeAbbrev);

    // Validate both teams are in our registry
    const awayTeam = awayTeamEntry ?? MLB_BY_ABBREV.get(awayAbbrev);
    const homeTeam = homeTeamEntry ?? MLB_BY_ABBREV.get(homeAbbrev);

    if (!awayTeam || !homeTeam) {
      console.warn(
        `[MLBScoreRefresh] SKIP gamePk=${g.gamePk}: unknown team(s)` +
        ` away: id=${awayTeamId} name="${g.teams.away.team.name}" abbrev="${awayAbbrev}" (${awayTeam ? "✓" : "✗"})` +
        ` home: id=${homeTeamId} name="${g.teams.home.team.name}" abbrev="${homeAbbrev}" (${homeTeam ? "✓" : "✗"})` +
        ` — add to MLB_TEAMS in mlbTeams.ts if this is a valid MLB team`
      );
      skippedUnknownTeam++;
      continue;
    }

    const abstractState = g.status.abstractGameState;
    const detailedState = g.status.detailedState;
    const gameStatus = mapMlbStatus(abstractState, detailedState);

    const linescore = g.linescore;
    const totalInnings = countTotalInnings(linescore);
    const gameClock = buildMlbGameClock(gameStatus, linescore, totalInnings);

    // Scores: only available once game has started
    const awayRuns =
      gameStatus !== "upcoming"
        ? (linescore?.teams?.away?.runs ?? g.teams.away.score ?? null)
        : null;
    const homeRuns =
      gameStatus !== "upcoming"
        ? (linescore?.teams?.home?.runs ?? g.teams.home.score ?? null)
        : null;

    // Pitchers
    // NOTE: The schedule endpoint hydrates probable pitchers under teams.away.probablePitcher,
    // NOT under a top-level probablePitchers field (that's only in the live game feed).
    const awayProbablePitcher =
      g.teams.away.probablePitcher?.fullName ?? g.probablePitchers?.away?.fullName ?? null;
    const homeProbablePitcher =
      g.teams.home.probablePitcher?.fullName ?? g.probablePitchers?.home?.fullName ?? null;
    const winningPitcher = g.decisions?.winner?.fullName ?? null;
    const losingPitcher = g.decisions?.loser?.fullName ?? null;

    const game: MlbLiveGame = {
      gamePk: g.gamePk,
      awayAbbrev,
      homeAbbrev,
      awayRuns,
      homeRuns,
      gameStatus,
      gameClock,
      awayProbablePitcher,
      homeProbablePitcher,
      winningPitcher,
      losingPitcher,
      rawAbstractState: abstractState,
      rawDetailedState: detailedState,
      totalInnings,
    };

    results.push(game);

    // Detailed per-game log
    const scoreStr =
      gameStatus === "upcoming"
        ? "not started"
        : `${awayRuns ?? "?"}-${homeRuns ?? "?"}`;
    const pitcherStr =
      gameStatus === "final" && winningPitcher
        ? ` | W: ${winningPitcher}, L: ${losingPitcher ?? "?"}`
        : awayProbablePitcher
        ? ` | SP: ${awayProbablePitcher} vs ${homeProbablePitcher ?? "TBD"}`
        : "";

    console.log(
      `[MLBScoreRefresh] gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
      ` | status=${gameStatus} (${abstractState}/${detailedState})` +
      ` | clock=${gameClock ?? "—"}` +
      ` | score=${scoreStr}` +
      pitcherStr
    );

    if (!linescore && gameStatus !== "upcoming") {
      console.warn(
        `[MLBScoreRefresh] WARNING: gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
        ` has status=${gameStatus} but NO linescore in API response`
      );
      skippedNoLinescore++;
    }
  }

  console.log(
    `[MLBScoreRefresh] ✅ Parsed ${results.length} games` +
    ` (${results.filter((g) => g.gameStatus === "live").length} live,` +
    ` ${results.filter((g) => g.gameStatus === "final").length} final,` +
    ` ${results.filter((g) => g.gameStatus === "upcoming").length} upcoming)` +
    ` | skipped: ${skippedUnknownTeam} unknown teams, ${skippedNoLinescore} no linescore`
  );

  return results;
}

// ─── DB Refresh ───────────────────────────────────────────────────────────────

/**
 * Fetches live MLB scores from the Stats API and updates the DB for today's games.
 *
 * Matching strategy (in priority order):
 *   1. mlbGamePk exact match (most reliable — gamePk is a stable unique ID)
 *   2. awayTeam + homeTeam abbreviation match (fallback for games without gamePk)
 *
 * Only updates rows where status or scores have actually changed to minimize
 * unnecessary DB writes.
 *
 * Also updates awayStartingPitcher / homeStartingPitcher when probable pitchers
 * are confirmed by the API.
 *
 * @param dateStr - Date in YYYY-MM-DD format (ET date)
 */
export async function refreshMlbScores(dateStr: string): Promise<{
  updated: number;
  unchanged: number;
  noMatch: number;
  errors: string[];
}> {
  const tag = `[MLBScoreRefresh][${dateStr}]`;
  console.log(`${tag} ════════════════════════════════════════════`);
  console.log(`${tag} Starting MLB score refresh for ${dateStr}`);

  let apiGames: MlbLiveGame[] = [];
  try {
    apiGames = await fetchMlbLiveScores(dateStr);
  } catch (err) {
    const msg = `${tag} ❌ API fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    return { updated: 0, unchanged: 0, noMatch: 0, errors: [msg] };
  }

  if (apiGames.length === 0) {
    console.log(`${tag} No MLB games from API — nothing to update`);
    return { updated: 0, unchanged: 0, noMatch: 0, errors: [] };
  }

  // Fetch all MLB games for this date from our DB
  const dbGames = await listGamesByDate(dateStr, "MLB");
  console.log(
    `${tag} DB has ${dbGames.length} MLB games for ${dateStr}` +
    ` | API returned ${apiGames.length} games`
  );

  // Build lookup maps for fast matching
  // Primary: mlbGamePk → DB game (requires mlbGamePk column to be populated)
  const dbByGamePk = new Map<number, (typeof dbGames)[0]>();
  const dbByTeams = new Map<string, (typeof dbGames)[0]>();
  for (const dbGame of dbGames) {
    if (dbGame.mlbGamePk) {
      dbByGamePk.set(Number(dbGame.mlbGamePk), dbGame);
    }
    dbByTeams.set(`${dbGame.awayTeam}@${dbGame.homeTeam}`, dbGame);
  }

  let updated = 0;
  let unchanged = 0;
  let noMatch = 0;
  const errors: string[] = [];

  for (const apiGame of apiGames) {
    try {
      // Match priority: gamePk → team abbreviations
      let dbGame = dbByGamePk.get(apiGame.gamePk);
      let matchMethod = "gamePk";

      if (!dbGame) {
        dbGame = dbByTeams.get(`${apiGame.awayAbbrev}@${apiGame.homeAbbrev}`);
        matchMethod = "teams";
      }

      if (!dbGame) {
        console.warn(
          `${tag} NO_MATCH: gamePk=${apiGame.gamePk} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
          ` | status=${apiGame.gameStatus} | score=${apiGame.awayRuns ?? "?"}-${apiGame.homeRuns ?? "?"}` +
          ` | DB has: [${dbGames.map((g) => `${g.awayTeam}@${g.homeTeam}`).join(", ")}]`
        );
        noMatch++;
        continue;
      }

      // Determine what has changed
      const statusChanged = dbGame.gameStatus !== apiGame.gameStatus;
      const scoresChanged =
        dbGame.awayScore !== apiGame.awayRuns ||
        dbGame.homeScore !== apiGame.homeRuns;
      const clockChanged = dbGame.gameClock !== apiGame.gameClock;

      // Check if pitcher info has changed (only update if API has data)
      const awayPitcherChanged =
        apiGame.awayProbablePitcher !== null &&
        dbGame.awayStartingPitcher !== apiGame.awayProbablePitcher;
      const homePitcherChanged =
        apiGame.homeProbablePitcher !== null &&
        dbGame.homeStartingPitcher !== apiGame.homeProbablePitcher;

      const hasChanges =
        statusChanged || scoresChanged || clockChanged ||
        awayPitcherChanged || homePitcherChanged;

      if (!hasChanges) {
        console.log(
          `${tag} UNCHANGED [${matchMethod}]: ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
          ` | status=${apiGame.gameStatus} score=${apiGame.awayRuns ?? "?"}-${apiGame.homeRuns ?? "?"}` +
          ` clock=${apiGame.gameClock ?? "—"}`
        );
        unchanged++;
        continue;
      }

      // Log what changed
      const changes: string[] = [];
      if (statusChanged) changes.push(`status: ${dbGame.gameStatus} → ${apiGame.gameStatus}`);
      if (scoresChanged) changes.push(`score: ${dbGame.awayScore ?? "?"}-${dbGame.homeScore ?? "?"} → ${apiGame.awayRuns ?? "?"}-${apiGame.homeRuns ?? "?"}`);
      if (clockChanged) changes.push(`clock: "${dbGame.gameClock ?? "—"}" → "${apiGame.gameClock ?? "—"}"`);
      if (awayPitcherChanged) changes.push(`awayPitcher: "${dbGame.awayStartingPitcher ?? "—"}" → "${apiGame.awayProbablePitcher}"`);
      if (homePitcherChanged) changes.push(`homePitcher: "${dbGame.homeStartingPitcher ?? "—"}" → "${apiGame.homeProbablePitcher}"`);

      console.log(
        `${tag} UPDATE [${matchMethod}]: ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
        ` (DB id=${dbGame.id}, gamePk=${apiGame.gamePk})` +
        ` | ${changes.join(" | ")}`
      );

      // Write to DB using the existing updateNcaaStartTime helper
      // (it updates gameStatus, awayScore, homeScore, gameClock — shared across all sports)
      await updateNcaaStartTime(dbGame.id, {
        startTimeEst: dbGame.startTimeEst,
        ncaaContestId: dbGame.ncaaContestId ?? String(apiGame.gamePk),
        gameStatus: apiGame.gameStatus,
        awayScore: apiGame.awayRuns,
        homeScore: apiGame.homeRuns,
        gameClock: apiGame.gameClock,
      });

      // Update pitcher info if changed
      if (awayPitcherChanged || homePitcherChanged) {
        const pitcherUpdate: Parameters<typeof updateBookOdds>[1] = {};
        if (awayPitcherChanged && apiGame.awayProbablePitcher) {
          pitcherUpdate.awayStartingPitcher = apiGame.awayProbablePitcher;
          pitcherUpdate.awayPitcherConfirmed = true;
        }
        if (homePitcherChanged && apiGame.homeProbablePitcher) {
          pitcherUpdate.homeStartingPitcher = apiGame.homeProbablePitcher;
          pitcherUpdate.homePitcherConfirmed = true;
        }
        await updateBookOdds(dbGame.id, pitcherUpdate);
      }

      updated++;
    } catch (err) {
      const msg =
        `${tag} ERROR updating gamePk=${apiGame.gamePk}` +
        ` ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}: ` +
        (err instanceof Error ? err.message : String(err));
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `${tag} ✅ DONE — updated=${updated} unchanged=${unchanged}` +
    ` noMatch=${noMatch} errors=${errors.length}` +
    ` | live=${apiGames.filter((g) => g.gameStatus === "live").length}` +
    ` final=${apiGames.filter((g) => g.gameStatus === "final").length}`
  );
  console.log(`${tag} ════════════════════════════════════════════`);

  return { updated, unchanged, noMatch, errors };
}

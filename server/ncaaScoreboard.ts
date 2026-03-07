/**
 * NCAA Scoreboard API scraper
 * Fetches game start times (in EST) from the NCAA GraphQL API.
 * No authentication required — public endpoint.
 *
 * Team resolution: NCAA seonames (hyphen format, e.g. "michigan-st") are
 * looked up directly in the 365-team registry (BY_NCAA_SLUG). If a seoname
 * is not in the registry, the team is not one of the 365 tracked teams and
 * will be filtered out downstream by VALID_DB_SLUGS.
 */

import { BY_NCAA_SLUG } from "../shared/ncaamTeams";

const NCAA_API = "https://sdataprod.ncaa.com/";
const GET_CONTESTS_SHA =
  "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";

export type NcaaGameStatus = 'upcoming' | 'live' | 'final';

export interface NcaaGame {
  /** NCAA contest ID — unique per game, used as dedup key */
  contestId: string;
  /** DB-style slug for away team, e.g. "ohio_state" ("tba" if unknown) */
  awaySeoname: string;
  /** DB-style slug for home team, e.g. "penn_state" ("tba" if unknown) */
  homeSeoname: string;
  /**
   * Start time in ET as "HH:MM", e.g. "19:30" (DST-aware).
   * "TBD" when no confirmed start time.
   * "00:00" means a real late-night West Coast game (9 PM PT = midnight ET) —
   * check `isMidnightGame` to assign it to the prior calendar day.
   */
  startTimeEst: string;
  /** Whether the start time is confirmed (not TBA) */
  hasStartTime: boolean;
  /** Unix epoch in seconds (UTC) */
  startTimeEpoch: number;
  /**
   * True when this is a real midnight ET game (e.g. Hawaii home games at 9 PM PT).
   * These games should be stored under the PRIOR calendar day.
   * Only set when hasStartTime=false but epoch resolves to 00:xx ET.
   */
  isMidnightGame: boolean;
  /**
   * Game status derived from NCAA API gameState field:
   * 'P' (pre) → 'upcoming', 'I' (in-progress) → 'live', 'F' (final) → 'final'
   */
  gameStatus: NcaaGameStatus;
  /** Away team current/final score (null when game hasn't started) */
  awayScore: number | null;
  /** Home team current/final score (null when game hasn't started) */
  homeScore: number | null;
  /**
   * Game clock string for live games, e.g. "15:07 1st", "HALF", "00:10 OT".
   * Built from contestClock + currentPeriod. Null for upcoming/final.
   */
  gameClock: string | null;
}

function toNcaaDate(yyyymmdd: string): string {
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${m}/${d}/${y}`;
}

/** Convert a Unix epoch (seconds) to "HH:MM" in Eastern Time (DST-aware). */
function epochToEt(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d); // e.g. "19:30"
}

/**
 * Convert an NCAA seoname (hyphen format) to a DB slug.
 * The 365-team registry (BY_NCAA_SLUG) is the sole source of truth.
 * If the seoname is not in the registry, the raw seoname is returned
 * (with hyphens replaced by underscores) — it will be filtered out
 * downstream by VALID_DB_SLUGS.
 */
function ncaaSlugToDb(seoname: string): string {
  const team = BY_NCAA_SLUG.get(seoname);
  if (team) return team.dbSlug;
  // Not in registry — return as-is (will be filtered by VALID_DB_SLUGS)
  return seoname.replace(/-/g, "_");
}

export async function fetchNcaaGames(dateYYYYMMDD: string): Promise<NcaaGame[]> {
  const contestDate = toNcaaDate(dateYYYYMMDD);
  const seasonYear = parseInt(dateYYYYMMDD.slice(0, 4)) - 1;

  const variables = { sportCode: "MBB", divisionId: 1, contestDate, seasonYear };
  const extensions = { persistedQuery: { version: 1, sha256Hash: GET_CONTESTS_SHA } };
  const url = `${NCAA_API}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Origin: "https://www.ncaa.com",
      Referer: "https://www.ncaa.com/",
      Accept: "application/json",
    },
  });

  if (!resp.ok) throw new Error(`NCAA API returned HTTP ${resp.status}`);

  const data = await resp.json();
  const contests: any[] = data?.data?.contests ?? [];

  const games: NcaaGame[] = [];
  for (const c of contests) {
    const away = c.teams?.find((t: any) => !t.isHome);
    const home = c.teams?.find((t: any) => t.isHome);
    if (!away || !home) continue;

    // Resolve start time:
    // - If hasStartTime=true: use the confirmed time directly.
    // - If hasStartTime=false but epoch resolves to 00:xx ET: this is a real
    //   late-night West Coast game (e.g. Hawaii 9 PM PT = midnight ET).
    //   Mark as isMidnightGame=true so the caller assigns it to the prior day.
    // - If hasStartTime=false and epoch is NOT midnight: TBD (placeholder epoch).
    let startTimeEst: string;
    let isMidnightGame = false;
    if (c.hasStartTime && c.startTime) {
      startTimeEst = c.startTime;
    } else if (c.startTimeEpoch) {
      const etTime = epochToEt(c.startTimeEpoch);
      const etHour = parseInt(etTime.split(":")[0] ?? "12", 10);
      if (etHour === 0 || etHour === 24) {
        // Midnight ET — real late-night West Coast game, not a TBD placeholder
        startTimeEst = "00:00";
        isMidnightGame = true;
      } else {
        // Non-midnight epoch with hasStartTime=false — treat as TBD
        startTimeEst = "TBD";
      }
    } else {
      startTimeEst = "TBD";
    }

    // Handle TBA teams — keep as "tba" slug
    const awaySeoname = away.seoname === "tba" ? "tba" : ncaaSlugToDb(away.seoname);
    const homeSeoname = home.seoname === "tba" ? "tba" : ncaaSlugToDb(home.seoname);

    // Map NCAA gameState to our status enum
    const gameStatus: NcaaGameStatus =
      c.gameState === 'F' ? 'final' :
      c.gameState === 'I' ? 'live' :
      'upcoming';

    // Extract scores (available for live and final games)
    const awayScore: number | null = (away.score !== null && away.score !== undefined) ? Number(away.score) : null;
    const homeScore: number | null = (home.score !== null && home.score !== undefined) ? Number(home.score) : null;

    // Build game clock string for live games: "MM:SS Period" e.g. "15:07 1st"
    let gameClock: string | null = null;
    if (gameStatus === 'live' && c.currentPeriod) {
      const period = String(c.currentPeriod);
      const clock = c.contestClock ? String(c.contestClock) : '';
      if (period === 'HALF') {
        gameClock = 'HALF';
      } else if (clock) {
        gameClock = `${clock} ${period}`;
      } else {
        gameClock = period;
      }
    }

    games.push({
      contestId: String(c.contestId),
      awaySeoname,
      homeSeoname,
      startTimeEst,
      hasStartTime: c.hasStartTime ?? false,
      startTimeEpoch: c.startTimeEpoch,
      isMidnightGame,
      gameStatus,
      awayScore,
      homeScore,
      gameClock,
    });
  }

  return games;
}

export function buildStartTimeMap(games: NcaaGame[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of games) {
    map.set(`${g.awaySeoname}@${g.homeSeoname}`, g.startTimeEst);
  }
  return map;
}

/**
 * Returns the set of matchup keys ("away@home") for midnight ET games.
 * These games belong on the PRIOR calendar day (e.g. Hawaii 9 PM PT = midnight ET).
 */
export function getMidnightGameKeys(games: NcaaGame[]): Set<string> {
  const keys = new Set<string>();
  for (const g of games) {
    if (g.isMidnightGame) keys.add(`${g.awaySeoname}@${g.homeSeoname}`);
  }
  return keys;
}

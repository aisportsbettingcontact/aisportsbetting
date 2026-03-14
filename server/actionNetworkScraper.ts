/**
 * actionNetworkScraper.ts
 *
 * Fetches DraftKings spread, O/U, and moneyline odds from the Action Network
 * v1 scoreboard API for NCAAB, NBA, and NHL.
 *
 * API endpoint:
 *   https://api.actionnetwork.com/web/v1/scoreboard/<league>
 *     ?bookIds=79
 *     &date=YYYYMMDD
 *
 * DraftKings book_id = 79
 *
 * Response structure per game:
 *   game.odds[] — array of book entries, one per book per period type
 *     { book_id: 79, type: "game",
 *       spread_away, spread_home,
 *       spread_away_line, spread_home_line,  ← American format (e.g. -110, -225)
 *       total, over, under,                  ← American format
 *       ml_away, ml_home }                   ← American format
 *
 *   game.teams[] — array of team objects with url_slug
 *   game.away_team_id, game.home_team_id — identify away/home teams
 *
 * Note: Opening lines are NOT available via the public AN API. The "Open"
 * column on the AN website requires authentication or a different internal
 * endpoint. Opening line fields are therefore not populated by this scraper.
 *
 * Supported sports:
 *   "ncaab" = NCAAB (College Basketball)
 *   "nba"   = NBA
 *   "nhl"   = NHL
 */

export type AnSport = "ncaab" | "nba" | "nhl";

export interface AnGameOdds {
  /** Action Network internal game ID */
  gameId: number;
  /** Away team full name, e.g. "Ohio State Buckeyes" */
  awayFullName: string;
  /** Away team abbreviation */
  awayAbbr: string;
  /** Away team url_slug from AN, e.g. "ohio-state-buckeyes" */
  awayUrlSlug: string;
  /** Home team full name */
  homeFullName: string;
  /** Home team abbreviation */
  homeAbbr: string;
  /** Home team url_slug from AN */
  homeUrlSlug: string;
  /** Game start time as ISO string */
  startTime: string;
  /** Game status: "scheduled" | "in-progress" | "final" */
  status: string;

  // ── Opening line ──────────────────────────────────────────────────────────
  // NOTE: Not available via public AN API — all null for now.
  openAwaySpread: null;
  openAwaySpreadOdds: null;
  openHomeSpread: null;
  openHomeSpreadOdds: null;
  openTotal: null;
  openOverOdds: null;
  openUnderOdds: null;
  openAwayML: null;
  openHomeML: null;

  // ── Current DraftKings line ────────────────────────────────────────────────
  /** Current DK away spread, e.g. 12.5 (positive = underdog) */
  dkAwaySpread: number | null;
  /** Current DK away spread juice in American format, e.g. "-110" or "-225" */
  dkAwaySpreadOdds: string | null;
  /** Current DK home spread, e.g. -12.5 */
  dkHomeSpread: number | null;
  /** Current DK home spread juice in American format */
  dkHomeSpreadOdds: string | null;
  /** Current DK total, e.g. 155.5 */
  dkTotal: number | null;
  /** Current DK over juice in American format, e.g. "-110" */
  dkOverOdds: string | null;
  /** Current DK under juice in American format, e.g. "-110" */
  dkUnderOdds: string | null;
  /** Current DK away moneyline in American format, e.g. "+650" */
  dkAwayML: string | null;
  /** Current DK home moneyline in American format, e.g. "-1000" */
  dkHomeML: string | null;
}

// ─── Raw API types ─────────────────────────────────────────────────────────────

interface AnTeam {
  id: number;
  full_name: string;
  display_name?: string;
  short_name?: string;
  location?: string;
  abbr: string;
  url_slug: string;
}

interface AnOddsEntry {
  book_id: number;
  type: string; // "game" | "firsthalf" | "secondhalf" | "live" | etc.
  ml_away: number | null;
  ml_home: number | null;
  spread_away: number | null;
  spread_home: number | null;
  spread_away_line: number | null;
  spread_home_line: number | null;
  total: number | null;
  over: number | null;
  under: number | null;
}

interface AnGame {
  id: number;
  status: string;
  real_status?: string;
  start_time: string;
  away_team_id: number;
  home_team_id: number;
  teams: AnTeam[];
  odds: AnOddsEntry[];
}

interface AnApiResponse {
  games: AnGame[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats an American odds integer as a signed string.
 * e.g. -110 → "-110", 650 → "+650"
 */
function fmtOdds(v: number | null | undefined): string | null {
  if (v == null || isNaN(v)) return null;
  return v > 0 ? `+${v}` : `${v}`;
}

/** Rounds to nearest 0.5 */
function roundHalf(v: number | null | undefined): number | null {
  if (v == null || isNaN(v)) return null;
  return Math.round(v * 2) / 2;
}

// ─── API constants ─────────────────────────────────────────────────────────────

const AN_BASE = "https://api.actionnetwork.com/web/v1/scoreboard";
const DK_BOOK_ID = 79; // DraftKings national

const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/",
  Origin: "https://www.actionnetwork.com",
};

// ─── Main scraper ──────────────────────────────────────────────────────────────

/**
 * Fetches Action Network DraftKings odds for a given sport and date.
 *
 * @param sport  - "ncaab", "nba", or "nhl"
 * @param date   - Date string in YYYY-MM-DD format (e.g. "2026-03-13")
 * @returns Array of AnGameOdds, one per game that has DK odds.
 */
export async function fetchActionNetworkOdds(
  sport: AnSport,
  date: string
): Promise<AnGameOdds[]> {
  // Convert YYYY-MM-DD → YYYYMMDD for the API
  const dateParam = date.replace(/-/g, "");

  const url = `${AN_BASE}/${sport}?bookIds=${DK_BOOK_ID}&date=${dateParam}`;

  console.log(`[ActionNetwork] Fetching ${sport.toUpperCase()} DK odds for ${date}...`);

  const resp = await fetch(url, { headers: AN_HEADERS });
  if (!resp.ok) {
    throw new Error(
      `[ActionNetwork] API request failed for ${sport} ${date}: HTTP ${resp.status}`
    );
  }

  const data = (await resp.json()) as AnApiResponse;
  const games = data?.games ?? [];

  console.log(
    `[ActionNetwork] ${sport.toUpperCase()} ${date}: ${games.length} games from API`
  );

  const results: AnGameOdds[] = [];

  for (const game of games) {
    // Find DK game-level odds entry
    const dk = game.odds?.find(
      o => o.book_id === DK_BOOK_ID && o.type === "game"
    );

    // Skip games without DK odds
    if (!dk) continue;

    // Build team map
    const teamMap = new Map<number, AnTeam>();
    for (const t of game.teams ?? []) {
      teamMap.set(t.id, t);
    }

    const awayTeam = teamMap.get(game.away_team_id);
    const homeTeam = teamMap.get(game.home_team_id);

    if (!awayTeam || !homeTeam) {
      console.warn(`[ActionNetwork] Skipping game ${game.id}: missing team data`);
      continue;
    }

    results.push({
      gameId: game.id,
      awayFullName: awayTeam.full_name,
      awayAbbr: awayTeam.abbr,
      awayUrlSlug: awayTeam.url_slug,
      homeFullName: homeTeam.full_name,
      homeAbbr: homeTeam.abbr,
      homeUrlSlug: homeTeam.url_slug,
      startTime: game.start_time,
      status: game.status,

      // Opening lines not available via public API
      openAwaySpread: null,
      openAwaySpreadOdds: null,
      openHomeSpread: null,
      openHomeSpreadOdds: null,
      openTotal: null,
      openOverOdds: null,
      openUnderOdds: null,
      openAwayML: null,
      openHomeML: null,

      // DraftKings current line
      dkAwaySpread: roundHalf(dk.spread_away),
      dkAwaySpreadOdds: fmtOdds(dk.spread_away_line),
      dkHomeSpread: roundHalf(dk.spread_home),
      dkHomeSpreadOdds: fmtOdds(dk.spread_home_line),
      dkTotal: roundHalf(dk.total),
      dkOverOdds: fmtOdds(dk.over),
      dkUnderOdds: fmtOdds(dk.under),
      dkAwayML: fmtOdds(dk.ml_away),
      dkHomeML: fmtOdds(dk.ml_home),
    });
  }

  console.log(
    `[ActionNetwork] ${sport.toUpperCase()} ${date}: ${results.length} games with DK odds`
  );

  return results;
}

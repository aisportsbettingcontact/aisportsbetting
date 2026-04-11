/**
 * mlbScheduleHistoryService.ts
 *
 * Fetches MLB game schedules and DraftKings NJ (book_id=68) odds from the
 * Action Network v1 scoreboard API, then upserts results into the
 * mlb_schedule_history table.
 *
 * ─── Data Source ─────────────────────────────────────────────────────────────
 *   API: https://api.actionnetwork.com/web/v1/scoreboard/mlb
 *   Book: DraftKings NJ (book_id=68) — SOLE odds source per user requirement
 *
 *   NOTE: v2 API returns HTTP 400 for all requests (platform-level issue).
 *         v1 API is fully operational and returns flat-field odds structure.
 *
 * ─── v1 DK NJ Flat-Field Schema ──────────────────────────────────────────────
 *   game.odds[] → find entry where book_id === 68
 *   dk.spread_away        → away run line (e.g. -1.5 or +1.5)
 *   dk.spread_home        → home run line (e.g. +1.5 or -1.5)
 *   dk.spread_away_line   → away run line odds (e.g. -140)
 *   dk.spread_home_line   → home run line odds (e.g. +120)
 *   dk.ml_away            → away moneyline (e.g. -255)
 *   dk.ml_home            → home moneyline (e.g. +215)
 *   dk.total              → game total (e.g. 7.5) — float, NOT a nested object
 *   dk.over               → over odds (e.g. -115)
 *   dk.under              → under odds (e.g. -105)
 *
 * ─── v1 Team Schema ──────────────────────────────────────────────────────────
 *   game.teams[]          → array, teams[0]=away, teams[1]=home
 *   team.abbr             → abbreviation (e.g. "ATL")
 *   team.url_slug         → slug (e.g. "atlanta-braves")
 *   team.full_name        → full name (e.g. "Atlanta Braves")
 *
 * ─── v1 Score Schema ─────────────────────────────────────────────────────────
 *   game.boxscore.total_away_points → final away score
 *   game.boxscore.total_home_points → final home score
 *
 * ─── Result Derivation ───────────────────────────────────────────────────────
 *   awayRunLineCovered  — awayScore + spread_away > homeScore
 *   homeRunLineCovered  — homeScore + spread_home > awayScore
 *   totalResult         — 'OVER' | 'UNDER' | 'PUSH' vs dk.total
 *   awayWon             — awayScore > homeScore
 *
 * ─── Refresh Cadence ─────────────────────────────────────────────────────────
 *   - Server startup: backfill last 30 days
 *   - Every 4 hours 6AM–midnight EST: refresh today + yesterday
 *   - Full historical backfill: 2023-03-30 → today (run once via tRPC)
 *
 * ─── Logging Standard ────────────────────────────────────────────────────────
 *   [MlbScheduleHistory][STEP] plain-English description
 *   Maximum granularity, zero noise, fully traceable
 */

import axios from "axios";
import { getDb } from "./db";
import {
  mlbScheduleHistory,
  type InsertMlbScheduleHistory,
  type MlbScheduleHistoryRow,
} from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG = "[MlbScheduleHistory]";
const AN_V1_BASE = "https://api.actionnetwork.com/web/v1/scoreboard/mlb";
const DK_NJ_BOOK_ID = 68;
const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/",
};

// ─── v1 API Types ─────────────────────────────────────────────────────────────

interface AnV1DkOdds {
  book_id: number;
  // Run Line (spread)
  spread_away?: number | null;
  spread_home?: number | null;
  spread_away_line?: number | null;
  spread_home_line?: number | null;
  // Moneyline
  ml_away?: number | null;
  ml_home?: number | null;
  // Total — NOTE: this is a float, NOT a nested object
  total?: number | null;
  over?: number | null;
  under?: number | null;
  // Inserted timestamp
  inserted?: string;
}

interface AnV1Team {
  id?: number;
  abbr?: string;
  short_name?: string;
  full_name?: string;
  url_slug?: string;
}

interface AnV1Boxscore {
  total_away_points?: number | null;
  total_home_points?: number | null;
}

interface AnV1Game {
  id: number;
  status: string;
  real_status?: string;
  start_time: string;
  away_team_id?: number;
  home_team_id?: number;
  teams: AnV1Team[];
  boxscore?: AnV1Boxscore;
  odds?: AnV1DkOdds[];
}

interface AnV1Response {
  games?: AnV1Game[];
}

export interface MlbScheduleRefreshResult {
  date: string;
  fetched: number;
  upserted: number;
  skipped: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an American odds number to a signed string.
 * e.g. 129 → "+129", -156 → "-156", null → null
 */
function fmtOdds(odds: number | null | undefined): string | null {
  if (odds == null) return null;
  const rounded = Math.round(odds);
  if (rounded >= 0) return `+${rounded}`;
  return String(rounded);
}

/**
 * Format a run line number to a signed string.
 * e.g. -1.5 → "-1.5", 1.5 → "+1.5"
 */
function fmtLine(line: number | null | undefined): string | null {
  if (line == null) return null;
  if (line >= 0) return `+${line}`;
  return String(line);
}

/**
 * Convert a UTC ISO date string to YYYY-MM-DD in EST (UTC-5 / UTC-4 DST).
 * Uses Intl.DateTimeFormat for correct DST handling.
 */
function utcToEstDate(utcIso: string): string {
  const d = new Date(utcIso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2");
}

/**
 * Format a Date object as YYYYMMDD for the AN API date parameter.
 */
export function formatAnDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Derive the run line cover result for the away team.
 *
 * Run line logic (MLB standard ±1.5):
 *   - away spread_away = -1.5 (favorite): away covers if awayScore - 1.5 > homeScore → must win by 2+
 *   - away spread_away = +1.5 (underdog):  away covers if awayScore + 1.5 > homeScore → can lose by 1
 *
 * Returns null if scores or run line are missing.
 */
function deriveAwayRunLineCovered(
  awayScore: number | null,
  homeScore: number | null,
  spreadAway: number | null
): boolean | null {
  if (awayScore == null || homeScore == null || spreadAway == null) return null;
  return awayScore + spreadAway > homeScore;
}

/**
 * Derive the total result (OVER / UNDER / PUSH) vs the DK NJ total.
 */
function deriveTotalResult(
  awayScore: number | null,
  homeScore: number | null,
  total: number | null
): "OVER" | "UNDER" | "PUSH" | null {
  if (awayScore == null || homeScore == null || total == null) return null;
  const combined = awayScore + homeScore;
  if (combined > total) return "OVER";
  if (combined < total) return "UNDER";
  return "PUSH";
}

// ─── Core Fetch Function ──────────────────────────────────────────────────────

/**
 * Fetch all MLB games for a single date from the AN v1 API (DK NJ book only).
 * Returns structured game data ready for DB upsert.
 *
 * @param dateStr - YYYYMMDD format (e.g. "20230330")
 */
export async function fetchMlbScheduleForDate(
  dateStr: string
): Promise<InsertMlbScheduleHistory[]> {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${dateStr}`;

  console.log(
    `${TAG}[FETCH] Requesting AN v1 API | date=${dateStr} | URL: ${url}`
  );

  let response: AnV1Response;
  try {
    const res = await axios.get<AnV1Response>(url, {
      headers: AN_HEADERS,
      timeout: 15_000,
    });
    response = res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${TAG}[FETCH] AN v1 API request FAILED for date=${dateStr}: ${msg}`
    );
    throw new Error(`AN v1 API fetch failed for date=${dateStr}: ${msg}`);
  }

  const games = response.games ?? [];
  console.log(
    `${TAG}[FETCH] AN v1 API returned ${games.length} games for date=${dateStr}`
  );

  if (games.length === 0) {
    console.log(`${TAG}[FETCH] No games for date=${dateStr} — off-day or pre/post-season`);
    return [];
  }

  const results: InsertMlbScheduleHistory[] = [];
  let skippedNoTeam = 0;
  let skippedNoDk = 0;
  let gamesWithFullOdds = 0;

  for (const game of games) {
    const teams = game.teams ?? [];

    // v1: teams[0] = away, teams[1] = home
    const awayTeam = teams[0];
    const homeTeam = teams[1];

    if (!awayTeam || !homeTeam) {
      console.warn(
        `${TAG}[SKIP] Game id=${game.id} — missing team data (teams.length=${teams.length})`
      );
      skippedNoTeam++;
      continue;
    }

    const awayAbbr = awayTeam.abbr ?? awayTeam.short_name ?? "???";
    const homeAbbr = homeTeam.abbr ?? homeTeam.short_name ?? "???";
    const awaySlug = awayTeam.url_slug ?? "";
    const homeSlug = homeTeam.url_slug ?? "";
    const gameLabel = `${awayAbbr} @ ${homeAbbr} (anId=${game.id})`;

    // ── Extract DK NJ odds (flat-field v1 schema) ─────────────────────────────
    const oddsList = game.odds ?? [];
    const dk = oddsList.find((o) => o.book_id === DK_NJ_BOOK_ID) ?? null;

    // Run Line
    const spreadAway = dk?.spread_away ?? null;
    const spreadHome = dk?.spread_home ?? null;
    const spreadAwayLine = dk?.spread_away_line ?? null;
    const spreadHomeLine = dk?.spread_home_line ?? null;

    // Moneyline
    const mlAway = dk?.ml_away ?? null;
    const mlHome = dk?.ml_home ?? null;

    // Total — NOTE: dk.total is a float (e.g. 7.5), NOT a nested object
    const totalLine = dk?.total ?? null;
    const overOdds = dk?.over ?? null;
    const underOdds = dk?.under ?? null;

    const hasDk = dk != null;
    const hasFullOdds = spreadAway != null && mlAway != null && totalLine != null;

    if (!hasDk) {
      skippedNoDk++;
      console.log(
        `${TAG}[ODDS] ${gameLabel} — No DK NJ entry in odds list (status=${game.status}), storing without odds`
      );
    } else if (!hasFullOdds) {
      console.log(
        `${TAG}[ODDS] ${gameLabel} — DK NJ partial odds: RL=${spreadAway ?? "—"} ML=${mlAway ?? "—"} TOT=${totalLine ?? "—"}`
      );
    } else {
      gamesWithFullOdds++;
    }

    // ── Extract final scores ──────────────────────────────────────────────────
    const bs = game.boxscore;
    const awayScore = bs?.total_away_points != null ? Number(bs.total_away_points) : null;
    const homeScore = bs?.total_home_points != null ? Number(bs.total_home_points) : null;
    const isComplete = game.status === "complete";

    // ── Derive result columns (only for complete games with scores) ───────────
    const awayRunLineCovered =
      isComplete ? deriveAwayRunLineCovered(awayScore, homeScore, spreadAway) : null;
    const homeRunLineCovered =
      isComplete && awayRunLineCovered != null ? !awayRunLineCovered : null;
    const totalResult =
      isComplete ? deriveTotalResult(awayScore, homeScore, totalLine) : null;
    const awayWon =
      isComplete && awayScore != null && homeScore != null
        ? awayScore > homeScore
        : null;

    // ── Determine game date in EST ────────────────────────────────────────────
    const gameDateEst = utcToEstDate(game.start_time);

    // ── Log this game ─────────────────────────────────────────────────────────
    console.log(
      `${TAG}[GAME] ${gameLabel}` +
      ` | date=${gameDateEst} status=${game.status}` +
      ` | score=${awayScore ?? "?"}–${homeScore ?? "?"}` +
      ` | RL=${fmtLine(spreadAway) ?? "—"}(${fmtOdds(spreadAwayLine) ?? "—"})` +
      ` ML=${fmtOdds(mlAway) ?? "—"}/${fmtOdds(mlHome) ?? "—"}` +
      ` TOT=${totalLine ?? "—"}(O:${fmtOdds(overOdds) ?? "—"} U:${fmtOdds(underOdds) ?? "—"})` +
      (isComplete
        ? ` | result: ${awayWon ? awayAbbr + " W" : homeAbbr + " W"}` +
          ` ATS=${awayRunLineCovered != null ? (awayRunLineCovered ? awayAbbr + " COV" : homeAbbr + " COV") : "—"}` +
          ` O/U=${totalResult ?? "—"}`
        : "")
    );

    results.push({
      anGameId: game.id,
      gameDate: gameDateEst,
      gameStatus: game.status,
      startTimeUtc: game.start_time,
      awaySlug,
      homeSlug,
      awayAbbr,
      homeAbbr,
      awayName: awayTeam.full_name ?? awayAbbr,
      homeName: homeTeam.full_name ?? homeAbbr,
      awayTeamId: awayTeam.id ?? 0,
      homeTeamId: homeTeam.id ?? 0,
      awayScore,
      homeScore,
      awayWon,
      // Run Line
      dkAwayRunLine: fmtLine(spreadAway),
      dkHomeRunLine: fmtLine(spreadHome),
      dkAwayRunLineOdds: fmtOdds(spreadAwayLine),
      dkHomeRunLineOdds: fmtOdds(spreadHomeLine),
      awayRunLineCovered,
      homeRunLineCovered,
      // Moneyline
      dkAwayML: fmtOdds(mlAway),
      dkHomeML: fmtOdds(mlHome),
      // Total
      dkTotal: totalLine != null ? String(totalLine) : null,
      dkOverOdds: fmtOdds(overOdds),
      dkUnderOdds: fmtOdds(underOdds),
      totalResult,
      lastRefreshedAt: Date.now(),
    });
  }

  console.log(
    `${TAG}[FETCH] date=${dateStr} processed ${games.length} games:` +
    ` ${results.length} valid | ${gamesWithFullOdds} with full odds` +
    ` | ${skippedNoDk} without DK odds | ${skippedNoTeam} skipped (no team data)`
  );

  return results;
}

// ─── Upsert Function ──────────────────────────────────────────────────────────

/**
 * Upsert a batch of MLB schedule history records into the DB.
 * Uses anGameId as the unique key — updates all fields on conflict.
 *
 * @param records - Array of InsertMlbScheduleHistory records to upsert
 * @returns Number of records upserted
 */
export async function upsertMlbScheduleHistory(
  records: InsertMlbScheduleHistory[]
): Promise<number> {
  if (records.length === 0) {
    console.log(`${TAG}[UPSERT] No records to upsert`);
    return 0;
  }

  console.log(`${TAG}[UPSERT] Upserting ${records.length} records into mlb_schedule_history`);

  const db = await getDb();

  // Upsert in batches of 50 to avoid query size limits
  const BATCH_SIZE = 50;
  let totalUpserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await db
      .insert(mlbScheduleHistory)
      .values(batch)
      .onDuplicateKeyUpdate({
        set: {
          gameStatus: sql`VALUES(game_status)`,
          awayScore: sql`VALUES(away_score)`,
          homeScore: sql`VALUES(home_score)`,
          awayWon: sql`VALUES(away_won)`,
          dkAwayRunLine: sql`VALUES(dk_away_run_line)`,
          dkHomeRunLine: sql`VALUES(dk_home_run_line)`,
          dkAwayRunLineOdds: sql`VALUES(dk_away_run_line_odds)`,
          dkHomeRunLineOdds: sql`VALUES(dk_home_run_line_odds)`,
          awayRunLineCovered: sql`VALUES(away_run_line_covered)`,
          homeRunLineCovered: sql`VALUES(home_run_line_covered)`,
          dkAwayML: sql`VALUES(dk_away_ml)`,
          dkHomeML: sql`VALUES(dk_home_ml)`,
          dkTotal: sql`VALUES(dk_total)`,
          dkOverOdds: sql`VALUES(dk_over_odds)`,
          dkUnderOdds: sql`VALUES(dk_under_odds)`,
          totalResult: sql`VALUES(total_result)`,
        },
      });
    totalUpserted += batch.length;
    console.log(
      `${TAG}[UPSERT] Batch ${Math.floor(i / BATCH_SIZE) + 1}: upserted ${batch.length} records (total so far: ${totalUpserted})`
    );
  }

  console.log(`${TAG}[UPSERT] Complete — ${totalUpserted} records upserted`);
  return totalUpserted;
}

// ─── Single-Date Refresh ──────────────────────────────────────────────────────

/**
 * Fetch and upsert MLB schedule history for a single date.
 * This is the atomic unit used by both the scheduler and the backfill.
 *
 * @param dateStr - YYYYMMDD format
 */
export async function refreshMlbScheduleForDate(
  dateStr: string
): Promise<MlbScheduleRefreshResult> {
  console.log(`${TAG}[REFRESH] Starting refresh for date=${dateStr}`);

  const errors: string[] = [];
  let fetched = 0;
  let upserted = 0;
  let skipped = 0;

  try {
    const records = await fetchMlbScheduleForDate(dateStr);
    fetched = records.length;

    if (records.length > 0) {
      upserted = await upsertMlbScheduleHistory(records);
    }

    console.log(
      `${TAG}[REFRESH] date=${dateStr} COMPLETE — fetched=${fetched} upserted=${upserted} skipped=${skipped}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG}[REFRESH] date=${dateStr} FAILED: ${msg}`);
    errors.push(msg);
  }

  return {
    date: dateStr,
    fetched,
    upserted,
    skipped,
    errors,
  };
}

// ─── Rolling Window Refresh ───────────────────────────────────────────────────

/**
 * Refresh MLB schedule history for the last N days.
 * Used by the daily scheduler to keep recent data current.
 *
 * @param days - Number of days to backfill (default: 7)
 * @param delayMs - Delay between API calls in ms (default: 400ms to avoid rate limiting)
 */
export async function refreshMlbScheduleLastNDays(
  days = 7,
  delayMs = 400
): Promise<MlbScheduleRefreshResult[]> {
  console.log(
    `${TAG}[ROLLING] Starting rolling refresh for last ${days} days`
  );

  const results: MlbScheduleRefreshResult[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = formatAnDate(date);

    const result = await refreshMlbScheduleForDate(dateStr);
    results.push(result);

    if (i < days - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  console.log(
    `${TAG}[ROLLING] Complete — ${days} days processed` +
    ` | totalFetched=${totalFetched} totalUpserted=${totalUpserted} errors=${totalErrors}`
  );

  return results;
}

// ─── Full Historical Backfill ─────────────────────────────────────────────────

/**
 * Backfill MLB schedule history for a full date range.
 *
 * Phase 1 (full DK NJ odds): 2023-03-30 → today
 *   - Run line, moneyline, total available for every game
 *
 * Skips spring training (pre-season games have no DK NJ odds).
 * Skips All-Star break dates automatically (API returns 0 games).
 *
 * @param startDate - Start date string "YYYY-MM-DD" (default: "2023-03-30")
 * @param endDate   - End date string "YYYY-MM-DD" (default: today)
 * @param delayMs   - Delay between API calls in ms (default: 400ms)
 * @param onProgress - Optional callback for progress updates
 */
export async function backfillMlbScheduleHistory(
  startDate = "2023-03-30",
  endDate?: string,
  delayMs = 400,
  onProgress?: (progress: {
    current: number;
    total: number;
    date: string;
    fetched: number;
    upserted: number;
    errors: number;
  }) => void
): Promise<{
  totalDates: number;
  totalFetched: number;
  totalUpserted: number;
  totalErrors: number;
  dateResults: MlbScheduleRefreshResult[];
}> {
  const start = new Date(startDate + "T00:00:00Z");
  const end = endDate ? new Date(endDate + "T00:00:00Z") : new Date();

  console.log(
    `${TAG}[BACKFILL] ═══════════════════════════════════════════════════════`
  );
  console.log(
    `${TAG}[BACKFILL] Starting full historical backfill`
  );
  console.log(
    `${TAG}[BACKFILL] Date range: ${startDate} → ${endDate ?? "today"}`
  );

  // Build list of all dates in range
  const allDates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    allDates.push(formatAnDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log(
    `${TAG}[BACKFILL] Total dates to process: ${allDates.length}`
  );
  console.log(
    `${TAG}[BACKFILL] Estimated time at ${delayMs}ms delay: ~${Math.ceil(allDates.length * delayMs / 60000)} minutes`
  );
  console.log(
    `${TAG}[BACKFILL] ═══════════════════════════════════════════════════════`
  );

  const dateResults: MlbScheduleRefreshResult[] = [];
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let datesWithGames = 0;
  let datesWithOdds = 0;

  for (let i = 0; i < allDates.length; i++) {
    const dateStr = allDates[i];
    const dateLabel = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

    console.log(
      `${TAG}[BACKFILL] [${i + 1}/${allDates.length}] Processing date=${dateLabel}`
    );

    const result = await refreshMlbScheduleForDate(dateStr);
    dateResults.push(result);

    totalFetched += result.fetched;
    totalUpserted += result.upserted;
    totalErrors += result.errors.length;
    if (result.fetched > 0) datesWithGames++;
    if (result.upserted > 0) datesWithOdds++;

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: allDates.length,
        date: dateLabel,
        fetched: totalFetched,
        upserted: totalUpserted,
        errors: totalErrors,
      });
    }

    // Log milestone summaries every 50 dates
    if ((i + 1) % 50 === 0 || i === allDates.length - 1) {
      console.log(
        `${TAG}[BACKFILL] ── Milestone [${i + 1}/${allDates.length}] ──` +
        ` totalFetched=${totalFetched} totalUpserted=${totalUpserted}` +
        ` datesWithGames=${datesWithGames} errors=${totalErrors}`
      );
    }

    // Delay between requests to avoid rate limiting
    if (i < allDates.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(
    `${TAG}[BACKFILL] ═══════════════════════════════════════════════════════`
  );
  console.log(`${TAG}[BACKFILL] COMPLETE`);
  console.log(`${TAG}[BACKFILL] Total dates processed: ${allDates.length}`);
  console.log(`${TAG}[BACKFILL] Dates with games: ${datesWithGames}`);
  console.log(`${TAG}[BACKFILL] Dates with upserted records: ${datesWithOdds}`);
  console.log(`${TAG}[BACKFILL] Total games fetched: ${totalFetched}`);
  console.log(`${TAG}[BACKFILL] Total records upserted: ${totalUpserted}`);
  console.log(`${TAG}[BACKFILL] Total errors: ${totalErrors}`);
  console.log(
    `${TAG}[BACKFILL] ═══════════════════════════════════════════════════════`
  );

  return {
    totalDates: allDates.length,
    totalFetched,
    totalUpserted,
    totalErrors,
    dateResults,
  };
}

// ─── Query Functions ──────────────────────────────────────────────────────────

/**
 * Get the last N completed games for a team from the schedule history DB.
 * Returns games where the team was either the away or home team.
 * Sorted by gameDate DESC (most recent first).
 *
 * @param teamSlug - AN url_slug, e.g. "arizona-diamondbacks"
 * @param limit    - Number of games to return (default: 5 for Last 5 panel)
 */
export async function getLastNGamesForTeam(
  teamSlug: string,
  limit = 5
) {
  console.log(
    `${TAG}[QUERY] Fetching last ${limit} completed games for team slug="${teamSlug}"`
  );

  const db = await getDb();
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.gameStatus, "complete"))
    .orderBy(mlbScheduleHistory.gameDate)
    .limit(500);

  // Filter to games involving this team, sort most recent first
  const teamGames = (rows as MlbScheduleHistoryRow[])
    .filter((r) => r.awaySlug === teamSlug || r.homeSlug === teamSlug)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
    .slice(0, limit);

  console.log(
    `${TAG}[QUERY] Found ${teamGames.length} completed games for team="${teamSlug}"` +
    ` (searched ${rows.length} total complete games)`
  );

  return teamGames;
}

/**
 * Get the full schedule for a team (all games, any status).
 * Returns games sorted by gameDate DESC (most recent first).
 *
 * @param teamSlug - AN url_slug, e.g. "arizona-diamondbacks"
 */
export async function getFullScheduleForTeam(teamSlug: string) {
  console.log(
    `${TAG}[QUERY] Fetching full schedule for team slug="${teamSlug}"`
  );

  const db = await getDb();
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .orderBy(mlbScheduleHistory.gameDate)
    .limit(1000);

  const teamGames = (rows as MlbScheduleHistoryRow[])
    .filter((r) => r.awaySlug === teamSlug || r.homeSlug === teamSlug)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate));

  console.log(
    `${TAG}[QUERY] Found ${teamGames.length} total games for team="${teamSlug}"`
  );

  return teamGames;
}

/**
 * Get last 5 completed games for both teams in a matchup.
 * Used to power the Last 5 Games panel on each matchup card.
 *
 * @param awaySlug - AN url_slug for the away team
 * @param homeSlug - AN url_slug for the home team
 */
export async function getLast5ForMatchup(awaySlug: string, homeSlug: string) {
  console.log(
    `${TAG}[QUERY] Fetching Last 5 for matchup: away="${awaySlug}" vs home="${homeSlug}"`
  );

  const [awayLast5, homeLast5] = await Promise.all([
    getLastNGamesForTeam(awaySlug, 5),
    getLastNGamesForTeam(homeSlug, 5),
  ]);

  console.log(
    `${TAG}[QUERY] Last 5 results — away="${awaySlug}": ${awayLast5.length} games` +
    ` | home="${homeSlug}": ${homeLast5.length} games`
  );

  return { awayLast5, homeLast5 };
}

/**
 * Compute situational records for an MLB team from their schedule history.
 * Used to power the Situational Results panel (Overall, Last 10, Home/Away, Fav/Dog).
 *
 * Tabs:
 *   Moneyline → win/loss records
 *   Spread    → run line ATS records
 *   Total     → over/under records
 *
 * @param teamSlug - AN url_slug, e.g. "arizona-diamondbacks"
 * @param limit    - Max games to analyze (default: 162 = full MLB season)
 */
export async function getMlbSituationalStats(teamSlug: string, limit = 162) {
  console.log(
    `${TAG}[SITUATIONAL] Computing situational stats for team="${teamSlug}" limit=${limit}`
  );

  const db = await getDb();
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.gameStatus, "complete"))
    .orderBy(mlbScheduleHistory.gameDate)
    .limit(1000);

  const teamGames = (rows as MlbScheduleHistoryRow[])
    .filter((r) => r.awaySlug === teamSlug || r.homeSlug === teamSlug)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
    .slice(0, limit);

  const isAway = (g: MlbScheduleHistoryRow) => g.awaySlug === teamSlug;

  const teamWon = (g: MlbScheduleHistoryRow): boolean | null => {
    if (g.awayWon == null) return null;
    return isAway(g) ? g.awayWon : !g.awayWon;
  };

  const teamCovered = (g: MlbScheduleHistoryRow): boolean | null => {
    if (isAway(g)) return g.awayRunLineCovered ?? null;
    return g.homeRunLineCovered ?? null;
  };

  const wasFavorite = (g: MlbScheduleHistoryRow): boolean => {
    const ml = isAway(g) ? g.dkAwayML : g.dkHomeML;
    if (!ml) return false;
    return parseInt(ml, 10) < 0;
  };

  const wasHome = (g: MlbScheduleHistoryRow): boolean => !isAway(g);

  const computeRecord = (
    games: MlbScheduleHistoryRow[],
    wonFn: (g: MlbScheduleHistoryRow) => boolean | null
  ) => {
    let w = 0, l = 0;
    for (const g of games) {
      const won = wonFn(g);
      if (won === true) w++;
      else if (won === false) l++;
    }
    return { w, l };
  };

  const computeAtsRecord = (games: MlbScheduleHistoryRow[]) => {
    let w = 0, l = 0;
    for (const g of games) {
      const cov = teamCovered(g);
      if (cov === true) w++;
      else if (cov === false) l++;
    }
    return { w, l };
  };

  const computeOuRecord = (games: MlbScheduleHistoryRow[]) => {
    let over = 0, under = 0, push = 0;
    for (const g of games) {
      if (g.totalResult === "OVER") over++;
      else if (g.totalResult === "UNDER") under++;
      else if (g.totalResult === "PUSH") push++;
    }
    return { over, under, push };
  };

  const last10 = teamGames.slice(0, 10);
  const homeGames = teamGames.filter(wasHome);
  const awayGames = teamGames.filter((g) => !wasHome(g));
  const favGames = teamGames.filter(wasFavorite);
  const dogGames = teamGames.filter((g) => !wasFavorite(g));

  const stats = {
    ml: {
      overall: computeRecord(teamGames, teamWon),
      last10: computeRecord(last10, teamWon),
      home: computeRecord(homeGames, teamWon),
      away: computeRecord(awayGames, teamWon),
      favorite: computeRecord(favGames, teamWon),
      underdog: computeRecord(dogGames, teamWon),
    },
    spread: {
      overall: computeAtsRecord(teamGames),
      last10: computeAtsRecord(last10),
      home: computeAtsRecord(homeGames),
      away: computeAtsRecord(awayGames),
      favorite: computeAtsRecord(favGames),
      underdog: computeAtsRecord(dogGames),
    },
    total: {
      overall: computeOuRecord(teamGames),
      last10: computeOuRecord(last10),
      home: computeOuRecord(homeGames),
      away: computeOuRecord(awayGames),
      favorite: computeOuRecord(favGames),
      underdog: computeOuRecord(dogGames),
    },
    gamesAnalyzed: teamGames.length,
  };

  console.log(
    `${TAG}[SITUATIONAL] team="${teamSlug}" analyzed=${teamGames.length} games` +
    ` | ML overall=${stats.ml.overall.w}-${stats.ml.overall.l}` +
    ` | ATS overall=${stats.spread.overall.w}-${stats.spread.overall.l}` +
    ` | O/U overall=${stats.total.overall.over}-${stats.total.overall.under}`
  );

  return stats;
}

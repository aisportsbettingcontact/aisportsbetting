/**
 * vsinAutoRefresh.ts
 *
 * Schedules a background job that runs every 30 minutes from 6am–midnight PST.
 *
 * On each tick it:
 *   1. Scrapes the VSiN CBB (NCAAM) betting splits page and upserts every game.
 *   2. Scrapes the VSiN NBA betting splits page and upserts every NBA game.
 *   3. Fetches ALL NCAA DI MBB games for a rolling 7-day window and inserts
 *      any that are not already in the DB (NCAA-only games without VSiN odds).
 *   4. Fetches NBA schedule for a rolling 7-day window and inserts any NBA games
 *      not already in the DB (NBA-only games without VSiN odds).
 *
 * The last refresh result is stored in memory and exposed via
 * `trpc.games.lastRefresh` so the UI can show "Last updated HH:MM".
 */

import { listGamesByDate, updateBookOdds, insertGames, getGameByNcaaContestId, updateNcaaStartTime, updateAnOdds, insertOddsHistory, advanceBracketWinner } from "./db";
import { fetchActionNetworkOdds, type AnSport } from "./actionNetworkScraper";
import { scrapeVsinBettingSplits, scrapeVsinBettingSplitsBothDays, scrapeVsinMlbBettingSplits, type VsinSplitsGame } from "./vsinBettingSplitsScraper";
import { fetchNcaaGames, buildStartTimeMap } from "./ncaaScoreboard";
import { fetchNbaGamesForDate, buildNbaStartTimeMap, fetchNbaLiveScores } from "./nbaScoreboard";
import { fetchNhlGamesForRange, buildNhlStartTimeMap, buildNhlGameMap, fetchNhlLiveScores, type NhlScheduleGame } from "./nhlSchedule";
import { VALID_DB_SLUGS, BY_DB_SLUG, BY_VSIN_SLUG, BY_AN_SLUG as NCAAM_BY_AN, getTeamByAnSlug as getNcaamTeamByAnSlug } from "../shared/ncaamTeams";
import { NBA_VALID_DB_SLUGS, NBA_BY_VSIN_SLUG, NBA_BY_AN_SLUG, getNbaTeamByVsinSlug, NBA_BY_DB_SLUG } from "../shared/nbaTeams";
import { NHL_VALID_DB_SLUGS, NHL_BY_ABBREV, NHL_BY_DB_SLUG, NHL_BY_VSIN_SLUG, NHL_BY_AN_SLUG, getNhlTeamByAnSlug, VSIN_NHL_HREF_ALIASES } from "../shared/nhlTeams";
import { MLB_BY_ABBREV, MLB_BY_VSIN_SLUG, MLB_VALID_ABBREVS, getMlbTeamByAnSlug, getMlbTeamByVsinSlug, VSIN_MLB_HREF_ALIASES } from "../shared/mlbTeams";
import type { InsertGame } from "../drizzle/schema";

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes — all sports refresh cadence

// ─── NCAAM Final Four lock: only Illinois, Connecticut, Michigan, Arizona on 04/04/2026 ───
// After the tournament ends, NCAAM splits are disabled entirely.
const FINAL_FOUR_DATE = "2026-04-04";
const NATIONAL_CHAMPIONSHIP_DATE = "2026-04-06";
const FINAL_FOUR_SLUGS = new Set(["illinois", "connecticut", "michigan", "arizona"]);

// Rolling window: today through N days ahead
const RANGE_DAYS_AHEAD = 6; // fetch today + 6 more days = 7-day window

/**
 * Resolve a raw VSiN NHL href slug to an NhlTeam entry.
 * Applies VSIN_NHL_HREF_ALIASES FIRST (e.g. "ny-islanders" → "new-york-islanders")
 * before looking up in NHL_BY_VSIN_SLUG.
 *
 * This is the ONLY place NHL VSiN slug resolution should happen in this file.
 * Adding aliases to VSIN_NHL_HREF_ALIASES in shared/nhlTeams.ts is all that’s
 * ever needed to fix future VSiN slug mismatches.
 */
function resolveNhlVsinSlug(rawSlug: string) {
  const canonical = VSIN_NHL_HREF_ALIASES[rawSlug] ?? rawSlug;
  const team = NHL_BY_VSIN_SLUG.get(canonical);
  if (!team) {
    console.warn(
      `[VSiNAutoRefresh][NHL] resolveNhlVsinSlug: unknown slug "${rawSlug}"` +
      (canonical !== rawSlug ? ` (aliased from "${rawSlug}" → "${canonical}")` : "") +
      " — game will be skipped. Add to VSIN_NHL_HREF_ALIASES if this is a known alias."
    );
  } else if (canonical !== rawSlug) {
    console.log(`[VSiNAutoRefresh][NHL] resolveNhlVsinSlug: alias resolved "${rawSlug}" → "${canonical}" → dbSlug="${team.dbSlug}"`);
  }
  return team;
}

export interface RefreshResult {
  refreshedAt: string;       // ISO timestamp of last VSiN odds/splits refresh
  scoresRefreshedAt: string; // ISO timestamp of last score refresh (NCAAM + NBA)
  updated: number;           // NCAAM games matched + updated (VSiN)
  inserted: number;          // new NCAAM games inserted (VSiN stubs)
  ncaaInserted: number;      // new NCAA-only games inserted
  nbaUpdated: number;        // NBA games matched + updated (VSiN)
  nbaInserted: number;       // new NBA games inserted (VSiN stubs)
  nbaScheduleInserted: number; // new NBA-only games inserted from schedule
  total: number;             // total NCAAM VSiN games processed
  nbaTotal: number;          // total NBA VSiN games processed
  nhlUpdated: number;        // NHL games matched + updated (VSiN)
  nhlInserted: number;       // new NHL games inserted (VSiN stubs)
  nhlScheduleInserted: number; // new NHL-only games inserted from schedule
  nhlTotal: number;          // total NHL VSiN games processed
  gameDate: string;          // today YYYY-MM-DD (PST)
}

let lastRefreshResult: RefreshResult | null = null;
let lastScoresRefreshedAt: string = new Date().toISOString();

export function getLastRefreshResult(): RefreshResult | null {
  return lastRefreshResult;
}

/**
 * Returns true if two team slugs refer to the same team.
 * Uses the registry as the canonical source.
 */
function slugsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const teamA = BY_DB_SLUG.get(na);
  const teamB = BY_DB_SLUG.get(nb);
  if (teamA && teamB) return teamA.dbSlug === teamB.dbSlug;
  return false;
}

/** Returns true if the current moment is inside 3am–midnight Pacific Time. */
function isWithinActiveHours(): boolean {
  // Active window: 14:01 UTC through 04:59 UTC next day (6:01 AM – 11:59 PM EST)
  // UTC hours 14–23 = 6 AM–5 PM EST (same day)
  // UTC hours 0–4   = 7 PM–11:59 PM EST (next UTC day, still same EST day)
  // Minute-level precision: starts at 14:01 UTC, ends at 04:59 UTC
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  // 14:01 UTC → utcHour=14, utcMinute>=1
  // 04:59 UTC → utcHour=4, utcMinute<=59
  const afterStart = utcHour > 14 || (utcHour === 14 && utcMinute >= 1);
  const beforeEnd  = utcHour < 4  || (utcHour === 4  && utcMinute <= 59);
  return afterStart || beforeEnd;
}

/** Returns a date string as YYYY-MM-DD in Pacific Time. */
function datePst(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const str = now.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const [mm, dd, yyyy] = str.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert YYYYMMDD string to YYYY-MM-DD */
function yyyymmddToIso(s: string): string {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Generate all dates in a range [start, end] inclusive as YYYY-MM-DD strings */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T00:00:00Z");
  while (cur <= endDate) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Action Network odds are now ingested exclusively via the ingestAnHtml tRPC procedure
// (paste AN HTML from actionnetwork.com/ncaab/odds?oddsType=combined etc.)
// VSiN is used only for betting splits.

// ─── Tomorrow's VSiN splits pre-population ──────────────────────────────────

/**
 * Fetches tomorrow's VSiN betting splits and applies them to tomorrow's games.
 * This pre-populates splits for games that already exist in the DB for tomorrow.
 * Non-fatal — errors are caught and logged.
 */
async function runTomorrowSplitsUpdate(tomorrowStr: string): Promise<void> {
  try {
    const allSplits = await scrapeVsinBettingSplits("tomorrow");
    console.log(`[VSiNAutoRefresh][Tomorrow] ${allSplits.length} total splits games`);

    // Process NCAAM (CBB) — Final Four + Championship only (04/04 and 04/06)
    const cbbSplits = allSplits.filter(g => g.sport === "CBB");
    if (cbbSplits.length > 0) {
      // Only process tomorrow's NCAAM splits if tomorrow is a Final Four or Championship date
      const isTomorrowRelevant = tomorrowStr === FINAL_FOUR_DATE || tomorrowStr === NATIONAL_CHAMPIONSHIP_DATE;
      if (!isTomorrowRelevant) {
        console.log(`[VSiNAutoRefresh][Tomorrow][NCAAM] ${tomorrowStr} is not a Final Four/Championship date — skipping NCAAM splits.`);
      } else {
      const existingNcaam = await listGamesByDate(tomorrowStr, "NCAAM");
      let updated = 0;
      for (const g of cbbSplits) {
        const awayTeam = BY_VSIN_SLUG.get(g.awayVsinSlug) ?? BY_VSIN_SLUG.get(g.awayVsinSlug.replace(/-/g, '_'));
        const homeTeam = BY_VSIN_SLUG.get(g.homeVsinSlug) ?? BY_VSIN_SLUG.get(g.homeVsinSlug.replace(/-/g, '_'));
        if (!awayTeam || !homeTeam) continue;
        // Final Four / Championship filter — skip NIT and other CBB games
        if (!FINAL_FOUR_SLUGS.has(awayTeam.dbSlug) || !FINAL_FOUR_SLUGS.has(homeTeam.dbSlug)) {
          console.log(`[VSiNAutoRefresh][Tomorrow][NCAAM] Skipping non-FF game: ${awayTeam.dbSlug} @ ${homeTeam.dbSlug}`);
          continue;
        }
        // Try direct match first, then reversed team order
        let dbGame = existingNcaam.find(e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug);
        let teamsSwapped = false;
        if (!dbGame) {
          dbGame = existingNcaam.find(e => e.awayTeam === homeTeam.dbSlug && e.homeTeam === awayTeam.dbSlug);
          if (dbGame) teamsSwapped = true;
        }
        if (!dbGame) continue;
        // When teams are swapped, flip the away/home percentages
        await updateBookOdds(dbGame.id, {
          spreadAwayBetsPct: teamsSwapped ? (g.spreadAwayBetsPct != null ? 100 - g.spreadAwayBetsPct : null) : g.spreadAwayBetsPct,
          spreadAwayMoneyPct: teamsSwapped ? (g.spreadAwayMoneyPct != null ? 100 - g.spreadAwayMoneyPct : null) : g.spreadAwayMoneyPct,
          totalOverBetsPct: g.totalOverBetsPct,
          totalOverMoneyPct: g.totalOverMoneyPct,
          mlAwayBetsPct: teamsSwapped ? (g.mlAwayBetsPct != null ? 100 - g.mlAwayBetsPct : null) : g.mlAwayBetsPct,
          mlAwayMoneyPct: teamsSwapped ? (g.mlAwayMoneyPct != null ? 100 - g.mlAwayMoneyPct : null) : g.mlAwayMoneyPct,
        });
        if (teamsSwapped) console.log(`[VSiNAutoRefresh][Tomorrow][NCAAM] Swapped teams for ${awayTeam.dbSlug}@${homeTeam.dbSlug} → matched DB ${dbGame.awayTeam}@${dbGame.homeTeam}`);
        updated++;
      }
      console.log(`[VSiNAutoRefresh][Tomorrow][NCAAM] ${updated} games updated with tomorrow's splits`);
      } // end else (isTomorrowRelevant)
    }

    // Process NBA
    const nbaSplits = allSplits.filter(g => g.sport === "NBA");
    if (nbaSplits.length > 0) {
      const existingNba = await listGamesByDate(tomorrowStr, "NBA");
      let updated = 0;
      for (const g of nbaSplits) {
        const awayTeam = getNbaTeamByVsinSlug(g.awayVsinSlug);
        const homeTeam = getNbaTeamByVsinSlug(g.homeVsinSlug);
        if (!awayTeam || !homeTeam) continue;
        let dbGame = existingNba.find(e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug);
        let teamsSwapped = false;
        if (!dbGame) {
          dbGame = existingNba.find(e => e.awayTeam === homeTeam.dbSlug && e.homeTeam === awayTeam.dbSlug);
          if (dbGame) teamsSwapped = true;
        }
        if (!dbGame) continue;
        await updateBookOdds(dbGame.id, {
          spreadAwayBetsPct: teamsSwapped ? (g.spreadAwayBetsPct != null ? 100 - g.spreadAwayBetsPct : null) : g.spreadAwayBetsPct,
          spreadAwayMoneyPct: teamsSwapped ? (g.spreadAwayMoneyPct != null ? 100 - g.spreadAwayMoneyPct : null) : g.spreadAwayMoneyPct,
          totalOverBetsPct: g.totalOverBetsPct,
          totalOverMoneyPct: g.totalOverMoneyPct,
          mlAwayBetsPct: teamsSwapped ? (g.mlAwayBetsPct != null ? 100 - g.mlAwayBetsPct : null) : g.mlAwayBetsPct,
          mlAwayMoneyPct: teamsSwapped ? (g.mlAwayMoneyPct != null ? 100 - g.mlAwayMoneyPct : null) : g.mlAwayMoneyPct,
        });
        if (teamsSwapped) console.log(`[VSiNAutoRefresh][Tomorrow][NBA] Swapped teams for ${awayTeam.dbSlug}@${homeTeam.dbSlug} → matched DB ${dbGame.awayTeam}@${dbGame.homeTeam}`);
        updated++;
      }
      console.log(`[VSiNAutoRefresh][Tomorrow][NBA] ${updated} games updated with tomorrow's splits`);
    }

    // Process NHL
    const nhlSplits = allSplits.filter(g => g.sport === "NHL");
    if (nhlSplits.length > 0) {
      const existingNhl = await listGamesByDate(tomorrowStr, "NHL");
      let updated = 0;
      for (const g of nhlSplits) {
        const awayTeam = resolveNhlVsinSlug(g.awayVsinSlug);
        const homeTeam = resolveNhlVsinSlug(g.homeVsinSlug);
        if (!awayTeam || !homeTeam) continue;
        let dbGame = existingNhl.find(e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug);
        let teamsSwapped = false;
        if (!dbGame) {
          dbGame = existingNhl.find(e => e.awayTeam === homeTeam.dbSlug && e.homeTeam === awayTeam.dbSlug);
          if (dbGame) teamsSwapped = true;
        }
        if (!dbGame) continue;
        await updateBookOdds(dbGame.id, {
          spreadAwayBetsPct: teamsSwapped ? (g.spreadAwayBetsPct != null ? 100 - g.spreadAwayBetsPct : null) : g.spreadAwayBetsPct,
          spreadAwayMoneyPct: teamsSwapped ? (g.spreadAwayMoneyPct != null ? 100 - g.spreadAwayMoneyPct : null) : g.spreadAwayMoneyPct,
          totalOverBetsPct: g.totalOverBetsPct,
          totalOverMoneyPct: g.totalOverMoneyPct,
          mlAwayBetsPct: teamsSwapped ? (g.mlAwayBetsPct != null ? 100 - g.mlAwayBetsPct : null) : g.mlAwayBetsPct,
          mlAwayMoneyPct: teamsSwapped ? (g.mlAwayMoneyPct != null ? 100 - g.mlAwayMoneyPct : null) : g.mlAwayMoneyPct,
        });
        if (teamsSwapped) console.log(`[VSiNAutoRefresh][Tomorrow][NHL] Swapped teams for ${awayTeam.dbSlug}@${homeTeam.dbSlug} → matched DB ${dbGame.awayTeam}@${dbGame.homeTeam}`);
        updated++;
      }
      console.log(`[VSiNAutoRefresh][Tomorrow][NHL] ${updated} games updated with tomorrow's splits`);
    }

    // AN odds for tomorrow are ingested via ingestAnHtml tRPC procedure (paste AN HTML)
  } catch (err) {
    console.warn("[VSiNAutoRefresh][Tomorrow] Tomorrow splits update failed (non-fatal):", err);
  }
}
/// ─── NCAAM refresh ──────────────────────────────────────────────
async function refreshNcaam(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  ncaaInserted: number;
  total: number;
}> {
  console.log(`[refreshNcaam] ► START — today: ${todayStr} | dates: [${allDates.join(", ")}]`);

  // NCAAM is now locked to Final Four (04/04) and National Championship (04/06) only.
  // Any date outside these two is a no-op — skip all processing.
  const relevantDates = allDates.filter(d => d === FINAL_FOUR_DATE || d === NATIONAL_CHAMPIONSHIP_DATE);
  if (relevantDates.length === 0) {
    console.log(`[refreshNcaam] No Final Four / Championship dates in window [${allDates.join(", ")}] — skipping NCAAM refresh.`);
    return { updated: 0, inserted: 0, ncaaInserted: 0, total: 0 };
  }

  // Scrape VSiN CBB betting splits (today + tomorrow)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    vsinSplits = await scrapeVsinBettingSplitsBothDays("CBB");
    console.log(`[refreshNcaam] VSiN CBB splits fetched: ${vsinSplits.length} games (front+tomorrow merged)`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN CBB splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup (both orderings)
  // ONLY include Final Four / Championship teams — NIT and other CBB games are silently ignored.
  const vsinSplitsMap = new Map<string, { game: VsinSplitsGame; swapped: boolean }>();
  for (const g of vsinSplits) {
    const awayTeam = BY_VSIN_SLUG.get(g.awayVsinSlug) ?? BY_VSIN_SLUG.get(g.awayVsinSlug.replace(/-/g, '_'));
    const homeTeam = BY_VSIN_SLUG.get(g.homeVsinSlug) ?? BY_VSIN_SLUG.get(g.homeVsinSlug.replace(/-/g, '_'));
    if (awayTeam && homeTeam) {
      // Filter: only Final Four / Championship teams
      if (!FINAL_FOUR_SLUGS.has(awayTeam.dbSlug) || !FINAL_FOUR_SLUGS.has(homeTeam.dbSlug)) {
        console.log(`[refreshNcaam] Skipping non-FF CBB game: ${awayTeam.dbSlug} @ ${homeTeam.dbSlug}`);
        continue;
      }
      vsinSplitsMap.set(`${awayTeam.dbSlug}@${homeTeam.dbSlug}`, { game: g, swapped: false });
      // Also store reversed key so DB games with swapped team order still match
      vsinSplitsMap.set(`${homeTeam.dbSlug}@${awayTeam.dbSlug}`, { game: g, swapped: true });
    } else {
      console.log(
        `[VSiNAutoRefresh][NCAAM] Unknown VSiN slug: ${g.awayVsinSlug} @ ${g.homeVsinSlug}`
      );
    }
  }

  // Fetch NCAA scoreboard for rolling window (primary source for game discovery)
  const ncaaGamesByDate = new Map<string, Awaited<ReturnType<typeof fetchNcaaGames>>>();
  const startTimeMaps = new Map<string, Map<string, string>>();

  for (const dateStr of allDates) {
    try {
      const yyyymmdd = dateStr.replace(/-/g, "");
      const ncaaGames = await fetchNcaaGames(yyyymmdd);
      startTimeMaps.set(dateStr, buildStartTimeMap(ncaaGames));
      ncaaGamesByDate.set(dateStr, ncaaGames);
      console.log(`[VSiNAutoRefresh] NCAA: ${ncaaGames.length} games for ${dateStr}`);
    } catch (ncaaErr) {
      console.warn(`[VSiNAutoRefresh] NCAA fetch failed for ${dateStr} (non-fatal):`, ncaaErr);
    }
  }

  // Apply VSiN splits to existing NCAAM games on Final Four + Championship dates
  let totalUpdated = 0;
  for (const dateStr of relevantDates) {
    const existing = await listGamesByDate(dateStr, "NCAAM");
    for (const dbGame of existing) {
      // Enforce Final Four / Championship team filter at DB game level
      if (!FINAL_FOUR_SLUGS.has(dbGame.awayTeam) || !FINAL_FOUR_SLUGS.has(dbGame.homeTeam)) continue;
      const key = `${dbGame.awayTeam}@${dbGame.homeTeam}`;
      const entry = vsinSplitsMap.get(key);
      if (!entry) continue;
      const { game: splits, swapped } = entry;
      await updateBookOdds(dbGame.id, {
        spreadAwayBetsPct: swapped ? (splits.spreadAwayBetsPct != null ? 100 - splits.spreadAwayBetsPct : null) : splits.spreadAwayBetsPct,
        spreadAwayMoneyPct: swapped ? (splits.spreadAwayMoneyPct != null ? 100 - splits.spreadAwayMoneyPct : null) : splits.spreadAwayMoneyPct,
        totalOverBetsPct: splits.totalOverBetsPct,
        totalOverMoneyPct: splits.totalOverMoneyPct,
        mlAwayBetsPct: swapped ? (splits.mlAwayBetsPct != null ? 100 - splits.mlAwayBetsPct : null) : splits.mlAwayBetsPct,
        mlAwayMoneyPct: swapped ? (splits.mlAwayMoneyPct != null ? 100 - splits.mlAwayMoneyPct : null) : splits.mlAwayMoneyPct,
      });
      totalUpdated++;
      if (swapped) console.log(`[VSiNAutoRefresh][NCAAM] Swapped splits for ${dbGame.awayTeam}@${dbGame.homeTeam}`);
      console.log(
        `[VSiNAutoRefresh][NCAAM] Splits updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} ` +
        `spread=${splits.spreadAwayBetsPct}%/${splits.spreadAwayMoneyPct}% ` +
        `total=${splits.totalOverBetsPct}%/${splits.totalOverMoneyPct}% ` +
        `ml=${splits.mlAwayBetsPct}%/${splits.mlAwayMoneyPct}%`
      );
    }
  }

  // NCAA-only game insertion (rolling 7-day window)
  let ncaaInserted = 0;
  let totalInserted = 0;

  // Only iterate over Final Four + Championship dates for game insertion
  for (const dateStr of relevantDates) {
    if (dateStr < todayStr) continue;

    const ncaaGames = ncaaGamesByDate.get(dateStr) ?? [];
    if (ncaaGames.length === 0) continue;

    const existingForDate = await listGamesByDate(dateStr, "NCAAM");
    // Cache for PST-date lookups (for late-night games that belong to a prior date)
    const existingByPstDate = new Map<string, Awaited<ReturnType<typeof listGamesByDate>>>();
    const startTimeMap = startTimeMaps.get(dateStr);

    for (const ncaaGame of ncaaGames) {
      const { contestId, awaySeoname, homeSeoname, startTimeEst, gameStatus, gameDatePst } = ncaaGame;

      // FINAL FOUR / CHAMPIONSHIP FILTER: only process Illinois, Connecticut, Michigan, Arizona
      if (!FINAL_FOUR_SLUGS.has(awaySeoname) || !FINAL_FOUR_SLUGS.has(homeSeoname)) {
        if (awaySeoname !== "tba" && homeSeoname !== "tba") {
          console.log(`[refreshNcaam] Skipping non-FF game: ${awaySeoname} @ ${homeSeoname}`);
        }
        continue;
      }

      if (!VALID_DB_SLUGS.has(awaySeoname) || !VALID_DB_SLUGS.has(homeSeoname)) {
        if (awaySeoname !== "tba" && homeSeoname !== "tba") {
          console.log(`[VSiNAutoRefresh] Skipping non-D1 NCAA game: ${awaySeoname} @ ${homeSeoname}`);
        }
        continue;
      }

      // Use the PST calendar date as the authoritative gameDate.
      // For late-night games (e.g. 9 PM PST on March 13 returned by March 14 query),
      // gameDatePst will differ from dateStr. We must use gameDatePst for DB lookups
      // and insertions to avoid storing the game under the wrong date.
      const effectiveDate = gameDatePst ?? dateStr;

      // Get the existing games for the effective PST date
      let existingForEffectiveDate = existingForDate;
      if (effectiveDate !== dateStr) {
        if (!existingByPstDate.has(effectiveDate)) {
          existingByPstDate.set(effectiveDate, await listGamesByDate(effectiveDate, "NCAAM"));
        }
        existingForEffectiveDate = existingByPstDate.get(effectiveDate)!;
      }

      const byContestId = await getGameByNcaaContestId(contestId);
      if (byContestId) {
        // Update scores/status on existing game
        await updateNcaaStartTime(byContestId.id, {
          startTimeEst: startTimeEst !== "TBD" ? startTimeEst : byContestId.startTimeEst,
          ncaaContestId: contestId,
          gameStatus,
          awayScore: ncaaGame.awayScore ?? null,
          homeScore: ncaaGame.homeScore ?? null,
          gameClock: ncaaGame.gameClock ?? null,
        });
        continue;
      }

      const bySlugCanonical = existingForEffectiveDate.find(
        e => slugsMatch(e.awayTeam, awaySeoname) && slugsMatch(e.homeTeam, homeSeoname)
      );
      const bySlugReversed = !bySlugCanonical ? existingForEffectiveDate.find(
        e => slugsMatch(e.awayTeam, homeSeoname) && slugsMatch(e.homeTeam, awaySeoname)
      ) : undefined;
      const bySlug = bySlugCanonical ?? bySlugReversed;

      if (bySlug) {
        await updateNcaaStartTime(bySlug.id, {
          startTimeEst: startTimeEst !== "TBD" ? startTimeEst : bySlug.startTimeEst,
          ncaaContestId: bySlug.ncaaContestId ?? contestId,
          gameStatus,
          awayScore: ncaaGame.awayScore ?? null,
          homeScore: ncaaGame.homeScore ?? null,
          gameClock: ncaaGame.gameClock ?? null,
        });
        continue;
      }

      // Insert new game stub from NCAA scoreboard
      const resolvedStartTime = startTimeMap?.get(`${awaySeoname}@${homeSeoname}`) ?? startTimeEst ?? "TBD";
      const row: InsertGame = {
        fileId: 0,
        gameDate: effectiveDate, // Use PST calendar date (not query date)
        startTimeEst: resolvedStartTime,
        awayTeam: awaySeoname,
        homeTeam: homeSeoname,
        awayBookSpread: null,
        homeBookSpread: null,
        bookTotal: null,
        awayModelSpread: null,
        homeModelSpread: null,
        modelTotal: null,
        spreadEdge: null,
        spreadDiff: null,
        totalEdge: null,
        totalDiff: null,
        sport: "NCAAM",
        gameType: "regular_season",
        conference: null,
        publishedToFeed: false,
        rotNums: null,
        sortOrder: 9999,
        ncaaContestId: contestId,
        gameStatus,
        awayScore: ncaaGame.awayScore ?? null,
        homeScore: ncaaGame.homeScore ?? null,
        gameClock: ncaaGame.gameClock ?? null,
      };
      await insertGames([row]);
      ncaaInserted++;
      totalInserted++;
      console.log(
        `[VSiNAutoRefresh] Inserted NCAA-only: ${awaySeoname} @ ${homeSeoname} (${dateStr})`
      );
    }
  }

  console.log(
    `[refreshNcaam] ✅ DONE — updated=${totalUpdated} inserted=${totalInserted} ncaaInserted=${ncaaInserted} total=${vsinSplits.length}`
  );
  return { updated: totalUpdated, inserted: totalInserted, ncaaInserted, total: vsinSplits.length };
}

// ─── NBA refresh ──────────────────────────────────────────────────────────────────────────────

async function refreshNba(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  scheduleInserted: number;
  total: number;
}> {
  console.log(`[refreshNba] ► START — today: ${todayStr} | dates: [${allDates.join(", ")}]`);
  // Scrape VSiN NBA betting splits (today only)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    vsinSplits = await scrapeVsinBettingSplitsBothDays("NBA");
    console.log(`[refreshNba] VSiN NBA splits fetched: ${vsinSplits.length} games (front+tomorrow merged)`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN NBA splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup (both orderings)
  // Use getNbaTeamByVsinSlug() which applies alias resolution (e.g. "la-clippers" → "los-angeles-clippers")
  const vsinSplitsMap = new Map<string, { game: VsinSplitsGame; swapped: boolean }>();
  for (const g of vsinSplits) {
    const awayTeam = getNbaTeamByVsinSlug(g.awayVsinSlug);
    const homeTeam = getNbaTeamByVsinSlug(g.homeVsinSlug);
    if (awayTeam && homeTeam) {
      vsinSplitsMap.set(`${awayTeam.dbSlug}@${homeTeam.dbSlug}`, { game: g, swapped: false });
      vsinSplitsMap.set(`${homeTeam.dbSlug}@${awayTeam.dbSlug}`, { game: g, swapped: true });
    } else {
      console.log(`[VSiNAutoRefresh][NBA] Unknown VSiN slug: ${g.awayVsinSlug} @ ${g.homeVsinSlug}`);
    }
  }

  // Fetch NBA schedule start times for each date in the rolling window
  const nbaStartTimeMaps = new Map<string, Map<string, string>>();
  const nbaGamesByDate = new Map<string, Awaited<ReturnType<typeof fetchNbaGamesForDate>>>();

  for (const dateStr of allDates) {
    try {
      const nbaGames = await fetchNbaGamesForDate(dateStr);
      nbaStartTimeMaps.set(dateStr, buildNbaStartTimeMap(nbaGames));
      nbaGamesByDate.set(dateStr, nbaGames);
      if (nbaGames.length > 0) {
        console.log(`[VSiNAutoRefresh] NBA schedule: ${nbaGames.length} games for ${dateStr}`);
      }
    } catch (err) {
      console.warn(`[VSiNAutoRefresh] NBA schedule fetch failed for ${dateStr} (non-fatal):`, err);
    }
  }

  // Apply VSiN splits to today's existing NBA games
  let totalUpdated = 0;
  const existingToday = await listGamesByDate(todayStr, "NBA");
  for (const dbGame of existingToday) {
    const key = `${dbGame.awayTeam}@${dbGame.homeTeam}`;
    const entry = vsinSplitsMap.get(key);
    if (!entry) continue;
    const { game: splits, swapped } = entry;
    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct: swapped ? (splits.spreadAwayBetsPct != null ? 100 - splits.spreadAwayBetsPct : null) : splits.spreadAwayBetsPct,
      spreadAwayMoneyPct: swapped ? (splits.spreadAwayMoneyPct != null ? 100 - splits.spreadAwayMoneyPct : null) : splits.spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct: swapped ? (splits.mlAwayBetsPct != null ? 100 - splits.mlAwayBetsPct : null) : splits.mlAwayBetsPct,
      mlAwayMoneyPct: swapped ? (splits.mlAwayMoneyPct != null ? 100 - splits.mlAwayMoneyPct : null) : splits.mlAwayMoneyPct,
    });
    totalUpdated++;
    if (swapped) console.log(`[VSiNAutoRefresh][NBA] Swapped splits for ${dbGame.awayTeam}@${dbGame.homeTeam}`);
    console.log(
      `[VSiNAutoRefresh][NBA] Splits updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} ` +
      `spread=${splits.spreadAwayBetsPct}%/${splits.spreadAwayMoneyPct}% ` +
      `total=${splits.totalOverBetsPct}%/${splits.totalOverMoneyPct}% ` +
      `ml=${splits.mlAwayBetsPct}%/${splits.mlAwayMoneyPct}%`
    );
  }

  // NBA schedule-only game insertion (rolling 7-day window)
  let scheduleInserted = 0;
  let totalInserted = 0;

  for (const dateStr of allDates) {
    if (dateStr < todayStr) continue;

    const nbaGames = nbaGamesByDate.get(dateStr) ?? [];
    if (nbaGames.length === 0) continue;

    const existing = await listGamesByDate(dateStr, "NBA");
    const startTimeMap = nbaStartTimeMaps.get(dateStr);

    for (const nbaGame of nbaGames) {
      const { awayDbSlug, homeDbSlug, startTimeEst, gameId } = nbaGame;

      const bySlug = existing.find(
        e => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
      );
      if (bySlug) {
        // Update start time if available
        if (startTimeEst && startTimeEst !== bySlug.startTimeEst) {
          await updateBookOdds(bySlug.id, { startTimeEst });
        }
        continue;
      }

      const byGameId = await getGameByNcaaContestId(gameId);
      if (byGameId) continue;

      const resolvedStartTime = startTimeMap?.get(`${awayDbSlug}@${homeDbSlug}`) ?? startTimeEst ?? "TBD";
      const row: InsertGame = {
        fileId: 0,
        gameDate: dateStr,
        startTimeEst: resolvedStartTime,
        awayTeam: awayDbSlug,
        homeTeam: homeDbSlug,
        awayBookSpread: null,
        homeBookSpread: null,
        bookTotal: null,
        awayModelSpread: null,
        homeModelSpread: null,
        modelTotal: null,
        spreadEdge: null,
        spreadDiff: null,
        totalEdge: null,
        totalDiff: null,
        sport: "NBA",
        gameType: "regular_season",
        conference: null,
        publishedToFeed: false,
        rotNums: null,
        sortOrder: 9999,
        ncaaContestId: gameId,
      };
      await insertGames([row]);
      scheduleInserted++;
      totalInserted++;
      console.log(
        `[VSiNAutoRefresh] Inserted NBA schedule-only: ${awayDbSlug} @ ${homeDbSlug} (${dateStr})`
      );
    }
  }

  console.log(
    `[refreshNba] ✅ DONE — updated=${totalUpdated} inserted=${totalInserted} scheduleInserted=${scheduleInserted} total=${vsinSplits.length}`
  );
  return { updated: totalUpdated, inserted: totalInserted, scheduleInserted, total: vsinSplits.length };
}

// ─── NHL Refresh ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────═

async function refreshNhl(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  scheduleInserted: number;
  total: number;
}> {
  console.log(`[refreshNhl] ► START — today: ${todayStr} | dates: [${allDates.join(", ")}]`);
  // Scrape VSiN NHL betting splits (today only)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    vsinSplits = await scrapeVsinBettingSplitsBothDays("NHL");
    console.log(`[refreshNhl] VSiN NHL splits fetched: ${vsinSplits.length} games (front+tomorrow merged)`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN NHL splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup (both orderings)
  const vsinSplitsMap = new Map<string, { game: VsinSplitsGame; swapped: boolean }>();
  for (const g of vsinSplits) {
    const awayTeam = resolveNhlVsinSlug(g.awayVsinSlug);
    const homeTeam = resolveNhlVsinSlug(g.homeVsinSlug);
    if (awayTeam && homeTeam) {
      vsinSplitsMap.set(`${awayTeam.dbSlug}@${homeTeam.dbSlug}`, { game: g, swapped: false });
      vsinSplitsMap.set(`${homeTeam.dbSlug}@${awayTeam.dbSlug}`, { game: g, swapped: true });
      console.log(`[VSiNAutoRefresh][NHL] Mapped splits: ${awayTeam.dbSlug} @ ${homeTeam.dbSlug} (awayVsinSlug="${g.awayVsinSlug}" homeVsinSlug="${g.homeVsinSlug}")`);
    }
  }

  // Fetch NHL schedule for the rolling 7-day window
  const rangeEnd = allDates[allDates.length - 1];
  let nhlScheduleGames: NhlScheduleGame[] = [];
  try {
    nhlScheduleGames = await fetchNhlGamesForRange(todayStr, rangeEnd);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] NHL schedule fetch failed (non-fatal):", err);
    nhlScheduleGames = [];
  }

  // Build per-date start time maps from the schedule
  const nhlStartTimeMaps = new Map<string, Map<string, string>>();
  for (const dateStr of allDates) {
    const gamesOnDate = nhlScheduleGames.filter((g) => g.gameDateEst === dateStr);
    nhlStartTimeMaps.set(dateStr, buildNhlStartTimeMap(gamesOnDate));
  }

  const nhlGamesByDate = new Map<string, typeof nhlScheduleGames>();
  for (const g of nhlScheduleGames) {
    const list = nhlGamesByDate.get(g.gameDateEst) ?? [];
    list.push(g);
    nhlGamesByDate.set(g.gameDateEst, list);
  }

  // Apply VSiN splits to today's existing NHL games
  let totalUpdated = 0;
  const existingToday = await listGamesByDate(todayStr, "NHL");
  for (const dbGame of existingToday) {
    const key = `${dbGame.awayTeam}@${dbGame.homeTeam}`;
    const entry = vsinSplitsMap.get(key);
    if (!entry) continue;
    const { game: splits, swapped } = entry;
    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct: swapped ? (splits.spreadAwayBetsPct != null ? 100 - splits.spreadAwayBetsPct : null) : splits.spreadAwayBetsPct,
      spreadAwayMoneyPct: swapped ? (splits.spreadAwayMoneyPct != null ? 100 - splits.spreadAwayMoneyPct : null) : splits.spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct: swapped ? (splits.mlAwayBetsPct != null ? 100 - splits.mlAwayBetsPct : null) : splits.mlAwayBetsPct,
      mlAwayMoneyPct: swapped ? (splits.mlAwayMoneyPct != null ? 100 - splits.mlAwayMoneyPct : null) : splits.mlAwayMoneyPct,
    });
    totalUpdated++;
    if (swapped) console.log(`[VSiNAutoRefresh][NHL] Swapped splits for ${dbGame.awayTeam}@${dbGame.homeTeam}`);
    console.log(
      `[VSiNAutoRefresh][NHL] Splits updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} ` +
      `spread=${splits.spreadAwayBetsPct}%/${splits.spreadAwayMoneyPct}% ` +
      `total=${splits.totalOverBetsPct}%/${splits.totalOverMoneyPct}% ` +
      `ml=${splits.mlAwayBetsPct}%/${splits.mlAwayMoneyPct}%`
    );
  }

  // NHL schedule-only game insertion (rolling 7-day window)
  let scheduleInserted = 0;
  let totalInserted = 0;

  for (const dateStr of allDates) {
    if (dateStr < todayStr) continue;
    const nhlGames = nhlGamesByDate.get(dateStr) ?? [];
    if (nhlGames.length === 0) continue;
    const existing = await listGamesByDate(dateStr, "NHL");
    const startTimeMap = nhlStartTimeMaps.get(dateStr);

    for (const nhlGame of nhlGames) {
      const { awayDbSlug, homeDbSlug, startTimeEst, gameId } = nhlGame;

      const bySlug = existing.find(
        (e) => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
      );
      if (bySlug) {
        if (startTimeEst && startTimeEst !== bySlug.startTimeEst) {
          await updateBookOdds(bySlug.id, { startTimeEst });
        }
        continue;
      }

      const byGameId = await getGameByNcaaContestId(String(gameId));
      if (byGameId) continue;

      const resolvedStartTime = startTimeMap?.get(`${awayDbSlug}@${homeDbSlug}`) ?? startTimeEst ?? "TBD";
      const row: InsertGame = {
        fileId: 0,
        gameDate: dateStr,
        startTimeEst: resolvedStartTime,
        awayTeam: awayDbSlug,
        homeTeam: homeDbSlug,
        awayBookSpread: null,
        homeBookSpread: null,
        bookTotal: null,
        awayModelSpread: null,
        homeModelSpread: null,
        modelTotal: null,
        spreadEdge: null,
        spreadDiff: null,
        totalEdge: null,
        totalDiff: null,
        sport: "NHL",
        gameType: "regular_season",
        conference: null,
        publishedToFeed: false,
        rotNums: null,
        sortOrder: 9999,
        ncaaContestId: String(gameId),
      };
      await insertGames([row]);
      scheduleInserted++;
      totalInserted++;
      console.log(
        `[VSiNAutoRefresh] Inserted NHL schedule-only: ${awayDbSlug} @ ${homeDbSlug} (${dateStr})`
      );
    }
  }

  console.log(
    `[refreshNhl] ✅ DONE — updated=${totalUpdated} inserted=${totalInserted} scheduleInserted=${scheduleInserted} total=${vsinSplits.length}`
  );
  return { updated: totalUpdated, inserted: totalInserted, scheduleInserted, total: vsinSplits.length };
}

// ─── MLB refresh ─────────────────────────────────────────────────────────────

/**
 * Refreshes MLB betting splits from VSiN for today's games.
 *
 * MLB teams are stored in the DB as abbreviations ("NYY", "SF") — NOT dbSlugs.
 * VSiN uses single-word slugs ("yankees", "giants").
 * Matching chain: VSiN slug → getMlbTeamByVsinSlug() → abbrev → DB lookup.
 *
 * Returns { updated, total } — non-fatal, errors are logged.
 */
async function refreshMlb(todayStr: string): Promise<{
  updated: number;
  total: number;
}> {
  const tag = "[refreshMlb]";
  console.log(`${tag} ► START — today: ${todayStr}`);

  // ── Step 1: Scrape VSiN MLB betting splits (dedicated MLB page) ───────────
  // MLB uses a separate URL (data.vsin.com/mlb/betting-splits/) with different
  // column order: Moneyline(1-3) → Total(4-6) → Run Line(7-9).
  // The combined betting-splits page does NOT include MLB games.
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    vsinSplits = await scrapeVsinMlbBettingSplits();
    console.log(`${tag} VSiN MLB splits fetched: ${vsinSplits.length} games from MLB-specific page`);
    if (vsinSplits.length === 0) {
      console.log(`${tag} No MLB games on VSiN today — splits update skipped`);
    } else {
      for (const g of vsinSplits) {
        console.log(
          `${tag} VSiN game: ${g.awayVsinSlug} @ ${g.homeVsinSlug} ` +
          `| spread: ${g.spreadAwayBetsPct}%/${g.spreadAwayMoneyPct}% ` +
          `| total: ${g.totalOverBetsPct}%/${g.totalOverMoneyPct}% ` +
          `| ml: ${g.mlAwayBetsPct}%/${g.mlAwayMoneyPct}%`
        );
      }
    }
  } catch (err) {
    console.warn(`${tag} VSiN MLB splits scrape failed (non-fatal):`, err);
  }

  // ── Step 2: Build VSiN slug → abbrev lookup map ────────────────────────────
  // MLB teams stored as abbreviations in DB; VSiN uses single-word slugs.
  // Both orderings stored so swapped home/away is handled transparently.
  const vsinSplitsMap = new Map<string, { game: VsinSplitsGame; swapped: boolean }>();
  for (const g of vsinSplits) {
    const awayTeam = getMlbTeamByVsinSlug(g.awayVsinSlug);
    const homeTeam = getMlbTeamByVsinSlug(g.homeVsinSlug);
    if (awayTeam && homeTeam) {
      // Key by abbreviation (how DB stores MLB teams)
      vsinSplitsMap.set(`${awayTeam.abbrev}@${homeTeam.abbrev}`, { game: g, swapped: false });
      vsinSplitsMap.set(`${homeTeam.abbrev}@${awayTeam.abbrev}`, { game: g, swapped: true });
      console.log(
        `${tag} Mapped VSiN splits: ${awayTeam.abbrev} @ ${homeTeam.abbrev} ` +
        `(awaySlug="${g.awayVsinSlug}" homeSlug="${g.homeVsinSlug}")`
      );
    } else {
      console.warn(
        `${tag} UNRESOLVED VSiN slug: "${g.awayVsinSlug}" @ "${g.homeVsinSlug}" ` +
        `— awayResolved=${!!awayTeam} homeResolved=${!!homeTeam} ` +
        `— add to VSIN_MLB_HREF_ALIASES if this is a known alias`
      );
    }
  }

  // -- Step 3: Apply VSiN splits to today + tomorrow's DB games --
  // VSiN's MLB page shows games for the next 1-2 days, so we query both
  // today and tomorrow to ensure we catch games on either side of midnight.
  let totalUpdated = 0;
  const tomorrowStr = (() => {
    const d = new Date(todayStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [todayGames, tomorrowGames] = await Promise.all([
    listGamesByDate(todayStr, "MLB"),
    listGamesByDate(tomorrowStr, "MLB"),
  ]);
  const existingToday = [...todayGames, ...tomorrowGames];
  console.log(
    `${tag} DB has ${todayGames.length} MLB games for ${todayStr}` +
    ` + ${tomorrowGames.length} games for ${tomorrowStr}` +
    ` = ${existingToday.length} total`
  );

  for (const dbGame of existingToday) {
    const key = `${dbGame.awayTeam}@${dbGame.homeTeam}`;
    const entry = vsinSplitsMap.get(key);
    if (!entry) {
      console.log(
        `${tag} NO_VSIN_MATCH: ${dbGame.awayTeam} @ ${dbGame.homeTeam} ` +
        `(gameId=${dbGame.id}) — not in VSiN splits today`
      );
      continue;
    }
    const { game: splits, swapped } = entry;

    // Flip away/home percentages when VSiN and DB have teams in opposite order
    const spreadAwayBetsPct = swapped
      ? (splits.spreadAwayBetsPct != null ? 100 - splits.spreadAwayBetsPct : null)
      : splits.spreadAwayBetsPct;
    const spreadAwayMoneyPct = swapped
      ? (splits.spreadAwayMoneyPct != null ? 100 - splits.spreadAwayMoneyPct : null)
      : splits.spreadAwayMoneyPct;
    const mlAwayBetsPct = swapped
      ? (splits.mlAwayBetsPct != null ? 100 - splits.mlAwayBetsPct : null)
      : splits.mlAwayBetsPct;
    const mlAwayMoneyPct = swapped
      ? (splits.mlAwayMoneyPct != null ? 100 - splits.mlAwayMoneyPct : null)
      : splits.mlAwayMoneyPct;

    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct,
      spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct,
      mlAwayMoneyPct,
    });
    totalUpdated++;

    if (swapped) {
      console.log(`${tag} SWAPPED: VSiN has ${splits.awayVsinSlug}@${splits.homeVsinSlug} but DB has ${dbGame.awayTeam}@${dbGame.homeTeam} — flipped percentages`);
    }
    console.log(
      `${tag} Splits updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} ` +
      `(gameId=${dbGame.id}) ` +
      `| runLine: ${spreadAwayBetsPct}%/${spreadAwayMoneyPct}% ` +
      `| total: ${splits.totalOverBetsPct}%/${splits.totalOverMoneyPct}% ` +
      `| ml: ${mlAwayBetsPct}%/${mlAwayMoneyPct}%`
    );
  }

  console.log(
    `${tag} ✅ DONE — splits_updated=${totalUpdated} db_games=${existingToday.length} vsin_games=${vsinSplits.length}`
  );
  return { updated: totalUpdated, total: vsinSplits.length };
}

// ─── AN API DK Odds Auto-Population ──────────────────────────────────────────

/**
 * Fetches DraftKings odds from the Action Network public API for a given date
 * and populates the awayBookSpread/homeBookSpread/bookTotal/ML columns for all
 * matched games in the DB. This replaces the manual HTML paste workflow for
 * current DK NJ lines.
 *
 * Matching strategy:
 *   - NBA:  awayUrlSlug / homeUrlSlug → NBA_BY_AN_SLUG (e.g. "portland-trail-blazers")
 *   - NHL:  awayUrlSlug / homeUrlSlug → NHL_BY_AN_SLUG (e.g. "boston-bruins")
 *   - NCAAM: awayUrlSlug / homeUrlSlug → NCAAM_BY_AN (e.g. "vanderbilt-commodores")
 *
 * Non-fatal: errors are caught and logged.
 */
async function refreshAnApiOdds(
  dateStr: string,
  sports: AnSport[] = ["ncaab", "nba", "nhl"],
  source: "auto" | "manual" = "auto"
): Promise<{ updated: number; skipped: number; frozen: number; errors: string[] }> {
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFrozen = 0;
  const allErrors: string[] = [];

  for (const sport of sports) {
    try {
      const dbSport = sport === "nba" ? "NBA" : sport === "nhl" ? "NHL" : sport === "mlb" ? "MLB" : "NCAAM";
      const anGames = await fetchActionNetworkOdds(sport, dateStr);

      if (anGames.length === 0) {
        console.log(`[ANApiOdds][${dbSport}] No games with DK odds for ${dateStr}`);
        continue;
      }

      const existingGames = await listGamesByDate(dateStr, dbSport);
      let updated = 0;
      let skipped = 0;

      for (const anGame of anGames) {
        // Resolve away team dbSlug via AN url_slug
        let awayDbSlug: string | undefined;
        let homeDbSlug: string | undefined;

        if (sport === "nba") {
          awayDbSlug = NBA_BY_AN_SLUG.get(anGame.awayUrlSlug)?.dbSlug;
          homeDbSlug = NBA_BY_AN_SLUG.get(anGame.homeUrlSlug)?.dbSlug;
        } else if (sport === "nhl") {
          awayDbSlug = getNhlTeamByAnSlug(anGame.awayUrlSlug)?.dbSlug;
          homeDbSlug = getNhlTeamByAnSlug(anGame.homeUrlSlug)?.dbSlug;
        } else if (sport === "mlb") {
          // MLB teams are stored in DB as abbreviations ("NYY", "SF"), not dbSlugs.
          // getMlbTeamByAnSlug resolves AN url_slug ("new-york-yankees") → MlbTeam → abbrev.
          const awayMlb = getMlbTeamByAnSlug(anGame.awayUrlSlug);
          const homeMlb = getMlbTeamByAnSlug(anGame.homeUrlSlug);
          awayDbSlug = awayMlb?.abbrev;
          homeDbSlug = homeMlb?.abbrev;
          if (!awayMlb || !homeMlb) {
            console.warn(
              `[ANApiOdds][MLB] UNRESOLVED AN slug: "${anGame.awayUrlSlug}" @ "${anGame.homeUrlSlug}" ` +
              `— awayResolved=${!!awayMlb} homeResolved=${!!homeMlb} ` +
              `— add to MLB_AN_SLUG_ALIASES in mlbTeams.ts if this is a known alias`
            );
          } else {
            console.log(
              `[ANApiOdds][MLB] Resolved: "${anGame.awayUrlSlug}" → ${awayMlb.abbrev} | ` +
              `"${anGame.homeUrlSlug}" → ${homeMlb.abbrev} | ` +
              `runLine=${anGame.dkAwaySpread}/${anGame.dkHomeSpread} ` +
              `total=${anGame.dkTotal} ml=${anGame.dkAwayML}/${anGame.dkHomeML}`
            );
          }
        } else {
          // NCAAM — use alias-aware helper so v2 slugs (e.g. "wichita-state-shockers",
          // "south-florida-bulls", "pennsylvania-quakers") resolve correctly
          awayDbSlug = getNcaamTeamByAnSlug(anGame.awayUrlSlug)?.dbSlug;
          homeDbSlug = getNcaamTeamByAnSlug(anGame.homeUrlSlug)?.dbSlug;
        }

        if (!awayDbSlug || !homeDbSlug) {
          const msg = `[ANApiOdds][${dbSport}] NO_SLUG: ${anGame.awayUrlSlug} @ ${anGame.homeUrlSlug} (anId=${anGame.gameId})`;
          console.warn(msg);
          allErrors.push(msg);
          skipped++;
          continue;
        }

        // Try both orderings: AN may list teams as away@home while DB has them reversed
        const dbGameDirect = existingGames.find(
          e => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
        );
        const dbGameSwapped = !dbGameDirect ? existingGames.find(
          e => e.awayTeam === homeDbSlug && e.homeTeam === awayDbSlug
        ) : undefined;
        const dbGame = dbGameDirect ?? dbGameSwapped;
        const teamsSwapped = !!dbGameSwapped && !dbGameDirect;

        if (!dbGame) {
          const msg = `[ANApiOdds][${dbSport}] NO_MATCH: ${awayDbSlug} @ ${homeDbSlug} on ${dateStr} (anId=${anGame.gameId})`;
          console.warn(msg);
          allErrors.push(msg);
          skipped++;
          continue;
        }

        if (teamsSwapped) {
          console.log(
            `[ANApiOdds][${dbSport}] SWAPPED: AN has ${awayDbSlug}@${homeDbSlug} but DB has ${dbGame.awayTeam}@${dbGame.homeTeam} — flipping spreads/ML`
          );
        }

        // ── ODDS FREEZE: skip games that have already started or finished ──────
        // Once a game goes live, the AN API starts returning live in-game lines.
        // We lock in the pre-game line by refusing to overwrite it.
        if (dbGame.gameStatus === "live" || dbGame.gameStatus === "final") {
          console.log(
            `[ANApiOdds][${dbSport}] FROZEN: ${awayDbSlug} @ ${homeDbSlug} (${dateStr}) ` +
            `— gameStatus=${dbGame.gameStatus}, odds locked in, skipping update`
          );
          totalFrozen++;
          continue;
        }

        // When teams are swapped, flip away/home spread and ML so they align with DB ordering
        const dkAwaySpread = teamsSwapped ? anGame.dkHomeSpread : anGame.dkAwaySpread;
        const dkAwaySpreadOdds = teamsSwapped ? anGame.dkHomeSpreadOdds : anGame.dkAwaySpreadOdds;
        const dkHomeSpread = teamsSwapped ? anGame.dkAwaySpread : anGame.dkHomeSpread;
        const dkHomeSpreadOdds = teamsSwapped ? anGame.dkAwaySpreadOdds : anGame.dkHomeSpreadOdds;
        const dkAwayML = teamsSwapped ? anGame.dkHomeML : anGame.dkAwayML;
        const dkHomeML = teamsSwapped ? anGame.dkAwayML : anGame.dkHomeML;
        const openAwaySpread = teamsSwapped ? anGame.openHomeSpread : anGame.openAwaySpread;
        const openAwaySpreadOdds = teamsSwapped ? anGame.openHomeSpreadOdds : anGame.openAwaySpreadOdds;
        const openHomeSpread = teamsSwapped ? anGame.openAwaySpread : anGame.openHomeSpread;
        const openHomeSpreadOdds = teamsSwapped ? anGame.openAwaySpreadOdds : anGame.openHomeSpreadOdds;
        const openAwayML = teamsSwapped ? anGame.openHomeML : anGame.openAwayML;
        const openHomeML = teamsSwapped ? anGame.openAwayML : anGame.openHomeML;

        // Populate DK NJ current lines + Open lines
        // fmtSpread: converts numeric spread/total to signed string (e.g. 1.5 → "+1.5", -1.5 → "-1.5", 7 → "7")
        // Totals are never signed (always positive), but spreads must be signed for display correctness.
        const fmtSpread = (v: number | null): string | null =>
          v === null ? null : v > 0 ? `+${v}` : `${v}`;
        const fmtTotal = (v: number | null): string | null =>
          v === null ? null : `${v}`;

        await updateAnOdds(dbGame.id, {
          // DK NJ current line
          awayBookSpread: fmtSpread(dkAwaySpread),
          awaySpreadOdds: dkAwaySpreadOdds,
          homeBookSpread: fmtSpread(dkHomeSpread),
          homeSpreadOdds: dkHomeSpreadOdds,
          bookTotal: fmtTotal(anGame.dkTotal),
          overOdds: anGame.dkOverOdds,
          underOdds: anGame.dkUnderOdds,
          awayML: dkAwayML,
          homeML: dkHomeML,
          // Open line (only update if AN has open data)
          ...(openAwaySpread !== null ? {
            openAwaySpread: fmtSpread(openAwaySpread),
            openAwaySpreadOdds: openAwaySpreadOdds,
            openHomeSpread: fmtSpread(openHomeSpread),
            openHomeSpreadOdds: openHomeSpreadOdds,
            openTotal: fmtTotal(anGame.openTotal),
            openAwayML: openAwayML,
            openHomeML: openHomeML,
          } : {}),
        });

        // ── ODDS HISTORY: snapshot the DK NJ lines we just wrote ─────────────
        await insertOddsHistory(
          dbGame.id,
          dbSport,
          source,
          {
            awaySpread: fmtSpread(dkAwaySpread),
            awaySpreadOdds: dkAwaySpreadOdds,
            homeSpread: fmtSpread(dkHomeSpread),
            homeSpreadOdds: dkHomeSpreadOdds,
            total: fmtTotal(anGame.dkTotal),
            overOdds: anGame.dkOverOdds,
            underOdds: anGame.dkUnderOdds,
            awayML: dkAwayML,
            homeML: dkHomeML,
          }
        );

        updated++;
        console.log(
          `[ANApiOdds][${dbSport}] Updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} (${dateStr}) source=${source}${teamsSwapped ? ' [SWAPPED]' : ''} | ` +
          `spread=${dkAwaySpread}/${dkHomeSpread} ` +
          `total=${anGame.dkTotal} ` +
          `ml=${dkAwayML}/${dkHomeML}`
        );
      }

      console.log(`[ANApiOdds][${dbSport}] ${dateStr}: updated=${updated} skipped=${skipped} frozen=${totalFrozen} total=${anGames.length}`);
      totalUpdated += updated;
      totalSkipped += skipped;
    } catch (err) {
      const msg = `[ANApiOdds][${sport.toUpperCase()}] Failed for ${dateStr}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(msg);
      allErrors.push(msg);
    }
  }

  return { updated: totalUpdated, skipped: totalSkipped, frozen: totalFrozen, errors: allErrors };
}

// ─── Main refresh orchestrator ─────────────────────────────────────────────────

/**
 * Core refresh logic — fully idempotent upsert of all VSiN games (NCAAM + NBA),
 * plus insertion of all schedule-only games for a rolling 7-day window.
 * Safe to call at any time; errors are caught and logged.
 */
export async function runVsinRefresh(): Promise<RefreshResult | null> {
  const todayStr = datePst();

  console.log(`[VSiNAutoRefresh] Starting refresh — today: ${todayStr}`);

  try {
    const rangeEnd = datePst(RANGE_DAYS_AHEAD);
    const allDates = dateRange(todayStr, rangeEnd);

    // Run NCAAM, NBA, and NHL refreshes in sequence (share the same VSiN token)
    const ncaamResult = await refreshNcaam(todayStr, allDates);
    const nbaResult = await refreshNba(todayStr, allDates);
    const nhlResult = await refreshNhl(todayStr, allDates);
    console.log(
      `[VSiNAutoRefresh] NHL refresh complete: updated=${nhlResult.updated} ` +
      `inserted=${nhlResult.inserted} scheduleInserted=${nhlResult.scheduleInserted} ` +
      `total=${nhlResult.total}`
    );

    // MLB: refresh VSiN splits (non-fatal)
    const mlbResult = await refreshMlb(todayStr);
    console.log(
      `[VSiNAutoRefresh] MLB VSiN splits: updated=${mlbResult.updated} total=${mlbResult.total}`
    );

    // Auto-populate DK NJ current lines from Action Network API for today
    // (non-fatal — errors are logged but do not block the refresh)
    // MLB included: run line (spread), total, moneyline from AN DK NJ
    const anOddsResult = await refreshAnApiOdds(todayStr, ["ncaab", "nba", "nhl", "mlb"], "auto");
    console.log(
      `[VSiNAutoRefresh] AN API DK odds: updated=${anOddsResult.updated} ` +
      `skipped=${anOddsResult.skipped} frozen=${anOddsResult.frozen} errors=${anOddsResult.errors.length}`
    );

    // Pre-populate tomorrow's splits and DK odds (non-fatal)
    const tomorrowStr = datePst(1);
    await runTomorrowSplitsUpdate(tomorrowStr);
    // Also populate tomorrow's DK odds from AN API (tomorrow games are never live, no freeze needed)
    // MLB included for tomorrow
    const anOddsTomorrow = await refreshAnApiOdds(tomorrowStr, ["ncaab", "nba", "nhl", "mlb"], "auto");
    console.log(
      `[VSiNAutoRefresh] AN API DK odds (tomorrow): updated=${anOddsTomorrow.updated} ` +
      `skipped=${anOddsTomorrow.skipped} frozen=${anOddsTomorrow.frozen} errors=${anOddsTomorrow.errors.length}`
    );

    const result: RefreshResult = {
      refreshedAt: new Date().toISOString(),
      scoresRefreshedAt: lastScoresRefreshedAt,
      updated: ncaamResult.updated,
      inserted: ncaamResult.inserted,
      ncaaInserted: ncaamResult.ncaaInserted,
      nbaUpdated: nbaResult.updated,
      nbaInserted: nbaResult.inserted,
      nbaScheduleInserted: nbaResult.scheduleInserted,
      total: ncaamResult.total,
      nbaTotal: nbaResult.total,
      nhlUpdated: nhlResult.updated,
      nhlInserted: nhlResult.inserted,
      nhlScheduleInserted: nhlResult.scheduleInserted,
      nhlTotal: nhlResult.total,
      gameDate: todayStr,
    };

    lastRefreshResult = result;
    console.log(
      `[VSiNAutoRefresh] Done — ` +
      `NCAAM: ${ncaamResult.updated} updated, ${ncaamResult.inserted} inserted, ${ncaamResult.ncaaInserted} NCAA-only | ` +
      `NBA: ${nbaResult.updated} updated, ${nbaResult.inserted} inserted, ${nbaResult.scheduleInserted} schedule-only`
    );
    return result;
  } catch (err) {
    console.error("[VSiNAutoRefresh] Refresh failed:", err);
    return null;
  }
}

/**
 * Score-only refresh: re-fetches NCAA scoreboard for today and updates
 * awayScore, homeScore, gameClock, and gameStatus for all NCAAM games.
 * Runs every 5 minutes so live scores stay current.
 */
async function refreshNcaamScores(): Promise<void> {
  const todayStr = datePst();
  try {
    const yyyymmdd = todayStr.replace(/-/g, "");
    const ncaaGames = await fetchNcaaGames(yyyymmdd);

    // Also fetch the next UTC day's games from the NCAA API.
    // The NCAA API uses UTC midnight as the day boundary, so a game at 9 PM PST
    // on March 13 (= 4 AM UTC on March 14) is returned by the March 14 query.
    // We use gameDatePst to identify games that actually belong to today (PST).
    const nextDay = new Date(todayStr + "T00:00:00Z");
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayYyyymmdd = nextDay.toISOString().slice(0, 10).replace(/-/g, "");
    try {
      const nextDayGames = await fetchNcaaGames(nextDayYyyymmdd);
      // Include games whose PST calendar date is today (they belong to today's slate
      // even though the NCAA API returns them under the next UTC day)
      const todayPstGames = nextDayGames.filter(g => g.gameDatePst === todayStr);
      ncaaGames.push(...todayPstGames);
    } catch {
      // Non-fatal
    }

    const existing = await listGamesByDate(todayStr, "NCAAM");

    let updated = 0;
    for (const ncaaGame of ncaaGames) {
      // Match priority: (1) ncaaContestId exact, (2) canonical slug, (3) reversed slug
      // Reversed slug handles cases where VSiN inserted the game with swapped home/away
      const dbGame = existing.find(
        g => g.ncaaContestId === ncaaGame.contestId
      ) ?? existing.find(
        g => slugsMatch(g.awayTeam, ncaaGame.awaySeoname) && slugsMatch(g.homeTeam, ncaaGame.homeSeoname)
      ) ?? existing.find(
        g => slugsMatch(g.awayTeam, ncaaGame.homeSeoname) && slugsMatch(g.homeTeam, ncaaGame.awaySeoname)
      );
      if (!dbGame) {
        console.log(
          `[ScoreRefresh][NCAAM] NO_MATCH: ${ncaaGame.awaySeoname}@${ncaaGame.homeSeoname} ` +
          `contestId=${ncaaGame.contestId} — not in DB for ${todayStr}`
        );
        continue;
      }
      const matchType = dbGame.ncaaContestId === ncaaGame.contestId ? 'CONTEST_ID'
        : (slugsMatch(dbGame.awayTeam, ncaaGame.awaySeoname) ? 'CANONICAL' : 'REVERSED');
      console.log(
        `[ScoreRefresh][NCAAM] ${matchType}: ${ncaaGame.awaySeoname}@${ncaaGame.homeSeoname} ` +
        `→ DB id=${dbGame.id} (${dbGame.awayTeam}@${dbGame.homeTeam}) | ` +
        `status=${ncaaGame.gameStatus} score=${ncaaGame.awayScore}-${ncaaGame.homeScore} clock=${ncaaGame.gameClock}`
      );

      await updateNcaaStartTime(dbGame.id, {
        startTimeEst: dbGame.startTimeEst,
        ncaaContestId: dbGame.ncaaContestId ?? ncaaGame.contestId,
        gameStatus: ncaaGame.gameStatus,
        awayScore: ncaaGame.awayScore ?? null,
        homeScore: ncaaGame.homeScore ?? null,
        gameClock: ncaaGame.gameClock ?? null,
      });
      // Auto-advance bracket winner when game transitions to final
      if (ncaaGame.gameStatus === 'final' && dbGame.gameStatus !== 'final') {
        void advanceBracketWinner(dbGame.id);
      }
      updated++;
    }
    console.log(`[ScoreRefresh] Updated scores for ${updated} NCAAM games (${todayStr})`);
  } catch (err) {
    console.warn("[ScoreRefresh] Score refresh failed (non-fatal):", err);
  }
}

const SCORE_INTERVAL_MS = 15 * 1000; // 15 seconds
const MLB_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes — MLB scores + splits + AN odds

/**
 * Refreshes NBA live/final scores and game status from the NBA live scoreboard API.
 * Runs every 15 seconds so live scores stay current.
 */
async function refreshNbaScores(): Promise<void> {
  const todayStr = datePst();
  try {
    const liveGames = await fetchNbaLiveScores();
    const existing = await listGamesByDate(todayStr, "NBA");

    let updated = 0;
    for (const liveGame of liveGames) {
      // Match by away+home DB slugs
      const dbGame = existing.find(
        g => g.awayTeam === liveGame.awayDbSlug && g.homeTeam === liveGame.homeDbSlug
      );
      if (!dbGame) continue;

      // Only update if status or scores have changed
      const statusChanged = dbGame.gameStatus !== liveGame.gameStatus;
      const scoresChanged =
        dbGame.awayScore !== liveGame.awayScore ||
        dbGame.homeScore !== liveGame.homeScore ||
        dbGame.gameClock !== liveGame.gameClock;

      if (!statusChanged && !scoresChanged) continue;

      await updateNcaaStartTime(dbGame.id, {
        startTimeEst: dbGame.startTimeEst,
        ncaaContestId: dbGame.ncaaContestId ?? '',
        gameStatus: liveGame.gameStatus,
        awayScore: liveGame.awayScore,
        homeScore: liveGame.homeScore,
        gameClock: liveGame.gameClock,
      });
      updated++;
    }
    console.log(`[ScoreRefresh] Updated scores for ${updated} NBA games (${todayStr})`);
  } catch (err) {
    console.warn("[ScoreRefresh] NBA score refresh failed (non-fatal):", err);
  }
}

async function refreshNhlScores(): Promise<void> {
  const todayStr = datePst();
  try {
    const liveGames = await fetchNhlLiveScores();
    const existing = await listGamesByDate(todayStr, "NHL");
    let updated = 0;
    for (const liveGame of liveGames) {
      // Match by away+home DB slugs
      const dbGame = existing.find(
        (g) => g.awayTeam === liveGame.awayDbSlug && g.homeTeam === liveGame.homeDbSlug
      );
      if (!dbGame) continue;
      // Only update if status or scores have changed
      const statusChanged = dbGame.gameStatus !== liveGame.gameState;
      const scoresChanged =
        dbGame.awayScore !== liveGame.awayScore ||
        dbGame.homeScore !== liveGame.homeScore ||
        dbGame.gameClock !== liveGame.gameClock;
      if (!statusChanged && !scoresChanged) continue;
      await updateNcaaStartTime(dbGame.id, {
        startTimeEst: dbGame.startTimeEst,
        ncaaContestId: dbGame.ncaaContestId ?? "",
        gameStatus: liveGame.gameState,
        awayScore: liveGame.awayScore,
        homeScore: liveGame.homeScore,
        gameClock: liveGame.gameClock,
      });
      updated++;
    }
    console.log(`[ScoreRefresh] Updated scores for ${updated} NHL games (${todayStr})`);
  } catch (err) {
    console.warn("[ScoreRefresh] NHL score refresh failed (non-fatal):", err);
  }
}

/**
 * MLB score refresh — fetches live scores from MLB Stats API for today.
 * Runs every 10 minutes (same interval as MLB odds/splits refresh).
 */
async function refreshMlbScoresNow(): Promise<void> {
  const todayStr = datePst();
  try {
    const { refreshMlbScores } = await import("./mlbScoreRefresh");
    const result = await refreshMlbScores(todayStr);
    console.log(
      `[ScoreRefresh][MLB] ✅ ${todayStr}: updated=${result.updated} unchanged=${result.unchanged} ` +
      `noMatch=${result.noMatch} errors=${result.errors.length}`
    );
    if (result.errors.length > 0) {
      console.warn(`[ScoreRefresh][MLB] Errors:`, result.errors);
    }
  } catch (err) {
    console.warn("[ScoreRefresh][MLB] MLB score refresh failed (non-fatal):", err);
  }
}

/**
 * Runs NCAAM, NBA, NHL, and MLB score refreshes immediately.
 * Exported so it can be triggered manually from the admin panel.
 */
export async function refreshAllScoresNow(): Promise<void> {
  await Promise.allSettled([
    refreshNcaamScores(),
    refreshNbaScores(),
    refreshNhlScores(),
    refreshMlbScoresNow(),
  ]);
  lastScoresRefreshedAt = new Date().toISOString();
  // Patch scoresRefreshedAt into the last refresh result so the UI can show it
  if (lastRefreshResult) {
    lastRefreshResult = { ...lastRefreshResult, scoresRefreshedAt: lastScoresRefreshedAt };
  }
}

/**
 * Manual refresh variant — same as runVsinRefresh() but passes source='manual'
 * to refreshAnApiOdds so every odds snapshot is tagged as a manual trigger.
 * Called by the owner's "Refresh Now" button in Publish Projections.
 *
 * @param sport - Optional sport scope: 'NCAAM' | 'NBA' | 'NHL'. When provided, only that
 *                sport's VSiN data and AN odds are refreshed. When omitted, all three sports
 *                are refreshed (legacy full-refresh behaviour).
 */
export async function runVsinRefreshManual(
  sport?: "NCAAM" | "NBA" | "NHL" | "MLB"
): Promise<RefreshResult | null> {
  const todayStr = datePst();
  const sportLabel = sport ?? "ALL";

  console.log(
    `[VSiNAutoRefresh][MANUAL][${sportLabel}] ════════════════════════════════════════`
  );
  console.log(
    `[VSiNAutoRefresh][MANUAL][${sportLabel}] Starting manual refresh — today: ${todayStr} | scope: ${sportLabel}`
  );
  console.log(
    `[VSiNAutoRefresh][MANUAL][${sportLabel}] ════════════════════════════════════════`
  );

  try {
    const rangeEnd = datePst(RANGE_DAYS_AHEAD);
    const allDates = dateRange(todayStr, rangeEnd);

    // ── Per-sport VSiN splits + schedule refresh ──────────────────────────────────────────
    const doNcaam = !sport || sport === "NCAAM";
    const doNba   = !sport || sport === "NBA";
    const doNhl   = !sport || sport === "NHL";
    const doMlb   = !sport || sport === "MLB";

    let ncaamResult = { updated: 0, inserted: 0, ncaaInserted: 0, total: 0 };
    let nbaResult   = { updated: 0, inserted: 0, scheduleInserted: 0, total: 0 };
    let nhlResult   = { updated: 0, inserted: 0, scheduleInserted: 0, total: 0 };

    if (doNcaam) {
      console.log(`[VSiNAutoRefresh][MANUAL][NCAAM] ── Refreshing NCAAM VSiN splits + schedule…`);
      ncaamResult = await refreshNcaam(todayStr, allDates);
      console.log(
        `[VSiNAutoRefresh][MANUAL][NCAAM] ✓ VSiN done — ` +
        `updated=${ncaamResult.updated} inserted=${ncaamResult.inserted} ` +
        `ncaaInserted=${ncaamResult.ncaaInserted} total=${ncaamResult.total}`
      );
    } else {
      console.log(`[VSiNAutoRefresh][MANUAL][${sportLabel}] Skipping NCAAM VSiN refresh (not in scope)`);
    }

    if (doNba) {
      console.log(`[VSiNAutoRefresh][MANUAL][NBA] ── Refreshing NBA VSiN splits + schedule…`);
      nbaResult = await refreshNba(todayStr, allDates);
      console.log(
        `[VSiNAutoRefresh][MANUAL][NBA] ✓ VSiN done — ` +
        `updated=${nbaResult.updated} inserted=${nbaResult.inserted} ` +
        `scheduleInserted=${nbaResult.scheduleInserted} total=${nbaResult.total}`
      );
    } else {
      console.log(`[VSiNAutoRefresh][MANUAL][${sportLabel}] Skipping NBA VSiN refresh (not in scope)`);
    }

    if (doNhl) {
      console.log(`[VSiNAutoRefresh][MANUAL][NHL] ── Refreshing NHL VSiN splits + schedule…`);
      nhlResult = await refreshNhl(todayStr, allDates);
      console.log(
        `[VSiNAutoRefresh][MANUAL][NHL] ✓ VSiN done — ` +
        `updated=${nhlResult.updated} inserted=${nhlResult.inserted} ` +
        `scheduleInserted=${nhlResult.scheduleInserted} total=${nhlResult.total}`
      );
    } else {
      console.log(`[VSiNAutoRefresh][MANUAL][${sportLabel}] Skipping NHL VSiN refresh (not in scope)`);
    }

    // ── AN API DK odds refresh (scoped to active sport) ───────────────────────
    const anSports: AnSport[] = [];
    if (doNcaam) anSports.push("ncaab");
    if (doNba)   anSports.push("nba");
    if (doNhl)   anSports.push("nhl");
    if (doMlb)   anSports.push("mlb");

    // MLB VSiN splits refresh (manual)
    if (doMlb) {
      console.log(`[VSiNAutoRefresh][MANUAL][MLB] ── Refreshing MLB VSiN splits…`);
      const mlbResult = await refreshMlb(todayStr);
      console.log(
        `[VSiNAutoRefresh][MANUAL][MLB] ✓ MLB VSiN splits done — ` +
        `updated=${mlbResult.updated} total=${mlbResult.total}`
      );
    } else {
      console.log(`[VSiNAutoRefresh][MANUAL][${sportLabel}] Skipping MLB VSiN refresh (not in scope)`);
    }

    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ── AN API DK odds refresh for sports: [${anSports.join(", ")}]…`
    );
    const anOddsResult = await refreshAnApiOdds(todayStr, anSports, "manual");
    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ✓ AN API DK odds (today) — ` +
      `updated=${anOddsResult.updated} skipped=${anOddsResult.skipped} ` +
      `frozen=${anOddsResult.frozen} errors=${anOddsResult.errors.length}`
    );
    if (anOddsResult.errors.length > 0) {
      console.warn(
        `[VSiNAutoRefresh][MANUAL][${sportLabel}] AN API errors:`,
        anOddsResult.errors
      );
    }

    // ── NHL model sync (runs after odds refresh so book lines are fresh) ────────
    if (doNhl) {
      console.log(`[VSiNAutoRefresh][MANUAL][NHL] ── Running NHL model sync (manual trigger)…`);
      try {
        const { syncNhlModelForToday } = await import("./nhlModelSync");
        const nhlModelResult = await syncNhlModelForToday("manual");
        console.log(
          `[VSiNAutoRefresh][MANUAL][NHL] ✓ NHL model sync done — ` +
          `synced=${nhlModelResult.synced} skipped=${nhlModelResult.skipped} errors=${nhlModelResult.errors.length}`
        );
      } catch (nhlModelErr) {
        const msg = nhlModelErr instanceof Error ? nhlModelErr.message : String(nhlModelErr);
        console.error(`[VSiNAutoRefresh][MANUAL][NHL] ⚠ NHL model sync failed (non-fatal): ${msg}`);
      }
    }

    // ── Tomorrow's splits + DK odds (scoped) ─────────────────────────────────
    const tomorrowStr = datePst(1);
    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ── Pre-populating tomorrow (${tomorrowStr}) splits + DK odds…`
    );
    await runTomorrowSplitsUpdate(tomorrowStr);
    const anOddsTomorrow = await refreshAnApiOdds(tomorrowStr, anSports, "manual");
    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ✓ AN API DK odds (tomorrow) — ` +
      `updated=${anOddsTomorrow.updated} frozen=${anOddsTomorrow.frozen}`
    );

    const result: RefreshResult = {
      refreshedAt: new Date().toISOString(),
      scoresRefreshedAt: lastScoresRefreshedAt,
      updated: ncaamResult.updated,
      inserted: ncaamResult.inserted,
      ncaaInserted: ncaamResult.ncaaInserted,
      nbaUpdated: nbaResult.updated,
      nbaInserted: nbaResult.inserted,
      nbaScheduleInserted: nbaResult.scheduleInserted,
      total: ncaamResult.total,
      nbaTotal: nbaResult.total,
      nhlUpdated: nhlResult.updated,
      nhlInserted: nhlResult.inserted,
      nhlScheduleInserted: nhlResult.scheduleInserted,
      nhlTotal: nhlResult.total,
      gameDate: todayStr,
    };

    lastRefreshResult = result;
    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ════════════════════════════════════════`
    );
    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ✅ COMPLETE — ` +
      `NCAAM: ${ncaamResult.updated} updated | ` +
      `NBA: ${nbaResult.updated} updated | ` +
      `NHL: ${nhlResult.updated} updated | ` +
      `AN odds: ${anOddsResult.updated} updated, ${anOddsResult.frozen} frozen`
    );
    console.log(
      `[VSiNAutoRefresh][MANUAL][${sportLabel}] ════════════════════════════════════════`
    );
    return result;
  } catch (err) {
    console.error(`[VSiNAutoRefresh][MANUAL][${sportLabel}] ❌ Refresh failed:`, err);
    return null;
  }
}

/**
 * Start the hourly auto-refresh scheduler.
 * Active window: 3am–midnight PST (covers early morning line releases through end of night).
 * Fires immediately if inside the active window, then every 60 minutes.
 * Also starts a separate 15-second score-only refresh for live/final scores.
 * Score refresh fires immediately on startup so scores are never stale after a restart.
 *
 * Odds freeze: games with gameStatus='live' or 'final' are skipped by refreshAnApiOdds
 * so the pre-game DK NJ line is permanently locked in the DB once the game starts.
 */
export function startVsinAutoRefresh() {
  if (isWithinActiveHours()) {
    void runVsinRefresh();
  } else {
    console.log("[VSiNAutoRefresh] Outside active hours (14:01\u201304:59 UTC / 6:01 AM\u201311:59 PM EST) \u2014 waiting for next tick.");
  }

  // Fire score refresh immediately on startup (don't wait for first 15-sec tick)
  void refreshAllScoresNow();

  setInterval(() => {
    if (isWithinActiveHours()) {
      void runVsinRefresh();
       } else {
      console.log("[VSiNAutoRefresh] Tick skipped — outside active hours (14:01–04:59 UTC / 6:01 AM–11:59 PM EST).");
    }
  }, INTERVAL_MS);

  // 15-second score refresh (runs independently of the hourly full refresh)
  // NCAAM, NBA, NHL only — MLB has its own 10-minute cycle below
  setInterval(() => {
    if (isWithinActiveHours()) {
      void refreshNcaamScores();
      void refreshNbaScores();
      void refreshNhlScores();
    }
  }, SCORE_INTERVAL_MS);

  // ─── MLB 10-minute refresh cycle ──────────────────────────────────────────────
  // Runs every 10 minutes during active hours:
  //   1. MLB Stats API live scores (runs, hits, errors, inning, status, pitchers)
  //   2. VSiN MLB betting splits (run line, total, ML percentages)
  //   3. Action Network DK NJ odds (run line, total, ML lines)
  //
  // Fires immediately on startup so MLB data is never stale after a restart.
  // Non-fatal: each step is isolated; errors in one do not block the others.
  const runMlbCycle = async () => {
    if (!isWithinActiveHours()) {
      console.log("[MLBCycle] Tick skipped \u2014 outside active hours (14:01\u201304:59 UTC / 6:01 AM\u201311:59 PM EST).");
      return;
    }
    const todayStr = datePst();
    console.log(`[MLBCycle] ► START — ${new Date().toISOString()} | date: ${todayStr}`);

    // Step 1: Live scores from MLB Stats API
    try {
      await refreshMlbScoresNow();
    } catch (err) {
      console.warn("[MLBCycle] Score refresh failed (non-fatal):", err);
    }

    // Step 2: VSiN betting splits (run line, total, ML percentages)
    try {
      const mlbSplitsResult = await refreshMlb(todayStr);
      console.log(
        `[MLBCycle] VSiN splits: updated=${mlbSplitsResult.updated} total=${mlbSplitsResult.total}`
      );
    } catch (err) {
      console.warn("[MLBCycle] VSiN splits refresh failed (non-fatal):", err);
    }

    // Step 3: AN DK NJ odds (run line spread, total, moneyline)
    // Fetch both today AND tomorrow — MLB games are often seeded a day ahead
    // (e.g. today=March 24 but the game is on March 25).
    // Freeze is respected: live/final games are skipped so pre-game lines are locked.
    const mlbTomorrowStr = (() => {
      const d = new Date(todayStr + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    try {
      const [anToday, anTomorrow] = await Promise.all([
        refreshAnApiOdds(todayStr, ["mlb"], "auto"),
        refreshAnApiOdds(mlbTomorrowStr, ["mlb"], "auto"),
      ]);
      const totalUpdated = anToday.updated + anTomorrow.updated;
      const totalSkipped = anToday.skipped + anTomorrow.skipped;
      const totalFrozen = anToday.frozen + anTomorrow.frozen;
      const allErrors = [...anToday.errors, ...anTomorrow.errors];
      console.log(
        `[MLBCycle] AN DK odds: updated=${totalUpdated} skipped=${totalSkipped} ` +
        `frozen=${totalFrozen} errors=${allErrors.length}` +
        ` (today=${anToday.updated} tomorrow=${anTomorrow.updated})`
      );
      if (allErrors.length > 0) {
        console.warn("[MLBCycle] AN odds errors:", allErrors);
      }
    } catch (err) {
      console.warn("[MLBCycle] AN odds refresh failed (non-fatal):", err);
    }

    // Step 4: Rotowire daily lineups (pitchers, batting orders, weather, umpire)
    // Scrapes both today and tomorrow to catch games seeded a day ahead.
    try {
      const { scrapeRotowireLineupsBoth, upsertLineupsToDB } = await import("./rotowireLineupScraper");
      const lineupResult = await scrapeRotowireLineupsBoth();
      const totalParsed = lineupResult.today.cardsParsed + lineupResult.tomorrow.cardsParsed;
      const totalErrors = lineupResult.today.parseErrors + lineupResult.tomorrow.parseErrors;
      console.log(
        `[MLBCycle] Rotowire lineups: parsed=${totalParsed} ` +
        `(today=${lineupResult.today.cardsParsed} tomorrow=${lineupResult.tomorrow.cardsParsed}) ` +
        `parseErrors=${totalErrors}`
      );
      // Upsert all combined games to DB
      const upsertResult = await upsertLineupsToDB(lineupResult.combined);
      console.log(
        `[MLBCycle] Lineup DB upsert: saved=${upsertResult.saved} skipped=${upsertResult.skipped} errors=${upsertResult.errors}`
      );
    } catch (err) {
      console.warn("[MLBCycle] Rotowire lineup scrape failed (non-fatal):", err);
    }

    // Step 5: MLB model — run projections for all modelable games on today + tomorrow
    // Only runs when starters are confirmed (awayStartingPitcher + homeStartingPitcher populated)
    // Uses v2 field mapping: modelTotal=book O/U, awayModelSpread=±1.5 book RL, RL odds populated
    // Post-write validation gate flags any mismatch before publishing
    try {
      const { runMlbModelForDate } = await import("./mlbModelRunner");
      // Run model for today
      const todayResult = await runMlbModelForDate(todayStr);
      console.log(
        `[MLBCycle] Model (today): written=${todayResult.written} skipped=${todayResult.skipped} errors=${todayResult.errors} ` +
        `validation=${todayResult.validation.passed ? '✅ PASSED' : '❌ FAILED (' + todayResult.validation.issues.length + ' issues)'}`
      );
      if (!todayResult.validation.passed) {
        console.error('[MLBCycle] Validation issues (today):', todayResult.validation.issues);
      }
      // Run model for tomorrow (games seeded a day ahead)
      const tomorrowResult = await runMlbModelForDate(mlbTomorrowStr);
      console.log(
        `[MLBCycle] Model (tomorrow): written=${tomorrowResult.written} skipped=${tomorrowResult.skipped} errors=${tomorrowResult.errors} ` +
        `validation=${tomorrowResult.validation.passed ? '✅ PASSED' : '❌ FAILED (' + tomorrowResult.validation.issues.length + ' issues)'}`
      );
      if (!tomorrowResult.validation.passed) {
        console.error('[MLBCycle] Validation issues (tomorrow):', tomorrowResult.validation.issues);
      }
    } catch (err) {
      console.warn('[MLBCycle] MLB model run failed (non-fatal):', err);
    }
    console.log(`[MLBCycle] ✅ DONE — ${new Date().toISOString()}`);
  };
  // Fire MLB cycle immediately on startup
  void runMlbCycle();

  // Then repeat every 10 minutes
  setInterval(() => {
    void runMlbCycle();
  }, MLB_INTERVAL_MS);

  // ─── Daily MLB data seeders ───────────────────────────────────────────────
  // Schedule:
  //   • Pitcher stats (MLB Stats API)  — every 24h
  //   • Bullpen stats (MLB Stats API)  — every 24h
  //   • Pitcher rolling-5 blend        — every 24h
  //   • Team batting splits            — every 24h
  //   • Park factors (3yr rolling)     — every 7 days (slow-moving data)
  //   • Umpire modifiers (historical)  — every 7 days (slow-moving data)
  //
  // All fire immediately on startup so data is never stale after a restart.
  // Non-fatal: errors in one seeder do not block the others.

  // ── Pitcher stats (24h) ──────────────────────────────────────────────────
  const runPitcherStatsRefresh = async () => {
    try {
      const { seedPitcherStats } = await import("./seedPitcherStats");
      const result = await seedPitcherStats();
      console.log(
        `[PitcherStats] Daily refresh: total=${result.total} inserted=${result.inserted} ` +
        `updated=${result.updated} errors=${result.errors}`
      );
    } catch (err) {
      console.warn("[PitcherStats] Daily refresh failed (non-fatal):", err);
    }
  };
  void runPitcherStatsRefresh();
  setInterval(() => void runPitcherStatsRefresh(), 24 * 60 * 60 * 1000);

  // ── Bullpen stats (24h) ──────────────────────────────────────────────────
  const runBullpenStatsRefresh = async () => {
    try {
      const { seedBullpenStats } = await import("./seedBullpenStats");
      const result = await seedBullpenStats();
      console.log(
        `[BullpenStats] Daily refresh: inserted=${result.inserted} updated=${result.updated} errors=${result.errors}`
      );
    } catch (err) {
      console.warn("[BullpenStats] Daily refresh failed (non-fatal):", err);
    }
  };
  void runBullpenStatsRefresh();
  setInterval(() => void runBullpenStatsRefresh(), 24 * 60 * 60 * 1000);

  // ── Pitcher rolling-5 blend (24h) ────────────────────────────────────────
  const runPitcherRolling5Refresh = async () => {
    try {
      const { seedPitcherRolling5 } = await import("./seedPitcherRolling5");
      const result = await seedPitcherRolling5();
      console.log(
        `[PitcherRolling5] Daily refresh: total=${result.total} upserted=${result.upserted} noStarts=${result.noStarts} errors=${result.errors}`
      );
    } catch (err) {
      console.warn("[PitcherRolling5] Daily refresh failed (non-fatal):", err);
    }
  };
  void runPitcherRolling5Refresh();
  setInterval(() => void runPitcherRolling5Refresh(), 24 * 60 * 60 * 1000);

  // ── Team batting splits (24h) ────────────────────────────────────────────
  const runTeamBattingSplitsRefresh = async () => {
    try {
      const { seedTeamBattingSplits } = await import("./seedTeamBattingSplits");
      const result = await seedTeamBattingSplits();
      console.log(
        `[TeamBattingSplits] Daily refresh: total=${result.total} upserted=${result.upserted} errors=${result.errors}`
      );
    } catch (err) {
      console.warn("[TeamBattingSplits] Daily refresh failed (non-fatal):", err);
    }
  };
  void runTeamBattingSplitsRefresh();
  setInterval(() => void runTeamBattingSplitsRefresh(), 24 * 60 * 60 * 1000);

  // ── Park factors — 3yr rolling (7 days) ─────────────────────────────────
  // Park factors change slowly (season-level data). Weekly refresh is sufficient.
  const runParkFactorsRefresh = async () => {
    try {
      const { seedParkFactors } = await import("./seedParkFactors");
      const result = await seedParkFactors();
      console.log(
        `[ParkFactors] Weekly refresh: inserted=${result.inserted} updated=${result.updated} errors=${result.errors}`
      );
    } catch (err) {
      console.warn("[ParkFactors] Weekly refresh failed (non-fatal):", err);
    }
  };
  void runParkFactorsRefresh();
  setInterval(() => void runParkFactorsRefresh(), 7 * 24 * 60 * 60 * 1000);

  // ── Umpire modifiers — historical (7 days) ───────────────────────────────
  // Umpire data is historical and changes only when new games are completed.
  // Weekly refresh keeps it current without hammering the MLB Stats API.
  const runUmpireModifiersRefresh = async () => {
    try {
      const { seedUmpireModifiers } = await import("./seedUmpireModifiers");
      const result = await seedUmpireModifiers();
      console.log(
        `[UmpireModifiers] Weekly refresh: inserted=${result.inserted} updated=${result.updated} errors=${result.errors}`
      );
    } catch (err) {
      console.warn("[UmpireModifiers] Weekly refresh failed (non-fatal):", err);
    }
  };
  void runUmpireModifiersRefresh();
  setInterval(() => void runUmpireModifiersRefresh(), 7 * 24 * 60 * 60 * 1000);

  console.log(
    "[VSiNAutoRefresh] Scheduler started \u2014 " +
    "ALL SPORTS (NCAAM/NBA/NHL/MLB): every 10 min (14:01\u201304:59 UTC / 6:01 AM\u201311:59 PM EST) | " +
    "Score refresh: every 15 sec (NCAAM/NBA/NHL) | MLB: every 10 min (scores + splits + AN odds) | " +
    "MLB seeders: pitcher/bullpen/rolling5/batting-splits=24h | park-factors/umpires=7d"
  );
}

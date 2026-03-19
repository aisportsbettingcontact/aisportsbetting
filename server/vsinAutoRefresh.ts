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
import { scrapeVsinBettingSplits, type VsinSplitsGame } from "./vsinBettingSplitsScraper";
import { fetchNcaaGames, buildStartTimeMap } from "./ncaaScoreboard";
import { fetchNbaGamesForDate, buildNbaStartTimeMap, fetchNbaLiveScores } from "./nbaScoreboard";
import { fetchNhlGamesForRange, buildNhlStartTimeMap, buildNhlGameMap, fetchNhlLiveScores, type NhlScheduleGame } from "./nhlSchedule";
import { VALID_DB_SLUGS, BY_DB_SLUG, BY_VSIN_SLUG, BY_AN_SLUG as NCAAM_BY_AN, getTeamByAnSlug as getNcaamTeamByAnSlug } from "../shared/ncaamTeams";
import { NBA_VALID_DB_SLUGS, NBA_BY_VSIN_SLUG, NBA_BY_AN_SLUG, getNbaTeamByVsinSlug } from "../shared/nbaTeams";
import { NHL_VALID_DB_SLUGS, NHL_BY_ABBREV, NHL_BY_DB_SLUG, NHL_BY_VSIN_SLUG, NHL_BY_AN_SLUG, getNhlTeamByAnSlug } from "../shared/nhlTeams";
import { NBA_BY_DB_SLUG } from "../shared/nbaTeams";
import type { InsertGame } from "../drizzle/schema";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Rolling window: today through N days ahead
const RANGE_DAYS_AHEAD = 6; // fetch today + 6 more days = 7-day window

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
  const now = new Date();
  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  const hour = Number(pstFormatter.format(now));
  // Active window: 3am PST (hour=3) through midnight (hour=23)
  return hour >= 3 && hour < 24;
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

    // Process NCAAM (CBB)
    const cbbSplits = allSplits.filter(g => g.sport === "CBB");
    if (cbbSplits.length > 0) {
      const existingNcaam = await listGamesByDate(tomorrowStr, "NCAAM");
      let updated = 0;
      for (const g of cbbSplits) {
        const awayTeam = BY_VSIN_SLUG.get(g.awayVsinSlug) ?? BY_VSIN_SLUG.get(g.awayVsinSlug.replace(/-/g, '_'));
        const homeTeam = BY_VSIN_SLUG.get(g.homeVsinSlug) ?? BY_VSIN_SLUG.get(g.homeVsinSlug.replace(/-/g, '_'));
        if (!awayTeam || !homeTeam) continue;
        const dbGame = existingNcaam.find(e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug);
        if (!dbGame) continue;
        await updateBookOdds(dbGame.id, {
          spreadAwayBetsPct: g.spreadAwayBetsPct,
          spreadAwayMoneyPct: g.spreadAwayMoneyPct,
          totalOverBetsPct: g.totalOverBetsPct,
          totalOverMoneyPct: g.totalOverMoneyPct,
          mlAwayBetsPct: g.mlAwayBetsPct,
          mlAwayMoneyPct: g.mlAwayMoneyPct,
        });
        updated++;
      }
      console.log(`[VSiNAutoRefresh][Tomorrow][NCAAM] ${updated} games updated with tomorrow's splits`);
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
        const dbGame = existingNba.find(e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug);
        if (!dbGame) continue;
        await updateBookOdds(dbGame.id, {
          spreadAwayBetsPct: g.spreadAwayBetsPct,
          spreadAwayMoneyPct: g.spreadAwayMoneyPct,
          totalOverBetsPct: g.totalOverBetsPct,
          totalOverMoneyPct: g.totalOverMoneyPct,
          mlAwayBetsPct: g.mlAwayBetsPct,
          mlAwayMoneyPct: g.mlAwayMoneyPct,
        });
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
        const awayTeam = NHL_BY_VSIN_SLUG.get(g.awayVsinSlug);
        const homeTeam = NHL_BY_VSIN_SLUG.get(g.homeVsinSlug);
        if (!awayTeam || !homeTeam) continue;
        const dbGame = existingNhl.find(e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug);
        if (!dbGame) continue;
        await updateBookOdds(dbGame.id, {
          spreadAwayBetsPct: g.spreadAwayBetsPct,
          spreadAwayMoneyPct: g.spreadAwayMoneyPct,
          totalOverBetsPct: g.totalOverBetsPct,
          totalOverMoneyPct: g.totalOverMoneyPct,
          mlAwayBetsPct: g.mlAwayBetsPct,
          mlAwayMoneyPct: g.mlAwayMoneyPct,
        });
        updated++;
      }
      console.log(`[VSiNAutoRefresh][Tomorrow][NHL] ${updated} games updated with tomorrow's splits`);
    }

    // AN odds for tomorrow are ingested via ingestAnHtml tRPC procedure (paste AN HTML)
  } catch (err) {
    console.warn("[VSiNAutoRefresh][Tomorrow] Tomorrow splits update failed (non-fatal):", err);
  }
}

/// ─── NCAAM refresh ────────────────────────────────────────────

async function refreshNcaam(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  ncaaInserted: number;
  total: number;
}> {
  console.log(`[refreshNcaam] ► START — today: ${todayStr} | dates: [${allDates.join(", ")}]`);
  // Scrape VSiN CBB betting splits (today only)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    const allSplits = await scrapeVsinBettingSplits("front");
    vsinSplits = allSplits.filter(g => g.sport === "CBB");
    console.log(`[refreshNcaam] VSiN CBB splits fetched: ${vsinSplits.length} games`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN CBB splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup
  const vsinSplitsMap = new Map<string, VsinSplitsGame>();
  for (const g of vsinSplits) {
    const awayTeam = BY_VSIN_SLUG.get(g.awayVsinSlug) ?? BY_VSIN_SLUG.get(g.awayVsinSlug.replace(/-/g, '_'));
    const homeTeam = BY_VSIN_SLUG.get(g.homeVsinSlug) ?? BY_VSIN_SLUG.get(g.homeVsinSlug.replace(/-/g, '_'));
    if (awayTeam && homeTeam) {
      vsinSplitsMap.set(`${awayTeam.dbSlug}@${homeTeam.dbSlug}`, g);
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

  // Apply VSiN splits to today's existing NCAAM games
  let totalUpdated = 0;
  const existing = await listGamesByDate(todayStr, "NCAAM");
  for (const dbGame of existing) {
    const key = `${dbGame.awayTeam}@${dbGame.homeTeam}`;
    const splits = vsinSplitsMap.get(key);
    if (!splits) continue;
    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct: splits.spreadAwayBetsPct,
      spreadAwayMoneyPct: splits.spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct: splits.mlAwayBetsPct,
      mlAwayMoneyPct: splits.mlAwayMoneyPct,
    });
    totalUpdated++;
    console.log(
      `[VSiNAutoRefresh][NCAAM] Splits updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} ` +
      `spread=${splits.spreadAwayBetsPct}%/${splits.spreadAwayMoneyPct}% ` +
      `total=${splits.totalOverBetsPct}%/${splits.totalOverMoneyPct}% ` +
      `ml=${splits.mlAwayBetsPct}%/${splits.mlAwayMoneyPct}%`
    );
  }

  // NCAA-only game insertion (rolling 7-day window)
  let ncaaInserted = 0;
  let totalInserted = 0;

  for (const dateStr of allDates) {
    if (dateStr < todayStr) continue;

    const ncaaGames = ncaaGamesByDate.get(dateStr) ?? [];
    if (ncaaGames.length === 0) continue;

    const existingForDate = await listGamesByDate(dateStr, "NCAAM");
    // Cache for PST-date lookups (for late-night games that belong to a prior date)
    const existingByPstDate = new Map<string, Awaited<ReturnType<typeof listGamesByDate>>>();
    const startTimeMap = startTimeMaps.get(dateStr);

    for (const ncaaGame of ncaaGames) {
      const { contestId, awaySeoname, homeSeoname, startTimeEst, gameStatus, gameDatePst } = ncaaGame;

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
    const allSplits = await scrapeVsinBettingSplits("front");
    vsinSplits = allSplits.filter(g => g.sport === "NBA");
    console.log(`[refreshNba] VSiN NBA splits fetched: ${vsinSplits.length} games`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN NBA splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup
  // Use getNbaTeamByVsinSlug() which applies alias resolution (e.g. "la-clippers" → "los-angeles-clippers")
  const vsinSplitsMap = new Map<string, VsinSplitsGame>();
  for (const g of vsinSplits) {
    const awayTeam = getNbaTeamByVsinSlug(g.awayVsinSlug);
    const homeTeam = getNbaTeamByVsinSlug(g.homeVsinSlug);
    if (awayTeam && homeTeam) {
      vsinSplitsMap.set(`${awayTeam.dbSlug}@${homeTeam.dbSlug}`, g);
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
    const splits = vsinSplitsMap.get(key);
    if (!splits) continue;
    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct: splits.spreadAwayBetsPct,
      spreadAwayMoneyPct: splits.spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct: splits.mlAwayBetsPct,
      mlAwayMoneyPct: splits.mlAwayMoneyPct,
    });
    totalUpdated++;
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
    const allSplits = await scrapeVsinBettingSplits("front");
    vsinSplits = allSplits.filter(g => g.sport === "NHL");
    console.log(`[refreshNhl] VSiN NHL splits fetched: ${vsinSplits.length} games`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN NHL splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup
  const vsinSplitsMap = new Map<string, VsinSplitsGame>();
  for (const g of vsinSplits) {
    const awayTeam = NHL_BY_VSIN_SLUG.get(g.awayVsinSlug);
    const homeTeam = NHL_BY_VSIN_SLUG.get(g.homeVsinSlug);
    if (awayTeam && homeTeam) {
      vsinSplitsMap.set(`${awayTeam.dbSlug}@${homeTeam.dbSlug}`, g);
    } else {
      console.log(`[VSiNAutoRefresh][NHL] Unknown VSiN slug: ${g.awayVsinSlug} @ ${g.homeVsinSlug}`);
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
    const splits = vsinSplitsMap.get(key);
    if (!splits) continue;
    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct: splits.spreadAwayBetsPct,
      spreadAwayMoneyPct: splits.spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct: splits.mlAwayBetsPct,
      mlAwayMoneyPct: splits.mlAwayMoneyPct,
    });
    totalUpdated++;
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
      const dbSport = sport === "nba" ? "NBA" : sport === "nhl" ? "NHL" : "NCAAM";
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

        const dbGame = existingGames.find(
          e => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
        );

        if (!dbGame) {
          const msg = `[ANApiOdds][${dbSport}] NO_MATCH: ${awayDbSlug} @ ${homeDbSlug} on ${dateStr} (anId=${anGame.gameId})`;
          console.warn(msg);
          allErrors.push(msg);
          skipped++;
          continue;
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

        // ── NHL PUCK LINE FAVORITE CORRECTION ──────────────────────────────────
        // Use DK NJ spread as-is for all sports (including NHL puck lines)
        const dkAwaySpread = anGame.dkAwaySpread;
        const dkAwaySpreadOdds = anGame.dkAwaySpreadOdds;
        const dkHomeSpread = anGame.dkHomeSpread;
        const dkHomeSpreadOdds = anGame.dkHomeSpreadOdds;

        // Populate DK NJ current lines + Open lines
        await updateAnOdds(dbGame.id, {
          // DK NJ current line
          awayBookSpread: dkAwaySpread !== null ? String(dkAwaySpread) : null,
          awaySpreadOdds: dkAwaySpreadOdds,
          homeBookSpread: dkHomeSpread !== null ? String(dkHomeSpread) : null,
          homeSpreadOdds: dkHomeSpreadOdds,
          bookTotal: anGame.dkTotal !== null ? String(anGame.dkTotal) : null,
          overOdds: anGame.dkOverOdds,
          underOdds: anGame.dkUnderOdds,
          awayML: anGame.dkAwayML,
          homeML: anGame.dkHomeML,
          // Open line (only update if AN has open data)
          ...(anGame.openAwaySpread !== null ? {
            openAwaySpread: anGame.openAwaySpread !== null ? String(anGame.openAwaySpread) : null,
            openAwaySpreadOdds: anGame.openAwaySpreadOdds,
            openHomeSpread: anGame.openHomeSpread !== null ? String(anGame.openHomeSpread) : null,
            openHomeSpreadOdds: anGame.openHomeSpreadOdds,
            openTotal: anGame.openTotal !== null ? String(anGame.openTotal) : null,
            openAwayML: anGame.openAwayML,
            openHomeML: anGame.openHomeML,
          } : {}),
        });

        // ── ODDS HISTORY: snapshot the DK NJ lines we just wrote ─────────────
        await insertOddsHistory(
          dbGame.id,
          dbSport,
          source,
          {
            awaySpread: anGame.dkAwaySpread !== null ? String(anGame.dkAwaySpread) : null,
            awaySpreadOdds: anGame.dkAwaySpreadOdds,
            homeSpread: anGame.dkHomeSpread !== null ? String(anGame.dkHomeSpread) : null,
            homeSpreadOdds: anGame.dkHomeSpreadOdds,
            total: anGame.dkTotal !== null ? String(anGame.dkTotal) : null,
            overOdds: anGame.dkOverOdds,
            underOdds: anGame.dkUnderOdds,
            awayML: anGame.dkAwayML,
            homeML: anGame.dkHomeML,
          }
        );

        updated++;
        console.log(
          `[ANApiOdds][${dbSport}] Updated: ${awayDbSlug} @ ${homeDbSlug} (${dateStr}) source=${source} | ` +
          `spread=${anGame.dkAwaySpread}/${anGame.dkHomeSpread} ` +
          `total=${anGame.dkTotal} ` +
          `ml=${anGame.dkAwayML}/${anGame.dkHomeML}`
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

    // Auto-populate DK NJ current lines from Action Network API for today
    // (non-fatal — errors are logged but do not block the refresh)
    const anOddsResult = await refreshAnApiOdds(todayStr, ["ncaab", "nba", "nhl"], "auto");
    console.log(
      `[VSiNAutoRefresh] AN API DK odds: updated=${anOddsResult.updated} ` +
      `skipped=${anOddsResult.skipped} frozen=${anOddsResult.frozen} errors=${anOddsResult.errors.length}`
    );

    // Pre-populate tomorrow's splits and DK odds (non-fatal)
    const tomorrowStr = datePst(1);
    await runTomorrowSplitsUpdate(tomorrowStr);
    // Also populate tomorrow's DK odds from AN API (tomorrow games are never live, no freeze needed)
    const anOddsTomorrow = await refreshAnApiOdds(tomorrowStr, ["ncaab", "nba", "nhl"], "auto");
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
 * Runs NCAAM, NBA, and NHL score refreshes immediately.
 * Exported so it can be triggered manually from the admin panel.
 */
export async function refreshAllScoresNow(): Promise<void> {
  await Promise.allSettled([refreshNcaamScores(), refreshNbaScores(), refreshNhlScores()]);
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
  sport?: "NCAAM" | "NBA" | "NHL"
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

    // ── Per-sport VSiN splits + schedule refresh ──────────────────────────────
    const doNcaam = !sport || sport === "NCAAM";
    const doNba   = !sport || sport === "NBA";
    const doNhl   = !sport || sport === "NHL";

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
    console.log("[VSiNAutoRefresh] Outside active hours (3am–midnight PST) — waiting for next tick.");
  }

  // Fire score refresh immediately on startup (don't wait for first 15-sec tick)
  void refreshAllScoresNow();

  setInterval(() => {
    if (isWithinActiveHours()) {
      void runVsinRefresh();
    } else {
      console.log("[VSiNAutoRefresh] Tick skipped — outside active hours (3am–midnight PST).");
    }
  }, INTERVAL_MS);

  // 15-second score refresh (runs independently of the hourly full refresh)
  setInterval(() => {
    if (isWithinActiveHours()) {
      void refreshNcaamScores();
      void refreshNbaScores();
      void refreshNhlScores();
    }
  }, SCORE_INTERVAL_MS);

  console.log("[VSiNAutoRefresh] Scheduler started — every 60 min (3am–midnight PST) + score refresh every 15 sec.");
}

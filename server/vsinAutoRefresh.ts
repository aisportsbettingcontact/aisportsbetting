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

import { listGamesByDate, updateBookOdds, insertGames, getGameByNcaaContestId, updateNcaaStartTime } from "./db";
import { scrapeVsinBettingSplits, type VsinSplitsGame } from "./vsinBettingSplitsScraper";
import { fetchActionNetworkOdds, type AnGameOdds } from "./actionNetworkScraper";
import { fetchNcaaGames, buildStartTimeMap } from "./ncaaScoreboard";
import { fetchNbaGamesForDate, buildNbaStartTimeMap, fetchNbaLiveScores } from "./nbaScoreboard";
import { fetchNhlGamesForRange, buildNhlStartTimeMap, buildNhlGameMap, fetchNhlLiveScores, type NhlScheduleGame } from "./nhlSchedule";
import { VALID_DB_SLUGS, BY_DB_SLUG, BY_VSIN_SLUG, BY_AN_SLUG as NCAAM_BY_AN } from "../shared/ncaamTeams";
import { NBA_VALID_DB_SLUGS, NBA_BY_VSIN_SLUG, NBA_BY_AN_SLUG } from "../shared/nbaTeams";
import { NHL_VALID_DB_SLUGS, NHL_BY_ABBREV, NHL_BY_DB_SLUG, NHL_BY_VSIN_SLUG, NHL_BY_AN_SLUG } from "../shared/nhlTeams";
import { NBA_BY_DB_SLUG } from "../shared/nbaTeams";
import type { InsertGame } from "../drizzle/schema";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

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

/** Returns true if the current moment is inside 6am–midnight Pacific Time. */
function isWithinActiveHours(): boolean {
  const now = new Date();
  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  const hour = Number(pstFormatter.format(now));
  return hour >= 6 && hour < 24;
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

// ─── Action Network DraftKings odds helpers ───────────────────────────────────

/**
 * Applies DraftKings spread/total/ML/juice from Action Network to existing DB games.
 * Matches AN games to DB games by url_slug → dbSlug lookup.
 *
 * @param sport - "NCAAM" | "NBA" | "NHL"
 * @param dateStr - YYYY-MM-DD date to update
 * @param anGames - DraftKings odds from Action Network API
 */
async function applyActionNetworkOdds(
  sport: "NCAAM" | "NBA" | "NHL",
  dateStr: string,
  anGames: AnGameOdds[]
): Promise<{ updated: number; skipped: number }> {
  if (anGames.length === 0) return { updated: 0, skipped: 0 };

  const existing = await listGamesByDate(dateStr, sport);
  if (existing.length === 0) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;

  for (const an of anGames) {
    let awayDbSlug: string | undefined;
    let homeDbSlug: string | undefined;

    if (sport === "NCAAM") {
      awayDbSlug = NCAAM_BY_AN.get(an.awayUrlSlug)?.dbSlug;
      homeDbSlug = NCAAM_BY_AN.get(an.homeUrlSlug)?.dbSlug;
    } else if (sport === "NBA") {
      awayDbSlug = NBA_BY_AN_SLUG.get(an.awayUrlSlug)?.dbSlug;
      homeDbSlug = NBA_BY_AN_SLUG.get(an.homeUrlSlug)?.dbSlug;
    } else {
      // NHL
      awayDbSlug = NHL_BY_AN_SLUG.get(an.awayUrlSlug)?.dbSlug;
      homeDbSlug = NHL_BY_AN_SLUG.get(an.homeUrlSlug)?.dbSlug;
    }

    if (!awayDbSlug || !homeDbSlug) {
      console.log(
        `[ActionNetwork][${sport}] NO_SLUG: ${an.awayUrlSlug} @ ${an.homeUrlSlug} on ${dateStr} ` +
        `(away=${awayDbSlug ?? 'UNKNOWN'} home=${homeDbSlug ?? 'UNKNOWN'})`
      );
      skipped++;
      continue;
    }

    const dbGame = existing.find(
      e => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
    );

    if (!dbGame) {
      console.log(
        `[ActionNetwork][${sport}] NO_MATCH: ${awayDbSlug} @ ${homeDbSlug} on ${dateStr}`
      );
      skipped++;
      continue;
    }

    // Write all DK odds from Action Network:
    // - awayBookSpread/homeBookSpread/bookTotal: overwrite always (AN is authoritative for DK lines)
    // - awayML/homeML: overwrite always
    // - awaySpreadOdds/homeSpreadOdds/overOdds/underOdds: always update (juice from DK)
    await updateBookOdds(dbGame.id, {
      ...(an.dkAwaySpread != null ? {
        awayBookSpread: an.dkAwaySpread,
        homeBookSpread: an.dkHomeSpread,
      } : {}),
      ...(an.dkTotal != null ? { bookTotal: an.dkTotal } : {}),
      ...(an.dkAwayML != null ? {
        awayML: an.dkAwayML,
        homeML: an.dkHomeML,
      } : {}),
      ...(an.dkAwaySpreadOdds != null ? {
        awaySpreadOdds: an.dkAwaySpreadOdds,
        homeSpreadOdds: an.dkHomeSpreadOdds,
      } : {}),
      ...(an.dkOverOdds != null ? {
        overOdds: an.dkOverOdds,
        underOdds: an.dkUnderOdds,
      } : {}),
    });
    updated++;
    console.log(
      `[ActionNetwork][${sport}] Updated: ${dbGame.awayTeam} @ ${dbGame.homeTeam} (${dateStr}) | ` +
      `spread=${an.dkAwaySpread}/${an.dkHomeSpread} (${an.dkAwaySpreadOdds}/${an.dkHomeSpreadOdds}) ` +
      `total=${an.dkTotal} (${an.dkOverOdds}/${an.dkUnderOdds}) ` +
      `ml=${an.dkAwayML}/${an.dkHomeML}`
    );
  }

  return { updated, skipped };
}

/**
 * Fetches Action Network DraftKings odds for a sport and applies them to today's games.
 * Non-fatal — errors are caught and logged.
 */
async function runActionNetworkOddsUpdate(
  sport: "NCAAM" | "NBA" | "NHL",
  anSport: "ncaab" | "nba" | "nhl",
  todayStr: string
): Promise<void> {
  try {
    const anGames = await fetchActionNetworkOdds(anSport, todayStr);
    console.log(
      `[ActionNetwork][${sport}] ${anGames.length} games with DK odds for ${todayStr}`
    );
    const result = await applyActionNetworkOdds(sport, todayStr, anGames);
    console.log(
      `[ActionNetwork][${sport}] Done: ${result.updated} updated, ${result.skipped} skipped`
    );
  } catch (err) {
    console.error(`[ActionNetwork][${sport}] Odds update failed (non-fatal):`, err);
  }
}

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
        const awayTeam = NBA_BY_VSIN_SLUG.get(g.awayVsinSlug);
        const homeTeam = NBA_BY_VSIN_SLUG.get(g.homeVsinSlug);
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

    // Also apply AN odds for tomorrow
    await runActionNetworkOddsUpdate("NCAAM", "ncaab", tomorrowStr);
    await runActionNetworkOddsUpdate("NBA", "nba", tomorrowStr);
    await runActionNetworkOddsUpdate("NHL", "nhl", tomorrowStr);
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
  // Scrape VSiN CBB betting splits (today only)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    const allSplits = await scrapeVsinBettingSplits("front");
    vsinSplits = allSplits.filter(g => g.sport === "CBB");
    console.log(`[VSiNAutoRefresh] VSiN CBB splits: ${vsinSplits.length} games`);
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
    const startTimeMap = startTimeMaps.get(dateStr);

    for (const ncaaGame of ncaaGames) {
      const { contestId, awaySeoname, homeSeoname, startTimeEst, gameStatus } = ncaaGame;

      if (!VALID_DB_SLUGS.has(awaySeoname) || !VALID_DB_SLUGS.has(homeSeoname)) {
        if (awaySeoname !== "tba" && homeSeoname !== "tba") {
          console.log(`[VSiNAutoRefresh] Skipping non-D1 NCAA game: ${awaySeoname} @ ${homeSeoname}`);
        }
        continue;
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

      const bySlugCanonical = existingForDate.find(
        e => slugsMatch(e.awayTeam, awaySeoname) && slugsMatch(e.homeTeam, homeSeoname)
      );
      const bySlugReversed = !bySlugCanonical ? existingForDate.find(
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
        gameDate: dateStr,
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

  return { updated: totalUpdated, inserted: totalInserted, ncaaInserted, total: vsinSplits.length };
}

// ─── NBA refresh ──────────────────────────────────────────────────────────────

async function refreshNba(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  scheduleInserted: number;
  total: number;
}> {
  // Scrape VSiN NBA betting splits (today only)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    const allSplits = await scrapeVsinBettingSplits("front");
    vsinSplits = allSplits.filter(g => g.sport === "NBA");
    console.log(`[VSiNAutoRefresh] VSiN NBA splits: ${vsinSplits.length} games`);
  } catch (err) {
    console.warn("[VSiNAutoRefresh] VSiN NBA splits scrape failed (non-fatal):", err);
  }

  // Build a map: dbSlug pair → VsinSplitsGame for fast lookup
  const vsinSplitsMap = new Map<string, VsinSplitsGame>();
  for (const g of vsinSplits) {
    const awayTeam = NBA_BY_VSIN_SLUG.get(g.awayVsinSlug);
    const homeTeam = NBA_BY_VSIN_SLUG.get(g.homeVsinSlug);
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

  return { updated: totalUpdated, inserted: totalInserted, scheduleInserted, total: vsinSplits.length };
}

// ─── NHL Refresh ─────────────────────────────────────────────────────────────

async function refreshNhl(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  scheduleInserted: number;
  total: number;
}> {
  // Scrape VSiN NHL betting splits (today only)
  let vsinSplits: VsinSplitsGame[] = [];
  try {
    const allSplits = await scrapeVsinBettingSplits("front");
    vsinSplits = allSplits.filter(g => g.sport === "NHL");
    console.log(`[VSiNAutoRefresh] VSiN NHL splits: ${vsinSplits.length} games`);
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

  return { updated: totalUpdated, inserted: totalInserted, scheduleInserted, total: vsinSplits.length };
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

    // Apply DraftKings odds from Action Network for all three leagues
    // Runs after VSiN splits upserts so DB rows exist before we try to update them
    await runActionNetworkOddsUpdate("NCAAM", "ncaab", todayStr);
    await runActionNetworkOddsUpdate("NBA", "nba", todayStr);
    await runActionNetworkOddsUpdate("NHL", "nhl", todayStr);

    // Pre-populate tomorrow's splits and odds (non-fatal)
    const tomorrowStr = datePst(1);
    await runTomorrowSplitsUpdate(tomorrowStr);

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

    // Also fetch next-day midnight games (stored under today's date in DB)
    const nextDay = new Date(todayStr + "T00:00:00Z");
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayYyyymmdd = nextDay.toISOString().slice(0, 10).replace(/-/g, "");
    try {
      const nextDayGames = await fetchNcaaGames(nextDayYyyymmdd);
      const midnightGames = nextDayGames.filter(g => g.startTimeEst === "00:00");
      ncaaGames.push(...midnightGames);
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
 * Start the 30-minute auto-refresh scheduler.
 * Fires immediately if inside the active window, then every 30 minutes.
 * Also starts a separate 5-minute score-only refresh for live/final scores.
 * Score refresh fires immediately on startup so scores are never stale after a restart.
 */
export function startVsinAutoRefresh() {
  if (isWithinActiveHours()) {
    void runVsinRefresh();
  } else {
    console.log("[VSiNAutoRefresh] Outside active hours (6am–midnight PST) — waiting for next tick.");
  }

  // Fire score refresh immediately on startup (don't wait for first 5-min tick)
  void refreshAllScoresNow();

  setInterval(() => {
    if (isWithinActiveHours()) {
      void runVsinRefresh();
    } else {
      console.log("[VSiNAutoRefresh] Tick skipped — outside active hours (6am–midnight PST).");
    }
  }, INTERVAL_MS);

  // 5-minute score refresh (runs independently of the 30-min full refresh)
  setInterval(() => {
    if (isWithinActiveHours()) {
      void refreshNcaamScores();
      void refreshNbaScores();
      void refreshNhlScores();
    }
  }, SCORE_INTERVAL_MS);

  console.log("[VSiNAutoRefresh] Scheduler started — every 30 min (6am–midnight PST) + score refresh every 5 min.");
}

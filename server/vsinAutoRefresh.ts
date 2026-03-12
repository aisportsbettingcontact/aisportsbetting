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
import { scrapeVsinOdds } from "./vsinScraper";
import { scrapeNbaVsinOdds } from "./nbaVsinScraper";
import { fetchNcaaGames, buildStartTimeMap } from "./ncaaScoreboard";
import { fetchNbaGamesForDate, buildNbaStartTimeMap, fetchNbaLiveScores } from "./nbaScoreboard";
import { VALID_DB_SLUGS, BY_DB_SLUG } from "../shared/ncaamTeams";
import { NBA_VALID_DB_SLUGS } from "../shared/nbaTeams";
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

// ─── NCAAM refresh ────────────────────────────────────────────────────────────

async function refreshNcaam(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  ncaaInserted: number;
  total: number;
}> {
  // Scrape ALL NCAAM games currently on VSiN
  const allScraped = await scrapeVsinOdds("ALL");

  if (allScraped.length === 0) {
    console.log("[VSiNAutoRefresh] No NCAAM games returned from VSiN — skipping NCAAM step.");
    return { updated: 0, inserted: 0, ncaaInserted: 0, total: 0 };
  }

  // Filter: only today+future, only 365-team registry
  const relevantGames = allScraped.filter(g => {
    const d = yyyymmddToIso(String(g.gameDate ?? ""));
    if (d < todayStr) return false;
    if (!VALID_DB_SLUGS.has(g.awaySlug) || !VALID_DB_SLUGS.has(g.homeSlug)) {
      console.log(`[VSiNAutoRefresh] Skipping non-D1 NCAA game: ${g.awaySlug} @ ${g.homeSlug}`);
      return false;
    }
    return true;
  });

  console.log(
    `[VSiNAutoRefresh] NCAAM VSiN: ${allScraped.length} total | ` +
    `${relevantGames.length} relevant | ` +
    `${allScraped.length - relevantGames.length} past/non-D1 (ignored)`
  );

  const vsinDateSet = Array.from(new Set(relevantGames.map(g => yyyymmddToIso(String(g.gameDate ?? "")))));

  // Fetch NCAA start times for each relevant date
  const startTimeMaps = new Map<string, Map<string, string>>();
  const ncaaGamesByDate = new Map<string, Awaited<ReturnType<typeof fetchNcaaGames>>>();

  const rangeEnd = datePst(RANGE_DAYS_AHEAD);
  for (const dateStr of allDates) {
    try {
      const yyyymmdd = dateStr.replace(/-/g, "");
      const ncaaGames = await fetchNcaaGames(yyyymmdd);

      // NCAA API already places midnight ET games (00:00 ET) under the correct
      // calendar date — no next-day pull-back adjustment needed.
      startTimeMaps.set(dateStr, buildStartTimeMap(ncaaGames));
      ncaaGamesByDate.set(dateStr, ncaaGames);
      console.log(`[VSiNAutoRefresh] NCAA: ${ncaaGames.length} games for ${dateStr}`);
    } catch (ncaaErr) {
      console.warn(`[VSiNAutoRefresh] NCAA fetch failed for ${dateStr} (non-fatal):`, ncaaErr);
    }
  }

  let totalUpdated = 0;
  let totalInserted = 0;

  for (const dateStr of vsinDateSet) {
    const gamesForDate = relevantGames.filter(
      g => yyyymmddToIso(String(g.gameDate ?? "")) === dateStr
    );

    const existing = await listGamesByDate(dateStr, "NCAAM");
    const startTimeMap = startTimeMaps.get(dateStr);

    for (const scraped of gamesForDate) {
      const awaySlug = scraped.awaySlug;
      const homeSlug = scraped.homeSlug;

      const existingGameCanonical = existing.find(
        e => e.awayTeam === awaySlug && e.homeTeam === homeSlug
      ) ?? existing.find(
        e => slugsMatch(e.awayTeam, awaySlug) && slugsMatch(e.homeTeam, homeSlug)
      );
      // VSiN sometimes lists teams in reversed order vs NCAA.com — track if reversed
      const existingGameReversed = !existingGameCanonical ? existing.find(
        e => slugsMatch(e.awayTeam, homeSlug) && slugsMatch(e.homeTeam, awaySlug)
      ) : undefined;
      const existingGame = existingGameCanonical ?? existingGameReversed;
      // isReversedMatch=true means DB stores [bethune_cookman @ prairie_view] but VSiN scraped [prairie_view @ bethune_cookman]
      // In this case we MUST swap all team-directional odds before writing to DB
      const isReversedMatch = !existingGameCanonical && !!existingGameReversed;

      const startTimeKey = `${awaySlug}@${homeSlug}`;
      const startTimeEst = startTimeMap?.get(startTimeKey);

      // Look up NCAA game data — check both canonical and reversed team order
      // because VSiN sometimes lists teams in opposite home/away order vs NCAA.com
      const ncaaGamesForDate = ncaaGamesByDate.get(dateStr) ?? [];
      const ncaaGame = ncaaGamesForDate.find(
        g => g.awaySeoname === awaySlug && g.homeSeoname === homeSlug
      ) ?? ncaaGamesForDate.find(
        // Reversed order: VSiN away=X home=Y but NCAA has away=Y home=X
        g => g.awaySeoname === homeSlug && g.homeSeoname === awaySlug
      ) ?? ncaaGamesForDate.find(
        // Fuzzy slug match (handles minor slug format differences)
        g => slugsMatch(g.awaySeoname, awaySlug) && slugsMatch(g.homeSeoname, homeSlug)
      ) ?? ncaaGamesForDate.find(
        // Fuzzy + reversed
        g => slugsMatch(g.awaySeoname, homeSlug) && slugsMatch(g.homeSeoname, awaySlug)
      );

      const ncaaContestId = ncaaGame?.contestId ?? null;
      const ncaaGameStatus = ncaaGame?.gameStatus;

      // Detailed merge decision logging
      const matchType = !ncaaGame ? 'NO_NCAA_MATCH'
        : (ncaaGame.awaySeoname === awaySlug ? 'EXACT' : 'REVERSED');
      console.log(
        `[VSiNAutoRefresh][MERGE] ${awaySlug}@${homeSlug} (${dateStr}) | ` +
        `existingGame=${existingGame ? existingGame.id : 'NEW'} | ` +
        `ncaaMatch=${matchType} | ` +
        `startTime=${startTimeEst ?? 'TBD'} | ` +
        `contestId=${ncaaContestId ?? 'null'} | ` +
        `status=${ncaaGameStatus ?? 'null'}`
      );

      if (existingGame) {
        // ─── REVERSED-MATCH ODDS SWAP ────────────────────────────────────────────
        // When VSiN lists teams in opposite order vs DB (which uses NCAA ordering),
        // the scraped "away" odds actually belong to the DB "home" team and vice versa.
        // Example: DB has bethune_cookman(AWAY) @ prairie_view(HOME)
        //          VSiN has prairie_view(AWAY, +5.5) @ bethune_cookman(HOME, -5.5)
        //          Without swap: bethune_cookman gets +5.5 ← WRONG (they are the favorite)
        //          With swap:    bethune_cookman gets -5.5 ← CORRECT
        //
        // Swap logic:
        //   awaySpread ↔ homeSpread  (spread is team-directional)
        //   awayML ↔ homeML          (ML is team-directional)
        //   spreadAwayBetsPct → 100 - value (VSiN away% becomes DB home%)
        //   spreadAwayMoneyPct → 100 - value
        //   mlAwayBetsPct → 100 - value
        //   mlAwayMoneyPct → 100 - value
        //   totalOverBetsPct, totalOverMoneyPct → unchanged (not team-specific)
        const oddsToWrite = isReversedMatch ? {
          awayBookSpread: scraped.homeSpread,   // VSiN home spread → DB away spread
          homeBookSpread: scraped.awaySpread,   // VSiN away spread → DB home spread
          bookTotal: scraped.total,
          sortOrder: scraped.vsinRowIndex,
          ...(startTimeEst ? { startTimeEst } : {}),
          spreadAwayBetsPct: scraped.spreadAwayBetsPct !== null ? 100 - scraped.spreadAwayBetsPct : null,
          spreadAwayMoneyPct: scraped.spreadAwayMoneyPct !== null ? 100 - scraped.spreadAwayMoneyPct : null,
          totalOverBetsPct: scraped.totalOverBetsPct,
          totalOverMoneyPct: scraped.totalOverMoneyPct,
          awayML: scraped.homeML,               // VSiN home ML → DB away ML
          homeML: scraped.awayML,               // VSiN away ML → DB home ML
          mlAwayBetsPct: scraped.mlAwayBetsPct !== null ? 100 - scraped.mlAwayBetsPct : null,
          mlAwayMoneyPct: scraped.mlAwayMoneyPct !== null ? 100 - scraped.mlAwayMoneyPct : null,
        } : {
          awayBookSpread: scraped.awaySpread,
          homeBookSpread: scraped.homeSpread,
          bookTotal: scraped.total,
          sortOrder: scraped.vsinRowIndex,
          ...(startTimeEst ? { startTimeEst } : {}),
          // NCAAM betting splits (8 fields: spread + total + ML)
          spreadAwayBetsPct: scraped.spreadAwayBetsPct,
          spreadAwayMoneyPct: scraped.spreadAwayMoneyPct,
          totalOverBetsPct: scraped.totalOverBetsPct,
          totalOverMoneyPct: scraped.totalOverMoneyPct,
          awayML: scraped.awayML,
          homeML: scraped.homeML,
          mlAwayBetsPct: scraped.mlAwayBetsPct,
          mlAwayMoneyPct: scraped.mlAwayMoneyPct,
        };
        if (isReversedMatch) {
          console.log(
            `[VSiNAutoRefresh][REVERSED_SWAP] ${awaySlug}@${homeSlug} → DB is ${existingGame.awayTeam}@${existingGame.homeTeam} | ` +
            `Swapping: awaySpread ${scraped.awaySpread}→${oddsToWrite.awayBookSpread}, homeSpread ${scraped.homeSpread}→${oddsToWrite.homeBookSpread} | ` +
            `awayML ${scraped.awayML}→${oddsToWrite.awayML}, homeML ${scraped.homeML}→${oddsToWrite.homeML} | ` +
            `spreadAwayBets% ${scraped.spreadAwayBetsPct}→${oddsToWrite.spreadAwayBetsPct} | ` +
            `mlAwayBets% ${scraped.mlAwayBetsPct}→${oddsToWrite.mlAwayBetsPct}`
          );
        }
        await updateBookOdds(existingGame.id, oddsToWrite);
        // Always update gameStatus, scores, and clock when we have NCAA data
        await updateNcaaStartTime(existingGame.id, {
          startTimeEst: startTimeEst ?? existingGame.startTimeEst,
          ncaaContestId: ncaaContestId ?? existingGame.ncaaContestId ?? '',
          ...(ncaaGameStatus ? { gameStatus: ncaaGameStatus } : {}),
          awayScore: ncaaGame?.awayScore ?? null,
          homeScore: ncaaGame?.homeScore ?? null,
          gameClock: ncaaGame?.gameClock ?? null,
        });
        totalUpdated++;
      } else {
        const row: InsertGame = {
          fileId: 0,
          gameDate: dateStr,
          startTimeEst: startTimeEst ?? "TBD",
          awayTeam: awaySlug,
          homeTeam: homeSlug,
          awayBookSpread: scraped.awaySpread !== null ? String(scraped.awaySpread) : null,
          homeBookSpread: scraped.homeSpread !== null ? String(scraped.homeSpread) : null,
          bookTotal: scraped.total !== null ? String(scraped.total) : null,
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
          sortOrder: scraped.vsinRowIndex,
          ncaaContestId: ncaaContestId ?? null,
          gameStatus: ncaaGameStatus ?? 'upcoming',
          awayScore: ncaaGame?.awayScore ?? null,
          homeScore: ncaaGame?.homeScore ?? null,
          gameClock: ncaaGame?.gameClock ?? null,
          // NCAAM betting splits (8 fields: spread + total + ML) — include on insert
          spreadAwayBetsPct: scraped.spreadAwayBetsPct,
          spreadAwayMoneyPct: scraped.spreadAwayMoneyPct,
          totalOverBetsPct: scraped.totalOverBetsPct,
          totalOverMoneyPct: scraped.totalOverMoneyPct,
          awayML: scraped.awayML,
          homeML: scraped.homeML,
          mlAwayBetsPct: scraped.mlAwayBetsPct,
          mlAwayMoneyPct: scraped.mlAwayMoneyPct,
        };
        await insertGames([row]);
        totalInserted++;
        console.log(
          `[VSiNAutoRefresh] Inserted NCAAM VSiN: ${scraped.awayTeam} @ ${scraped.homeTeam} (${dateStr})`
        );
      }
    }
  }

  // NCAA-only game insertion (rolling 7-day window)
  let ncaaInserted = 0;

  for (const dateStr of allDates) {
    if (dateStr < todayStr) continue;

    const ncaaGames = ncaaGamesByDate.get(dateStr) ?? [];
    if (ncaaGames.length === 0) continue;

    const existing = await listGamesByDate(dateStr, "NCAAM");

    for (const ncaaGame of ncaaGames) {
      const { contestId, awaySeoname, homeSeoname, startTimeEst, gameStatus } = ncaaGame;

      if (!VALID_DB_SLUGS.has(awaySeoname) || !VALID_DB_SLUGS.has(homeSeoname)) {
        if (awaySeoname !== "tba" && homeSeoname !== "tba") {
          console.log(`[VSiNAutoRefresh] Skipping non-D1 NCAA game: ${awaySeoname} @ ${homeSeoname}`);
        }
        continue;
      }

      // The NCAA API returns midnight ET games under the correct calendar date.
      // No date adjustment needed — store as-is.
      const effectiveDateStr = dateStr;

      const byContestId = await getGameByNcaaContestId(contestId);
      if (byContestId) {
        console.log(
          `[VSiNAutoRefresh][NCAA-ONLY] SKIP by contestId=${contestId}: ` +
          `${awaySeoname}@${homeSeoname} (${dateStr}) → DB id=${byContestId.id}`
        );
        continue;
      }

      const existingForEffectiveDate = existing;
      const bySlugCanonical = existingForEffectiveDate.find(
        e => slugsMatch(e.awayTeam, awaySeoname) && slugsMatch(e.homeTeam, homeSeoname)
      );
      const bySlugReversed = !bySlugCanonical ? existingForEffectiveDate.find(
        // Also check reversed order — VSiN may have inserted the game with swapped teams
        e => slugsMatch(e.awayTeam, homeSeoname) && slugsMatch(e.homeTeam, awaySeoname)
      ) : undefined;
      const bySlug = bySlugCanonical ?? bySlugReversed;

      if (bySlug) {
        const matchDir = bySlugReversed ? 'REVERSED' : 'CANONICAL';
        console.log(
          `[VSiNAutoRefresh][NCAA-ONLY] UPDATE ${matchDir} match: ` +
          `${awaySeoname}@${homeSeoname} (${dateStr}) → DB id=${bySlug.id} ` +
          `(DB: ${bySlug.awayTeam}@${bySlug.homeTeam}) | ` +
          `startTime=${startTimeEst} | status=${gameStatus} | ` +
          `score=${ncaaGame.awayScore}-${ncaaGame.homeScore}`
        );
        // Always update gameStatus, scores, and clock; also patch ncaaContestId if missing
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

      console.log(
        `[VSiNAutoRefresh][NCAA-ONLY] INSERT new: ${awaySeoname}@${homeSeoname} (${dateStr}) | ` +
        `contestId=${contestId} | startTime=${startTimeEst} | status=${gameStatus}`
      );

      const row: InsertGame = {
        fileId: 0,
        gameDate: effectiveDateStr,
        startTimeEst: startTimeEst ?? "TBD",
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
      console.log(
        `[VSiNAutoRefresh] Inserted NCAA-only: ${awaySeoname} @ ${homeSeoname} (${dateStr})`
      );
    }
  }

  return { updated: totalUpdated, inserted: totalInserted, ncaaInserted, total: relevantGames.length };
}

// ─── NBA refresh ──────────────────────────────────────────────────────────────

async function refreshNba(todayStr: string, allDates: string[]): Promise<{
  updated: number;
  inserted: number;
  scheduleInserted: number;
  total: number;
}> {
  // Scrape ALL NBA games currently on VSiN
  let allScraped;
  try {
    allScraped = await scrapeNbaVsinOdds("ALL");
  } catch (err) {
    console.error("[VSiNAutoRefresh] NBA VSiN scrape failed (non-fatal):", err);
    return { updated: 0, inserted: 0, scheduleInserted: 0, total: 0 };
  }

  if (allScraped.length === 0) {
    console.log("[VSiNAutoRefresh] No NBA games returned from VSiN — skipping NBA VSiN step.");
  }

  // Filter: only today+future, only 30-team registry
  const relevantGames = allScraped.filter(g => {
    const d = yyyymmddToIso(String(g.gameDate ?? ""));
    if (d < todayStr) return false;
    if (!NBA_VALID_DB_SLUGS.has(g.awaySlug) || !NBA_VALID_DB_SLUGS.has(g.homeSlug)) {
      console.log(`[VSiNAutoRefresh] Skipping unknown NBA team: ${g.awaySlug} @ ${g.homeSlug}`);
      return false;
    }
    return true;
  });

  console.log(
    `[VSiNAutoRefresh] NBA VSiN: ${allScraped.length} total | ` +
    `${relevantGames.length} relevant | ` +
    `${allScraped.length - relevantGames.length} past/unknown (ignored)`
  );

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

  let totalUpdated = 0;
  let totalInserted = 0;

  const vsinDateSet = Array.from(new Set(relevantGames.map(g => yyyymmddToIso(String(g.gameDate ?? "")))));

  for (const dateStr of vsinDateSet) {
    const gamesForDate = relevantGames.filter(
      g => yyyymmddToIso(String(g.gameDate ?? "")) === dateStr
    );

    const existing = await listGamesByDate(dateStr, "NBA");
    const startTimeMap = nbaStartTimeMaps.get(dateStr);

    for (const scraped of gamesForDate) {
      const awaySlug = scraped.awaySlug;
      const homeSlug = scraped.homeSlug;

      const existingGame = existing.find(
        e => e.awayTeam === awaySlug && e.homeTeam === homeSlug
      );

      const startTimeKey = `${awaySlug}@${homeSlug}`;
      const startTimeEst = startTimeMap?.get(startTimeKey);

      if (existingGame) {
        await updateBookOdds(existingGame.id, {
          awayBookSpread: scraped.awaySpread,
          homeBookSpread: scraped.homeSpread,
          bookTotal: scraped.total,
          sortOrder: scraped.vsinRowIndex,
          ...(startTimeEst ? { startTimeEst } : {}),
          // NBA betting splits (6 fields + ML odds)
          spreadAwayBetsPct: scraped.spreadAwayBetsPct,
          spreadAwayMoneyPct: scraped.spreadAwayMoneyPct,
          totalOverBetsPct: scraped.totalOverBetsPct,
          totalOverMoneyPct: scraped.totalOverMoneyPct,
          mlAwayBetsPct: scraped.mlAwayBetsPct,
          mlAwayMoneyPct: scraped.mlAwayMoneyPct,
          awayML: scraped.awayML,
          homeML: scraped.homeML,
        });
        totalUpdated++;
      } else {
        const row: InsertGame = {
          fileId: 0,
          gameDate: dateStr,
          startTimeEst: startTimeEst ?? "TBD",
          awayTeam: awaySlug,
          homeTeam: homeSlug,
          awayBookSpread: scraped.awaySpread !== null ? String(scraped.awaySpread) : null,
          homeBookSpread: scraped.homeSpread !== null ? String(scraped.homeSpread) : null,
          bookTotal: scraped.total !== null ? String(scraped.total) : null,
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
          sortOrder: scraped.vsinRowIndex,
          ncaaContestId: null,
          // NBA betting splits
          spreadAwayBetsPct: scraped.spreadAwayBetsPct,
          spreadAwayMoneyPct: scraped.spreadAwayMoneyPct,
          totalOverBetsPct: scraped.totalOverBetsPct,
          totalOverMoneyPct: scraped.totalOverMoneyPct,
          mlAwayBetsPct: scraped.mlAwayBetsPct,
          mlAwayMoneyPct: scraped.mlAwayMoneyPct,
          awayML: scraped.awayML,
          homeML: scraped.homeML,
        };
        await insertGames([row]);
        totalInserted++;
        console.log(
          `[VSiNAutoRefresh] Inserted NBA VSiN: ${scraped.awayTeam} @ ${scraped.homeTeam} (${dateStr})`
        );
      }
    }
  }

  // NBA schedule-only game insertion (rolling 7-day window)
  // Insert any NBA game from the schedule that isn't already in the DB
  let scheduleInserted = 0;

  for (const dateStr of allDates) {
    if (dateStr < todayStr) continue;

    const nbaGames = nbaGamesByDate.get(dateStr) ?? [];
    if (nbaGames.length === 0) continue;

    const existing = await listGamesByDate(dateStr, "NBA");

    for (const nbaGame of nbaGames) {
      const { awayDbSlug, homeDbSlug, startTimeEst, gameId } = nbaGame;

      // Skip if already in DB by slug match
      const bySlug = existing.find(
        e => e.awayTeam === awayDbSlug && e.homeTeam === homeDbSlug
      );
      if (bySlug) continue;

      // Also skip if already in DB by ncaaContestId (reusing the field for NBA game IDs)
      const byGameId = await getGameByNcaaContestId(gameId);
      if (byGameId) continue;

      const row: InsertGame = {
        fileId: 0,
        gameDate: dateStr,
        startTimeEst: startTimeEst ?? "TBD",
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
        ncaaContestId: gameId, // store NBA game ID in ncaaContestId for dedup
      };
      await insertGames([row]);
      scheduleInserted++;
      console.log(
        `[VSiNAutoRefresh] Inserted NBA schedule-only: ${awayDbSlug} @ ${homeDbSlug} (${dateStr})`
      );
    }
  }

  return { updated: totalUpdated, inserted: totalInserted, scheduleInserted, total: relevantGames.length };
}

// ─── Main refresh orchestrator ────────────────────────────────────────────────

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

    // Run NCAAM and NBA refreshes in sequence (share the same VSiN token)
    const ncaamResult = await refreshNcaam(todayStr, allDates);
    const nbaResult = await refreshNba(todayStr, allDates);

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

/**
 * Runs both NCAAM and NBA score refreshes immediately.
 * Exported so it can be triggered manually from the admin panel.
 */
export async function refreshAllScoresNow(): Promise<void> {
  await Promise.allSettled([refreshNcaamScores(), refreshNbaScores()]);
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
    }
  }, SCORE_INTERVAL_MS);

  console.log("[VSiNAutoRefresh] Scheduler started — every 30 min (6am–midnight PST) + score refresh every 5 min.");
}

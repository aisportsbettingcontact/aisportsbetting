/**
 * vsinAutoRefresh.ts
 *
 * Schedules a background job that runs every 30 minutes from 6am–midnight PST.
 *
 * On each tick it scrapes the VSiN CBB betting splits page and handles each
 * scraped game based on its date relative to today (PST):
 *
 *   PAST games    → ignored entirely
 *   TODAY games   → update book odds + sortOrder in DB for matching staging games
 *   FUTURE games  → auto-import as unpublished stubs if not already in DB
 *                   (model fields null, book odds null until VSiN has them)
 *
 * The last refresh result is stored in memory and exposed via
 * `trpc.books.lastRefresh` so the UI can show "Last updated HH:MM".
 */

import { listGamesByDate, updateBookOdds, insertGames } from "./db";
import { scrapeVsinOdds, matchTeam, normalizeTeamName } from "./vsinScraper";
import { fetchNcaaGames, buildStartTimeMap } from "./ncaaScoreboard";
import type { InsertGame } from "../drizzle/schema";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface RefreshResult {
  refreshedAt: string;  // ISO timestamp
  todayUpdated: number; // today's games matched + written
  todayTotal: number;   // today's games on VSiN
  futureImported: number; // new future games inserted
  gameDate: string;     // today YYYY-MM-DD (PST)
}

let lastRefreshResult: RefreshResult | null = null;

export function getLastRefreshResult(): RefreshResult | null {
  return lastRefreshResult;
}

/** Returns true if the current moment is inside 6am–midnight Pacific Time. */
function isWithinActiveHours(): boolean {
  const now = new Date();
  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  const hour = Number(pstFormatter.format(now)); // 0–23
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
  }); // "MM/DD/YYYY"
  const [mm, dd, yyyy] = str.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert YYYYMMDD string to YYYY-MM-DD */
function yyyymmddToIso(s: string): string {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Core refresh logic.
 * Safe to call at any time; errors are caught and logged.
 */
export async function runVsinRefresh(): Promise<RefreshResult | null> {
  const todayStr = datePst();          // e.g. "2026-03-04"
  const tomorrowStr = datePst(1);      // e.g. "2026-03-05"
  // Any date before today is "past"
  const todayLabel = todayStr.replace(/-/g, "");   // "20260304"

  console.log(`[VSiNAutoRefresh] Starting refresh — today: ${todayStr}`);

  try {
    // Scrape ALL games currently on VSiN (no date filter — we get everything)
    const allScraped = await scrapeVsinOdds("ALL");

    // Fetch NCAA start times for today and tomorrow (best-effort, non-fatal)
    let startTimeMaps: Map<string, Map<string, string>> = new Map();
    try {
      for (const dateStr of [todayStr, datePst(1)]) {
        const yyyymmdd = dateStr.replace(/-/g, "");
        const ncaaGames = await fetchNcaaGames(yyyymmdd);
        startTimeMaps.set(dateStr, buildStartTimeMap(ncaaGames));
        console.log(`[VSiNAutoRefresh] NCAA start times fetched for ${dateStr}: ${ncaaGames.length} games`);
      }
    } catch (ncaaErr) {
      console.warn("[VSiNAutoRefresh] NCAA start time fetch failed (non-fatal):", ncaaErr);
    }

    if (allScraped.length === 0) {
      console.log("[VSiNAutoRefresh] No games returned from VSiN — skipping.");
      return null;
    }

    // Partition scraped games by date
    const todayGames   = allScraped.filter(g => yyyymmddToIso(String(g.gameDate ?? "")) === todayStr);
    const futureGames  = allScraped.filter(g => {
      const d = yyyymmddToIso(String(g.gameDate ?? ""));
      return d > todayStr;
    });
    // Past games are simply ignored

    console.log(
      `[VSiNAutoRefresh] Scraped: ${allScraped.length} total | ` +
      `${todayGames.length} today | ${futureGames.length} future`
    );

    // ── 1. Update today's book odds ──────────────────────────────────────────
    let todayUpdated = 0;
    if (todayGames.length > 0) {
      const dbGames = await listGamesByDate(todayStr);
      for (const game of dbGames) {
        const match = todayGames.find(
          s => matchTeam(s.awayTeam, game.awayTeam) && matchTeam(s.homeTeam, game.homeTeam)
        );
        if (match) {
          const startTimeMap = startTimeMaps.get(todayStr);
          const startTimeKey = `${game.awayTeam}@${game.homeTeam}`;
          const startTimeEst = startTimeMap?.get(startTimeKey);
          await updateBookOdds(game.id, {
            awayBookSpread: match.awaySpread,
            homeBookSpread: match.homeSpread,
            bookTotal: match.total,
            sortOrder: match.vsinRowIndex,
            ...(startTimeEst ? { startTimeEst } : {}),
          });
          todayUpdated++;
        }
      }
    }

    // ── 2. Auto-import future games not yet in DB ────────────────────────────
    let futureImported = 0;
    // Group future games by date
    const futureDates = Array.from(new Set(futureGames.map(g => yyyymmddToIso(String(g.gameDate ?? "")))));

    for (const futureDate of futureDates) {
      const gamesForDate = futureGames.filter(
        g => yyyymmddToIso(String(g.gameDate ?? "")) === futureDate
      );
      const existing = await listGamesByDate(futureDate);

      for (const scraped of gamesForDate) {
        // Check if this matchup is already in DB
        const alreadyExists = existing.some(
          e => matchTeam(scraped.awayTeam, e.awayTeam) && matchTeam(scraped.homeTeam, e.homeTeam)
        );

        if (!alreadyExists) {
          // Insert as unpublished stub
          const futureStartTimeMap = startTimeMaps.get(futureDate);
          const futureStartKey = `${normalizeTeamName(scraped.awayTeam)}@${normalizeTeamName(scraped.homeTeam)}`;
          const futureStartTime = futureStartTimeMap?.get(futureStartKey) ?? "TBD";

          const row: InsertGame = {
            fileId: 0,
            gameDate: futureDate,
            startTimeEst: futureStartTime,
            awayTeam: normalizeTeamName(scraped.awayTeam),
            homeTeam: normalizeTeamName(scraped.homeTeam),
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
          };
          await insertGames([row]);
          futureImported++;
          console.log(
            `[VSiNAutoRefresh] Imported future game: ${scraped.awayTeam} @ ${scraped.homeTeam} (${futureDate})`
          );
        } else {
          // Update odds for existing future game if VSiN now has them
          const existing_game = existing.find(
            e => matchTeam(scraped.awayTeam, e.awayTeam) && matchTeam(scraped.homeTeam, e.homeTeam)
          );
          if (existing_game && (scraped.awaySpread !== null || scraped.total !== null)) {
            await updateBookOdds(existing_game.id, {
              awayBookSpread: scraped.awaySpread,
              homeBookSpread: scraped.homeSpread,
              bookTotal: scraped.total,
              sortOrder: scraped.vsinRowIndex,
            });
          }
        }
      }
    }

    const result: RefreshResult = {
      refreshedAt: new Date().toISOString(),
      todayUpdated,
      todayTotal: todayGames.length,
      futureImported,
      gameDate: todayStr,
    };

    lastRefreshResult = result;
    console.log(
      `[VSiNAutoRefresh] Done — today: ${todayUpdated}/${todayGames.length} updated, ` +
      `future: ${futureImported} new games imported.`
    );
    return result;
  } catch (err) {
    console.error("[VSiNAutoRefresh] Refresh failed:", err);
    return null;
  }
}

/**
 * Start the 30-minute auto-refresh scheduler.
 * Fires immediately if inside the active window, then every 30 minutes.
 */
export function startVsinAutoRefresh() {
  if (isWithinActiveHours()) {
    void runVsinRefresh();
  } else {
    console.log("[VSiNAutoRefresh] Outside active hours (6am–midnight PST) — waiting for next tick.");
  }

  setInterval(() => {
    if (isWithinActiveHours()) {
      void runVsinRefresh();
    } else {
      console.log("[VSiNAutoRefresh] Tick skipped — outside active hours (6am–midnight PST).");
    }
  }, INTERVAL_MS);

  console.log("[VSiNAutoRefresh] Scheduler started — every 30 min (6am–midnight PST).");
}

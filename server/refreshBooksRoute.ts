/**
 * GET /api/refresh-books?gameDate=YYYY-MM-DD  (defaults to today PST)
 *
 * Server-Sent Events endpoint. Streams one JSON event per game as its
 * book odds AND betting splits are scraped from VSiN and written to the DB.
 *
 * Handles both NCAAM (scrapeVsinOdds) and NBA (scrapeNbaVsinOdds) games.
 *
 * Event format:
 *   data: {"type":"start","total":40}
 *   data: {"type":"game","index":1,"total":40,"awayTeam":"Creighton","homeTeam":"Butler","awaySpread":-3.5,"homeSpread":3.5,"total":148.5,"status":"ok"}
 *   data: {"type":"game","index":2,...,"status":"no_match"}
 *   data: {"type":"done","updated":38,"total":40}
 *   data: {"type":"error","message":"..."}
 */

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { listStagingGames, updateBookOdds, getAppUserById } from "./db";
import { scrapeVsinOdds } from "./vsinScraper";
import { scrapeNbaVsinOdds } from "./nbaVsinScraper";

const APP_USER_COOKIE = "app_session";

async function verifyOwnerSession(req: Request): Promise<boolean> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies[APP_USER_COOKIE];
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "app_user" || payload.role !== "owner") return false;
    const user = await getAppUserById(Number(payload.sub));
    return !!(user && user.hasAccess);
  } catch {
    return false;
  }
}

export function registerRefreshBooksRoute(app: Express) {
  app.get("/api/refresh-books", async (req: Request, res: Response) => {
    // ── Auth: owner-only ──────────────────────────────────────────────────────
    const authed = await verifyOwnerSession(req);
    if (!authed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Default to today in Pacific Time if no date provided
    const todayPst = new Date().toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2"); // MM/DD/YYYY → YYYY-MM-DD
    const gameDate = (req.query.gameDate as string) || todayPst;

    // ── SSE headers ───────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    };

    try {
      // 1. Load all games for this date (NCAAM + NBA)
      const allGames = await listStagingGames(gameDate);

      if (allGames.length === 0) {
        send({ type: "error", message: "No games found for " + gameDate });
        res.end();
        return;
      }

      send({ type: "start", total: allGames.length });

      // 2. Scrape VSiN for both sports — keep SSE alive with a heartbeat while Puppeteer loads
      send({ type: "scraping", message: "Loading VSiN betting splits… (up to 90s)" });
      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
        if (typeof (res as any).flush === "function") (res as any).flush();
      }, 10000);

      const dateLabel = gameDate.replace(/-/g, "");
      let scrapedNcaam: Awaited<ReturnType<typeof scrapeVsinOdds>> = [];
      let scrapedNba: Awaited<ReturnType<typeof scrapeNbaVsinOdds>> = [];

      try {
        // Scrape NCAAM and NBA in parallel for speed
        [scrapedNcaam, scrapedNba] = await Promise.all([
          scrapeVsinOdds(dateLabel).catch(err => {
            console.error("[RefreshBooks] NCAAM scrape failed:", err);
            return [];
          }),
          scrapeNbaVsinOdds(dateLabel).catch(err => {
            console.error("[RefreshBooks] NBA scrape failed:", err);
            return [];
          }),
        ]);
      } finally {
        clearInterval(heartbeat);
      }

      // 3. Match each DB game to a scraped game and write odds + splits
      let updated = 0;
      for (let i = 0; i < allGames.length; i++) {
        const game = allGames[i];
        const isNba = game.sport === "NBA";

        if (isNba) {
          // NBA: match against NBA scraped data
          const match = scrapedNba.find(
            (s) => s.awaySlug === game.awayTeam && s.homeSlug === game.homeTeam
          );

          if (match) {
            await updateBookOdds(game.id, {
              awayBookSpread: match.awaySpread,
              homeBookSpread: match.homeSpread,
              bookTotal: match.total,
              // NBA betting splits (6 fields + ML odds)
              spreadAwayBetsPct: match.spreadAwayBetsPct,
              spreadAwayMoneyPct: match.spreadAwayMoneyPct,
              totalOverBetsPct: match.totalOverBetsPct,
              totalOverMoneyPct: match.totalOverMoneyPct,
              mlAwayBetsPct: match.mlAwayBetsPct,
              mlAwayMoneyPct: match.mlAwayMoneyPct,
              awayML: match.awayML,
              homeML: match.homeML,
            });
            updated++;
            send({
              type: "game",
              index: i + 1,
              total: allGames.length,
              sport: "NBA",
              awayTeam: game.awayTeam,
              homeTeam: game.homeTeam,
              awaySpread: match.awaySpread,
              homeSpread: match.homeSpread,
              bookTotal: match.total,
              splitsUpdated: true,
              status: "ok",
            });
          } else {
            send({
              type: "game",
              index: i + 1,
              total: allGames.length,
              sport: "NBA",
              awayTeam: game.awayTeam,
              homeTeam: game.homeTeam,
              awaySpread: null,
              homeSpread: null,
              bookTotal: null,
              splitsUpdated: false,
              status: "no_match",
            });
          }
        } else {
          // NCAAM: match against NCAAM scraped data
          const match = scrapedNcaam.find(
            (s) => s.awaySlug === game.awayTeam && s.homeSlug === game.homeTeam
          );

          if (match) {
            await updateBookOdds(game.id, {
              awayBookSpread: match.awaySpread,
              homeBookSpread: match.homeSpread,
              bookTotal: match.total,
              // NCAAM betting splits (4 fields)
              spreadAwayBetsPct: match.spreadAwayBetsPct,
              spreadAwayMoneyPct: match.spreadAwayMoneyPct,
              totalOverBetsPct: match.totalOverBetsPct,
              totalOverMoneyPct: match.totalOverMoneyPct,
            });
            updated++;
            send({
              type: "game",
              index: i + 1,
              total: allGames.length,
              sport: "NCAAM",
              awayTeam: game.awayTeam,
              homeTeam: game.homeTeam,
              awaySpread: match.awaySpread,
              homeSpread: match.homeSpread,
              bookTotal: match.total,
              splitsUpdated: true,
              status: "ok",
            });
          } else {
            send({
              type: "game",
              index: i + 1,
              total: allGames.length,
              sport: "NCAAM",
              awayTeam: game.awayTeam,
              homeTeam: game.homeTeam,
              awaySpread: null,
              homeSpread: null,
              bookTotal: null,
              splitsUpdated: false,
              status: "no_match",
            });
          }
        }
      }

      send({ type: "done", updated, total: allGames.length, refreshedAt: new Date().toISOString() });
    } catch (err: any) {
      send({ type: "error", message: err?.message ?? "Unknown error" });
    } finally {
      res.end();
    }
  });
}

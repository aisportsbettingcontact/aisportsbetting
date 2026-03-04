/**
 * GET /api/refresh-books?gameDate=2026-03-04
 *
 * Server-Sent Events endpoint. Streams one JSON event per game as its
 * book odds are scraped from VSiN and written to the DB.
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
import { scrapeVsinOdds, matchTeam } from "./vsinScraper";

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

    const gameDate = (req.query.gameDate as string) || "2026-03-04";

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
      // 1. Load all games for this date
      const allGames = await listStagingGames(gameDate);

      if (allGames.length === 0) {
        send({ type: "error", message: "No games found for " + gameDate });
        res.end();
        return;
      }

      send({ type: "start", total: allGames.length });

      // 2. Scrape VSiN — keep SSE alive with a heartbeat while Puppeteer loads
      send({ type: "scraping", message: "Loading VSiN betting splits… (up to 60s)" });
      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
        if (typeof (res as any).flush === "function") (res as any).flush();
      }, 10000);

      let scraped;
      try {
        // Use "Mar 4" style date label — derive from gameDate (e.g. "2026-03-04" → "Mar 4")
        const d = new Date(gameDate + "T12:00:00Z");
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const dateLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`;
        scraped = await scrapeVsinOdds(dateLabel);
      } finally {
        clearInterval(heartbeat);
      }

      // 3. Match each DB game to a scraped game by team name
      let updated = 0;
      for (let i = 0; i < allGames.length; i++) {
        const game = allGames[i];

        // Find the scraped entry where both away and home team names match
        const match = scraped.find(
          (s) =>
            matchTeam(s.awayTeam, game.awayTeam) &&
            matchTeam(s.homeTeam, game.homeTeam)
        );

        if (match) {
          await updateBookOdds(game.id, {
            awayBookSpread: match.awaySpread,
            homeBookSpread: match.homeSpread,
            bookTotal: match.total,
          });
          updated++;
          send({
            type: "game",
            index: i + 1,
            total: allGames.length,
            awayTeam: game.awayTeam,
            homeTeam: game.homeTeam,
            awaySpread: match.awaySpread,
            homeSpread: match.homeSpread,
            bookTotal: match.total,
            status: "ok",
          });
        } else {
          send({
            type: "game",
            index: i + 1,
            total: allGames.length,
            awayTeam: game.awayTeam,
            homeTeam: game.homeTeam,
            awaySpread: null,
            homeSpread: null,
            bookTotal: null,
            status: "no_match",
          });
        }
      }

      send({ type: "done", updated, total: allGames.length });
    } catch (err: any) {
      send({ type: "error", message: err?.message ?? "Unknown error" });
    } finally {
      res.end();
    }
  });
}

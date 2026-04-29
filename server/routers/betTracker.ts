/**
 * betTracker.ts — tRPC router for the Bet Tracker feature.
 *
 * All procedures are gated behind handicapperProcedure, which allows
 * OWNER, ADMIN, and HANDICAPPER roles only.
 *
 * Procedures:
 *   list      — list bets for the current user (filterable by sport, date, result)
 *   create    — create a new tracked bet (structured: game + timeframe + market + pickSide)
 *   update    — update an existing bet (result, notes, odds, risk, etc.)
 *   delete    — delete a bet by id
 *   getSlate  — get the AN game slate for a given sport + date (cached, ~0ms on warm)
 *   getStats  — aggregate P/L stats for the current user
 *
 * Schema fields added in v3:
 *   anGameId   — Action Network game id (links to AN scoreboard)
 *   timeframe  — FULL_GAME | FIRST_5 | FIRST_INNING
 *   market     — ML | RL | TOTAL
 *   pickSide   — AWAY | HOME | OVER | UNDER
 *
 * Logging convention:
 *   [BetTracker][INPUT]  — raw input received
 *   [BetTracker][STEP]   — operation in progress
 *   [BetTracker][STATE]  — intermediate computed values
 *   [BetTracker][OUTPUT] — final result
 *   [BetTracker][VERIFY] — validation pass/fail
 *   [BetTracker][ERROR]  — failure with context
 */

import { z } from "zod";
import { router } from "../_core/trpc";
import { handicapperProcedure } from "./appUsers";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { trackedBets, appUsers } from "../../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { fetchAnSlate, resolveLogoUrl } from "../actionNetwork";
import { gradeTrackedBet, fetchScores, type Sport as GraderSport, type Timeframe as GraderTimeframe, type Market as GraderMarket, type PickSide as GraderPickSide } from "../scoreGrader";

// ─── Shared Zod enums ─────────────────────────────────────────────────────────

const RESULTS    = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;
const SPORTS     = ["MLB", "NBA", "NHL", "NCAAM", "NFL", "CUSTOM"] as const;
const TIMEFRAMES = [
  "FULL_GAME",
  "FIRST_5",
  "FIRST_INNING",
  "NRFI",
  "YRFI",
  "REGULATION",
  "FIRST_PERIOD",
  "FIRST_HALF",
  "FIRST_QUARTER",
] as const;
const MARKETS    = ["ML", "RL", "TOTAL"] as const;
const PICK_SIDES = ["AWAY", "HOME", "OVER", "UNDER"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute toWin from American odds + risk (dollars) */
function calcToWin(odds: number, risk: number): number {
  if (odds >= 100) {
    return parseFloat((risk * (odds / 100)).toFixed(2));
  } else {
    return parseFloat((risk * (100 / Math.abs(odds))).toFixed(2));
  }
}

/**
 * Derive a human-readable pick string from structured inputs.
 * Examples:
 *   AWAY + ML        → "HOU ML"
 *   HOME + RL        → "SEA RL"
 *   OVER + TOTAL     → "OVER"
 *   UNDER + TOTAL    → "UNDER"
 *   NRFI timeframe   → "NRFI"
 *   YRFI timeframe   → "YRFI"
 */
function derivePickLabel(
  pickSide: typeof PICK_SIDES[number],
  market: typeof MARKETS[number],
  awayTeam: string,
  homeTeam: string,
  timeframe?: typeof TIMEFRAMES[number],
): string {
  if (timeframe === "NRFI") return "NRFI";
  if (timeframe === "YRFI") return "YRFI";
  if (market === "TOTAL") {
    return pickSide === "OVER" ? "OVER" : "UNDER";
  }
  const team = pickSide === "AWAY" ? awayTeam : homeTeam;
  const suffix = market === "ML" ? "ML" : "RL";
  return `${team} ${suffix}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const betTrackerRouter = router({

  /**
   * listHandicappers — OWNER/ADMIN only: list all handicapper accounts.
   * Used by the BetTracker handicapper selector dropdown.
   */
  listHandicappers: handicapperProcedure
    .query(async ({ ctx }) => {
      const role = ctx.appUser.role;
      if (role !== "owner" && role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required" });
      }
      const db = await getDb();
      const rows = await db
        .select({ id: appUsers.id, username: appUsers.username, role: appUsers.role })
        .from(appUsers)
        .where(inArray(appUsers.role, ["owner", "admin", "handicapper"]))
        .orderBy(appUsers.id);
      console.log(`[BetTracker][OUTPUT] listHandicappers: ${rows.length} handicappers returned`);
      return rows;
    }),

  /**
   * list — fetch all bets for the authenticated user.
   * Optional filters: sport, gameDate, result.
   * Owner/Admin can pass targetUserId to view another handicapper's bets.
   */
  list: handicapperProcedure
    .input(z.object({
      sport:         z.enum(SPORTS).optional(),
      gameDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      result:        z.enum(RESULTS).optional(),
      targetUserId:  z.number().int().positive().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      // Visibility enforcement: only owner/admin can view other handicappers
      let userId = ctx.appUser.id;
      if (input?.targetUserId && input.targetUserId !== userId) {
        if (role !== "owner" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view other handicappers" });
        }
        userId = input.targetUserId;
      }
      console.log(`[BetTracker][INPUT] list: viewerId=${ctx.appUser.id} targetUserId=${userId} sport=${input?.sport ?? "ALL"} date=${input?.gameDate ?? "ALL"} result=${input?.result ?? "ALL"}`);

      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.result)   conditions.push(eq(trackedBets.result, input.result));

      const db = await getDb();
      const rows = await db
        .select()
        .from(trackedBets)
        .where(and(...conditions))
        .orderBy(desc(trackedBets.gameDate), desc(trackedBets.createdAt));

      console.log(`[BetTracker][OUTPUT] list: userId=${userId} → ${rows.length} bets returned`);

      // ── Enrich with SlateGame data (logos, full names, gameTime, status, live scores) ──
      // Collect unique (sport, gameDate) pairs
      const pairs = new Map<string, { sport: string; gameDate: string }>();
      for (const row of rows) {
        const key = `${row.sport}:${row.gameDate}`;
        if (!pairs.has(key)) pairs.set(key, { sport: row.sport, gameDate: row.gameDate });
      }

      // Fetch slates for all unique pairs (cached)
      const slateMap = new Map<number, import('../actionNetwork').SlateGame>(); // anGameId → SlateGame
      await Promise.all(
        Array.from(pairs.values()).map(async ({ sport, gameDate }) => {
          try {
            const games = await fetchAnSlate(sport, gameDate);
            for (const g of games) slateMap.set(g.id, g);
          } catch (e) {
            console.warn(`[BetTracker][WARN] list: fetchAnSlate failed for ${sport}/${gameDate}:`, e);
          }
        })
      );

      // Merge slate data into each bet row
      // For bets where the AN slate is unavailable (historical dates), fall back to
      // resolveLogoUrl which builds logos directly from team abbreviations.
      type RawBet = typeof rows[0];
      const enriched = rows.map((row: RawBet) => {
        const slate = row.anGameId ? slateMap.get(row.anGameId) : undefined;

        // Logo fallback: resolve from MLB_BY_ABBREV when slate is unavailable
        const awayLogo = slate?.awayLogo
          ?? (row.awayTeam ? resolveLogoUrl(row.sport, row.awayTeam, "") || null : null);
        const homeLogo = slate?.homeLogo
          ?? (row.homeTeam ? resolveLogoUrl(row.sport, row.homeTeam, "") || null : null);

        if (!slate && (awayLogo || homeLogo)) {
          console.log(`[BetTracker][STATE] list: bet id=${row.id} — no slate, logo fallback: ${row.awayTeam}=${awayLogo ? 'OK' : 'MISS'} ${row.homeTeam}=${homeLogo ? 'OK' : 'MISS'}`);
        }

        return {
          ...row,
          awayLogo,
          homeLogo,
          awayFull:     slate?.awayFull     ?? null,
          homeFull:     slate?.homeFull     ?? null,
          awayNickname: slate?.awayNickname ?? null,
          homeNickname: slate?.homeNickname ?? null,
          awayColor:    slate?.awayColor    ?? null,
          homeColor:    slate?.homeColor    ?? null,
          gameTime:     slate?.gameTime     ?? null,
          startUtc:     slate?.startUtc     ?? null,
          gameStatus:   slate?.status       ?? null,
        };
      });

      const withLogo = enriched.filter((b: typeof enriched[0]) => b.awayLogo).length;
      console.log(`[BetTracker][VERIFY] list: enriched ${withLogo}/${enriched.length} bets with logos (${enriched.length - withLogo} missing)`);
      return enriched;
    }),

  /**
   * create — add a new tracked bet.
   * Structured inputs: anGameId, timeframe, market, pickSide.
   * pick is auto-derived from pickSide + market + team abbreviations.
   * toWin is auto-calculated from odds + risk.
   */
  create: handicapperProcedure
    .input(z.object({
      // Game identification
      anGameId:  z.number().int().positive(),
      sport:     z.enum(SPORTS).default("MLB"),
      gameDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      awayTeam:  z.string().min(1).max(128),
      homeTeam:  z.string().min(1).max(128),
      // Bet structure
      timeframe: z.enum(TIMEFRAMES).default("FULL_GAME"),
      market:    z.enum(MARKETS).default("ML"),
      pickSide:  z.enum(PICK_SIDES),
      // Stake
      odds:      z.number().int().min(-10000).max(10000),
      risk:      z.number().positive().max(1_000_000),
      toWin:     z.number().positive().optional(),
      // Optional
      line:      z.number().optional(),   // RL spread or Total line value
      notes:     z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const toWin  = input.toWin ?? calcToWin(input.odds, input.risk);
      const pick   = derivePickLabel(input.pickSide, input.market, input.awayTeam, input.homeTeam, input.timeframe);

      console.log(`[BetTracker][INPUT] create: userId=${userId} sport=${input.sport} date=${input.gameDate} anGameId=${input.anGameId} timeframe=${input.timeframe} market=${input.market} pickSide=${input.pickSide} pick="${pick}" odds=${input.odds} risk=${input.risk} toWin=${toWin}`);
      console.log(`[BetTracker][STATE] create: awayTeam=${input.awayTeam} homeTeam=${input.homeTeam} derivedPick="${pick}"`);

      const db = await getDb();
      const [result] = await db.insert(trackedBets).values({
        userId,
        anGameId:  input.anGameId,
        sport:     input.sport,
        gameDate:  input.gameDate,
        awayTeam:  input.awayTeam,
        homeTeam:  input.homeTeam,
        timeframe: input.timeframe,
        market:    input.market,
        pickSide:  input.pickSide,
        betType:   input.market === "TOTAL" ? (input.pickSide === "OVER" ? "OVER" : "UNDER") : input.market,
        pick,
        odds:      input.odds,
        risk:      String(input.risk),
        toWin:     String(toWin),
        book:      null,
        line:      input.line !== undefined ? String(input.line) : null,
        notes:     input.notes ?? null,
        result:    "PENDING",
      });

      const insertId = (result as { insertId: number }).insertId;
      console.log(`[BetTracker][OUTPUT] create: SUCCESS — insertId=${insertId} userId=${userId} pick="${pick}"`);
      console.log(`[BetTracker][VERIFY] create: PASS — bet inserted with id=${insertId}`);

      const [created] = await db.select().from(trackedBets).where(eq(trackedBets.id, insertId));
      return created;
    }),

  /**
   * update — update an existing bet.
   * Only the owner of the bet can update it.
   * Supports updating result, notes, odds, risk, timeframe, market, pickSide.
   */
  update: handicapperProcedure
    .input(z.object({
      id:        z.number().int().positive(),
      timeframe: z.enum(TIMEFRAMES).optional(),
      market:    z.enum(MARKETS).optional(),
      pickSide:  z.enum(PICK_SIDES).optional(),
      odds:      z.number().int().min(-10000).max(10000).optional(),
      risk:      z.number().positive().max(1_000_000).optional(),
      toWin:     z.number().positive().optional(),
      notes:     z.string().max(2000).optional(),
      result:    z.enum(RESULTS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker][INPUT] update: userId=${userId} betId=${input.id} fields=${JSON.stringify(Object.keys(input).filter(k => k !== 'id'))}`);

      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      if (!existing) {
        console.log(`[BetTracker][ERROR] update: betId=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }
      if (existing.userId !== userId) {
        console.log(`[BetTracker][ERROR] update: betId=${input.id} owned by userId=${existing.userId}, requester=${userId}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify another user's bet" });
      }

      // Build update payload — only include provided fields
      const patch: Record<string, unknown> = {};
      if (input.timeframe !== undefined) patch.timeframe = input.timeframe;
      if (input.market    !== undefined) patch.market    = input.market;
      if (input.pickSide  !== undefined) patch.pickSide  = input.pickSide;
      if (input.notes     !== undefined) patch.notes     = input.notes;
      if (input.result    !== undefined) patch.result    = input.result;

      // Re-derive pick label if market or pickSide changed
      const newMarket   = (input.market   ?? existing.market)   as typeof MARKETS[number];
      const newPickSide = (input.pickSide ?? existing.pickSide) as typeof PICK_SIDES[number];
      if (input.market !== undefined || input.pickSide !== undefined) {
        const awayTeam = existing.awayTeam ?? "";
        const homeTeam = existing.homeTeam ?? "";
        patch.pick   = derivePickLabel(newPickSide, newMarket, awayTeam, homeTeam);
        patch.betType = newMarket === "TOTAL"
          ? (newPickSide === "OVER" ? "OVER" : "UNDER")
          : newMarket;
        console.log(`[BetTracker][STATE] update: re-derived pick="${patch.pick}" betType="${patch.betType}"`);
      }

      // Recalculate toWin if odds or risk changed
      const newOdds = input.odds ?? existing.odds;
      const newRisk = input.risk !== undefined ? input.risk : parseFloat(existing.risk);
      if (input.risk !== undefined) patch.risk = String(input.risk);
      if (input.toWin !== undefined) {
        patch.toWin = String(input.toWin);
      } else if (input.odds !== undefined || input.risk !== undefined) {
        patch.toWin = String(calcToWin(newOdds, newRisk));
        console.log(`[BetTracker][STATE] update: recalculated toWin=${patch.toWin} (odds=${newOdds} risk=${newRisk})`);
      }
      if (input.odds !== undefined) patch.odds = input.odds;

      if (Object.keys(patch).length === 0) {
        console.log(`[BetTracker][OUTPUT] update: no-op — no fields changed for betId=${input.id}`);
        return existing;
      }

      await db.update(trackedBets).set(patch).where(eq(trackedBets.id, input.id));
      const [updated] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker][OUTPUT] update: SUCCESS — betId=${input.id} result=${updated?.result} pick="${updated?.pick}"`);
      console.log(`[BetTracker][VERIFY] update: PASS — betId=${input.id} updated`);
      return updated;
    }),

  /**
   * delete — remove a bet by id.
   * Only the owner of the bet can delete it.
   */
  delete: handicapperProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker][INPUT] delete: userId=${userId} betId=${input.id}`);

      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      if (!existing) {
        console.log(`[BetTracker][ERROR] delete: betId=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }
      if (existing.userId !== userId) {
        console.log(`[BetTracker][ERROR] delete: betId=${input.id} owned by userId=${existing.userId}, requester=${userId}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete another user's bet" });
      }

      await db.delete(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker][OUTPUT] delete: SUCCESS — betId=${input.id} deleted`);
      console.log(`[BetTracker][VERIFY] delete: PASS — betId=${input.id} removed`);
      return { success: true, deletedId: input.id };
    }),

  /**
   * getSlate — fetch the daily game slate from Action Network v2 scoreboard API.
   * Served from in-memory cache (5-min TTL) after server pre-warm.
   * Returns normalized SlateGame[] sorted by start time ASC.
   */
  getSlate: handicapperProcedure
    .input(z.object({
      sport:    z.enum(["MLB", "NBA", "NHL", "NCAAM"]),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ ctx, input }) => {
      console.log(`[BetTracker][INPUT] getSlate: userId=${ctx.appUser.id} sport=${input.sport} date=${input.gameDate}`);
      const start = Date.now();
      const games = await fetchAnSlate(input.sport, input.gameDate);
      const elapsed = Date.now() - start;
      console.log(`[BetTracker][OUTPUT] getSlate: ${games.length} games | sport=${input.sport} date=${input.gameDate} | elapsed=${elapsed}ms`);
      console.log(`[BetTracker][VERIFY] getSlate: ${games.length > 0 ? "PASS" : "WARN — 0 games"} | elapsed=${elapsed}ms`);
      return games.map(g => ({
        id:           g.id,
        awayTeam:     g.awayTeam,
        homeTeam:     g.homeTeam,
        awayFull:     g.awayFull,
        homeFull:     g.homeFull,
        awayNickname: g.awayNickname,
        homeNickname: g.homeNickname,
        awayLogo:     g.awayLogo,
        homeLogo:     g.homeLogo,
        awayColor:    g.awayColor,
        homeColor:    g.homeColor,
        gameTime:     g.gameTime,
        sport:        g.sport,
        gameDate:     g.gameDate,
        status:       g.status,
        odds:         g.odds,
      }));
    }),

  /**
   * autoGrade — grade all PENDING bets for the current user.
   * Fetches official league scores and deterministically grades each bet.
   * Returns a summary of how many bets were graded and their results.
   */
  autoGrade: handicapperProcedure
    .input(z.object({
      sport:    z.enum(SPORTS).optional(),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker][INPUT] autoGrade: userId=${userId} sport=${input?.sport ?? "ALL"} date=${input?.gameDate ?? "ALL"}`);

      const db = await getDb();
      const conditions = [
        eq(trackedBets.userId, userId),
        eq(trackedBets.result, "PENDING"),
      ];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));

      const pending = await db.select().from(trackedBets).where(and(...conditions));
      console.log(`[BetTracker][STATE] autoGrade: ${pending.length} PENDING bets to grade for userId=${userId}`);

      let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0;
      const details: Array<{ betId: number; result: string; reason: string }> = [];

      for (const bet of pending) {
        console.log(`[BetTracker][STEP] autoGrade: grading betId=${bet.id} sport=${bet.sport} date=${bet.gameDate} ${bet.awayTeam}@${bet.homeTeam} timeframe=${bet.timeframe} market=${bet.market} pickSide=${bet.pickSide}`);

        const gradeOut = await gradeTrackedBet({
          sport:     bet.sport as GraderSport,
          gameDate:  bet.gameDate,
          awayTeam:  bet.awayTeam ?? "",
          homeTeam:  bet.homeTeam ?? "",
          timeframe: (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
          market:    (bet.market ?? "ML") as GraderMarket,
          pickSide:  (bet.pickSide ?? "AWAY") as GraderPickSide,
          odds:      bet.odds,
          line:      bet.line != null ? parseFloat(String(bet.line)) : null,
          anGameId:  bet.anGameId,
        });

        details.push({ betId: bet.id, result: gradeOut.result, reason: gradeOut.reason });

        if (gradeOut.result === "PENDING") {
          stillPending++;
          console.log(`[BetTracker][STATE] autoGrade: betId=${bet.id} still PENDING — ${gradeOut.reason}`);
          continue;
        }

        // Update bet result + final scores in DB
        await db.update(trackedBets)
          .set({
            result:    gradeOut.result,
            awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
            homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
          })
          .where(eq(trackedBets.id, bet.id));

        graded++;
        if (gradeOut.result === "WIN")  wins++;
        if (gradeOut.result === "LOSS") losses++;
        if (gradeOut.result === "PUSH") pushes++;

        console.log(`[BetTracker][OUTPUT] autoGrade: betId=${bet.id} → ${gradeOut.result} | ${gradeOut.reason}`);
        console.log(`[BetTracker][VERIFY] autoGrade: PASS — betId=${bet.id} graded=${gradeOut.result}`);
      }

      const summary = { graded, wins, losses, pushes, stillPending, total: pending.length, details };
      console.log(`[BetTracker][OUTPUT] autoGrade: COMPLETE userId=${userId} — graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending}`);
      return summary;
    }),

  /**
   * autoGradeAll — OWNER/ADMIN only: grade ALL users' PENDING bets for a given date.
   * Used by the scheduled background job.
   */
  autoGradeAll: handicapperProcedure
    .input(z.object({
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      if (role !== "owner" && role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required" });
      }
      console.log(`[BetTracker][INPUT] autoGradeAll: triggeredBy=${ctx.appUser.username} date=${input.gameDate}`);

      const db = await getDb();
      const pending = await db.select().from(trackedBets).where(
        and(
          eq(trackedBets.result, "PENDING"),
          eq(trackedBets.gameDate, input.gameDate),
        )
      );
      console.log(`[BetTracker][STATE] autoGradeAll: ${pending.length} PENDING bets across all users for date=${input.gameDate}`);

      // Pre-fetch scores for all sports present in the pending bets (parallel)
      const sportsNeeded: GraderSport[] = Array.from(new Set(pending.map((b: { sport: string }) => b.sport))) as GraderSport[];
      console.log(`[BetTracker][STEP] autoGradeAll: pre-fetching scores for sports=${sportsNeeded.join(",")}`);
      await Promise.all(sportsNeeded.map(s => fetchScores(s, input.gameDate)));
      console.log(`[BetTracker][STATE] autoGradeAll: scores pre-fetched for ${sportsNeeded.length} sports`);

      let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0;

      for (const bet of pending) {
        const gradeOut = await gradeTrackedBet({
          sport:     bet.sport as GraderSport,
          gameDate:  bet.gameDate,
          awayTeam:  bet.awayTeam ?? "",
          homeTeam:  bet.homeTeam ?? "",
          timeframe: (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
          market:    (bet.market ?? "ML") as GraderMarket,
          pickSide:  (bet.pickSide ?? "AWAY") as GraderPickSide,
          odds:      bet.odds,
          line:      bet.line != null ? parseFloat(String(bet.line)) : null,
          anGameId:  bet.anGameId,
        });

        if (gradeOut.result === "PENDING") { stillPending++; continue; }

        await db.update(trackedBets)
          .set({
            result:    gradeOut.result,
            awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
            homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
          })
          .where(eq(trackedBets.id, bet.id));

        graded++;
        if (gradeOut.result === "WIN")  wins++;
        if (gradeOut.result === "LOSS") losses++;
        if (gradeOut.result === "PUSH") pushes++;

        console.log(`[BetTracker][OUTPUT] autoGradeAll: betId=${bet.id} userId=${bet.userId} → ${gradeOut.result} score=${gradeOut.awayScore}-${gradeOut.homeScore}`);
      }

      const summary = { graded, wins, losses, pushes, stillPending, total: pending.length };
      console.log(`[BetTracker][OUTPUT] autoGradeAll: COMPLETE date=${input.gameDate} graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending}`);
      return summary;
    }),

  /**
   * getStats — full aggregate stats with all breakdown dimensions.
   * Owner/Admin can pass targetUserId to view another handicapper's stats.
   *
   * Returns:
   *   - Overall: wins, losses, pushes, pending, netProfit, roi, totalRisk, bestWin, worstLoss
   *   - byType:  breakdown by market (ML / RL / TOTAL)
   *   - bySize:  breakdown by unit size (Heavy 5U+ / Mid 2-5U / Light <2U)
   *   - byMonth: breakdown by calendar month (YYYY-MM)
   *   - bySport: breakdown by sport (MLB / NHL / NBA / etc.)
   *   - equityCurve: [{date, cumPL}] sorted ascending for chart rendering
   */
  getStats: handicapperProcedure
    .input(z.object({
      sport:         z.enum(SPORTS).optional(),
      gameDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      targetUserId:  z.number().int().positive().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      let userId = ctx.appUser.id;
      if (input?.targetUserId && input.targetUserId !== userId) {
        if (role !== "owner" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view other handicappers" });
        }
        userId = input.targetUserId;
      }
      console.log(`[BetTracker][INPUT] getStats: viewerId=${ctx.appUser.id} targetUserId=${userId} sport=${input?.sport ?? "ALL"} date=${input?.gameDate ?? "ALL"}`);

      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));

      const db = await getDb();
      // Fetch all bets sorted by gameDate ascending (needed for equity curve)
      const rows = await db
        .select()
        .from(trackedBets)
        .where(and(...conditions))
        .orderBy(trackedBets.gameDate, trackedBets.createdAt);

      // ── Overall aggregation ──────────────────────────────────────────────────
      let wins = 0, losses = 0, pushes = 0, pending = 0, voids = 0;
      let totalRisk = 0, totalWon = 0, totalLost = 0;
      let bestWin = 0, worstLoss = 0;

      for (const bet of rows) {
        const risk  = parseFloat(bet.risk);
        const toWin = parseFloat(bet.toWin);
        switch (bet.result) {
          case "WIN":
            wins++; totalRisk += risk; totalWon += toWin;
            if (toWin > bestWin) bestWin = toWin;
            break;
          case "LOSS":
            losses++; totalRisk += risk; totalLost += risk;
            if (risk > worstLoss) worstLoss = risk;
            break;
          case "PUSH":    pushes++;  break;
          case "PENDING": pending++; break;
          case "VOID":    voids++;   break;
        }
      }
      const netProfit = totalWon - totalLost;
      const roi       = totalRisk > 0 ? parseFloat(((netProfit / totalRisk) * 100).toFixed(2)) : 0;

      // ── Breakdown helper ─────────────────────────────────────────────────────
      type BreakdownEntry = {
        key: string;
        wins: number; losses: number; pushes: number;
        totalRisk: number; netProfit: number; roi: number;
      };
      function buildBreakdown(keyFn: (bet: typeof rows[0]) => string): BreakdownEntry[] {
        const map = new Map<string, { wins: number; losses: number; pushes: number; risk: number; won: number; lost: number }>();
        for (const bet of rows) {
          const key = keyFn(bet);
          if (!map.has(key)) map.set(key, { wins: 0, losses: 0, pushes: 0, risk: 0, won: 0, lost: 0 });
          const e = map.get(key)!;
          const risk  = parseFloat(bet.risk);
          const toWin = parseFloat(bet.toWin);
          if (bet.result === "WIN")  { e.wins++;   e.risk += risk; e.won  += toWin; }
          if (bet.result === "LOSS") { e.losses++; e.risk += risk; e.lost += risk;  }
          if (bet.result === "PUSH") { e.pushes++; }
        }
        return Array.from(map.entries()).map(([key, e]) => {
          const np = e.won - e.lost;
          return {
            key,
            wins:       e.wins,
            losses:     e.losses,
            pushes:     e.pushes,
            totalRisk:  parseFloat(e.risk.toFixed(2)),
            netProfit:  parseFloat(np.toFixed(2)),
            roi:        e.risk > 0 ? parseFloat(((np / e.risk) * 100).toFixed(2)) : 0,
          };
        }).sort((a, b) => a.key.localeCompare(b.key));
      }

      // ── By Bet Type (market) ─────────────────────────────────────────────────
      const byType = buildBreakdown(bet => bet.market ?? bet.betType ?? "ML");

      // ── By Unit Size ─────────────────────────────────────────────────────────
      const bySize = buildBreakdown(bet => {
        const r = parseFloat(bet.risk);
        if (r >= 5) return "Heavy (5U+)";
        if (r >= 2) return "Mid (2-5U)";
        return "Light (<2U)";
      });

      // ── By Month ─────────────────────────────────────────────────────────────
      const byMonth = buildBreakdown(bet => bet.gameDate.substring(0, 7)); // YYYY-MM

      // ── By Sport ─────────────────────────────────────────────────────────────
      const bySport = buildBreakdown(bet => bet.sport);

      // ── By Result (WIN/LOSS breakdown for quick reference) ───────────────────
      const byResult = buildBreakdown(bet => bet.result);

      // ── By Timeframe ─────────────────────────────────────────────────────────
      const byTimeframe = buildBreakdown(bet => bet.timeframe ?? "FULL_GAME");

      // ── Equity Curve ─────────────────────────────────────────────────────────
      // Cumulative P/L over time (settled bets only, sorted by gameDate asc)
      let cumPL = 0;
      const equityCurve: { date: string; cumPL: number; betId: number; pick: string; result: string; pl: number }[] = [];
      for (const bet of rows) {
        if (bet.result === "WIN") {
          const pl = parseFloat(bet.toWin);
          cumPL += pl;
          equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "WIN", pl: parseFloat(pl.toFixed(2)) });
        } else if (bet.result === "LOSS") {
          const pl = -parseFloat(bet.risk);
          cumPL += pl;
          equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "LOSS", pl: parseFloat(pl.toFixed(2)) });
        }
        // PUSH/PENDING/VOID: no P/L impact on curve
      }

      const stats = {
        // Overall
        totalBets:  rows.length,
        wins, losses, pushes, pending, voids,
        gradedBets: wins + losses + pushes,
        totalRisk:  parseFloat(totalRisk.toFixed(2)),
        totalWon:   parseFloat(totalWon.toFixed(2)),
        totalLost:  parseFloat(totalLost.toFixed(2)),
        netProfit:  parseFloat(netProfit.toFixed(2)),
        roi,
        bestWin:    parseFloat(bestWin.toFixed(2)),
        worstLoss:  parseFloat(worstLoss.toFixed(2)),
        // Breakdowns
        byType,
        bySize,
        byMonth,
        bySport,
        byResult,
        byTimeframe,
        // Equity curve
        equityCurve,
      };

      console.log(`[BetTracker][OUTPUT] getStats: userId=${userId} → totalBets=${stats.totalBets} wins=${stats.wins} losses=${stats.losses} roi=${stats.roi}% equityCurve=${equityCurve.length} points`);
      return stats;
    }),

  /**
   * getLinescores — fetch MLB per-inning linescore data for one or more dates.
   * Calls the official MLB Stats API: https://statsapi.mlb.com/api/v1/schedule
   * Returns a map keyed by gamePk with innings array + R/H/E totals + status.
   */
  getLinescores: handicapperProcedure
    .input(z.object({
      sport:  z.literal("MLB"),
      dates:  z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(14),
    }))
    .query(async ({ input }) => {
      console.log(`[BetTracker][INPUT] getLinescores: sport=${input.sport} dates=${input.dates.join(",")}`);

      type InningLine = { num: number; awayRuns: number | null; homeRuns: number | null };
      type LinescoreEntry = {
        gamePk:       number;
        gameDate:     string;
        awayAbbrev:   string;
        homeAbbrev:   string;
        innings:      InningLine[];
        awayR:        number | null;
        awayH:        number | null;
        awayE:        number | null;
        homeR:        number | null;
        homeH:        number | null;
        homeE:        number | null;
        currentInning: number | null;
        inningState:  string | null;  // "Top" | "Bottom" | "Middle" | "End"
        status:       string;         // "Preview" | "Live" | "Final" | "Postponed" etc.
      };

      const result: Record<number, LinescoreEntry> = {};

      await Promise.all(input.dates.map(async (date) => {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`;
        console.log(`[BetTracker][STEP] getLinescores: fetching ${url}`);
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) {
            console.warn(`[BetTracker][WARN] getLinescores: MLB API returned ${resp.status} for date=${date}`);
            return;
          }
          const json = await resp.json() as {
            dates?: Array<{
              games?: Array<{
                gamePk: number;
                gameDate: string;
                status?: { abstractGameState?: string; detailedState?: string };
                linescore?: {
                  currentInning?: number;
                  inningState?: string;
                  innings?: Array<{
                    num: number;
                    away?: { runs?: number };
                    home?: { runs?: number };
                  }>;
                  teams?: {
                    away?: { runs?: number; hits?: number; errors?: number };
                    home?: { runs?: number; hits?: number; errors?: number };
                  };
                };
                teams?: {
                  away?: { team?: { abbreviation?: string } };
                  home?: { team?: { abbreviation?: string } };
                };
              }>;
            }>;
          };

          for (const dateBlock of json.dates ?? []) {
            for (const game of dateBlock.games ?? []) {
              const ls = game.linescore;
              const innings: InningLine[] = (ls?.innings ?? []).map(inn => ({
                num:       inn.num,
                awayRuns:  inn.away?.runs ?? null,
                homeRuns:  inn.home?.runs ?? null,
              }));

              result[game.gamePk] = {
                gamePk:        game.gamePk,
                gameDate:      date,
                awayAbbrev:    game.teams?.away?.team?.abbreviation ?? "",
                homeAbbrev:    game.teams?.home?.team?.abbreviation ?? "",
                innings,
                awayR:         ls?.teams?.away?.runs  ?? null,
                awayH:         ls?.teams?.away?.hits  ?? null,
                awayE:         ls?.teams?.away?.errors ?? null,
                homeR:         ls?.teams?.home?.runs  ?? null,
                homeH:         ls?.teams?.home?.hits  ?? null,
                homeE:         ls?.teams?.home?.errors ?? null,
                currentInning: ls?.currentInning ?? null,
                inningState:   ls?.inningState   ?? null,
                status:        game.status?.abstractGameState ?? "Preview",
              };
            }
          }
          console.log(`[BetTracker][STATE] getLinescores: date=${date} → ${Object.keys(result).length} games accumulated`);
        } catch (e) {
          console.warn(`[BetTracker][WARN] getLinescores: fetch failed for date=${date}:`, e);
        }
      }));

      console.log(`[BetTracker][OUTPUT] getLinescores: total=${Object.keys(result).length} games returned`);
      return result;
    }),
});

export type BetTrackerRouter = typeof betTrackerRouter;

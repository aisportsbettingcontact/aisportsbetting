/**
 * betTracker.ts — tRPC router for the Bet Tracker feature.
 *
 * All procedures are gated behind handicapperProcedure, which allows
 * OWNER, ADMIN, and HANDICAPPER roles only.
 *
 * Procedures:
 *   list    — list bets for the current user (filterable by sport, date, result)
 *   create  — create a new tracked bet
 *   update  — update an existing bet (result, notes, odds, risk, etc.)
 *   delete  — delete a bet by id
 *   getSlate — get today's (or any date's) games for a given sport (for the matchup selector)
 */

import { z } from "zod";
import { router } from "../_core/trpc";
import { handicapperProcedure } from "./appUsers";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { trackedBets } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { listGamesByDate } from "../db";

// ─── Shared Zod schemas ────────────────────────────────────────────────────────

const BET_TYPES = ["ML", "RL", "OVER", "UNDER", "PROP", "PARLAY", "TEASER", "FUTURE", "CUSTOM"] as const;
const RESULTS   = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;
const SPORTS    = ["MLB", "NBA", "NHL", "NCAAM", "NFL", "CUSTOM"] as const;

const BOOKS = [
  "DK NJ", "FanDuel NJ", "Caesars NJ", "BetMGM NJ", "BetRivers NJ",
  "bet365 NJ", "Fanatics NJ", "HardRock NJ", "Borgata", "Betway NJ",
  "Parx NJ", "UnibetNJ", "Fliff", "Sleeper", "Kalshi", "Prophet",
  "Tipico NJ", "theScore Bet NJ", "Other",
] as const;

/** Compute toWin from American odds + risk (dollars) */
function calcToWin(odds: number, risk: number): number {
  if (odds >= 100) {
    // Underdog: risk * (odds / 100)
    return parseFloat((risk * (odds / 100)).toFixed(2));
  } else {
    // Favorite: risk * (100 / Math.abs(odds))
    return parseFloat((risk * (100 / Math.abs(odds))).toFixed(2));
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const betTrackerRouter = router({

  /**
   * list — fetch all bets for the authenticated user.
   * Optional filters: sport, gameDate, result.
   */
  list: handicapperProcedure
    .input(z.object({
      sport:    z.enum(SPORTS).optional(),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      result:   z.enum(RESULTS).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker] list: userId=${userId} sport=${input?.sport ?? "ALL"} date=${input?.gameDate ?? "ALL"} result=${input?.result ?? "ALL"}`);

      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.result)   conditions.push(eq(trackedBets.result, input.result));

      const db = await getDb();
      const rows = await db
        .select()
        .from(trackedBets)
        .where(and(...conditions))
        .orderBy(desc(trackedBets.createdAt));

      console.log(`[BetTracker] list: userId=${userId} → ${rows.length} bets returned`);
      return rows;
    }),

  /**
   * create — add a new tracked bet.
   * toWin is auto-calculated from odds + risk if not provided.
   */
  create: handicapperProcedure
    .input(z.object({
      gameId:   z.number().int().positive().optional(),
      sport:    z.enum(SPORTS).default("MLB"),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      awayTeam: z.string().max(128).optional(),
      homeTeam: z.string().max(128).optional(),
      betType:  z.enum(BET_TYPES).default("ML"),
      pick:     z.string().min(1).max(255),
      odds:     z.number().int().min(-10000).max(10000),
      risk:     z.number().positive().max(1_000_000),
      toWin:    z.number().positive().optional(),
      book:     z.string().max(64).optional(),
      notes:    z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const toWin  = input.toWin ?? calcToWin(input.odds, input.risk);

      console.log(`[BetTracker] create: userId=${userId} sport=${input.sport} date=${input.gameDate} betType=${input.betType} pick="${input.pick}" odds=${input.odds} risk=${input.risk} toWin=${toWin}`);

      const db = await getDb();
      const [result] = await db.insert(trackedBets).values({
        userId,
        gameId:   input.gameId ?? null,
        sport:    input.sport,
        gameDate: input.gameDate,
        awayTeam: input.awayTeam ?? null,
        homeTeam: input.homeTeam ?? null,
        betType:  input.betType,
        pick:     input.pick,
        odds:     input.odds,
        risk:     String(input.risk),
        toWin:    String(toWin),
        book:     input.book ?? null,
        notes:    input.notes ?? null,
        result:   "PENDING",
      });

      const insertId = (result as { insertId: number }).insertId;
      console.log(`[BetTracker] create: SUCCESS — insertId=${insertId} userId=${userId}`);

      const [created] = await db.select().from(trackedBets).where(eq(trackedBets.id, insertId));
      return created;
    }),

  /**
   * update — update an existing bet.
   * Only the owner of the bet can update it.
   */
  update: handicapperProcedure
    .input(z.object({
      id:       z.number().int().positive(),
      betType:  z.enum(BET_TYPES).optional(),
      pick:     z.string().min(1).max(255).optional(),
      odds:     z.number().int().min(-10000).max(10000).optional(),
      risk:     z.number().positive().max(1_000_000).optional(),
      toWin:    z.number().positive().optional(),
      book:     z.string().max(64).optional(),
      notes:    z.string().max(2000).optional(),
      result:   z.enum(RESULTS).optional(),
      awayTeam: z.string().max(128).optional(),
      homeTeam: z.string().max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker] update: userId=${userId} betId=${input.id} fields=${JSON.stringify(Object.keys(input).filter(k => k !== 'id'))}`);

      // Ownership check
      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      if (!existing) {
        console.log(`[BetTracker] update: REJECTED — betId=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }
      if (existing.userId !== userId) {
        console.log(`[BetTracker] update: REJECTED — betId=${input.id} owned by userId=${existing.userId}, not ${userId}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify another user's bet" });
      }

      // Build update payload — only include provided fields
      const patch: Record<string, unknown> = {};
      if (input.betType  !== undefined) patch.betType  = input.betType;
      if (input.pick     !== undefined) patch.pick     = input.pick;
      if (input.odds     !== undefined) patch.odds     = input.odds;
      if (input.book     !== undefined) patch.book     = input.book;
      if (input.notes    !== undefined) patch.notes    = input.notes;
      if (input.result   !== undefined) patch.result   = input.result;
      if (input.awayTeam !== undefined) patch.awayTeam = input.awayTeam;
      if (input.homeTeam !== undefined) patch.homeTeam = input.homeTeam;

      // If odds or risk changed, recalculate toWin (unless toWin explicitly provided)
      const newOdds = input.odds ?? existing.odds;
      const newRisk = input.risk !== undefined ? input.risk : parseFloat(existing.risk);
      if (input.risk !== undefined) patch.risk = String(input.risk);
      if (input.toWin !== undefined) {
        patch.toWin = String(input.toWin);
      } else if (input.odds !== undefined || input.risk !== undefined) {
        patch.toWin = String(calcToWin(newOdds, newRisk));
      }

      if (Object.keys(patch).length === 0) {
        console.log(`[BetTracker] update: no-op — no fields changed for betId=${input.id}`);
        return existing;
      }

      await db.update(trackedBets).set(patch).where(eq(trackedBets.id, input.id));
      const [updated] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker] update: SUCCESS — betId=${input.id} result=${updated?.result}`);
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
      console.log(`[BetTracker] delete: userId=${userId} betId=${input.id}`);

      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      if (!existing) {
        console.log(`[BetTracker] delete: REJECTED — betId=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }
      if (existing.userId !== userId) {
        console.log(`[BetTracker] delete: REJECTED — betId=${input.id} owned by userId=${existing.userId}, not ${userId}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete another user's bet" });
      }

      await db.delete(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker] delete: SUCCESS — betId=${input.id} deleted`);
      return { success: true, deletedId: input.id };
    }),

  /**
   * getSlate — get games for a given sport + date (for the matchup selector).
   * Pulls from the existing games table (same data as the main feed).
   */
  getSlate: handicapperProcedure
    .input(z.object({
      sport:    z.enum(["MLB", "NBA", "NHL", "NCAAM"]),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ ctx, input }) => {
      console.log(`[BetTracker] getSlate: userId=${ctx.appUser.id} sport=${input.sport} date=${input.gameDate}`);
      const games = await listGamesByDate(input.gameDate, input.sport);
      console.log(`[BetTracker] getSlate: ${games.length} games found for ${input.sport} on ${input.gameDate}`);
      return games.map(g => ({
        id:       g.id,
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        gameTime: g.startTimeEst,
        sport:    g.sport,
        gameDate: g.gameDate,
      }));
    }),

  /**
   * getStats — aggregate stats for the current user's bets.
   * Returns: totalBets, wins, losses, pushes, pending, voids, totalRisk, totalWon, totalLost, roi
   */
  getStats: handicapperProcedure
    .input(z.object({
      sport:    z.enum(SPORTS).optional(),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker] getStats: userId=${userId} sport=${input?.sport ?? "ALL"} date=${input?.gameDate ?? "ALL"}`);

      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));

      const db = await getDb();
      const rows = await db.select().from(trackedBets).where(and(...conditions));

      let wins = 0, losses = 0, pushes = 0, pending = 0, voids = 0;
      let totalRisk = 0, totalWon = 0, totalLost = 0;

      for (const bet of rows) {
        const risk  = parseFloat(bet.risk);
        const toWin = parseFloat(bet.toWin);
        switch (bet.result) {
          case "WIN":     wins++;    totalRisk += risk; totalWon  += toWin; break;
          case "LOSS":    losses++;  totalRisk += risk; totalLost += risk;  break;
          case "PUSH":    pushes++;  break;
          case "PENDING": pending++; break;
          case "VOID":    voids++;   break;
        }
      }

      const gradedBets = wins + losses + pushes;
      const netProfit  = totalWon - totalLost;
      const roi        = totalRisk > 0 ? parseFloat(((netProfit / totalRisk) * 100).toFixed(2)) : 0;

      const stats = {
        totalBets: rows.length,
        wins, losses, pushes, pending, voids,
        gradedBets,
        totalRisk:  parseFloat(totalRisk.toFixed(2)),
        totalWon:   parseFloat(totalWon.toFixed(2)),
        totalLost:  parseFloat(totalLost.toFixed(2)),
        netProfit:  parseFloat(netProfit.toFixed(2)),
        roi,
      };

      console.log(`[BetTracker] getStats: userId=${userId} → totalBets=${stats.totalBets} wins=${stats.wins} losses=${stats.losses} roi=${stats.roi}%`);
      return stats;
    }),
});

export type BetTrackerRouter = typeof betTrackerRouter;

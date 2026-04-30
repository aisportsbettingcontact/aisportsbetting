/**
 * metrics.ts — tRPC router for platform metrics
 *
 * Procedures:
 *   metrics.getSessionMetrics  — DAU / WAU / MAU / avg session duration
 *   metrics.getMemberMetrics   — total paying / lifetime / non-paying / discord connected
 *   metrics.sessionHeartbeat   — client heartbeat ping (every 5 min while logged in)
 *   metrics.openSession        — create session row on login
 *   metrics.closeSession       — close session rows on logout
 */
import { ownerProcedure, appUserProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import {
  getSessionMetrics,
  getMemberMetrics,
  heartbeatUserSession,
  createUserSession,
  closeUserSessions,
} from "../db";

export const metricsRouter = router({
  /** Owner-only: DAU / WAU / MAU / avg session duration */
  getSessionMetrics: ownerProcedure.query(async () => {
    const tag = "[tRPC][metrics.getSessionMetrics]";
    console.log(`${tag} [STEP] Fetching session metrics (DAU/WAU/MAU/avgDuration)`);
    const result = await getSessionMetrics();
    console.log(`${tag} [OUTPUT] dau=${result.dau} wau=${result.wau} mau=${result.mau} avgDurMs=${Math.round(result.avgSessionDurationMs)}`);
    return result;
  }),

  /** Owner-only: member tier counts + Discord connection count */
  getMemberMetrics: ownerProcedure.query(async () => {
    const tag = "[tRPC][metrics.getMemberMetrics]";
    console.log(`${tag} [STEP] Fetching member metrics`);
    const result = await getMemberMetrics();
    console.log(`${tag} [OUTPUT] totalPaying=${result.totalPaying} lifetime=${result.lifetimeMembers} nonPaying=${result.nonPaying} discord=${result.discordConnected} total=${result.totalUsers}`);
    return result;
  }),

  /** Authenticated app user: heartbeat ping every 5 min */
  sessionHeartbeat: appUserProcedure.mutation(async ({ ctx }) => {
    const tag = "[tRPC][metrics.sessionHeartbeat]";
    const userId = ctx.appUser.id;
    console.log(`${tag} [INPUT] userId=${userId}`);
    await heartbeatUserSession(userId);
    console.log(`${tag} [OUTPUT] Heartbeat recorded | userId=${userId}`);
    return { ok: true };
  }),

  /** Authenticated app user: open a new session row on login */
  openSession: appUserProcedure.mutation(async ({ ctx }) => {
    const tag = "[tRPC][metrics.openSession]";
    const userId = ctx.appUser.id;
    console.log(`${tag} [INPUT] userId=${userId}`);
    const sessionId = await createUserSession(userId);
    console.log(`${tag} [OUTPUT] sessionId=${sessionId} | userId=${userId}`);
    return { sessionId };
  }),

  /** Authenticated app user: close all open sessions on logout */
  closeSession: appUserProcedure.mutation(async ({ ctx }) => {
    const tag = "[tRPC][metrics.closeSession]";
    const userId = ctx.appUser.id;
    console.log(`${tag} [INPUT] userId=${userId}`);
    await closeUserSessions(userId);
    console.log(`${tag} [OUTPUT] Sessions closed | userId=${userId}`);
    return { ok: true };
  }),
});

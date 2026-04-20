/**
 * dbCircuitBreaker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * DB Circuit Breaker + In-Memory User Cache
 *
 * Prevents the site from going dark during TiDB outages by:
 *   1. Circuit Breaker: after FAILURE_THRESHOLD consecutive DB failures,
 *      opens the circuit for OPEN_DURATION_MS. During open state, DB calls
 *      fail immediately instead of hanging for 10s.
 *   2. User Cache: caches recently authenticated app users in memory for
 *      USER_CACHE_TTL_MS. During DB outages, appUserProcedure can serve
 *      cached user records instead of failing every request.
 *
 * Usage:
 *   import { withCircuitBreaker, getCachedAppUser, setCachedAppUser } from './dbCircuitBreaker';
 *
 *   // Wrap any DB call:
 *   const result = await withCircuitBreaker(() => db.select()...);
 *
 *   // Cache user after successful DB read:
 *   setCachedAppUser(user);
 *
 *   // Read from cache (returns null if expired or not found):
 *   const cached = getCachedAppUser(userId);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AppUser } from "../drizzle/schema";

const TAG = "[CircuitBreaker]";

// ── Circuit Breaker Config ────────────────────────────────────────────────────
const FAILURE_THRESHOLD  = 3;        // consecutive failures before opening circuit
const OPEN_DURATION_MS   = 60_000;   // 60 seconds in open state before retrying
const HALF_OPEN_TIMEOUT  = 10_000;   // probe timeout when in half-open state

// ── User Cache Config ─────────────────────────────────────────────────────────
const USER_CACHE_TTL_MS  = 5 * 60 * 1000;  // 5 minutes

// ── Circuit Breaker State ─────────────────────────────────────────────────────
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

let circuitState: CircuitState = "CLOSED";
let consecutiveFailures = 0;
let openedAt: number | null = null;
let totalFailures = 0;
let totalSuccesses = 0;

function getCircuitState(): CircuitState {
  if (circuitState === "OPEN" && openedAt !== null) {
    const elapsed = Date.now() - openedAt;
    if (elapsed >= OPEN_DURATION_MS) {
      circuitState = "HALF_OPEN";
      console.log(`${TAG} Circuit → HALF_OPEN (probe after ${Math.round(elapsed / 1000)}s)`);
    }
  }
  return circuitState;
}

function onSuccess(): void {
  totalSuccesses++;
  if (circuitState !== "CLOSED") {
    console.log(`${TAG} Circuit → CLOSED (DB recovered after ${totalFailures} total failures)`);
  }
  circuitState = "CLOSED";
  consecutiveFailures = 0;
  openedAt = null;
}

function onFailure(err: unknown): void {
  totalFailures++;
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD && circuitState === "CLOSED") {
    circuitState = "OPEN";
    openedAt = Date.now();
    console.error(`${TAG} Circuit → OPEN after ${consecutiveFailures} consecutive failures. Will retry in ${OPEN_DURATION_MS / 1000}s. Error: ${(err as Error)?.message ?? String(err)}`);
  }
}

/**
 * Wraps a DB call with circuit breaker protection.
 * - CLOSED: executes normally, tracks failures
 * - OPEN: throws immediately without executing (fast-fail)
 * - HALF_OPEN: executes with timeout probe; success → CLOSED, failure → OPEN
 */
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  const state = getCircuitState();

  if (state === "OPEN") {
    throw new Error(`${TAG} Circuit is OPEN — DB unavailable. Fast-failing to prevent hang.`);
  }

  const timeoutMs = state === "HALF_OPEN" ? HALF_OPEN_TIMEOUT : 8_000;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${TAG} DB query timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    onSuccess();
    return result;
  } catch (err) {
    onFailure(err);
    throw err;
  }
}

/** Returns current circuit breaker status for health endpoint */
export function getCircuitStatus(): {
  state: CircuitState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  openedAt: number | null;
  openedSecondsAgo: number | null;
} {
  return {
    state: getCircuitState(),
    consecutiveFailures,
    totalFailures,
    totalSuccesses,
    openedAt,
    openedSecondsAgo: openedAt ? Math.round((Date.now() - openedAt) / 1000) : null,
  };
}

// ── In-Memory User Cache ──────────────────────────────────────────────────────

interface CachedUser {
  user: AppUser;
  cachedAt: number;
}

const userCache = new Map<number, CachedUser>();

/** Cache an app user record (called after successful DB read) */
export function setCachedAppUser(user: AppUser): void {
  userCache.set(user.id, { user, cachedAt: Date.now() });
}

/** Get a cached app user by ID. Returns null if not found or expired. */
export function getCachedAppUser(userId: number): AppUser | null {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > USER_CACHE_TTL_MS) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

/** Invalidate a specific user from cache (call on logout or role change) */
export function invalidateCachedAppUser(userId: number): void {
  userCache.delete(userId);
}

/** Clear the entire user cache */
export function clearUserCache(): void {
  userCache.clear();
}

/** Get cache stats for health endpoint */
export function getCacheStats(): { size: number; ttlMs: number } {
  return { size: userCache.size, ttlMs: USER_CACHE_TTL_MS };
}

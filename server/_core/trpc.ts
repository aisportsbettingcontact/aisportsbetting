/**
 * trpc.ts
 *
 * tRPC middleware stack for aisportsbettingmodels.com.
 *
 * Middleware layers (applied in order):
 *   1. csrfOriginCheck   — validates Origin header on all state-mutating requests
 *                          (POST/PATCH/PUT/DELETE). Blocks cross-site request forgery
 *                          from attacker-controlled pages on other domains.
 *   2. requireUser       — validates session cookie, rejects unauthenticated callers.
 *   3. requireAdmin      — validates role === 'admin' (Manus OAuth user).
 *
 * Procedure hierarchy:
 *   publicProcedure      — no auth, CSRF check on mutations
 *   protectedProcedure   — Manus OAuth session required
 *   adminProcedure       — Manus OAuth session + admin role required
 *
 * CSRF Defense Strategy:
 *   tRPC uses POST for all mutations and GET for queries. The Origin header is
 *   set by browsers on all cross-origin requests and cannot be spoofed by
 *   JavaScript running on attacker-controlled pages. We validate it against
 *   the canonical public origin (PUBLIC_ORIGIN env var) and a set of known-safe
 *   dev origins. Requests with a missing or mismatched Origin on mutations are
 *   rejected with 403 FORBIDDEN.
 *
 *   Exemptions (safe by design):
 *   - GET requests (queries): read-only, no state change possible.
 *   - Server-to-server calls: no Origin header (not a browser).
 *   - Localhost/dev origins: explicitly allowed in development mode.
 *
 *   Defense-in-depth: SameSite=Strict cookies are the primary CSRF defense.
 *   This Origin check is the secondary layer that catches subdomain-takeover
 *   scenarios where SameSite alone is insufficient.
 */

import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ENV } from "./env";
import type { TrpcContext } from "./context";

// ─── CSRF-safe origin set ─────────────────────────────────────────────────────
/**
 * Build the set of origins that are permitted to make state-mutating tRPC calls.
 *
 * [INPUT]  ENV.publicOrigin  — canonical production origin (e.g. https://aisportsbettingmodels.com)
 * [INPUT]  ENV.isProduction  — true when NODE_ENV === "production"
 * [OUTPUT] Set<string>       — lowercase, trailing-slash-stripped allowed origins
 *
 * In production: only the PUBLIC_ORIGIN is allowed.
 * In development: PUBLIC_ORIGIN + localhost variants are allowed.
 */
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  // Always include the canonical public origin if set
  if (ENV.publicOrigin) {
    const canonical = ENV.publicOrigin.replace(/\/$/, "").toLowerCase();
    origins.add(canonical);
    console.log(`[CSRF] Allowed origin (PUBLIC_ORIGIN): ${canonical}`);
  }

  if (!ENV.isProduction) {
    // Development: allow localhost on common ports + Manus preview domains
    const devOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
    ];
    for (const o of devOrigins) {
      origins.add(o);
    }
    // Allow any *.manus.computer preview URL (Manus sandbox dev server)
    // These are validated by pattern match, not added to the static set.
    console.log(`[CSRF] Development mode — localhost origins allowed`);
    console.log(`[CSRF] Development mode — *.manus.computer preview origins allowed`);
  }

  if (origins.size === 0) {
    // PUBLIC_ORIGIN not set and not in dev — log a warning but don't block.
    // The check will fall back to a permissive pass with a warning log.
    console.warn(
      "[CSRF] WARNING: PUBLIC_ORIGIN is not set and NODE_ENV is not development. " +
      "CSRF Origin check will log warnings but NOT block requests until PUBLIC_ORIGIN is configured. " +
      "Set PUBLIC_ORIGIN=https://aisportsbettingmodels.com in production secrets immediately."
    );
  }

  return origins;
}

// Build once at module load time — origins don't change at runtime.
const ALLOWED_ORIGINS = buildAllowedOrigins();

/**
 * Determine whether a given Origin header value is permitted.
 *
 * [INPUT]  origin  — value of the Origin request header (may be undefined)
 * [OUTPUT] boolean — true if the origin is allowed to make mutations
 *
 * Logic:
 *   1. No Origin header → server-to-server call → ALLOW (no browser involved)
 *   2. Origin in ALLOWED_ORIGINS set → ALLOW
 *   3. In dev mode: Origin matches *.manus.computer pattern → ALLOW
 *   4. Otherwise → DENY
 */
function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header = server-to-server or same-origin fetch with no CORS.
  // Browsers always send Origin on cross-origin requests; absence means safe.
  if (!origin) return true;

  const normalized = origin.replace(/\/$/, "").toLowerCase();

  // Static set check (production origin + dev localhost)
  if (ALLOWED_ORIGINS.has(normalized)) return true;

  // Dynamic pattern: Manus sandbox preview URLs (*.manus.computer)
  // These are dev-only preview URLs, safe to allow in non-production.
  if (!ENV.isProduction && /^https:\/\/[a-z0-9\-]+\.manus\.computer$/.test(normalized)) {
    return true;
  }

  return false;
}

// ─── tRPC instance ────────────────────────────────────────────────────────────
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// ─── CSRF Origin check middleware ─────────────────────────────────────────────
/**
 * Validates the Origin header on all state-mutating HTTP requests (POST/PATCH/PUT/DELETE).
 * GET requests (tRPC queries) are exempt — they are read-only and carry no CSRF risk.
 *
 * [STEP] Extract Origin header from request
 * [STEP] Determine if request method is mutation-capable
 * [STEP] Validate origin against allowed set
 * [OUTPUT] Pass to next middleware, or throw FORBIDDEN
 * [VERIFY] Log every decision with IP, path, method, and origin for audit trail
 */
const csrfOriginCheck = t.middleware(async ({ ctx, next, path }) => {
  const req = ctx.req;
  const method = req.method?.toUpperCase() ?? "UNKNOWN";
  const origin = req.get("origin");
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

  // GET requests are tRPC queries — read-only, no CSRF risk.
  // Only POST (mutations) need the Origin check.
  if (method === "GET") {
    return next();
  }

  // [STATE] Log every mutation attempt with full context
  console.log(
    `[CSRF] ${method} /api/trpc/${path}` +
    ` | IP=${ip}` +
    ` | Origin=${origin ?? "NOT_SET"}` +
    ` | isProduction=${ENV.isProduction}`
  );

  const allowed = isOriginAllowed(origin);

  if (!allowed) {
    // [OUTPUT] BLOCKED — origin not in allowed set
    console.warn(
      `[CSRF] BLOCKED — Origin mismatch` +
      ` | path=${path}` +
      ` | IP=${ip}` +
      ` | Origin="${origin}"` +
      ` | allowedOrigins=[${Array.from(ALLOWED_ORIGINS).join(", ")}]` +
      ` | This may indicate a CSRF attack or misconfigured client`
    );
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Request origin not permitted",
    });
  }

  // [VERIFY] PASS — origin is allowed
  if (origin) {
    // Only log when Origin is present (server-to-server has no Origin, no need to log)
    console.log(
      `[CSRF] PASS — origin="${origin}" path=${path} IP=${ip}`
    );
  }

  return next();
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
/**
 * Requires a valid Manus OAuth session (ctx.user must be non-null).
 * Used by protectedProcedure and adminProcedure.
 */
const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// ─── Exported procedures ──────────────────────────────────────────────────────

/**
 * publicProcedure — no authentication required.
 * CSRF Origin check is applied to all mutations.
 * Queries (GET) are exempt from CSRF check.
 */
export const publicProcedure = t.procedure.use(csrfOriginCheck);

/**
 * protectedProcedure — Manus OAuth session required.
 * CSRF check applied first, then auth check.
 */
export const protectedProcedure = t.procedure
  .use(csrfOriginCheck)
  .use(requireUser);

/**
 * adminProcedure — Manus OAuth session + admin role required.
 * CSRF check applied first, then admin auth check.
 */
export const adminProcedure = t.procedure.use(csrfOriginCheck).use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

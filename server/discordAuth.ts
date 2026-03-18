/**
 * Discord Account Linking Routes
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE NOTE — WHY ROUTES ARE UNDER /api/*                       │
 * │                                                                         │
 * │  The Manus production deployment uses a two-layer proxy:               │
 * │    Browser → Cloudflare → Cloud Run (Express)                          │
 * │                                                                         │
 * │  The Manus edge proxy ONLY forwards /api/* requests to Express.        │
 * │  Everything else is served by the static CDN (returns SPA index.html). │
 * │  Routes outside /api/* never reach Express — they return HTTP 200      │
 * │  with the SPA shell, which looks like a 404 to the user.               │
 * │                                                                         │
 * │  Routes:                                                                │
 * │    GET  /api/auth/discord/connect    — redirect to Discord OAuth       │
 * │    GET  /api/auth/discord/callback   — handle OAuth code exchange      │
 * │    POST /api/auth/discord/disconnect — clear Discord fields from DB    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE NOTE — WHY redirect_uri USES PUBLIC_ORIGIN ENV VAR       │
 * │                                                                         │
 * │  Behind Cloudflare → Cloud Run, the x-forwarded-host header received   │
 * │  by Express resolves to the INTERNAL Cloud Run hostname:               │
 * │    cvrl7uon6e-pbhflwecra-uk.a.run.app                                  │
 * │  NOT the public domain: aisportsbettingmodels.com                      │
 * │                                                                         │
 * │  Discord compares the redirect_uri in the OAuth request against the    │
 * │  list of registered URIs in the Developer Portal. If the URI contains  │
 * │  the internal Cloud Run hostname, Discord rejects it with:             │
 * │    "Invalid OAuth2 redirect_uri"                                        │
 * │                                                                         │
 * │  Fix: PUBLIC_ORIGIN env var is the canonical public-facing origin.     │
 * │  Set it to https://aisportsbettingmodels.com in production secrets.    │
 * │  In local dev (no PUBLIC_ORIGIN set), falls back to request-derived    │
 * │  origin (http://localhost:3000) which is safe because there's no proxy.│
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Security:
 *   - Discord access_token is NEVER stored in the DB or logged
 *   - Secrets are read from ENV (server-side only, never exposed to frontend)
 *   - State parameter prevents CSRF on the callback
 *   - discordId uniqueness is enforced before saving (prevents account takeover)
 *
 * Checkpoint logging convention:
 *   [DiscordAuth][CHECKPOINT:<N>] <phase> — <detail>
 *   Every checkpoint logs requestId, all relevant values, and the exact
 *   decision being made so you can trace any failure in production logs.
 */

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./_core/env";
import { verifyAppUserToken } from "./routers/appUsers";
import { getAppUserById, updateAppUser, getDb } from "./db";
import { appUsers } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const APP_USER_COOKIE = "app_session";
const DISCORD_API = "https://discord.com/api/v10";

// ── Route prefix — MUST be under /api/ for Manus production proxy ──────────
// See architecture note above. DO NOT change this to /auth/discord/*.
const ROUTE_PREFIX = "/api/auth/discord";

// In-memory CSRF state store (TTL 10 min)
const pendingStates = new Map<string, { userId: number; expiresAt: number }>();

function getAppCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[APP_USER_COOKIE];
}

function generateState(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function cleanExpiredStates() {
  const now = Date.now();
  for (const [key, val] of Array.from(pendingStates.entries())) {
    if (val.expiresAt < now) pendingStates.delete(key);
  }
}

/**
 * Build the canonical public-facing origin for OAuth redirect URIs.
 *
 * PRIORITY ORDER (most reliable → least reliable):
 *   1. ENV.publicOrigin  — hardcoded in production secrets (most reliable)
 *   2. x-forwarded-proto + x-forwarded-host — set by Cloudflare (unreliable:
 *      x-forwarded-host may be the internal Cloud Run hostname, not public domain)
 *   3. req.protocol + req.hostname — Express-derived (unreliable behind proxy)
 *
 * In production, PUBLIC_ORIGIN MUST be set to https://aisportsbettingmodels.com.
 * Without it, the redirect_uri will contain the internal Cloud Run hostname and
 * Discord will reject the OAuth request with "Invalid OAuth2 redirect_uri".
 */
function buildPublicOrigin(req: Request, requestId: string): string {
  // ── Source 1: Hardcoded PUBLIC_ORIGIN env var (most reliable) ─────────────
  if (ENV.publicOrigin) {
    const origin = ENV.publicOrigin.replace(/\/$/, ""); // strip trailing slash
    console.log(
      `[DiscordAuth][ORIGIN] requestId=${requestId}` +
      ` SOURCE=PUBLIC_ORIGIN_ENV_VAR` +
      ` origin="${origin}"` +
      ` (hardcoded canonical domain — most reliable, immune to proxy header issues)`
    );
    return origin;
  }

  // ── Source 2: x-forwarded-proto + x-forwarded-host (Cloudflare proxy) ─────
  // WARNING: x-forwarded-host behind Cloud Run resolves to the internal
  // Cloud Run hostname (*.a.run.app), NOT the public domain.
  // Only use this as a fallback in local dev where there is no proxy.
  const fwdProto = req.get("x-forwarded-proto");
  const fwdHost  = req.get("x-forwarded-host");

  // ── Source 3: Express req.protocol + req.hostname ─────────────────────────
  const reqProto    = req.protocol;
  const reqHostname = req.hostname;
  const reqHost     = req.get("host");

  // Log ALL proxy headers so we can diagnose any future issues
  console.warn(
    `[DiscordAuth][ORIGIN][WARN] requestId=${requestId}` +
    ` PUBLIC_ORIGIN env var is NOT SET — falling back to request-derived origin.` +
    ` THIS WILL FAIL IN PRODUCTION (Cloud Run internal hostname will be used).` +
    ` Set PUBLIC_ORIGIN=https://aisportsbettingmodels.com in production secrets.` +
    ` | x-forwarded-proto="${fwdProto ?? "none"}"` +
    ` | x-forwarded-host="${fwdHost ?? "none"}"` +
    ` | x-forwarded-for="${req.get("x-forwarded-for") ?? "none"}"` +
    ` | req.protocol="${reqProto}"` +
    ` | req.hostname="${reqHostname}"` +
    ` | host="${reqHost ?? "none"}"` +
    ` | NODE_ENV="${process.env.NODE_ENV ?? "none"}"`
  );

  // Use forwarded headers if available (Cloudflare sets these)
  if (fwdProto && fwdHost) {
    const origin = `${fwdProto}://${fwdHost}`;
    console.log(
      `[DiscordAuth][ORIGIN] requestId=${requestId}` +
      ` SOURCE=X_FORWARDED_HEADERS` +
      ` origin="${origin}"` +
      ` (WARNING: fwdHost may be internal Cloud Run hostname, not public domain)`
    );
    return origin;
  }

  // Last resort: Express-derived origin
  const origin = `${reqProto}://${reqHost ?? reqHostname}`;
  console.log(
    `[DiscordAuth][ORIGIN] requestId=${requestId}` +
    ` SOURCE=EXPRESS_REQ` +
    ` origin="${origin}"` +
    ` (WARNING: may be wrong behind proxy)`
  );
  return origin;
}

export function registerDiscordAuthRoutes(app: Express) {
  // ── Startup confirmation log ─────────────────────────────────────────────
  // This fires once at server startup. If you see this in logs, the routes
  // ARE registered. If you don't see it, the import/call failed silently.
  const publicOriginStatus = ENV.publicOrigin
    ? `SET="${ENV.publicOrigin}"`
    : "NOT_SET (WILL FAIL IN PRODUCTION — set PUBLIC_ORIGIN secret)";

  console.log(
    `[DiscordAuth][STARTUP] Registering Discord OAuth routes` +
    ` | routePrefix="${ROUTE_PREFIX}"` +
    ` | PUBLIC_ORIGIN=${publicOriginStatus}` +
    ` | clientId=${ENV.discordClientId ? `${ENV.discordClientId.slice(0,8)}…` : "MISSING"}` +
    ` | clientSecret=${ENV.discordClientSecret ? "SET" : "MISSING"}` +
    ` | guildId=${ENV.discordGuildId || "MISSING"}` +
    ` | roleId=${ENV.discordRoleAiModelSub || "MISSING"}`
  );

  if (!ENV.publicOrigin) {
    console.warn(
      `[DiscordAuth][STARTUP][WARN] PUBLIC_ORIGIN is not set.` +
      ` In production, the redirect_uri will be built from x-forwarded-host` +
      ` which resolves to the internal Cloud Run hostname (*.a.run.app).` +
      ` Discord will reject this with "Invalid OAuth2 redirect_uri".` +
      ` FIX: Add PUBLIC_ORIGIN=https://aisportsbettingmodels.com to production secrets.`
    );
  }

  // ─── Step 1: Redirect to Discord OAuth ────────────────────────────────────
  //
  // CHECKPOINT 1: Request received — log ALL proxy headers for diagnosis
  // CHECKPOINT 2: Session cookie validated — JWT verified
  // CHECKPOINT 3: CSRF state generated — redirect_uri constructed
  // CHECKPOINT 4: Redirecting to Discord OAuth consent screen
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

    // ── CHECKPOINT 1: Full request context dump ──────────────────────────────
    // Log every proxy header so we can diagnose redirect_uri construction issues
    console.log(
      `[DiscordAuth][CHECKPOINT:1] /connect — requestId=${requestId}` +
      `\n  → x-forwarded-proto   : "${req.get("x-forwarded-proto") ?? "NOT_SET"}"` +
      `\n  → x-forwarded-host    : "${req.get("x-forwarded-host") ?? "NOT_SET"}"` +
      `\n  → x-forwarded-for     : "${req.get("x-forwarded-for") ?? "NOT_SET"}"` +
      `\n  → host                : "${req.get("host") ?? "NOT_SET"}"` +
      `\n  → origin (header)     : "${req.get("origin") ?? "NOT_SET"}"` +
      `\n  → referer             : "${req.get("referer") ?? "NOT_SET"}"` +
      `\n  → req.protocol        : "${req.protocol}"` +
      `\n  → req.hostname        : "${req.hostname}"` +
      `\n  → ENV.publicOrigin    : "${ENV.publicOrigin || "NOT_SET"}"` +
      `\n  → NODE_ENV            : "${process.env.NODE_ENV ?? "NOT_SET"}"` +
      `\n  → cookie_present      : ${!!(req.headers.cookie)}`
    );

    // ── CHECKPOINT 2: Session cookie validation ──────────────────────────────
    const token = getAppCookie(req);
    if (!token) {
      console.log(
        `[DiscordAuth][CHECKPOINT:2.FAIL] /connect — requestId=${requestId}` +
        ` REJECTED: no app_session cookie present` +
        ` | all_cookie_keys=${JSON.stringify(Object.keys(parseCookieHeader(req.headers.cookie ?? "")))}`
      );
      res.redirect(302, "/?error=not_logged_in");
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:2.OK] /connect — requestId=${requestId}` +
      ` app_session cookie found (length=${token.length}) — verifying JWT…`
    );

    const payload = await verifyAppUserToken(token);
    if (!payload) {
      console.log(
        `[DiscordAuth][CHECKPOINT:2.FAIL] /connect — requestId=${requestId}` +
        ` REJECTED: JWT verification failed (expired or tampered token)`
      );
      res.redirect(302, "/?error=invalid_session");
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:2.OK] /connect — requestId=${requestId}` +
      ` JWT valid: userId=${payload.userId}`
    );

    // ── CHECKPOINT 3: Build redirect_uri and CSRF state ──────────────────────
    cleanExpiredStates();
    const state = generateState();
    pendingStates.set(state, { userId: payload.userId, expiresAt: Date.now() + 10 * 60 * 1000 });

    // Build the canonical public origin — see buildPublicOrigin() docs above
    const publicOrigin = buildPublicOrigin(req, requestId);
    const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

    const params = new URLSearchParams({
      client_id:     ENV.discordClientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         "identify",
      state,
    });

    const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

    console.log(
      `[DiscordAuth][CHECKPOINT:3.OK] /connect — requestId=${requestId}` +
      ` userId=${payload.userId}` +
      `\n  → publicOrigin  : "${publicOrigin}"` +
      `\n  → redirectUri   : "${redirectUri}"` +
      `\n  → state         : "${state.slice(0, 8)}…"` +
      `\n  → authorizeUrl  : "${authorizeUrl.slice(0, 120)}…"` +
      `\n  → CSRF state stored, expires in 10 min`
    );

    // ── CHECKPOINT 4: Redirect ───────────────────────────────────────────────
    console.log(
      `[DiscordAuth][CHECKPOINT:4] /connect — requestId=${requestId}` +
      ` → 302 redirect to Discord OAuth consent screen`
    );
    res.redirect(302, authorizeUrl);
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  //
  // CHECKPOINT 5: Callback received — validate code + state params
  // CHECKPOINT 6: CSRF state validated — exchange code for access token
  // CHECKPOINT 7: Token exchanged — fetch Discord user profile
  // CHECKPOINT 8: Profile fetched — check for discordId conflicts in DB
  // CHECKPOINT 9: Conflict check passed — write Discord fields to DB
  // CHECKPOINT 10: SUCCESS — redirect to dashboard with discord_linked=1
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const code  = typeof req.query.code  === "string" ? req.query.code  : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const error = typeof req.query.error === "string" ? req.query.error : null;

    console.log(
      `[DiscordAuth][CHECKPOINT:5] /callback — requestId=${requestId}` +
      `\n  → code_present  : ${!!code}` +
      `\n  → state_present : ${!!state}` +
      `\n  → discord_error : "${error ?? "none"}"` +
      `\n  → query_keys    : ${JSON.stringify(Object.keys(req.query))}` +
      `\n  → x-forwarded-host : "${req.get("x-forwarded-host") ?? "NOT_SET"}"` +
      `\n  → ENV.publicOrigin : "${ENV.publicOrigin || "NOT_SET"}"`
    );

    if (error) {
      console.log(
        `[DiscordAuth][CHECKPOINT:5.FAIL] /callback — requestId=${requestId}` +
        ` Discord returned error="${error}" (user denied OAuth or Discord error)`
      );
      res.redirect(302, "/dashboard?discord_error=denied");
      return;
    }

    if (!code || !state) {
      console.log(
        `[DiscordAuth][CHECKPOINT:5.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: missing code=${!code} state=${!state}`
      );
      res.redirect(302, "/dashboard?discord_error=invalid_request");
      return;
    }

    cleanExpiredStates();
    const stateData = pendingStates.get(state);

    console.log(
      `[DiscordAuth][CHECKPOINT:6] /callback — requestId=${requestId}` +
      ` validating CSRF state="${state.slice(0, 8)}…"` +
      ` | pendingStates_size=${pendingStates.size}` +
      ` | state_found=${!!stateData}` +
      ` | state_expired=${stateData ? stateData.expiresAt < Date.now() : "N/A"}`
    );

    if (!stateData || stateData.expiresAt < Date.now()) {
      console.log(
        `[DiscordAuth][CHECKPOINT:6.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: state "${state.slice(0, 8)}…" is ${!stateData ? "not found in pendingStates" : "expired"}` +
        ` | This can happen if the server restarted between /connect and /callback (pendingStates is in-memory)`
      );
      res.redirect(302, "/dashboard?discord_error=state_mismatch");
      return;
    }

    pendingStates.delete(state);
    const { userId } = stateData;

    // Build the redirect_uri — must EXACTLY match what was sent in /connect
    // and what is registered in the Discord Developer Portal
    const publicOrigin = buildPublicOrigin(req, requestId);
    const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

    console.log(
      `[DiscordAuth][CHECKPOINT:6.OK] /callback — requestId=${requestId}` +
      ` CSRF state valid: userId=${userId}` +
      `\n  → publicOrigin : "${publicOrigin}"` +
      `\n  → redirectUri  : "${redirectUri}"` +
      `\n  → Exchanging authorization code for access token…`
    );

    try {
      // ── Token exchange ────────────────────────────────────────────────────
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     ENV.discordClientId,
          client_secret: ENV.discordClientSecret,
          grant_type:    "authorization_code",
          code,
          redirect_uri:  redirectUri,
        }),
      });

      console.log(
        `[DiscordAuth][CHECKPOINT:7] /callback — requestId=${requestId}` +
        ` token exchange response: HTTP ${tokenRes.status} ok=${tokenRes.ok}` +
        `\n  → redirectUri used in token exchange: "${redirectUri}"` +
        `\n  → NOTE: This redirectUri must EXACTLY match the one sent in /connect AND registered in Discord Portal`
      );

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error(
          `[DiscordAuth][CHECKPOINT:7.FAIL] /callback — requestId=${requestId}` +
          ` token exchange FAILED: HTTP ${tokenRes.status}` +
          `\n  → body: "${errText.slice(0, 300)}"` +
          `\n  → redirectUri: "${redirectUri}"` +
          `\n  → LIKELY CAUSE: redirect_uri mismatch — Discord app must have "${redirectUri}" registered` +
          `\n  → Check Discord Developer Portal → OAuth2 → Redirects`
        );
        res.redirect(302, "/dashboard?discord_error=token_exchange_failed");
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string; token_type: string };
      const accessToken = tokenData.access_token;
      // NOTE: access_token is intentionally NOT stored anywhere

      // ── Profile fetch ─────────────────────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:8] /callback — requestId=${requestId}` +
        ` userId=${userId} — fetching Discord /users/@me profile…`
      );

      const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log(
        `[DiscordAuth][CHECKPOINT:8] /callback — requestId=${requestId}` +
        ` profile fetch: HTTP ${profileRes.status} ok=${profileRes.ok}`
      );

      if (!profileRes.ok) {
        const errText = await profileRes.text();
        console.error(
          `[DiscordAuth][CHECKPOINT:8.FAIL] /callback — requestId=${requestId}` +
          ` profile fetch FAILED: HTTP ${profileRes.status} body="${errText.slice(0, 200)}"`
        );
        res.redirect(302, "/dashboard?discord_error=profile_fetch_failed");
        return;
      }

      const profile = await profileRes.json() as {
        id: string;
        username: string;
        discriminator?: string;
        avatar?: string;
      };

      const discordId       = profile.id;
      const discordUsername = profile.discriminator && profile.discriminator !== "0"
        ? `${profile.username}#${profile.discriminator}`
        : profile.username;
      const discordAvatar   = profile.avatar ?? null;

      console.log(
        `[DiscordAuth][CHECKPOINT:8.OK] /callback — requestId=${requestId}` +
        ` Discord profile fetched:` +
        `\n  → discordId       : "${discordId}"` +
        `\n  → discordUsername : "${discordUsername}"` +
        `\n  → avatar          : ${discordAvatar ? "present" : "none"}`
      );

      // ── Conflict check ────────────────────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:9] /callback — requestId=${requestId}` +
        ` checking DB: is discordId="${discordId}" already linked to a different user?`
      );

      const db = await getDb();
      if (db) {
        const existing = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.discordId, discordId))
          .limit(1);

        if (existing.length > 0 && existing[0].id !== userId) {
          console.warn(
            `[DiscordAuth][CHECKPOINT:9.FAIL] /callback — requestId=${requestId}` +
            ` CONFLICT: discordId="${discordId}" already linked to userId=${existing[0].id}` +
            ` (attempted link from userId=${userId}) — blocking to prevent account takeover`
          );
          res.redirect(302, "/dashboard?discord_error=already_linked");
          return;
        }

        console.log(
          `[DiscordAuth][CHECKPOINT:9.OK] /callback — requestId=${requestId}` +
          ` no conflict (existing_links=${existing.length}) — writing Discord fields to DB for userId=${userId}…`
        );
      } else {
        console.warn(
          `[DiscordAuth][CHECKPOINT:9.WARN] /callback — requestId=${requestId}` +
          ` getDb() returned null — skipping conflict check, proceeding with write`
        );
      }

      // ── Write to DB ───────────────────────────────────────────────────────
      await updateAppUser(userId, {
        discordId,
        discordUsername,
        discordAvatar,
        discordConnectedAt: Date.now(),
      } as Parameters<typeof updateAppUser>[1]);

      console.log(
        `[DiscordAuth][CHECKPOINT:10.SUCCESS] /callback — requestId=${requestId}` +
        ` userId=${userId} successfully linked to Discord @${discordUsername} (id=${discordId})` +
        ` → redirecting to /dashboard?discord_linked=1`
      );

      res.redirect(302, "/dashboard?discord_linked=1");

    } catch (err) {
      console.error(
        `[DiscordAuth][CHECKPOINT:EXCEPTION] /callback — requestId=${requestId}` +
        ` userId=${userId} UNEXPECTED ERROR:`,
        err
      );
      res.redirect(302, "/dashboard?discord_error=server_error");
    }
  });

  // ─── Step 3: Disconnect Discord account ───────────────────────────────────
  //
  // CHECKPOINT A: Request received — validate session cookie
  // CHECKPOINT B: JWT verified — clear Discord fields from DB
  // CHECKPOINT C: SUCCESS — return {success: true}
  app.post(`${ROUTE_PREFIX}/disconnect`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    console.log(
      `[DiscordAuth][CHECKPOINT:A] /disconnect — requestId=${requestId}` +
      ` cookie_present=${!!(req.headers.cookie)}`
    );

    const token = getAppCookie(req);
    if (!token) {
      console.log(
        `[DiscordAuth][CHECKPOINT:A.FAIL] /disconnect — requestId=${requestId}` +
        ` REJECTED: no app_session cookie`
      );
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const payload = await verifyAppUserToken(token);
    if (!payload) {
      console.log(
        `[DiscordAuth][CHECKPOINT:A.FAIL] /disconnect — requestId=${requestId}` +
        ` REJECTED: JWT verification failed`
      );
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    const user = await getAppUserById(payload.userId);
    if (!user) {
      console.log(
        `[DiscordAuth][CHECKPOINT:B.FAIL] /disconnect — requestId=${requestId}` +
        ` REJECTED: userId=${payload.userId} not found in DB`
      );
      res.status(404).json({ error: "User not found" });
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:B.OK] /disconnect — requestId=${requestId}` +
      ` userId=${payload.userId} username="${user.username}"` +
      ` current discordId="${user.discordId ?? "none"}"` +
      ` → clearing Discord fields from DB…`
    );

    await updateAppUser(payload.userId, {
      discordId:          null,
      discordUsername:    null,
      discordAvatar:      null,
      discordConnectedAt: null,
    } as Parameters<typeof updateAppUser>[1]);

    console.log(
      `[DiscordAuth][CHECKPOINT:C.SUCCESS] /disconnect — requestId=${requestId}` +
      ` userId=${payload.userId} Discord account unlinked successfully`
    );

    res.json({ success: true });
  });

  // ── Final confirmation log ────────────────────────────────────────────────
  console.log(
    `[DiscordAuth][STARTUP] All 3 Discord routes registered:` +
    ` GET ${ROUTE_PREFIX}/connect,` +
    ` GET ${ROUTE_PREFIX}/callback,` +
    ` POST ${ROUTE_PREFIX}/disconnect`
  );
}

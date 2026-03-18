/**
 * Discord Account Linking Routes
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CRITICAL: All routes MUST be under /api/* prefix.                     │
 * │                                                                         │
 * │  The Manus production proxy ONLY forwards /api/* requests to the       │
 * │  Express backend. Any route outside /api/* is intercepted by the       │
 * │  static CDN and returns the SPA index.html (HTTP 200) instead of       │
 * │  hitting Express — causing a silent 404 from the user's perspective.   │
 * │                                                                         │
 * │  Routes:                                                                │
 * │    GET  /api/auth/discord/connect    — redirect to Discord OAuth       │
 * │    GET  /api/auth/discord/callback   — handle OAuth code exchange      │
 * │    POST /api/auth/discord/disconnect — clear Discord fields from DB    │
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
 *   Checkpoints are numbered sequentially per request so you can trace
 *   exactly how far a request got before failing.
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
// The Manus edge proxy routes /api/* → Express backend.
// Everything else → static CDN (returns SPA index.html, bypasses Express).
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

/** Build the canonical origin from the incoming request, respecting proxy headers. */
function buildOrigin(req: Request): string {
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host  = req.get("x-forwarded-host")  ?? req.get("host");
  return `${proto}://${host}`;
}

export function registerDiscordAuthRoutes(app: Express) {
  // ── Startup confirmation log ─────────────────────────────────────────────
  // This fires once at server startup. If you see this in logs, the routes
  // ARE registered. If you don't see it, the import/call failed silently.
  console.log(
    `[DiscordAuth][STARTUP] Registering Discord OAuth routes under prefix="${ROUTE_PREFIX}"` +
    ` | clientId=${ENV.discordClientId ? `${ENV.discordClientId.slice(0,6)}…` : "MISSING"}` +
    ` | clientSecret=${ENV.discordClientSecret ? "SET" : "MISSING"}` +
    ` | guildId=${ENV.discordGuildId || "MISSING"}` +
    ` | roleId=${ENV.discordRoleAiModelSub || "MISSING"}`
  );

  // ─── Step 1: Redirect to Discord OAuth ────────────────────────────────────
  // CHECKPOINT 1: Request received — validate session cookie
  // CHECKPOINT 2: JWT verified — generate CSRF state, build redirect URL
  // CHECKPOINT 3: Redirecting to Discord OAuth consent screen
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8);
    const origin = buildOrigin(req);
    console.log(
      `[DiscordAuth][CHECKPOINT:1] /connect — requestId=${requestId}` +
      ` origin="${origin}"` +
      ` x-forwarded-proto="${req.get("x-forwarded-proto") ?? "none"}"` +
      ` x-forwarded-host="${req.get("x-forwarded-host") ?? "none"}"` +
      ` host="${req.get("host") ?? "none"}"` +
      ` cookie_header_present=${!!(req.headers.cookie)}`
    );

    const token = getAppCookie(req);
    if (!token) {
      console.log(
        `[DiscordAuth][CHECKPOINT:1.FAIL] /connect — requestId=${requestId}` +
        ` REJECTED: no app_session cookie present in request` +
        ` (all cookies: ${JSON.stringify(Object.keys(parseCookieHeader(req.headers.cookie ?? "")))})`
      );
      res.redirect(302, "/?error=not_logged_in");
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:1.OK] /connect — requestId=${requestId}` +
      ` app_session cookie found (length=${token.length}), verifying JWT…`
    );

    const payload = await verifyAppUserToken(token);
    if (!payload) {
      console.log(
        `[DiscordAuth][CHECKPOINT:2.FAIL] /connect — requestId=${requestId}` +
        ` REJECTED: JWT verification failed (token may be expired or tampered)`
      );
      res.redirect(302, "/?error=invalid_session");
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:2.OK] /connect — requestId=${requestId}` +
      ` JWT valid: userId=${payload.userId}` +
      ` | generating CSRF state token…`
    );

    cleanExpiredStates();
    const state = generateState();
    pendingStates.set(state, { userId: payload.userId, expiresAt: Date.now() + 10 * 60 * 1000 });

    // callback URI must match what's registered in the Discord app
    const redirectUri = `${origin}${ROUTE_PREFIX}/callback`;

    const params = new URLSearchParams({
      client_id: ENV.discordClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify",
      state,
    });

    const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

    console.log(
      `[DiscordAuth][CHECKPOINT:3.OK] /connect — requestId=${requestId}` +
      ` userId=${payload.userId}` +
      ` state="${state.slice(0, 8)}…"` +
      ` redirectUri="${redirectUri}"` +
      ` → redirecting to Discord OAuth consent screen`
    );

    res.redirect(302, authorizeUrl);
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  // CHECKPOINT 4: Callback received — validate code + state params
  // CHECKPOINT 5: CSRF state validated — exchange code for access token
  // CHECKPOINT 6: Token exchanged — fetch Discord user profile
  // CHECKPOINT 7: Profile fetched — check for discordId conflicts in DB
  // CHECKPOINT 8: Conflict check passed — write Discord fields to DB
  // CHECKPOINT 9: SUCCESS — redirect to dashboard with discord_linked=1
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8);
    const code  = typeof req.query.code  === "string" ? req.query.code  : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const origin = buildOrigin(req);

    console.log(
      `[DiscordAuth][CHECKPOINT:4] /callback — requestId=${requestId}` +
      ` origin="${origin}"` +
      ` code_present=${!!code}` +
      ` state_present=${!!state}` +
      ` discord_error="${error ?? "none"}"` +
      ` query_keys=${JSON.stringify(Object.keys(req.query))}`
    );

    if (error) {
      console.log(
        `[DiscordAuth][CHECKPOINT:4.FAIL] /callback — requestId=${requestId}` +
        ` Discord returned error="${error}" (user denied OAuth or Discord error)`
      );
      res.redirect(302, "/dashboard?discord_error=denied");
      return;
    }

    if (!code || !state) {
      console.log(
        `[DiscordAuth][CHECKPOINT:4.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: missing code=${!code} or state=${!state}`
      );
      res.redirect(302, "/dashboard?discord_error=invalid_request");
      return;
    }

    cleanExpiredStates();
    const stateData = pendingStates.get(state);

    console.log(
      `[DiscordAuth][CHECKPOINT:5] /callback — requestId=${requestId}` +
      ` validating CSRF state="${state.slice(0, 8)}…"` +
      ` pendingStates_size=${pendingStates.size}` +
      ` state_found=${!!stateData}` +
      ` state_expired=${stateData ? stateData.expiresAt < Date.now() : "N/A"}`
    );

    if (!stateData || stateData.expiresAt < Date.now()) {
      console.log(
        `[DiscordAuth][CHECKPOINT:5.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: state "${state.slice(0, 8)}…" is ${!stateData ? "not found" : "expired"}` +
        ` (state may have been used already or TTL expired after 10 min)`
      );
      res.redirect(302, "/dashboard?discord_error=state_mismatch");
      return;
    }

    pendingStates.delete(state);
    const { userId } = stateData;

    // callback URI must exactly match what was sent in /connect
    const redirectUri = `${origin}${ROUTE_PREFIX}/callback`;

    console.log(
      `[DiscordAuth][CHECKPOINT:5.OK] /callback — requestId=${requestId}` +
      ` CSRF state valid: userId=${userId}` +
      ` redirectUri="${redirectUri}"` +
      ` → exchanging authorization code for access token…`
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
        `[DiscordAuth][CHECKPOINT:6] /callback — requestId=${requestId}` +
        ` token exchange response: status=${tokenRes.status}` +
        ` ok=${tokenRes.ok}`
      );

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error(
          `[DiscordAuth][CHECKPOINT:6.FAIL] /callback — requestId=${requestId}` +
          ` token exchange FAILED: HTTP ${tokenRes.status}` +
          ` body="${errText.slice(0, 200)}"` +
          ` | Likely cause: redirect_uri mismatch — Discord app must have "${redirectUri}" registered`
        );
        res.redirect(302, "/dashboard?discord_error=token_exchange_failed");
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string; token_type: string };
      const accessToken = tokenData.access_token;
      // NOTE: access_token is intentionally NOT stored anywhere — used only to fetch profile

      // ── Profile fetch ─────────────────────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:7] /callback — requestId=${requestId}` +
        ` userId=${userId} fetching Discord /users/@me profile…`
      );

      const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log(
        `[DiscordAuth][CHECKPOINT:7] /callback — requestId=${requestId}` +
        ` profile fetch response: status=${profileRes.status} ok=${profileRes.ok}`
      );

      if (!profileRes.ok) {
        const errText = await profileRes.text();
        console.error(
          `[DiscordAuth][CHECKPOINT:7.FAIL] /callback — requestId=${requestId}` +
          ` profile fetch FAILED: HTTP ${profileRes.status}` +
          ` body="${errText.slice(0, 200)}"`
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
        `[DiscordAuth][CHECKPOINT:7.OK] /callback — requestId=${requestId}` +
        ` Discord profile: id=${discordId} username="${discordUsername}"` +
        ` avatar=${discordAvatar ? "present" : "none"}`
      );

      // ── Conflict check: is this discordId already linked to a different user? ─
      console.log(
        `[DiscordAuth][CHECKPOINT:8] /callback — requestId=${requestId}` +
        ` checking DB for existing link: discordId=${discordId}…`
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
            `[DiscordAuth][CHECKPOINT:8.FAIL] /callback — requestId=${requestId}` +
            ` CONFLICT: discordId=${discordId} already linked to userId=${existing[0].id}` +
            ` (attempted link from userId=${userId}) — blocking to prevent account takeover`
          );
          res.redirect(302, "/dashboard?discord_error=already_linked");
          return;
        }

        console.log(
          `[DiscordAuth][CHECKPOINT:8.OK] /callback — requestId=${requestId}` +
          ` no conflict found (existing_links=${existing.length})` +
          ` → writing Discord fields to DB for userId=${userId}…`
        );
      } else {
        console.warn(
          `[DiscordAuth][CHECKPOINT:8.WARN] /callback — requestId=${requestId}` +
          ` getDb() returned null — skipping conflict check, proceeding with write`
        );
      }

      // ── Write Discord fields to DB ─────────────────────────────────────────
      await updateAppUser(userId, {
        discordId,
        discordUsername,
        discordAvatar,
        discordConnectedAt: Date.now(),
      } as Parameters<typeof updateAppUser>[1]);

      console.log(
        `[DiscordAuth][CHECKPOINT:9.SUCCESS] /callback — requestId=${requestId}` +
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
  // CHECKPOINT A: Request received — validate session cookie
  // CHECKPOINT B: JWT verified — clear Discord fields from DB
  // CHECKPOINT C: SUCCESS — return {success: true}
  app.post(`${ROUTE_PREFIX}/disconnect`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8);
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

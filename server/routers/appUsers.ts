import { TRPCError } from "@trpc/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { parse as parseCookieHeader } from "cookie";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "../_core/env";
import type { Request } from "express";
import { postSecurityAlert } from "../discord/discordSecurityAlert";

import {
  createAppUser,
  listAppUsers,
  getAppUserById,
  getAppUserByEmail,
  getAppUserByUsername,
  updateAppUser,
  deleteAppUser,
  updateAppUserLastSignedIn,
  incrementTokenVersion,
  incrementAllTokenVersions,
  insertSecurityEvent,
} from "../db";

const APP_USER_COOKIE = "app_session";

function getAppCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[APP_USER_COOKIE];
}

// Helper: sign a JWT for an app user session — embeds tokenVersion (tv) for invalidation
async function signAppUserToken(userId: number, role: string, tokenVersion: number) {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  console.log(`[AppAuth] signAppUserToken: userId=${userId} role=${role} tv=${tokenVersion}`);
  return new SignJWT({ sub: String(userId), role, type: "app_user", tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(secret);
}

// Helper: verify app user JWT from cookie — returns userId, role, and tv (tokenVersion)
export async function verifyAppUserToken(token: string) {
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "app_user") {
      console.log(`[AppAuth] verifyAppUserToken: rejected — wrong type: ${payload.type}`);
      return null;
    }
    const tv = typeof payload.tv === "number" ? payload.tv : null;
    console.log(`[AppAuth] verifyAppUserToken: userId=${payload.sub} role=${payload.role} tv=${tv}`);
    return { userId: Number(payload.sub), role: payload.role as string, tv };
  } catch (e) {
    console.log(`[AppAuth] verifyAppUserToken: JWT verification failed — ${(e as Error).message}`);
    return null;
  }
}

// Owner-only middleware — validates tokenVersion against DB to support force-logout
export const ownerProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) {
    console.log(`[AppAuth] ownerProcedure: REJECTED — no app_session cookie`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  if (payload.role !== "owner") {
    console.log(`[AppAuth] ownerProcedure: REJECTED — role=${payload.role} (not owner)`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner access required" });
  }
  const user = await getAppUserById(payload.userId);
  if (!user || !user.hasAccess) {
    console.log(`[AppAuth] ownerProcedure: REJECTED — user not found or no access`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  // tokenVersion check: if tv in JWT doesn't match DB, the session was force-invalidated
  if (payload.tv !== null && payload.tv !== user.tokenVersion) {
    console.log(`[AppAuth] ownerProcedure: REJECTED — tokenVersion mismatch: jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalidated. Please log in again." });
  }
  console.log(`[AppAuth] ownerProcedure: GRANTED — userId=${user.id} username=${user.username} tv=${user.tokenVersion}`);
  return next({ ctx: { ...ctx, appUser: user } });
});

// Handicapper procedure — grants access to owner, admin, and handicapper roles
export const handicapperProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — no app_session cookie`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  const user = await getAppUserById(payload.userId);
  if (!user || !user.hasAccess) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — user not found or no access`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  if (payload.tv !== null && payload.tv !== user.tokenVersion) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — tokenVersion mismatch: jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalidated. Please log in again." });
  }
  const allowed = ["owner", "admin", "handicapper"] as const;
  if (!allowed.includes(user.role as typeof allowed[number])) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — role=${user.role} not in [owner, admin, handicapper]`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Handicapper access required" });
  }
  console.log(`[AppAuth] handicapperProcedure: GRANTED — userId=${user.id} username=${user.username} role=${user.role}`);
  return next({ ctx: { ...ctx, appUser: user } });
});

// Authenticated app user middleware — validates tokenVersion against DB to support force-logout
export const appUserProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — no app_session cookie`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  const user = await getAppUserById(payload.userId);
  if (!user) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — userId=${payload.userId} not found`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
  }
  if (!user.hasAccess) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — userId=${user.id} hasAccess=false`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  // tokenVersion check: if tv in JWT doesn't match DB, the session was force-invalidated
  if (payload.tv !== null && payload.tv !== user.tokenVersion) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — tokenVersion mismatch: jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalidated. Please log in again." });
  }
  // Check expiry
  if (user.expiryDate && Date.now() > user.expiryDate) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — userId=${user.id} account expired`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Account expired" });
  }
  console.log(`[AppAuth] appUserProcedure: GRANTED — userId=${user.id} username=${user.username} tv=${user.tokenVersion}`);
  return next({ ctx: { ...ctx, appUser: user } });
});

export const appUsersRouter = router({
  // ─── Auth ──────────────────────────────────────────────────────────────────

  login: publicProcedure
    .input(z.object({
      emailOrUsername: z.string().min(1),
      password: z.string().min(1),
      stayLoggedIn: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Try email first, then username
      const isEmail = input.emailOrUsername.includes("@");
      const user = isEmail
        ? await getAppUserByEmail(input.emailOrUsername.toLowerCase())
        : await getAppUserByUsername(input.emailOrUsername.replace(/^@/, "").toLowerCase());

      // ── AUTH_FAIL helper — fire-and-forget, never blocks the response ──────
      const fireAuthFailEvent = (reason: string) => {
        const ip = (ctx.req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          .trim() ?? ctx.req.socket?.remoteAddress ?? "unknown";
        const ua = (ctx.req.headers["user-agent"] as string | undefined) ?? null;
        const tag = "[AppAuth][AUTH_FAIL]";

        // Sanitize the identifier for logging — show first 3 chars + *** to avoid
        // logging full credentials in plaintext while still being useful for debugging.
        // For emails: show first 3 chars of the local part (before @) + *** + @domain
        // For usernames: show first 3 chars + ***
        const rawId = input.emailOrUsername;
        const isEmailId = rawId.includes("@");
        const sanitizedId = isEmailId
          ? (() => {
              const atIdx = rawId.indexOf("@");
              const local = rawId.substring(0, atIdx);
              const domain = rawId.substring(atIdx); // includes the @
              return `${local.substring(0, 3)}***${domain}`;
            })()
          : `${rawId.replace(/^@/, "").substring(0, 3)}***`;

        console.warn(
          `${tag} BLOCKED | IP=${ip} reason="${reason}"` +
          ` identifier="${sanitizedId}" ua="${ua?.substring(0, 60) ?? "none"}"`
        );
        const authFailAt = Date.now();
        insertSecurityEvent({
          eventType: "AUTH_FAIL",
          ip,
          blockedOrigin: null,
          trpcPath: "appUsers.login",
          httpMethod: ctx.req.method ?? "POST",
          userAgent: ua,
          context: reason,
          occurredAt: authFailAt,
        }).catch((err) =>
          console.error(`${tag} DB insert failed: ${(err as Error).message}`)
        );
        // [STEP] Post structured embed to 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 Discord channel (async, non-blocking)
        // targetIdentifier: the sanitized login credential the attacker used.
        // Shows WHAT account was targeted without exposing the full credential in logs.
        postSecurityAlert({
          eventType: "AUTH_FAIL",
          ip,
          path: "appUsers.login",
          method: ctx.req.method ?? "POST",
          userAgent: ua,
          context: reason,
          targetIdentifier: sanitizedId,
          occurredAt: authFailAt,
        }).catch((err) =>
          console.error(`${tag} Discord alert failed: ${(err as Error).message}`)
        );
      };

      if (!user) {
        fireAuthFailEvent("user_not_found");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      if (!user.hasAccess) {
        fireAuthFailEvent("account_access_disabled");
        throw new TRPCError({ code: "FORBIDDEN", message: "Account access disabled" });
      }
      if (user.expiryDate && Date.now() > user.expiryDate) {
        fireAuthFailEvent("account_expired");
        throw new TRPCError({ code: "FORBIDDEN", message: "Account has expired" });
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        fireAuthFailEvent("invalid_password");
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }

      await updateAppUserLastSignedIn(user.id);

      console.log(`[AppAuth] login: userId=${user.id} username=${user.username} role=${user.role} tv=${user.tokenVersion} stayLoggedIn=${input.stayLoggedIn}`);

      // stayLoggedIn = 90 days; otherwise session cookie (expires on browser close)
      const sessionDays = input.stayLoggedIn ? 90 : 1;
      const token = await signAppUserToken(user.id, user.role, user.tokenVersion);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      if (input.stayLoggedIn) {
        ctx.res.cookie(APP_USER_COOKIE, token, {
          ...cookieOptions,
          maxAge: sessionDays * 24 * 60 * 60 * 1000,
        });
      } else {
        // Session cookie — no maxAge, expires when browser closes
        ctx.res.cookie(APP_USER_COOKIE, token, {
          ...cookieOptions,
          maxAge: undefined,
        });
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          hasAccess: user.hasAccess,
          expiryDate: user.expiryDate,
        },
      };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(APP_USER_COOKIE, { ...cookieOptions, maxAge: -1 });
    return { success: true };
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    const token = getAppCookie(ctx.req);
    if (!token) return null;
    const payload = await verifyAppUserToken(token);
    if (!payload) return null;
    const user = await getAppUserById(payload.userId);
    if (!user || !user.hasAccess) return null;
    if (user.expiryDate && Date.now() > user.expiryDate) return null;
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      hasAccess: user.hasAccess,
      expiryDate: user.expiryDate,
      termsAccepted: user.termsAccepted,
      discordId: user.discordId ?? null,
      discordUsername: user.discordUsername ?? null,
      discordConnectedAt: user.discordConnectedAt ?? null,
    };
  }),

  // ─── Terms acceptance ──────────────────────────────────────────────────────

  acceptTerms: appUserProcedure.mutation(async ({ ctx }) => {
    await updateAppUser(ctx.appUser.id, {
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    } as Parameters<typeof updateAppUser>[1]);
    return { success: true };
  }),

  // ─── Owner-only User Management ────────────────────────────────────────────

  listUsers: ownerProcedure.query(async () => {
    const users = await listAppUsers();
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      hasAccess: u.hasAccess,
      expiryDate: u.expiryDate,
      createdAt: u.createdAt,
      lastSignedIn: u.lastSignedIn,
      termsAccepted: u.termsAccepted,
      termsAcceptedAt: u.termsAcceptedAt,
      discordId: u.discordId ?? null,
      discordUsername: u.discordUsername ?? null,
      discordConnectedAt: u.discordConnectedAt ?? null,
    }));
  }),

  createUser: ownerProcedure
    .input(z.object({
      email: z.string().email(),
      username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
      password: z.string().min(8),
      role: z.enum(["owner", "admin", "handicapper", "user"]).default("user"),
      hasAccess: z.boolean().default(true),
      expiryDate: z.number().nullable().default(null), // null = lifetime
    }))
    .mutation(async ({ input }) => {
      // Check uniqueness
      const existingEmail = await getAppUserByEmail(input.email.toLowerCase());
      if (existingEmail) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });

      const existingUsername = await getAppUserByUsername(input.username.toLowerCase());
      if (existingUsername) throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });

      const passwordHash = await bcrypt.hash(input.password, 12);
      await createAppUser({
        email: input.email.toLowerCase(),
        username: input.username.toLowerCase(),
        passwordHash,
        role: input.role,
        hasAccess: input.hasAccess,
        expiryDate: input.expiryDate ?? undefined,
      });

      return { success: true };
    }),

  updateUser: ownerProcedure
    .input(z.object({
      id: z.number().int().positive(),
      email: z.string().email().optional(),
      username: z.string().min(2).max(64).optional(),
      password: z.string().min(8).optional(),
      role: z.enum(["owner", "admin", "handicapper", "user"]).optional(),
      hasAccess: z.boolean().optional(),
      expiryDate: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, password, ...rest } = input;
      const existing = await getAppUserById(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      // Check email uniqueness if changing
      if (rest.email && rest.email.toLowerCase() !== existing.email) {
        const conflict = await getAppUserByEmail(rest.email.toLowerCase());
        if (conflict) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      // Check username uniqueness if changing
      if (rest.username && rest.username.toLowerCase() !== existing.username) {
        const conflict = await getAppUserByUsername(rest.username.toLowerCase());
        if (conflict) throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
      }

      const updateData: Record<string, unknown> = {};
      if (rest.email) updateData.email = rest.email.toLowerCase();
      if (rest.username) updateData.username = rest.username.toLowerCase();
      if (rest.role) updateData.role = rest.role;
      if (rest.hasAccess !== undefined) updateData.hasAccess = rest.hasAccess;
      if (rest.expiryDate !== undefined) updateData.expiryDate = rest.expiryDate;
      if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

      await updateAppUser(id, updateData as Parameters<typeof updateAppUser>[1]);
      return { success: true };
    }),

  deleteUser: ownerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.appUser.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete your own account" });
      }
      await deleteAppUser(input.id);
      return { success: true };
    }),

  // ─── Session Invalidation ──────────────────────────────────────────────────

  /**
   * Force-logout a specific user by incrementing their tokenVersion.
   * Their existing JWT will be rejected on next request (tv mismatch).
   * The owner's own session is NOT affected.
   */
  forceLogoutUser: ownerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.appUser.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot force-logout your own account" });
      }
      const user = await getAppUserById(input.id);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const newTv = await incrementTokenVersion(input.id);
      console.log(`[AppAuth] forceLogoutUser: userId=${input.id} username=${user.username} — tokenVersion incremented to ${newTv}`);
      return { success: true, newTokenVersion: newTv };
    }),

  /**
   * Force-logout ALL users EXCEPT the current owner.
   * Increments tokenVersion for every user whose id != ctx.appUser.id.
   * The owner stays logged in; all other sessions are immediately invalidated.
   */
  forceLogoutAll: ownerProcedure
    .mutation(async ({ ctx }) => {
      const count = await incrementAllTokenVersions(ctx.appUser.id);
      console.log(`[AppAuth] forceLogoutAll: invalidated sessions for ${count} users (excluded owner userId=${ctx.appUser.id})`);
      return { success: true, usersAffected: count };
    }),

  // ─── Discord Admin Controls ────────────────────────────────────────────────
  /**
   * OWNER-ONLY: Disconnect a user's Discord account.
   *
   * POLICY: Users cannot disconnect their own Discord — once linked, it is
   * permanent from the user's perspective. Only the owner (@prez) can unlink
   * a Discord account via the User Management admin panel.
   *
   * CHECKPOINT:ADMIN_DISCORD_DISCONNECT — logs who disconnected whom and when.
   */
  adminDisconnectDiscord: ownerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.1] ` +
        `owner=${ctx.appUser.username}(id=${ctx.appUser.id}) ` +
        `target=userId(${input.id}) ` +
        `action=UNLINK_DISCORD ` +
        `timestamp=${new Date().toISOString()}`);

      const user = await getAppUserById(input.id);
      if (!user) {
        console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.ERR] userId=${input.id} NOT_FOUND`);
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (!user.discordId) {
        console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.SKIP] userId=${input.id} username=${user.username} — no Discord linked, nothing to do`);
        throw new TRPCError({ code: "BAD_REQUEST", message: "This user has no Discord account linked" });
      }

      console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.2] ` +
        `unlinking discordId=${user.discordId} discordUsername=${user.discordUsername} ` +
        `from userId=${input.id} username=${user.username}`);

      await updateAppUser(input.id, {
        discordId: null,
        discordUsername: null,
        discordAvatar: null,
        discordConnectedAt: null,
      });

      console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.SUCCESS] ` +
        `userId=${input.id} username=${user.username} ` +
        `previousDiscordId=${user.discordId} previousDiscordUsername=${user.discordUsername} ` +
        `unlinkedBy=owner(${ctx.appUser.username}) ` +
        `timestamp=${new Date().toISOString()}`);

      return {
        success: true,
        unlinkedDiscordId: user.discordId,
        unlinkedDiscordUsername: user.discordUsername,
      };
    }),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { parse as parseCookieHeader } from "cookie";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "../_core/env";
import type { Request } from "express";

import {
  createAppUser,
  listAppUsers,
  getAppUserById,
  getAppUserByEmail,
  getAppUserByUsername,
  updateAppUser,
  deleteAppUser,
  updateAppUserLastSignedIn,
} from "../db";

const APP_USER_COOKIE = "app_session";

function getAppCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[APP_USER_COOKIE];
}

// Helper: sign a JWT for an app user session
async function signAppUserToken(userId: number, role: string) {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  return new SignJWT({ sub: String(userId), role, type: "app_user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

// Helper: verify app user JWT from cookie
export async function verifyAppUserToken(token: string) {
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "app_user") return null;
    return { userId: Number(payload.sub), role: payload.role as string };
  } catch {
    return null;
  }
}

// Owner-only middleware
export const ownerProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  if (payload.role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Owner access required" });
  const user = await getAppUserById(payload.userId);
  if (!user || !user.hasAccess) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  return next({ ctx: { ...ctx, appUser: user } });
});

// Authenticated app user middleware — exported so other routers can use custom app auth
export const appUserProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  const user = await getAppUserById(payload.userId);
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
  if (!user.hasAccess) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  // Check expiry
  if (user.expiryDate && Date.now() > user.expiryDate) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Account expired" });
  }
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

      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      if (!user.hasAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Account access disabled" });
      }
      if (user.expiryDate && Date.now() > user.expiryDate) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Account has expired" });
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }

      await updateAppUserLastSignedIn(user.id);

      // stayLoggedIn = 90 days; otherwise session cookie (expires on browser close)
      const sessionDays = input.stayLoggedIn ? 90 : 1;
      const token = await signAppUserToken(user.id, user.role);
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
    }));
  }),

  createUser: ownerProcedure
    .input(z.object({
      email: z.string().email(),
      username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
      password: z.string().min(8),
      role: z.enum(["owner", "admin", "user"]).default("user"),
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
      role: z.enum(["owner", "admin", "user"]).optional(),
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
});

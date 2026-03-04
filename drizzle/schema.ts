import {
  bigint,
  boolean,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── App Users (custom accounts managed by owner) ────────────────────────────

export const appUsers = mysqlTable("app_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["owner", "admin", "user"]).default("user").notNull(),
  hasAccess: boolean("hasAccess").default(true).notNull(),
  /** NULL means lifetime access; otherwise a UTC timestamp in ms */
  expiryDate: bigint("expiryDate", { mode: "number" }),
  /** Whether the user has accepted the Age & Responsibility notice */
  termsAccepted: boolean("termsAccepted").default(false).notNull(),
  /** UTC timestamp (ms) when the user accepted the terms; NULL if not yet accepted */
  termsAcceptedAt: bigint("termsAcceptedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// ─── Model files (uploaded CSVs) ────────────────────────────────────────────

export const modelFiles = mysqlTable("model_files", {
  id: int("id").autoincrement().primaryKey(),
  uploadedBy: int("uploadedBy").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull().default("text/csv"),
  sizeBytes: int("sizeBytes").notNull().default(0),
  sport: varchar("sport", { length: 64 }).notNull().default("NCAAM"),
  gameDate: varchar("gameDate", { length: 20 }),
  status: mysqlEnum("status", ["pending", "processing", "done", "error"])
    .notNull()
    .default("pending"),
  rowsImported: int("rowsImported").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ModelFile = typeof modelFiles.$inferSelect;
export type InsertModelFile = typeof modelFiles.$inferInsert;

// ─── Games (parsed from CSV) ─────────────────────────────────────────────────

export const games = mysqlTable("games", {
  id: int("id").autoincrement().primaryKey(),
  fileId: int("fileId").notNull(),
  gameDate: varchar("gameDate", { length: 20 }).notNull(),
  startTimeEst: varchar("startTimeEst", { length: 10 }).notNull(),
  awayTeam: varchar("awayTeam", { length: 128 }).notNull(),
  awayBookSpread: decimal("awayBookSpread", { precision: 6, scale: 1 }),
  awayModelSpread: decimal("awayModelSpread", { precision: 6, scale: 1 }),
  homeTeam: varchar("homeTeam", { length: 128 }).notNull(),
  homeBookSpread: decimal("homeBookSpread", { precision: 6, scale: 1 }),
  homeModelSpread: decimal("homeModelSpread", { precision: 6, scale: 1 }),
  bookTotal: decimal("bookTotal", { precision: 6, scale: 1 }),
  modelTotal: decimal("modelTotal", { precision: 6, scale: 1 }),
  spreadEdge: varchar("spreadEdge", { length: 128 }),
  spreadDiff: decimal("spreadDiff", { precision: 5, scale: 1 }),
  totalEdge: varchar("totalEdge", { length: 128 }),
  totalDiff: decimal("totalDiff", { precision: 5, scale: 1 }),
  sport: varchar("sport", { length: 64 }).notNull().default("NCAAM"),
  /** 'regular_season' or 'conference_tournament' */
  gameType: mysqlEnum("gameType", ["regular_season", "conference_tournament"]).notNull().default("regular_season"),
  /** Conference name for tournament games, e.g. 'MAC', 'Big East' */
  conference: varchar("conference", { length: 128 }),
  /** Whether this game has been published to the member feed by the owner */
  publishedToFeed: boolean("publishedToFeed").notNull().default(false),
  /** WagerTalk display order — lower number appears first */
  sortOrder: int("sortOrder").notNull().default(9999),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;

// ─── ESPN Teams (auto-synced from ESPN) ─────────────────────────────────────

export const espnTeams = mysqlTable("espn_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** Normalized slug matching the model file team name, e.g. "duke", "nc_state" */
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  /** Full display name from ESPN, e.g. "Duke Blue Devils" */
  displayName: varchar("displayName", { length: 255 }).notNull(),
  /** ESPN numeric team ID used to build CDN logo URL */
  espnId: varchar("espnId", { length: 20 }).notNull(),
  /** Conference name from ESPN, e.g. "ACC", "Big Ten" */
  conference: varchar("conference", { length: 128 }).notNull().default(""),
  /** Sport identifier, e.g. "NCAAM", "NBA" */
  sport: varchar("sport", { length: 64 }).notNull().default("NCAAM"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EspnTeam = typeof espnTeams.$inferSelect;
export type InsertEspnTeam = typeof espnTeams.$inferInsert;

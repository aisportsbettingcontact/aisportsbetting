import {
  bigint,
  boolean,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
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
  /**
   * Session invalidation version. Incremented on force-logout.
   * JWT payload must carry a matching `tv` claim — mismatches are rejected immediately.
   * forceLogout(userId): increment this user's tokenVersion
   * forceLogoutAll(): increment ALL users' tokenVersion in one SQL UPDATE
   */
  tokenVersion: int("tokenVersion").default(1).notNull(),
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
  startTimeEst: varchar("startTimeEst", { length: 12 }).notNull().default("TBD"),
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
  /** Whether the model projections for this game have been approved by the owner for public display */
  publishedModel: boolean("publishedModel").notNull().default(false),
  // ─── VSiN Betting Splits (integer 0-100, null = not yet scraped) ───────────
  /** % of spread bets placed on the away team */
  spreadAwayBetsPct: tinyint("spreadAwayBetsPct"),
  /** % of spread money wagered on the away team */
  spreadAwayMoneyPct: tinyint("spreadAwayMoneyPct"),
  /** % of total (O/U) bets placed on the Over */
  totalOverBetsPct: tinyint("totalOverBetsPct"),
  /** % of total (O/U) money wagered on the Over */
  totalOverMoneyPct: tinyint("totalOverMoneyPct"),
  /** % of moneyline bets placed on the away team */
  mlAwayBetsPct: tinyint("mlAwayBetsPct"),
  /** % of moneyline money wagered on the away team */
  mlAwayMoneyPct: tinyint("mlAwayMoneyPct"),
  /** Away team moneyline odds, e.g. "+120" or "-900" */
  awayML: varchar("awayML", { length: 16 }),
  /** Home team moneyline odds, e.g. "-142" or "+600" */
  homeML: varchar("homeML", { length: 16 }),
  /** Model fair value moneyline for the away team, e.g. "+225" or "-670" */
  modelAwayML: varchar("modelAwayML", { length: 16 }),
  /** Model fair value moneyline for the home team, e.g. "-225" or "+670" */
  modelHomeML: varchar("modelHomeML", { length: 16 }),
  /** Model projected score for the away team (decimal, hundredths precision) */
  modelAwayScore: decimal("modelAwayScore", { precision: 6, scale: 2 }),
  /** Model projected score for the home team (decimal, hundredths precision) */
  modelHomeScore: decimal("modelHomeScore", { precision: 6, scale: 2 }),
  /** Model over rate from 50k simulations (0-100) */
  modelOverRate: decimal("modelOverRate", { precision: 5, scale: 2 }),
  /** Model under rate from 50k simulations (0-100) */
  modelUnderRate: decimal("modelUnderRate", { precision: 5, scale: 2 }),
  /** Away team win probability from model (0-100) */
  modelAwayWinPct: decimal("modelAwayWinPct", { precision: 5, scale: 2 }),
  /** Home team win probability from model (0-100) */
  modelHomeWinPct: decimal("modelHomeWinPct", { precision: 5, scale: 2 }),
  /** Whether the model spread was clamped to band limit */
  modelSpreadClamped: boolean("modelSpreadClamped").default(false),
  /** Whether the model total was clamped to band limit */
  modelTotalClamped: boolean("modelTotalClamped").default(false),
  /** Cover/total correlation direction: 'OVER', 'UNDER', or 'NONE' */
  modelCoverDirection: varchar("modelCoverDirection", { length: 8 }),
  /** UTC timestamp (ms) when the model last ran for this game */
  modelRunAt: bigint("modelRunAt", { mode: "number" }),
  /** WagerTalk rotation numbers e.g. '689/690' (away/home) */
  rotNums: varchar("rotNums", { length: 32 }),
  /** WagerTalk display order — lower number appears first */
  sortOrder: int("sortOrder").notNull().default(9999),
  /** NCAA contest ID (unique per game) — used to dedup NCAA-only games (e.g. TBA vs TBA) */
  ncaaContestId: varchar("ncaaContestId", { length: 20 }),
  /** Game status: 'upcoming' (pre-game), 'live' (in-progress), 'final' (completed) */
  gameStatus: mysqlEnum("gameStatus", ["upcoming", "live", "final"]).notNull().default("upcoming"),
  /** Away team current/final score (null = not started) */
  awayScore: int("awayScore"),
  /** Home team current/final score (null = not started) */
  homeScore: int("homeScore"),
  /** Game clock string for live games, e.g. "15:07 1st" or "HALF" (null = not live) */
  gameClock: varchar("gameClock", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  /** Prevent duplicate rows for the same matchup on the same date */
  uniqMatchup: uniqueIndex("games_matchup_unique").on(t.gameDate, t.awayTeam, t.homeTeam),
}));

export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;

// ─── NBA Teams (seeded from NBA Mapping master sheet) ───────────────────────

export const nbaTeams = mysqlTable("nba_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug with hyphens replaced by underscores, e.g. "boston_celtics" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** NBA.com short slug, e.g. "celtics" */
  nbaSlug: varchar("nbaSlug", { length: 64 }).notNull().unique(),
  /** VSiN href slug, e.g. "boston-celtics" */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Full team name, e.g. "Boston Celtics" */
  name: varchar("name", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Celtics" */
  nickname: varchar("nickname", { length: 128 }).notNull(),
  /** City name, e.g. "Boston" */
  city: varchar("city", { length: 128 }).notNull(),
  /** Conference: "East" or "West" */
  conference: varchar("conference", { length: 16 }).notNull(),
  /** Division, e.g. "Atlantic" */
  division: varchar("division", { length: 64 }).notNull(),
  /** NBA.com CDN SVG logo URL */
  logoUrl: text("logoUrl").notNull(),
  /** Standard NBA abbreviation, e.g. "BOS", "LAL", "GSW" */
  abbrev: varchar("abbrev", { length: 8 }),
  /** Primary brand hex color, e.g. "#007A33" */
  primaryColor: varchar("primaryColor", { length: 16 }),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NbaTeamRow = typeof nbaTeams.$inferSelect;
export type InsertNbaTeam = typeof nbaTeams.$inferInsert;

// ─── NCAAM Teams (seeded from NCAAM Mapping master sheet) ───────────────────

export const ncaamTeams = mysqlTable("ncaam_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug with hyphens replaced by underscores, e.g. "arkansas" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** NCAA.com seoname slug, e.g. "arkansas" */
  ncaaSlug: varchar("ncaaSlug", { length: 128 }).notNull().unique(),
  /** VSiN href slug, e.g. "arkansas" */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Full school name, e.g. "Arkansas" */
  ncaaName: varchar("ncaaName", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Razorbacks" */
  ncaaNickname: varchar("ncaaNickname", { length: 128 }).notNull(),
  /** VSiN display name */
  vsinName: varchar("vsinName", { length: 255 }).notNull(),
  /** Conference, e.g. "SEC" */
  conference: varchar("conference", { length: 128 }).notNull(),
  /** NCAA.com SVG logo URL */
  logoUrl: text("logoUrl").notNull(),
  /** KenPom.com team name for team.php?team= lookups, e.g. "Duke", "VCU", "Prairie View A&M" */
  kenpomSlug: varchar("kenpomSlug", { length: 255 }),
  /** Short abbreviation used by NCAA/VSiN, e.g. "DUKE", "UNC", "GONZ" */
  abbrev: varchar("abbrev", { length: 16 }),
  /** Primary brand hex color, e.g. "#9D2235" */
  primaryColor: varchar("primaryColor", { length: 16 }),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NcaamTeamRow = typeof ncaamTeams.$inferSelect;
export type InsertNcaamTeam = typeof ncaamTeams.$inferInsert;

// ─── NHL Teams (seeded from NHL.com + VSiN mapping) ────────────────────────────

export const nhlTeams = mysqlTable("nhl_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug with hyphens replaced by underscores, e.g. "buffalo_sabres" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** NHL.com URL slug, e.g. "buffalo-sabres" */
  nhlSlug: varchar("nhlSlug", { length: 128 }).notNull().unique(),
  /** VSiN href slug, e.g. "buffalo-sabres" (special: "ny-islanders" for NYI) */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Full team name, e.g. "Buffalo Sabres" */
  name: varchar("name", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Sabres" */
  nickname: varchar("nickname", { length: 128 }).notNull(),
  /** City name, e.g. "Buffalo" */
  city: varchar("city", { length: 128 }).notNull(),
  /** Conference: "EASTERN" or "WESTERN" */
  conference: mysqlEnum("conference", ["EASTERN", "WESTERN"]).notNull(),
  /** Division: "ATLANTIC", "METROPOLITAN", "CENTRAL", or "PACIFIC" */
  division: mysqlEnum("division", ["ATLANTIC", "METROPOLITAN", "CENTRAL", "PACIFIC"]).notNull(),
  /** NHL.com CDN SVG logo URL, e.g. "https://assets.nhle.com/logos/nhl/svg/BUF_dark.svg" */
  logoUrl: text("logoUrl").notNull(),
  /** Standard NHL abbreviation, e.g. "BUF", "TBL", "VGK" */
  abbrev: varchar("abbrev", { length: 8 }).notNull(),
  /** Primary brand hex color, e.g. "#003087" */
  primaryColor: varchar("primaryColor", { length: 16 }).notNull(),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }).notNull(),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NhlTeamRow = typeof nhlTeams.$inferSelect;
export type InsertNhlTeam = typeof nhlTeams.$inferInsert;

// ─── User Favorite Games ─────────────────────────────────────────────────────
export const userFavoriteGames = mysqlTable(
  "user_favorite_games",
  {
    id: int("id").autoincrement().primaryKey(),
    /** The app_user who favorited the game */
    appUserId: int("appUserId").notNull(),
    /** The game id being favorited */
    gameId: int("gameId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("user_game_uniq").on(t.appUserId, t.gameId),
  })
);
export type UserFavoriteGame = typeof userFavoriteGames.$inferSelect;
export type InsertUserFavoriteGame = typeof userFavoriteGames.$inferInsert;

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
  // ─── Discord account linking ────────────────────────────────────────────────
  /** Discord user ID (snowflake string), NULL = not linked */
  discordId: varchar("discordId", { length: 32 }),
  /** Discord username, e.g. "prezb3ts" */
  discordUsername: varchar("discordUsername", { length: 64 }),
  /** Discord avatar hash for CDN URL construction */
  discordAvatar: varchar("discordAvatar", { length: 128 }),
  /** UTC timestamp (ms) when the Discord account was linked */
  discordConnectedAt: bigint("discordConnectedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// ─── Discord OAuth CSRF state store (DB-backed, survives server restarts) ────
//
// WHY DB-BACKED:
//   Cloud Run can run multiple instances simultaneously. The /connect request
//   may hit instance A (stores state in memory) while the /callback request
//   hits instance B (empty pendingStates → state_mismatch → OAuth fails).
//   Storing state in the DB ensures all instances share the same state store.
//
// TTL: 10 minutes. Expired rows are cleaned up on each /callback request.
export const discordOAuthStates = mysqlTable("discord_oauth_states", {
  /** Random CSRF state token generated in /connect */
  state:     varchar("state",     { length: 64 }).primaryKey(),
  /** app_users.id of the user who initiated the OAuth flow */
  userId:    int("userId").notNull(),
  /** UTC timestamp (ms) when this state expires (10 min from creation) */
  expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
  /** UTC timestamp (ms) when this row was created */
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
});

export type DiscordOAuthState = typeof discordOAuthStates.$inferSelect;
export type InsertDiscordOAuthState = typeof discordOAuthStates.$inferInsert;

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
  /**
   * Puck line / spread juice for the away team, e.g. "-226" or "+184".
   * Populated from MetaBet consensus board for NHL games.
   * For NCAAM/NBA the spread is almost always -110 so this is typically null.
   */
  awaySpreadOdds: varchar("awaySpreadOdds", { length: 16 }),
  /** Puck line / spread juice for the home team, e.g. "+184" or "-226" */
  homeSpreadOdds: varchar("homeSpreadOdds", { length: 16 }),
  /** Over odds for the O/U total, e.g. "-107" (null = not available / standard -110) */
  overOdds: varchar("overOdds", { length: 16 }),
  /** Under odds for the O/U total, e.g. "-113" (null = not available / standard -110) */
  underOdds: varchar("underOdds", { length: 16 }),
  // ─── Action Network Open Lines (opening odds at time of market creation) ─────
  /** AN opening spread for the away team, e.g. "+8.5" or "-3" */
  openAwaySpread: varchar("openAwaySpread", { length: 16 }),
  /** AN opening spread juice for the away team, e.g. "-102" or "-110" */
  openAwaySpreadOdds: varchar("openAwaySpreadOdds", { length: 16 }),
  /** AN opening spread for the home team, e.g. "-8.5" or "+3" */
  openHomeSpread: varchar("openHomeSpread", { length: 16 }),
  /** AN opening spread juice for the home team, e.g. "-120" or "-110" */
  openHomeSpreadOdds: varchar("openHomeSpreadOdds", { length: 16 }),
  /** AN opening total (over line), e.g. "151.5" */
  openTotal: varchar("openTotal", { length: 16 }),
  /** AN opening over juice, e.g. "-110" */
  openOverOdds: varchar("openOverOdds", { length: 16 }),
  /** AN opening under juice, e.g. "-110" */
  openUnderOdds: varchar("openUnderOdds", { length: 16 }),
  /** AN opening moneyline for the away team, e.g. "+285" */
  openAwayML: varchar("openAwayML", { length: 16 }),
  /** AN opening moneyline for the home team, e.g. "-365" */
  openHomeML: varchar("openHomeML", { length: 16 }),
  // Note: DK NJ current lines are stored in the primary book columns:
  // awayBookSpread, homeBookSpread, bookTotal, awayML, homeML,
  // awaySpreadOdds, homeSpreadOdds, overOdds, underOdds
  // These are populated by the ingestAnHtml tRPC procedure (AN HTML best-odds table).
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
  // ─── March Madness Bracket Progression ──────────────────────────────────────
  /** NCAA.com bracket game ID, e.g. 101 (FF), 201-232 (R64), 301-316 (R32), etc. */
  bracketGameId: int("bracketGameId"),
  /** Tournament round: 'FIRST_FOUR', 'R64', 'R32', 'S16', 'E8', 'F4', 'CHAMPIONSHIP' */
  bracketRound: varchar("bracketRound", { length: 20 }),
  /** Tournament region: 'EAST', 'WEST', 'SOUTH', 'MIDWEST', 'FINAL_FOUR' */
  bracketRegion: varchar("bracketRegion", { length: 20 }),
  /** Slot within the region (1-8 for R64, 1-4 for R32, 1-2 for S16, 1 for E8) */
  bracketSlot: int("bracketSlot"),
  /** NCAA.com bracket game ID of the next-round game this winner advances to */
  nextBracketGameId: int("nextBracketGameId"),
  /** Whether the winner of this game fills the 'top' or 'bottom' slot in the next game */
  nextBracketSlot: mysqlEnum("nextBracketSlot", ["top", "bottom"]),
  /** Game status: 'upcoming' (pre-game), 'live' (in-progress), 'final' (completed) */
  gameStatus: mysqlEnum("gameStatus", ["upcoming", "live", "final"]).notNull().default("upcoming"),
  /** Away team current/final score (null = not started) */
  awayScore: int("awayScore"),
  /** Home team current/final score (null = not started) */
  homeScore: int("homeScore"),
  /** Game clock string for live games, e.g. "15:07 1st" or "HALF" (null = not live) */
  gameClock: varchar("gameClock", { length: 32 }),
  // ─── NHL-specific fields ──────────────────────────────────────────────────
  /** Starting goalie for the away team (NHL only), e.g. "Jeremy Swayman" */
  awayGoalie: varchar("awayGoalie", { length: 128 }),
  /** Starting goalie for the home team (NHL only), e.g. "Andrei Vasilevskiy" */
  homeGoalie: varchar("homeGoalie", { length: 128 }),
  /** Whether the away goalie is confirmed (true) or projected (false) */
  awayGoalieConfirmed: boolean("awayGoalieConfirmed").default(false),
  /** Whether the home goalie is confirmed (true) or projected (false) */
  homeGoalieConfirmed: boolean("homeGoalieConfirmed").default(false),
  /** Model puck line cover probability for the away team (0-100) */
  modelAwayPLCoverPct: decimal("modelAwayPLCoverPct", { precision: 5, scale: 2 }),
  /** Model puck line cover probability for the home team (0-100) */
  modelHomePLCoverPct: decimal("modelHomePLCoverPct", { precision: 5, scale: 2 }),
  /** Model puck line spread for the away team, e.g. "+1.5" or "-2.5" */
  modelAwayPuckLine: varchar("modelAwayPuckLine", { length: 8 }),
  /** Model puck line spread for the home team, e.g. "-1.5" or "+2.5" */
  modelHomePuckLine: varchar("modelHomePuckLine", { length: 8 }),
  /** Model fair value odds for the away puck line, e.g. "-133" or "+115" */
  modelAwayPLOdds: varchar("modelAwayPLOdds", { length: 16 }),
  /** Model fair value odds for the home puck line, e.g. "+133" or "-115" */
  modelHomePLOdds: varchar("modelHomePLOdds", { length: 16 }),
  /** Model fair value odds for the Over, e.g. "+131" or "-108" */
  modelOverOdds: varchar("modelOverOdds", { length: 16 }),
  /** Model fair value odds for the Under, e.g. "-131" or "+108" */
  modelUnderOdds: varchar("modelUnderOdds", { length: 16 }),
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

// ─── Odds History (per-game DK NJ line snapshots from AN API) ───────────────────

export const oddsHistory = mysqlTable("odds_history", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → games.id */
  gameId: int("gameId").notNull(),
  /** Sport: NCAAM, NBA, NHL */
  sport: varchar("sport", { length: 16 }).notNull(),
  /**
   * UTC timestamp (ms) when this snapshot was captured.
   * Stored as bigint so it survives timezone conversions cleanly.
   * Display in EST: new Date(scrapedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })
   */
  scrapedAt: bigint("scrapedAt", { mode: "number" }).notNull(),
  /** Source: 'auto' (hourly cron) or 'manual' (Refresh Now button) */
  source: mysqlEnum("source", ["auto", "manual"]).notNull().default("auto"),
  // ── DK NJ Spread snapshot ──
  awaySpread: varchar("awaySpread", { length: 16 }),
  awaySpreadOdds: varchar("awaySpreadOdds", { length: 16 }),
  homeSpread: varchar("homeSpread", { length: 16 }),
  homeSpreadOdds: varchar("homeSpreadOdds", { length: 16 }),
  // ── DK NJ Total snapshot ──
  total: varchar("total", { length: 16 }),
  overOdds: varchar("overOdds", { length: 16 }),
  underOdds: varchar("underOdds", { length: 16 }),
  // ── DK NJ Moneyline snapshot ──
  awayML: varchar("awayML", { length: 16 }),
  homeML: varchar("homeML", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OddsHistoryRow = typeof oddsHistory.$inferSelect;
export type InsertOddsHistory = typeof oddsHistory.$inferInsert;

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

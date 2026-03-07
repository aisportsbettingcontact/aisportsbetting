import { and, desc, eq, gte, isNotNull, lte, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { games, modelFiles, users, nbaTeams, ncaamTeams, type InsertGame, type InsertModelFile, type InsertUser, type InsertNbaTeam } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Model Files ─────────────────────────────────────────────────────────────

export async function insertModelFile(file: InsertModelFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(modelFiles).values(file);
  return result;
}

export async function listModelFiles(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(modelFiles)
    .where(eq(modelFiles.uploadedBy, userId))
    .orderBy(desc(modelFiles.createdAt));
}

export async function getModelFileById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(modelFiles).where(eq(modelFiles.id, id)).limit(1);
  return result[0] ?? null;
}

export async function updateModelFileStatus(
  id: number,
  status: "pending" | "processing" | "done" | "error",
  rowsImported?: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(modelFiles)
    .set({ status, ...(rowsImported !== undefined ? { rowsImported } : {}) })
    .where(eq(modelFiles.id, id));
}

export async function deleteModelFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(games).where(eq(games.fileId, id));
  await db.delete(modelFiles).where(eq(modelFiles.id, id));
}

// ─── Games ───────────────────────────────────────────────────────────────────

export async function insertGames(rows: InsertGame[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (rows.length === 0) return;
  // ON DUPLICATE KEY UPDATE: if (gameDate, awayTeam, homeTeam) already exists,
  // update the book odds and start time instead of throwing a duplicate key error.
  // This makes all inserts idempotent — safe to call multiple times.
  await db.insert(games).values(rows).onDuplicateKeyUpdate({
    set: {
      startTimeEst: sql`VALUES(startTimeEst)`,
      awayBookSpread: sql`VALUES(awayBookSpread)`,
      homeBookSpread: sql`VALUES(homeBookSpread)`,
      bookTotal: sql`VALUES(bookTotal)`,
      sortOrder: sql`VALUES(sortOrder)`,
      ncaaContestId: sql`COALESCE(ncaaContestId, VALUES(ncaaContestId))`,
    },
  });
}

/** Returns today's date in YYYY-MM-DD format using Eastern Time (matches DB storage format). */
function todayEst(): string {
  const now = new Date();
  // toLocaleDateString gives MM/DD/YYYY in en-US locale
  const estStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }); // e.g. "03/03/2026"
  const [mm, dd, yyyy] = estStr.split("/");
  return `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD to match parseDate() output
}

export async function listGames(opts?: { sport?: string; gameDate?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [];

  if (opts?.gameDate) {
    // Specific date requested — return only that date
    conditions.push(eq(games.gameDate, opts.gameDate));
  } else {
    // Default: show all games from today onwards (EST) so upcoming dates are visible
    conditions.push(gte(games.gameDate, todayEst()));
  }

  if (opts?.sport) conditions.push(eq(games.sport, opts.sport));

  // Public feed: show all games that have live VSiN odds (regardless of publishedToFeed)
  conditions.push(or(isNotNull(games.awayBookSpread), isNotNull(games.bookTotal))!);

  return db
    .select()
    .from(games)
    .where(and(...conditions))
    .orderBy(games.gameDate, sql`CASE WHEN ${games.startTimeEst} = '00:00' THEN '24:00' ELSE ${games.startTimeEst} END`, games.sortOrder);
}

export async function deleteGamesByFileId(fileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(games).where(eq(games.fileId, fileId));
}

/**
 * Delete all games whose gameDate is strictly before today's date in EST.
 * Called by the 6am EST daily cron job to purge previous-day data.
 * Returns the number of rows deleted.
 */
export async function deleteOldGames(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Compute today in EST as YYYY-MM-DD
  const estStr = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const [mm, dd, yyyy] = estStr.split("/");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const result = await db.delete(games).where(lt(games.gameDate, todayStr));
  const deleted = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
  console.log(`[DailyPurge] Deleted ${deleted} game rows older than ${todayStr} (EST)`);
  return deleted;
}

// ─── App Users (custom accounts) ─────────────────────────────────────────────────

import { appUsers, type InsertAppUser } from "../drizzle/schema";
export async function createAppUser(data: InsertAppUser) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(appUsers).values(data);
}

export async function listAppUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appUsers).orderBy(appUsers.createdAt);
}

export async function getAppUserById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appUsers).where(eq(appUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAppUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function getAppUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appUsers).where(eq(appUsers.username, username)).limit(1);
  return rows[0] ?? null;
}

export async function updateAppUser(id: number, data: Partial<InsertAppUser>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(appUsers).set({ ...data, updatedAt: new Date() }).where(eq(appUsers.id, id));
}

export async function deleteAppUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(appUsers).where(eq(appUsers.id, id));
}

export async function updateAppUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(appUsers).set({ lastSignedIn: new Date() }).where(eq(appUsers.id, id));
}

// ─── Publish / Model Projection helpers ──────────────────────────────────────

/** List all games for a given date, optionally filtered by sport */
export async function listGamesByDate(gameDate: string, sport?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [eq(games.gameDate, gameDate)];
  if (sport) conditions.push(eq(games.sport, sport));
  return db
    .select()
    .from(games)
    .where(and(...conditions))
    .orderBy(sql`CASE WHEN ${games.startTimeEst} = '00:00' THEN '24:00' ELSE ${games.startTimeEst} END`, games.sortOrder);
}

/** List all staging games for a given date (fileId = 0, unpublished), optionally filtered by sport */
export async function listStagingGames(gameDate: string, sport?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions: ReturnType<typeof eq>[] = [eq(games.gameDate, gameDate), eq(games.fileId, 0)];
  if (sport) conditions.push(eq(games.sport, sport));
  return db
    .select()
    .from(games)
    .where(and(...conditions))
    .orderBy(sql`CASE WHEN ${games.startTimeEst} = '00:00' THEN '24:00' ELSE ${games.startTimeEst} END`, games.sortOrder);
}
/** Update model projections and edge labels for a single game */
export async function updateGameProjections(
  id: number,
  data: {
    awayModelSpread?: string | null;
    homeModelSpread?: string | null;
    modelTotal?: string | null;
    spreadEdge?: string | null;
    spreadDiff?: string | null;
    totalEdge?: string | null;
    totalDiff?: string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(games).set(data).where(eq(games.id, id));
}

/** Toggle publishedToFeed for a single game */
/**
 * Update book odds (spread + total) for a single game.
 * Called by the VSiN live-refresh procedure.
 */
export async function updateBookOdds(
  id: number,
  data: {
    awayBookSpread: number | null;
    homeBookSpread: number | null;
    bookTotal: number | null;
    sortOrder?: number;
    startTimeEst?: string;
    // Betting splits (NCAAM: 4 fields; NBA: 6 fields + ML odds)
    spreadAwayBetsPct?: number | null;
    spreadAwayMoneyPct?: number | null;
    totalOverBetsPct?: number | null;
    totalOverMoneyPct?: number | null;
    mlAwayBetsPct?: number | null;
    mlAwayMoneyPct?: number | null;
    awayML?: string | null;
    homeML?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const { eq } = await import("drizzle-orm");
  const updateData: Record<string, unknown> = {
    awayBookSpread: data.awayBookSpread !== null ? String(data.awayBookSpread) : null,
    homeBookSpread: data.homeBookSpread !== null ? String(data.homeBookSpread) : null,
    bookTotal: data.bookTotal !== null ? String(data.bookTotal) : null,
  };
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.startTimeEst !== undefined) updateData.startTimeEst = data.startTimeEst;
  // Splits — only write non-undefined values (null = explicitly clear, undefined = skip)
  if (data.spreadAwayBetsPct !== undefined) updateData.spreadAwayBetsPct = data.spreadAwayBetsPct;
  if (data.spreadAwayMoneyPct !== undefined) updateData.spreadAwayMoneyPct = data.spreadAwayMoneyPct;
  if (data.totalOverBetsPct !== undefined) updateData.totalOverBetsPct = data.totalOverBetsPct;
  if (data.totalOverMoneyPct !== undefined) updateData.totalOverMoneyPct = data.totalOverMoneyPct;
  if (data.mlAwayBetsPct !== undefined) updateData.mlAwayBetsPct = data.mlAwayBetsPct;
  if (data.mlAwayMoneyPct !== undefined) updateData.mlAwayMoneyPct = data.mlAwayMoneyPct;
  if (data.awayML !== undefined) updateData.awayML = data.awayML;
  if (data.homeML !== undefined) updateData.homeML = data.homeML;
  await db.update(games).set(updateData).where(eq(games.id, id));
}

export async function setGamePublished(id: number, published: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // When publishing, verify the game has live VSiN odds
  if (published) {
    const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
    if (!game) throw new Error("Game not found");
    const hasOdds = game.awayBookSpread !== null || game.bookTotal !== null;
    if (!hasOdds) {
      throw new Error("Cannot publish: game has no live VSiN odds yet");
    }
  }

  await db.update(games).set({ publishedToFeed: published }).where(eq(games.id, id));
}

/** List all staging games for a date range (inclusive). Owner-only. */
export async function listStagingGamesRange(fromDate: string, toDate: string, sport?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions: ReturnType<typeof eq>[] = [
    eq(games.fileId, 0),
    gte(games.gameDate, fromDate),
    lte(games.gameDate, toDate),
  ];
  if (sport) conditions.push(eq(games.sport, sport));
  return db
    .select()
    .from(games)
    .where(and(...conditions))
    .orderBy(games.gameDate, sql`CASE WHEN ${games.startTimeEst} = '00:00' THEN '24:00' ELSE ${games.startTimeEst} END`, games.sortOrder);
}

/** Look up a game by its NCAA contest ID (for dedup during NCAA-only insert) */
export async function getGameByNcaaContestId(contestId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(games)
    .where(eq(games.ncaaContestId, contestId))
    .limit(1);
  return rows[0] ?? null;
}

/** Update start time, ncaaContestId, and gameStatus for a game (used when NCAA data arrives after VSiN insert) */
export async function updateNcaaStartTime(
  id: number,
  data: { startTimeEst: string; ncaaContestId: string; gameStatus?: 'upcoming' | 'live' | 'final' }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(games).set(data).where(eq(games.id, id));
}

/** Bulk publish all staging games for a date — only publishes games with live VSiN odds */
export async function publishAllStagingGames(gameDate: string, sport?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(games.gameDate, gameDate),
    eq(games.fileId, 0),
    // Only publish games that have live VSiN odds
    or(isNotNull(games.awayBookSpread), isNotNull(games.bookTotal))!,
  ];
  if (sport) conditions.push(eq(games.sport, sport));
  await db
    .update(games)
    .set({ publishedToFeed: true })
    .where(and(...conditions));
}


// ─── NBA Teams ────────────────────────────────────────────────────────────────

export async function upsertNbaTeams(teams: InsertNbaTeam[]): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  for (const team of teams) {
    await db
      .insert(nbaTeams)
      .values(team)
      .onDuplicateKeyUpdate({
        set: {
          nbaSlug: team.nbaSlug,
          vsinSlug: team.vsinSlug,
          name: team.name,
          nickname: team.nickname,
          city: team.city,
          conference: team.conference,
          division: team.division,
          logoUrl: team.logoUrl,
        },
      });
  }
  return teams.length;
}

export async function listNbaTeams() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(nbaTeams).orderBy(nbaTeams.name);
}

export async function getNbaTeamByDbSlug(dbSlug: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(nbaTeams)
    .where(eq(nbaTeams.dbSlug, dbSlug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getNbaTeamByNbaSlug(nbaSlug: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(nbaTeams)
    .where(eq(nbaTeams.nbaSlug, nbaSlug))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Team Colors ─────────────────────────────────────────────────────────────

export interface TeamColors {
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
}

/**
 * Fetch team colors from the DB for a given team slug and sport.
 * For NCAAM, looks up ncaam_teams by dbSlug.
 * For NBA, looks up nba_teams by dbSlug.
 * Returns null if team not found or no colors stored.
 */
export async function getTeamColors(dbSlug: string, sport: string): Promise<TeamColors | null> {
  const db = await getDb();
  if (!db) return null;

  if (sport === "NBA") {
    const rows = await db
      .select({
        primaryColor: nbaTeams.primaryColor,
        secondaryColor: nbaTeams.secondaryColor,
        tertiaryColor: nbaTeams.tertiaryColor,
      })
      .from(nbaTeams)
      .where(eq(nbaTeams.dbSlug, dbSlug))
      .limit(1);
    return rows[0] ?? null;
  } else {
    // NCAAM (default)
    const rows = await db
      .select({
        primaryColor: ncaamTeams.primaryColor,
        secondaryColor: ncaamTeams.secondaryColor,
        tertiaryColor: ncaamTeams.tertiaryColor,
      })
      .from(ncaamTeams)
      .where(eq(ncaamTeams.dbSlug, dbSlug))
      .limit(1);
    return rows[0] ?? null;
  }
}

/**
 * Fetch colors for both teams in a game in a single call.
 * Returns { away: TeamColors | null, home: TeamColors | null }
 */
export async function getGameTeamColors(
  awayDbSlug: string,
  homeDbSlug: string,
  sport: string
): Promise<{ away: TeamColors | null; home: TeamColors | null }> {
  const [away, home] = await Promise.all([
    getTeamColors(awayDbSlug, sport),
    getTeamColors(homeDbSlug, sport),
  ]);
  return { away, home };
}

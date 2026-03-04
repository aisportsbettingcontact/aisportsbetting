import { and, desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { games, modelFiles, users, espnTeams, type InsertGame, type InsertModelFile, type InsertUser, type InsertEspnTeam } from "../drizzle/schema";
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
  await db.insert(games).values(rows);
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

  // Default to today in EST — never show stale previous-day games
  const targetDate = opts?.gameDate ?? todayEst();

  const conditions = [eq(games.gameDate, targetDate)];
  if (opts?.sport) conditions.push(eq(games.sport, opts.sport));

  return db
    .select()
    .from(games)
    .where(and(...conditions))
    .orderBy(games.gameDate, games.startTimeEst);
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

// ─── ESPN Teams helpers ───────────────────────────────────────────────────────

export async function listEspnTeams(sport = "NCAAM") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(espnTeams)
    .where(eq(espnTeams.sport, sport))
    .orderBy(espnTeams.displayName);
}

export async function getEspnTeamBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(espnTeams)
    .where(eq(espnTeams.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert games sourced from Google Sheets (fileId = 0).
 * Strategy: delete all existing rows with fileId = 0 for the affected dates,
 * then insert the fresh rows. This ensures stale data is replaced.
 */
export async function upsertSheetGames(rows: InsertGame[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (rows.length === 0) return;

  // Collect unique dates in this batch
  const dates = Array.from(new Set(rows.map((r) => r.gameDate)));

  // Delete existing sheet-sourced rows for those dates
  for (const date of dates) {
    await db
      .delete(games)
      .where(
        and(
          eq(games.fileId, 0),
          eq(games.gameDate, date)
        )
      );
  }

  // Insert fresh rows
  await db.insert(games).values(rows);
}

// ─── App Users (custom accounts) ─────────────────────────────────────────────

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

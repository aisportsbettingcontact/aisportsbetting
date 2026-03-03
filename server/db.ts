import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { games, modelFiles, users, type InsertGame, type InsertModelFile, type InsertUser } from "../drizzle/schema";
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

export async function listGames(opts?: { sport?: string; gameDate?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let query = db.select().from(games).$dynamic();
  if (opts?.sport) query = query.where(eq(games.sport, opts.sport));
  return query.orderBy(games.gameDate, games.startTimeEst);
}

export async function deleteGamesByFileId(fileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(games).where(eq(games.fileId, fileId));
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

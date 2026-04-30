/**
 * Direct DB check for modelF5PushPct and modelF5PushRaw for April 14 games
 */
import { getDb } from "../server/db.js";
import { games } from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";

const db = await getDb();
if (!db) throw new Error("DB unavailable");

const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  modelF5PushPct: games.modelF5PushPct,
  modelF5PushRaw: games.modelF5PushRaw,
  modelF5AwayML: games.modelF5AwayML,
  modelF5HomeML: games.modelF5HomeML,
  modelRunAt: games.modelRunAt,
}).from(games)
  .where(and(
    eq(games.gameDate, "2026-04-14"),
    eq(games.sport, "MLB"),
  ));

console.log(`\n[STATE] April 14 MLB games — F5 push values:`);
console.log(`${"Game".padEnd(18)} ${"modelF5PushPct".padEnd(18)} ${"modelF5PushRaw".padEnd(18)} ${"F5 ML Away".padEnd(14)} ${"modelRunAt"}`);
console.log("-".repeat(90));

let nullCount = 0;
for (const row of rows) {
  const game = `${row.awayTeam}@${row.homeTeam}`;
  const pushPct = row.modelF5PushPct ?? "NULL";
  const pushRaw = row.modelF5PushRaw ?? "NULL";
  const f5ml = row.modelF5AwayML ?? "NULL";
  if (pushPct === "NULL") nullCount++;
  console.log(`${game.padEnd(18)} ${String(pushPct).padEnd(18)} ${String(pushRaw).padEnd(18)} ${String(f5ml).padEnd(14)} ${row.modelRunAt}`);
}

console.log(`\n[VERIFY] ${nullCount === 0 ? "PASS" : "FAIL"} — ${rows.length - nullCount}/${rows.length} games have modelF5PushPct populated`);
if (nullCount > 0) {
  console.log(`[FAIL]   ${nullCount} game(s) still have NULL modelF5PushPct`);
}

process.exit(nullCount > 0 ? 1 : 0);

/**
 * Retry the 2 failed DB writes for game IDs 2250232 and 2250233
 * These failed due to a connection issue during the v2.1 re-run.
 */
import { runMlbModelForDate } from "../server/mlbModelRunner.js";
import { getDb } from "../server/db.js";
import { games } from "../drizzle/schema.js";
import { inArray } from "drizzle-orm";

const FAILED_IDS = [2250232, 2250233];
const DATE = "2026-04-14";

console.log(`[INPUT]  Checking failed game IDs: ${FAILED_IDS.join(", ")}`);

const db = await getDb();
if (!db) throw new Error("DB unavailable");

// Check current state
const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  gameDate: games.gameDate,
  modelF5PushPct: games.modelF5PushPct,
  modelRunAt: games.modelRunAt,
}).from(games).where(inArray(games.id, FAILED_IDS));

console.log(`[STATE]  Current DB state for failed games:`);
for (const row of rows) {
  console.log(`  [${row.id}] ${row.awayTeam}@${row.homeTeam} | modelF5PushPct=${row.modelF5PushPct} | modelRunAt=${row.modelRunAt}`);
}

// If neither has been written, re-run the full date (it will skip already-modeled games)
const unwritten = rows.filter(r => r.modelF5PushPct === null);
if (unwritten.length === 0) {
  console.log(`[VERIFY] PASS — Both games already have modelF5PushPct populated. No retry needed.`);
  process.exit(0);
}

console.log(`[STEP]   ${unwritten.length} game(s) missing modelF5PushPct — forcing re-run for ${DATE}...`);

// Force clear modelRunAt for the failed games so the runner picks them up
for (const row of unwritten) {
  await db.update(games).set({ modelRunAt: null }).where(inArray(games.id, [row.id]));
  console.log(`[STEP]   Cleared modelRunAt for [${row.id}] ${row.awayTeam}@${row.homeTeam}`);
}

const result = await runMlbModelForDate(DATE);
console.log(`[OUTPUT] written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
console.log(`[VERIFY] validation.passed=${result.validation.passed}`);

// Final check
const finalRows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  modelF5PushPct: games.modelF5PushPct,
  modelF5PushRaw: games.modelF5PushRaw,
  modelRunAt: games.modelRunAt,
}).from(games).where(inArray(games.id, FAILED_IDS));

console.log(`[STATE]  Final DB state:`);
for (const row of finalRows) {
  const ok = row.modelF5PushPct !== null;
  console.log(`  [${ok ? "PASS" : "FAIL"}] [${row.id}] ${row.awayTeam}@${row.homeTeam} | modelF5PushPct=${row.modelF5PushPct} modelF5PushRaw=${row.modelF5PushRaw}`);
}

process.exit(result.errors > 0 ? 1 : 0);

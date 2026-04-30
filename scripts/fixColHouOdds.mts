/**
 * fixColHouOdds.mts
 * Manually writes COL@HOU (id=2250256) odds from the AN data fetched earlier:
 * DK: RL=+1.5/-1.5, Total=8.5, ML=+153/-186
 * Open: ML=+154/-184 (spread null from Open)
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const GAME_ID = 2250256;
const TAG = "[FixColHouOdds]";

console.log(`${TAG} [INPUT] Patching COL@HOU (id=${GAME_ID}) with AN odds`);
console.log(`${TAG} [STATE] DK: RL=+1.5/-1.5 | Total=8.5 | ML=+153/-186`);
console.log(`${TAG} [STATE] Open: ML=+154/-184 (spread/total not available from Open)`);

const db = await getDb();

// Verify the game exists and has no odds
const [before] = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  bookTotal: games.bookTotal,
  awayML: games.awayML,
  awayRunLine: games.awayRunLine,
}).from(games).where(eq(games.id, GAME_ID));

if (!before) {
  console.error(`${TAG} [VERIFY] FAIL — Game id=${GAME_ID} not found in DB`);
  process.exit(1);
}

console.log(`${TAG} [STATE] Before: bookTotal=${before.bookTotal} awayML=${before.awayML} awayRunLine=${before.awayRunLine}`);

if (before.bookTotal && before.awayML && before.awayRunLine) {
  console.log(`${TAG} [VERIFY] SKIP — Game already has odds, no patch needed`);
  process.exit(0);
}

// Write the DK odds
await db.update(games).set({
  // Full game run line (DK NJ)
  awayRunLine:     "+1.5",
  homeRunLine:     "-1.5",
  awayRunLineOdds: "+153",
  homeRunLineOdds: "-186",
  awayBookSpread:  1.5,
  homeBookSpread:  -1.5,
  // Full game total (DK NJ)
  bookTotal:       "8.5",
  overOdds:        "-118",
  underOdds:       "-102",
  // Full game moneyline (DK NJ)
  awayML:          "+153",
  homeML:          "-186",
  // Spread odds (DK NJ — standard RL odds)
  awaySpreadOdds:  "+153",
  homeSpreadOdds:  "-186",
  // Opening line (Action Network Open book)
  awayOpenML:      "+154",
  homeOpenML:      "-184",
}).where(eq(games.id, GAME_ID));

// Verify the write
const [after] = await db.select({
  id: games.id,
  bookTotal: games.bookTotal,
  awayML: games.awayML,
  awayRunLine: games.awayRunLine,
  awayBookSpread: games.awayBookSpread,
}).from(games).where(eq(games.id, GAME_ID));

const pass = after.bookTotal === "8.5" && after.awayML === "+153" && after.awayRunLine === "+1.5";
console.log(`${TAG} [OUTPUT] After: bookTotal=${after.bookTotal} awayML=${after.awayML} awayRunLine=${after.awayRunLine} awayBookSpread=${after.awayBookSpread}`);
console.log(`${TAG} [VERIFY] ${pass ? "PASS" : "FAIL"} — COL@HOU odds ${pass ? "written correctly" : "MISMATCH"}`);

process.exit(pass ? 0 : 1);

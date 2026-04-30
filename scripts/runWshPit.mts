/**
 * runWshPit.mts
 * ─────────────────────────────────────────────────────────────────────────────
 * Patches WSH@PIT (id=2250249) homeStartingPitcher = "C. Mlodzinski"
 * then re-runs the MLB model for 2026-04-15 (which will now include this game).
 *
 * LOGGING FORMAT:
 *   [INPUT]  source + parsed values
 *   [STEP]   operation description
 *   [STATE]  intermediate computations
 *   [OUTPUT] result
 *   [VERIFY] pass/fail + reason
 */

import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { runMlbModelForDate, validateMlbModelResults } from "../server/mlbModelRunner";

const GAME_ID = 2250249;
const DATE = "2026-04-15";
const TAG = "[WshPitRunner]";

console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 1] PATCH homeStartingPitcher for WSH@PIT (id=${GAME_ID})`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const db = await getDb();

// Verify current state
const [before] = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayStartingPitcher: games.awayStartingPitcher,
  homeStartingPitcher: games.homeStartingPitcher,
  modelRunAt: games.modelRunAt,
}).from(games).where(eq(games.id, GAME_ID));

console.log(`${TAG} [INPUT] Before patch:`);
console.log(`  awayStartingPitcher = ${before.awayStartingPitcher}`);
console.log(`  homeStartingPitcher = ${before.homeStartingPitcher}`);
console.log(`  modelRunAt          = ${before.modelRunAt}`);

if (before.modelRunAt) {
  console.log(`${TAG} [VERIFY] SKIP — Game already modeled at ${before.modelRunAt}`);
  process.exit(0);
}

if (before.homeStartingPitcher) {
  console.log(`${TAG} [STATE] homeStartingPitcher already set: ${before.homeStartingPitcher}`);
} else {
  // Patch from mlbLineups data (confirmed: C. Mlodzinski, R)
  await db.update(games).set({
    homeStartingPitcher: "C. Mlodzinski",
  }).where(eq(games.id, GAME_ID));
  console.log(`${TAG} [OUTPUT] Patched homeStartingPitcher = "C. Mlodzinski"`);
}

// Verify patch
const [after] = await db.select({
  awayStartingPitcher: games.awayStartingPitcher,
  homeStartingPitcher: games.homeStartingPitcher,
}).from(games).where(eq(games.id, GAME_ID));

const patchOk = after.awayStartingPitcher && after.homeStartingPitcher;
console.log(`${TAG} [VERIFY] ${patchOk ? "PASS" : "FAIL"} — awayPitcher=${after.awayStartingPitcher} homePitcher=${after.homeStartingPitcher}`);

if (!patchOk) {
  console.error(`${TAG} [VERIFY] FAIL — Cannot proceed without both starters`);
  process.exit(1);
}

// ─── STEP 2: Re-run model for 2026-04-15 (will pick up WSH@PIT now) ──────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 2] RE-RUN MLB MODEL for ${DATE}`);
console.log(`${TAG} [STATE] Model will process WSH@PIT + any other unmodeled games`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const result = await runMlbModelForDate(DATE);

console.log(`\n${TAG} [OUTPUT] Model run complete:`);
console.log(`  written  = ${result.written}`);
console.log(`  skipped  = ${result.skipped}`);
console.log(`  errors   = ${result.errors}`);
console.log(`  val.pass = ${result.validation.passed}`);

if (result.validation.issues.length > 0) {
  console.error(`${TAG} [STATE] Validation issues:`);
  for (const issue of result.validation.issues) {
    console.error(`  ✗ ${issue}`);
  }
}
if (result.validation.warnings.length > 0) {
  console.warn(`${TAG} [STATE] Validation warnings:`);
  for (const w of result.validation.warnings) {
    console.warn(`  ⚠ ${w}`);
  }
}

// ─── STEP 3: Post-model validation ───────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 3] POST-MODEL VALIDATION for ${DATE}`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const valResult = await validateMlbModelResults(DATE);
console.log(`${TAG} [OUTPUT] Validation: passed=${valResult.passed} issues=${valResult.issues.length} warnings=${valResult.warnings.length}`);
if (!valResult.passed) {
  for (const issue of valResult.issues) {
    console.error(`  ✗ ${issue}`);
  }
}
for (const w of valResult.warnings) {
  console.warn(`  ⚠ ${w}`);
}

// ─── STEP 4: Final DB check ───────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 4] FINAL DB CHECK for WSH@PIT`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const [final] = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  modelRunAt: games.modelRunAt,
  publishedToFeed: games.publishedToFeed,
  modelTotal: games.modelTotal,
  modelOverRate: games.modelOverRate,
  modelHomeWinPct: games.modelHomeWinPct,
  modelPNrfi: games.modelPNrfi,
  modelF5PushPct: games.modelF5PushPct,
  modelF5OverRate: games.modelF5OverRate,
}).from(games).where(eq(games.id, GAME_ID));

const modeled = !!final.modelRunAt;
const published = !!final.publishedToFeed;
const nrfi = final.modelPNrfi != null ? `${(Number(final.modelPNrfi)*100).toFixed(1)}%` : "null";
const f5Push = final.modelF5PushPct != null ? `${(Number(final.modelF5PushPct)*100).toFixed(2)}%` : "null";

console.log(`${TAG} [OUTPUT] WSH@PIT final state:`);
console.log(`  modeled      = ${modeled} (modelRunAt=${final.modelRunAt})`);
console.log(`  published    = ${published}`);
console.log(`  modelTotal   = ${final.modelTotal}`);
console.log(`  modelOverRate= ${final.modelOverRate}%`);
console.log(`  homeWinPct   = ${final.modelHomeWinPct}%`);
console.log(`  NRFI         = ${nrfi}`);
console.log(`  F5Push       = ${f5Push}`);
console.log(`  F5OverRate   = ${final.modelF5OverRate}%`);

const pass = modeled && published;
console.log(`\n${TAG} [VERIFY] ${pass ? "✅ PASS" : "✗ FAIL"} — WSH@PIT ${pass ? "modeled + published" : "INCOMPLETE"}`);
console.log(`${TAG} ══════════════════════════════════════════════`);

process.exit(pass ? 0 : 1);

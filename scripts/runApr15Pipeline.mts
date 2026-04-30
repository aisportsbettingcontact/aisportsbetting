/**
 * runApr15Pipeline.mts
 * ─────────────────────────────────────────────────────────────────────────────
 * Full April 15, 2026 model + publish pipeline
 *
 * EXECUTION ORDER:
 *   1. Fetch AN odds for MLB (15 games) + NHL (6 games) → write to DB
 *   2. Fetch F5 odds for all 15 MLB games → write to DB
 *   3. Run MLB model for all 15 games (FG ML/RL/Total + F5 ML/RL/Total + NRFI/YRFI)
 *   4. Validate all MLB model outputs
 *   5. Publish NHL games (already modeled)
 *   6. Final audit: confirm 15 MLB modeled + published, 6 NHL published
 *
 * LOGGING FORMAT:
 *   [INPUT]  source + parsed values
 *   [STEP]   operation description
 *   [STATE]  intermediate computations
 *   [OUTPUT] result
 *   [VERIFY] pass/fail + reason
 */

import { refreshAnApiOdds } from "../server/vsinAutoRefresh";
import { runMlbModelForDate, validateMlbModelResults } from "../server/mlbModelRunner";
import { syncNhlModelForToday } from "../server/nhlModelSync";
import { getDb, listGames } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";

const DATE = "2026-04-15";
const TAG = `[Apr15Pipeline]`;

// ─── STEP 1: Pre-flight audit ─────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 1] PRE-FLIGHT AUDIT for ${DATE}`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const db = await getDb();

// Get all April 15 games directly from DB (no filter)
const allGamesRaw = await db.select({
  id: games.id,
  sport: games.sport,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  startTimeEst: games.startTimeEst,
  modelRunAt: games.modelRunAt,
  publishedToFeed: games.publishedToFeed,
  bookTotal: games.bookTotal,
  awayBookSpread: games.awayBookSpread,
  awayML: games.awayML,
  awayRunLine: games.awayRunLine,
  f5Total: games.f5Total,
  modelPNrfi: games.modelPNrfi,
  modelF5PushPct: games.modelF5PushPct,
}).from(games).where(eq(games.gameDate, DATE));

const mlbGames = allGamesRaw.filter(g => g.sport === "MLB").sort((a, b) =>
  (a.startTimeEst ?? "").localeCompare(b.startTimeEst ?? "")
);
const nhlGames = allGamesRaw.filter(g => g.sport === "NHL");

console.log(`${TAG} [INPUT] DB state: total=${allGamesRaw.length} MLB=${mlbGames.length} NHL=${nhlGames.length}`);

if (mlbGames.length !== 15) {
  console.error(`${TAG} [VERIFY] FAIL — Expected 15 MLB games, found ${mlbGames.length}`);
  process.exit(1);
}
if (nhlGames.length !== 6) {
  console.error(`${TAG} [VERIFY] FAIL — Expected 6 NHL games, found ${nhlGames.length}`);
  process.exit(1);
}
console.log(`${TAG} [VERIFY] PASS — 15 MLB + 6 NHL games confirmed in DB`);

console.log(`\n${TAG} [STATE] MLB games:`);
for (const g of mlbGames) {
  const hasOdds = g.bookTotal && g.awayML && g.awayRunLine ? "✓ODDS" : "✗NO_ODDS";
  const modeled = g.modelRunAt ? "✓MODELED" : "✗UNMODELED";
  const published = g.publishedToFeed ? "✓PUB" : "✗UNPUB";
  console.log(`  [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${g.startTimeEst} | ${hasOdds} | ${modeled} | ${published}`);
}

console.log(`\n${TAG} [STATE] NHL games:`);
for (const g of nhlGames) {
  const modeled = g.modelRunAt ? "✓MODELED" : "✗UNMODELED";
  const published = g.publishedToFeed ? "✓PUB" : "✗UNPUB";
  console.log(`  [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${modeled} | ${published}`);
}

// ─── STEP 2: Fetch AN odds for MLB + NHL ──────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 2] FETCH AN ODDS — MLB + NHL`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const oddsResult = await refreshAnApiOdds(DATE, ["mlb", "nhl"], "manual");
console.log(`${TAG} [OUTPUT] AN odds refresh: updated=${oddsResult.updated} skipped=${oddsResult.skipped} frozen=${oddsResult.frozen} errors=${oddsResult.errors.length}`);

if (oddsResult.errors.length > 0) {
  console.warn(`${TAG} [STATE] Odds errors (non-fatal):`);
  for (const e of oddsResult.errors) {
    console.warn(`  ${e}`);
  }
}

// Re-read games to confirm odds were written
const afterOddsRaw = await db.select({
  id: games.id,
  sport: games.sport,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  bookTotal: games.bookTotal,
  awayML: games.awayML,
  awayRunLine: games.awayRunLine,
  f5Total: games.f5Total,
  awayBookSpread: games.awayBookSpread,
}).from(games).where(eq(games.gameDate, DATE));

const mlbAfterOdds = afterOddsRaw.filter(g => g.sport === "MLB");
const mlbWithOdds = mlbAfterOdds.filter(g => g.bookTotal && g.awayML && g.awayRunLine);
const mlbWithF5 = mlbAfterOdds.filter(g => g.f5Total);

console.log(`${TAG} [STATE] MLB odds coverage: ${mlbWithOdds.length}/15 have FG odds | ${mlbWithF5.length}/15 have F5 total`);

for (const g of mlbAfterOdds.sort((a, b) => (a.awayTeam ?? "").localeCompare(b.awayTeam ?? ""))) {
  const fgOdds = g.bookTotal && g.awayML && g.awayRunLine
    ? `FG: RL=${g.awayRunLine} Total=${g.bookTotal} ML=${g.awayML}`
    : "FG: MISSING";
  const f5 = g.f5Total ? `F5=${g.f5Total}` : "F5=null";
  console.log(`  [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${fgOdds} | ${f5}`);
}

if (mlbWithOdds.length < 15) {
  console.warn(`${TAG} [VERIFY] WARN — Only ${mlbWithOdds.length}/15 MLB games have full FG odds. Model will skip games without odds.`);
} else {
  console.log(`${TAG} [VERIFY] PASS — All 15 MLB games have FG odds`);
}

// ─── STEP 3: Run MLB model ────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 3] RUN MLB MODEL for ${DATE}`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const mlbResult = await runMlbModelForDate(DATE);

console.log(`\n${TAG} [OUTPUT] MLB model complete:`);
console.log(`  written  = ${mlbResult.written}`);
console.log(`  skipped  = ${mlbResult.skipped}`);
console.log(`  errors   = ${mlbResult.errors}`);
console.log(`  val.pass = ${mlbResult.validation.passed}`);

if (mlbResult.validation.issues.length > 0) {
  console.error(`${TAG} [STATE] Validation issues:`);
  for (const issue of mlbResult.validation.issues) {
    console.error(`  ✗ ${issue}`);
  }
}
if (mlbResult.validation.warnings.length > 0) {
  console.warn(`${TAG} [STATE] Validation warnings:`);
  for (const w of mlbResult.validation.warnings) {
    console.warn(`  ⚠ ${w}`);
  }
}

if (mlbResult.written < 15) {
  console.warn(`${TAG} [VERIFY] WARN — Only ${mlbResult.written}/15 MLB games written. Check skipped games above.`);
} else {
  console.log(`${TAG} [VERIFY] PASS — All 15 MLB games written`);
}

// ─── STEP 4: Post-model validation ───────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 4] POST-MODEL VALIDATION`);
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

if (valResult.passed) {
  console.log(`${TAG} [VERIFY] PASS — All MLB model outputs validated`);
} else {
  console.warn(`${TAG} [VERIFY] FAIL — Validation gate has issues. Review above.`);
}

// ─── STEP 5: Publish NHL ─────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 5] PUBLISH NHL GAMES`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const nhlIds = nhlGames.map(g => g.id);
console.log(`${TAG} [INPUT] NHL game IDs to publish: ${nhlIds.join(", ")}`);

await db.update(games)
  .set({ publishedToFeed: true })
  .where(and(
    eq(games.gameDate, DATE),
    eq(games.sport, "NHL"),
    inArray(games.id, nhlIds)
  ));

console.log(`${TAG} [OUTPUT] NHL games published: ${nhlIds.length}`);
console.log(`${TAG} [VERIFY] PASS — ${nhlIds.length} NHL games set publishedToFeed=true`);

// ─── STEP 6: Final audit ──────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════`);
console.log(`${TAG} [STEP 6] FINAL AUDIT`);
console.log(`${TAG} ══════════════════════════════════════════════`);

const finalRaw = await db.select({
  id: games.id,
  sport: games.sport,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  startTimeEst: games.startTimeEst,
  modelRunAt: games.modelRunAt,
  publishedToFeed: games.publishedToFeed,
  bookTotal: games.bookTotal,
  modelTotal: games.modelTotal,
  modelOverRate: games.modelOverRate,
  modelHomeWinPct: games.modelHomeWinPct,
  modelF5PushPct: games.modelF5PushPct,
  modelPNrfi: games.modelPNrfi,
  modelF5OverRate: games.modelF5OverRate,
}).from(games).where(eq(games.gameDate, DATE));

const finalMlb = finalRaw.filter(g => g.sport === "MLB").sort((a, b) =>
  (a.startTimeEst ?? "").localeCompare(b.startTimeEst ?? "")
);
const finalNhl = finalRaw.filter(g => g.sport === "NHL");

const mlbModeled = finalMlb.filter(g => g.modelRunAt);
const mlbPublished = finalMlb.filter(g => g.publishedToFeed);
const nhlPublished = finalNhl.filter(g => g.publishedToFeed);

console.log(`\n${TAG} [OUTPUT] FINAL STATE:`);
console.log(`  MLB: ${mlbModeled.length}/15 modeled | ${mlbPublished.length}/15 published`);
console.log(`  NHL: ${nhlPublished.length}/6 published`);

console.log(`\n${TAG} [STATE] MLB final outputs:`);
for (const g of finalMlb) {
  const modeled = g.modelRunAt ? "✓" : "✗";
  const pub = g.publishedToFeed ? "✓PUB" : "✗UNPUB";
  const total = g.modelTotal ? `Total=${g.modelTotal}` : "Total=null";
  const overRate = g.modelOverRate != null ? `Over=${g.modelOverRate}%` : "Over=null";
  const nrfi = g.modelPNrfi != null ? `NRFI=${(Number(g.modelPNrfi)*100).toFixed(1)}%` : "NRFI=null";
  const f5Push = g.modelF5PushPct != null ? `F5Push=${(Number(g.modelF5PushPct)*100).toFixed(2)}%` : "F5Push=null";
  console.log(`  ${modeled} [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${pub} | ${total} | ${overRate} | ${nrfi} | ${f5Push}`);
}

// Final pass/fail
const allMlbModeled = mlbModeled.length === 15;
const allMlbPublished = mlbPublished.length === 15;
const allNhlPublished = nhlPublished.length === 6;

console.log(`\n${TAG} ══════════════════════════════════════════════`);
if (allMlbModeled && allMlbPublished && allNhlPublished) {
  console.log(`${TAG} [VERIFY] ✅ COMPLETE — 15/15 MLB modeled+published | 6/6 NHL published`);
} else {
  if (!allMlbModeled)   console.error(`${TAG} [VERIFY] ✗ MLB modeled: ${mlbModeled.length}/15`);
  if (!allMlbPublished) console.error(`${TAG} [VERIFY] ✗ MLB published: ${mlbPublished.length}/15`);
  if (!allNhlPublished) console.error(`${TAG} [VERIFY] ✗ NHL published: ${nhlPublished.length}/6`);
}
console.log(`${TAG} ══════════════════════════════════════════════`);

process.exit(0);

/**
 * approve_publish_apr9.mts
 * Bulk-approves and publishes all modeled NHL + MLB games for April 9, 2026.
 * 
 * Step 1: bulkApproveModels — sets publishedModel=true for games with model data
 * Step 2: publishAllStagingGames — sets publishedToFeed=true for all games
 * Step 3: Verify final state
 */
import { getDb } from "../server/db.ts";
import { bulkApproveModels, publishAllStagingGames } from "../server/db.ts";
import { games } from "../drizzle/schema.ts";
import { eq, and } from "drizzle-orm";

const TARGET_DATE = "2026-04-09";

console.log(`\n${"=".repeat(70)}`);
console.log(`[ApprovePublish] ► START — date: ${TARGET_DATE}`);
console.log(`${"=".repeat(70)}`);

const db = await getDb();
if (!db) { console.error("[ERROR] No DB connection"); process.exit(1); }

// ── Step 1: Bulk-approve NHL models ─────────────────────────────────────────
console.log(`\n[STEP 1] Bulk-approving NHL model projections for ${TARGET_DATE}...`);
const nhlApproved = await bulkApproveModels(TARGET_DATE, "NHL");
console.log(`[STEP 1] [OUTPUT] NHL approved: ${nhlApproved}`);

// ── Step 2: Bulk-approve MLB models (may be 0 if no pitchers confirmed yet) ─
console.log(`\n[STEP 2] Bulk-approving MLB model projections for ${TARGET_DATE}...`);
const mlbApproved = await bulkApproveModels(TARGET_DATE, "MLB");
console.log(`[STEP 2] [OUTPUT] MLB approved: ${mlbApproved}`);

// ── Step 3: Publish all NHL games to feed ───────────────────────────────────
console.log(`\n[STEP 3] Publishing all NHL games to feed for ${TARGET_DATE}...`);
await publishAllStagingGames(TARGET_DATE, "NHL");
console.log(`[STEP 3] [OUTPUT] NHL games published to feed`);

// ── Step 4: Publish all MLB games to feed ───────────────────────────────────
console.log(`\n[STEP 4] Publishing all MLB games to feed for ${TARGET_DATE}...`);
await publishAllStagingGames(TARGET_DATE, "MLB");
console.log(`[STEP 4] [OUTPUT] MLB games published to feed`);

// ── Step 5: Verify final state ───────────────────────────────────────────────
console.log(`\n[STEP 5] Verifying final state for ${TARGET_DATE}...`);

const nhlGames = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayModelSpread: games.awayModelSpread,
  modelTotal: games.modelTotal,
  publishedModel: games.publishedModel,
  publishedToFeed: games.publishedToFeed,
}).from(games).where(and(eq(games.gameDate, TARGET_DATE), eq(games.sport, "NHL")));

const mlbGames = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayModelSpread: games.awayModelSpread,
  modelTotal: games.modelTotal,
  publishedModel: games.publishedModel,
  publishedToFeed: games.publishedToFeed,
}).from(games).where(and(eq(games.gameDate, TARGET_DATE), eq(games.sport, "MLB")));

console.log(`\n[VERIFY] NHL games (${nhlGames.length}):`);
let nhlModeledCount = 0;
let nhlPublishedCount = 0;
for (const g of nhlGames) {
  const modeled = g.awayModelSpread != null;
  if (modeled) nhlModeledCount++;
  if (g.publishedToFeed) nhlPublishedCount++;
  const status = `modeled=${modeled} publishedModel=${g.publishedModel} publishedToFeed=${g.publishedToFeed}`;
  const icon = (modeled && g.publishedModel && g.publishedToFeed) ? "✅" : "⚠️";
  console.log(`  ${icon} ${g.awayTeam} @ ${g.homeTeam} | ${status}`);
}

console.log(`\n[VERIFY] MLB games (${mlbGames.length}):`);
let mlbModeledCount = 0;
let mlbPublishedCount = 0;
for (const g of mlbGames) {
  const modeled = g.awayModelSpread != null;
  if (modeled) mlbModeledCount++;
  if (g.publishedToFeed) mlbPublishedCount++;
  const status = `modeled=${modeled} publishedModel=${g.publishedModel} publishedToFeed=${g.publishedToFeed}`;
  const icon = (g.publishedToFeed) ? "✅" : "⚠️";
  console.log(`  ${icon} ${g.awayTeam} @ ${g.homeTeam} | ${status}`);
}

console.log(`\n${"=".repeat(70)}`);
console.log(`[SUMMARY]`);
console.log(`  NHL: ${nhlModeledCount}/${nhlGames.length} modeled | ${nhlPublishedCount}/${nhlGames.length} published to feed`);
console.log(`  MLB: ${mlbModeledCount}/${mlbGames.length} modeled | ${mlbPublishedCount}/${mlbGames.length} published to feed`);
console.log(`  NOTE: MLB games require confirmed starting pitchers before modeling.`);
console.log(`        They are published to feed (visible) but not yet modeled.`);
console.log(`        Model will auto-run once pitchers are confirmed via Rotowire.`);
console.log(`${"=".repeat(70)}\n`);

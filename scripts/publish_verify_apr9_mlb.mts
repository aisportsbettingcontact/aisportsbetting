/**
 * publish_verify_apr9_mlb.mts
 * Publishes all modeled April 9, 2026 MLB games to the feed and verifies final state.
 */
import "dotenv/config";
import { getDb, publishAllStagingGames } from "../server/db.js";
import { games } from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";

const TARGET_DATE = "2026-04-09";
const TAG = "[PublishApr9MLB]";

async function main() {
  console.log(`${TAG} ► START`);

  // Step 1: Publish
  console.log(`${TAG} [STEP] Calling publishAllStagingGames for ${TARGET_DATE} MLB...`);
  await publishAllStagingGames(TARGET_DATE, "MLB");
  console.log(`${TAG} [OUTPUT] publishAllStagingGames complete`);

  // Step 2: Verify
  console.log(`${TAG} [STEP] Verifying final state...`);
  const db = await getDb();
  if (!db) { console.error(`${TAG} [ERROR] DB not available`); process.exit(1); }

  const rows = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    publishedModel: games.publishedModel,
    publishedToFeed: games.publishedToFeed,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    modelTotal: games.modelTotal,
    modelOverRate: games.modelOverRate,
    modelUnderRate: games.modelUnderRate,
  }).from(games).where(and(eq(games.sport, "MLB"), eq(games.gameDate, TARGET_DATE)));

  console.log(`\n${TAG} ═══ FINAL STATE — April 9, 2026 MLB Games ═══`);
  let allOk = true;
  for (const g of rows) {
    const ok = !!(g.publishedModel && g.publishedToFeed && g.awayModelSpread !== null);
    if (!ok) allOk = false;
    console.log(
      `${TAG}   ${g.awayTeam}@${g.homeTeam} [id=${g.id}]\n` +
      `${TAG}     Pitchers: ${g.awayStartingPitcher ?? "NULL"} vs ${g.homeStartingPitcher ?? "NULL"}\n` +
      `${TAG}     Model: awaySpread=${g.awayModelSpread ?? "NULL"} homeSpread=${g.homeModelSpread ?? "NULL"} total=${g.modelTotal ?? "NULL"} overRate=${g.modelOverRate ?? "NULL"} underRate=${g.modelUnderRate ?? "NULL"}\n` +
      `${TAG}     publishedModel=${g.publishedModel} publishedToFeed=${g.publishedToFeed} ${ok ? "✅" : "❌"}`
    );
  }

  if (allOk) {
    console.log(`\n${TAG} [VERIFY] PASS — All ${rows.length} April 9 MLB games modeled and published ✅`);
  } else {
    console.error(`\n${TAG} [VERIFY] FAIL — Some games not fully modeled/published ❌`);
    process.exit(1);
  }
  console.log(`${TAG} ► DONE`);
}

main().catch(err => { console.error(`${TAG} [FATAL]`, err); process.exit(1); });

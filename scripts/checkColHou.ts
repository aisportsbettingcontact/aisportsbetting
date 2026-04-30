/**
 * checkColHou.ts
 * Check COL @ HOU game details and determine why it was skipped
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { runMlbModelForDate } from "../server/mlbModelRunner";

async function main() {
  const db = await getDb();
  const rows = await db.select().from(games).where(eq(games.id, 2250242));
  const g = rows[0];
  
  if (!g) {
    console.log("Game 2250242 not found");
    process.exit(1);
  }
  
  console.log("COL @ HOU details:");
  console.log("  awayBookSpread:", g.awayBookSpread);
  console.log("  homeBookSpread:", g.homeBookSpread);
  console.log("  awayRunLine:", g.awayRunLine);
  console.log("  homeRunLine:", g.homeRunLine);
  console.log("  awayRunLineOdds:", g.awayRunLineOdds);
  console.log("  homeRunLineOdds:", g.homeRunLineOdds);
  console.log("  bookTotal:", g.bookTotal);
  console.log("  awayML:", g.awayML);
  console.log("  homeML:", g.homeML);
  console.log("  publishedModel:", g.publishedModel);
  console.log("  awayPitcher:", g.awayPitcher);
  console.log("  homePitcher:", g.homePitcher);
  
  // The awayRunLine is the key field — check if it's populated
  console.log("\n  awayRunLine (raw):", JSON.stringify(g.awayRunLine));
  console.log("  homeRunLine (raw):", JSON.stringify(g.homeRunLine));
  
  // If awayRunLine is null/empty but awayBookSpread is set, we can re-run
  const awayRL = g.awayRunLine;
  const awayBookSpread = g.awayBookSpread;
  
  if (!awayRL && awayBookSpread) {
    console.log("\n[DIAGNOSIS] awayRunLine is null but awayBookSpread is set.");
    console.log("  The model runner gates on awayRunLine, not awayBookSpread.");
    console.log("  Need to check what field the gate uses in mlbModelRunner.ts");
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

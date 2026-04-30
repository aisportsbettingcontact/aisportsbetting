/**
 * check_apr12_db.ts — Check Apr 12 game state in DB
 * Run: npx tsx scripts/check_apr12_db.ts
 */
import { getDb } from "../server/db.js";
import { games } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("DB not available"); process.exit(1); }

  const rows = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    awayML: games.awayML,
    homeML: games.homeML,
    publishedModel: games.publishedModel,
    publishedToFeed: games.publishedToFeed,
    gameStatus: games.gameStatus,
  }).from(games).where(eq(games.gameDate, "2026-04-12"));

  console.log(`\nApr 12 games in DB: ${rows.length}\n`);
  console.log("ID       | MATCHUP           | AWAY SP              | HOME SP              | ML     | SPREAD | TOTAL | PUB");
  console.log("---------|-------------------|----------------------|----------------------|--------|--------|-------|----");
  for (const r of rows) {
    const matchup = `${r.awayTeam ?? "?"}@${r.homeTeam ?? "?"}`.padEnd(17);
    const awayP = (r.awayStartingPitcher ?? "TBD").padEnd(20);
    const homeP = (r.homeStartingPitcher ?? "TBD").padEnd(20);
    const ml = r.awayML != null ? `${r.awayML}/${r.homeML}` : "null";
    const pub = r.publishedModel ? "YES" : "NO";
    console.log(`${r.id} | ${matchup} | ${awayP} | ${homeP} | ${ml.padEnd(12)} | ${pub}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

import { getDb } from "../server/db.ts";
import { games } from "../drizzle/schema.ts";
import { eq, and } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("[ERROR] No DB connection"); process.exit(1); }

const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayBookSpread: games.awayBookSpread,
  homeBookSpread: games.homeBookSpread,
  bookTotal: games.bookTotal,
  awayML: games.awayML,
  homeML: games.homeML,
  awaySpreadOdds: games.awaySpreadOdds,
  homeSpreadOdds: games.homeSpreadOdds,
  overOdds: games.overOdds,
  underOdds: games.underOdds,
  awayStartingPitcher: games.awayStartingPitcher,
  homeStartingPitcher: games.homeStartingPitcher,
  awayPitcherConfirmed: games.awayPitcherConfirmed,
  homePitcherConfirmed: games.homePitcherConfirmed,
  awayModelSpread: games.awayModelSpread,
  modelTotal: games.modelTotal,
  publishedModel: games.publishedModel,
  publishedToFeed: games.publishedToFeed,
}).from(games).where(and(eq(games.gameDate, "2026-04-09"), eq(games.sport, "MLB")));

console.log(`[AUDIT] April 9 MLB games: ${rows.length}`);
for (const g of rows) {
  const hasLines = g.bookTotal && g.awayML && g.homeML;
  const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
  console.log(`\n[GAME] ${g.awayTeam} @ ${g.homeTeam} (id=${g.id})`);
  console.log(`  spread: ${g.awayBookSpread}/${g.homeBookSpread} | total: ${g.bookTotal}`);
  console.log(`  awayML: ${g.awayML ?? "NULL"} | homeML: ${g.homeML ?? "NULL"}`);
  console.log(`  spreadOdds: ${g.awaySpreadOdds ?? "NULL"}/${g.homeSpreadOdds ?? "NULL"}`);
  console.log(`  o/u odds: ${g.overOdds ?? "NULL"}/${g.underOdds ?? "NULL"}`);
  console.log(`  awayPitcher: ${g.awayStartingPitcher ?? "NULL"} (confirmed=${g.awayPitcherConfirmed})`);
  console.log(`  homePitcher: ${g.homeStartingPitcher ?? "NULL"} (confirmed=${g.homePitcherConfirmed})`);
  console.log(`  hasLines=${hasLines} hasPitchers=${hasPitchers} → modelable=${!!(hasLines && hasPitchers)}`);
  console.log(`  modeled=${g.awayModelSpread != null} publishedModel=${g.publishedModel} publishedToFeed=${g.publishedToFeed}`);
}

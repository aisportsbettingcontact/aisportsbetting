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
  awayModelSpread: games.awayModelSpread,
  homeModelSpread: games.homeModelSpread,
  modelTotal: games.modelTotal,
  publishedModel: games.publishedModel,
  publishedToFeed: games.publishedToFeed,
  startTimeEst: games.startTimeEst,
}).from(games).where(and(eq(games.gameDate, "2026-04-09"), eq(games.sport, "NHL")));

console.log(`[AUDIT] April 9 NHL games: ${rows.length}`);
for (const g of rows) {
  const hasLines = g.bookTotal && g.awayML && g.homeML;
  const hasModel = g.awayModelSpread != null && g.modelTotal != null;
  console.log(`\n[GAME] ${g.awayTeam} @ ${g.homeTeam} (id=${g.id}) time=${g.startTimeEst}`);
  console.log(`  puckLine: ${g.awayBookSpread}/${g.homeBookSpread} | total: ${g.bookTotal}`);
  console.log(`  awayML: ${g.awayML ?? "NULL"} | homeML: ${g.homeML ?? "NULL"}`);
  console.log(`  spreadOdds: ${g.awaySpreadOdds ?? "NULL"}/${g.homeSpreadOdds ?? "NULL"}`);
  console.log(`  o/u odds: ${g.overOdds ?? "NULL"}/${g.underOdds ?? "NULL"}`);
  console.log(`  hasLines=${hasLines} → modelable=${!!hasLines}`);
  if (hasModel) {
    console.log(`  MODEL: awaySpread=${g.awayModelSpread} homeSpread=${g.homeModelSpread} total=${g.modelTotal}`);
  } else {
    console.log(`  MODEL: NOT YET COMPUTED`);
  }
  console.log(`  publishedModel=${g.publishedModel} publishedToFeed=${g.publishedToFeed}`);
}

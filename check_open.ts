import { config } from "dotenv";
config();
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { oddsHistory, games } from "./drizzle/schema";
import { eq, asc, desc, and, isNotNull } from "drizzle-orm";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  // Find today's NYM@LAD game (2026-04-15)
  const nymlad = await db.select().from(games)
    .where(and(eq(games.awayTeam, "NYM"), eq(games.homeTeam, "LAD"), eq(games.gameDate, "2026-04-15")))
    .orderBy(desc(games.id))
    .limit(1);
  
  // Also check all NYM@LAD games to find the right one
  const allNymLad = await db.select({ id: games.id, gameDate: games.gameDate, oddsSource: games.oddsSource }).from(games)
    .where(and(eq(games.awayTeam, "NYM"), eq(games.homeTeam, "LAD")))
    .orderBy(desc(games.id))
    .limit(5);
  console.log('[ALL NYM@LAD games]:', allNymLad);

  if (!nymlad[0]) { console.log("No NYM@LAD game found"); process.exit(0); }
  const gameId = nymlad[0].id;
  console.log(`[GAME] NYM@LAD gameId=${gameId} date=${nymlad[0].gameDate} oddsSource=${nymlad[0].oddsSource}`);

  // Get oldest row (the OPEN line)
  const oldest = await db.select().from(oddsHistory)
    .where(eq(oddsHistory.gameId, gameId))
    .orderBy(asc(oddsHistory.scrapedAt))
    .limit(5);

  console.log(`[OLDEST 5 ROWS (open line candidates)]:`);
  for (const r of oldest) {
    const d = new Date(r.scrapedAt);
    console.log(`  id=${r.id} lineSource=${r.lineSource} scrapedAt=${d.toLocaleString('en-US',{timeZone:'America/New_York'})} EST spread=${r.awaySpread}(${r.awaySpreadOdds}) total=${r.total} ml=${r.awayML}/${r.homeML}`);
  }

  // Get newest row
  const newest = await db.select().from(oddsHistory)
    .where(eq(oddsHistory.gameId, gameId))
    .orderBy(desc(oddsHistory.scrapedAt))
    .limit(3);

  console.log(`[NEWEST 3 ROWS (current line)]:`);
  for (const r of newest) {
    const d = new Date(r.scrapedAt);
    console.log(`  id=${r.id} lineSource=${r.lineSource} scrapedAt=${d.toLocaleString('en-US',{timeZone:'America/New_York'})} EST spread=${r.awaySpread}(${r.awaySpreadOdds}) total=${r.total} ml=${r.awayML}/${r.homeML}`);
  }

  // Check for any 'open' lineSource rows for this game
  const openRows = await db.select().from(oddsHistory)
    .where(and(eq(oddsHistory.gameId, gameId), eq(oddsHistory.lineSource, 'open')))
    .orderBy(asc(oddsHistory.scrapedAt))
    .limit(5);
  console.log(`[OPEN lineSource rows for this game: ${openRows.length}]`);
  for (const r of openRows) {
    const d = new Date(r.scrapedAt);
    console.log(`  id=${r.id} scrapedAt=${d.toLocaleString('en-US',{timeZone:'America/New_York'})} EST spread=${r.awaySpread} total=${r.total} ml=${r.awayML}/${r.homeML}`);
  }

  // Find first OPEN row with actual values
  const allOpenRows = await db.select().from(oddsHistory)
    .where(and(eq(oddsHistory.gameId, gameId), eq(oddsHistory.lineSource, 'open')))
    .orderBy(asc(oddsHistory.scrapedAt));
  const firstOpenWithValues = allOpenRows.find(r => r.awaySpread != null || r.total != null || r.awayML != null);
  console.log(`[FIRST OPEN ROW WITH VALUES]:`, firstOpenWithValues ? {
    id: firstOpenWithValues.id,
    scrapedAt: new Date(firstOpenWithValues.scrapedAt).toLocaleString('en-US',{timeZone:'America/New_York'}),
    spread: firstOpenWithValues.awaySpread,
    total: firstOpenWithValues.total,
    ml: `${firstOpenWithValues.awayML}/${firstOpenWithValues.homeML}`
  } : 'NONE - all OPEN rows have null values');

  // Check total count
  const allRows = await db.select().from(oddsHistory)
    .where(eq(oddsHistory.gameId, gameId));
  console.log(`[TOTAL rows for this game: ${allRows.length}]`);
  const dkCount = allRows.filter(r => r.lineSource === 'dk').length;
  const openCount = allRows.filter(r => r.lineSource === 'open').length;
  const nullCount = allRows.filter(r => r.lineSource === null).length;
  console.log(`  dk=${dkCount} open=${openCount} null=${nullCount}`);

  await conn.end();
}

main().catch(console.error);

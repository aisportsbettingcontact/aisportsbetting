/**
 * check_mlb_date_range.ts
 * Checks the full date range of MLB games in the DB.
 * Run: npx tsx scripts/check_mlb_date_range.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, asc, desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("[ERROR] DB not available"); process.exit(1); }

  const earliest = await db.select({ gameDate: games.gameDate })
    .from(games).where(eq(games.sport, "MLB"))
    .orderBy(asc(games.gameDate)).limit(5);

  const latest = await db.select({ gameDate: games.gameDate })
    .from(games).where(eq(games.sport, "MLB"))
    .orderBy(desc(games.gameDate)).limit(5);

  const allRows = await db.select({ gameDate: games.gameDate })
    .from(games).where(eq(games.sport, "MLB"));

  // Count by date
  const byDate = new Map<string, number>();
  for (const r of allRows) {
    byDate.set(r.gameDate, (byDate.get(r.gameDate) ?? 0) + 1);
  }
  const sortedDates = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  console.log(`[OUTPUT] MLB games in DB: ${allRows.length} total rows`);
  console.log(`[OUTPUT] Earliest 5 dates: ${earliest.map(r => r.gameDate).join(', ')}`);
  console.log(`[OUTPUT] Latest 5 dates: ${latest.map(r => r.gameDate).join(', ')}`);
  console.log(`[OUTPUT] Date range: ${sortedDates[0]?.[0] ?? 'NONE'} → ${sortedDates[sortedDates.length - 1]?.[0] ?? 'NONE'}`);
  console.log(`[OUTPUT] Total unique dates: ${sortedDates.length}`);
  
  // Show April dates specifically
  const aprDates = sortedDates.filter(([d]) => d.startsWith('2026-04'));
  console.log(`\n[OUTPUT] April 2026 MLB dates in DB (${aprDates.length} dates):`);
  for (const [date, count] of aprDates) {
    console.log(`  ${date}: ${count} games`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

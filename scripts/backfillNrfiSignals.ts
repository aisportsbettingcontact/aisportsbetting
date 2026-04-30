/**
 * backfillNrfiSignals.ts
 * One-time backfill: compute nrfiCombinedSignal and nrfiFilterPass for all
 * 2026 MLB games that were modeled before the NRFI signal deployment.
 *
 * Run: npx tsx scripts/backfillNrfiSignals.ts
 */
import { getDb } from "../server/db";
import { games, mlbPitcherStats } from "../drizzle/schema";
import { eq, and, isNotNull } from "drizzle-orm";

const NRFI_THRESHOLD = 0.56;

async function lookupNrfiRate(
  db: Awaited<ReturnType<typeof getDb>>,
  pitcherName: string | null | undefined,
  teamAbbr: string | null | undefined
): Promise<number | null> {
  if (!pitcherName || !teamAbbr) return null;
  
  // Try exact match first
  const rows = await db
    .select({ nrfiRate: mlbPitcherStats.nrfiRate })
    .from(mlbPitcherStats)
    .where(
      and(
        eq(mlbPitcherStats.pitcherName, pitcherName),
        eq(mlbPitcherStats.teamAbbr, teamAbbr.toUpperCase())
      )
    )
    .limit(1);
  
  if (rows.length > 0 && rows[0].nrfiRate !== null) {
    return parseFloat(String(rows[0].nrfiRate));
  }
  
  // Try name-only match (pitcher may have changed teams)
  const nameRows = await db
    .select({ nrfiRate: mlbPitcherStats.nrfiRate })
    .from(mlbPitcherStats)
    .where(eq(mlbPitcherStats.pitcherName, pitcherName))
    .limit(1);
  
  if (nameRows.length > 0 && nameRows[0].nrfiRate !== null) {
    return parseFloat(String(nameRows[0].nrfiRate));
  }
  
  return null;
}

async function main() {
  const db = await getDb();
  
  // Get all 2026 MLB games that have starting pitchers
  const rows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
      nrfiCombinedSignal: games.nrfiCombinedSignal,
      nrfiFilterPass: games.nrfiFilterPass,
      gameDate: games.gameDate,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        isNotNull(games.awayStartingPitcher),
        isNotNull(games.homeStartingPitcher),
      )
    );
  
  // Filter to 2026 games
  const games2026 = rows.filter(g => g.gameDate && g.gameDate.startsWith("2026"));
  
  console.log("[BACKFILL] Found " + games2026.length + " 2026 MLB games with starting pitchers");
  
  const alreadyHaveSignal = games2026.filter(g => g.nrfiCombinedSignal !== null);
  const needSignal = games2026.filter(g => g.nrfiCombinedSignal === null);
  
  console.log("[BACKFILL]   " + alreadyHaveSignal.length + " already have nrfiCombinedSignal");
  console.log("[BACKFILL]   " + needSignal.length + " need backfill");
  
  let updated = 0;
  let noData = 0;
  let errors = 0;
  
  for (const g of needSignal) {
    try {
      const awayRate = await lookupNrfiRate(db, g.awayStartingPitcher, g.awayTeam);
      const homeRate = await lookupNrfiRate(db, g.homeStartingPitcher, g.homeTeam);
      
      if (awayRate === null || homeRate === null) {
        noData++;
        console.log("[SKIP] [" + g.id + "] " + g.awayTeam + "@" + g.homeTeam + " (" + g.gameDate + ") - missing NRFI data: away=" + awayRate + " home=" + homeRate);
        continue;
      }
      
      const combinedSignal = (awayRate + homeRate) / 2;
      const filterPass = combinedSignal >= NRFI_THRESHOLD ? 1 : 0;
      
      await db
        .update(games)
        .set({
          nrfiCombinedSignal: combinedSignal,
          nrfiFilterPass: filterPass,
        })
        .where(eq(games.id, g.id));
      
      updated++;
      console.log("[UPDATE] [" + g.id + "] " + g.awayTeam + "@" + g.homeTeam + " (" + g.gameDate + ") - signal=" + combinedSignal.toFixed(4) + " pass=" + filterPass);
    } catch (err) {
      errors++;
      console.error("[ERROR] [" + g.id + "] " + g.awayTeam + "@" + g.homeTeam + ": " + err);
    }
  }
  
  console.log("\n[SUMMARY] " + updated + " updated | " + noData + " skipped (no data) | " + errors + " errors");
  console.log("[SUMMARY] Total with signal: " + (alreadyHaveSignal.length + updated) + " / " + games2026.length);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

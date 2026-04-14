/**
 * DB Audit Script — run with: pnpm tsx server/dbAudit.ts
 * Checks what game data (by sport, date range, inning coverage) is in the DB.
 */
import { getDb } from "./db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();

  console.log("\n[STEP] Querying games table by sport...");

  // First get columns
  const colResult = await db.execute(sql`SHOW COLUMNS FROM games`);
  const colNames = (colResult[0] as any[]).map((c: any) => c.Field);
  console.log('[OUTPUT] games columns:', colNames.join(', '));

  const rows = await db.execute(sql`
    SELECT 
      sport,
      MIN(gameDate) AS earliest,
      MAX(gameDate) AS latest,
      COUNT(*) AS total_games
    FROM games
    GROUP BY sport
    ORDER BY sport
  `);

  console.log("[OUTPUT] Games table by sport:");
  console.table(rows[0]);

  // Check all tables
  const tables = await db.execute(sql`SHOW TABLES`);
  const tableNames = (tables[0] as any[]).map((r: any) => Object.values(r)[0]);
  console.log("\n[OUTPUT] All tables in DB:", tableNames.join(", "));

  // Check MLB-specific tables
  const mlbTables = tableNames.filter((t: any) => String(t).toLowerCase().includes("mlb") || String(t).toLowerCase().includes("pitcher") || String(t).toLowerCase().includes("batter") || String(t).toLowerCase().includes("pbp") || String(t).toLowerCase().includes("linescore"));
  console.log("[OUTPUT] MLB/pitcher/batter/PBP tables:", mlbTables.length ? mlbTables.join(", ") : "NONE");

  // Check mlb_pitchers if exists
  if (tableNames.includes("mlb_pitchers")) {
    const pitcherCount = await db.execute(sql`
      SELECT COUNT(*) as n, MIN(season) as min_season, MAX(season) as max_season FROM mlb_pitchers
    `);
    console.log("[OUTPUT] mlb_pitchers:", (pitcherCount[0] as any[])[0]);
  }

  // Check mlb_batters if exists
  if (tableNames.includes("mlb_batters")) {
    const batterCount = await db.execute(sql`
      SELECT COUNT(*) as n, MIN(season) as min_season, MAX(season) as max_season FROM mlb_batters
    `);
    console.log("[OUTPUT] mlb_batters:", (batterCount[0] as any[])[0]);
  }

  // MLB month distribution
  const mlbDist = await db.execute(sql`
    SELECT SUBSTRING(gameDate, 1, 7) AS month, COUNT(*) AS games
    FROM games WHERE sport = 'MLB'
    GROUP BY SUBSTRING(gameDate, 1, 7)
    ORDER BY month
  `);
  console.log('\n[OUTPUT] MLB games by month:');
  console.table(mlbDist[0]);

  // Sample recent/oldest
  const recent = await db.execute(sql`SELECT gameDate, awayTeam, homeTeam FROM games WHERE sport='MLB' ORDER BY gameDate DESC LIMIT 5`);
  console.log('\n[OUTPUT] Most recent MLB games:');
  console.table(recent[0]);

  const oldest2 = await db.execute(sql`SELECT gameDate, awayTeam, homeTeam FROM games WHERE sport='MLB' ORDER BY gameDate ASC LIMIT 5`);
  console.log('\n[OUTPUT] Oldest MLB games:');
  console.table(oldest2[0]);

  process.exit(0);
}

main().catch(e => { console.error("[ERROR]", e); process.exit(1); });

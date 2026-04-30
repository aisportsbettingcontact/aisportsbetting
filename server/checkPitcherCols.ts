/**
 * checkPitcherCols.ts
 * One-shot: describe mlb_pitcher_stats columns and count current rows.
 * Run: pnpm tsx server/checkPitcherCols.ts
 */
import { getDb } from './db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  // DESCRIBE table
  const [cols] = await db.execute(sql`DESCRIBE mlb_pitcher_stats`);
  const rows = cols as any[];
  console.log('[COLUMNS] mlb_pitcher_stats:');
  rows.forEach((r: any) => console.log(`  ${r.Field} | ${r.Type} | ${r.Null} | ${r.Key}`));

  // Count rows
  const [cnt] = await db.execute(sql`SELECT COUNT(*) as n FROM mlb_pitcher_stats`);
  console.log(`\n[COUNT] Total rows: ${(cnt as any[])[0].n}`);

  // Sample 3 rows
  const [sample] = await db.execute(sql`SELECT mlbamId, fullName, teamAbbrev, era, gamesStarted FROM mlb_pitcher_stats LIMIT 3`);
  console.log('\n[SAMPLE] First 3 rows:');
  (sample as any[]).forEach((r: any) => console.log(`  ${r.mlbamId} | ${r.fullName} | ${r.teamAbbrev} | ERA=${r.era} | GS=${r.gamesStarted}`));

  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });

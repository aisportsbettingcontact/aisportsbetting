import { getDb } from '../server/db';
import { nhlTeams, nbaTeams, mlbTeams } from '../drizzle/schema';

(async () => {
  const db = await getDb();
  if (!db) { console.log('no db'); process.exit(1); }
  
  const nhl = await db.select({ 
    dbSlug: nhlTeams.dbSlug, abbrev: nhlTeams.abbrev,
    p: nhlTeams.primaryColor, s: nhlTeams.secondaryColor, t: nhlTeams.tertiaryColor
  }).from(nhlTeams);
  
  const nba = await db.select({ 
    dbSlug: nbaTeams.dbSlug, abbrev: nbaTeams.abbrev,
    p: nbaTeams.primaryColor, s: nbaTeams.secondaryColor, t: nbaTeams.tertiaryColor
  }).from(nbaTeams);
  
  console.log('NHL:');
  for (const t of nhl) console.log(`  ${t.dbSlug}: p=${t.p} s=${t.s} t=${t.t}`);
  console.log('\nNBA:');
  for (const t of nba) console.log(`  ${t.dbSlug}: p=${t.p} s=${t.s} t=${t.t}`);
  
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });

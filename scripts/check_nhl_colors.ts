import { getDb } from '../server/db';
import { nhlTeams } from '../drizzle/schema';

(async () => {
  const db = await getDb();
  if (!db) { console.log('no db'); process.exit(1); }
  const rows = await db.select({ abbrev: nhlTeams.abbrev, primary: nhlTeams.primaryColor, secondary: nhlTeams.secondaryColor }).from(nhlTeams).limit(5);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });

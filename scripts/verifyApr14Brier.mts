import 'dotenv/config';
import { getDb } from '../server/db.js';
import { games } from '../drizzle/schema.js';
import { and, eq, isNotNull, gt } from 'drizzle-orm';

const db = await getDb();
const rows = await db
  .select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    brierF5Ml: games.brierF5Ml,
    brierFgMl: games.brierFgMl,
    brierNrfi: games.brierNrfi,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    modelF5HomeWinPct: games.modelF5HomeWinPct,
  })
  .from(games)
  .where(and(eq(games.gameDate, '2026-04-14'), eq(games.sport, 'MLB')));

let nonZeroF5 = 0, nullF5 = 0, zeroF5 = 0;
for (const r of rows) {
  const f5 = r.brierF5Ml;
  if (f5 == null) nullF5++;
  else if (Number(f5) > 0) nonZeroF5++;
  else zeroF5++;
  console.log(`id=${r.id} ${r.awayTeam}@${r.homeTeam} | brierFgMl=${r.brierFgMl != null ? Number(r.brierFgMl).toFixed(4) : 'NULL'} brierF5Ml=${f5 != null ? Number(f5).toFixed(4) : 'NULL'} brierNrfi=${r.brierNrfi != null ? Number(r.brierNrfi).toFixed(4) : 'NULL'} | modelF5Away=${r.modelF5AwayWinPct != null ? Number(r.modelF5AwayWinPct).toFixed(2) : 'NULL'} modelF5Home=${r.modelF5HomeWinPct != null ? Number(r.modelF5HomeWinPct).toFixed(2) : 'NULL'}`);
}
console.log(`\nSUMMARY: ${rows.length} games | nonZero brierF5Ml=${nonZeroF5} | zero=${zeroF5} | null=${nullF5}`);
process.exit(0);

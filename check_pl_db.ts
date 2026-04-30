import 'dotenv/config';
import { getDb } from './server/db.js';
import { games } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

const db = await getDb();
const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  startTimeEst: games.startTimeEst,
  awayBookSpread: games.awayBookSpread,
  awaySpreadOdds: games.awaySpreadOdds,
  homeBookSpread: games.homeBookSpread,
  homeSpreadOdds: games.homeSpreadOdds,
  modelAwayPuckLine: games.modelAwayPuckLine,
  modelHomePuckLine: games.modelHomePuckLine,
  modelAwayPLOdds: games.modelAwayPLOdds,
  modelHomePLOdds: games.modelHomePLOdds,
  modelAwayPLCoverPct: games.modelAwayPLCoverPct,
  modelHomePLCoverPct: games.modelHomePLCoverPct,
}).from(games).where(eq(games.sport, 'NHL'));

for (const r of rows) {
  const away = r.awayTeam.split('_').at(-1)?.toUpperCase() ?? r.awayTeam;
  const home = r.homeTeam.split('_').at(-1)?.toUpperCase() ?? r.homeTeam;
  console.log(`${away}@${home} [${r.startTimeEst}]`);
  console.log(`  BOOK: away=${r.awayBookSpread}(${r.awaySpreadOdds}) home=${r.homeBookSpread}(${r.homeSpreadOdds})`);
  console.log(`  MODEL PL spread: away=${r.modelAwayPuckLine} home=${r.modelHomePuckLine}`);
  console.log(`  MODEL PL odds:   away=${r.modelAwayPLOdds} home=${r.modelHomePLOdds}`);
  console.log(`  MODEL PL cover%: away=${r.modelAwayPLCoverPct} home=${r.modelHomePLCoverPct}`);
}
process.exit(0);

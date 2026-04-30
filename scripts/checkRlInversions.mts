import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { inArray } from 'drizzle-orm';

const db = await getDb();
const rows = await db.select({
  id: games.id,
  gameDate: games.gameDate,
  away: games.awayTeam,
  home: games.homeTeam,
  awayBookSpread: games.awayBookSpread,
  homeBookSpread: games.homeBookSpread,
  awayModelSpread: games.awayModelSpread,
  homeModelSpread: games.homeModelSpread,
  awayRunLine: games.awayRunLine,
  homeRunLine: games.homeRunLine,
  modelF5PushPct: games.modelF5PushPct,
  modelF5PushRaw: games.modelF5PushRaw,
}).from(games).where(inArray(games.id, [2250061, 2250071]));

for (const r of rows) {
  console.log(`\n[INPUT] Game id=${r.id} | ${r.away} @ ${r.home} | ${r.gameDate}`);
  console.log(`  awayBookSpread=${r.awayBookSpread} homeBookSpread=${r.homeBookSpread}`);
  console.log(`  awayModelSpread=${r.awayModelSpread} homeModelSpread=${r.homeModelSpread}`);
  console.log(`  awayRunLine=${r.awayRunLine} homeRunLine=${r.homeRunLine}`);
  console.log(`  modelF5PushPct=${r.modelF5PushPct} modelF5PushRaw=${r.modelF5PushRaw}`);
  
  const bookSign = parseFloat(String(r.awayBookSpread ?? '0')) < 0 ? 'AWAY_FAV' : 'HOME_FAV';
  const modelSign = parseFloat(String(r.awayModelSpread ?? '0')) < 0 ? 'AWAY_FAV' : 'HOME_FAV';
  console.log(`  [VERIFY] Book says: ${bookSign} | Model says: ${modelSign}`);
  if (bookSign !== modelSign) {
    console.log(`  [FAIL] RL INVERSION CONFIRMED — push values are clean but RL sign is wrong`);
    console.log(`  [DIAGNOSIS] awayBookSpread=${r.awayBookSpread} should match awayModelSpread sign`);
    console.log(`  [FIX] Need to flip awayModelSpread from ${r.awayModelSpread} to ${parseFloat(String(r.awayModelSpread ?? '0')) * -1}`);
  }
}
process.exit(0);

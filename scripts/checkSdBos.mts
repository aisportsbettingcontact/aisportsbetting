import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const db = await getDb();
const rows = await db.select({
  id: games.id, gameDate: games.gameDate, away: games.awayTeam, home: games.homeTeam,
  awayBookSpread: games.awayBookSpread, awayModelSpread: games.awayModelSpread,
  homeModelSpread: games.homeModelSpread, awayRunLine: games.awayRunLine,
  homeRunLine: games.homeRunLine, awayRunLineOdds: games.awayRunLineOdds,
  homeRunLineOdds: games.homeRunLineOdds, modelRunAt: games.modelRunAt,
  modelF5PushPct: games.modelF5PushPct, modelF5PushRaw: games.modelF5PushRaw,
  bookTotal: games.bookTotal, publishedToFeed: games.publishedToFeed,
}).from(games).where(eq(games.id, 2250097));

const g = rows[0];
console.log('[INPUT] Game id=2250097 (SD @ BOS, 2026-04-03):');
console.log(`  awayBookSpread=${g?.awayBookSpread} awayModelSpread="${g?.awayModelSpread}"`);
console.log(`  awayRunLine=${g?.awayRunLine} homeRunLine=${g?.homeRunLine}`);
console.log(`  awayRunLineOdds=${g?.awayRunLineOdds} homeRunLineOdds=${g?.homeRunLineOdds}`);
console.log(`  modelRunAt=${g?.modelRunAt} bookTotal=${g?.bookTotal}`);
console.log(`  modelF5PushPct=${g?.modelF5PushPct} modelF5PushRaw=${g?.modelF5PushRaw}`);
console.log(`  publishedToFeed=${g?.publishedToFeed}`);

const awayModelNum = parseFloat(String(g?.awayModelSpread ?? '0'));
if (awayModelNum === 0) {
  console.log('\n[DIAGNOSIS] awayModelSpread=0.0 — model wrote a zero spread (invalid for MLB RL).');
  console.log('[DIAGNOSIS] This is a model output error, not a data ingestion issue.');
  console.log('[DIAGNOSIS] modelRunAt is set, so the model ran but produced an invalid RL.');
  console.log('[FIX] Need to re-run the model for 2026-04-03 to correct this game.');
}
process.exit(0);

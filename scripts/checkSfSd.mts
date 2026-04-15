import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const db = await getDb();
const rows = await db.select({
  id: games.id,
  away: games.awayTeam,
  home: games.homeTeam,
  gameDate: games.gameDate,
  awayBookSpread: games.awayBookSpread,
  awayModelSpread: games.awayModelSpread,
  homeModelSpread: games.homeModelSpread,
  modelF5PushPct: games.modelF5PushPct,
  modelF5PushRaw: games.modelF5PushRaw,
  modelRunAt: games.modelRunAt,
}).from(games).where(eq(games.id, 2250061));
console.log('[INPUT] Querying game id=2250061 (SF @ SD, 2026-03-30)');
console.log('[OUTPUT]', JSON.stringify(rows[0], null, 2));
console.log('[VERIFY] awayBookSpread:', rows[0]?.awayBookSpread, '| awayModelSpread:', rows[0]?.awayModelSpread);
console.log('[VERIFY] modelF5PushPct:', rows[0]?.modelF5PushPct, '| modelF5PushRaw:', rows[0]?.modelF5PushRaw);
process.exit(0);

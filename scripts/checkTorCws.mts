/**
 * checkTorCws.mts
 * Diagnose game id=2250092 (TOR @ CWS, 2026-04-02) which has 6 validation failures.
 */
import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const db = await getDb();
const rows = await db.select().from(games).where(eq(games.id, 2250092));
const g = rows[0];

if (!g) {
  console.log('[FAIL] Game id=2250092 not found in DB');
  process.exit(1);
}

console.log('[INPUT] Full game record for id=2250092 (TOR @ CWS, 2026-04-02):');
console.log(JSON.stringify(g, null, 2));

// Key field analysis
console.log('\n[VERIFY] Key fields:');
console.log(`  gameDate:         ${g.gameDate}`);
console.log(`  awayTeam:         ${g.awayTeam}`);
console.log(`  homeTeam:         ${g.homeTeam}`);
console.log(`  bookTotal:        ${g.bookTotal}`);
console.log(`  awayBookSpread:   ${g.awayBookSpread}`);
console.log(`  awayModelSpread:  "${g.awayModelSpread}"`);
console.log(`  homeModelSpread:  "${g.homeModelSpread}"`);
console.log(`  awayRunLine:      ${g.awayRunLine}`);
console.log(`  homeRunLine:      ${g.homeRunLine}`);
console.log(`  awayRunLineOdds:  ${g.awayRunLineOdds}`);
console.log(`  homeRunLineOdds:  ${g.homeRunLineOdds}`);
console.log(`  publishedToFeed:  ${g.publishedToFeed}`);
console.log(`  publishedModel:   ${g.publishedModel}`);
console.log(`  modelRunAt:       ${g.modelRunAt}`);
console.log(`  modelF5PushPct:   ${g.modelF5PushPct}`);
console.log(`  modelF5PushRaw:   ${g.modelF5PushRaw}`);
console.log(`  status:           ${(g as any).status ?? 'N/A'}`);
console.log(`  isPostponed:      ${(g as any).isPostponed ?? 'N/A'}`);

// Diagnosis
if (!g.awayModelSpread && !g.modelRunAt) {
  console.log('\n[DIAGNOSIS] modelRunAt is NULL and awayModelSpread is empty — game was NEVER modeled.');
  console.log('[DIAGNOSIS] bookTotal=0 suggests this game may have been postponed or cancelled.');
  console.log('[RECOMMENDATION] If postponed/cancelled: exclude from validation scope (not a model failure).');
  console.log('[RECOMMENDATION] If it should have been modeled: re-run model for 2026-04-02 with --force flag.');
}

process.exit(0);

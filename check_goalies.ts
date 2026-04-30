import { getDb } from './server/db';
import { games } from './drizzle/schema';
import { eq, like, and } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  const rows = await db.select().from(games)
    .where(and(eq(games.sport, 'NHL'), like(games.startTimeEst, '2026-04-16%')));

  for (const r of rows) {
    const g = r as any;
    console.log(`\n${r.awayTeam}@${r.homeTeam}`);
    console.log(`  Away G: ${g.awayGoalie ?? 'NULL'} | GSAx: ${g.awayGoalieGSAx ?? 'NULL'} | SV%: ${g.awayGoalieSavePct ?? 'NULL'}`);
    console.log(`  Home G: ${g.homeGoalie ?? 'NULL'} | GSAx: ${g.homeGoalieGSAx ?? 'NULL'} | SV%: ${g.homeGoalieSavePct ?? 'NULL'}`);
    console.log(`  oddsSource: ${g.oddsSource ?? 'NULL'}`);
    console.log(`  awayBookSpread: ${g.awayBookSpread} | awaySpreadOdds: ${g.awaySpreadOdds}`);
    console.log(`  modelAwayPLOdds: ${g.modelAwayPLOdds} | modelHomePLOdds: ${g.modelHomePLOdds}`);
    console.log(`  modelAwayPLCoverPct: ${g.modelAwayPLCoverPct} | modelHomePLCoverPct: ${g.modelHomePLCoverPct}`);
    console.log(`  projAwayGoals: ${g.projAwayGoals} | projHomeGoals: ${g.projHomeGoals}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

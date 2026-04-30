import 'dotenv/config';
import { getDb } from './server/db.js';
import { games } from './drizzle/schema.js';
import { inArray } from 'drizzle-orm';

const GAME_IDS = [3000001, 3000002, 3000003, 3000004, 3000005, 3000006];

const db = await getDb();
const rows = await db.select({
  id: games.id,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayBookSpread: games.awayBookSpread,
  awaySpreadOdds: games.awaySpreadOdds,
  homeBookSpread: games.homeBookSpread,
  homeSpreadOdds: games.homeSpreadOdds,
  awayML: games.awayML,
  homeML: games.homeML,
  bookTotal: games.bookTotal,
  overOdds: games.overOdds,
  underOdds: games.underOdds,
  oddsSource: games.oddsSource,
  modelAwayPuckLine: games.modelAwayPuckLine,
  modelHomePuckLine: games.modelHomePuckLine,
  modelAwayPLOdds: games.modelAwayPLOdds,
  modelHomePLOdds: games.modelHomePLOdds,
  modelAwayPLCoverPct: games.modelAwayPLCoverPct,
  modelHomePLCoverPct: games.modelHomePLCoverPct,
  modelAwayScore: games.modelAwayScore,
  modelHomeScore: games.modelHomeScore,
}).from(games).where(inArray(games.id, GAME_IDS));

console.log('\n[VALIDATION] April 16 NHL Games — Post-Refresh State');
console.log('='.repeat(80));

let allPass = true;
for (const r of rows) {
  const away = r.awayTeam.toUpperCase().slice(-3);
  const home = r.homeTeam.toUpperCase().slice(-3);
  
  // Consistency check: cover% + odds must be internally consistent
  const ac = parseFloat(String(r.modelAwayPLCoverPct ?? '0'));
  const hc = parseFloat(String(r.modelHomePLCoverPct ?? '0'));
  const maPL = parseInt(String(r.modelAwayPLOdds ?? '0'));
  const mhPL = parseInt(String(r.modelHomePLOdds ?? '0'));
  
  // prob_to_ml check: if ac > 50, maPL should be negative; if ac < 50, maPL should be positive
  const acSignOk = (ac > 50 && maPL < 0) || (ac < 50 && maPL > 0) || Math.abs(ac - 50) < 1;
  const hcSignOk = (hc > 50 && mhPL < 0) || (hc < 50 && mhPL > 0) || Math.abs(hc - 50) < 1;
  const sumOk = Math.abs(ac + hc - 100) < 2;
  const oddsSource = r.oddsSource ?? 'null';
  const sourceOk = oddsSource === 'dk';
  
  const pass = acSignOk && hcSignOk && sumOk && sourceOk;
  if (!pass) allPass = false;
  
  console.log(`\n  ${pass ? '✅' : '❌'} ${away}@${home} [source=${oddsSource}]`);
  console.log(`    BOOK:  away=${r.awayBookSpread}(${r.awaySpreadOdds}) home=${r.homeBookSpread}(${r.homeSpreadOdds}) total=${r.bookTotal} ml=${r.awayML}/${r.homeML}`);
  console.log(`    MODEL: proj=${r.modelAwayScore}/${r.modelHomeScore} | PL=${r.modelAwayPuckLine}(${r.modelAwayPLOdds})/${r.modelHomePuckLine}(${r.modelHomePLOdds})`);
  console.log(`    COVER%: away=${ac.toFixed(1)}% home=${hc.toFixed(1)}% sum=${(ac+hc).toFixed(1)} [${sumOk ? '✓' : '✗'}]`);
  console.log(`    SIGN:   away_ok=${acSignOk ? '✓' : '✗'} home_ok=${hcSignOk ? '✓' : '✗'} source_ok=${sourceOk ? '✓' : '✗'}`);
}

console.log('\n' + '='.repeat(80));
console.log(`[VALIDATION] ${allPass ? '✅ ALL 6 GAMES PASS' : '❌ FAILURES DETECTED'}`);
process.exit(0);

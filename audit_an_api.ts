import 'dotenv/config';
import { fetchActionNetworkOdds } from './server/actionNetworkScraper.js';
import { getDb } from './server/db.js';
import { games } from './drizzle/schema.js';
import { eq } from 'drizzle-orm';

const today = '2026-04-16';
console.log(`\n[AUDIT] Fetching AN API for NHL ${today}...`);
const anGames = await fetchActionNetworkOdds('nhl', today);

console.log(`\n[AUDIT] AN API returned ${anGames.length} games:`);
for (const g of anGames) {
  const dkSpreadSrc = g.dkAwaySpread !== null ? 'DK' : 'OPEN';
  const awaySpread = g.dkAwaySpread ?? g.openAwaySpread;
  const awaySpreadOdds = g.dkAwaySpreadOdds ?? g.openAwaySpreadOdds;
  const homeSpread = g.dkHomeSpread ?? g.openHomeSpread;
  const homeSpreadOdds = g.dkHomeSpreadOdds ?? g.openHomeSpreadOdds;
  const awayML = g.dkAwayML ?? g.openAwayML;
  const homeML = g.dkHomeML ?? g.openHomeML;
  const total = g.dkTotal ?? g.openTotal;
  const overOdds = g.dkOverOdds ?? g.openOverOdds;
  const underOdds = g.dkUnderOdds ?? g.openUnderOdds;
  console.log(`\n  [${dkSpreadSrc}] ${g.awayAbbr}@${g.homeAbbr} | ${g.startTime}`);
  console.log(`    SPREAD: away=${awaySpread}(${awaySpreadOdds}) home=${homeSpread}(${homeSpreadOdds})`);
  console.log(`    TOTAL:  ${total} over=${overOdds} under=${underOdds}`);
  console.log(`    ML:     away=${awayML} home=${homeML}`);
  if (g.fdAwaySpread !== null) {
    console.log(`    FD:     away=${g.fdAwaySpread}(${g.fdAwaySpreadOdds}) home=${g.fdHomeSpread}(${g.fdHomeSpreadOdds})`);
  }
}

// Compare with DB
const db = await getDb();
const dbRows = await db.select({
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
}).from(games).where(eq(games.sport, 'NHL'));

console.log(`\n\n[AUDIT] DB has ${dbRows.length} NHL games. Cross-referencing AN API vs DB...`);
console.log('='.repeat(80));

for (const g of anGames) {
  // Match by team name
  const dbRow = dbRows.find(r => {
    const awayLower = r.awayTeam.toLowerCase();
    return awayLower.includes(g.awayAbbr.toLowerCase()) ||
           awayLower.includes(g.awayUrlSlug?.toLowerCase() ?? 'XXXXXX') ||
           awayLower.includes((g.awayFullName.toLowerCase().split(' ').pop() ?? 'XXXXXX'));
  });

  if (!dbRow) {
    console.log(`\n  [NO_DB_MATCH] ${g.awayAbbr}@${g.homeAbbr} — game not found in DB`);
    continue;
  }

  const anAwaySpread = g.dkAwaySpread ?? g.openAwaySpread;
  const anAwaySpreadOdds = g.dkAwaySpreadOdds ?? g.openAwaySpreadOdds;
  const anHomeSpread = g.dkHomeSpread ?? g.openHomeSpread;
  const anHomeSpreadOdds = g.dkHomeSpreadOdds ?? g.openHomeSpreadOdds;
  const anAwayML = g.dkAwayML ?? g.openAwayML;
  const anHomeML = g.dkHomeML ?? g.openHomeML;
  const anTotal = g.dkTotal ?? g.openTotal;
  const anOverOdds = g.dkOverOdds ?? g.openOverOdds;
  const anUnderOdds = g.dkUnderOdds ?? g.openUnderOdds;

  const dbAwaySpread = parseFloat(String(dbRow.awayBookSpread ?? '999'));
  const dbHomeSpread = parseFloat(String(dbRow.homeBookSpread ?? '999'));

  const spreadOk = anAwaySpread !== null && Math.abs(dbAwaySpread - anAwaySpread) < 0.01;
  const spreadOddsOk = dbRow.awaySpreadOdds === anAwaySpreadOdds;
  const mlOk = dbRow.awayML === anAwayML && dbRow.homeML === anHomeML;
  const totalOk = anTotal !== null && Math.abs(parseFloat(String(dbRow.bookTotal ?? '999')) - anTotal) < 0.01;

  const allOk = spreadOk && spreadOddsOk && mlOk && totalOk;
  console.log(`\n  ${allOk ? '✅' : '❌'} ${g.awayAbbr}@${g.homeAbbr} [DB source: ${dbRow.oddsSource ?? 'null'}]`);

  if (!spreadOk || !spreadOddsOk) {
    console.log(`    [SPREAD MISMATCH]`);
    console.log(`      AN:  away=${anAwaySpread}(${anAwaySpreadOdds}) home=${anHomeSpread}(${anHomeSpreadOdds})`);
    console.log(`      DB:  away=${dbRow.awayBookSpread}(${dbRow.awaySpreadOdds}) home=${dbRow.homeBookSpread}(${dbRow.homeSpreadOdds})`);
  }
  if (!mlOk) {
    console.log(`    [ML MISMATCH]`);
    console.log(`      AN:  away=${anAwayML} home=${anHomeML}`);
    console.log(`      DB:  away=${dbRow.awayML} home=${dbRow.homeML}`);
  }
  if (!totalOk) {
    console.log(`    [TOTAL MISMATCH]`);
    console.log(`      AN:  total=${anTotal} over=${anOverOdds} under=${anUnderOdds}`);
    console.log(`      DB:  total=${dbRow.bookTotal} over=${dbRow.overOdds} under=${dbRow.underOdds}`);
  }
}
process.exit(0);

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get today's games
const [rows] = await conn.execute(
  `SELECT id, sport, awayTeam, homeTeam, gameDate, awayScore, homeScore, gameStatus, 
   awayBookSpread, homeBookSpread, bookTotal, awayML, homeML, 
   spreadAwayBetsPct, spreadAwayMoneyPct, totalOverBetsPct, totalOverMoneyPct,
   mlAwayBetsPct, mlAwayMoneyPct,
   openAwaySpread, openHomeSpread, openTotal, openAwayML, openHomeML,
   dkAwaySpread, dkHomeSpread, dkTotal, dkAwayML, dkHomeML,
   awaySpreadOdds, homeSpreadOdds, overOdds, underOdds
   FROM games WHERE gameDate = '2026-03-14' ORDER BY sport, startTimeEst LIMIT 100`
);

console.log('Total games for 2026-03-14:', rows.length);

// Group by sport
const bySport = {};
for (const row of rows) {
  const sport = row.sport;
  if (!bySport[sport]) bySport[sport] = [];
  bySport[sport].push(row);
}

for (const [sport, games] of Object.entries(bySport)) {
  console.log('\n=== ' + sport.toUpperCase() + ' (' + games.length + ' games) ===');
  for (const g of games) {
    const hasSpread = g.awayBookSpread !== null;
    const hasTotal = g.bookTotal !== null;
    const hasML = g.awayML !== null;
    const hasSplits = g.spreadAwayBetsPct !== null;
    const hasOpen = g.openAwaySpread !== null;
    const hasDk = g.dkAwaySpread !== null;
    
    console.log('  ' + g.awayTeam + ' @ ' + g.homeTeam);
    console.log('    spread=' + (hasSpread ? g.awayBookSpread + '/' + g.homeBookSpread : 'MISSING') + 
                ' total=' + (hasTotal ? g.bookTotal : 'MISSING') + 
                ' ml=' + (hasML ? g.awayML + '/' + g.homeML : 'MISSING'));
    console.log('    splits=' + (hasSplits ? 'YES (awayBets=' + g.spreadAwayBetsPct + '% awayMoney=' + g.spreadAwayMoneyPct + '%)' : 'NO'));
    console.log('    open=' + (hasOpen ? g.openAwaySpread + '/' + g.openHomeSpread + ' total=' + g.openTotal : 'NO'));
    console.log('    dk=' + (hasDk ? g.dkAwaySpread + '/' + g.dkHomeSpread + ' total=' + g.dkTotal + ' ml=' + g.dkAwayML + '/' + g.dkHomeML : 'NO'));
  }
}

// Summary
console.log('\n=== SUMMARY ===');
for (const [sport, games] of Object.entries(bySport)) {
  const withSpread = games.filter(g => g.awayBookSpread !== null).length;
  const withTotal = games.filter(g => g.bookTotal !== null).length;
  const withML = games.filter(g => g.awayML !== null).length;
  const withSplits = games.filter(g => g.spreadAwayBetsPct !== null).length;
  const withOpen = games.filter(g => g.openAwaySpread !== null).length;
  const withDk = games.filter(g => g.dkAwaySpread !== null).length;
  console.log(sport.toUpperCase() + ': ' + games.length + ' games | spread=' + withSpread + '/' + games.length + ' total=' + withTotal + '/' + games.length + ' ml=' + withML + '/' + games.length + ' splits=' + withSplits + '/' + games.length + ' open=' + withOpen + '/' + games.length + ' dk=' + withDk + '/' + games.length);
}

await conn.end();

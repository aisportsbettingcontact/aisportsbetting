import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all March 26 MLB games
const [games] = await conn.execute(`
  SELECT id, awayTeam, homeTeam, gameDate, mlbGamePk
  FROM games
  WHERE gameDate = '2026-03-26' AND sport = 'MLB'
  ORDER BY id
`);
console.log('MLB Games on March 26:', games.length);

// Get all lineups for these games
const gameIds = games.map(g => g.id);
const [lineups] = await conn.execute(`
  SELECT gameId, awayPitcherName, awayPitcherMlbamId, awayPitcherConfirmed,
         homePitcherName, homePitcherMlbamId, homePitcherConfirmed,
         awayLineup, homeLineup, awayLineupConfirmed, homeLineupConfirmed
  FROM mlb_lineups
  WHERE gameId IN (${gameIds.join(',')})
`);
console.log('Lineup entries:', lineups.length);

// Build combined output
const result = games.map(g => {
  const lu = lineups.find(l => l.gameId === g.id);
  let awayBatters = null, homeBatters = null;
  try { awayBatters = lu?.awayLineup ? JSON.parse(lu.awayLineup) : null; } catch(e) {}
  try { homeBatters = lu?.homeLineup ? JSON.parse(lu.homeLineup) : null; } catch(e) {}
  return {
    gameId: g.id,
    away: g.awayTeam,
    home: g.homeTeam,
    awayPitcher: lu?.awayPitcherName || null,
    awayPitcherMlbam: lu?.awayPitcherMlbamId || null,
    awayPitcherConf: lu?.awayPitcherConfirmed || 0,
    homePitcher: lu?.homePitcherName || null,
    homePitcherMlbam: lu?.homePitcherMlbamId || null,
    homePitcherConf: lu?.homePitcherConfirmed || 0,
    awayLineupConf: lu?.awayLineupConfirmed || 0,
    homeLineupConf: lu?.homeLineupConfirmed || 0,
    awayBatters,
    homeBatters,
  };
});

fs.writeFileSync('/tmp/march26_all_games.json', JSON.stringify(result, null, 2));

// Print full summary
console.log('\n=== FULL MARCH 26 SLATE ===');
result.forEach(g => {
  const awayC = g.awayBatters?.length || 0;
  const homeC = g.homeBatters?.length || 0;
  const awayPC = g.awayPitcherConf ? '✓' : '?';
  const homePC = g.homePitcherConf ? '✓' : '?';
  const awayLC = g.awayLineupConf ? '✓' : '?';
  const homeLC = g.homeLineupConf ? '✓' : '?';
  console.log(`\nGame ${g.gameId}: ${g.away} @ ${g.home}`);
  console.log(`  Away P: ${g.awayPitcher} (MLBAM:${g.awayPitcherMlbam}) ${awayPC} | Lineup:${awayC} batters ${awayLC}`);
  console.log(`  Home P: ${g.homePitcher} (MLBAM:${g.homePitcherMlbam}) ${homePC} | Lineup:${homeC} batters ${homeLC}`);
  if (g.awayBatters) {
    console.log(`  Away batters: ${g.awayBatters.map(b => b.mlbamId + ':' + b.name).join(', ')}`);
  }
  if (g.homeBatters) {
    console.log(`  Home batters: ${g.homeBatters.map(b => b.mlbamId + ':' + b.name).join(', ')}`);
  }
});

// Collect all unique batter MLBAM IDs
const allBatterIds = new Set();
result.forEach(g => {
  (g.awayBatters || []).forEach(b => b.mlbamId && allBatterIds.add(b.mlbamId));
  (g.homeBatters || []).forEach(b => b.mlbamId && allBatterIds.add(b.mlbamId));
});
console.log(`\nTotal unique batter MLBAM IDs: ${allBatterIds.size}`);
console.log('All batter IDs:', [...allBatterIds].sort().join(', '));

await conn.end();

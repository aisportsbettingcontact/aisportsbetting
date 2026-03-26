import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { execSync } from 'child_process';
import fs from 'fs';

// Use the existing extract_lineups script pattern but for all March 26 games
// Read directly from DB using mysql2
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all March 26 games
const [games] = await conn.execute(`
  SELECT id, away_team, home_team, away_pitcher_id, home_pitcher_id, game_date
  FROM mlb_games
  WHERE DATE(game_date) = '2026-03-26'
  ORDER BY id
`);

console.log(`Found ${games.length} games on March 26`);

// Get all lineups for March 26
const [lineups] = await conn.execute(`
  SELECT game_id, team, lineup_json
  FROM mlb_lineups
  WHERE DATE(game_date) = '2026-03-26'
`);

console.log(`Found ${lineups.length} lineup entries`);

// Build combined output
const result = games.map(g => {
  const awayL = lineups.find(l => l.game_id === g.id && l.team === g.away_team);
  const homeL = lineups.find(l => l.game_id === g.id && l.team === g.home_team);
  
  let awayLineup = null, homeLineup = null;
  try { awayLineup = awayL ? JSON.parse(awayL.lineup_json) : null; } catch(e) {}
  try { homeLineup = homeL ? JSON.parse(homeL.lineup_json) : null; } catch(e) {}
  
  return {
    gameId: g.id,
    away: g.away_team,
    home: g.home_team,
    awayPitcherId: g.away_pitcher_id,
    homePitcherId: g.home_pitcher_id,
    awayLineup,
    homeLineup,
  };
});

fs.writeFileSync('/tmp/march26_all_games.json', JSON.stringify(result, null, 2));

// Print summary
result.forEach(g => {
  const awayCount = g.awayLineup?.length || 0;
  const homeCount = g.homeLineup?.length || 0;
  console.log(`Game ${g.gameId}: ${g.away}@${g.home} | awayP:${g.awayPitcherId} homeP:${g.homePitcherId} | awayL:${awayCount} homeL:${homeCount}`);
});

// Print all unique batter MLBAM IDs
const allBatterIds = new Set();
result.forEach(g => {
  (g.awayLineup || []).forEach(p => p.mlbamId && allBatterIds.add(p.mlbamId));
  (g.homeLineup || []).forEach(p => p.mlbamId && allBatterIds.add(p.mlbamId));
});
console.log(`\nTotal unique batter MLBAM IDs: ${allBatterIds.size}`);

await conn.end();

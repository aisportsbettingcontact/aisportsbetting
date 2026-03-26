/**
 * extract_lineups.mjs
 * Reads RotoWire lineups from DB for the 3 March 26 K-prop games
 * and maps each batter to their Retrosheet ID via MLBAM crosswalk.
 * Run: node scripts/extract_lineups.mjs
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  'SELECT gameId, awayPitcherName, homePitcherName, awayLineup, homeLineup, awayLineupConfirmed, homeLineupConfirmed FROM mlb_lineups WHERE gameId IN (2250007, 2250008, 2250009) ORDER BY gameId'
);

// Load crosswalk: rs_id -> sc_id (MLBAM)
const crosswalkRaw = readFileSync('/home/ubuntu/game_data/crosswalk.csv', 'utf8');
const mlbamToRs = {};
const rsToMlbam = {};
for (const line of crosswalkRaw.trim().split('\n').slice(1)) {
  const [rs, sc] = line.split(',');
  if (rs && sc) {
    mlbamToRs[sc.trim()] = rs.trim();
    rsToMlbam[rs.trim()] = sc.trim();
  }
}

const GAME_LABELS = {
  2250007: 'PIT @ NYN (Skenes vs Peralta)',
  2250008: 'CHA @ MIL (Smith vs Misiorowski)',
  2250009: 'WAS @ CHN (Cavalli vs Boyd)',
};

for (const row of rows) {
  const away = JSON.parse(row.awayLineup || '[]');
  const home = JSON.parse(row.homeLineup || '[]');
  console.log(`\n${'='.repeat(70)}`);
  console.log(`gameId=${row.gameId}  ${GAME_LABELS[row.gameId] || ''}`);
  console.log(`Away P: ${row.awayPitcherName} | Home P: ${row.homePitcherName}`);
  console.log(`Away confirmed=${row.awayLineupConfirmed} | Home confirmed=${row.homeLineupConfirmed}`);

  console.log('\nAWAY LINEUP:');
  console.log('  #  Name                    Bats  MLBAM    RS_ID');
  console.log('  -  ----------------------  ----  -------  ----------');
  for (const p of away) {
    const rsId = mlbamToRs[String(p.mlbamId)] || '???';
    console.log(`  ${p.battingOrder}.  ${p.name.padEnd(22)}  ${p.bats.padEnd(4)}  ${String(p.mlbamId || '').padEnd(7)}  ${rsId}`);
  }

  console.log('\nHOME LINEUP:');
  console.log('  #  Name                    Bats  MLBAM    RS_ID');
  console.log('  -  ----------------------  ----  -------  ----------');
  for (const p of home) {
    const rsId = mlbamToRs[String(p.mlbamId)] || '???';
    console.log(`  ${p.battingOrder}.  ${p.name.padEnd(22)}  ${p.bats.padEnd(4)}  ${String(p.mlbamId || '').padEnd(7)}  ${rsId}`);
  }
}

await conn.end();

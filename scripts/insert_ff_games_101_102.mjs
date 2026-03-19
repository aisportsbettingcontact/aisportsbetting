/**
 * Insert missing First Four games 101 and 102 into the DB.
 *
 * Game 101: UMBC vs Howard (MIDWEST 16-seed) — FINAL: Howard 86, UMBC 83
 *   - Howard won → feeds into MIDWEST R64 game 225 (Howard @ Michigan)
 *   - In game 225: Howard is the away team = "top" slot
 *
 * Game 102: Texas vs NC State (WEST 11-seed) — FINAL: Texas 68, NC State 66
 *   - Texas won → feeds into WEST R64 game 221 (Texas @ BYU)
 *   - In game 221: Texas is the away team = "top" slot
 *
 * Both games were played on March 17, 2026 (First Four Monday).
 * nextBracketSlot enum: 'top' = away team slot, 'bottom' = home team slot
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get a reference fileId from an existing NCAAM game
const [refGames] = await conn.execute(
  'SELECT fileId FROM games WHERE sport = "NCAAM" AND fileId IS NOT NULL AND fileId > 0 LIMIT 1'
);
const fileId = refGames[0]?.fileId ?? 1;
console.log('Using fileId:', fileId);

const games = [
  {
    // Game 101: UMBC (away/top) vs Howard (home/bottom)
    // Howard won 86-83 → Howard advances to game 225 as top (away) team
    fileId,
    sport: 'NCAAM',
    awayTeam: 'umbc',
    homeTeam: 'howard',
    gameDate: '2026-03-17',
    startTimeEst: '18:40',
    gameStatus: 'final',
    awayScore: 83,
    homeScore: 86,
    publishedToFeed: 1,
    publishedModel: 0,
    bracketGameId: 101,
    bracketRound: 'FIRST_FOUR',
    bracketRegion: 'MIDWEST',
    bracketSlot: 1,
    nextBracketGameId: 225,
    nextBracketSlot: 'top',  // winner goes to top (away) slot of game 225
  },
  {
    // Game 102: Texas (away/top) vs NC State (home/bottom)
    // Texas won 68-66 → Texas advances to game 221 as top (away) team
    fileId,
    sport: 'NCAAM',
    awayTeam: 'texas',
    homeTeam: 'north_carolina_st',
    gameDate: '2026-03-17',
    startTimeEst: '21:10',
    gameStatus: 'final',
    awayScore: 68,
    homeScore: 66,
    publishedToFeed: 1,
    publishedModel: 0,
    bracketGameId: 102,
    bracketRound: 'FIRST_FOUR',
    bracketRegion: 'WEST',
    bracketSlot: 2,
    nextBracketGameId: 221,
    nextBracketSlot: 'top',  // winner goes to top (away) slot of game 221
  },
];

let inserted = 0;
let updated = 0;

for (const g of games) {
  const [check] = await conn.execute(
    'SELECT id FROM games WHERE bracketGameId = ? AND sport = "NCAAM"',
    [g.bracketGameId]
  );

  if (check.length > 0) {
    console.log(`Game bracketGameId=${g.bracketGameId} exists (id=${check[0].id}), updating...`);
    await conn.execute(
      `UPDATE games SET
        awayTeam=?, homeTeam=?, gameDate=?, startTimeEst=?, gameStatus=?,
        awayScore=?, homeScore=?, publishedToFeed=?, publishedModel=?,
        bracketRound=?, bracketRegion=?, bracketSlot=?, nextBracketGameId=?, nextBracketSlot=?
       WHERE bracketGameId=? AND sport="NCAAM"`,
      [
        g.awayTeam, g.homeTeam, g.gameDate, g.startTimeEst, g.gameStatus,
        g.awayScore, g.homeScore, g.publishedToFeed, g.publishedModel,
        g.bracketRound, g.bracketRegion, g.bracketSlot, g.nextBracketGameId, g.nextBracketSlot,
        g.bracketGameId,
      ]
    );
    updated++;
  } else {
    await conn.execute(
      `INSERT INTO games (
        fileId, sport, awayTeam, homeTeam, gameDate, startTimeEst, gameStatus,
        awayScore, homeScore, publishedToFeed, publishedModel,
        bracketGameId, bracketRound, bracketRegion, bracketSlot, nextBracketGameId, nextBracketSlot
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        g.fileId, g.sport, g.awayTeam, g.homeTeam, g.gameDate, g.startTimeEst, g.gameStatus,
        g.awayScore, g.homeScore, g.publishedToFeed, g.publishedModel,
        g.bracketGameId, g.bracketRound, g.bracketRegion, g.bracketSlot, g.nextBracketGameId, g.nextBracketSlot,
      ]
    );
    console.log(`✅ Inserted bracketGameId=${g.bracketGameId}: ${g.awayTeam} @ ${g.homeTeam} [${g.gameStatus}] ${g.awayScore}-${g.homeScore}`);
    inserted++;
  }
}

// Verify all First Four games
const [allFF] = await conn.execute(
  `SELECT bracketGameId, awayTeam, homeTeam, gameStatus, awayScore, homeScore, bracketRegion, nextBracketGameId
   FROM games WHERE bracketRound = "FIRST_FOUR" AND sport = "NCAAM" ORDER BY bracketGameId`
);

console.log(`\n✅ Done: inserted=${inserted}, updated=${updated}`);
console.log('\nAll First Four games in DB:');
allFF.forEach(g => {
  const score = g.awayScore !== null ? `${g.awayScore}-${g.homeScore}` : 'TBD';
  console.log(`  [${g.bracketGameId}] ${g.awayTeam} @ ${g.homeTeam} [${g.gameStatus}] ${score} → next: ${g.nextBracketGameId} (${g.bracketRegion})`);
});

await conn.end();

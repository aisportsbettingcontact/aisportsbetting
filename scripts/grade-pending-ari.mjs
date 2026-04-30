/**
 * grade-pending-ari.mjs
 * Grades all PENDING bets using the scoreGrader with the new AZ→ARI alias.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Fetch all PENDING MLB bets
const [pending] = await conn.query(
  'SELECT id, awayTeam, homeTeam, gameDate, result, pick, pickSide, market, timeframe, odds, line, anGameId FROM tracked_bets WHERE result = "PENDING" AND sport = "MLB"'
);

console.log(`[INPUT] ${pending.length} PENDING MLB bets to grade`);

for (const bet of pending) {
  console.log(`\n[BET] id=${bet.id} ${bet.awayTeam}@${bet.homeTeam} date=${bet.gameDate} pick="${bet.pick}" pickSide=${bet.pickSide} market=${bet.market}`);

  // Fetch MLB scores for this date
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${bet.gameDate}&hydrate=linescore,team`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`[ERROR] MLB API failed: ${res.status}`);
    continue;
  }
  const json = await res.json();
  const games = json.dates?.[0]?.games ?? [];
  console.log(`[STATE] MLB API returned ${games.length} games for ${bet.gameDate}`);

  // AZ→ARI alias
  const normalizeAbbrev = (a) => {
    const ALIASES = { 'AZ': 'ARI' };
    return ALIASES[a?.toUpperCase()] ?? a?.toUpperCase() ?? '';
  };

  const normAway = normalizeAbbrev(bet.awayTeam);
  const normHome = normalizeAbbrev(bet.homeTeam);
  console.log(`[STEP] findGame: looking for ${normAway}@${normHome}`);

  let matched = null;
  for (const g of games) {
    const ga = normalizeAbbrev(g.teams.away.team.abbreviation);
    const gh = normalizeAbbrev(g.teams.home.team.abbreviation);
    console.log(`  [GAME] ${ga}@${gh} state=${g.status.detailedState} score=${g.teams.away.score}-${g.teams.home.score}`);
    if (ga === normAway && gh === normHome) {
      matched = g;
      console.log(`  [MATCH] Found: ${ga}@${gh} state=${g.status.detailedState}`);
    }
  }

  if (!matched) {
    console.log(`[WARN] No game found for ${normAway}@${normHome} on ${bet.gameDate}`);
    continue;
  }

  const state = matched.status.detailedState;
  const isFinal = state === 'Final' || state === 'Game Over';
  if (!isFinal) {
    console.log(`[STATE] Game not final: state=${state} — skipping`);
    continue;
  }

  const awayScore = matched.teams.away.score ?? 0;
  const homeScore = matched.teams.home.score ?? 0;
  console.log(`[STATE] Final score: ${awayScore}-${homeScore}`);

  // Grade ML
  let result = 'PENDING';
  if (bet.market === 'ML') {
    if (awayScore === homeScore) result = 'PUSH';
    else if (bet.pickSide === 'AWAY') result = awayScore > homeScore ? 'WIN' : 'LOSS';
    else if (bet.pickSide === 'HOME') result = homeScore > awayScore ? 'WIN' : 'LOSS';
  }

  console.log(`[OUTPUT] betId=${bet.id} result=${result} score=${awayScore}-${homeScore}`);

  if (result !== 'PENDING') {
    await conn.query(
      'UPDATE tracked_bets SET result=?, awayScore=?, homeScore=? WHERE id=?',
      [result, String(awayScore), String(homeScore), bet.id]
    );
    console.log(`[VERIFY] PASS — betId=${bet.id} updated to ${result} ${awayScore}-${homeScore}`);
  }
}

await conn.end();
console.log('\n[DONE] All PENDING MLB bets processed');

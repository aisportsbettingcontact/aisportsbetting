/**
 * diagnose-bets.mjs
 * Inspect tracked_bets for missing awayTeam/homeTeam/awayScore/homeScore
 * Run: node scripts/diagnose-bets.mjs
 */
import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }

const conn = await createConnection(url);

const [rows] = await conn.execute(
  'SELECT id, sport, gameDate, awayTeam, homeTeam, pick, pickSide, result, awayScore, homeScore, anGameId FROM tracked_bets ORDER BY gameDate DESC'
);

console.log(`[DIAGNOSE] Total bets: ${rows.length}`);
console.log('');

let missingTeamCount = 0;
let missingScoreCount = 0;
let okCount = 0;

for (const r of rows) {
  const hasAway = r.awayTeam && r.awayTeam.trim().length > 0;
  const hasHome = r.homeTeam && r.homeTeam.trim().length > 0;
  const isGraded = r.result !== 'PENDING' && r.result !== 'VOID';
  const hasScore = r.awayScore !== null && r.homeScore !== null;

  if (!hasAway || !hasHome) {
    missingTeamCount++;
    console.log(`[MISSING_TEAM] id=${r.id} date=${r.gameDate} sport=${r.sport} awayTeam="${r.awayTeam}" homeTeam="${r.homeTeam}" pick="${r.pick}" result=${r.result} anGameId=${r.anGameId}`);
  } else if (isGraded && !hasScore) {
    missingScoreCount++;
    console.log(`[MISSING_SCORE] id=${r.id} date=${r.gameDate} sport=${r.sport} ${r.awayTeam}@${r.homeTeam} pick="${r.pick}" result=${r.result} awayScore=${r.awayScore} homeScore=${r.homeScore}`);
  } else {
    okCount++;
    console.log(`[OK] id=${r.id} date=${r.gameDate} sport=${r.sport} ${r.awayTeam}@${r.homeTeam} result=${r.result} score=${r.awayScore}-${r.homeScore}`);
  }
}

console.log('');
console.log(`[SUMMARY] OK=${okCount} MISSING_TEAM=${missingTeamCount} MISSING_SCORE=${missingScoreCount}`);

await conn.end();

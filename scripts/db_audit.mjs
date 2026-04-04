import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n=== [AUDIT] K-Props DB Integrity Check ===\n');

// 1. Column structure
const [cols] = await conn.query('DESCRIBE mlb_strikeout_props');
console.log('[INPUT] mlb_strikeout_props columns (' + cols.length + '):', cols.map(c => c.Field).join(', '));

// 2. Total records
const [[{total}]] = await conn.query('SELECT COUNT(*) as total FROM mlb_strikeout_props');
console.log('[STATE] Total K-Props records:', total);

// 3. Records by game date (via JOIN)
const [byDate] = await conn.query(`
  SELECT g.gameDate, COUNT(*) as cnt 
  FROM mlb_strikeout_props p 
  JOIN games g ON p.gameId = g.id 
  GROUP BY g.gameDate 
  ORDER BY g.gameDate DESC 
  LIMIT 5
`);
console.log('[STATE] Records by gameDate:', JSON.stringify(byDate));

// 4. MLBAM ID coverage
const [[mlbamStats]] = await conn.query(`
  SELECT 
    SUM(mlbamId IS NOT NULL) as withMlbam, 
    SUM(mlbamId IS NULL) as withoutMlbam,
    COUNT(DISTINCT pitcherName) as uniquePitchers
  FROM mlb_strikeout_props
`);
console.log('[STATE] MLBAM IDs: with=' + mlbamStats.withMlbam + ' without=' + mlbamStats.withoutMlbam + ' uniquePitchers=' + mlbamStats.uniquePitchers);

// 5. Backtest results for April 3
const [backtestRows] = await conn.query(`
  SELECT p.pitcherName, p.side, p.kProj, p.kLine, p.bookLine, p.actualKs, p.backtestResult, p.modelCorrect, p.modelError, p.mlbamId
  FROM mlb_strikeout_props p 
  JOIN games g ON p.gameId = g.id 
  WHERE g.gameDate = '2026-04-03'
  ORDER BY p.pitcherName, p.side
`);
console.log('\n[STATE] April 3 K-Props backtest (' + backtestRows.length + ' rows):');
let completed = 0, correct = 0, pending = 0;
backtestRows.forEach(r => {
  const status = r.backtestResult ? r.backtestResult : 'PENDING';
  if (r.backtestResult) completed++;
  if (r.modelCorrect === 1) correct++;
  if (!r.backtestResult) pending++;
  const mlbamFlag = r.mlbamId ? '✓' : '✗';
  console.log(`  [ROW] ${r.pitcherName} (${r.side}) kProj=${r.kProj} kLine=${r.kLine} bookLine=${r.bookLine} actual=${r.actualKs ?? 'null'} result=${status} correct=${r.modelCorrect ?? 'null'} err=${r.modelError ?? 'null'} mlbam=${mlbamFlag}${r.mlbamId}`);
});
console.log(`\n[VERIFY] Completed: ${completed}/${backtestRows.length} | Correct: ${correct}/${completed} | Pending: ${pending}`);

// 6. Check for NULL kProj (model didn't run)
const [[{nullKproj}]] = await conn.query(`
  SELECT COUNT(*) as nullKproj FROM mlb_strikeout_props WHERE kProj IS NULL OR kProj = ''
`);
console.log('\n[VERIFY] Records with NULL/empty kProj:', nullKproj);

// 7. Check for duplicate pitcher/game combos
const [dupes] = await conn.query(`
  SELECT gameId, pitcherName, side, COUNT(*) as cnt 
  FROM mlb_strikeout_props 
  GROUP BY gameId, pitcherName, side 
  HAVING cnt > 1
`);
console.log('[VERIFY] Duplicate pitcher/game combos:', dupes.length === 0 ? 'NONE (clean)' : JSON.stringify(dupes));

// 8. Check games table for April 3 MLB games
const [aprilGames] = await conn.query(`
  SELECT id, awayTeam, homeTeam, startTimeEst, finalScore, gameStatus
  FROM games 
  WHERE gameDate = '2026-04-03' AND sport = 'MLB'
  ORDER BY startTimeEst
`);
console.log('\n[STATE] April 3 MLB games in DB (' + aprilGames.length + '):');
aprilGames.forEach(g => {
  console.log(`  [GAME] id=${g.id} ${g.awayTeam} @ ${g.homeTeam} time=${g.startTimeEst} status=${g.gameStatus ?? 'null'} score=${g.finalScore ?? 'null'}`);
});

await conn.end();
console.log('\n=== [AUDIT] Complete ===\n');

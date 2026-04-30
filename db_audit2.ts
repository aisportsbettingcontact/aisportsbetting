import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  console.log('\n=== [AUDIT 1] mlb_schedule_history LATEST 10 ROWS ===');
  const [rows] = await conn.execute(
    `SELECT anGameId, gameDate, gameStatus, awayAbbr, homeAbbr, awayScore, homeScore 
     FROM mlb_schedule_history ORDER BY gameDate DESC LIMIT 10`
  );
  console.log('[OUTPUT]', JSON.stringify(rows, null, 2));

  console.log('\n=== [AUDIT 2] gameStatus DISTRIBUTION ===');
  const [dist] = await conn.execute(
    `SELECT gameStatus, COUNT(*) as cnt FROM mlb_schedule_history GROUP BY gameStatus ORDER BY cnt DESC`
  );
  console.log('[OUTPUT]', JSON.stringify(dist, null, 2));

  console.log('\n=== [AUDIT 3] gameStatus SINCE 4/10 ===');
  const [since410] = await conn.execute(
    `SELECT gameStatus, COUNT(*) as cnt FROM mlb_schedule_history WHERE gameDate >= '2026-04-10' GROUP BY gameStatus`
  );
  console.log('[OUTPUT]', JSON.stringify(since410, null, 2));

  console.log('\n=== [AUDIT 4] MOST RECENT FINAL GAMES ===');
  const [finalGames] = await conn.execute(
    `SELECT anGameId, gameDate, gameStatus, awayAbbr, homeAbbr, awayScore, homeScore 
     FROM mlb_schedule_history WHERE gameStatus='final' OR gameStatus='Final' OR gameStatus='completed' 
     ORDER BY gameDate DESC LIMIT 8`
  );
  console.log('[OUTPUT]', JSON.stringify(finalGames, null, 2));

  console.log('\n=== [AUDIT 5] WHAT DOES getLastNGamesForTeam QUERY BY? ===');
  // Check what anSlug value is stored in mlb_schedule_history for NYM
  const [nymGames] = await conn.execute(
    `SELECT anGameId, gameDate, gameStatus, awaySlug, homeSlug, awayAbbr, homeAbbr, awayScore, homeScore 
     FROM mlb_schedule_history WHERE awayAbbr='NYM' OR homeAbbr='NYM' ORDER BY gameDate DESC LIMIT 5`
  );
  console.log('[OUTPUT] NYM games in schedule history:', JSON.stringify(nymGames, null, 2));

  console.log('\n=== [AUDIT 6] BETTING SPLITS COLUMNS ===');
  const [splitsCols] = await conn.execute(`DESCRIBE betting_splits`);
  console.log('[OUTPUT]', JSON.stringify(splitsCols, null, 2));

  console.log('\n=== [AUDIT 7] GAMES TABLE — awayColor/homeColor columns ===');
  const [gamesCols] = await conn.execute(`DESCRIBE games`);
  // Just show color-related columns
  const allCols = gamesCols as any[];
  const colorCols = allCols.filter(c => c.Field.toLowerCase().includes('color') || c.Field.toLowerCase().includes('hex'));
  console.log('[OUTPUT] Color columns in games:', JSON.stringify(colorCols, null, 2));
  console.log('[OUTPUT] All games columns:', allCols.map((c: any) => c.Field).join(', '));

  await conn.end();
}
main().catch(console.error);

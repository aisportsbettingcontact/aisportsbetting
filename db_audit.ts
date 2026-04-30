import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  console.log('\n=== [AUDIT 1] mlb_schedule_history COLUMNS ===');
  const [schCols] = await conn.execute(`DESCRIBE mlb_schedule_history`);
  console.log('[OUTPUT]', JSON.stringify(schCols, null, 2));

  console.log('\n=== [AUDIT 2] mlb_schedule_history LATEST 5 ROWS ===');
  const [latestSch] = await conn.execute(
    `SELECT * FROM mlb_schedule_history ORDER BY gameDate DESC LIMIT 5`
  );
  console.log('[OUTPUT] Latest rows:', JSON.stringify(latestSch, null, 2));

  console.log('\n=== [AUDIT 3] GAMES TABLE COLUMNS ===');
  const [gamesCols] = await conn.execute(`DESCRIBE games`);
  console.log('[OUTPUT] games columns:', JSON.stringify(gamesCols, null, 2));

  console.log('\n=== [AUDIT 4] BETTING SPLITS COLUMNS ===');
  const [splitsCols] = await conn.execute(`DESCRIBE betting_splits`);
  console.log('[OUTPUT] betting_splits columns:', JSON.stringify(splitsCols, null, 2));

  await conn.end();
}
main().catch(console.error);

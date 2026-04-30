require('./node_modules/dotenv/config');
const mysql = require('./node_modules/mysql2/promise');

const dbUrl = process.env.DATABASE_URL;
console.log('[TEST] DATABASE_URL present:', !!dbUrl);
if (dbUrl) console.log('[TEST] URL prefix:', dbUrl.slice(0, 40) + '...');

async function test() {
  try {
    const pool = mysql.createPool({ uri: dbUrl, connectionLimit: 1, connectTimeout: 15000 });
    console.log('[TEST] Pool created');
    const [rows] = await pool.query('SELECT 1 as ok');
    console.log('[TEST] SELECT 1 result:', rows[0]);
    const [games] = await pool.query("SELECT COUNT(*) as n FROM games WHERE sport='MLB' AND gameStatus='final'");
    console.log('[TEST] MLB final games count:', games[0]);
    const [bt] = await pool.query("SELECT result, COUNT(*) as n FROM mlb_game_backtest GROUP BY result ORDER BY n DESC");
    console.log('[TEST] Backtest results:', JSON.stringify(bt));
    await pool.end();
    console.log('[TEST] PASS');
  } catch(e) {
    console.error('[TEST] FAIL:', e.message);
  }
}
test();

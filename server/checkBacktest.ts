/**
 * checkBacktest.ts
 * Check mlb_game_backtest for modelPNrfi data availability.
 * Run: pnpm tsx server/checkBacktest.ts
 */
import { getDb } from './db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  // Check mlb_game_backtest columns
  const [cols] = await db.execute(sql`DESCRIBE mlb_game_backtest`);
  console.log('[COLUMNS] mlb_game_backtest:');
  (cols as any[]).forEach((r: any) => console.log(`  ${r.Field} | ${r.Type}`));

  // Count NRFI market rows (market = 'NRFI')
  const [cnt] = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN market = 'NRFI' THEN 1 ELSE 0 END) as nrfi_rows,
      SUM(CASE WHEN market = 'NRFI' AND result IS NOT NULL AND result != 'PENDING' THEN 1 ELSE 0 END) as nrfi_settled,
      MIN(gameDate) as earliest,
      MAX(gameDate) as latest
    FROM mlb_game_backtest
  `);
  const c = (cnt as any[])[0];
  console.log(`\n[COUNT] total=${c.total} nrfi_rows=${c.nrfi_rows} nrfi_settled=${c.nrfi_settled}`);
  console.log(`[RANGE] ${c.earliest} → ${c.latest}`);

  // Sample NRFI rows
  const [sample] = await db.execute(sql`
    SELECT gameDate, market, modelSide, modelProb, bookOdds, result, correct, awayPitcher, homePitcher
    FROM mlb_game_backtest 
    WHERE market = 'NRFI' AND result IS NOT NULL AND result != 'PENDING'
    ORDER BY gameDate DESC
    LIMIT 5
  `);
  console.log('\n[SAMPLE] Recent NRFI backtest rows:');
  (sample as any[]).forEach((r: any) => console.log(
    `  ${r.gameDate} | modelProb=${r.modelProb} | side=${r.modelSide} | odds=${r.bookOdds} | result=${r.result} | correct=${r.correct}`
  ));

  // Distribution of modelProb for NRFI market
  const [dist] = await db.execute(sql`
    SELECT 
      ROUND(CAST(modelProb AS DECIMAL) * 10) / 10 as bucket,
      COUNT(*) as n,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as wins
    FROM mlb_game_backtest
    WHERE market = 'NRFI' AND result IS NOT NULL AND result != 'PENDING'
    GROUP BY bucket
    ORDER BY bucket
  `);
  console.log('\n[DIST] modelProb distribution for NRFI market:');
  (dist as any[]).forEach((r: any) => {
    const wr = r.n > 0 ? (r.wins / r.n * 100).toFixed(1) : 'N/A';
    console.log(`  ${r.bucket?.toFixed(1)}: ${r.n} games | win%=${wr}`);
  });

  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });

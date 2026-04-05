const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('[INPUT] Fixing id:2250117 — CHC@CLE G2 stale record');
  console.log('[STATE] Current: gameDate=2026-04-04, gameNumber=1, doubleHeader=N, pitchers=Imanaga vs Cecconi, total=8.0, ml=-143');
  console.log('[STEP] Updating to: gameDate=2026-04-05, gameNumber=2, doubleHeader=Y, pitchers=Imanaga vs Messick, total=7.5, ml=-124');
  
  await conn.execute(`
    UPDATE games SET
      gameDate = '2026-04-05',
      startTimeEst = '1:45 PM ET',
      gameNumber = 2,
      doubleHeader = 'Y',
      awayStartingPitcher = 'Shota Imanaga',
      homeStartingPitcher = 'Parker Messick',
      awayPitcherConfirmed = 1,
      homePitcherConfirmed = 1,
      awayBookSpread = '-1.5',
      homeBookSpread = '1.5',
      awaySpreadOdds = '-110',
      homeSpreadOdds = '-110',
      bookTotal = '7.5',
      overOdds = '-110',
      underOdds = '-110',
      awayML = '-124',
      homeML = '+109',
      awayRunLine = '-1.5',
      homeRunLine = '1.5',
      awayRunLineOdds = '+160',
      homeRunLineOdds = '-160',
      spreadAwayBetsPct = 85,
      spreadAwayMoneyPct = 51,
      totalOverBetsPct = 43,
      totalOverMoneyPct = 54,
      mlAwayBetsPct = 59,
      mlAwayMoneyPct = 63,
      gameStatus = 'upcoming',
      modelRunAt = NULL,
      publishedModel = 0,
      publishedToFeed = 0
    WHERE id = 2250117
  `);
  console.log('[OUTPUT] id:2250117 updated successfully');
  
  // Check CHC@CLE G1 state
  const [g1] = await conn.execute('SELECT id, awayStartingPitcher, homeStartingPitcher, modelRunAt FROM games WHERE id=2250125');
  if (g1.length > 0) {
    console.log('[INPUT] CHC@CLE G1 (id:2250125): pitchers=' + g1[0].awayStartingPitcher + ' vs ' + g1[0].homeStartingPitcher + ' | modeled=' + (g1[0].modelRunAt ? 'YES' : 'NO'));
  }
  
  // Final verification of both G1 and G2
  const [both] = await conn.execute(`
    SELECT id, awayTeam, homeTeam, gameDate, gameNumber, doubleHeader, mlbGamePk,
           awayStartingPitcher, homeStartingPitcher,
           awayBookSpread, bookTotal, awayML,
           spreadAwayBetsPct, totalOverBetsPct, mlAwayBetsPct,
           gameStatus, modelRunAt
    FROM games
    WHERE mlbGamePk IN (824459, 824460)
    ORDER BY gameNumber
  `);
  console.log('[VERIFY] CHC@CLE doubleheader games:');
  for (const g of both) {
    console.log('  [' + g.id + '] G' + g.gameNumber + ' | Date:' + g.gameDate + ' | DH:' + g.doubleHeader + ' | PK:' + g.mlbGamePk);
    console.log('         Pitchers: ' + g.awayStartingPitcher + ' vs ' + g.homeStartingPitcher);
    console.log('         Spread:' + g.awayBookSpread + ' | Total:' + g.bookTotal + ' | ML:' + g.awayML);
    console.log('         Splits: SPR=' + g.spreadAwayBetsPct + '% | TOT=' + g.totalOverBetsPct + '% | ML=' + g.mlAwayBetsPct + '%');
    console.log('         Modeled:' + (g.modelRunAt ? 'YES' : 'NO'));
  }
  
  // Count total April 5 MLB games
  const [cnt] = await conn.execute("SELECT COUNT(*) as cnt FROM games WHERE gameDate='2026-04-05' AND sport='MLB'");
  console.log('[VERIFY] Total MLB games for 2026-04-05:', cnt[0].cnt);
  
  await conn.end();
  console.log('[PIPELINE] CHC@CLE G2 fix COMPLETE.');
}

run().catch(e => { console.error('[FATAL]', e.message, e.sqlMessage || ''); process.exit(1); });

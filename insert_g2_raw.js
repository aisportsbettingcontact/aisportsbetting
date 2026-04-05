const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('[INPUT] Checking for CHC@CLE G2 (PK:824460)...');
  const [existing] = await conn.execute('SELECT id FROM games WHERE mlbGamePk=824460');
  if (existing.length > 0) {
    console.log('[SKIP] CHC@CLE G2 already exists with id:', existing[0].id);
    await conn.end();
    return;
  }

  // Fix SD@BOS pitchers (Walker Buehler vs Ranger Suarez per MLB API)
  const [sdBos] = await conn.execute('SELECT id, awayStartingPitcher, homeStartingPitcher FROM games WHERE mlbGamePk=824781');
  if (sdBos.length > 0) {
    const g = sdBos[0];
    console.log('[INPUT] SD@BOS current pitchers:', g.awayStartingPitcher, 'vs', g.homeStartingPitcher);
    if (g.awayStartingPitcher !== 'Walker Buehler' || g.homeStartingPitcher !== 'Ranger Suarez') {
      await conn.execute(
        'UPDATE games SET awayStartingPitcher=?, homeStartingPitcher=?, awayPitcherConfirmed=1, homePitcherConfirmed=1, modelRunAt=NULL WHERE id=?',
        ['Walker Buehler', 'Ranger Suarez', g.id]
      );
      console.log('[STEP] SD@BOS pitchers corrected: Walker Buehler vs Ranger Suarez');
      console.log('[STATE] modelRunAt cleared for SD@BOS id=' + g.id + ' — model must re-run');
    } else {
      console.log('[OK] SD@BOS pitchers already correct');
    }
  }

  // Insert CHC@CLE Game 2
  console.log('[STEP] Inserting CHC@CLE Game 2 (PK:824460)...');
  console.log('[STATE] Pitchers: Shota Imanaga (CHC) vs Parker Messick (CLE)');
  console.log('[STATE] Odds: Spread -1.5 | Total 7.5 | ML -124/+109');
  console.log('[STATE] VSiN Splits: Spread 85%/51% | Total 43%/54% | ML 59%/63%');

  const [result] = await conn.execute(`
    INSERT INTO games (
      fileId, gameDate, startTimeEst, awayTeam, homeTeam, sport, gameType,
      doubleHeader, gameNumber, mlbGamePk, venue,
      awayStartingPitcher, homeStartingPitcher, awayPitcherConfirmed, homePitcherConfirmed,
      awayBookSpread, homeBookSpread, awaySpreadOdds, homeSpreadOdds,
      bookTotal, overOdds, underOdds,
      awayML, homeML,
      awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
      spreadAwayBetsPct, spreadAwayMoneyPct,
      totalOverBetsPct, totalOverMoneyPct,
      mlAwayBetsPct, mlAwayMoneyPct,
      gameStatus, publishedToFeed, publishedModel
    ) VALUES (
      0, '2026-04-05', '1:45 PM ET', 'CHC', 'CLE', 'MLB', 'regular',
      'Y', 2, 824460, 'Progressive Field',
      'Shota Imanaga', 'Parker Messick', 1, 1,
      '-1.5', '1.5', '-110', '-110',
      '7.5', '-110', '-110',
      '-124', '+109',
      '-1.5', '1.5', '+160', '-160',
      85, 51,
      43, 54,
      59, 63,
      'upcoming', 0, 0
    )
  `);
  console.log('[OUTPUT] CHC@CLE G2 inserted with id:', result.insertId);

  // Final verification
  const [g2] = await conn.execute(
    'SELECT id, awayTeam, homeTeam, gameNumber, doubleHeader, mlbGamePk, awayStartingPitcher, homeStartingPitcher, awayBookSpread, bookTotal, awayML, gameStatus FROM games WHERE mlbGamePk=824460'
  );
  console.log('[VERIFY] G2 record confirmed:', JSON.stringify(g2[0], null, 2));

  // Count total MLB games for April 5
  const [total] = await conn.execute("SELECT COUNT(*) as cnt FROM games WHERE gameDate='2026-04-05' AND sport='MLB'");
  console.log('[VERIFY] Total MLB games for 2026-04-05:', total[0].cnt);
  
  await conn.end();
  console.log('[PIPELINE] Insert G2 + Pitcher Fix COMPLETE.');
}

run().catch(e => { console.error('[FATAL]', e.message, e.sqlMessage || ''); process.exit(1); });

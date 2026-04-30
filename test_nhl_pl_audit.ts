/**
 * test_nhl_pl_audit.ts
 * Audit NHL puck line signs in DB for April 16 games.
 * Verifies modelAwayPuckLine sign matches odds-authoritative direction.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute(`
    SELECT awayTeam, homeTeam,
      CAST(awayBookSpread AS CHAR) as awayBookSpread,
      awaySpreadOdds, homeSpreadOdds,
      modelAwayPuckLine, modelHomePuckLine,
      modelAwayPLOdds, modelHomePLOdds
    FROM games WHERE sport='NHL' AND gameDate='2026-04-16' ORDER BY sortOrder
  `) as any[];

  let allOk = true;
  for (const r of rows as any[]) {
    const awayOdds = r.awaySpreadOdds ? parseInt(String(r.awaySpreadOdds), 10) : NaN;
    // Odds-authoritative: dog odds (+) → +1.5, fav odds (-) → -1.5
    const correctSign = (!isNaN(awayOdds) && awayOdds !== 0) ? (awayOdds > 0 ? 1 : -1) : null;
    const modelPLNum = r.modelAwayPuckLine ? parseFloat(String(r.modelAwayPuckLine)) : NaN;
    const modelSign = !isNaN(modelPLNum) ? (modelPLNum > 0 ? 1 : -1) : null;
    const bookSpreadNum = r.awayBookSpread ? parseFloat(String(r.awayBookSpread)) : NaN;
    const bookSign = !isNaN(bookSpreadNum) ? (bookSpreadNum > 0 ? 1 : -1) : null;

    const modelMatchesOdds = (correctSign !== null && modelSign !== null) ? (modelSign === correctSign) : true;
    const bookMatchesOdds  = (correctSign !== null && bookSign  !== null) ? (bookSign  === correctSign) : true;
    const status = modelMatchesOdds ? 'OK' : 'FAIL';
    if (!modelMatchesOdds) allOk = false;

    console.log(`[${status}] ${r.awayTeam}@${r.homeTeam}` +
      ` | awayOdds=${awayOdds} correctSign=${correctSign}` +
      ` | bookSpread=${r.awayBookSpread}(sign=${bookSign}) bookMatchesOdds=${bookMatchesOdds}` +
      ` | modelPL=${r.modelAwayPuckLine}(sign=${modelSign}) modelMatchesOdds=${modelMatchesOdds}` +
      ` | modelPLOdds=${r.modelAwayPLOdds}`);
  }
  console.log(`\n[SUMMARY] All NHL PL signs correct=${allOk} | Total=${(rows as any[]).length} games`);
  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error('[FAIL]', e); process.exit(1); });

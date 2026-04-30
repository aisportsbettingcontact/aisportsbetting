import mysql from 'mysql2/promise';

async function main() {
  const db_url = process.env.DATABASE_URL;
  if (!db_url) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }
  
  const conn = await mysql.createConnection(db_url);
  const [rows] = await conn.query(
    `SELECT awayTeam, homeTeam, awayML, homeML, 
            awayBookSpread, awaySpreadOdds, homeBookSpread, homeSpreadOdds,
            modelAwayScore, modelHomeScore, modelAwayML, modelHomeML,
            modelAwayPuckLine, modelAwayPLOdds, modelHomePuckLine, modelHomePLOdds,
            modelAwayPLCoverPct, modelHomePLCoverPct
     FROM games 
     WHERE sport='NHL' AND DATE(startTimeEst)='2026-04-16'
     ORDER BY startTimeEst`
  ) as any[];

  console.log('\n=== NHL April 16 — PURE MODEL RESULTS (market blend removed) ===\n');
  let allPass = true;

  for (const r of rows as any[]) {
    const pa = parseFloat(r.modelAwayScore || 0);
    const ph = parseFloat(r.modelHomeScore || 0);
    const ac = parseFloat(r.modelAwayPLCoverPct || 0);
    const hc = parseFloat(r.modelHomePLCoverPct || 0);
    const maPL = r.modelAwayPLOdds ? parseInt(r.modelAwayPLOdds) : null;
    const mhPL = r.modelHomePLOdds ? parseInt(r.modelHomePLOdds) : null;
    
    const modelFavIsHome = ph > pa;
    const modelPLFavIsHome = mhPL !== null && maPL !== null && mhPL < maPL;
    const consistent = modelFavIsHome === modelPLFavIsHome;
    const pctOk = Math.abs(ac + hc - 100) < 2;
    
    if (!consistent || !pctOk) allPass = false;
    
    const status = (consistent && pctOk) ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | ${r.awayTeam}@${r.homeTeam}`);
    console.log(`   Proj:     ${pa.toFixed(4)} / ${ph.toFixed(4)}  (diff=${(ph-pa).toFixed(4)}, ${ph > pa ? r.homeTeam : r.awayTeam} leads)`);
    console.log(`   Book ML:  ${r.awayML} / ${r.homeML}`);
    console.log(`   Book PL:  ${r.awayBookSpread}(${r.awaySpreadOdds}) / ${r.homeBookSpread}(${r.homeSpreadOdds})`);
    console.log(`   Model ML: ${r.modelAwayML} / ${r.modelHomeML}`);
    console.log(`   Model PL: ${r.modelAwayPuckLine}(${r.modelAwayPLOdds}) / ${r.modelHomePuckLine}(${r.modelHomePLOdds})`);
    console.log(`   Cover%:   away=${ac.toFixed(2)}%  home=${hc.toFixed(2)}%  sum=${(ac+hc).toFixed(2)}% ${pctOk ? '✅' : '❌'}`);
    console.log(`   Consistency: ${consistent ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log('');
  }

  console.log(`=== OVERALL: ${allPass ? 'ALL 6 GAMES PASS ✅' : 'FAILURES DETECTED ❌'} ===\n`);
  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });

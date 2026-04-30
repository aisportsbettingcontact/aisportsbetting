import mysql from 'mysql2/promise';

const pool = mysql.createPool(process.env.DATABASE_URL);

const [cols] = await pool.query(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN modelF5HomeRLCoverPct IS NOT NULL THEN 1 ELSE 0 END) as f5_rl_home_pop,
    SUM(CASE WHEN modelF5AwayRLCoverPct IS NOT NULL THEN 1 ELSE 0 END) as f5_rl_away_pop,
    SUM(CASE WHEN modelHomePLCoverPct IS NOT NULL THEN 1 ELSE 0 END) as fg_rl_home_pop,
    SUM(CASE WHEN modelAwayPLCoverPct IS NOT NULL THEN 1 ELSE 0 END) as fg_rl_away_pop,
    SUM(CASE WHEN modelAwayWinPct IS NOT NULL THEN 1 ELSE 0 END) as fg_ml_away_pop,
    SUM(CASE WHEN modelF5AwayWinPct IS NOT NULL THEN 1 ELSE 0 END) as f5_ml_away_pop,
    SUM(CASE WHEN homeRunLineOdds IS NOT NULL THEN 1 ELSE 0 END) as fg_rl_odds_pop,
    SUM(CASE WHEN f5HomeRunLineOdds IS NOT NULL THEN 1 ELSE 0 END) as f5_rl_odds_pop,
    SUM(CASE WHEN awayML IS NOT NULL THEN 1 ELSE 0 END) as away_ml_odds_pop,
    ROUND(AVG(CASE WHEN modelF5HomeRLCoverPct IS NOT NULL THEN CAST(modelF5HomeRLCoverPct AS DECIMAL(10,4)) END),4) as avg_f5_rl_home,
    ROUND(AVG(CASE WHEN modelHomePLCoverPct IS NOT NULL THEN CAST(modelHomePLCoverPct AS DECIMAL(10,4)) END),4) as avg_fg_rl_home,
    ROUND(AVG(CASE WHEN modelAwayWinPct IS NOT NULL THEN CAST(modelAwayWinPct AS DECIMAL(10,4)) END),4) as avg_fg_ml_away,
    ROUND(AVG(CASE WHEN modelF5AwayWinPct IS NOT NULL THEN CAST(modelF5AwayWinPct AS DECIMAL(10,4)) END),4) as avg_f5_ml_away
  FROM games
  WHERE gameStatus = 'Final'
    AND gameDate >= '2026-03-26'
`);
console.log('[POPULATION CHECK]');
console.log(JSON.stringify(cols[0], null, 2));

// Sample rows with RL data
const [sample] = await pool.query(`
  SELECT id, gameDate,
    modelF5HomeRLCoverPct, modelF5AwayRLCoverPct,
    modelHomePLCoverPct, modelAwayPLCoverPct,
    modelAwayWinPct, modelF5AwayWinPct,
    homeRunLineOdds, awayRunLineOdds,
    f5HomeRunLineOdds, f5AwayRunLineOdds,
    awayML
  FROM games
  WHERE gameStatus = 'Final'
    AND gameDate >= '2026-03-26'
    AND modelF5HomeRLCoverPct IS NOT NULL
  LIMIT 5
`);
console.log('\n[SAMPLE ROWS WITH F5 RL DATA]');
sample.forEach(r => console.log(JSON.stringify(r)));

// Check edge distribution for away ML
const [edgeDist] = await pool.query(`
  SELECT 
    ROUND((CAST(modelAwayWinPct AS DECIMAL(10,4))/100 - 
           (ABS(CAST(awayML AS DECIMAL(10,0))) / (ABS(CAST(awayML AS DECIMAL(10,0))) + 100))), 3) as edge_bucket,
    COUNT(*) as n
  FROM games
  WHERE gameStatus = 'Final'
    AND gameDate >= '2026-03-26'
    AND modelAwayWinPct IS NOT NULL
    AND awayML IS NOT NULL
    AND awayML < 0
  GROUP BY edge_bucket
  ORDER BY edge_bucket DESC
  LIMIT 20
`);
console.log('\n[AWAY ML EDGE DISTRIBUTION (favorite away teams)]');
edgeDist.forEach(r => console.log(JSON.stringify(r)));

await pool.end();

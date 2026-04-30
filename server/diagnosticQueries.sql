-- ═══════════════════════════════════════════════════════════════════════════
-- MLB BACKTEST DIAGNOSTIC QUERIES
-- Run these after the full re-backtest completes to grade all markets.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Overall backtest summary ──────────────────────────────────────────────
SELECT
  result,
  COUNT(*) AS n,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM mlb_game_backtest
GROUP BY result
ORDER BY n DESC;

-- ── 2. Market-by-market WIN/LOSS breakdown ───────────────────────────────────
SELECT
  market,
  COUNT(*) AS total,
  SUM(result = 'WIN')       AS wins,
  SUM(result = 'LOSS')      AS losses,
  SUM(result = 'NO_ACTION') AS no_action,
  SUM(result = 'PUSH')      AS pushes,
  SUM(result = 'MISSING_DATA') AS missing,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN edge END), 4) AS avg_edge,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN ev END), 4) AS avg_ev,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN modelProb END), 4) AS avg_model_prob
FROM mlb_game_backtest
GROUP BY market
ORDER BY win_pct DESC;

-- ── 3. K-Props accuracy by direction (OVER vs UNDER) ─────────────────────────
SELECT
  modelSide AS direction,
  COUNT(*) AS n,
  SUM(result = 'WIN') AS wins,
  SUM(result = 'LOSS') AS losses,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN edge END), 4) AS avg_edge
FROM mlb_game_backtest
WHERE market = 'k_prop'
GROUP BY modelSide
ORDER BY n DESC;

-- ── 4. K-Props accuracy by line bucket ───────────────────────────────────────
SELECT
  CASE
    WHEN CAST(bookLine AS DECIMAL(5,1)) <= 3.5 THEN '<=3.5'
    WHEN CAST(bookLine AS DECIMAL(5,1)) <= 4.5 THEN '4.0-4.5'
    WHEN CAST(bookLine AS DECIMAL(5,1)) <= 5.5 THEN '5.0-5.5'
    WHEN CAST(bookLine AS DECIMAL(5,1)) <= 6.5 THEN '6.0-6.5'
    ELSE '>=7.0'
  END AS line_bucket,
  COUNT(*) AS n,
  SUM(result = 'WIN') AS wins,
  SUM(result = 'LOSS') AS losses,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct
FROM mlb_game_backtest
WHERE market = 'k_prop' AND result IN ('WIN','LOSS')
GROUP BY line_bucket
ORDER BY line_bucket;

-- ── 5. HR Props accuracy at 0.25 threshold ───────────────────────────────────
SELECT
  result,
  COUNT(*) AS n,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM mlb_game_backtest
WHERE market = 'hr_prop'
GROUP BY result;

-- ── 6. NRFI/YRFI accuracy ────────────────────────────────────────────────────
SELECT
  market,
  COUNT(*) AS n,
  SUM(result = 'WIN') AS wins,
  SUM(result = 'LOSS') AS losses,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN modelProb END), 4) AS avg_model_prob
FROM mlb_game_backtest
WHERE market IN ('nrfi', 'yrfi')
GROUP BY market;

-- ── 7. F5 markets breakdown ───────────────────────────────────────────────────
SELECT
  market,
  COUNT(*) AS total,
  SUM(result = 'WIN') AS wins,
  SUM(result = 'LOSS') AS losses,
  SUM(result = 'NO_ACTION') AS no_action,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN edge END), 4) AS avg_edge
FROM mlb_game_backtest
WHERE market LIKE 'f5_%'
GROUP BY market
ORDER BY market;

-- ── 8. FG ML/RL markets breakdown ────────────────────────────────────────────
SELECT
  market,
  COUNT(*) AS total,
  SUM(result = 'WIN') AS wins,
  SUM(result = 'LOSS') AS losses,
  SUM(result = 'NO_ACTION') AS no_action,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN edge END), 4) AS avg_edge,
  ROUND(AVG(CASE WHEN result IN ('WIN','LOSS') THEN ev END), 4) AS avg_ev
FROM mlb_game_backtest
WHERE market LIKE 'fg_%'
GROUP BY market
ORDER BY market;

-- ── 9. MISSING_DATA root cause analysis ──────────────────────────────────────
SELECT
  market,
  COUNT(*) AS missing_count
FROM mlb_game_backtest
WHERE result = 'MISSING_DATA'
GROUP BY market
ORDER BY missing_count DESC;

-- ── 10. Drift state current values ───────────────────────────────────────────
SELECT
  metric,
  currentValue,
  baselineValue,
  delta,
  direction,
  driftDetected,
  windowSize,
  updatedAt
FROM mlb_drift_state
ORDER BY updatedAt DESC;

-- ── 11. Calibration constants current values ─────────────────────────────────
SELECT
  paramName,
  currentValue,
  baselineValue,
  sampleSize,
  ciLower,
  ciUpper,
  updatedAt
FROM mlb_calibration_constants
ORDER BY paramName;

-- ── 12. Recent drift/learning log entries ────────────────────────────────────
SELECT
  market,
  windowDays,
  accuracyBefore,
  accuracyAfter,
  triggerReason,
  sampleSize,
  paramChanges,
  FROM_UNIXTIME(runAt / 1000) AS runAtLocal
FROM mlb_model_learning_log
ORDER BY runAt DESC
LIMIT 20;

-- ── 13. Rolling 7-day accuracy per market ────────────────────────────────────
SELECT
  market,
  SUM(result = 'WIN') AS wins_7d,
  SUM(result = 'LOSS') AS losses_7d,
  ROUND(SUM(result = 'WIN') * 100.0 / NULLIF(SUM(result IN ('WIN','LOSS')), 0), 1) AS win_pct_7d,
  COUNT(*) AS total_7d
FROM mlb_game_backtest
WHERE backtestRunAt >= UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 7 DAY)) * 1000
GROUP BY market
ORDER BY win_pct_7d DESC;

-- ── 14. K-props calibration metrics from mlb_strikeout_props ─────────────────
SELECT
  COUNT(*) AS total,
  SUM(backtestResult = 'OVER') AS over_wins,
  SUM(backtestResult = 'UNDER') AS under_wins,
  SUM(backtestResult = 'PUSH') AS pushes,
  SUM(backtestResult IS NULL OR backtestResult = 'PENDING') AS pending,
  ROUND(AVG(CASE WHEN backtestResult IS NOT NULL AND backtestResult != 'PENDING'
    THEN ABS(actualKs - kProj) END), 3) AS mae,
  ROUND(AVG(CASE WHEN backtestResult IS NOT NULL AND backtestResult != 'PENDING'
    THEN actualKs - kProj END), 3) AS mean_bias,
  ROUND(SUM(modelCorrect = 1) * 100.0 / NULLIF(SUM(modelCorrect IS NOT NULL), 0), 1) AS model_accuracy
FROM mlb_strikeout_props
WHERE gameDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY);

-- ── 15. K-props OVER accuracy by direction and line ──────────────────────────
SELECT
  modelPrediction,
  CASE
    WHEN bookLine <= 3.5 THEN '<=3.5'
    WHEN bookLine <= 4.5 THEN '4.0-4.5'
    WHEN bookLine <= 5.5 THEN '5.0-5.5'
    WHEN bookLine <= 6.5 THEN '6.0-6.5'
    ELSE '>=7.0'
  END AS line_bucket,
  COUNT(*) AS n,
  SUM(modelCorrect = 1) AS correct,
  ROUND(SUM(modelCorrect = 1) * 100.0 / NULLIF(COUNT(*), 0), 1) AS accuracy
FROM mlb_strikeout_props
WHERE modelCorrect IS NOT NULL
  AND gameDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY modelPrediction, line_bucket
ORDER BY modelPrediction, line_bucket;

/**
 * audit_trends.mjs — TRENDS Table Deep Audit
 *
 * Column names are camelCase as defined in drizzle/schema.ts:
 *   gameDate, gameStatus, awaySlug, homeSlug, awayAbbr, homeAbbr,
 *   awayScore, homeScore, awayWon, awayRunLineCovered, homeRunLineCovered,
 *   totalResult, dkAwayML, dkHomeML, dkAwayRunLine, dkHomeRunLine, dkTotal
 *
 * Run: node scripts/audit_trends.mjs
 */

import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load DATABASE_URL from environment (injected by the dev server)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[AUDIT][FATAL] DATABASE_URL not set in environment');
  process.exit(1);
}

console.log('[AUDIT][INIT] Connecting to database...');
const conn = await createConnection(DATABASE_URL);
console.log('[AUDIT][INIT] Connected.\n');

const SEASON_START = '2026-03-26';

// ─── Step 1: Overall 2026 stats ───────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 1] Overall 2026 MLB season stats');
console.log('═══════════════════════════════════════════════════════════════');

const [totals] = await conn.query(`
  SELECT 
    COUNT(*) as total_games,
    SUM(CASE WHEN gameStatus='complete' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN gameStatus='scheduled' THEN 1 ELSE 0 END) as scheduled,
    SUM(CASE WHEN gameStatus='inprogress' THEN 1 ELSE 0 END) as inprogress,
    SUM(CASE WHEN gameStatus='postponed' THEN 1 ELSE 0 END) as postponed,
    MIN(gameDate) as earliest,
    MAX(gameDate) as latest
  FROM mlb_schedule_history
  WHERE gameDate >= ?
`, [SEASON_START]);

const t = totals[0];
console.log(`  Total games:    ${t.total_games}`);
console.log(`  Completed:      ${t.completed}`);
console.log(`  Scheduled:      ${t.scheduled}`);
console.log(`  In-progress:    ${t.inprogress}`);
console.log(`  Postponed:      ${t.postponed}`);
console.log(`  Date range:     ${t.earliest} → ${t.latest}\n`);

// ─── Step 2: All distinct team slugs ─────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 2] All distinct team slugs in 2026 data');
console.log('═══════════════════════════════════════════════════════════════');

const [slugRows] = await conn.query(`
  SELECT DISTINCT awaySlug as slug FROM mlb_schedule_history WHERE gameDate >= ?
  UNION
  SELECT DISTINCT homeSlug as slug FROM mlb_schedule_history WHERE gameDate >= ?
  ORDER BY slug
`, [SEASON_START, SEASON_START]);

const slugs = slugRows.map(r => r.slug);
console.log(`  Total distinct slugs: ${slugs.length}`);
for (const s of slugs) console.log(`    ${s}`);
console.log('');

// ─── Step 3: Per-team data coverage ──────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 3] Per-team data coverage (2026 season, completed games)');
console.log('═══════════════════════════════════════════════════════════════');

const [teamCoverage] = await conn.query(`
  SELECT 
    t.slug,
    COUNT(*) as total_games,
    SUM(CASE WHEN h.gameStatus='complete' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN h.gameStatus='complete' AND h.awayWon IS NOT NULL THEN 1 ELSE 0 END) as has_result,
    SUM(CASE WHEN h.gameStatus='complete' AND h.dkAwayML IS NOT NULL THEN 1 ELSE 0 END) as has_ml,
    SUM(CASE WHEN h.gameStatus='complete' AND h.awayRunLineCovered IS NOT NULL THEN 1 ELSE 0 END) as has_rl,
    SUM(CASE WHEN h.gameStatus='complete' AND h.totalResult IS NOT NULL THEN 1 ELSE 0 END) as has_total,
    SUM(CASE WHEN h.gameStatus='complete' AND h.awayWon IS NULL THEN 1 ELSE 0 END) as missing_result,
    SUM(CASE WHEN h.gameStatus='complete' AND h.dkAwayML IS NULL THEN 1 ELSE 0 END) as missing_ml,
    SUM(CASE WHEN h.gameStatus='complete' AND h.awayRunLineCovered IS NULL THEN 1 ELSE 0 END) as missing_rl,
    SUM(CASE WHEN h.gameStatus='complete' AND h.totalResult IS NULL THEN 1 ELSE 0 END) as missing_total
  FROM mlb_schedule_history h
  JOIN (
    SELECT DISTINCT awaySlug as slug FROM mlb_schedule_history WHERE gameDate >= ?
    UNION
    SELECT DISTINCT homeSlug as slug FROM mlb_schedule_history WHERE gameDate >= ?
  ) t ON h.awaySlug = t.slug OR h.homeSlug = t.slug
  WHERE h.gameDate >= ?
  GROUP BY t.slug
  ORDER BY t.slug
`, [SEASON_START, SEASON_START, SEASON_START]);

const dataIssues = [];
console.log(`  ${'SLUG'.padEnd(35)} ${'TOT'.padStart(4)} ${'COMP'.padStart(5)} ${'ML'.padStart(4)} ${'RL'.padStart(4)} ${'TOT'.padStart(4)} FLAGS`);
console.log(`  ${'─'.repeat(35)} ${'─'.repeat(4)} ${'─'.repeat(5)} ${'─'.repeat(4)} ${'─'.repeat(4)} ${'─'.repeat(4)} ${'─'.repeat(30)}`);

for (const row of teamCoverage) {
  const flags = [];
  if (row.completed === 0) flags.push('NO_COMPLETED_GAMES');
  if (row.missing_result > 0) flags.push(`MISSING_RESULT(${row.missing_result})`);
  if (row.missing_ml > 0) flags.push(`MISSING_ML(${row.missing_ml})`);
  if (row.missing_rl > 0) flags.push(`MISSING_RL(${row.missing_rl})`);
  if (row.missing_total > 0) flags.push(`MISSING_TOTAL(${row.missing_total})`);

  const flagStr = flags.length > 0 ? `⚠️  ${flags.join(', ')}` : '✅ OK';
  console.log(`  ${row.slug.padEnd(35)} ${String(row.total_games).padStart(4)} ${String(row.completed).padStart(5)} ${String(row.has_ml).padStart(4)} ${String(row.has_rl).padStart(4)} ${String(row.has_total).padStart(4)} ${flagStr}`);

  if (flags.length > 0) {
    dataIssues.push({ slug: row.slug, flags, row });
  }
}

// ─── Step 4: Load all 2026 completed games for simulation ────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 4] Simulate situational stats for all teams');
console.log('═══════════════════════════════════════════════════════════════');

const [allGames] = await conn.query(`
  SELECT 
    id, gameDate, gameStatus,
    awaySlug, homeSlug, awayAbbr, homeAbbr,
    awayScore, homeScore, awayWon,
    awayRunLineCovered, homeRunLineCovered,
    totalResult,
    dkAwayML, dkHomeML,
    dkAwayRunLine, dkHomeRunLine, dkTotal
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
  ORDER BY gameDate DESC
`, [SEASON_START]);

console.log(`  Total completed 2026 games loaded: ${allGames.length}\n`);

function computeSituationalStats(teamSlug, games) {
  const teamGames = games.filter(g => g.awaySlug === teamSlug || g.homeSlug === teamSlug);
  
  const isAway = (g) => g.awaySlug === teamSlug;
  
  const teamWon = (g) => {
    if (g.awayWon == null) return null;
    // awayWon is a Buffer(1) in MySQL boolean — treat as truthy/falsy
    const aw = g.awayWon === true || (Buffer.isBuffer(g.awayWon) && g.awayWon[0] === 1) || g.awayWon === 1;
    return isAway(g) ? aw : !aw;
  };
  
  const teamCovered = (g) => {
    const raw = isAway(g) ? g.awayRunLineCovered : g.homeRunLineCovered;
    if (raw == null) return null;
    return raw === true || (Buffer.isBuffer(raw) && raw[0] === 1) || raw === 1;
  };
  
  const wasFavorite = (g) => {
    const ml = isAway(g) ? g.dkAwayML : g.dkHomeML;
    if (!ml) return false;
    return parseInt(ml, 10) < 0;
  };
  
  const wasHome = (g) => !isAway(g);
  
  const computeRecord = (games, wonFn) => {
    let wins = 0, losses = 0, nulls = 0;
    for (const g of games) {
      const won = wonFn(g);
      if (won === true) wins++;
      else if (won === false) losses++;
      else nulls++;
    }
    return { wins, losses, nulls };
  };
  
  const computeAts = (games) => {
    let wins = 0, losses = 0, nulls = 0;
    for (const g of games) {
      const cov = teamCovered(g);
      if (cov === true) wins++;
      else if (cov === false) losses++;
      else nulls++;
    }
    return { wins, losses, nulls };
  };
  
  const computeOu = (games) => {
    let wins = 0, losses = 0, pushes = 0, nulls = 0;
    for (const g of games) {
      if (g.totalResult === 'OVER') wins++;
      else if (g.totalResult === 'UNDER') losses++;
      else if (g.totalResult === 'PUSH') pushes++;
      else nulls++;
    }
    return { wins, losses, pushes, nulls };
  };
  
  const last10 = teamGames.slice(0, 10);
  const homeGames = teamGames.filter(wasHome);
  const awayGames = teamGames.filter(g => !wasHome(g));
  const favGames = teamGames.filter(wasFavorite);
  const dogGames = teamGames.filter(g => !wasFavorite(g));
  
  return {
    gamesAnalyzed: teamGames.length,
    homeCount: homeGames.length,
    awayCount: awayGames.length,
    favCount: favGames.length,
    dogCount: dogGames.length,
    ml: {
      overall: computeRecord(teamGames, teamWon),
      last10: computeRecord(last10, teamWon),
      home: computeRecord(homeGames, teamWon),
      away: computeRecord(awayGames, teamWon),
      favorite: computeRecord(favGames, teamWon),
      underdog: computeRecord(dogGames, teamWon),
    },
    spread: {
      overall: computeAts(teamGames),
      last10: computeAts(last10),
      home: computeAts(homeGames),
      away: computeAts(awayGames),
      favorite: computeAts(favGames),
      underdog: computeAts(dogGames),
    },
    total: {
      overall: computeOu(teamGames),
      last10: computeOu(last10),
      home: computeOu(homeGames),
      away: computeOu(awayGames),
      favorite: computeOu(favGames),
      underdog: computeOu(dogGames),
    },
  };
}

const statIssues = [];
let passCount = 0;

for (const slug of slugs) {
  const stats = computeSituationalStats(slug, allGames);
  const { gamesAnalyzed, ml, spread, total, homeCount, awayCount, favCount, dogCount } = stats;
  
  const checks = [];
  
  // ML wins+losses must not exceed gamesAnalyzed
  const mlTotal = ml.overall.wins + ml.overall.losses;
  if (mlTotal > gamesAnalyzed) checks.push(`ML_OVERFLOW: ${mlTotal} > ${gamesAnalyzed}`);
  
  // Home + Away must equal total
  if (homeCount + awayCount !== gamesAnalyzed) {
    checks.push(`HOME_AWAY_MISMATCH: ${homeCount}+${awayCount}=${homeCount+awayCount} ≠ ${gamesAnalyzed}`);
  }
  
  // Fav + Dog must equal total
  if (favCount + dogCount !== gamesAnalyzed) {
    checks.push(`FAV_DOG_MISMATCH: ${favCount}+${dogCount}=${favCount+dogCount} ≠ ${gamesAnalyzed}`);
  }
  
  // ML home wins+losses must not exceed homeCount
  if (ml.home.wins + ml.home.losses > homeCount) {
    checks.push(`ML_HOME_OVERFLOW: ${ml.home.wins+ml.home.losses} > ${homeCount}`);
  }
  
  // ML away wins+losses must not exceed awayCount
  if (ml.away.wins + ml.away.losses > awayCount) {
    checks.push(`ML_AWAY_OVERFLOW: ${ml.away.wins+ml.away.losses} > ${awayCount}`);
  }
  
  // ATS overflow
  if (spread.overall.wins + spread.overall.losses > gamesAnalyzed) {
    checks.push(`ATS_OVERFLOW: ${spread.overall.wins+spread.overall.losses} > ${gamesAnalyzed}`);
  }
  
  // O/U overflow
  const ouTotal = total.overall.wins + total.overall.losses + total.overall.pushes;
  if (ouTotal > gamesAnalyzed) {
    checks.push(`OU_OVERFLOW: ${ouTotal} > ${gamesAnalyzed}`);
  }
  
  // Null ML games (affects fav/dog classification)
  if (ml.overall.nulls > 0) {
    checks.push(`NULL_ML_RESULTS(${ml.overall.nulls}): awayWon is null for ${ml.overall.nulls} games — check if scores are populated`);
  }
  
  // Null ATS games
  if (spread.overall.nulls > 0) {
    checks.push(`NULL_ATS_RESULTS(${spread.overall.nulls}): runLineCovered is null for ${spread.overall.nulls} games`);
  }
  
  // Null O/U games
  if (total.overall.nulls > 0) {
    checks.push(`NULL_OU_RESULTS(${total.overall.nulls}): totalResult is null for ${total.overall.nulls} games`);
  }
  
  // Zero games
  if (gamesAnalyzed === 0) {
    checks.push('NO_GAMES: 0 completed games — all stats will show —');
  }
  
  const status = checks.length === 0 ? '✅' : (checks.some(c => c.includes('OVERFLOW') || c.includes('MISMATCH') || c.includes('NO_GAMES')) ? '❌' : '⚠️ ');
  
  console.log(`  ${status} ${slug.padEnd(35)} games=${gamesAnalyzed} home=${homeCount} away=${awayCount} fav=${favCount} dog=${dogCount}`);
  console.log(`     ML:  overall=${ml.overall.wins}-${ml.overall.losses} last10=${ml.last10.wins}-${ml.last10.losses} home=${ml.home.wins}-${ml.home.losses} away=${ml.away.wins}-${ml.away.losses} fav=${ml.favorite.wins}-${ml.favorite.losses} dog=${ml.underdog.wins}-${ml.underdog.losses}`);
  console.log(`     ATS: overall=${spread.overall.wins}-${spread.overall.losses} last10=${spread.last10.wins}-${spread.last10.losses} home=${spread.home.wins}-${spread.home.losses} away=${spread.away.wins}-${spread.away.losses} fav=${spread.favorite.wins}-${spread.favorite.losses} dog=${spread.underdog.wins}-${spread.underdog.losses}`);
  console.log(`     O/U: overall=${total.overall.wins}O-${total.overall.losses}U-${total.overall.pushes}P last10=${total.last10.wins}O-${total.last10.losses}U home=${total.home.wins}O-${total.home.losses}U away=${total.away.wins}O-${total.away.losses}U`);
  
  if (checks.length > 0) {
    for (const c of checks) console.log(`     ⚠️  ${c}`);
    statIssues.push({ slug, checks });
  } else {
    passCount++;
  }
  console.log('');
}

// ─── Step 5: Null ML games detail ────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 5] Completed games with null awayWon (missing results)');
console.log('═══════════════════════════════════════════════════════════════');

const [nullWonGames] = await conn.query(`
  SELECT gameDate, awayAbbr, homeAbbr, awayScore, homeScore, awayWon, dkAwayML, dkHomeML
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete' AND awayWon IS NULL
  ORDER BY gameDate DESC
  LIMIT 20
`, [SEASON_START]);

console.log(`  Completed games with null awayWon: ${nullWonGames.length}`);
for (const g of nullWonGames) {
  console.log(`    ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore} awayWon=${g.awayWon} ml=${g.dkAwayML}/${g.dkHomeML}`);
}

// ─── Step 6: Null RL covered detail ──────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 6] Completed games with null awayRunLineCovered');
console.log('═══════════════════════════════════════════════════════════════');

const [nullRlGames] = await conn.query(`
  SELECT gameDate, awayAbbr, homeAbbr, awayScore, homeScore, dkAwayRunLine, awayRunLineCovered, homeRunLineCovered
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete' AND awayRunLineCovered IS NULL
  ORDER BY gameDate DESC
  LIMIT 20
`, [SEASON_START]);

console.log(`  Completed games with null awayRunLineCovered: ${nullRlGames.length}`);
for (const g of nullRlGames) {
  console.log(`    ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore} rl=${g.dkAwayRunLine} rl_cov=${g.awayRunLineCovered}`);
}

// ─── Step 7: Null total result detail ────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 7] Completed games with null totalResult');
console.log('═══════════════════════════════════════════════════════════════');

const [nullTotalGames] = await conn.query(`
  SELECT gameDate, awayAbbr, homeAbbr, awayScore, homeScore, dkTotal, totalResult
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete' AND totalResult IS NULL
  ORDER BY gameDate DESC
  LIMIT 20
`, [SEASON_START]);

console.log(`  Completed games with null totalResult: ${nullTotalGames.length}`);
for (const g of nullTotalGames) {
  console.log(`    ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore} total=${g.dkTotal} total_result=${g.totalResult}`);
}

// ─── Step 8: Verify Arizona sample ───────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 8] Arizona Diamondbacks — last 5 games (manual verification)');
console.log('═══════════════════════════════════════════════════════════════');

const [azGames] = await conn.query(`
  SELECT 
    gameDate, awaySlug, homeSlug, awayAbbr, homeAbbr,
    awayScore, homeScore, awayWon,
    dkAwayML, dkHomeML,
    dkAwayRunLine, awayRunLineCovered, homeRunLineCovered,
    dkTotal, totalResult
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND (awaySlug = 'arizona-diamondbacks' OR homeSlug = 'arizona-diamondbacks')
  ORDER BY gameDate DESC
  LIMIT 5
`, [SEASON_START]);

for (const g of azGames) {
  const isAway = g.awaySlug === 'arizona-diamondbacks';
  const awBuf = g.awayWon;
  const aw = awBuf === true || (Buffer.isBuffer(awBuf) && awBuf[0] === 1) || awBuf === 1;
  const teamWon = aw !== null ? (isAway ? aw : !aw) : null;
  const rawCov = isAway ? g.awayRunLineCovered : g.homeRunLineCovered;
  const teamCovered = rawCov === true || (Buffer.isBuffer(rawCov) && rawCov[0] === 1) || rawCov === 1;
  const myML = isAway ? g.dkAwayML : g.dkHomeML;
  const isFav = myML ? parseInt(myML, 10) < 0 : false;
  
  console.log(`  ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore}`);
  console.log(`    isAway=${isAway} teamWon=${teamWon} covered=${teamCovered} isFav=${isFav}`);
  console.log(`    ml_away=${g.dkAwayML} ml_home=${g.dkHomeML} rl=${g.dkAwayRunLine} total=${g.dkTotal} total_result=${g.totalResult}`);
  console.log(`    awayWon raw=${JSON.stringify(g.awayWon)} type=${typeof g.awayWon}`);
}

// ─── Step 9: Check Philadelphia Phillies ─────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 9] Philadelphia Phillies — last 5 games (manual verification)');
console.log('═══════════════════════════════════════════════════════════════');

const [phiGames] = await conn.query(`
  SELECT 
    gameDate, awaySlug, homeSlug, awayAbbr, homeAbbr,
    awayScore, homeScore, awayWon,
    dkAwayML, dkHomeML,
    dkAwayRunLine, awayRunLineCovered, homeRunLineCovered,
    dkTotal, totalResult
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND (awaySlug = 'philadelphia-phillies' OR homeSlug = 'philadelphia-phillies')
  ORDER BY gameDate DESC
  LIMIT 5
`, [SEASON_START]);

for (const g of phiGames) {
  const isAway = g.awaySlug === 'philadelphia-phillies';
  const awBuf = g.awayWon;
  const aw = awBuf === true || (Buffer.isBuffer(awBuf) && awBuf[0] === 1) || awBuf === 1;
  const teamWon = g.awayWon != null ? (isAway ? aw : !aw) : null;
  const rawCov = isAway ? g.awayRunLineCovered : g.homeRunLineCovered;
  const teamCovered = rawCov === true || (Buffer.isBuffer(rawCov) && rawCov[0] === 1) || rawCov === 1;
  const myML = isAway ? g.dkAwayML : g.dkHomeML;
  const isFav = myML ? parseInt(myML, 10) < 0 : false;
  
  console.log(`  ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} score=${g.awayScore}-${g.homeScore}`);
  console.log(`    isAway=${isAway} teamWon=${teamWon} covered=${teamCovered} isFav=${isFav}`);
  console.log(`    ml_away=${g.dkAwayML} ml_home=${g.dkHomeML} rl=${g.dkAwayRunLine} total=${g.dkTotal} total_result=${g.totalResult}`);
}

// ─── Step 10: Check for games where ML is null but game is complete ───────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 10] Games where dkAwayML is null but game is complete');
console.log('═══════════════════════════════════════════════════════════════');

const [nullMlComplete] = await conn.query(`
  SELECT COUNT(*) as cnt FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete' AND dkAwayML IS NULL
`, [SEASON_START]);
console.log(`  Games with null dkAwayML (completed, 2026): ${nullMlComplete[0].cnt}`);
console.log(`  NOTE: These games will have ALL teams classified as 'underdog' (wasFavorite=false)`);
console.log(`        because parseInt(null, 10) = NaN which is NOT < 0`);

// ─── Step 11: Check homeRunLineCovered field ──────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 11] homeRunLineCovered field check');
console.log('═══════════════════════════════════════════════════════════════');

const [rlCheck] = await conn.query(`
  SELECT 
    SUM(CASE WHEN awayRunLineCovered IS NOT NULL THEN 1 ELSE 0 END) as away_rl_set,
    SUM(CASE WHEN homeRunLineCovered IS NOT NULL THEN 1 ELSE 0 END) as home_rl_set,
    SUM(CASE WHEN awayRunLineCovered IS NOT NULL AND homeRunLineCovered IS NOT NULL THEN 1 ELSE 0 END) as both_rl_set,
    SUM(CASE WHEN awayRunLineCovered IS NOT NULL AND homeRunLineCovered IS NULL THEN 1 ELSE 0 END) as only_away_rl,
    SUM(CASE WHEN awayRunLineCovered IS NULL AND homeRunLineCovered IS NOT NULL THEN 1 ELSE 0 END) as only_home_rl,
    COUNT(*) as total_complete
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
`, [SEASON_START]);

const rl = rlCheck[0];
console.log(`  Total completed: ${rl.total_complete}`);
console.log(`  awayRunLineCovered set: ${rl.away_rl_set}`);
console.log(`  homeRunLineCovered set: ${rl.home_rl_set}`);
console.log(`  Both set: ${rl.both_rl_set}`);
console.log(`  Only away set: ${rl.only_away_rl}`);
console.log(`  Only home set: ${rl.only_home_rl}`);

// ─── Step 12: Check for games where awayRunLineCovered != !homeRunLineCovered ──
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][STEP 12] RL consistency check: awayRunLineCovered vs homeRunLineCovered');
console.log('═══════════════════════════════════════════════════════════════');

const [rlConsistency] = await conn.query(`
  SELECT COUNT(*) as inconsistent
  FROM mlb_schedule_history
  WHERE gameDate >= ? AND gameStatus = 'complete'
    AND awayRunLineCovered IS NOT NULL AND homeRunLineCovered IS NOT NULL
    AND awayRunLineCovered = homeRunLineCovered
`, [SEASON_START]);

console.log(`  Games where away and home BOTH covered (impossible on standard 1.5 RL): ${rlConsistency[0].inconsistent}`);
console.log(`  NOTE: On standard ±1.5 RL, exactly one team covers (no push possible)`);

// ─── Final Summary ────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('[AUDIT][SUMMARY]');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total teams audited:      ${slugs.length}`);
console.log(`  Teams passing all checks: ${passCount}`);
console.log(`  Teams with stat issues:   ${statIssues.length}`);
console.log(`  Teams with data issues:   ${dataIssues.length}`);

if (statIssues.length > 0) {
  console.log('\n  Stat issues:');
  for (const s of statIssues) {
    console.log(`    ${s.slug}: ${s.checks.join(' | ')}`);
  }
}

if (dataIssues.length > 0) {
  console.log('\n  Data coverage issues:');
  for (const i of dataIssues) {
    console.log(`    ${i.slug}: ${i.flags.join(', ')}`);
  }
}

await conn.end();
console.log('\n[AUDIT][DONE] Audit complete.');

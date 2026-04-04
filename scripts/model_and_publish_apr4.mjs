/**
 * model_and_publish_apr4.mjs
 * 
 * Full pipeline for April 4, 2026:
 * 1. Run MLB model for all 15 games
 * 2. Fix Final Four games:
 *    - Update id=2640001 (Illinois @ Connecticut) with F4 bracket metadata
 *    - Update id=1890053 (placeholder) to Michigan @ Arizona with real odds + move to Apr 4
 * 3. Run NCAAM model for both Final Four games
 * 4. Publish all April 4 MLB + NCAAM games to feed
 * 
 * Logging format: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const DATE = '2026-04-04';
const TAG = `[Apr4Pipeline][${DATE}]`;

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL);
}

// ─── STEP 1: Run MLB Model ────────────────────────────────────────────────────
async function runMlbModel() {
  console.log(`\n${TAG} ═══════════════════════════════════════`);
  console.log(`${TAG} STEP 1: Running MLB Model for ${DATE}`);
  console.log(`${TAG} ═══════════════════════════════════════`);
  
  const { runMlbModelForDate } = await import('../server/mlbModelRunner.js');
  
  console.log(`${TAG} [STEP] Invoking runMlbModelForDate("${DATE}")...`);
  const result = await runMlbModelForDate(DATE);
  
  console.log(`${TAG} [OUTPUT] MLB Model Result:`);
  console.log(`  date:    ${result.date}`);
  console.log(`  total:   ${result.total} games found`);
  console.log(`  written: ${result.written} games modeled`);
  console.log(`  skipped: ${result.skipped} games skipped`);
  console.log(`  errors:  ${result.errors} errors`);
  
  if (result.validation) {
    const v = result.validation;
    console.log(`  validation: passed=${v.passed} | issues=${v.issues.length} | warnings=${v.warnings.length}`);
    if (v.issues.length > 0) {
      console.warn(`${TAG} [WARN] Validation issues:`);
      v.issues.forEach(i => console.warn(`    - ${i}`));
    }
    if (v.warnings.length > 0) {
      v.warnings.forEach(w => console.warn(`    ⚠ ${w}`));
    }
  }
  
  // Verify
  const conn = await getConn();
  const [modeled] = await conn.query(
    `SELECT id, awayTeam, homeTeam, awayModelSpread, modelTotal, modelAwayWinPct, modelHomeWinPct FROM games WHERE sport='MLB' AND gameDate=? AND awayModelSpread IS NOT NULL ORDER BY startTimeEst`,
    [DATE]
  );
  console.log(`${TAG} [VERIFY] DB check: ${modeled.length}/15 games now have model projections`);
  modeled.forEach(g => {
    console.log(`  ✓ id=${g.id} | ${g.awayTeam}@${g.homeTeam} | spread=${g.awayModelSpread} | total=${g.modelTotal} | win=${g.modelAwayWinPct}%/${g.modelHomeWinPct}%`);
  });
  
  const [unmodeled] = await conn.query(
    `SELECT id, awayTeam, homeTeam FROM games WHERE sport='MLB' AND gameDate=? AND awayModelSpread IS NULL`,
    [DATE]
  );
  if (unmodeled.length > 0) {
    console.warn(`${TAG} [WARN] Unmodeled games (${unmodeled.length}):`);
    unmodeled.forEach(g => console.warn(`  ✗ id=${g.id} | ${g.awayTeam}@${g.homeTeam}`));
  }
  
  await conn.end();
  return result;
}

// ─── STEP 2: Fix Final Four Games ─────────────────────────────────────────────
async function fixFinalFourGames() {
  console.log(`\n${TAG} ═══════════════════════════════════════`);
  console.log(`${TAG} STEP 2: Fixing Final Four Games`);
  console.log(`${TAG} ═══════════════════════════════════════`);
  
  const conn = await getConn();
  
  // 2a. Update id=2640001 (Illinois @ Connecticut, already on April 4 with real odds)
  // Add F4 bracket metadata so it shows in the bracket view
  console.log(`${TAG} [STEP] Updating id=2640001 (Illinois @ Connecticut) with F4 bracket metadata...`);
  console.log(`${TAG} [INPUT] bracketRound=F4, bracketGameId=601, bracketSlot=1, bracketRegion=FINAL_FOUR`);
  console.log(`${TAG} [INPUT] nextBracketGameId=701, nextBracketSlot=top, sortOrder=1`);
  
  await conn.query(`
    UPDATE games SET 
      bracketRound = 'F4',
      bracketGameId = 601,
      bracketSlot = 1,
      bracketRegion = 'FINAL_FOUR',
      nextBracketGameId = 701,
      nextBracketSlot = 'top',
      sortOrder = 1
    WHERE id = 2640001
  `);
  
  const [g1] = await conn.query('SELECT id, awayTeam, homeTeam, bracketRound, bracketGameId, bracketSlot, nextBracketSlot, gameDate, startTimeEst FROM games WHERE id=2640001');
  console.log(`${TAG} [VERIFY] id=2640001 updated:`, JSON.stringify(g1[0]));
  
  // 2b. Update id=1890053 (placeholder: arizona @ tbd_602_home) → Michigan @ Arizona
  // Real game: Michigan (away) vs Arizona (home) — 8:49 PM ET on April 4
  // Odds from VSiN: Michigan -1 (-113), Arizona +1 (-113), Total 148.5
  // ML estimate: Michigan -120, Arizona +100
  console.log(`\n${TAG} [STEP] Updating id=1890053 to Michigan @ Arizona Final Four...`);
  console.log(`${TAG} [INPUT] awayTeam=michigan, homeTeam=arizona`);
  console.log(`${TAG} [INPUT] gameDate=2026-04-04, startTimeEst=20:49`);
  console.log(`${TAG} [INPUT] Spread: Michigan -1 (-113), Arizona +1 (-113)`);
  console.log(`${TAG} [INPUT] Total: 148.5 (-110/-110), ML: -120/+100`);
  
  await conn.query(`
    UPDATE games SET 
      awayTeam = 'michigan',
      homeTeam = 'arizona',
      gameDate = '2026-04-04',
      startTimeEst = '20:49',
      awayML = '-120',
      homeML = '+100',
      awayBookSpread = -1.0,
      homeBookSpread = 1.0,
      awaySpreadOdds = '-113',
      homeSpreadOdds = '-113',
      bookTotal = '148.5',
      overOdds = '-110',
      underOdds = '-110',
      openAwaySpread = -1.0,
      openHomeSpread = 1.0,
      openAwaySpreadOdds = '-113',
      openHomeSpreadOdds = '-113',
      openTotal = '148.5',
      openAwayML = '-120',
      openHomeML = '+100',
      bracketRound = 'F4',
      bracketGameId = 602,
      bracketSlot = 2,
      bracketRegion = 'FINAL_FOUR',
      nextBracketGameId = 701,
      nextBracketSlot = 'bottom',
      sortOrder = 2,
      sport = 'NCAAM',
      gameStatus = 'upcoming'
    WHERE id = 1890053
  `);
  
  const [g2] = await conn.query('SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, awayML, homeML, awayBookSpread, bookTotal, bracketRound, bracketGameId FROM games WHERE id=1890053');
  console.log(`${TAG} [VERIFY] id=1890053 updated:`, JSON.stringify(g2[0]));
  
  // 2c. Unpublish the stale placeholder id=1890052 (tbd_601_away @ illinois on April 5)
  // This is now superseded by id=2640001 (the real game)
  console.log(`\n${TAG} [STEP] Removing stale placeholder id=1890052 from feed...`);
  await conn.query(`UPDATE games SET publishedToFeed=0 WHERE id=1890052`);
  console.log(`${TAG} [VERIFY] id=1890052 unpublished`);
  
  await conn.end();
}

// ─── STEP 3: Run NCAAM Model for Both Final Four Games ────────────────────────
async function runNcaamModel() {
  console.log(`\n${TAG} ═══════════════════════════════════════`);
  console.log(`${TAG} STEP 3: Running NCAAM Model for Final Four`);
  console.log(`${TAG} ═══════════════════════════════════════`);
  
  const { triggerModelWatcherForDate } = await import('../server/ncaamModelWatcher.js');
  
  console.log(`${TAG} [STEP] Invoking triggerModelWatcherForDate("${DATE}", forceRerun=true)...`);
  const result = await triggerModelWatcherForDate(DATE, { forceRerun: true });
  
  console.log(`${TAG} [OUTPUT] NCAAM Model Result:`);
  console.log(`  triggered: ${result.triggered} games modeled`);
  console.log(`  skipped:   ${result.skipped} games skipped`);
  
  // Verify
  const conn = await getConn();
  const [ncaamModeled] = await conn.query(`
    SELECT id, awayTeam, homeTeam, awayModelSpread, modelTotal, modelAwayWinPct, modelHomeWinPct, bracketRound
    FROM games 
    WHERE sport='NCAAM' AND gameDate='2026-04-04' AND awayModelSpread IS NOT NULL
  `);
  console.log(`${TAG} [VERIFY] NCAAM games modeled: ${ncaamModeled.length}`);
  ncaamModeled.forEach(g => {
    console.log(`  ✓ id=${g.id} | [${g.bracketRound}] ${g.awayTeam}@${g.homeTeam} | spread=${g.awayModelSpread} | total=${g.modelTotal} | win=${g.modelAwayWinPct}%/${g.modelHomeWinPct}%`);
  });
  
  const [ncaamUnmodeled] = await conn.query(`
    SELECT id, awayTeam, homeTeam, awayBookSpread, bookTotal
    FROM games 
    WHERE sport='NCAAM' AND gameDate='2026-04-04' AND awayModelSpread IS NULL
  `);
  if (ncaamUnmodeled.length > 0) {
    console.warn(`${TAG} [WARN] NCAAM games NOT modeled (${ncaamUnmodeled.length}):`);
    ncaamUnmodeled.forEach(g => console.warn(`  ✗ id=${g.id} | ${g.awayTeam}@${g.homeTeam} | spread=${g.awayBookSpread} total=${g.bookTotal}`));
  }
  
  await conn.end();
  return result;
}

// ─── STEP 4: Publish All April 4 Games ───────────────────────────────────────
async function publishAllGames() {
  console.log(`\n${TAG} ═══════════════════════════════════════`);
  console.log(`${TAG} STEP 4: Publishing All April 4 Games`);
  console.log(`${TAG} ═══════════════════════════════════════`);
  
  const conn = await getConn();
  
  // Publish all MLB games with lines
  console.log(`${TAG} [STEP] Publishing all April 4 MLB games with lines...`);
  const [mlbResult] = await conn.query(`
    UPDATE games SET publishedToFeed = 1
    WHERE sport = 'MLB' 
      AND gameDate = '2026-04-04'
      AND fileId = 0
      AND (awayBookSpread IS NOT NULL OR bookTotal IS NOT NULL)
  `);
  console.log(`${TAG} [OUTPUT] MLB games published: ${mlbResult.affectedRows}`);
  
  // Publish all NCAAM games with lines (Final Four — both games)
  console.log(`${TAG} [STEP] Publishing all April 4 NCAAM Final Four games...`);
  const [ncaamResult] = await conn.query(`
    UPDATE games SET publishedToFeed = 1
    WHERE sport = 'NCAAM' 
      AND gameDate = '2026-04-04'
      AND fileId = 0
      AND (awayBookSpread IS NOT NULL OR bookTotal IS NOT NULL)
  `);
  console.log(`${TAG} [OUTPUT] NCAAM games published: ${ncaamResult.affectedRows}`);
  
  // Final comprehensive verification
  console.log(`\n${TAG} [VERIFY] ═══════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] FINAL STATE — All April 4 Published Games`);
  console.log(`${TAG} [VERIFY] ═══════════════════════════════════════`);
  
  const [allPublished] = await conn.query(`
    SELECT id, sport, awayTeam, homeTeam, startTimeEst, 
           awayML, homeML, awayBookSpread, bookTotal,
           awayModelSpread, modelTotal, modelAwayWinPct, modelHomeWinPct,
           publishedToFeed, bracketRound, bracketGameId
    FROM games 
    WHERE gameDate = '2026-04-04' AND publishedToFeed = 1
    ORDER BY sport DESC, startTimeEst ASC
  `);
  
  console.log(`${TAG} [OUTPUT] Total published games: ${allPublished.length}`);
  let mlbCount = 0, ncaamCount = 0;
  allPublished.forEach(g => {
    const model = g.awayModelSpread 
      ? `spread=${g.awayModelSpread} total=${g.modelTotal} win=${g.modelAwayWinPct}%/${g.modelHomeWinPct}%` 
      : '⚠ NO MODEL';
    const bracket = g.bracketRound ? ` [${g.bracketRound}/${g.bracketGameId}]` : '';
    console.log(`  [${g.sport}${bracket}] id=${g.id} | ${g.awayTeam}@${g.homeTeam} | ${g.startTimeEst} | ML:${g.awayML}/${g.homeML} | ${model}`);
    if (g.sport === 'MLB') mlbCount++;
    if (g.sport === 'NCAAM') ncaamCount++;
  });
  
  console.log(`\n${TAG} [VERIFY] MLB published: ${mlbCount}/15 | NCAAM published: ${ncaamCount}/2`);
  
  // Check for any games NOT published that should be
  const [unpublished] = await conn.query(`
    SELECT id, sport, awayTeam, homeTeam, awayBookSpread, bookTotal, awayML, publishedToFeed
    FROM games 
    WHERE gameDate = '2026-04-04' AND publishedToFeed = 0 AND sport IN ('MLB', 'NCAAM')
      AND (awayBookSpread IS NOT NULL OR bookTotal IS NOT NULL)
    ORDER BY sport, startTimeEst
  `);
  
  if (unpublished.length > 0) {
    console.warn(`${TAG} [WARN] Games with lines but NOT published (${unpublished.length}):`);
    unpublished.forEach(g => console.warn(`  ✗ [${g.sport}] id=${g.id} | ${g.awayTeam}@${g.homeTeam}`));
  } else {
    console.log(`${TAG} [VERIFY] ✅ All games with lines are published`);
  }
  
  await conn.end();
}

// ─── MAIN EXECUTION ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${TAG} STARTING FULL PIPELINE`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`${TAG} [INPUT] Date: ${DATE}`);
  console.log(`${TAG} [INPUT] Target: 15 MLB games + 2 NCAAM Final Four games`);
  console.log(`${TAG} [INPUT] Actions: MLB Model → Fix F4 → NCAAM Model → Publish All`);
  
  try {
    await runMlbModel();
    await fixFinalFourGames();
    await runNcaamModel();
    await publishAllGames();
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${TAG} ✅ PIPELINE COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    
  } catch (err) {
    console.error(`\n${TAG} ❌ PIPELINE FAILED:`, err);
    process.exit(1);
  }
}

main();

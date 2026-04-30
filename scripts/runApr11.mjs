/**
 * runApr11.mjs
 * Runs the full MLB pipeline for 2026-04-11:
 *   1. MLB model (run lines, totals, MLs, F5, NRFI)
 *   2. F5/NRFI book odds scrape (FanDuel NJ)
 *   3. HR props scrape + model EV (Consensus/AN)
 *   4. K-props model (AN Consensus)
 *   5. Publish all 15 games to feed
 *   6. NHL model + publish
 *
 * Usage: node scripts/runApr11.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const DATE = '2026-04-11';

async function step(label, fn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[STEP] ${label}`);
  console.log(`[INPUT] date=${DATE}`);
  const t0 = Date.now();
  try {
    const result = await fn();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[OUTPUT] ${label} complete in ${elapsed}s`);
    console.log(`[VERIFY] PASS — result:`, JSON.stringify(result, null, 2).slice(0, 800));
    return result;
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.error(`[ERROR] ${label} FAILED after ${elapsed}s:`, err.message);
    console.error(`[VERIFY] FAIL — stack:`, err.stack?.split('\n').slice(0, 5).join('\n'));
    return null;
  }
}

async function main() {
  console.log(`[INPUT] runApr11.mjs — date=${DATE} — started at ${new Date().toISOString()}`);

  // ── Step 1: MLB Model ────────────────────────────────────────────────────────
  const modelResult = await step('MLB Model (runMlbModelForDate)', async () => {
    const { runMlbModelForDate } = await import('../server/mlbModelRunner.js');
    const r = await runMlbModelForDate(DATE);
    console.log(`  [STATE] written=${r.written} skipped=${r.skipped} errors=${r.errors}`);
    if (!r.validation.passed) {
      console.error(`  [WARN] Validation issues (${r.validation.issues.length}):`);
      for (const issue of r.validation.issues) console.error(`    - ${issue}`);
    } else {
      console.log(`  [STATE] Validation: ✅ PASSED`);
    }
    return { written: r.written, skipped: r.skipped, errors: r.errors, validationPassed: r.validation.passed };
  });

  // ── Step 2: F5/NRFI Book Odds Scrape (FanDuel NJ) ──────────────────────────
  const f5Result = await step('F5/NRFI Scrape (FanDuel NJ)', async () => {
    const { scrapeAndStoreF5Nrfi } = await import('../server/mlbF5NrfiScraper.js');
    const r = await scrapeAndStoreF5Nrfi(DATE);
    console.log(`  [STATE] processed=${r.processed} matched=${r.matched} unmatched=${r.unmatched.length} errors=${r.errors.length}`);
    if (r.unmatched.length > 0) console.warn(`  [WARN] Unmatched games:`, r.unmatched);
    if (r.errors.length > 0) console.error(`  [WARN] Errors:`, r.errors.slice(0, 3));
    return { processed: r.processed, matched: r.matched, unmatched: r.unmatched.length, errors: r.errors.length };
  });

  // ── Step 3: HR Props Scrape + Model EV ──────────────────────────────────────
  const hrScrapeResult = await step('HR Props Scrape (AN Consensus)', async () => {
    const { scrapeHrPropsForDate } = await import('../server/mlbHrPropsScraper.js');
    const r = await scrapeHrPropsForDate(DATE);
    console.log(`  [STATE] inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped} errors=${r.errors}`);
    return r;
  });

  const hrModelResult = await step('HR Props Model EV (resolveAndModelHrProps)', async () => {
    const { resolveAndModelHrProps } = await import('../server/mlbHrPropsModelService.js');
    const r = await resolveAndModelHrProps(DATE);
    console.log(`  [STATE] resolved=${r.resolved} alreadyHad=${r.alreadyHad} modeled=${r.modeled} edges=${r.edges} errors=${r.errors}`);
    return r;
  });

  // ── Step 4: K-Props Model ────────────────────────────────────────────────────
  const kPropsResult = await step('K-Props Model (modelKPropsForDate)', async () => {
    const { modelKPropsForDate } = await import('../server/mlbKPropsModelService.js');
    const r = await modelKPropsForDate(DATE);
    console.log(`  [STATE] modeled=${r.modeled} edges=${r.edges} errors=${r.errors}`);
    return r;
  });

  // ── Step 5: Verify DB state after model run ──────────────────────────────────
  await step('DB Verification — MLB games after model run', async () => {
    const mysql = require('../node_modules/mysql2/promise');
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [rows] = await conn.execute(
      `SELECT id, awayTeam, homeTeam, awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
              bookTotal, overOdds, underOdds, awayML, homeML,
              modelAwayML, modelHomeML, modelAwayScore, modelHomeScore,
              f5AwayML, f5HomeML, f5Total, nrfiOverOdds, yrfiUnderOdds,
              publishedToFeed
       FROM games WHERE sport='MLB' AND gameDate='${DATE}' ORDER BY startTimeEst ASC`
    );
    console.log(`  [STATE] ${rows.length} MLB games after model run:`);
    for (const r of rows) {
      const rlStatus = r.awayRunLine ? `✅ ${r.awayRunLine}(${r.awayRunLineOdds})` : '❌ NULL';
      const f5Status = r.f5AwayML ? `✅ F5ML=${r.f5AwayML}/${r.f5HomeML}` : '❌ F5 NULL';
      const nrfiStatus = r.nrfiOverOdds ? `✅ NRFI=${r.nrfiOverOdds}` : '❌ NRFI NULL';
      console.log(`    ${r.awayTeam}@${r.homeTeam}: RL=${rlStatus} | total=${r.bookTotal}(${r.overOdds}/${r.underOdds}) | ML=${r.awayML}/${r.homeML} | modelML=${r.modelAwayML}/${r.modelHomeML} | ${f5Status} | ${nrfiStatus} | pub=${r.publishedToFeed}`);
    }
    await conn.end();
    return { count: rows.length };
  });

  // ── Step 6: Publish all MLB games to feed ────────────────────────────────────
  await step('Publish MLB games to feed (publishedToFeed=1)', async () => {
    const mysql = require('../node_modules/mysql2/promise');
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [result] = await conn.execute(
      `UPDATE games SET publishedToFeed=1 WHERE sport='MLB' AND gameDate='${DATE}' AND gameStatus='upcoming'`
    );
    console.log(`  [STATE] Rows updated: ${result.affectedRows}`);
    // Also set publishedModel=1 for games with model data
    const [result2] = await conn.execute(
      `UPDATE games SET publishedModel=1 WHERE sport='MLB' AND gameDate='${DATE}' AND modelAwayML IS NOT NULL AND gameStatus='upcoming'`
    );
    console.log(`  [STATE] publishedModel=1 set on: ${result2.affectedRows} games`);
    await conn.end();
    return { published: result.affectedRows, modelPublished: result2.affectedRows };
  });

  // ── Step 7: NHL games ────────────────────────────────────────────────────────
  await step('NHL games — verify and publish', async () => {
    const mysql = require('../node_modules/mysql2/promise');
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [rows] = await conn.execute(
      `SELECT id, awayTeam, homeTeam, awayBookSpread, homeBookSpread, awaySpreadOdds, homeSpreadOdds,
              bookTotal, overOdds, underOdds, awayML, homeML, publishedToFeed, publishedModel
       FROM games WHERE sport='NHL' AND gameDate='${DATE}' ORDER BY startTimeEst ASC`
    );
    console.log(`  [STATE] ${rows.length} NHL games:`);
    for (const r of rows) {
      const plStatus = r.awayBookSpread ? `✅ PL=${r.awayBookSpread}(${r.awaySpreadOdds})/${r.homeBookSpread}(${r.homeSpreadOdds})` : '❌ PL NULL';
      console.log(`    ${r.awayTeam}@${r.homeTeam}: ${plStatus} | total=${r.bookTotal}(${r.overOdds}/${r.underOdds}) | ML=${r.awayML}/${r.homeML} | pub=${r.publishedToFeed}`);
    }
    // Publish NHL games
    const [result] = await conn.execute(
      `UPDATE games SET publishedToFeed=1 WHERE sport='NHL' AND gameDate='${DATE}' AND gameStatus='upcoming'`
    );
    console.log(`  [STATE] NHL published: ${result.affectedRows} games`);
    await conn.end();
    return { nhlGames: rows.length, published: result.affectedRows };
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[OUTPUT] runApr11.mjs COMPLETE — ${new Date().toISOString()}`);
  console.log(`[VERIFY] Summary:`);
  console.log(`  MLB Model: ${modelResult ? `written=${modelResult.written} errors=${modelResult.errors}` : 'FAILED'}`);
  console.log(`  F5/NRFI:  ${f5Result ? `matched=${f5Result.matched} errors=${f5Result.errors}` : 'FAILED'}`);
  console.log(`  HR Props: ${hrScrapeResult ? `inserted=${hrScrapeResult.inserted} updated=${hrScrapeResult.updated}` : 'FAILED'}`);
  console.log(`  K-Props:  ${kPropsResult ? `modeled=${kPropsResult.modeled} edges=${kPropsResult.edges}` : 'FAILED'}`);
}

main().catch(err => {
  console.error('[FATAL] runApr11.mjs crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});

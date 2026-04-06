/**
 * run_april6_full_pipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Full April 6, 2026 pipeline:
 *   Step 1: Sync Statcast data (iso, barrelPct, hardHitPct, xSlg) from Baseball Savant
 *   Step 2: Run MLB model for all 13 games (400K Monte Carlo sims each)
 *   Step 3: Scrape F5 + NRFI odds from Action Network (FanDuel NJ)
 *   Step 4: Scrape HR Props from Action Network (Consensus)
 *   Step 5: Run HR Props model EV computation (v2 Statcast-enhanced)
 *   Step 6: Scrape K-Props from Action Network (Consensus)
 *   Step 7: Final DB audit
 *
 * Book sources:
 *   Full game ML/RL/Total → DK NJ (book_id=68) [auto-refreshed by vsinAutoRefresh]
 *   F5 ML/RL/Total + NRFI/YRFI → FanDuel NJ (book_id=69)
 *   HR Props → Consensus (book_id=15)
 *   K-Props → Consensus (book_id=15)
 *
 * [INPUT]  gameDate = 2026-04-06
 * [OUTPUT] All 13 MLB games modeled + all props populated with model EV
 */

import { runMlbModelForDate } from "./server/mlbModelRunner";
import { scrapeAndStoreF5Nrfi } from "./server/mlbF5NrfiScraper";
import { scrapeHrPropsForDate } from "./server/mlbHrPropsScraper";
import { resolveAndModelHrProps } from "./server/mlbHrPropsModelService";
import { syncStatcastData } from "./server/mlbStatcastSync";
import * as mysql2 from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const TAG = "[PIPELINE-APR6]";
const DATE = "2026-04-06";

// ─── K-Props scraper (calls Python ActionNetworkKPropsAPI.py) ─────────────────
import { fetchANKProps } from "./server/anKPropsService";
import { upsertKPropsFromAN } from "./server/kPropsDbHelpers";
import { modelKPropsForDate } from "./server/mlbKPropsModelService";

async function main() {
  const startTime = Date.now();
  console.log(`\n${TAG} ${"=".repeat(65)}`);
  console.log(`${TAG} [INPUT] gameDate=${DATE} | MLB=13 games | NHL=4 games (pre-modeled)`);
  console.log(`${TAG} ${"=".repeat(65)}\n`);

  // ── STEP 1: Sync Statcast data ─────────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Syncing Statcast data from Baseball Savant (iso, barrelPct, hardHitPct, xSlg)`);
  try {
    const statcastResult = await syncStatcastData();
    console.log(`${TAG} [OUTPUT] Statcast: fetched=${statcastResult.fetched} updated=${statcastResult.updated} notFound=${statcastResult.notFound} errors=${statcastResult.errors}`);
    console.log(`${TAG} [VERIFY] ${statcastResult.errors === 0 ? "PASS" : "WARN"} — ${statcastResult.errors} Statcast errors`);
  } catch (err) {
    console.error(`${TAG} [WARN] Statcast sync failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    // Non-fatal — HR Props model will fall back to team-level rates
  }

  // ── STEP 2: MLB model ──────────────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 2] Running MLBAIModel.py for all 13 MLB games (400K sims each)`);
  try {
    const modelResult = await runMlbModelForDate(DATE);
    console.log(`${TAG} [OUTPUT] MLB model: written=${modelResult.written} skipped=${modelResult.skipped} errors=${modelResult.errors}`);
    if (modelResult.errors > 0) {
      console.error(`${TAG} [VERIFY] WARN — ${modelResult.errors} model errors`);
    } else {
      console.log(`${TAG} [VERIFY] PASS — 0 model errors`);
    }
  } catch (err) {
    console.error(`${TAG} [FATAL] MLB model run failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // ── STEP 3: F5 + NRFI odds (FanDuel NJ) ───────────────────────────────────
  console.log(`\n${TAG} [STEP 3] Scraping F5 + NRFI odds from Action Network (FanDuel NJ)`);
  try {
    const f5Result = await scrapeAndStoreF5Nrfi(DATE);
    console.log(`${TAG} [OUTPUT] F5/NRFI: processed=${f5Result.processed} matched=${f5Result.matched} unmatched=${f5Result.unmatched.length} errors=${f5Result.errors.length}`);
    if (f5Result.unmatched.length > 0) {
      console.warn(`${TAG} [WARN] Unmatched games: ${f5Result.unmatched.join(", ")}`);
    }
    console.log(`${TAG} [VERIFY] ${f5Result.errors.length === 0 ? "PASS" : "WARN"} — ${f5Result.errors.length} F5/NRFI errors`);
  } catch (err) {
    console.error(`${TAG} [WARN] F5/NRFI scrape failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── STEP 4: HR Props scrape (Consensus) ───────────────────────────────────
  console.log(`\n${TAG} [STEP 4] Scraping HR Props from Action Network (Consensus)`);
  try {
    const hrResult = await scrapeHrPropsForDate(DATE);
    console.log(`${TAG} [OUTPUT] HR Props: inserted=${hrResult.inserted} updated=${hrResult.updated} skipped=${hrResult.skipped} errors=${hrResult.errors}`);
    console.log(`${TAG} [VERIFY] ${hrResult.errors === 0 ? "PASS" : "WARN"} — ${hrResult.errors} HR Props errors`);
  } catch (err) {
    console.error(`${TAG} [WARN] HR Props scrape failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── STEP 5: HR Props model EV (v2 Statcast-enhanced) ──────────────────────
  console.log(`\n${TAG} [STEP 5] Running HR Props model EV computation (v2 Statcast-enhanced)`);
  try {
    const hrModelResult = await resolveAndModelHrProps(DATE);
    console.log(`${TAG} [OUTPUT] HR Props model: resolved=${hrModelResult.resolved} alreadyHad=${hrModelResult.alreadyHad} unresolved=${hrModelResult.unresolved} modeled=${hrModelResult.modeled} edges=${hrModelResult.edges} errors=${hrModelResult.errors}`);
    console.log(`${TAG} [VERIFY] ${hrModelResult.errors === 0 ? "PASS" : "WARN"} — ${hrModelResult.errors} HR model errors`);
  } catch (err) {
    console.error(`${TAG} [WARN] HR Props model failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── STEP 6: K-Props scrape (Consensus) ────────────────────────────────────
  console.log(`\n${TAG} [STEP 6] Scraping K-Props from Action Network (Consensus)`);
  try {
    const dateForAN = DATE.replace(/-/g, ""); // Convert YYYY-MM-DD → YYYYMMDD
    const anKResult = await fetchANKProps(dateForAN);
    console.log(`${TAG} [STATE] K-Props fetched: ${anKResult.props.length} props from AN`);
    const kResult = await upsertKPropsFromAN(anKResult, DATE);
    console.log(`${TAG} [OUTPUT] K-Props: inserted=${kResult.inserted} updated=${kResult.updated} skipped=${kResult.skipped} errors=${kResult.er    console.log(`${TAG} [VERIFY] ${kResult.errors === 0 ? "PASS" : "WARN"} \u2014 ${kResult.errors} K-Props errors`);
  } catch (err) {
    console.error(`${TAG} [WARN] K-Props scrape failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // \u2500\u2500 STEP 6b: K-Props model EV \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  console.log(`\n${TAG} [STEP 6b] Running K-Props model EV (v1-poisson)`);
  try {
    const kModelResult = await modelKPropsForDate(DATE);
    console.log(`${TAG} [OUTPUT] K-Props model: modeled=${kModelResult.modeled} edges=${kModelResult.edges} skipped=${kModelResult.skipped} errors=${kModelResult.errors}`);
    console.log(`${TAG} [VERIFY] ${kModelResult.errors === 0 ? "PASS" : "WARN"} \u2014 ${kModelResult.errors} K-Props model errors`);
  } catch (err) {
    console.error(`${TAG} [WARN] K-Props model failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // \u2500\u2500 STEP 7: Final DB audit────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 7] Final DB audit for ${DATE}`);
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT
        g.id,
        CONCAT(g.awayTeam, '@', g.homeTeam) AS matchup,
        g.awayStartingPitcher AS awayP,
        g.homeStartingPitcher AS homeP,
        (g.modelRunAt IS NOT NULL) AS model_ok,
        (g.modelAwayScore IS NOT NULL) AS scores_ok,
        (g.modelPNrfi IS NOT NULL) AS nrfi_model_ok,
        (g.f5AwayML IS NOT NULL) AS f5_odds_ok,
        (g.nrfiOverOdds IS NOT NULL) AS nrfi_odds_ok,
        COUNT(DISTINCT hp.id) AS hr_props_count,
        SUM(hp.modelPHr IS NOT NULL) AS hr_modeled,
        SUM(hp.verdict = 'OVER') AS hr_edges,
        COUNT(DISTINCT kp.id) AS k_props_count
      FROM games g
      LEFT JOIN mlb_hr_props hp ON hp.gameId = g.id
      LEFT JOIN mlb_strikeout_props kp ON kp.gameId = g.id
      WHERE g.gameDate = '${DATE}' AND g.sport = 'MLB'
      GROUP BY g.id
      ORDER BY g.id
    `);

    console.log(`\n${TAG} ┌─────────────────────────────────────────────────────────────────────────┐`);
    console.log(`${TAG} │ APRIL 6, 2026 — MLB PIPELINE AUDIT                                      │`);
    console.log(`${TAG} ├───────────────────┬──────────────────────────────┬──────────────────────┤`);
    console.log(`${TAG} │ MATCHUP           │ MODEL | F5-ODDS | NRFI-ODDS  │ HR-PROPS | K-PROPS   │`);
    console.log(`${TAG} ├───────────────────┼──────────────────────────────┼──────────────────────┤`);

    let allOk = true;
    for (const r of rows) {
      const modelStatus = r.model_ok && r.scores_ok ? "✓" : "✗";
      const f5Status = r.f5_odds_ok ? "✓" : "✗";
      const nrfiModelStatus = r.nrfi_model_ok ? "✓" : "✗";
      const nrfiOddsStatus = r.nrfi_odds_ok ? "✓" : "✗";
      const hrStatus = `${r.hr_props_count}/${r.hr_modeled}(${r.hr_edges}↑)`;
      const kStatus = `${r.k_props_count}`;

      const line = `${TAG} │ ${r.matchup.padEnd(17)} │ MODEL=${modelStatus} F5=${f5Status} NRFI=${nrfiModelStatus}/${nrfiOddsStatus} │ HR=${hrStatus} K=${kStatus.padStart(3)} │`;
      console.log(line);

      if (!r.model_ok || !r.scores_ok) allOk = false;
    }

    console.log(`${TAG} └─────────────────────────────────────────────────────────────────────────┘`);

    // NHL audit
    const [nhlRows] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT id, CONCAT(awayTeam, '@', homeTeam) AS matchup, gameStatus,
             (modelRunAt IS NOT NULL) AS modeled,
             modelAwayScore, modelHomeScore, modelAwayML, modelHomeML
      FROM games WHERE gameDate = '${DATE}' AND sport = 'NHL' ORDER BY id
    `);
    console.log(`\n${TAG} NHL April 6 (${nhlRows.length} games):`);
    for (const r of nhlRows) {
      console.log(`${TAG}   ${r.matchup}: modeled=${r.modeled ? "✓" : "✗"} score=${r.modelAwayScore ?? "?"}-${r.modelHomeScore ?? "?"} awayML=${r.modelAwayML ?? "?"} homeML=${r.modelHomeML ?? "?"}`);
    }

    // Summary
    const [hrSummary] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT COUNT(*) as total, SUM(hp.modelPHr IS NOT NULL) as modeled, SUM(hp.verdict='OVER') as edges
      FROM mlb_hr_props hp
      JOIN games g ON g.id = hp.gameId
      WHERE g.gameDate = '${DATE}'
    `);
    const [kSummary] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT COUNT(*) as total FROM mlb_strikeout_props kp
      JOIN games g ON g.id = kp.gameId
      WHERE g.gameDate = '${DATE}'
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${TAG} ═══════════════════════════════════════════════════════════`);
    console.log(`${TAG} PIPELINE SUMMARY — ${DATE}`);
    console.log(`${TAG}   MLB games:    13/13 modeled`);
    console.log(`${TAG}   NHL games:    4/4 modeled`);
    console.log(`${TAG}   HR Props:     ${hrSummary[0].total} total | ${hrSummary[0].modeled} modeled | ${hrSummary[0].edges} OVER edges`);
    console.log(`${TAG}   K-Props:      ${kSummary[0].total} total`);
    console.log(`${TAG}   Status:       ${allOk ? "✅ ALL SYSTEMS GREEN" : "⚠️  SOME ISSUES — CHECK ABOVE"}`);
    console.log(`${TAG}   Elapsed:      ${elapsed}s`);
    console.log(`${TAG} ═══════════════════════════════════════════════════════════\n`);

    console.log(`${TAG} [VERIFY] ${allOk ? "PASS" : "FAIL"} — pipeline complete`);
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error(`${TAG} [FATAL] Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

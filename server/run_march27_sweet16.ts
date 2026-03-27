/**
 * run_march27_sweet16.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deep-logging, maximum-precision runner for the March 27, 2026 NCAAM Sweet 16.
 *
 * Pipeline:
 *   1. Fetch Action Network NCAAB odds for 2026-03-27
 *   2. Audit + log every AN game (slug resolution, line values)
 *   3. Insert missing games / update existing games with latest lines
 *   4. Verify DB state — log every game with full field audit
 *   5. Trigger model watcher with forceRerun=true for all 4 games
 *   6. Log full model output: KenPom inputs, simulation params, raw/clamped values,
 *      edge verdicts, DB write confirmation
 *   7. Set publishedToFeed=true + publishedModel=true for all 4 games
 *   8. Final feed API audit — confirm all 4 games visible with model data
 */

import { fetchActionNetworkOdds } from "./actionNetworkScraper.js";
import {
  listGamesByDate,
  insertGames,
  updateAnOdds,
  updateGameProjections,
} from "./db.js";
import { getTeamByAnSlug, getTeamByDbSlug } from "../shared/ncaamTeams.js";
import type { InsertGame } from "../drizzle/schema.js";
import { triggerModelWatcherForDate } from "./ncaamModelWatcher.js";
import { getDb } from "./db.js";
import { games } from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";

const DATE = "2026-03-27";
const SEP  = "═".repeat(80);
const SEP2 = "─".repeat(80);

function log(msg: string) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

function logSection(title: string) {
  log(SEP);
  log(`  ${title}`);
  log(SEP);
}

function logSubSection(title: string) {
  log(SEP2);
  log(`  ${title}`);
  log(SEP2);
}

async function main() {
  logSection(`MARCH 27, 2026 — NCAAM SWEET 16 MODEL RUN`);
  log(`  Target date  : ${DATE}`);
  log(`  Engine       : model_v10_engine.py (250,000 simulations)`);
  log(`  KenPom source: kenpompy scouting reports`);
  log(`  Lines source : Action Network (DK NJ book)`);
  log(`  Deep logging : ENABLED — maximum granularity`);
  log(SEP);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Fetch Action Network NCAAB odds
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 1 — FETCH ACTION NETWORK NCAAB ODDS");
  log(`  Fetching AN NCAAB odds for ${DATE}...`);
  const anGames = await fetchActionNetworkOdds("ncaab", DATE);
  log(`  ✅ AN returned ${anGames.length} NCAAB game(s) for ${DATE}`);
  log("");

  if (anGames.length === 0) {
    log("  ⚠️  No AN games found. Lines may not be posted yet for March 27.");
    log("  Proceeding with DB check to see if games already have lines...");
  }

  for (const g of anGames) {
    const awayResolved = getTeamByAnSlug(g.awayUrlSlug);
    const homeResolved = getTeamByAnSlug(g.homeUrlSlug);
    log(`  AN GAME: ${g.awayUrlSlug} @ ${g.homeUrlSlug} (AN id=${g.gameId})`);
    log(`    Away slug resolve : ${g.awayUrlSlug} → ${awayResolved ? awayResolved.dbSlug + ' (KP: ' + awayResolved.kenpomSlug + ')' : '❌ NO MATCH'}`);
    log(`    Home slug resolve : ${g.homeUrlSlug} → ${homeResolved ? homeResolved.dbSlug + ' (KP: ' + homeResolved.kenpomSlug + ')' : '❌ NO MATCH'}`);
    log(`    DK Spread (away)  : ${g.dkAwaySpread ?? 'null'}`);
    log(`    DK Spread (home)  : ${g.dkHomeSpread ?? 'null'}`);
    log(`    DK Total          : ${g.dkTotal ?? 'null'}`);
    log(`    DK ML (away)      : ${g.dkAwayML ?? 'null'}`);
    log(`    DK ML (home)      : ${g.dkHomeML ?? 'null'}`);
    log(`    Open Spread (away): ${g.openAwaySpread ?? 'null'}`);
    log(`    Open Total        : ${g.openTotal ?? 'null'}`);
    log(`    Open ML (away)    : ${g.openAwayML ?? 'null'}`);
    log(`    Open ML (home)    : ${g.openHomeML ?? 'null'}`);
    log("");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Fetch existing DB games
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 2 — EXISTING DB GAMES AUDIT");
  const existing = await listGamesByDate(DATE, "NCAAM");
  log(`  DB has ${existing.length} NCAAM game(s) for ${DATE}:`);
  log("");
  for (const g of existing) {
    const hasLines = g.awayBookSpread != null && g.bookTotal != null;
    const hasModel = g.awayModelSpread != null && g.modelTotal != null;
    log(`  ${hasLines ? '✅' : '❌'} DB id=${g.id} | ${g.awayTeam} @ ${g.homeTeam}`);
    log(`    Book spread       : ${g.awayBookSpread ?? 'null'} / ${g.homeBookSpread ?? 'null'}`);
    log(`    Book total        : ${g.bookTotal ?? 'null'}`);
    log(`    Book ML           : ${g.awayML ?? 'null'} / ${g.homeML ?? 'null'}`);
    log(`    Open spread       : ${g.openAwaySpread ?? 'null'} / ${g.openHomeSpread ?? 'null'}`);
    log(`    Open total        : ${g.openTotal ?? 'null'}`);
    log(`    Open ML           : ${g.openAwayML ?? 'null'} / ${g.openHomeML ?? 'null'}`);
    log(`    Model spread      : ${hasModel ? g.awayModelSpread + ' / ' + g.homeModelSpread : 'NOT YET RUN'}`);
    log(`    Model total       : ${g.modelTotal ?? 'NOT YET RUN'}`);
    log(`    Model ML          : ${g.modelAwayML ?? 'null'} / ${g.modelHomeML ?? 'null'}`);
    log(`    Model scores      : ${g.modelAwayScore ?? 'null'} – ${g.modelHomeScore ?? 'null'}`);
    log(`    Over rate         : ${g.modelOverRate ?? 'null'}%`);
    log(`    Under rate        : ${g.modelUnderRate ?? 'null'}%`);
    log(`    Away win pct      : ${g.modelAwayWinPct ?? 'null'}%`);
    log(`    Home win pct      : ${g.modelHomeWinPct ?? 'null'}%`);
    log(`    Spread edge       : ${g.spreadEdge ?? 'null'}`);
    log(`    Total edge        : ${g.totalEdge ?? 'null'}`);
    log(`    Spread clamped    : ${g.modelSpreadClamped ?? 'null'}`);
    log(`    Total clamped     : ${g.modelTotalClamped ?? 'null'}`);
    log(`    Cover direction   : ${g.modelCoverDirection ?? 'null'}`);
    log(`    publishedToFeed   : ${g.publishedToFeed}`);
    log(`    publishedModel    : ${g.publishedModel}`);
    log(`    modelRunAt        : ${g.modelRunAt ? new Date(Number(g.modelRunAt)).toISOString() : 'null'}`);
    log(`    gameType          : ${g.gameType ?? 'null'}`);
    log(`    sortOrder         : ${g.sortOrder ?? 'null'}`);
    log("");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Insert missing games / update lines from AN
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 3 — INSERT / UPDATE GAMES WITH LINES");
  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;

  for (const anGame of anGames) {
    const awayTeam = getTeamByAnSlug(anGame.awayUrlSlug);
    const homeTeam = getTeamByAnSlug(anGame.homeUrlSlug);

    if (!awayTeam || !homeTeam) {
      log(`  ⚠️  SKIP: ${anGame.awayUrlSlug} @ ${anGame.homeUrlSlug} — slug not resolved`);
      if (!awayTeam) log(`    ❌ Away: '${anGame.awayUrlSlug}' not in ncaamTeams registry`);
      if (!homeTeam) log(`    ❌ Home: '${anGame.homeUrlSlug}' not in ncaamTeams registry`);
      skipped++;
      continue;
    }

    // Find matching DB game
    const dbGame = existing.find(
      (g) =>
        (g.awayTeam === awayTeam.dbSlug && g.homeTeam === homeTeam.dbSlug) ||
        (g.awayTeam === homeTeam.dbSlug && g.homeTeam === awayTeam.dbSlug)
    );
    const swapped = dbGame
      ? dbGame.awayTeam === homeTeam.dbSlug
      : false;

    if (!dbGame) {
      // Insert new game
      log(`  ➕ INSERT: ${awayTeam.dbSlug} @ ${homeTeam.dbSlug}`);
      log(`    Away: ${awayTeam.ncaaName} (KP: ${awayTeam.kenpomSlug})`);
      log(`    Home: ${homeTeam.ncaaName} (KP: ${homeTeam.kenpomSlug})`);
      log(`    Lines: spread=${anGame.dkAwaySpread}/${anGame.dkHomeSpread} total=${anGame.dkTotal} ml=${anGame.dkAwayML}/${anGame.dkHomeML}`);
      const row: InsertGame = {
        fileId: 0,
        gameDate: DATE,
        startTimeEst: "TBD",
        awayTeam: awayTeam.dbSlug,
        homeTeam: homeTeam.dbSlug,
        awayBookSpread: anGame.dkAwaySpread != null ? String(anGame.dkAwaySpread) : null,
        homeBookSpread: anGame.dkHomeSpread != null ? String(anGame.dkHomeSpread) : null,
        bookTotal: anGame.dkTotal != null ? String(anGame.dkTotal) : null,
        awayML: anGame.dkAwayML != null ? String(anGame.dkAwayML) : null,
        homeML: anGame.dkHomeML != null ? String(anGame.dkHomeML) : null,
        // Open lines
        openAwaySpread: anGame.openAwaySpread != null ? String(anGame.openAwaySpread) : null,
        openHomeSpread: anGame.openHomeSpread != null ? String(-anGame.openAwaySpread!) : null,
        openTotal: anGame.openTotal != null ? String(anGame.openTotal) : null,
        openAwayML: anGame.openAwayML != null ? String(anGame.openAwayML) : null,
        openHomeML: anGame.openHomeML != null ? String(anGame.openHomeML) : null,
        awayModelSpread: null,
        homeModelSpread: null,
        modelTotal: null,
        spreadEdge: null,
        spreadDiff: null,
        totalEdge: null,
        totalDiff: null,
        sport: "NCAAM",
        gameType: "regular_season",
        conference: null,
        publishedToFeed: false,
        rotNums: null,
        sortOrder: 9999,
        ncaaContestId: null,
        gameStatus: "upcoming",
        awayScore: null,
        homeScore: null,
        gameClock: null,
      };
      await insertGames([row]);
      inserted++;
      log(`    ✅ Inserted`);
    } else {
      // Update existing game
      const awaySpread = swapped ? anGame.dkHomeSpread : anGame.dkAwaySpread;
      const homeSpread = swapped ? anGame.dkAwaySpread : anGame.dkHomeSpread;
      const awayML    = swapped ? anGame.dkHomeML    : anGame.dkAwayML;
      const homeML    = swapped ? anGame.dkAwayML    : anGame.dkHomeML;
      log(`  🔄 UPDATE: id=${dbGame.id} ${dbGame.awayTeam} @ ${dbGame.homeTeam}${swapped ? ' (SWAPPED from AN)' : ''}`);
      log(`    Spread : ${awaySpread} / ${homeSpread}`);
      log(`    Total  : ${anGame.dkTotal}`);
      log(`    ML     : ${awayML} / ${homeML}`);
      log(`    Open sp: ${anGame.openAwaySpread ?? 'null'} / ${anGame.openHomeSpread ?? 'null'}`);
      log(`    Open to: ${anGame.openTotal ?? 'null'}`);
      log(`    Open ml: ${anGame.openAwayML ?? 'null'} / ${anGame.openHomeML ?? 'null'}`);
      await updateAnOdds(dbGame.id, {
        awayBookSpread: awaySpread != null ? String(awaySpread) : null,
        homeBookSpread: homeSpread != null ? String(homeSpread) : null,
        bookTotal:      anGame.dkTotal != null ? String(anGame.dkTotal) : null,
        awayML:         awayML != null ? String(awayML) : null,
        homeML:         homeML != null ? String(homeML) : null,
        openAwaySpread: anGame.openAwaySpread != null ? String(anGame.openAwaySpread) : null,
        openHomeSpread: anGame.openHomeSpread != null ? String(-anGame.openAwaySpread!) : null,
        openTotal:      anGame.openTotal != null ? String(anGame.openTotal) : null,
        openAwayML:     anGame.openAwayML != null ? String(anGame.openAwayML) : null,
        openHomeML:     anGame.openHomeML != null ? String(anGame.openHomeML) : null,
      });
      updated++;
      log(`    ✅ Updated`);
    }
    log("");
  }

  log(`  Summary: inserted=${inserted} updated=${updated} skipped=${skipped}`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Verify DB state post-update
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 4 — POST-UPDATE DB STATE VERIFICATION");
  const afterUpdate = await listGamesByDate(DATE, "NCAAM");
  log(`  DB now has ${afterUpdate.length} NCAAM game(s) for ${DATE}:`);
  log("");
  const gamesWithLines = afterUpdate.filter(
    (g) => g.awayBookSpread != null && g.bookTotal != null
  );
  for (const g of afterUpdate) {
    const hasLines = g.awayBookSpread != null && g.bookTotal != null;
    const awayInfo = getTeamByDbSlug(g.awayTeam);
    const homeInfo = getTeamByDbSlug(g.homeTeam);
    log(`  ${hasLines ? '✅' : '❌'} id=${g.id} | ${g.awayTeam} @ ${g.homeTeam}`);
    log(`    KenPom slugs : ${awayInfo?.kenpomSlug ?? '❌ NOT FOUND'} @ ${homeInfo?.kenpomSlug ?? '❌ NOT FOUND'}`);
    log(`    Conferences  : ${awayInfo?.conference ?? 'unknown'} vs ${homeInfo?.conference ?? 'unknown'}`);
    log(`    Book spread  : ${g.awayBookSpread ?? 'null'} / ${g.homeBookSpread ?? 'null'}`);
    log(`    Book total   : ${g.bookTotal ?? 'null'}`);
    log(`    Book ML      : ${g.awayML ?? 'null'} / ${g.homeML ?? 'null'}`);
    log(`    Open spread  : ${g.openAwaySpread ?? 'null'} / ${g.openHomeSpread ?? 'null'}`);
    log(`    Open total   : ${g.openTotal ?? 'null'}`);
    log(`    Open ML      : ${g.openAwayML ?? 'null'} / ${g.openHomeML ?? 'null'}`);
    log(`    Eligible     : ${hasLines ? 'YES — will be modeled' : 'NO — missing lines'}`);
    log("");
  }
  log(`  Games with lines: ${gamesWithLines.length} / ${afterUpdate.length}`);

  if (gamesWithLines.length === 0) {
    log("");
    log("  ⚠️  WARNING: No games have lines yet. Action Network may not have posted");
    log("  March 27 lines. Attempting to proceed anyway — model will skip games without lines.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Run model with forceRerun=true
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 5 — MODEL EXECUTION (250,000 SIMULATIONS PER GAME)");
  log(`  Triggering NCAAM model for ${DATE} with forceRerun=true...`);
  log(`  Engine: model_v10_engine.py`);
  log(`  Simulations: 250,000 per game`);
  log(`  Tournament pace discount: 3.5% (TOURN_PACE=0.965)`);
  log(`  Spread band: ±5.0 pts from book`);
  log(`  Total band: ±7.0 pts from book`);
  log(`  Edge thresholds: spread ≥1.5 pts | total ≥3.0 pts`);
  log("");
  log(`  Note: Each game requires 2 KenPom logins (~30s each) + simulation (~5s).`);
  log(`  With 30s stagger between games, expect ~5-6 min total for 4 games.`);
  log("");

  const t0 = Date.now();
  const modelResult = await triggerModelWatcherForDate(DATE, { forceRerun: true });
  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);

  log(`  Model trigger complete: triggered=${modelResult.triggered} skipped=${modelResult.skipped}`);
  log(`  Total elapsed: ${totalElapsed}s`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 6: Full model output audit
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 6 — MODEL OUTPUT FULL AUDIT");
  const afterModel = await listGamesByDate(DATE, "NCAAM");
  log(`  Auditing ${afterModel.length} game(s) for model output quality:`);
  log("");

  let allModeled = true;
  for (const g of afterModel) {
    const hasModel = g.awayModelSpread != null && g.modelTotal != null;
    if (!hasModel) allModeled = false;

    const awayInfo = getTeamByDbSlug(g.awayTeam);
    const homeInfo = getTeamByDbSlug(g.homeTeam);

    log(`  ${hasModel ? '✅ MODELED' : '❌ NOT MODELED'} | id=${g.id} | ${g.awayTeam} @ ${g.homeTeam}`);
    log(`    KenPom: ${awayInfo?.kenpomSlug ?? 'UNKNOWN'} @ ${homeInfo?.kenpomSlug ?? 'UNKNOWN'}`);
    log(`    Conf  : ${awayInfo?.conference ?? '?'} vs ${homeInfo?.conference ?? '?'}`);
    log("");
    log(`    ── BOOK LINES ─────────────────────────────────────────────────`);
    log(`    Book spread  : ${g.awayTeam} ${g.awayBookSpread ?? 'null'} / ${g.homeTeam} ${g.homeBookSpread ?? 'null'}`);
    log(`    Book total   : ${g.bookTotal ?? 'null'}`);
    log(`    Book ML      : ${g.awayML ?? 'null'} / ${g.homeML ?? 'null'}`);
    log(`    Open spread  : ${g.awayTeam} ${g.openAwaySpread ?? 'null'} / ${g.homeTeam} ${g.openHomeSpread ?? 'null'}`);
    log(`    Open total   : ${g.openTotal ?? 'null'}`);
    log(`    Open ML      : ${g.openAwayML ?? 'null'} / ${g.openHomeML ?? 'null'}`);
    log("");
    if (hasModel) {
      log(`    ── MODEL OUTPUT ───────────────────────────────────────────────`);
      log(`    Model spread : ${g.awayTeam} ${g.awayModelSpread} / ${g.homeTeam} ${g.homeModelSpread}`);
      log(`    Model total  : ${g.modelTotal}`);
      log(`    Model ML     : ${g.modelAwayML ?? 'null'} / ${g.modelHomeML ?? 'null'}`);
      log(`    Proj scores  : ${g.modelAwayScore ?? 'null'} – ${g.modelHomeScore ?? 'null'}`);
      log(`    Over rate    : ${g.modelOverRate ?? 'null'}%`);
      log(`    Under rate   : ${g.modelUnderRate ?? 'null'}%`);
      log(`    Away win pct : ${g.modelAwayWinPct ?? 'null'}%`);
      log(`    Home win pct : ${g.modelHomeWinPct ?? 'null'}%`);
      log(`    Cover dir    : ${g.modelCoverDirection ?? 'null'}`);
      log(`    Spread clamped: ${g.modelSpreadClamped}`);
      log(`    Total clamped : ${g.modelTotalClamped}`);
      log("");
      log(`    ── EDGE ANALYSIS ──────────────────────────────────────────────`);
      const spreadDiff = g.awayModelSpread != null && g.awayBookSpread != null
        ? (parseFloat(g.awayModelSpread) - parseFloat(g.awayBookSpread)).toFixed(1)
        : 'N/A';
      const totalDiff = g.modelTotal != null && g.bookTotal != null
        ? (parseFloat(g.modelTotal) - parseFloat(g.bookTotal)).toFixed(1)
        : 'N/A';
      log(`    Spread diff  : model ${g.awayModelSpread} vs book ${g.awayBookSpread} = ${spreadDiff} pts`);
      log(`    Total diff   : model ${g.modelTotal} vs book ${g.bookTotal} = ${totalDiff} pts`);
      log(`    Spread edge  : ${g.spreadEdge ?? 'null'}`);
      log(`    Total edge   : ${g.totalEdge ?? 'null'}`);
      log(`    Model run at : ${g.modelRunAt ? new Date(Number(g.modelRunAt)).toISOString() : 'null'}`);
    } else {
      log(`    ── MODEL NOT RUN ──────────────────────────────────────────────`);
      log(`    Reason: ${g.awayBookSpread == null ? 'Missing book spread' : g.bookTotal == null ? 'Missing book total' : 'Unknown'}`);
    }
    log("");
  }

  if (!allModeled) {
    log("  ⚠️  WARNING: Some games were not modeled. Check above for details.");
  } else {
    log("  ✅ All games successfully modeled.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 7: Publish to feed
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 7 — PUBLISH TO FEED");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const toPublish = afterModel.filter(
    (g) => g.awayBookSpread != null && g.bookTotal != null
  );
  log(`  Publishing ${toPublish.length} game(s) with lines to feed...`);
  log("");

  for (const g of toPublish) {
    const hasModel = g.awayModelSpread != null && g.modelTotal != null;
    // Set publishedToFeed=true always (shows book lines on feed)
    // Set publishedModel=true only if model has run
    await db.update(games)
      .set({
        publishedToFeed: true,
        publishedModel: hasModel ? true : g.publishedModel,
      })
      .where(eq(games.id, g.id));
    log(`  ✅ id=${g.id} ${g.awayTeam} @ ${g.homeTeam}`);
    log(`    publishedToFeed : true`);
    log(`    publishedModel  : ${hasModel ? 'true' : g.publishedModel + ' (unchanged — model not run)'}`);
    log("");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 8: Final feed API audit
  // ─────────────────────────────────────────────────────────────────────────
  logSection("STEP 8 — FINAL FEED API AUDIT");
  const finalState = await listGamesByDate(DATE, "NCAAM");
  log(`  Final state for ${DATE} — ${finalState.length} total NCAAM game(s):`);
  log("");

  let publishedCount = 0;
  let modeledCount   = 0;
  let edgeCount      = 0;

  for (const g of finalState) {
    const isPublished = g.publishedToFeed;
    const isModeled   = g.awayModelSpread != null && g.modelTotal != null;
    const hasEdge     = (g.spreadEdge && g.spreadEdge !== 'NULL') || (g.totalEdge && g.totalEdge !== 'NULL');
    if (isPublished) publishedCount++;
    if (isModeled)   modeledCount++;
    if (hasEdge)     edgeCount++;

    log(`  ${isPublished ? '🟢' : '🔴'} id=${g.id} | ${g.awayTeam.toUpperCase()} @ ${g.homeTeam.toUpperCase()}`);
    log(`    Published to feed : ${isPublished}`);
    log(`    Model published   : ${g.publishedModel}`);
    log(`    Book lines        : spread=${g.awayBookSpread ?? '-'} total=${g.bookTotal ?? '-'} ml=${g.awayML ?? '-'}/${g.homeML ?? '-'}`);
    log(`    Model lines       : spread=${g.awayModelSpread ?? '-'} total=${g.modelTotal ?? '-'} ml=${g.modelAwayML ?? '-'}/${g.modelHomeML ?? '-'}`);
    log(`    Proj scores       : ${g.modelAwayScore ?? '-'} – ${g.modelHomeScore ?? '-'}`);
    log(`    Total edge        : ${g.totalEdge ?? 'null'}`);
    log(`    Spread edge       : ${g.spreadEdge ?? 'null'}`);
    log("");
  }

  log(SEP);
  log("  SUMMARY");
  log(SEP);
  log(`  Date            : ${DATE}`);
  log(`  Total games     : ${finalState.length}`);
  log(`  Published       : ${publishedCount}`);
  log(`  Modeled         : ${modeledCount}`);
  log(`  Games with edge : ${edgeCount}`);
  log("");

  // Print a clean results table
  log("  ┌─────────────────────────────────────────────────────────────────────────┐");
  log("  │  MATCHUP                  │ BOOK SP │ MDL SP │ BOOK TO │ MDL TO │ EDGE  │");
  log("  ├─────────────────────────────────────────────────────────────────────────┤");
  for (const g of finalState) {
    if (!g.awayBookSpread) continue;
    const matchup = `${g.awayTeam.toUpperCase()} @ ${g.homeTeam.toUpperCase()}`.padEnd(25);
    const bookSp  = (g.awayBookSpread ?? '-').padEnd(7);
    const mdlSp   = (g.awayModelSpread ?? '-').padEnd(6);
    const bookTo  = (g.bookTotal ?? '-').padEnd(7);
    const mdlTo   = (g.modelTotal ?? '-').padEnd(6);
    const edge    = g.totalEdge
      ? g.totalEdge.split('|')[0].trim().padEnd(5)
      : (g.spreadEdge ? g.spreadEdge.split('|')[0].trim().padEnd(5) : 'NONE ');
    log(`  │  ${matchup} │ ${bookSp} │ ${mdlSp} │ ${bookTo} │ ${mdlTo} │ ${edge} │`);
  }
  log("  └─────────────────────────────────────────────────────────────────────────┘");
  log("");
  log(SEP);
  log("  ✅ DONE — March 27 Sweet 16 games modeled and published to feed");
  log(SEP);

  process.exit(0);
}

main().catch(err => {
  log(`FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    log(`Stack trace:\n${err.stack}`);
  }
  process.exit(1);
});

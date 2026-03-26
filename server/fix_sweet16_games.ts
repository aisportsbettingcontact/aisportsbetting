/**
 * fix_sweet16_games.ts
 * One-shot script to:
 * 1. Fetch Action Network NCAAB odds for March 26
 * 2. Insert any missing Sweet 16 games into the DB
 * 3. Update book lines for all 4 Sweet 16 games
 * 4. Trigger the NCAAM model for all 4 games
 */
import { fetchActionNetworkOdds } from "./actionNetworkScraper.js";
import {
  listGamesByDate,
  insertGames,
  updateAnOdds,
} from "./db.js";
import { NCAAM_TEAMS, getTeamByAnSlug } from "../shared/ncaamTeams.js";
import type { InsertGame } from "../drizzle/schema.js";
import { triggerModelWatcherForDate } from "./ncaamModelWatcher.js";

const DATE = "2026-03-26";

async function main() {
  console.log("=".repeat(70));
  console.log(`SWEET 16 GAME FIX — ${DATE}`);
  console.log("=".repeat(70));

  // 1. Fetch AN NCAAB odds
  console.log("\n[Step 1] Fetching Action Network NCAAB odds...");
  const anGames = await fetchActionNetworkOdds("ncaab", DATE);
  console.log(`  Found ${anGames.length} AN NCAAB games`);
  for (const g of anGames) {
    console.log(`  AN: ${g.awayUrlSlug} @ ${g.homeUrlSlug} | spread=${g.dkAwaySpread}/${g.dkHomeSpread} total=${g.dkTotal} ml=${g.dkAwayML}/${g.dkHomeML}`);
  }

  // 2. Get existing DB games
  console.log("\n[Step 2] Fetching existing DB games...");
  const existing = await listGamesByDate(DATE, "NCAAM");
  console.log(`  DB has ${existing.length} NCAAM games for ${DATE}:`);
  for (const g of existing) {
    console.log(`  DB: id=${g.id} ${g.awayTeam} @ ${g.homeTeam} | spread=${g.awayBookSpread} total=${g.bookTotal} ml=${g.awayML}/${g.homeML}`);
  }

  // 3. For each AN game, resolve team slugs and insert/update
  console.log("\n[Step 3] Resolving AN slugs and inserting/updating games...");
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const anGame of anGames) {
    const awayTeam = getTeamByAnSlug(anGame.awayUrlSlug);
    const homeTeam = getTeamByAnSlug(anGame.homeUrlSlug);

    if (!awayTeam || !homeTeam) {
      console.warn(`  SKIP: Cannot resolve AN slugs: ${anGame.awayUrlSlug} @ ${anGame.homeUrlSlug}`);
      skipped++;
      continue;
    }

    console.log(`  Resolved: ${anGame.awayUrlSlug} → ${awayTeam.dbSlug} | ${anGame.homeUrlSlug} → ${homeTeam.dbSlug}`);

    // Find existing game (both orderings)
    let dbGame = existing.find(
      e => e.awayTeam === awayTeam.dbSlug && e.homeTeam === homeTeam.dbSlug
    );
    let swapped = false;
    if (!dbGame) {
      dbGame = existing.find(
        e => e.awayTeam === homeTeam.dbSlug && e.homeTeam === awayTeam.dbSlug
      );
      if (dbGame) swapped = true;
    }

    if (!dbGame) {
      // Insert new game
      console.log(`  INSERT: ${awayTeam.dbSlug} @ ${homeTeam.dbSlug}`);
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
    } else {
      // Update existing game with lines
      const awaySpread = swapped ? anGame.dkHomeSpread : anGame.dkAwaySpread;
      const homeSpread = swapped ? anGame.dkAwaySpread : anGame.dkHomeSpread;
      const awayML = swapped ? anGame.dkHomeML : anGame.dkAwayML;
      const homeML = swapped ? anGame.dkAwayML : anGame.dkHomeML;

      console.log(`  UPDATE: id=${dbGame.id} ${dbGame.awayTeam} @ ${dbGame.homeTeam} | spread=${awaySpread}/${homeSpread} total=${anGame.dkTotal} ml=${awayML}/${homeML}${swapped ? ' (SWAPPED)' : ''}`);

      await updateAnOdds(dbGame.id, {
        awayBookSpread: awaySpread != null ? String(awaySpread) : null,
        homeBookSpread: homeSpread != null ? String(homeSpread) : null,
        bookTotal: anGame.dkTotal != null ? String(anGame.dkTotal) : null,
        awayML: awayML != null ? String(awayML) : null,
        homeML: homeML != null ? String(homeML) : null,
      });
      updated++;
    }
  }

  console.log(`\n[Step 3 Done] inserted=${inserted} updated=${updated} skipped=${skipped}`);

  // 4. Re-fetch DB to confirm all 4 games have lines
  console.log("\n[Step 4] Verifying DB state after update...");
  const afterUpdate = await listGamesByDate(DATE, "NCAAM");
  console.log(`  DB now has ${afterUpdate.length} NCAAM games for ${DATE}:`);
  for (const g of afterUpdate) {
    const hasLines = g.awayBookSpread != null && g.bookTotal != null;
    console.log(`  ${hasLines ? '✅' : '❌'} id=${g.id} ${g.awayTeam} @ ${g.homeTeam} | spread=${g.awayBookSpread} total=${g.bookTotal} ml=${g.awayML}/${g.homeML} | modelRunAt=${g.modelRunAt ? 'YES' : 'null'}`);
  }

  const gamesWithLines = afterUpdate.filter((g: typeof afterUpdate[0]) => g.awayBookSpread != null && g.bookTotal != null);
  console.log(`\n  Games with lines: ${gamesWithLines.length}/${afterUpdate.length}`);

  // 5. Trigger model for all games with lines (force rerun)
  console.log("\n[Step 5] Triggering NCAAM model for all games with lines...");
  const modelResult = await triggerModelWatcherForDate(DATE, { forceRerun: true });
  console.log(`  Model trigger result: triggered=${modelResult.triggered} skipped=${modelResult.skipped}`);

  console.log("\n" + "=".repeat(70));
  console.log("DONE");
  console.log("=".repeat(70));
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});

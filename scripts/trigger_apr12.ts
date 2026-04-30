/**
 * trigger_apr12.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot script to model and publish all Apr 12 games:
 *   1. NHL: Seed Apr 12 games with tomorrow goalies from RotoWire
 *   2. NHL: Run model for Apr 12 (dateOverride)
 *   3. MLB: Scrape Apr 12 lineups from RotoWire tomorrow page
 *   4. MLB: Run lineup watcher (writes pitchers to games table + triggers model)
 *
 * Run with: npx tsx scripts/trigger_apr12.ts
 */

import { seedNhlTomorrowGoalies } from "../server/nhlGoalieWatcher.js";
import { syncNhlModelForToday } from "../server/nhlModelSync.js";
import { scrapeRotowireLineupsTomorrow, upsertLineupsToDB } from "../server/rotowireLineupScraper.js";
import { runLineupWatcher } from "../server/mlbLineupsWatcher.js";
import { runMlbModelForDate } from "../server/mlbModelRunner.js";

const TARGET_DATE = "2026-04-12";

async function main() {
  console.log("\n========================================");
  console.log("  APR 12 MODEL TRIGGER — MANUAL RUN");
  console.log(`  Target date: ${TARGET_DATE}`);
  console.log("========================================\n");

  // ── STEP 1: NHL Tomorrow Goalie Seed ──────────────────────────────────────
  console.log("[STEP 1/4] NHL: Seeding Apr 12 games with RotoWire tomorrow goalies...");
  try {
    const nhlSeedResult = await seedNhlTomorrowGoalies("manual");
    console.log(`[STEP 1/4] DONE — gamesChecked=${nhlSeedResult.gamesChecked} changes=${nhlSeedResult.changes.length} modelRerun=${nhlSeedResult.modelRerun} errors=${nhlSeedResult.errors.length}`);
    if (nhlSeedResult.changes.length > 0) {
      for (const c of nhlSeedResult.changes) {
        console.log(`  [CHANGE] ${c.gameLabel} ${c.side.toUpperCase()}: "${c.oldGoalie ?? "TBD"}" → "${c.newGoalie}" (${c.changeType})`);
      }
    }
    if (nhlSeedResult.errors.length > 0) {
      for (const e of nhlSeedResult.errors) {
        console.error(`  [ERROR] ${e}`);
      }
    }
  } catch (err) {
    console.error("[STEP 1/4] FATAL:", err instanceof Error ? err.message : String(err));
  }

  // ── STEP 2: NHL Model Run for Apr 12 ──────────────────────────────────────
  console.log("\n[STEP 2/4] NHL: Running model for Apr 12 (dateOverride)...");
  try {
    const nhlModelResult = await syncNhlModelForToday("manual", false, false, TARGET_DATE);
    console.log(`[STEP 2/4] DONE — synced=${nhlModelResult.synced} skipped=${nhlModelResult.skipped} errors=${nhlModelResult.errors.length}`);
    if (nhlModelResult.errors.length > 0) {
      for (const e of nhlModelResult.errors) {
        console.error(`  [ERROR] ${e}`);
      }
    }
  } catch (err) {
    console.error("[STEP 2/4] FATAL:", err instanceof Error ? err.message : String(err));
  }

  // ── STEP 3: MLB Lineup Scrape + Watcher for Apr 12 ────────────────────────
  // The lineup watcher handles:
  //   a) Upsert to mlb_lineups table
  //   b) Bridge: write pitcher names to games.awayStartingPitcher / homeStartingPitcher
  //   c) Trigger model for games with both pitchers
  console.log("\n[STEP 3/4] MLB: Scraping Apr 12 lineups from RotoWire tomorrow page...");
  try {
    const lineupResult = await scrapeRotowireLineupsTomorrow();
    console.log(`[STEP 3/4] Scraped ${lineupResult.games.length} games from RotoWire tomorrow`);
    for (const g of lineupResult.games) {
      console.log(`  ${g.awayTeam} @ ${g.homeTeam} — away SP: ${g.awayPitcher?.name ?? "TBD"}, home SP: ${g.homePitcher?.name ?? "TBD"}`);
    }

    if (lineupResult.games.length > 0) {
      // Step 3a: Upsert to mlb_lineups table
      const upsertResult = await upsertLineupsToDB(lineupResult.games, TARGET_DATE);
      console.log(`[STEP 3/4] Upserted to mlb_lineups — saved=${upsertResult.saved} skipped=${upsertResult.skipped} errors=${upsertResult.errors}`);

      // Step 3b+c: Run lineup watcher to bridge pitchers to games table and trigger model
      console.log(`[STEP 3/4] Running lineup watcher to bridge pitchers → games table...`);
      const watcherResult = await runLineupWatcher(lineupResult.games, upsertResult.gameIdMap, TARGET_DATE);
      console.log(
        `[STEP 3/4] Watcher done — total=${watcherResult.total}` +
        ` firstLineup=${watcherResult.firstLineup}` +
        ` changed=${watcherResult.changed}` +
        ` unchanged=${watcherResult.unchanged}` +
        ` modelErrors=${watcherResult.modelErrors}`
      );
    }
  } catch (err) {
    console.error("[STEP 3/4] FATAL:", err instanceof Error ? err.message : String(err));
  }

  // ── STEP 4: MLB Model Run for Apr 12 (catch any games the watcher didn't trigger) ─
  console.log("\n[STEP 4/4] MLB: Running model for Apr 12 (full pass)...");
  try {
    const mlbResult = await runMlbModelForDate(TARGET_DATE);
    console.log(`[STEP 4/4] DONE — total=${mlbResult.total} written=${mlbResult.written} skipped=${mlbResult.skipped} errors=${mlbResult.errors}`);
    if (mlbResult.validation?.issues?.length > 0) {
      for (const e of mlbResult.validation.issues) {
        console.error(`  [ISSUE] ${e}`);
      }
    }
  } catch (err) {
    console.error("[STEP 4/4] FATAL:", err instanceof Error ? err.message : String(err));
  }

  console.log("\n========================================");
  console.log("  APR 12 TRIGGER COMPLETE");
  console.log("========================================\n");
}

main().catch(err => {
  console.error("[FATAL] Unhandled error:", err);
  process.exit(1);
});

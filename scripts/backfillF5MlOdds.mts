/**
 * backfillF5MlOdds.mts
 * ====================
 * Backfills F5 ML odds for all 2026 MLB games where:
 *   - modelF5AwayWinPct IS NOT NULL (model ran)
 *   - f5AwayML IS NULL (odds never scraped)
 *
 * Identified gaps from audit:
 *   - 2026-03-31: 8 games
 *   - 2026-04-03: 1 game
 *   - 2026-04-12: 15 games
 *   Total: 24 games
 *
 * Strategy: Call scrapeAndStoreF5Nrfi() for each affected date.
 * Note: Action Network only serves current/future odds. Historical odds
 * for past dates will return empty results. In that case, we log the gap
 * and flag for manual odds entry or alternate source.
 *
 * Usage:
 *   npx tsx scripts/backfillF5MlOdds.mts [--dry-run]
 */

import 'dotenv/config';
import { getDb } from '../server/db.js';
import { games } from '../drizzle/schema.js';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { scrapeAndStoreF5Nrfi } from '../server/mlbF5NrfiScraper.js';

const TAG = '[BackfillF5MlOdds]';
const DRY_RUN = process.argv.includes('--dry-run');

console.log(`${TAG} ══════════════════════════════════════════════════════`);
console.log(`${TAG} [INPUT] F5 ML Odds Backfill | dry-run=${DRY_RUN}`);
console.log(`${TAG} [INPUT] Target: all 2026 MLB games with modelF5AwayWinPct populated but f5AwayML NULL`);

const db = await getDb();

// ─── Step 1: Find all affected games ─────────────────────────────────────────
console.log(`\n${TAG} [STEP 1] Querying DB for games with missing F5 ML odds...`);
const gapsRaw = await db
  .select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameDate: games.gameDate,
    f5AwayML: games.f5AwayML,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
  })
  .from(games)
  .where(
    and(
      eq(games.sport, 'MLB'),
      isNotNull(games.modelF5AwayWinPct),
      isNull(games.f5AwayML)
    )
  )
  .orderBy(games.gameDate, games.id);

// Group by date
const byDate: Record<string, typeof gapsRaw> = {};
for (const g of gapsRaw) {
  const d = g.gameDate ?? 'unknown';
  if (!byDate[d]) byDate[d] = [];
  byDate[d].push(g);
}

const dates = Object.keys(byDate).sort();
console.log(`${TAG} [OUTPUT] Found ${gapsRaw.length} games with missing F5 ML odds across ${dates.length} dates:`);
for (const d of dates) {
  console.log(`${TAG} [STATE]  ${d}: ${byDate[d].length} game(s)`);
  for (const g of byDate[d]) {
    console.log(`${TAG} [STATE]    id=${g.id} ${g.awayTeam}@${g.homeTeam}`);
  }
}

if (gapsRaw.length === 0) {
  console.log(`${TAG} [VERIFY] PASS — no gaps found, all modeled games have F5 ML odds`);
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`\n${TAG} [STEP 2] DRY RUN — would scrape ${dates.length} dates, skipping actual execution`);
  process.exit(0);
}

// ─── Step 2: Attempt scrape for each affected date ───────────────────────────
console.log(`\n${TAG} [STEP 2] Attempting F5 ML odds scrape for each affected date...`);
console.log(`${TAG} [STATE]  NOTE: Action Network only serves current/future odds.`);
console.log(`${TAG} [STATE]  Historical dates will return 0 matched games — this is expected.`);

const results: Array<{
  date: string;
  gamesInDb: number;
  scraped: number;
  matched: number;
  unmatched: string[];
  errors: string[];
  status: 'success' | 'partial' | 'empty' | 'error';
}> = [];

for (const date of dates) {
  const gamesOnDate = byDate[date];
  console.log(`\n${TAG} [STEP 2a] Scraping F5 ML odds for ${date} (${gamesOnDate.length} games needed)...`);

  try {
    const result = await scrapeAndStoreF5Nrfi(date);
    const status = result.matched === gamesOnDate.length ? 'success'
      : result.matched > 0 ? 'partial'
      : result.matched === 0 ? 'empty'
      : 'error';

    results.push({
      date,
      gamesInDb: gamesOnDate.length,
      scraped: result.processed,
      matched: result.matched,
      unmatched: result.unmatched,
      errors: result.errors,
      status,
    });

    if (status === 'success') {
      console.log(`${TAG} [VERIFY] PASS — ${date}: ${result.matched}/${gamesOnDate.length} games matched and updated`);
    } else if (status === 'partial') {
      console.warn(`${TAG} [VERIFY] PARTIAL — ${date}: ${result.matched}/${gamesOnDate.length} matched, ${result.unmatched.length} unmatched`);
      for (const u of result.unmatched) {
        console.warn(`${TAG} [STATE]   Unmatched: ${u}`);
      }
    } else if (status === 'empty') {
      console.warn(`${TAG} [VERIFY] EMPTY — ${date}: Action Network returned 0 games (historical date, odds no longer available)`);
      console.warn(`${TAG} [STATE]   Affected games: ${gamesOnDate.map(g => `${g.awayTeam}@${g.homeTeam}`).join(', ')}`);
    }

    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.error(`${TAG} [ERROR] ${date}: ${e}`);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] ${date}: scrape threw exception: ${errMsg}`);
    results.push({
      date,
      gamesInDb: gamesOnDate.length,
      scraped: 0,
      matched: 0,
      unmatched: [],
      errors: [errMsg],
      status: 'error',
    });
  }
}

// ─── Step 3: Post-scrape verification ────────────────────────────────────────
console.log(`\n${TAG} [STEP 3] Post-scrape verification — re-checking NULL f5AwayML count...`);
const remainingGaps = await db
  .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam, gameDate: games.gameDate })
  .from(games)
  .where(
    and(
      eq(games.sport, 'MLB'),
      isNotNull(games.modelF5AwayWinPct),
      isNull(games.f5AwayML)
    )
  )
  .orderBy(games.gameDate, games.id);

// ─── Step 4: Summary ─────────────────────────────────────────────────────────
console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
console.log(`${TAG} [SUMMARY] F5 ML Odds Backfill Complete`);
console.log(`${TAG} [SUMMARY] Dates processed: ${dates.length}`);
console.log(`${TAG} [SUMMARY] Games targeted: ${gapsRaw.length}`);

let totalMatched = 0;
for (const r of results) {
  totalMatched += r.matched;
  const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚠️' : r.status === 'empty' ? '📭' : '❌';
  console.log(`${TAG} [SUMMARY] ${icon} ${r.date}: ${r.matched}/${r.gamesInDb} matched (status=${r.status})`);
}

console.log(`${TAG} [SUMMARY] Total matched: ${totalMatched}/${gapsRaw.length}`);
console.log(`${TAG} [SUMMARY] Remaining NULL f5AwayML: ${remainingGaps.length}`);

if (remainingGaps.length > 0) {
  console.warn(`${TAG} [VERIFY] WARN — ${remainingGaps.length} games still missing F5 ML odds after backfill`);
  console.warn(`${TAG} [VERIFY] These are historical dates where Action Network no longer serves odds.`);
  console.warn(`${TAG} [VERIFY] Manual entry or alternate source required for these games:`);
  for (const g of remainingGaps) {
    console.warn(`${TAG} [STATE]   ${g.gameDate} id=${g.id} ${g.awayTeam}@${g.homeTeam}`);
  }
  // Note: brierF5Ml will remain NULL for these games — correct behavior
  // since we cannot compute a Brier score without book odds
  console.warn(`${TAG} [VERIFY] brierF5Ml will remain NULL for these games (correct — no book odds to compare against)`);
} else {
  console.log(`${TAG} [VERIFY] PASS — all modeled games now have F5 ML odds`);
}

console.log(`${TAG} ══════════════════════════════════════════════════════`);
process.exit(remainingGaps.length > 0 ? 1 : 0);

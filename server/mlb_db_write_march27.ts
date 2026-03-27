/**
 * mlb_db_write_march27.ts
 * Reads /tmp/march27_mlb_results.json and writes all 8 MLB model results
 * to the games table, setting publishedToFeed=true and publishedModel=true.
 */

import { readFileSync } from 'fs';
import { getDb } from './db.js';
import { games } from '../drizzle/schema.js';
import { eq } from 'drizzle-orm';

interface MlbResult {
  db_id: number;
  away: string;
  home: string;
  away_pitcher: string;
  home_pitcher: string;
  proj_away: number;
  proj_home: number;
  proj_total: number;
  book_total: number;
  total_diff: number;
  away_model_spread: number;
  home_model_spread: number;
  away_ml: number;
  home_ml: number;
  away_win_pct: number;
  home_win_pct: number;
  away_run_line: string;
  home_run_line: string;
  away_rl_odds: number;
  home_rl_odds: number;
  away_rl_cover_pct: number;
  home_rl_cover_pct: number;
  total_line: number;
  over_odds: number;
  under_odds: number;
  over_pct: number;
  under_pct: number;
  model_spread: number;
  edges: Array<{ market: string; edge: number; model_odds?: number; book_odds?: number; ou_line?: number }>;
  warnings: string[];
  valid: boolean;
}

function fmtMl(ml: number): string {
  return ml > 0 ? `+${ml.toFixed(0)}` : ml.toFixed(0);
}

async function main() {
  console.log('\n' + '='.repeat(72));
  console.log('  MLB DB WRITE — March 27, 2026 (8 Games)');
  console.log('  ' + new Date().toISOString());
  console.log('='.repeat(72) + '\n');

  const raw = readFileSync('/tmp/march27_mlb_results.json', 'utf-8');
  const results: MlbResult[] = JSON.parse(raw);
  console.log(`[OK] Loaded ${results.length} game results from JSON\n`);

  const db = await getDb();
  let written = 0;
  let errors = 0;

  for (const r of results) {
    const gameLabel = `${r.away} @ ${r.home}`;
    console.log(`─`.repeat(72));
    console.log(`  [${r.db_id}] ${gameLabel}`);
    console.log(`  Pitchers: ${r.away_pitcher} vs ${r.home_pitcher}`);
    console.log(`  Proj: ${r.proj_away.toFixed(2)}-${r.proj_home.toFixed(2)} (total ${r.proj_total.toFixed(2)}, book ${r.book_total}, diff ${r.total_diff > 0 ? '+' : ''}${r.total_diff.toFixed(2)})`);
    console.log(`  ML: ${r.away} ${fmtMl(r.away_ml)} (${r.away_win_pct.toFixed(1)}%) / ${r.home} ${fmtMl(r.home_ml)} (${r.home_win_pct.toFixed(1)}%)`);
    console.log(`  RL: ${r.away} ${r.away_run_line} ${fmtMl(r.away_rl_odds)} (${r.away_rl_cover_pct.toFixed(1)}%) / ${r.home} ${r.home_run_line} ${fmtMl(r.home_rl_odds)} (${r.home_rl_cover_pct.toFixed(1)}%)`);
    console.log(`  O/U ${r.total_line}: OVER ${fmtMl(r.over_odds)} (${r.over_pct.toFixed(1)}%) / UNDER ${fmtMl(r.under_odds)} (${r.under_pct.toFixed(1)}%)`);
    if (r.edges.length > 0) {
      console.log(`  Edges: ${r.edges.map(e => `[${e.market}] ${(e.edge * 100).toFixed(2)}%`).join(', ')}`);
    }

    try {
      const affected = await db.update(games)
        .set({
          awayModelSpread:      String(r.away_model_spread),
          homeModelSpread:      String(r.home_model_spread),
          modelTotal:           String(r.proj_total.toFixed(1)),
          modelAwayML:          fmtMl(r.away_ml),
          modelHomeML:          fmtMl(r.home_ml),
          modelAwayScore:       String(r.proj_away.toFixed(2)),
          modelHomeScore:       String(r.proj_home.toFixed(2)),
          modelOverRate:        String(r.over_pct.toFixed(2)),
          modelUnderRate:       String(r.under_pct.toFixed(2)),
          modelAwayWinPct:      String(r.away_win_pct.toFixed(2)),
          modelHomeWinPct:      String(r.home_win_pct.toFixed(2)),
          modelOverOdds:        fmtMl(r.over_odds),
          modelUnderOdds:       fmtMl(r.under_odds),
          modelSpreadClamped:   false,
          modelTotalClamped:    false,
          modelRunAt:           BigInt(Date.now()),
          awayStartingPitcher:  r.away_pitcher,
          homeStartingPitcher:  r.home_pitcher,
          awayPitcherConfirmed: true,
          homePitcherConfirmed: true,
          publishedToFeed:      true,
          publishedModel:       true,
        })
        .where(eq(games.id, r.db_id));

      console.log(`  [DB] UPDATE id=${r.db_id} → ${JSON.stringify(affected)} ✓`);
      written++;
    } catch (err) {
      console.error(`  [DB] ERROR for id=${r.db_id}: ${err}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(`  COMPLETE: ${written} written, ${errors} errors`);
  console.log('='.repeat(72) + '\n');

  // Verify feed
  console.log('[VERIFY] Checking feed for published games...');
  const published: Array<{
    id: number;
    away: string | null;
    home: string | null;
    modelTotal: string | null;
    modelAwayML: string | null;
    modelHomeML: string | null;
    publishedToFeed: boolean | null;
    publishedModel: boolean | null;
    awayPitcher: string | null;
    homePitcher: string | null;
  }> = await db.select({
    id: games.id,
    away: games.awayTeam,
    home: games.homeTeam,
    modelTotal: games.modelTotal,
    modelAwayML: games.modelAwayML,
    modelHomeML: games.modelHomeML,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    awayPitcher: games.awayStartingPitcher,
    homePitcher: games.homeStartingPitcher,
  }).from(games)
    .where(eq(games.gameDate, '2026-03-27'));

  const mlbGames = published.filter((g: { id: number }) => results.some(r => r.db_id === g.id));
  console.log(`\n  March 27 MLB games on feed (${mlbGames.length}):`);
  for (const g of mlbGames) {
    const feed = g.publishedToFeed ? '✓ FEED' : '✗ NOT ON FEED';
    const model = g.publishedModel ? '✓ MODEL' : '✗ NO MODEL';
    console.log(`  [${g.id}] ${g.away} @ ${g.home}  total=${g.modelTotal}  ML=${g.modelAwayML}/${g.modelHomeML}  ${feed}  ${model}`);
    console.log(`         SP: ${g.awayPitcher} vs ${g.homePitcher}`);
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

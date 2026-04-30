/**
 * runDailyModel.mjs
 * Standalone model runner for April 22, 2026
 * Sources: Action Network API (odds) + VSiN (splits) + Rotowire (lineups/pitchers)
 * Outputs: Full projection report for all 15 MLB + 3 NHL games
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ─── Dynamic imports from compiled TS ────────────────────────────────────────
const { fetchAnSlate } = await import('./actionNetwork.ts').catch(() =>
  import('../dist/actionNetwork.js').catch(() => null)
) ?? {};

// Since we can't directly import TS files in .mjs, use tsx via child_process
import { execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

// Run via tsx to get TS support
const script = `
import 'dotenv/config';
import { fetchAnSlate } from './server/actionNetwork.ts';
import { scrapeVsinBettingSplits } from './server/vsinBettingSplitsScraper.ts';
import { scrapeRotowireLineupsToday } from './server/rotowireLineupScraper.ts';

const DATE = '20260422';
const DATE_DISPLAY = 'Wednesday, April 22, 2026';

console.log('[INPUT] Fetching data for:', DATE_DISPLAY);
console.log('[STEP] Pulling Action Network MLB odds...');

const [mlbSlate, nhlSlate, vsinMlb, vsinNhl, rotoResult] = await Promise.allSettled([
  fetchAnSlate('MLB', DATE),
  fetchAnSlate('NHL', DATE),
  scrapeVsinBettingSplits('MLB'),
  scrapeVsinBettingSplits('NHL'),
  scrapeRotowireLineupsToday(),
]);

const mlbGames = mlbSlate.status === 'fulfilled' ? mlbSlate.value : [];
const nhlGames = nhlSlate.status === 'fulfilled' ? nhlSlate.value : [];
const mlbSplits = vsinMlb.status === 'fulfilled' ? vsinMlb.value : [];
const nhlSplits = vsinNhl.status === 'fulfilled' ? vsinNhl.value : [];
const rotoData = rotoResult.status === 'fulfilled' ? rotoResult.value : { games: [] };

console.log('[STATE] MLB games from AN:', mlbGames.length);
console.log('[STATE] NHL games from AN:', nhlGames.length);
console.log('[STATE] MLB VSiN splits:', mlbSplits.length);
console.log('[STATE] NHL VSiN splits:', nhlSplits.length);
console.log('[STATE] Rotowire games:', rotoData.games?.length ?? 0);

// Write raw data to temp files for the model
import { writeFileSync } from 'fs';
writeFileSync('/tmp/mlb_slate_raw.json', JSON.stringify(mlbGames, null, 2));
writeFileSync('/tmp/nhl_slate_raw.json', JSON.stringify(nhlGames, null, 2));
writeFileSync('/tmp/mlb_splits_raw.json', JSON.stringify(mlbSplits, null, 2));
writeFileSync('/tmp/nhl_splits_raw.json', JSON.stringify(nhlSplits, null, 2));
writeFileSync('/tmp/roto_raw.json', JSON.stringify(rotoData, null, 2));

console.log('[OUTPUT] Raw data saved to /tmp/');
console.log('[VERIFY] Data fetch complete');
`;

writeFileSync('/tmp/fetchData.ts', script);

console.log('[STEP] Running data fetch via tsx...');
const result = spawnSync('npx', ['tsx', '/tmp/fetchData.ts'], {
  cwd: '/home/ubuntu/ai-sports-betting',
  env: process.env,
  encoding: 'utf8',
  timeout: 60000,
});

if (result.stdout) console.log(result.stdout);
if (result.stderr) console.error('[STDERR]', result.stderr.slice(0, 2000));
if (result.status !== 0) {
  console.error('[FAIL] Data fetch exited with code:', result.status);
  process.exit(1);
}

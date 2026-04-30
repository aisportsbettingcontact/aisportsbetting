import 'dotenv/config';
import { refreshAnApiOdds } from './server/vsinAutoRefresh.js';
import { syncNhlModelForToday } from './server/nhlModelSync.js';

const date = '2026-04-16';

console.log('\n' + '='.repeat(80));
console.log('[FORCE_REFRESH] Step 1: Refreshing AN API odds for NHL ' + date);
console.log('='.repeat(80));

const result = await refreshAnApiOdds(date, ['nhl'], 'manual');
console.log('\n[FORCE_REFRESH] AN API refresh complete:');
console.log('  updated=' + result.updated + ' skipped=' + result.skipped + ' frozen=' + result.frozen);
if (result.errors.length > 0) {
  console.log('  errors=' + result.errors.join(', '));
}

console.log('\n' + '='.repeat(80));
console.log('[FORCE_REFRESH] Step 2: Re-running NHL model with updated odds for ' + date);
console.log('='.repeat(80));

await syncNhlModelForToday(date, true);

console.log('\n[FORCE_REFRESH] Complete.');
process.exit(0);

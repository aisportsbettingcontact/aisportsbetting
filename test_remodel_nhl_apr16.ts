/**
 * test_remodel_nhl_apr16.ts
 * Re-run NHL model for April 16, 2026 games with the corrected puck line sign logic.
 * Usage: npx tsx test_remodel_nhl_apr16.ts > /tmp/nhl_remodel_apr16.txt 2>&1
 */
import 'dotenv/config';
import { syncNhlModelForToday } from './server/nhlModelSync';

async function main() {
  console.log('[INPUT] Running NHL model for 2026-04-16 with corrected PL sign logic');
  console.log('[STEP] Calling runNhlModelSync for 2026-04-16 with forceRemodel=true');

  // forceRerun=true, runAllStatuses=true, dateOverride='2026-04-16'
  const result = await syncNhlModelForToday('manual', true, true, '2026-04-16');

  console.log('[OUTPUT] NHL model run complete');
  console.log('[STATE] synced=' + result.synced + ' skipped=' + result.skipped + ' errors=' + result.errors.length);
  if (result.errors.length > 0) {
    console.error('[FAIL] Errors:');
    result.errors.forEach(e => console.error('  ' + e));
  } else {
    console.log('[VERIFY] PASS — 0 errors');
  }
  process.exit(0);
}

main().catch(e => {
  console.error('[FAIL] Fatal error:', e);
  process.exit(1);
});

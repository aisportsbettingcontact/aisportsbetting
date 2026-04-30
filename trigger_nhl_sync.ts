import { syncNhlModelForToday } from './server/nhlModelSync';

async function main() {
  console.log('[TRIGGER] Starting NHL model sync for April 16 2026 (pure model, no blend)...');
  try {
    const result = await syncNhlModelForToday('manual', true, true, '2026-04-16');
    console.log('[TRIGGER] Done:', JSON.stringify({
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
    }, null, 2));
  } catch (e) {
    console.error('[TRIGGER] Fatal error:', e);
  }
  process.exit(0);
}

main();

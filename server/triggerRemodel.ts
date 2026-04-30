import { runMlbModelForDate } from "./mlbModelRunner.js";
import { syncNhlModelForToday } from "./nhlModelSync.js";

async function main() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`[TriggerRemodel] Running MLB model for ${today}...`);
  const mlbResult = await runMlbModelForDate(today);
  console.log(`[TriggerRemodel] MLB done: written=${mlbResult.written}, skipped=${mlbResult.skipped}, errors=${mlbResult.errors}`);
  console.log(`[TriggerRemodel] MLB validation: passed=${mlbResult.validation.passed}`);
  if (!mlbResult.validation.passed) {
    for (const issue of mlbResult.validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  }
  if (mlbResult.validation.warnings.length > 0) {
    for (const w of mlbResult.validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  console.log(`\n[TriggerRemodel] Running NHL model for ${today}...`);
  const nhlResult = await syncNhlModelForToday("manual", true, false, today);
  console.log(`[TriggerRemodel] NHL done: synced=${nhlResult.synced}, skipped=${nhlResult.skipped}, errors=${nhlResult.errors.length}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

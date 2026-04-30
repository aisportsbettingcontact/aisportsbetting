import { runMlbModelForDate } from "./mlbModelRunner.js";

async function main() {
  const dateStr = "2026-04-26";
  const gameId = 2250398; // CHC@LAD
  console.log(`[RerunChcLad] Force-rerunning CHC@LAD (${gameId}) for ${dateStr} with bookTotal=9.0...`);
  const result = await runMlbModelForDate(dateStr, { targetGameIds: [gameId], forceRerun: true });
  console.log(`[RerunChcLad] Done: written=${result.written}, skipped=${result.skipped}, errors=${result.errors}`);
  console.log(`[RerunChcLad] Validation: passed=${result.validation.passed}`);
  for (const issue of result.validation.issues) {
    console.error(`  ✗ ${issue}`);
  }
  for (const w of result.validation.warnings) {
    console.warn(`  ⚠ ${w}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

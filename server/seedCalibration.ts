/**
 * seedCalibration.ts — One-time seed of mlb_calibration_constants and initial drift state check.
 * Run with: npx tsx server/seedCalibration.ts
 */
import { seedCalibrationConstants, checkF5ShareDrift } from "./mlbDriftDetector";

async function main() {
  console.log("[SeedCalibration] Starting calibration constants seed...");

  await seedCalibrationConstants();

  console.log("\n[SeedCalibration] Running initial drift check to populate mlb_drift_state...");
  const result = await checkF5ShareDrift(false); // dry-run: detect but don't trigger recalibration

  console.log("\n[SeedCalibration] Drift check result:");
  console.log(`  windowSize:              ${result.windowSize}`);
  console.log(`  rollingF5Share:          ${result.rollingF5Share}`);
  console.log(`  baselineF5Share:         ${result.baselineF5Share}`);
  console.log(`  delta:                   ${result.delta}`);
  console.log(`  driftDetected:           ${result.driftDetected}`);
  console.log(`  recalibrationTriggered:  ${result.recalibrationTriggered}`);
  console.log(`  message:                 ${result.message}`);

  console.log("\n[SeedCalibration] COMPLETE");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

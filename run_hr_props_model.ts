/**
 * run_hr_props_model.ts — Standalone runner for HR Props model service
 * Usage: npx tsx run_hr_props_model.ts [YYYY-MM-DD]
 * Defaults to today's date if no argument provided.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { resolveAndModelHrProps } from "./server/mlbHrPropsModelService";

const gameDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

console.log(`[Runner] Starting HR Props model for date=${gameDate}`);

resolveAndModelHrProps(gameDate)
  .then(result => {
    console.log(`[Runner] COMPLETE`);
    console.log(`[Runner]   date=${result.date}`);
    console.log(`[Runner]   mlbamId resolved=${result.resolved} alreadyHad=${result.alreadyHad} unresolved=${result.unresolved}`);
    console.log(`[Runner]   modeled=${result.modeled} edges=${result.edges} errors=${result.errors}`);
    console.log(`[Runner] ${result.errors === 0 ? "PASS" : "FAIL"} — ${result.errors} errors`);
    process.exit(result.errors > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error(`[Runner] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

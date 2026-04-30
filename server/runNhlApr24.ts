/**
 * runNhlApr24.ts
 * Force-run the production NHL model for all 3 April 24, 2026 games.
 * Uses syncNhlModelForToday with forceRerun=true and dateOverride='2026-04-24'
 */
import "dotenv/config";
import { syncNhlModelForToday } from "./nhlModelSync.js";

const LOG_FILE = "/tmp/nhl_apr24_model.log";
import { writeFileSync, appendFileSync } from "fs";

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// Redirect all console output to log file
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
console.log = (...args: unknown[]) => {
  const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  origLog(...args);
};
console.error = (...args: unknown[]) => {
  const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [ERROR] ${msg}\n`);
  origError(...args);
};
console.warn = (...args: unknown[]) => {
  const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [WARN] ${msg}\n`);
  origWarn(...args);
};

writeFileSync(LOG_FILE, `[${new Date().toISOString()}] NHL April 24 2026 Model Run Starting\n`);

async function main() {
  log("=".repeat(70));
  log("NHL PRODUCTION MODEL — April 24, 2026");
  log("forceRerun=true | runAllStatuses=true | dateOverride=2026-04-24");
  log("=".repeat(70));

  try {
    const result = await syncNhlModelForToday(
      "manual",
      true,   // forceRerun — clears modelRunAt for all 3 games
      true,   // runAllStatuses — includes all game statuses
      "2026-04-24"  // dateOverride
    );

    log("=".repeat(70));
    log(`NHL MODEL COMPLETE`);
    log(`  Synced: ${result.synced}`);
    log(`  Skipped: ${result.skipped}`);
    log(`  Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      result.errors.forEach((e: string) => log(`  ERROR: ${e}`));
    }
    log("=".repeat(70));

    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`FATAL: ${msg}`);
    process.exit(1);
  }
}

main();

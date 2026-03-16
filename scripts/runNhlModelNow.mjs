/**
 * runNhlModelNow.mjs
 * One-shot script: run the NHL model for today's games and auto-approve all results.
 * Usage: node scripts/runNhlModelNow.mjs [--force] [--all-statuses]
 *
 * --force         Clear modelRunAt before running (re-run even if already modeled)
 * --all-statuses  Include live/final games (not just upcoming)
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Bootstrap tsx/ts-node so we can import TypeScript files directly
// We use the compiled JS approach instead — run via tsx
console.error("Use: npx tsx scripts/runNhlModelNow.mjs");
console.error("Or:  node --loader tsx scripts/runNhlModelNow.mjs");
process.exit(1);

/**
 * One-shot script: run all March 19 NCAAM R64 games through the model v9 engine.
 * Forces a full re-run even for games that already have projections.
 *
 * Usage: cd /home/ubuntu/ai-sports-betting && npx tsx scripts/runMarch19Models.ts
 */
import "dotenv/config";
import { triggerModelWatcherForDate } from "../server/ncaamModelWatcher.js";

console.log("=== NCAAM Model v9: Force Re-run ALL March 19 R64 games ===\n");
console.log("This will run 16 games sequentially with 30s stagger between each.");
console.log("Estimated time: ~16 × (40s model + 30s stagger) ≈ 19 minutes\n");

const result = await triggerModelWatcherForDate("2026-03-19", { forceRerun: true });

console.log("\n=== RESULT ===");
console.log(`  Triggered: ${result.triggered}`);
console.log(`  Skipped:   ${result.skipped}`);

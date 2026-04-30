import { syncNhlModelForToday } from "./server/nhlModelSync.js";

console.log("[BATCH TEST] Starting NHL batch sync for April 16...");
const result = await syncNhlModelForToday("2025-04-16", true);
console.log("[BATCH TEST] Result:", JSON.stringify(result, null, 2));

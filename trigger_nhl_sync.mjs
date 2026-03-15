// Directly call the NHL model sync by importing the module
// This avoids auth requirements
import { syncNhlModelForToday } from "./server/services/nhl/nhlModelSync.js";

console.log("=== Triggering NHL Model Sync ===");
const result = await syncNhlModelForToday("manual-test");
console.log("=== Result ===");
console.log(JSON.stringify(result, null, 2));

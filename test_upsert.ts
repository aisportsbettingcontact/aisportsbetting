import { config } from "dotenv";
config();
import { refreshMlbScheduleForDate } from "./server/mlbScheduleHistoryService";

async function main() {
  console.log("[TEST] Running refreshMlbScheduleForDate for 20260414...");
  try {
    const result = await refreshMlbScheduleForDate("20260414");
    console.log("[TEST][RESULT]", JSON.stringify({
      date: result.date,
      fetched: result.fetched,
      upserted: result.upserted,
      skipped: result.skipped,
      errors: result.errors,
    }, null, 2));
  } catch (err) {
    console.error("[TEST][FATAL ERROR]", err);
  }
  process.exit(0);
}
main();

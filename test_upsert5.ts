import { config } from "dotenv";
config();
import { fetchMlbScheduleForDate, upsertMlbScheduleHistory } from "./server/mlbScheduleHistoryService";

async function main() {
  console.log("[TEST] Fetching 20260414...");
  const records = await fetchMlbScheduleForDate("20260414");
  console.log(`[TEST] Fetched ${records.length} records`);

  try {
    const n = await upsertMlbScheduleHistory(records);
    console.log(`[TEST] Upsert SUCCESS: ${n} records`);
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? '');
    // Print the last 800 chars to get the MySQL error at the end
    const tail = msg.substring(Math.max(0, msg.length - 800));
    console.error("[TEST] Upsert FAILED — tail of error message:");
    console.error(tail);
    console.error("errno:", err?.errno, "code:", err?.code, "sqlMessage:", err?.sqlMessage);
    // Also print the cause if present
    if (err?.cause) console.error("cause:", err.cause);
    if (err?.original) console.error("original:", err.original?.message?.substring(0, 200));
  }
  process.exit(0);
}
main().catch(console.error);

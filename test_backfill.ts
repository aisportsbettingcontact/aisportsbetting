import { config } from "dotenv";
config();
import { refreshMlbScheduleLastNDays } from "./server/mlbScheduleHistoryService";

async function main() {
  console.log("[BACKFILL] Starting 14-day backfill...");
  const results = await refreshMlbScheduleLastNDays(14, 300);
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  for (const r of results) {
    console.log(`[BACKFILL] date=${r.date} fetched=${r.fetched} upserted=${r.upserted} errors=${r.errors.length}`);
    totalFetched += r.fetched;
    totalUpserted += r.upserted;
    totalErrors += r.errors.length;
  }
  console.log(`[BACKFILL] COMPLETE — totalFetched=${totalFetched} totalUpserted=${totalUpserted} totalErrors=${totalErrors}`);
  process.exit(0);
}
main().catch(console.error);

// run_kprops_april6.ts - Run K-Props upsert for April 6, 2026
import { fetchANKProps } from "./server/anKPropsService";
import { upsertKPropsFromAN } from "./server/kPropsDbHelpers";
import * as dotenv from "dotenv";
dotenv.config();

const DATE = "2026-04-06";
const TAG = "[K-PROPS-APR6]";

async function main() {
  console.log(`${TAG} Starting K-Props upsert for ${DATE}`);
  
  const dateForAN = DATE.replace(/-/g, ""); // Convert YYYY-MM-DD → YYYYMMDD
  console.log(`${TAG} [STEP] Fetching K-Props from Action Network (dateForAN=${dateForAN})`);
  
  const anResult = await fetchANKProps(dateForAN);
  console.log(`${TAG} [STATE] Fetched ${anResult.props.length} K-Props from AN`);
  
  if (anResult.props.length === 0) {
    console.log(`${TAG} [WARN] No K-Props returned from AN — exiting`);
    process.exit(0);
  }
  
  console.log(`${TAG} [STEP] Upserting K-Props to DB`);
  const result = await upsertKPropsFromAN(anResult, DATE);
  
  console.log(`\n${TAG} ═══════════════════════════════════════`);
  console.log(`${TAG} K-PROPS UPSERT COMPLETE — ${DATE}`);
  console.log(`${TAG}   Inserted: ${result.inserted}`);
  console.log(`${TAG}   Updated:  ${result.updated}`);
  console.log(`${TAG}   Skipped:  ${result.skipped}`);
  console.log(`${TAG}   Errors:   ${result.errors}`);
  console.log(`${TAG} ═══════════════════════════════════════\n`);
  
  if (result.errors > 0) {
    console.error(`${TAG} [VERIFY] WARN — ${result.errors} errors`);
  } else {
    console.log(`${TAG} [VERIFY] PASS — 0 errors`);
  }
  
  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} [FATAL] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

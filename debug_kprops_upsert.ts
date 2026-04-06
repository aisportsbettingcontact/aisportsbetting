import * as dotenv from "dotenv";
dotenv.config();
import { fetchANKProps } from "./server/anKPropsService";
import { upsertKPropsFromAN } from "./server/kPropsDbHelpers";

async function main() {
  // First check what AN returns for March 27
  console.log("[DEBUG] Fetching AN K-Props for 20260327...");
  try {
    const result = await fetchANKProps("20260327");
    console.log(`[DEBUG] props count: ${result.props.length}`);
    console.log(`[DEBUG] games count: ${Object.keys(result.games).length}`);
    if (result.props.length > 0) {
      console.log(`[DEBUG] first prop:`, JSON.stringify(result.props[0], null, 2));
    }
  } catch (err) {
    console.log(`[DEBUG] fetchANKProps error: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`[DEBUG] stack:`, err instanceof Error ? err.stack : "");
  }
  
  // Now try upsert with full stack trace
  console.log("\n[DEBUG] Running upsertKPropsFromAN('20260327')...");
  try {
    const r = await upsertKPropsFromAN("20260327");
    console.log(`[DEBUG] result:`, r);
  } catch (err) {
    console.log(`[DEBUG] upsertKPropsFromAN error: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`[DEBUG] stack:`, err instanceof Error ? err.stack?.split('\n').slice(0, 10).join('\n') : "");
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

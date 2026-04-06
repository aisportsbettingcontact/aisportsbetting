import * as dotenv from "dotenv";
dotenv.config();
import { fetchANKProps } from "./server/anKPropsService";

async function main() {
  // Test March 26 (historical date)
  const dates = ["20260326", "20260328", "20260330", "20260403", "20260404"];
  for (const date of dates) {
    try {
      const result = await fetchANKProps(date);
      console.log(`[${date}] props=${result.props.length} games=${Object.keys(result.games).length}`);
      if (result.props.length > 0) {
        console.log(`  Sample: ${result.props[0].pitcherName} line=${result.props[0].line} over=${result.props[0].overOdds}`);
      }
    } catch (err) {
      console.log(`[${date}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

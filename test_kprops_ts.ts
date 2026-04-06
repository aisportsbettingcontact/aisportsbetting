// test_kprops_ts.ts - Test K-Props date format fix for April 6, 2026
import { fetchANKProps } from "./server/anKPropsService";
import { updateKPropsFromAN } from "./server/kPropsDbHelpers";

async function main() {
  const DATE = "2026-04-06";
  const dateForAN = DATE.replace(/-/g, ""); // Convert YYYY-MM-DD → YYYYMMDD
  console.log("[TEST] Fetching K-Props for dateForAN:", dateForAN);

  const anResult = await fetchANKProps(dateForAN);
  console.log("[TEST] K-Props fetched:", anResult.props.length, "props");
  
  if (anResult.props.length > 0) {
    console.log("[TEST] Sample props (first 3):");
    anResult.props.slice(0, 3).forEach((p, i) => {
      console.log(`  [${i+1}] ${p.pitcherName} (${p.teamAbbr}) | Line: ${p.bookLine} | Over: ${p.overOdds} | Under: ${p.underOdds}`);
    });
    
    const kResult = await updateKPropsFromAN(anResult, DATE);
    console.log("[TEST] DB update:", JSON.stringify(kResult));
  } else {
    console.log("[TEST] No props returned from AN");
  }
  
  process.exit(0);
}

main().catch((err) => {
  console.error("[TEST] Error:", err);
  process.exit(1);
});

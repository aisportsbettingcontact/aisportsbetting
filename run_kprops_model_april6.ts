// run_kprops_model_april6.ts - Run K-Props model EV for April 6, 2026
import { modelKPropsForDate } from "./server/mlbKPropsModelService";
import * as dotenv from "dotenv";
dotenv.config();

const DATE = "2026-04-06";

async function main() {
  console.log(`[K-PROPS-MODEL] Running K-Props model EV for ${DATE}`);
  const result = await modelKPropsForDate(DATE);
  console.log(`[K-PROPS-MODEL] DONE: modeled=${result.modeled} edges=${result.edges} skipped=${result.skipped} errors=${result.errors}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[K-PROPS-MODEL] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

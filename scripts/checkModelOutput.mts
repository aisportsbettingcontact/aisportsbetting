import { getDb } from "../server/db.js";
import { games } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const rows = await db.select({
    id: games.id,
    matchup: games.matchup,
    modelHomeWinPct: games.modelHomeWinPct,
    modelF5Total: games.modelF5Total,
    nrfiCombinedSignal: games.nrfiCombinedSignal,
    nrfiFilterPass: games.nrfiFilterPass,
    modelInningHomeExp: games.modelInningHomeExp,
    modelTotal: games.modelTotal,
    modelAwayWinPct: games.modelAwayWinPct,
  }).from(games).where(eq(games.gameDate, "2026-04-14"));

  const withModel = rows.filter(r => r.modelHomeWinPct !== null);
  console.log(`\nGames with model output: ${withModel.length} / ${rows.length}`);
  console.log("─".repeat(100));
  
  for (const r of rows) {
    const hasModel = r.modelHomeWinPct !== null;
    const hasF5 = r.modelF5Total !== null;
    const hasNrfi = r.nrfiCombinedSignal !== null;
    const hasInning = r.modelInningHomeExp !== null;
    const status = hasModel ? "MODEL_OK" : "NO_MODEL";
    const nrfiSignal = r.nrfiCombinedSignal ? Number(r.nrfiCombinedSignal).toFixed(4) : "null";
    const nrfiPass = r.nrfiFilterPass ? "✅PASS" : "❌FAIL";
    const bothPass = "";
    const fgTotal = r.modelTotal ? Number(r.modelTotal).toFixed(2) : "null";
    const f5Total = r.modelF5Total ? Number(r.modelF5Total).toFixed(2) : "null";
    console.log(
      `[${status}] ${r.matchup?.padEnd(12)} | model:${hasModel?"✅":"❌"} f5:${hasF5?"✅":"❌"} nrfi:${hasNrfi?"✅":"❌"} inn:${hasInning?"✅":"❌"}` +
      ` | FG=${fgTotal} F5=${f5Total} | nrfi_signal=${nrfiSignal} ${nrfiPass} ${bothPass}`
    );
  }
  
  console.log("\n─".repeat(100));
  console.log(`SUMMARY: written=${withModel.length} skipped=${rows.length - withModel.length} errors=0`);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

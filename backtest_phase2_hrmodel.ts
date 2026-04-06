/**
 * backtest_phase2_hrmodel.ts
 * Run HR Props model EV for all dates March 25 - April 5 that are missing model data
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

const DATES = [
  "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29",
  "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03",
  "2026-04-04", "2026-04-05"
];

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  
  console.log("[PHASE 2] HR Props model EV for March 25 - April 5");
  
  for (const date of DATES) {
    const [total] = await conn.execute<mysql2.RowDataPacket[]>(
      "SELECT COUNT(*) as cnt FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId WHERE g.gameDate=?",
      [date]
    );
    const [modeled] = await conn.execute<mysql2.RowDataPacket[]>(
      "SELECT COUNT(*) as cnt FROM mlb_hr_props hp JOIN games g ON g.id=hp.gameId WHERE g.gameDate=? AND hp.modelPHr IS NOT NULL",
      [date]
    );
    const totalCnt = Number(total[0].cnt);
    const modeledCnt = Number(modeled[0].cnt);
    
    if (totalCnt === 0) {
      console.log(`[HR-MODEL] ${date} — no props, skipping`);
      continue;
    }
    
    if (modeledCnt >= totalCnt) {
      console.log(`[HR-MODEL] ${date} — ${modeledCnt}/${totalCnt} already modeled`);
      continue;
    }
    
    console.log(`[HR-MODEL] ${date} — ${modeledCnt}/${totalCnt} modeled, running model...`);
    try {
      // Dynamic import to avoid loading all dependencies upfront
      const { resolveAndModelHrProps } = await import("./server/mlbHrPropsModelService");
      const r = await resolveAndModelHrProps(date);
      console.log(`[HR-MODEL] ${date} — resolved=${r.resolved} alreadyHad=${r.alreadyHad} modeled=${r.modeled} edges=${r.edges} errors=${r.errors}`);
    } catch (err) {
      console.log(`[HR-MODEL] ${date} — ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  await conn.end();
  console.log("[PHASE 2] Complete");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

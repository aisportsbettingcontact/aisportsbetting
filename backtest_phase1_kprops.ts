/**
 * backtest_phase1_kprops.ts
 * K-Props backfill + model for all missing dates March 25 - April 5
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";
import { upsertKPropsForDate } from "./server/kPropsDbHelpers";
import { modelKPropsForDate } from "./server/mlbKPropsModelService";

const DATES = [
  "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29",
  "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03",
  "2026-04-04", "2026-04-05"
];

function toANDate(d: string): string { return d.replace(/-/g, ""); }

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  
  console.log("[PHASE 1] K-Props backfill + model for March 25 - April 5");
  
  for (const date of DATES) {
    const [existing] = await conn.execute<mysql2.RowDataPacket[]>(
      "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate=? AND g.sport='MLB'",
      [date]
    );
    const cnt = Number(existing[0].cnt);
    
    if (cnt === 0) {
      console.log(`[K-PROPS] ${date} — 0 props, running upsert...`);
      try {
        const r = await upsertKPropsForDate(toANDate(date));
        console.log(`[K-PROPS] ${date} — inserted=${r.inserted} updated=${r.updated} errors=${r.errors}`);
      } catch (err) {
        console.log(`[K-PROPS] ${date} — ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise(r => setTimeout(r, 400));
    } else {
      console.log(`[K-PROPS] ${date} — ${cnt} props exist, skipping upsert`);
    }
    
    // Check if modeled
    const [modeled] = await conn.execute<mysql2.RowDataPacket[]>(
      "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate=? AND sp.kProj IS NOT NULL",
      [date]
    );
    const [total] = await conn.execute<mysql2.RowDataPacket[]>(
      "SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp JOIN games g ON g.id=sp.gameId WHERE g.gameDate=?",
      [date]
    );
    const modeledCnt = Number(modeled[0].cnt);
    const totalCnt = Number(total[0].cnt);
    
    if (totalCnt === 0) {
      console.log(`[K-MODEL] ${date} — no props, skipping`);
      continue;
    }
    
    if (modeledCnt < totalCnt) {
      console.log(`[K-MODEL] ${date} — ${modeledCnt}/${totalCnt} modeled, running model...`);
      try {
        const r = await modelKPropsForDate(date);
        console.log(`[K-MODEL] ${date} — modeled=${r.modeled} edges=${r.edges} errors=${r.errors}`);
      } catch (err) {
        console.log(`[K-MODEL] ${date} — ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log(`[K-MODEL] ${date} — ${modeledCnt}/${totalCnt} already modeled`);
    }
  }
  
  await conn.end();
  console.log("[PHASE 1] Complete");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

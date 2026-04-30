/**
 * backfill-units.mjs
 * 
 * Backfills riskUnits and toWinUnits for all existing tracked_bets rows
 * that have NULL values for these columns.
 *
 * Logic:
 *   - The legacy bets were entered with $100/unit (unitSize = 100).
 *   - riskUnits  = risk  / 100  (always stored)
 *   - toWinUnits = toWin / 100  (always stored)
 *
 * The bySize analytics uses:
 *   - For plus-money bets  (odds >= 0): riskUnits  → unit bucket
 *   - For minus-money bets (odds < 0):  toWinUnits → unit bucket
 *
 * Both are stored so the server can use either depending on odds sign.
 */

import mysql from "mysql2/promise";
import { config } from "dotenv";

config();

const UNIT_SIZE = 100; // $100 per unit (legacy default)

async function main() {
  console.log("[BACKFILL][INPUT] Connecting to database...");
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Count rows needing backfill
  const [[{ count }]] = await conn.execute(
    "SELECT COUNT(*) as count FROM tracked_bets WHERE riskUnits IS NULL OR toWinUnits IS NULL"
  );
  console.log(`[BACKFILL][STATE] Found ${count} rows needing backfill`);

  if (count === 0) {
    console.log("[BACKFILL][OUTPUT] Nothing to backfill. Exiting.");
    await conn.end();
    return;
  }

  // Fetch all rows needing backfill
  const [rows] = await conn.execute(
    "SELECT id, odds, risk, toWin FROM tracked_bets WHERE riskUnits IS NULL OR toWinUnits IS NULL"
  );

  console.log(`[BACKFILL][STEP] Processing ${rows.length} rows...`);

  let updated = 0;
  let errors = 0;

  for (const row of rows) {
    const riskDollars  = parseFloat(row.risk);
    const toWinDollars = parseFloat(row.toWin);
    const odds         = parseInt(row.odds, 10);

    if (isNaN(riskDollars) || isNaN(toWinDollars) || isNaN(odds)) {
      console.warn(`[BACKFILL][WARN] Row ${row.id}: invalid values risk=${row.risk} toWin=${row.toWin} odds=${row.odds} — skipping`);
      errors++;
      continue;
    }

    const riskUnits  = parseFloat((riskDollars  / UNIT_SIZE).toFixed(4));
    const toWinUnits = parseFloat((toWinDollars / UNIT_SIZE).toFixed(4));

    try {
      await conn.execute(
        "UPDATE tracked_bets SET riskUnits = ?, toWinUnits = ? WHERE id = ?",
        [riskUnits, toWinUnits, row.id]
      );
      updated++;

      if (updated % 100 === 0) {
        console.log(`[BACKFILL][STATE] Progress: ${updated}/${rows.length} updated`);
      }
    } catch (err) {
      console.error(`[BACKFILL][ERROR] Row ${row.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[BACKFILL][OUTPUT] Done. updated=${updated} errors=${errors}`);
  console.log(`[BACKFILL][VERIFY] ${errors === 0 ? "PASS" : "FAIL"} — ${errors} errors`);

  await conn.end();
}

main().catch(err => {
  console.error("[BACKFILL][ERROR] Fatal:", err.message);
  process.exit(1);
});

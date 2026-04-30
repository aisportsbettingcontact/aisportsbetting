/**
 * fix_apr12_odds.ts
 *
 * Fixes specific odds issues for Apr 12 2026 MLB games:
 *
 * 1. MIN@TOR (id=2250210): RL shows 0/0 with stale odds — nullify RL fields.
 *    Per browser intercept, Opening line has NO run line for MIN@TOR.
 *    The model reads awayRunLine/homeRunLine as varchar; RL='0' is invalid.
 *
 * 2. PIT@CHC (id=2250218): Has ML but no Total — cannot run model yet.
 *    No action needed; will auto-populate from production AN API cycle.
 *
 * 3. CWS@KC (id=2250215), HOU@SEA (id=2250220): No odds at all.
 *    No action needed; will auto-populate from production AN API cycle.
 */

import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[INPUT] fix_apr12_odds.ts — fixing MIN@TOR RL=0 issue");
  const db = await getDb();

  // Fix MIN@TOR: null out all RL fields (RL=0 is invalid; AN has no RL posted)
  console.log("[STEP] Nullifying MIN@TOR (id=2250210) run line fields (RL=0 is invalid)");
  await db.execute(sql`
    UPDATE games
    SET
      awayRunLine = NULL,
      homeRunLine = NULL,
      awayRunLineOdds = NULL,
      homeRunLineOdds = NULL,
      awayBookSpread = NULL,
      homeBookSpread = NULL
    WHERE id = 2250210
  `);
  console.log("[OUTPUT] MIN@TOR RL fields nullified");

  // Verify
  const rows = await db.execute(sql`
    SELECT id, awayTeam, homeTeam, awayML, homeML, awayRunLine, homeRunLine,
           awayRunLineOdds, homeRunLineOdds, bookTotal, overOdds, underOdds,
           awayBookSpread, homeBookSpread, oddsSource, publishedModel
    FROM games
    WHERE id = 2250210
  `);
  const r = (rows[0] as any[])[0];
  console.log("[VERIFY] MIN@TOR post-fix:");
  console.log(`  ML: ${r.awayML}/${r.homeML}`);
  console.log(`  RL: ${r.awayRunLine}/${r.homeRunLine} (should be null/null)`);
  console.log(`  RL Odds: ${r.awayRunLineOdds}/${r.homeRunLineOdds} (should be null/null)`);
  console.log(`  BookSpread: ${r.awayBookSpread}/${r.homeBookSpread} (should be null/null)`);
  console.log(`  Total: ${r.bookTotal} | O/U: ${r.overOdds}/${r.underOdds}`);
  console.log(`  oddsSource: ${r.oddsSource} | publishedModel: ${r.publishedModel}`);

  const rlFixed = r.awayRunLine === null && r.homeRunLine === null;
  console.log(`[VERIFY] RL nullification: ${rlFixed ? "PASS" : "FAIL"}`);

  // Full status summary
  console.log("\n[OUTPUT] Full Apr 12 MLB status:");
  const allRows = await db.execute(sql`
    SELECT id, awayTeam, homeTeam, awayML, homeML, awayRunLine, bookTotal, oddsSource, publishedModel
    FROM games
    WHERE gameDate = '2026-04-12' AND sport = 'MLB'
    ORDER BY id
  `);
  let published = 0, unpublished = 0;
  for (const row of (allRows[0] as any[])) {
    const hasML = row.awayML && row.homeML;
    const hasTotal = row.bookTotal;
    const canModel = hasML && hasTotal;
    const status = row.publishedModel ? "PUBLISHED" : (canModel ? "READY" : "WAITING_ODDS");
    if (row.publishedModel) published++;
    else unpublished++;
    console.log(
      `  [${status}] id=${row.id} | ${row.awayTeam}@${row.homeTeam} | ` +
      `ML=${row.awayML ?? "NULL"}/${row.homeML ?? "NULL"} RL=${row.awayRunLine ?? "NULL"} T=${row.bookTotal ?? "NULL"} | ` +
      `src=${row.oddsSource}`
    );
  }
  console.log(`\n[VERIFY] ${published} published, ${unpublished} unpublished`);

  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

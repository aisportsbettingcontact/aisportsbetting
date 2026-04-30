/**
 * verify_apr12_full.ts
 *
 * Queries the DB for all Apr 12 MLB and NHL games and prints a structured
 * completeness report: oddsSource, awayML, homeML, bookTotal, awayRunLine,
 * homeRunLine, awayBookSpread, homeBookSpread, publishedModel.
 *
 * Logging format:
 *   [INPUT]  source + parsed values
 *   [STEP]   operation description
 *   [STATE]  intermediate computations
 *   [OUTPUT] result
 *   [VERIFY] pass/fail + reason
 */

import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const DATE = "2026-04-12";

async function main() {
  console.log(`[INPUT] Querying DB for all games on ${DATE}`);
  const db = await getDb();
  if (!db) throw new Error("[ERROR] DB not available");

  const rows = await db
    .select()
    .from(games)
    .where(eq(games.gameDate, DATE));

  const mlb = rows.filter((r) => r.sport === "MLB");
  const nhl = rows.filter((r) => r.sport === "NHL");

  console.log(`[STATE] Total games found: ${rows.length} (MLB=${mlb.length} NHL=${nhl.length})`);

  // ── MLB Report ────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`[OUTPUT] MLB Apr 12 — ${mlb.length} games`);
  console.log("══════════════════════════════════════════════════════════════");

  let mlbMissingCount = 0;
  for (const g of mlb) {
    const missing: string[] = [];
    if (!g.awayML)         missing.push("awayML");
    if (!g.homeML)         missing.push("homeML");
    if (!g.bookTotal)      missing.push("bookTotal");
    if (!g.awayRunLine)    missing.push("awayRunLine");
    if (!g.homeRunLine)    missing.push("homeRunLine");
    if (!g.awayBookSpread) missing.push("awayBookSpread");
    if (!g.homeBookSpread) missing.push("homeBookSpread");
    if (!g.overOdds)       missing.push("overOdds");
    if (!g.underOdds)      missing.push("underOdds");
    if (!g.awayRunLineOdds) missing.push("awayRunLineOdds");
    if (!g.homeRunLineOdds) missing.push("homeRunLineOdds");

    const src = g.oddsSource ?? "NULL";
    const pub = g.publishedModel ? "YES" : "NO";
    const status = missing.length === 0 ? "✅ COMPLETE" : `❌ MISSING: ${missing.join(", ")}`;

    console.log(
      `  ${g.awayTeam}@${g.homeTeam} | src=${src} | pub=${pub} | ` +
      `ML=${g.awayML}/${g.homeML} | RL=${g.awayRunLine}(${g.awayRunLineOdds})/${g.homeRunLine}(${g.homeRunLineOdds}) | ` +
      `spread=${g.awayBookSpread}/${g.homeBookSpread} | total=${g.bookTotal}(${g.overOdds}/${g.underOdds}) | ` +
      status
    );

    if (missing.length > 0) mlbMissingCount++;
  }

  // ── NHL Report ────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`[OUTPUT] NHL Apr 12 — ${nhl.length} games`);
  console.log("══════════════════════════════════════════════════════════════");

  let nhlMissingCount = 0;
  for (const g of nhl) {
    const missing: string[] = [];
    if (!g.awayML)         missing.push("awayML");
    if (!g.homeML)         missing.push("homeML");
    if (!g.bookTotal)      missing.push("bookTotal");
    if (!g.awayBookSpread) missing.push("awayBookSpread");
    if (!g.homeBookSpread) missing.push("homeBookSpread");
    if (!g.overOdds)       missing.push("overOdds");
    if (!g.underOdds)      missing.push("underOdds");
    if (!g.awaySpreadOdds) missing.push("awaySpreadOdds");
    if (!g.homeSpreadOdds) missing.push("homeSpreadOdds");

    const src = g.oddsSource ?? "NULL";
    const pub = g.publishedModel ? "YES" : "NO";
    const status = missing.length === 0 ? "✅ COMPLETE" : `❌ MISSING: ${missing.join(", ")}`;

    console.log(
      `  ${g.awayTeam}@${g.homeTeam} | src=${src} | pub=${pub} | ` +
      `ML=${g.awayML}/${g.homeML} | PL=${g.awayBookSpread}(${g.awaySpreadOdds})/${g.homeBookSpread}(${g.homeSpreadOdds}) | ` +
      `total=${g.bookTotal}(${g.overOdds}/${g.underOdds}) | ` +
      status
    );

    if (missing.length > 0) nhlMissingCount++;
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  const totalMissing = mlbMissingCount + nhlMissingCount;
  if (totalMissing === 0) {
    console.log(`[VERIFY] ✅ PASS — All ${rows.length} games fully populated (MLB=${mlb.length} NHL=${nhl.length})`);
  } else {
    console.log(`[VERIFY] ❌ FAIL — ${totalMissing} games with missing fields (MLB=${mlbMissingCount} NHL=${nhlMissingCount})`);
    console.log(`[VERIFY] These games will be populated on the next AN API refresh cycle (10-min interval).`);
    console.log(`[VERIFY] If AN API is reachable, they will be populated within 10 minutes.`);
  }
  console.log("══════════════════════════════════════════════════════════════");

  process.exit(0);
}

main().catch((e) => {
  console.error("[ERROR]", e);
  process.exit(1);
});

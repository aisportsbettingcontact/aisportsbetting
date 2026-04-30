/**
 * patch_apr12_missing.ts
 *
 * Seeds opening line data for 3 Apr 12 2026 MLB games that were skipped
 * in the original seed_open_lines_apr12.ts run:
 *   - CWS@KC  (id=2250215) — was skipped: "no data"
 *   - PIT@CHC (id=2250218) — was skipped: "no total data"
 *   - HOU@SEA (id=2250220) — was skipped: "no data"
 *
 * Data source: Action Network API book_id=30 (earliest inserted = opening line)
 *   CWS@KC:  inserted=2026-04-12T07:26:31 UTC
 *   HOU@SEA: inserted=2026-04-12T09:26:30 UTC
 *   PIT@CHC: inserted=2026-04-12T10:26:31 UTC
 *
 * Fields written:
 *   awayML, homeML (varchar e.g. "+150")
 *   awayRunLine, homeRunLine (varchar e.g. "+1.5")
 *   awayRunLineOdds, homeRunLineOdds (varchar e.g. "-125")
 *   awayBookSpread, homeBookSpread (decimal string e.g. "1.5")
 *   bookTotal (decimal string e.g. "9.5")
 *   overOdds, underOdds (varchar e.g. "-105")
 *   oddsSource = "open"
 *   publishedModel = true (games are complete, safe to publish)
 *   publishedToFeed = true
 *
 * Run: npx tsx scripts/patch_apr12_missing.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";

interface PatchData {
  id: number;
  matchup: string;
  awayML: string;
  homeML: string;
  awayRunLine: string;
  homeRunLine: string;
  awayRunLineOdds: string;
  homeRunLineOdds: string;
  bookTotal: string;
  overOdds: string;
  underOdds: string;
}

// Opening line data from AN book_id=30 (earliest inserted per game)
const PATCHES: PatchData[] = [
  {
    id: 2250215,
    matchup: "CWS@KC",
    awayML: "+150",
    homeML: "-182",
    awayRunLine: "+1.5",
    homeRunLine: "-1.5",
    awayRunLineOdds: "-125",
    homeRunLineOdds: "+105",
    bookTotal: "9.5",
    overOdds: "-105",
    underOdds: "-116",
  },
  {
    id: 2250218,
    matchup: "PIT@CHC",
    awayML: "+108",
    homeML: "-126",
    awayRunLine: "+1.5",
    homeRunLine: "-1.5",
    awayRunLineOdds: "-143",
    homeRunLineOdds: "+119",
    bookTotal: "12.0",
    overOdds: "-115",
    underOdds: "-105",
  },
  {
    id: 2250220,
    matchup: "HOU@SEA",
    awayML: "+125",
    homeML: "-152",
    awayRunLine: "+1.5",
    homeRunLine: "-1.5",
    awayRunLineOdds: "-175",
    homeRunLineOdds: "+145",
    bookTotal: "7.5",
    overOdds: "-116",
    underOdds: "-105",
  },
];

async function main() {
  console.log("[INPUT] Patching 3 Apr 12 MLB games with opening line data");
  console.log("[INPUT] Source: Action Network API book_id=30 (earliest inserted)");
  console.log("[INPUT] Games:", PATCHES.map(p => `${p.matchup} (id=${p.id})`).join(", "));

  const db = await getDb();
  if (!db) { console.error("[ERROR] DB not available"); process.exit(1); }

  let patched = 0;
  let failed = 0;

  for (const patch of PATCHES) {
    console.log(`\n[STEP] Processing ${patch.matchup} (id=${patch.id})`);

    // Pre-check: read current state
    const [current] = await db.select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayML: games.awayML,
      homeML: games.homeML,
      bookTotal: games.bookTotal,
      oddsSource: games.oddsSource,
      publishedModel: games.publishedModel,
      gameStatus: games.gameStatus,
    }).from(games).where(eq(games.id, patch.id));

    if (!current) {
      console.log(`  [ERROR] Game id=${patch.id} not found in DB — SKIPPING`);
      failed++;
      continue;
    }

    console.log(`  [STATE] Pre-patch: ${current.awayTeam}@${current.homeTeam}`);
    console.log(`  [STATE] ML=${current.awayML}/${current.homeML} total=${current.bookTotal ?? "NULL"} src=${current.oddsSource ?? "NULL"} published=${current.publishedModel}`);

    // Parse spread decimal values
    const awaySpreadNum = parseFloat(patch.awayRunLine);  // 1.5
    const homeSpreadNum = parseFloat(patch.homeRunLine);  // -1.5

    // Build update payload
    const updatePayload = {
      awayML: patch.awayML,
      homeML: patch.homeML,
      awayRunLine: patch.awayRunLine,
      homeRunLine: patch.homeRunLine,
      awayRunLineOdds: patch.awayRunLineOdds,
      homeRunLineOdds: patch.homeRunLineOdds,
      awayBookSpread: awaySpreadNum.toString(),
      homeBookSpread: homeSpreadNum.toString(),
      bookTotal: patch.bookTotal,
      overOdds: patch.overOdds,
      underOdds: patch.underOdds,
      oddsSource: "open" as const,
      publishedModel: true,
      publishedToFeed: true,
    };

    console.log(`  [STATE] Payload: ML=${patch.awayML}/${patch.homeML} RL=${patch.awayRunLine}(${patch.awayRunLineOdds}) total=${patch.bookTotal} O/U=${patch.overOdds}/${patch.underOdds}`);

    // Execute update
    await db.update(games).set(updatePayload).where(eq(games.id, patch.id));
    console.log(`  [OUTPUT] PATCHED id=${patch.id} (${patch.matchup})`);

    // Post-check: verify write
    const [verify] = await db.select({
      awayML: games.awayML,
      homeML: games.homeML,
      awayRunLine: games.awayRunLine,
      bookTotal: games.bookTotal,
      overOdds: games.overOdds,
      oddsSource: games.oddsSource,
      publishedModel: games.publishedModel,
    }).from(games).where(eq(games.id, patch.id));

    const mlOk = verify.awayML === patch.awayML && verify.homeML === patch.homeML;
    const totalOk = verify.bookTotal === patch.bookTotal;
    const srcOk = verify.oddsSource === "open";
    const pubOk = verify.publishedModel === true;
    const allOk = mlOk && totalOk && srcOk && pubOk;

    console.log(`  [VERIFY] ML=${mlOk ? "PASS" : "FAIL"} total=${totalOk ? "PASS" : "FAIL"} src=${srcOk ? "PASS" : "FAIL"} pub=${pubOk ? "PASS" : "FAIL"} → ${allOk ? "ALL PASS" : "FAIL"}`);

    if (allOk) {
      patched++;
    } else {
      console.log(`  [ERROR] Verification failed for ${patch.matchup}`);
      console.log(`  [ERROR] DB state: ML=${verify.awayML}/${verify.homeML} total=${verify.bookTotal} src=${verify.oddsSource} pub=${verify.publishedModel}`);
      failed++;
    }
  }

  console.log(`\n[OUTPUT] Patch complete: ${patched} patched, ${failed} failed`);

  // Final state summary
  console.log("\n[VERIFY] Final DB state for patched games:");
  for (const patch of PATCHES) {
    const [row] = await db.select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayML: games.awayML,
      homeML: games.homeML,
      awayRunLine: games.awayRunLine,
      awayRunLineOdds: games.awayRunLineOdds,
      bookTotal: games.bookTotal,
      overOdds: games.overOdds,
      underOdds: games.underOdds,
      oddsSource: games.oddsSource,
      publishedModel: games.publishedModel,
      publishedToFeed: games.publishedToFeed,
    }).from(games).where(eq(games.id, patch.id));

    if (row) {
      const complete = row.awayML && row.homeML && row.bookTotal && row.awayRunLine;
      console.log(`  [${complete ? "COMPLETE" : "INCOMPLETE"}] id=${row.id} | ${row.awayTeam}@${row.homeTeam} | ML=${row.awayML}/${row.homeML} RL=${row.awayRunLine}(${row.awayRunLineOdds}) T=${row.bookTotal} O/U=${row.overOdds}/${row.underOdds} | src=${row.oddsSource} pub=${row.publishedModel}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

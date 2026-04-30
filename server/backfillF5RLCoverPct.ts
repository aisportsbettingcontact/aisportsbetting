/**
 * backfillF5RLCoverPct.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Backfills modelF5HomeRLCoverPct and modelF5AwayRLCoverPct for all historical
 * games where these columns are NULL but modelF5AwayRlOdds/modelF5HomeRlOdds
 * are populated.
 *
 * The F5 RL odds were computed from p_f5_home_rl / p_f5_away_rl in MLBAIModel.py.
 * We can back-compute the no-vig probabilities from the stored odds using:
 *   p_home_rl = mlToProb(homeRlOdds) / (mlToProb(homeRlOdds) + mlToProb(awayRlOdds))
 *   p_away_rl = 1 - p_home_rl
 *
 * This is mathematically equivalent to the original no-vig removal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { isNull, isNotNull, and, sql } from "drizzle-orm";

const TAG = "[F5-RL-BACKFILL]";

function mlToProb(ml: number): number {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

function noVigProb(ml: number, mlOpposite: number): number {
  const p1 = mlToProb(ml);
  const p2 = mlToProb(mlOpposite);
  return p1 / (p1 + p2);
}

async function main() {
  const db = await getDb();

  console.log(`${TAG} [INPUT] Fetching games with F5 RL odds but missing cover pct...`);

  // Fetch all games where F5 RL odds exist but cover pct is NULL
  const rows = await db
    .select({
      id: games.id,
      gameDate: games.gameDate,
      modelF5HomeRlOdds: games.modelF5HomeRlOdds,
      modelF5AwayRlOdds: games.modelF5AwayRlOdds,
    })
    .from(games)
    .where(
      and(
        isNotNull(games.modelF5HomeRlOdds),
        isNotNull(games.modelF5AwayRlOdds),
        isNull(games.modelF5HomeRLCoverPct),
      )
    );

  console.log(`${TAG} [STATE] Found ${rows.length} games to backfill`);

  let updated = 0;
  let errors = 0;
  let skipped = 0;

  for (const row of rows) {
    const homeOdds = row.modelF5HomeRlOdds != null ? parseInt(String(row.modelF5HomeRlOdds), 10) : null;
    const awayOdds = row.modelF5AwayRlOdds != null ? parseInt(String(row.modelF5AwayRlOdds), 10) : null;

    if (homeOdds === null || awayOdds === null || isNaN(homeOdds) || isNaN(awayOdds)) {
      console.log(`${TAG} [WARN] Game ${row.id} (${row.gameDate}): invalid odds home=${homeOdds} away=${awayOdds} — skipping`);
      skipped++;
      continue;
    }

    // Back-compute no-vig cover probabilities from stored odds
    const pHomeRl = noVigProb(homeOdds, awayOdds);
    const pAwayRl = 1 - pHomeRl;

    // Validate: probabilities must be in [0.30, 0.70] range
    if (pHomeRl < 0.30 || pHomeRl > 0.70) {
      console.log(`${TAG} [WARN] Game ${row.id}: pHomeRl=${pHomeRl.toFixed(4)} out of range — skipping`);
      skipped++;
      continue;
    }

    const homeRlPct = parseFloat((pHomeRl * 100).toFixed(2));
    const awayRlPct = parseFloat((pAwayRl * 100).toFixed(2));

    try {
      await db
        .update(games)
        .set({
          modelF5HomeRLCoverPct: String(homeRlPct),
          modelF5AwayRLCoverPct: String(awayRlPct),
        })
        .where(sql`id = ${row.id}`);

      updated++;
      if (updated % 50 === 0) {
        console.log(`${TAG} [STATE] Progress: ${updated}/${rows.length} updated...`);
      }
    } catch (e) {
      console.error(`${TAG} [ERROR] Game ${row.id}: ${e}`);
      errors++;
    }
  }

  // Final verification
  const [verifyRows] = await (await getDb()).execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN modelF5HomeRLCoverPct IS NOT NULL THEN 1 ELSE 0 END) as populated,
      ROUND(AVG(CAST(modelF5HomeRLCoverPct AS DECIMAL(10,4))), 4) as avg_home_rl_pct,
      ROUND(MIN(CAST(modelF5HomeRLCoverPct AS DECIMAL(10,4))), 4) as min_home_rl_pct,
      ROUND(MAX(CAST(modelF5HomeRLCoverPct AS DECIMAL(10,4))), 4) as max_home_rl_pct
    FROM games
    WHERE gameStatus = 'final'
      AND gameDate >= '2026-03-26'
  `);

  const v = (verifyRows as any)[0];
  console.log(`\n${TAG} [OUTPUT] Backfill complete:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);
  console.log(`\n${TAG} [VERIFY] Post-backfill state:`);
  console.log(`  Total final games (Mar 26+): ${v.total}`);
  console.log(`  modelF5HomeRLCoverPct populated: ${v.populated}`);
  console.log(`  Avg home RL cover pct: ${v.avg_home_rl_pct}`);
  console.log(`  Range: [${v.min_home_rl_pct}, ${v.max_home_rl_pct}]`);

  const pass = parseInt(v.populated) === parseInt(v.total) - skipped;
  console.log(`\n${TAG} [VERIFY] ${pass ? 'PASS' : 'WARN'} — ${v.populated}/${v.total} games have F5 RL cover pct`);

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${TAG} [ERROR] Fatal: ${e}`);
  process.exit(1);
});

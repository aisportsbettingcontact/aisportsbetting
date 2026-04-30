/**
 * auditF5MlOdds.mts
 * Audits F5 ML odds coverage across all historical games.
 * 1. Checks the 3 specific NULL brierF5Ml games (CHC@PHI, CLE@STL, NYM@LAD)
 * 2. Counts all games with modelF5AwayWinPct populated but f5AwayML NULL
 * 3. Shows distribution by date
 */

import 'dotenv/config';
import { getDb } from '../server/db.js';
import { games } from '../drizzle/schema.js';
import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';

const TAG = '[AuditF5MlOdds]';
console.log(`${TAG} ══════════════════════════════════════════════════════`);

const db = await getDb();

// ─── Step 1: Audit the 3 specific NULL brierF5Ml games ───────────────────────
console.log(`\n${TAG} [STEP 1] Auditing 3 NULL brierF5Ml games (CHC@PHI, CLE@STL, NYM@LAD)...`);
const nullGames = await db
  .select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameDate: games.gameDate,
    f5AwayML: games.f5AwayML,
    f5HomeML: games.f5HomeML,
    awayML: games.awayML,
    homeML: games.homeML,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    modelF5HomeWinPct: games.modelF5HomeWinPct,
    brierF5Ml: games.brierF5Ml,
    brierFgMl: games.brierFgMl,
    mlbGamePk: games.mlbGamePk,
    actualF5Total: games.actualF5Total,
    actualFgTotal: games.actualFgTotal,
  })
  .from(games)
  .where(inArray(games.id, [2250235, 2250241, 2250245]));

for (const r of nullGames) {
  console.log(`${TAG} [STATE] id=${r.id} ${r.awayTeam}@${r.homeTeam} ${r.gameDate}`);
  console.log(`${TAG} [STATE]   f5AwayML=${r.f5AwayML ?? 'NULL'} f5HomeML=${r.f5HomeML ?? 'NULL'}`);
  console.log(`${TAG} [STATE]   awayML=${r.awayML ?? 'NULL'} homeML=${r.homeML ?? 'NULL'}`);
  console.log(`${TAG} [STATE]   modelF5Away=${r.modelF5AwayWinPct ?? 'NULL'} modelF5Home=${r.modelF5HomeWinPct ?? 'NULL'}`);
  console.log(`${TAG} [STATE]   brierFgMl=${r.brierFgMl ?? 'NULL'} brierF5Ml=${r.brierF5Ml ?? 'NULL'}`);
  console.log(`${TAG} [STATE]   mlbGamePk=${r.mlbGamePk ?? 'NULL'} | actualF5Total=${r.actualF5Total ?? 'NULL'} | actualFgTotal=${r.actualFgTotal ?? 'NULL'}`);

  if (r.f5AwayML == null) {
    console.warn(`${TAG} [VERIFY] ROOT CAUSE: f5AwayML is NULL — F5 ML odds were never scraped for this game`);
  } else if (r.modelF5AwayWinPct == null) {
    console.warn(`${TAG} [VERIFY] ROOT CAUSE: modelF5AwayWinPct is NULL — model did not run for this game`);
  } else if (r.actualF5Total == null) {
    console.warn(`${TAG} [VERIFY] ROOT CAUSE: actualF5Total is NULL — outcome not ingested yet`);
  } else {
    console.log(`${TAG} [VERIFY] All fields present — brierF5Ml should be computable`);
  }
}

// ─── Step 2: Full coverage audit — all modeled games with NULL f5AwayML ───────
console.log(`\n${TAG} [STEP 2] Full F5 ML odds coverage audit (all 2026 MLB games)...`);
const coverageGaps = await db
  .select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    gameDate: games.gameDate,
    f5AwayML: games.f5AwayML,
    f5HomeML: games.f5HomeML,
    modelF5AwayWinPct: games.modelF5AwayWinPct,
    brierF5Ml: games.brierF5Ml,
  })
  .from(games)
  .where(
    and(
      eq(games.sport, 'MLB'),
      isNotNull(games.modelF5AwayWinPct),
      isNull(games.f5AwayML)
    )
  )
  .orderBy(games.gameDate, games.id);

console.log(`${TAG} [OUTPUT] Games with modelF5AwayWinPct populated but f5AwayML NULL: ${coverageGaps.length}`);

// Group by date
const byDate: Record<string, typeof coverageGaps> = {};
for (const g of coverageGaps) {
  const d = g.gameDate ?? 'unknown';
  if (!byDate[d]) byDate[d] = [];
  byDate[d].push(g);
}

for (const [date, gamesOnDate] of Object.entries(byDate).sort()) {
  console.log(`${TAG} [STATE]  ${date}: ${gamesOnDate.length} game(s) missing F5 ML odds`);
  for (const g of gamesOnDate) {
    console.log(`${TAG} [STATE]    id=${g.id} ${g.awayTeam}@${g.homeTeam} | modelF5Away=${g.modelF5AwayWinPct} | brierF5Ml=${g.brierF5Ml ?? 'NULL'}`);
  }
}

// ─── Step 3: Overall Brier F5 ML coverage stats ───────────────────────────────
console.log(`\n${TAG} [STEP 3] Overall brierF5Ml coverage stats...`);
const statsRows = await db.execute(sql`
  SELECT
    COUNT(*) as total_modeled,
    SUM(CASE WHEN brier_f5_ml IS NOT NULL AND brier_f5_ml > 0 THEN 1 ELSE 0 END) as brier_populated,
    SUM(CASE WHEN brier_f5_ml IS NULL THEN 1 ELSE 0 END) as brier_null,
    SUM(CASE WHEN brier_f5_ml = 0 THEN 1 ELSE 0 END) as brier_zero,
    SUM(CASE WHEN f5_away_ml IS NULL THEN 1 ELSE 0 END) as f5_ml_null,
    SUM(CASE WHEN f5_away_ml IS NOT NULL THEN 1 ELSE 0 END) as f5_ml_present
  FROM games
  WHERE sport = 'MLB' AND model_f5_away_win_pct IS NOT NULL
`);
const stats = (statsRows.rows ?? statsRows)[0] as Record<string, unknown>;
console.log(`${TAG} [OUTPUT] Total modeled games: ${stats.total_modeled}`);
console.log(`${TAG} [OUTPUT] brierF5Ml populated (>0): ${stats.brier_populated}`);
console.log(`${TAG} [OUTPUT] brierF5Ml null: ${stats.brier_null}`);
console.log(`${TAG} [OUTPUT] brierF5Ml zero: ${stats.brier_zero}`);
console.log(`${TAG} [OUTPUT] f5AwayML present: ${stats.f5_ml_present}`);
console.log(`${TAG} [OUTPUT] f5AwayML null: ${stats.f5_ml_null}`);

if (Number(stats.f5_ml_null) === 0) {
  console.log(`${TAG} [VERIFY] PASS — all modeled games have F5 ML odds`);
} else {
  console.warn(`${TAG} [VERIFY] WARN — ${stats.f5_ml_null} modeled games missing F5 ML odds`);
}

console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
process.exit(0);

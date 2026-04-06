/**
 * backtest_audit_march25_april5.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1: DB audit for all MLB games from March 25 – April 5, 2026.
 *
 * Checks:
 *   - Games count per date
 *   - F5 odds coverage (f5AwayML, f5Total, nrfiOverOdds)
 *   - K-Props coverage (mlb_strikeout_props rows, modeled, backtested)
 *   - HR Props coverage (mlb_hr_props rows, modeled, actualHr populated)
 *   - Model fields coverage (modelF5AwayScore, modelPNrfi)
 *
 * [INPUT]  date range: 2026-03-25 to 2026-04-05
 * [OUTPUT] per-date audit table + gap list
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

const START_DATE = "2026-03-25";
const END_DATE = "2026-04-05";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[AUDIT] MLB Backtest Audit: ${START_DATE} → ${END_DATE}`);
  console.log(`${"=".repeat(80)}\n`);

  // ── 1. Games per date ──────────────────────────────────────────────────────
  const [gameDates] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      gameDate,
      COUNT(*) as totalGames,
      SUM(gameStatus LIKE '%Final%' OR gameStatus LIKE '%final%' OR gameStatus LIKE '%Game Over%') as finalGames,
      SUM(mlbGamePk IS NOT NULL) as hasMlbPk,
      SUM(modelAwayScore IS NOT NULL) as hasFullGameModel,
      SUM(modelF5AwayScore IS NOT NULL) as hasF5Model,
      SUM(modelPNrfi IS NOT NULL) as hasNrfiModel,
      SUM(f5AwayML IS NOT NULL) as hasF5Odds,
      SUM(nrfiOverOdds IS NOT NULL) as hasNrfiOdds
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
    GROUP BY gameDate
    ORDER BY gameDate
  `);

  console.log("[STEP] Games coverage per date:");
  console.log("DATE        | GAMES | FINAL | MLBpk | FG-MDL | F5-MDL | NRFI-MDL | F5-ODDS | NRFI-ODDS");
  console.log("-".repeat(90));
  let totalGames = 0, totalFinal = 0;
  for (const r of gameDates) {
    totalGames += Number(r.totalGames);
    totalFinal += Number(r.finalGames);
    console.log(
      `${r.gameDate} | ${String(r.totalGames).padStart(5)} | ${String(r.finalGames).padStart(5)} | ` +
      `${String(r.hasMlbPk).padStart(5)} | ${String(r.hasFullGameModel).padStart(6)} | ` +
      `${String(r.hasF5Model).padStart(6)} | ${String(r.hasNrfiModel).padStart(8)} | ` +
      `${String(r.hasF5Odds).padStart(7)} | ${String(r.hasNrfiOdds).padStart(9)}`
    );
  }
  console.log("-".repeat(90));
  console.log(`TOTAL       | ${String(totalGames).padStart(5)} | ${String(totalFinal).padStart(5)}`);

  // ── 2. K-Props coverage ────────────────────────────────────────────────────
  const [kPropsDates] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      g.gameDate,
      COUNT(sp.id) as totalKProps,
      SUM(sp.bookLine IS NOT NULL) as hasBookLine,
      SUM(sp.kProj IS NOT NULL) as hasModel,
      SUM(sp.verdict IS NOT NULL) as hasVerdict,
      SUM(sp.actualKs IS NOT NULL) as hasActual,
      SUM(sp.backtestResult IS NOT NULL) as hasBacktest
    FROM games g
    LEFT JOIN mlb_strikeout_props sp ON sp.gameId = g.id
    WHERE g.sport = 'MLB' AND g.gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
    GROUP BY g.gameDate
    ORDER BY g.gameDate
  `);

  console.log("\n[STEP] K-Props coverage per date:");
  console.log("DATE        | TOTAL | BOOK  | MODEL | VERDICT | ACTUAL | BACKTEST");
  console.log("-".repeat(70));
  let totalKProps = 0, totalKActual = 0, totalKBacktest = 0;
  for (const r of kPropsDates) {
    totalKProps += Number(r.totalKProps);
    totalKActual += Number(r.hasActual);
    totalKBacktest += Number(r.hasBacktest);
    console.log(
      `${r.gameDate} | ${String(r.totalKProps).padStart(5)} | ${String(r.hasBookLine).padStart(5)} | ` +
      `${String(r.hasModel).padStart(5)} | ${String(r.hasVerdict).padStart(7)} | ` +
      `${String(r.hasActual).padStart(6)} | ${String(r.hasBacktest).padStart(8)}`
    );
  }
  console.log("-".repeat(70));
  console.log(`TOTAL       | ${String(totalKProps).padStart(5)} | ${" ".repeat(5)} | ${" ".repeat(5)} | ${" ".repeat(7)} | ${String(totalKActual).padStart(6)} | ${String(totalKBacktest).padStart(8)}`);

  // ── 3. HR Props coverage ───────────────────────────────────────────────────
  const [hrPropsDates] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      g.gameDate,
      COUNT(hp.id) as totalHrProps,
      SUM(hp.fdOverOdds IS NOT NULL OR hp.consensusOverOdds IS NOT NULL) as hasOdds,
      SUM(hp.modelPHr IS NOT NULL) as hasModel,
      SUM(hp.verdict IS NOT NULL) as hasVerdict,
      SUM(hp.actualHr IS NOT NULL) as hasActual,
      SUM(hp.backtestResult IS NOT NULL) as hasBacktest,
      SUM(hp.verdict = 'OVER') as overEdges
    FROM games g
    LEFT JOIN mlb_hr_props hp ON hp.gameId = g.id
    WHERE g.sport = 'MLB' AND g.gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
    GROUP BY g.gameDate
    ORDER BY g.gameDate
  `);

  console.log("\n[STEP] HR Props coverage per date:");
  console.log("DATE        | TOTAL | ODDS  | MODEL | VERDICT | ACTUAL | BACKTEST | EDGES");
  console.log("-".repeat(78));
  let totalHrProps = 0, totalHrActual = 0, totalHrBacktest = 0, totalHrEdges = 0;
  for (const r of hrPropsDates) {
    totalHrProps += Number(r.totalHrProps);
    totalHrActual += Number(r.hasActual);
    totalHrBacktest += Number(r.hasBacktest);
    totalHrEdges += Number(r.overEdges);
    console.log(
      `${r.gameDate} | ${String(r.totalHrProps).padStart(5)} | ${String(r.hasOdds).padStart(5)} | ` +
      `${String(r.hasModel).padStart(5)} | ${String(r.hasVerdict).padStart(7)} | ` +
      `${String(r.hasActual).padStart(6)} | ${String(r.hasBacktest).padStart(8)} | ${String(r.overEdges).padStart(5)}`
    );
  }
  console.log("-".repeat(78));
  console.log(`TOTAL       | ${String(totalHrProps).padStart(5)} | ${" ".repeat(5)} | ${" ".repeat(5)} | ${" ".repeat(7)} | ${String(totalHrActual).padStart(6)} | ${String(totalHrBacktest).padStart(8)} | ${String(totalHrEdges).padStart(5)}`);

  // ── 4. Gap summary ─────────────────────────────────────────────────────────
  console.log("\n[STEP] Gap analysis:");

  // Games missing mlbGamePk
  const [missingPk] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT gameDate, awayTeam, homeTeam, id
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND mlbGamePk IS NULL
    ORDER BY gameDate
  `);
  console.log(`  Games missing mlbGamePk: ${missingPk.length}`);
  for (const r of missingPk) {
    console.log(`    [MISSING-PK] ${r.gameDate} ${r.awayTeam}@${r.homeTeam} (id=${r.id})`);
  }

  // Games missing F5 model
  const [missingF5Model] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT gameDate, awayTeam, homeTeam, id
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND modelF5AwayScore IS NULL AND mlbGamePk IS NOT NULL
    ORDER BY gameDate
  `);
  console.log(`  Games missing F5 model: ${missingF5Model.length}`);

  // Games missing NRFI model
  const [missingNrfiModel] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT gameDate, awayTeam, homeTeam, id
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND modelPNrfi IS NULL AND mlbGamePk IS NOT NULL
    ORDER BY gameDate
  `);
  console.log(`  Games missing NRFI model: ${missingNrfiModel.length}`);

  // K-Props missing actual Ks
  const [missingKActual] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT g.gameDate, sp.pitcherName, g.awayTeam, g.homeTeam
    FROM mlb_strikeout_props sp
    JOIN games g ON g.id = sp.gameId
    WHERE g.sport = 'MLB' AND g.gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND sp.actualKs IS NULL
      AND (g.gameStatus LIKE '%Final%' OR g.gameStatus LIKE '%Game Over%' OR g.gameStatus LIKE '%final%')
    ORDER BY g.gameDate
  `);
  console.log(`  K-Props missing actualKs (Final games): ${missingKActual.length}`);

  // HR Props missing actualHr
  const [missingHrActual] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT g.gameDate, COUNT(*) as cnt
    FROM mlb_hr_props hp
    JOIN games g ON g.id = hp.gameId
    WHERE g.sport = 'MLB' AND g.gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND hp.actualHr IS NULL
      AND (g.gameStatus LIKE '%Final%' OR g.gameStatus LIKE '%Game Over%' OR g.gameStatus LIKE '%final%')
    GROUP BY g.gameDate
    ORDER BY g.gameDate
  `);
  console.log(`  HR Props missing actualHr (Final games): ${missingHrActual.reduce((s, r) => s + Number(r.cnt), 0)}`);
  for (const r of missingHrActual) {
    console.log(`    [MISSING-HR] ${r.gameDate}: ${r.cnt} props`);
  }

  // ── 5. Games list with mlbGamePk ───────────────────────────────────────────
  const [allGames] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND mlbGamePk IS NOT NULL
    ORDER BY gameDate, id
  `);
  console.log(`\n[STATE] Total games with mlbGamePk: ${allGames.length}`);

  await conn.end();
  console.log(`\n[VERIFY] Audit complete — ${allGames.length} games identified for backtest`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[AUDIT] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

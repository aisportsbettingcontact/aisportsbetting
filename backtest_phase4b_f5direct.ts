/**
 * backtest_phase4b_f5direct.ts
 * ============================
 * Direct F5 result evaluator — no model required.
 * Computes F5 ML/RL/Total WIN/LOSS from actual scores vs book lines.
 *
 * For each game with both F5 odds AND actual F5 scores:
 *   - F5 ML: did the away/home team win the first 5 innings?
 *   - F5 RL: did the away team cover the run line (typically -0.5)?
 *   - F5 Total: did the combined F5 score go over/under the book total?
 *
 * Also scrapes remaining dates (March 30 – April 4) from AN for any F5 odds
 * that may still be available.
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

const DATES_MISSING_ODDS = [
  "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"
];

const ALL_DATES = [
  "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29",
  "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03",
  "2026-04-04", "2026-04-05"
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseOdds(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseFloat2(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

type F5Result = "WIN" | "LOSS" | "PUSH" | "NO_ACTION";

function evalF5Ml(
  awayScore: number, homeScore: number,
  awayMl: number | null, homeMl: number | null
): { awayResult: F5Result; homeResult: F5Result } {
  if (awayMl == null && homeMl == null) return { awayResult: "NO_ACTION", homeResult: "NO_ACTION" };
  if (awayScore === homeScore) return { awayResult: "PUSH", homeResult: "PUSH" };
  const awayWon = awayScore > homeScore;
  return {
    awayResult: awayMl != null ? (awayWon ? "WIN" : "LOSS") : "NO_ACTION",
    homeResult: homeMl != null ? (!awayWon ? "WIN" : "LOSS") : "NO_ACTION",
  };
}

function evalF5Rl(
  awayScore: number, homeScore: number,
  awayRlValue: number | null, awayRlOdds: number | null,
  homeRlValue: number | null, homeRlOdds: number | null
): { awayResult: F5Result; homeResult: F5Result } {
  const awayRl = awayRlValue ?? (homeRlValue != null ? -homeRlValue : null);
  if (awayRl == null) return { awayResult: "NO_ACTION", homeResult: "NO_ACTION" };
  const margin = awayScore - homeScore;
  const awayCovers = margin + awayRl > 0;
  const homeCovers = margin + awayRl < 0;
  const push = margin + awayRl === 0;
  return {
    awayResult: awayRlOdds != null ? (push ? "PUSH" : awayCovers ? "WIN" : "LOSS") : "NO_ACTION",
    homeResult: homeRlOdds != null ? (push ? "PUSH" : homeCovers ? "WIN" : "LOSS") : "NO_ACTION",
  };
}

function evalF5Total(
  awayScore: number, homeScore: number,
  totalValue: number | null, overOdds: number | null, underOdds: number | null
): { overResult: F5Result; underResult: F5Result } {
  if (totalValue == null) return { overResult: "NO_ACTION", underResult: "NO_ACTION" };
  const combined = awayScore + homeScore;
  const isOver = combined > totalValue;
  const isUnder = combined < totalValue;
  const isPush = combined === totalValue;
  return {
    overResult: overOdds != null ? (isPush ? "PUSH" : isOver ? "WIN" : "LOSS") : "NO_ACTION",
    underResult: underOdds != null ? (isPush ? "PUSH" : isUnder ? "WIN" : "LOSS") : "NO_ACTION",
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

  console.log("[INPUT] Direct F5 result evaluator: March 25 – April 5, 2026");

  // Step 1: Try to scrape missing F5 odds for March 30 – April 4
  console.log("\n[STEP] Attempting to scrape F5 odds for missing dates (March 30 – April 4)...");
  for (const date of DATES_MISSING_ODDS) {
    try {
      const { scrapeAndStoreF5Nrfi } = await import("./server/mlbF5NrfiScraper");
      const r = await scrapeAndStoreF5Nrfi(date);
      console.log(`[OUTPUT] ${date}: matched=${r.matched} updated=${r.updated} errors=${r.errors}`);
    } catch (err) {
      console.log(`[STATE] ${date}: scrape failed — ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Step 2: Evaluate F5 results directly for all games with odds + actuals
  console.log("\n[STEP] Evaluating F5 ML/RL/Total results from actual scores vs book lines...");

  const [games] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      id, gameDate, awayTeam, homeTeam,
      actualF5AwayScore, actualF5HomeScore,
      f5AwayML, f5HomeML,
      f5AwayRunLine, f5AwayRunLineOdds, f5HomeRunLine, f5HomeRunLineOdds,
      f5Total, f5OverOdds, f5UnderOdds
    FROM games
    WHERE sport='MLB'
      AND gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND actualF5AwayScore IS NOT NULL
      AND f5AwayML IS NOT NULL
    ORDER BY gameDate, awayTeam
  `);

  console.log(`[STATE] Games with F5 odds + actuals: ${games.length}`);

  let totalEvaluated = 0;
  let totalErrors = 0;

  for (const g of games) {
    const awayScore = Number(g.actualF5AwayScore);
    const homeScore = Number(g.actualF5HomeScore);

    const awayMl = parseOdds(g.f5AwayML);
    const homeMl = parseOdds(g.f5HomeML);
    const awayRlValue = parseFloat2(g.f5AwayRunLine);
    const awayRlOdds = parseOdds(g.f5AwayRunLineOdds);
    const homeRlValue = parseFloat2(g.f5HomeRunLine);
    const homeRlOdds = parseOdds(g.f5HomeRunLineOdds);
    const totalValue = parseFloat2(g.f5Total);
    const overOdds = parseOdds(g.f5OverOdds);
    const underOdds = parseOdds(g.f5UnderOdds);

    const mlResult = evalF5Ml(awayScore, homeScore, awayMl, homeMl);
    const rlResult = evalF5Rl(awayScore, homeScore, awayRlValue, awayRlOdds, homeRlValue, homeRlOdds);
    const totalResult = evalF5Total(awayScore, homeScore, totalValue, overOdds, underOdds);

    // Determine primary ML result (away perspective if available, else home)
    const f5MlResult = mlResult.awayResult !== "NO_ACTION" ? mlResult.awayResult : mlResult.homeResult;
    // Determine primary RL result (away perspective)
    const f5RlResult = rlResult.awayResult !== "NO_ACTION" ? rlResult.awayResult : rlResult.homeResult;
    // Determine primary Total result (over perspective)
    const f5TotalResult = totalResult.overResult !== "NO_ACTION" ? totalResult.overResult : totalResult.underResult;

    console.log(`[OUTPUT] ${String(g.gameDate).slice(0,10)} ${g.awayTeam}@${g.homeTeam}: F5=${awayScore}-${homeScore} ML=${f5MlResult} RL=${f5RlResult} Total=${f5TotalResult} (line=${totalValue} actual=${awayScore+homeScore})`);

    try {
      await conn.execute(`
        UPDATE games SET
          f5MlResult = ?,
          f5RlResult = ?,
          f5TotalResult = ?,
          f5MlCorrect = ?,
          f5RlCorrect = ?,
          f5TotalCorrect = ?,
          f5BacktestRunAt = ?
        WHERE id = ?
      `, [
        f5MlResult,
        f5RlResult,
        f5TotalResult,
        f5MlResult === "WIN" ? 1 : f5MlResult === "LOSS" ? 0 : null,
        f5RlResult === "WIN" ? 1 : f5RlResult === "LOSS" ? 0 : null,
        f5TotalResult === "WIN" ? 1 : f5TotalResult === "LOSS" ? 0 : null,
        Date.now(),
        g.id
      ]);
      totalEvaluated++;
    } catch (err) {
      console.error(`[VERIFY] FAIL ${g.awayTeam}@${g.homeTeam}: ${err instanceof Error ? err.message : String(err)}`);
      totalErrors++;
    }
  }

  // Step 3: Also evaluate NRFI results for all games with nrfiActualResult
  console.log("\n[STEP] Evaluating NRFI backtest results...");
  const [nrfiGames] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT id, gameDate, awayTeam, homeTeam, nrfiActualResult, modelPNrfi, nrfiOverOdds
    FROM games
    WHERE sport='MLB'
      AND gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND nrfiActualResult IS NOT NULL
    ORDER BY gameDate, awayTeam
  `);

  let nrfiEvaluated = 0;
  for (const g of nrfiGames) {
    const isNrfi = g.nrfiActualResult === "NRFI";
    const modelPNrfi = g.modelPNrfi != null ? Number(g.modelPNrfi) : null;
    const EDGE_THRESHOLD = 0.04;

    let nrfiBacktestResult: string | null = null;
    let nrfiCorrect: number | null = null;

    if (modelPNrfi != null) {
      const edge = modelPNrfi - 0.5;
      if (edge >= EDGE_THRESHOLD) {
        // Model says NRFI
        nrfiBacktestResult = isNrfi ? "WIN" : "LOSS";
        nrfiCorrect = isNrfi ? 1 : 0;
      } else if (edge <= -EDGE_THRESHOLD) {
        // Model says YRFI
        nrfiBacktestResult = !isNrfi ? "WIN" : "LOSS";
        nrfiCorrect = !isNrfi ? 1 : 0;
      } else {
        nrfiBacktestResult = "NO_ACTION";
      }
    }

    try {
      await conn.execute(`
        UPDATE games SET
          nrfiBacktestResult = ?,
          nrfiCorrect = ?,
          nrfiBacktestRunAt = ?
        WHERE id = ?
      `, [nrfiBacktestResult, nrfiCorrect, Date.now(), g.id]);
      nrfiEvaluated++;
    } catch (err) {
      console.error(`[VERIFY] FAIL NRFI ${g.awayTeam}@${g.homeTeam}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n[OUTPUT] EVALUATION COMPLETE`);
  console.log(`  F5 games evaluated:   ${totalEvaluated}`);
  console.log(`  NRFI games evaluated: ${nrfiEvaluated}`);
  console.log(`  Errors:               ${totalErrors}`);
  console.log(`[VERIFY] ${totalErrors === 0 ? "PASS" : "WARN — check errors above"}`);

  await conn.end();
  process.exit(0);
}

main().catch(e => {
  console.error("[FATAL]", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

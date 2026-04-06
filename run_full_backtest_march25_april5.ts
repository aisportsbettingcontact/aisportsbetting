/**
 * run_full_backtest_march25_april5.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Full retroactive backtest pipeline for March 25 – April 5, 2026.
 *
 * EXECUTION FLOW:
 *   Phase 1: K-Props backfill — upsert from AN for all missing dates
 *   Phase 2: HR Props backfill — scrape from AN for all missing dates
 *   Phase 3: K-Props model EV — run Poisson model for all dates
 *   Phase 4: HR Props model EV — run calibrated HR model for all dates
 *   Phase 5: Actual outcomes — fetch from MLB Stats API (F5, 1st inn, Ks, HRs)
 *   Phase 6: Backtest computation — compute results for all 4 markets
 *   Phase 7: Report generation — per-date + aggregate calibration metrics
 *
 * [INPUT]  date range: 2026-03-25 to 2026-04-05
 * [OUTPUT] full backtest report written to /home/ubuntu/backtest_report_march25_april5.md
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";
import { upsertKPropsFromAN } from "./server/kPropsDbHelpers";
import { scrapeHrPropsForDate } from "./server/mlbHrPropsScraper";
import { modelKPropsForDate } from "./server/mlbKPropsModelService";
import { resolveAndModelHrProps as modelHrPropsForDate } from "./server/mlbHrPropsModelService";
import { fetchRetroactiveOutcomes } from "./server/mlbRetroactiveOutcomesFetcher";
import fs from "fs";

const START_DATE = "2026-03-25";
const END_DATE = "2026-04-05";

// Generate date range
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start + "T12:00:00Z");
  const e = new Date(end + "T12:00:00Z");
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Format YYYYMMDD from YYYY-MM-DD
function toANDate(d: string): string {
  return d.replace(/-/g, "");
}

// ─── Phase helpers ─────────────────────────────────────────────────────────────

interface PhaseResult {
  phase: string;
  date: string;
  status: "OK" | "SKIP" | "ERROR";
  detail: string;
}

const results: PhaseResult[] = [];

function log(phase: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${phase}] ${msg}`);
}

// ─── Main pipeline ─────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const dates = dateRange(START_DATE, END_DATE);

  console.log(`\n${"=".repeat(80)}`);
  console.log(`[PIPELINE] Full Backtest: ${START_DATE} → ${END_DATE}`);
  console.log(`[INPUT] ${dates.length} dates: ${dates.join(", ")}`);
  console.log(`${"=".repeat(80)}\n`);

  // ── Phase 1: K-Props backfill ──────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[PHASE 1] K-Props backfill from Action Network`);
  console.log(`${"─".repeat(60)}`);

  for (const date of dates) {
    const anDate = toANDate(date);
    try {
      // Check if K-Props already exist for this date
      const [existing] = await conn.execute<mysql2.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp
         JOIN games g ON g.id = sp.gameId
         WHERE g.gameDate = ? AND g.sport = 'MLB'`,
        [date]
      );
      const cnt = Number(existing[0].cnt);

      if (cnt > 0) {
        log("K-PROPS", `${date} — ${cnt} props already exist, skipping upsert`);
        results.push({ phase: "K-Props Backfill", date, status: "SKIP", detail: `${cnt} existing` });
        continue;
      }

      log("K-PROPS", `${date} — 0 props found, running upsertKPropsFromAN(${anDate})`);
      const upsertResult = await upsertKPropsFromAN(anDate);
      log("K-PROPS", `${date} — inserted=${upsertResult.inserted} updated=${upsertResult.updated} errors=${upsertResult.errors}`);
      results.push({
        phase: "K-Props Backfill",
        date,
        status: upsertResult.errors > 0 ? "ERROR" : "OK",
        detail: `inserted=${upsertResult.inserted} updated=${upsertResult.updated}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("K-PROPS", `${date} — ERROR: ${msg}`);
      results.push({ phase: "K-Props Backfill", date, status: "ERROR", detail: msg });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Phase 2: HR Props backfill ─────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[PHASE 2] HR Props backfill from Action Network`);
  console.log(`${"─".repeat(60)}`);

  for (const date of dates) {
    try {
      // Check if HR Props already exist for this date
      const [existing] = await conn.execute<mysql2.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM mlb_hr_props hp
         JOIN games g ON g.id = hp.gameId
         WHERE g.gameDate = ? AND g.sport = 'MLB'`,
        [date]
      );
      const cnt = Number(existing[0].cnt);

      if (cnt > 0) {
        log("HR-PROPS", `${date} — ${cnt} props already exist, skipping scrape`);
        results.push({ phase: "HR Props Backfill", date, status: "SKIP", detail: `${cnt} existing` });
        continue;
      }

      log("HR-PROPS", `${date} — 0 props found, running scrapeHrPropsForDate(${date})`);
      const scrapeResult = await scrapeHrPropsForDate(date);
      log("HR-PROPS", `${date} — inserted=${scrapeResult.inserted} updated=${scrapeResult.updated} skipped=${scrapeResult.skipped}`);
      results.push({
        phase: "HR Props Backfill",
        date,
        status: "OK",
        detail: `inserted=${scrapeResult.inserted} updated=${scrapeResult.updated}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("HR-PROPS", `${date} — ERROR: ${msg}`);
      results.push({ phase: "HR Props Backfill", date, status: "ERROR", detail: msg });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Phase 3: K-Props model EV ──────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[PHASE 3] K-Props model EV computation`);
  console.log(`${"─".repeat(60)}`);

  for (const date of dates) {
    try {
      // Check if already modeled
      const [existing] = await conn.execute<mysql2.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp
         JOIN games g ON g.id = sp.gameId
         WHERE g.gameDate = ? AND sp.kProj IS NOT NULL`,
        [date]
      );
      const cnt = Number(existing[0].cnt);

      // Check total K-Props for this date
      const [total] = await conn.execute<mysql2.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM mlb_strikeout_props sp
         JOIN games g ON g.id = sp.gameId
         WHERE g.gameDate = ?`,
        [date]
      );
      const totalCnt = Number(total[0].cnt);

      if (totalCnt === 0) {
        log("K-MODEL", `${date} — no K-Props, skipping`);
        results.push({ phase: "K-Props Model", date, status: "SKIP", detail: "no props" });
        continue;
      }

      if (cnt === totalCnt) {
        log("K-MODEL", `${date} — ${cnt}/${totalCnt} already modeled, skipping`);
        results.push({ phase: "K-Props Model", date, status: "SKIP", detail: `${cnt} already modeled` });
        continue;
      }

      log("K-MODEL", `${date} — running modelKPropsForDate(${date})`);
      const modelResult = await modelKPropsForDate(date);
      log("K-MODEL", `${date} — modeled=${modelResult.modeled} edges=${modelResult.edges} errors=${modelResult.errors}`);
      results.push({
        phase: "K-Props Model",
        date,
        status: modelResult.errors > 0 ? "ERROR" : "OK",
        detail: `modeled=${modelResult.modeled} edges=${modelResult.edges}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("K-MODEL", `${date} — ERROR: ${msg}`);
      results.push({ phase: "K-Props Model", date, status: "ERROR", detail: msg });
    }
  }

  // ── Phase 4: HR Props model EV ─────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[PHASE 4] HR Props model EV computation`);
  console.log(`${"─".repeat(60)}`);

  for (const date of dates) {
    try {
      const [total] = await conn.execute<mysql2.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM mlb_hr_props hp
         JOIN games g ON g.id = hp.gameId
         WHERE g.gameDate = ?`,
        [date]
      );
      const totalCnt = Number(total[0].cnt);

      if (totalCnt === 0) {
        log("HR-MODEL", `${date} — no HR Props, skipping`);
        results.push({ phase: "HR Props Model", date, status: "SKIP", detail: "no props" });
        continue;
      }

      const [modeled] = await conn.execute<mysql2.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM mlb_hr_props hp
         JOIN games g ON g.id = hp.gameId
         WHERE g.gameDate = ? AND hp.modelPHr IS NOT NULL`,
        [date]
      );
      const modeledCnt = Number(modeled[0].cnt);

      if (modeledCnt === totalCnt) {
        log("HR-MODEL", `${date} — ${modeledCnt}/${totalCnt} already modeled, skipping`);
        results.push({ phase: "HR Props Model", date, status: "SKIP", detail: `${modeledCnt} already modeled` });
        continue;
      }

      log("HR-MODEL", `${date} — running modelHrPropsForDate(${date})`);
      const modelResult = await modelHrPropsForDate(date);
      log("HR-MODEL", `${date} — modeled=${modelResult.modeled} edges=${modelResult.edges} errors=${modelResult.errors ?? 0}`);
      results.push({
        phase: "HR Props Model",
        date,
        status: modelResult.errors > 0 ? "ERROR" : "OK",
        detail: `modeled=${modelResult.modeled} edges=${modelResult.edges}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("HR-MODEL", `${date} — ERROR: ${msg}`);
      results.push({ phase: "HR Props Model", date, status: "ERROR", detail: msg });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  await conn.end();

  // ── Phase 5 + 6: Actual outcomes + backtest computation ────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[PHASE 5+6] Fetch actual outcomes + compute backtest results`);
  console.log(`${"─".repeat(60)}`);

  const outcomesSummary = await fetchRetroactiveOutcomes(START_DATE, END_DATE);
  results.push({
    phase: "Actual Outcomes",
    date: `${START_DATE}→${END_DATE}`,
    status: outcomesSummary.gamesFailed > 0 ? "ERROR" : "OK",
    detail: `games=${outcomesSummary.gamesProcessed} kProps=${outcomesSummary.kPropsUpdated} hrProps=${outcomesSummary.hrPropsUpdated}`,
  });

  // ── Phase 7: Report generation ─────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[PHASE 7] Generating backtest report`);
  console.log(`${"─".repeat(60)}`);

  await generateReport();

  console.log(`\n[VERIFY] Pipeline complete`);
  console.log(`[OUTPUT] Report: /home/ubuntu/backtest_report_march25_april5.md`);
  process.exit(0);
}

// ─── Report generation ─────────────────────────────────────────────────────────

async function generateReport() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

  const lines: string[] = [];
  lines.push(`# MLB Backtest Report: March 25 – April 5, 2026`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(``);

  // ── K-Props backtest ────────────────────────────────────────────────────────
  lines.push(`## K-Props (Pitcher Strikeouts)`);
  lines.push(``);

  const [kAll] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      g.gameDate,
      sp.pitcherName,
      g.awayTeam,
      g.homeTeam,
      sp.bookLine,
      sp.kProj,
      sp.edgeOver,
      sp.edgeUnder,
      sp.verdict,
      sp.actualKs,
      sp.modelError,
      sp.backtestResult,
      sp.modelCorrect,
      sp.anNoVigOverPct
    FROM mlb_strikeout_props sp
    JOIN games g ON g.id = sp.gameId
    WHERE g.sport = 'MLB' AND g.gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
    ORDER BY g.gameDate, sp.pitcherName
  `);

  // Aggregate stats
  const kWithActual = kAll.filter(r => r.actualKs !== null);
  const kEdgePicks = kAll.filter(r => r.verdict === 'OVER' || r.verdict === 'UNDER');
  const kEdgeWithActual = kEdgePicks.filter(r => r.actualKs !== null);
  const kWins = kEdgeWithActual.filter(r => r.backtestResult === 'WIN');
  const kLosses = kEdgeWithActual.filter(r => r.backtestResult === 'LOSS');
  const kPushes = kEdgeWithActual.filter(r => r.backtestResult === 'PUSH');
  const kWinRate = kEdgeWithActual.length > 0 ? (kWins.length / kEdgeWithActual.length * 100).toFixed(1) : "N/A";
  const kModelErrors = kWithActual.map(r => parseFloat(r.modelError ?? "0")).filter(v => !isNaN(v));
  const kMAE = kModelErrors.length > 0 ? (kModelErrors.reduce((s, v) => s + Math.abs(v), 0) / kModelErrors.length).toFixed(2) : "N/A";
  const kME = kModelErrors.length > 0 ? (kModelErrors.reduce((s, v) => s + v, 0) / kModelErrors.length).toFixed(2) : "N/A";

  lines.push(`### Aggregate Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total pitcher props | ${kAll.length} |`);
  lines.push(`| Props with actual Ks | ${kWithActual.length} |`);
  lines.push(`| Edge picks (OVER/UNDER) | ${kEdgePicks.length} |`);
  lines.push(`| Edge picks backtested | ${kEdgeWithActual.length} |`);
  lines.push(`| Wins | ${kWins.length} |`);
  lines.push(`| Losses | ${kLosses.length} |`);
  lines.push(`| Pushes | ${kPushes.length} |`);
  lines.push(`| Win rate (edge picks) | ${kWinRate}% |`);
  lines.push(`| Mean Absolute Error (Ks) | ${kMAE} |`);
  lines.push(`| Mean Error (bias) | ${kME} |`);
  lines.push(``);

  // Per-date K-Props
  lines.push(`### Per-Date K-Props Results`);
  lines.push(``);
  lines.push(`| Date | Pitcher | Team | Line | Proj | Actual | Error | Verdict | Result |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of kAll) {
    const error = r.actualKs !== null && r.kProj ? (parseFloat(r.actualKs) - parseFloat(r.kProj)).toFixed(1) : "—";
    const actual = r.actualKs !== null ? String(r.actualKs) : "PENDING";
    const verdict = r.verdict ?? "PASS";
    const result = r.backtestResult ?? "PENDING";
    lines.push(`| ${r.gameDate} | ${r.pitcherName} | ${r.awayTeam}@${r.homeTeam} | ${r.bookLine} | ${parseFloat(r.kProj ?? "0").toFixed(1)} | ${actual} | ${error} | ${verdict} | ${result} |`);
  }
  lines.push(``);

  // ── HR Props backtest ────────────────────────────────────────────────────────
  lines.push(`## HR Props (Home Runs)`);
  lines.push(``);

  const [hrAll] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      g.gameDate,
      hp.playerName,
      hp.playerTeam,
      g.awayTeam,
      g.homeTeam,
      hp.overLine,
      hp.modelPHr,
      hp.edgeOver,
      hp.evOver,
      hp.verdict,
      hp.actualHr,
      hp.backtestResult
    FROM mlb_hr_props hp
    JOIN games g ON g.id = hp.gameId
    WHERE g.sport = 'MLB' AND g.gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
    ORDER BY g.gameDate, hp.playerName
  `);

  const hrWithActual = hrAll.filter(r => r.actualHr !== null);
  const hrEdgePicks = hrAll.filter(r => r.verdict === 'OVER');
  const hrEdgeWithActual = hrEdgePicks.filter(r => r.actualHr !== null);
  const hrWins = hrEdgeWithActual.filter(r => r.backtestResult === 'WIN');
  const hrLosses = hrEdgeWithActual.filter(r => r.backtestResult === 'LOSS');
  const hrHitRate = hrWithActual.length > 0 ? (hrWithActual.filter(r => r.actualHr === 1).length / hrWithActual.length * 100).toFixed(1) : "N/A";
  const hrWinRate = hrEdgeWithActual.length > 0 ? (hrWins.length / hrEdgeWithActual.length * 100).toFixed(1) : "N/A";

  lines.push(`### Aggregate Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total HR props | ${hrAll.length} |`);
  lines.push(`| Props with actual HR | ${hrWithActual.length} |`);
  lines.push(`| HR hit rate (all props) | ${hrHitRate}% |`);
  lines.push(`| Edge picks (OVER) | ${hrEdgePicks.length} |`);
  lines.push(`| Edge picks backtested | ${hrEdgeWithActual.length} |`);
  lines.push(`| Wins | ${hrWins.length} |`);
  lines.push(`| Losses | ${hrLosses.length} |`);
  lines.push(`| Win rate (edge picks) | ${hrWinRate}% |`);
  lines.push(``);

  // Per-date HR Props summary (only edge picks that hit)
  lines.push(`### HR Props Edge Picks — All Backtested`);
  lines.push(``);
  lines.push(`| Date | Player | Team | Line | Model P(HR) | Edge | EV | Verdict | Actual | Result |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of hrEdgeWithActual) {
    const modelPct = r.modelPHr ? `${parseFloat(r.modelPHr).toFixed(1)}%` : "—";
    const edge = r.edgeOver ? `${parseFloat(r.edgeOver).toFixed(1)}%` : "—";
    const ev = r.evOver ? `$${parseFloat(r.evOver).toFixed(1)}` : "—";
    const actual = r.actualHr === 1 ? "HR ✓" : r.actualHr === 0 ? "No HR" : "PENDING";
    lines.push(`| ${r.gameDate} | ${r.playerName} | ${r.playerTeam} | ${r.overLine} | ${modelPct} | ${edge} | ${ev} | OVER | ${actual} | ${r.backtestResult} |`);
  }
  lines.push(``);

  // ── F5 backtest ──────────────────────────────────────────────────────────────
  lines.push(`## F5 (First 5 Innings)`);
  lines.push(``);

  const [f5All] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      gameDate, awayTeam, homeTeam,
      f5AwayML, f5HomeML, f5Total, f5OverOdds, f5UnderOdds,
      f5AwayRunLine, f5AwayRunLineOdds,
      modelF5AwayWinPct, modelF5OverRate, modelF5AwayRLCoverPct,
      actualF5AwayScore, actualF5HomeScore,
      f5MlResult, f5RlResult, f5TotalResult,
      f5MlCorrect, f5RlCorrect, f5TotalCorrect
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND (actualF5AwayScore IS NOT NULL OR f5AwayML IS NOT NULL)
    ORDER BY gameDate
  `);

  const f5WithActual = f5All.filter(r => r.actualF5AwayScore !== null);
  const f5WithModel = f5All.filter(r => r.modelF5AwayWinPct !== null);
  const f5MlResults = f5WithModel.filter(r => r.f5MlResult !== null && r.f5MlResult !== 'PUSH');
  const f5MlWins = f5MlResults.filter(r => r.f5MlResult === 'WIN');
  const f5TotalResults = f5WithModel.filter(r => r.f5TotalResult !== null && r.f5TotalResult !== 'PUSH');
  const f5TotalCorrect = f5TotalResults.filter(r => r.f5TotalCorrect === 1);
  const f5RlResults = f5WithModel.filter(r => r.f5RlResult !== null && r.f5RlResult !== 'PUSH');
  const f5RlWins = f5RlResults.filter(r => r.f5RlResult === 'WIN');

  lines.push(`### Aggregate Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Games with F5 data | ${f5All.length} |`);
  lines.push(`| Games with actual F5 score | ${f5WithActual.length} |`);
  lines.push(`| Games with F5 model | ${f5WithModel.length} |`);
  lines.push(`| F5 ML: model correct | ${f5MlWins.length}/${f5MlResults.length} (${f5MlResults.length > 0 ? (f5MlWins.length/f5MlResults.length*100).toFixed(1) : "N/A"}%) |`);
  lines.push(`| F5 Total: model correct | ${f5TotalCorrect.length}/${f5TotalResults.length} (${f5TotalResults.length > 0 ? (f5TotalCorrect.length/f5TotalResults.length*100).toFixed(1) : "N/A"}%) |`);
  lines.push(`| F5 RL: model correct | ${f5RlWins.length}/${f5RlResults.length} (${f5RlResults.length > 0 ? (f5RlWins.length/f5RlResults.length*100).toFixed(1) : "N/A"}%) |`);
  lines.push(``);

  lines.push(`### Per-Game F5 Results`);
  lines.push(``);
  lines.push(`| Date | Game | Actual F5 | Model F5 | ML Result | Total Result | RL Result |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of f5WithActual) {
    const actualF5 = r.actualF5AwayScore !== null ? `${r.actualF5AwayScore}-${r.actualF5HomeScore}` : "—";
    const modelF5 = r.modelF5AwayWinPct ? `Away ${parseFloat(r.modelF5AwayWinPct).toFixed(0)}%` : "—";
    lines.push(`| ${r.gameDate} | ${r.awayTeam}@${r.homeTeam} | ${actualF5} | ${modelF5} | ${r.f5MlResult ?? "—"} | ${r.f5TotalResult ?? "—"} | ${r.f5RlResult ?? "—"} |`);
  }
  lines.push(``);

  // ── NRFI backtest ────────────────────────────────────────────────────────────
  lines.push(`## NRFI / YRFI (First Inning)`);
  lines.push(``);

  const [nrfiAll] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT
      gameDate, awayTeam, homeTeam,
      nrfiOverOdds, yrfiUnderOdds,
      modelPNrfi, modelNrfiOdds, modelYrfiOdds,
      nrfiActualResult, nrfiBacktestResult, nrfiCorrect
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND (nrfiActualResult IS NOT NULL OR modelPNrfi IS NOT NULL)
    ORDER BY gameDate
  `);

  const nrfiWithActual = nrfiAll.filter(r => r.nrfiActualResult !== null);
  const nrfiWithModel = nrfiAll.filter(r => r.modelPNrfi !== null && r.nrfiActualResult !== null);
  const nrfiCorrect = nrfiWithModel.filter(r => r.nrfiCorrect === 1);
  const nrfiActualNrfi = nrfiWithActual.filter(r => r.nrfiActualResult === 'NRFI');
  const nrfiRate = nrfiWithActual.length > 0 ? (nrfiActualNrfi.length / nrfiWithActual.length * 100).toFixed(1) : "N/A";
  const modelAccuracy = nrfiWithModel.length > 0 ? (nrfiCorrect.length / nrfiWithModel.length * 100).toFixed(1) : "N/A";

  lines.push(`### Aggregate Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Games with NRFI data | ${nrfiAll.length} |`);
  lines.push(`| Games with actual result | ${nrfiWithActual.length} |`);
  lines.push(`| NRFI actual rate | ${nrfiActualNrfi.length}/${nrfiWithActual.length} (${nrfiRate}%) |`);
  lines.push(`| YRFI actual rate | ${nrfiWithActual.length - nrfiActualNrfi.length}/${nrfiWithActual.length} (${nrfiWithActual.length > 0 ? (100 - parseFloat(nrfiRate)).toFixed(1) : "N/A"}%) |`);
  lines.push(`| Games with model | ${nrfiWithModel.length} |`);
  lines.push(`| Model accuracy (NRFI/YRFI) | ${nrfiCorrect.length}/${nrfiWithModel.length} (${modelAccuracy}%) |`);
  lines.push(``);

  lines.push(`### Per-Game NRFI Results`);
  lines.push(``);
  lines.push(`| Date | Game | Model P(NRFI) | FD NRFI Odds | Actual | Backtest |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of nrfiWithActual) {
    const modelPct = r.modelPNrfi ? `${parseFloat(r.modelPNrfi).toFixed(1)}%` : "—";
    lines.push(`| ${r.gameDate} | ${r.awayTeam}@${r.homeTeam} | ${modelPct} | ${r.nrfiOverOdds ?? "—"} | ${r.nrfiActualResult ?? "—"} | ${r.nrfiBacktestResult ?? "—"} |`);
  }
  lines.push(``);

  // ── Pipeline execution log ───────────────────────────────────────────────────
  lines.push(`## Pipeline Execution Log`);
  lines.push(``);
  lines.push(`| Phase | Date | Status | Detail |`);
  lines.push(`|---|---|---|---|`);
  for (const r of results) {
    lines.push(`| ${r.phase} | ${r.date} | ${r.status} | ${r.detail} |`);
  }
  lines.push(``);

  await conn.end();

  // Write report
  const reportPath = "/home/ubuntu/backtest_report_march25_april5.md";
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`[OUTPUT] Report written: ${reportPath} (${lines.length} lines)`);
}

main().catch((err) => {
  console.error("[PIPELINE] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

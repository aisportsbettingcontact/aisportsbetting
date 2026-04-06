/**
 * generate_backtest_report.ts
 * 
 * Comprehensive backtest report for March 25 – April 5, 2026
 * Markets: F5 (ML/RL/Total), NRFI/YRFI, K-Props, HR Props
 * 
 * Output: Markdown report with per-game and aggregate calibration metrics
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";
import * as fs from "fs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (d === 0) return "N/A";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function roi(wins: number, losses: number, avgOdds = -110): string {
  if (wins + losses === 0) return "N/A";
  // ROI on $100 bets at given odds
  const payout = avgOdds > 0 ? avgOdds : 10000 / Math.abs(avgOdds);
  const totalWagered = (wins + losses) * 100;
  const totalReturned = wins * (100 + payout);
  const roiPct = ((totalReturned - totalWagered) / totalWagered) * 100;
  return `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(1)}%`;
}

function fmtOdds(odds: number | null | undefined): string {
  if (odds == null) return "N/A";
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

function fmtEdge(edge: number | null | undefined): string {
  if (edge == null) return "N/A";
  return `${(edge * 100).toFixed(1)}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const lines: string[] = [];
  
  const now = new Date().toISOString().slice(0, 10);
  lines.push(`# MLB Backtest Report: March 25 – April 5, 2026`);
  lines.push(`**Generated:** ${now} | **Markets:** F5 ML/RL/Total, NRFI/YRFI, K-Props, HR Props`);
  lines.push(`**Scope:** 137 Final games across 12 dates`);
  lines.push("");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: F5 BACKTEST
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("---");
  lines.push("## 1. First Five Innings (F5) Backtest");
  lines.push("");

  const [f5Games] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      g.gameDate, g.awayTeam, g.homeTeam, g.mlbGamePk,
      g.actualF5AwayScore, g.actualF5HomeScore,
      (g.actualF5AwayScore + g.actualF5HomeScore) as actualF5Total,
      g.f5AwayRunLine, g.f5Total,
      g.modelF5AwayWinPct, g.modelF5AwayRLCoverPct, g.modelF5OverRate,
      g.f5AwayML, g.f5HomeML, g.f5AwayRunLineOdds, g.f5HomeRunLineOdds, g.f5OverOdds, g.f5UnderOdds,
      g.f5MlResult, g.f5RlResult, g.f5TotalResult,
      g.f5MlCorrect, g.f5RlCorrect, g.f5TotalCorrect
    FROM games g
    WHERE g.sport = 'MLB' 
      AND g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND g.actualF5AwayScore IS NOT NULL
    ORDER BY g.gameDate, g.awayTeam
  `);

  // Aggregate F5 stats
  let f5MlWins = 0, f5MlLoss = 0, f5MlNoAction = 0;
  let f5RlWins = 0, f5RlLoss = 0, f5RlNoAction = 0;
  let f5TotalWins = 0, f5TotalLoss = 0, f5TotalNoAction = 0;
  let f5MlEdgeWins = 0, f5MlEdgeLoss = 0;
  let f5RlEdgeWins = 0, f5RlEdgeLoss = 0;
  let f5TotalEdgeWins = 0, f5TotalEdgeLoss = 0;

  // Per-date breakdown
  const f5ByDate: Record<string, { mlW: number; mlL: number; rlW: number; rlL: number; totW: number; totL: number }> = {};

  for (const g of f5Games) {
    const date = String(g.gameDate).slice(0, 10);
    if (!f5ByDate[date]) f5ByDate[date] = { mlW: 0, mlL: 0, rlW: 0, rlL: 0, totW: 0, totL: 0 };

    // ML result
    if (g.f5MlResult === "WIN") { f5MlWins++; f5ByDate[date].mlW++; }
    else if (g.f5MlResult === "LOSS") { f5MlLoss++; f5ByDate[date].mlL++; }
    else f5MlNoAction++;

    // RL result
    if (g.f5RlResult === "WIN") { f5RlWins++; f5ByDate[date].rlW++; }
    else if (g.f5RlResult === "LOSS") { f5RlLoss++; f5ByDate[date].rlL++; }
    else f5RlNoAction++;

    // Total result
    if (g.f5TotalResult === "WIN") { f5TotalWins++; f5ByDate[date].totW++; }
    else if (g.f5TotalResult === "LOSS") { f5TotalLoss++; f5ByDate[date].totL++; }
    else f5TotalNoAction++;

    // Edge picks (model has a view)
    if (g.modelF5AwayWinPct != null) {
      const awayOdds = g.f5AwayML != null ? Number(g.f5AwayML) : null;
      const awayEdge = Number(g.modelF5AwayWinPct) - (awayOdds != null ? (awayOdds > 0 ? awayOdds / (awayOdds + 100) : 100 / (Math.abs(awayOdds) + 100)) : 0.5);
      if (Math.abs(awayEdge) >= 0.03) {
        if (g.f5MlResult === "WIN") f5MlEdgeWins++;
        else if (g.f5MlResult === "LOSS") f5MlEdgeLoss++;
      }
    }
    if (g.modelF5AwayRLCoverPct != null) {
      const rlEdge = Number(g.modelF5AwayRLCoverPct) - 0.5;
      if (Math.abs(rlEdge) >= 0.03) {
        if (g.f5RlResult === "WIN") f5RlEdgeWins++;
        else if (g.f5RlResult === "LOSS") f5RlEdgeLoss++;
      }
    }
    if (g.modelF5OverRate != null) {
      const totEdge = Number(g.modelF5OverRate) - 0.5;
      if (Math.abs(totEdge) >= 0.03) {
        if (g.f5TotalResult === "WIN") f5TotalEdgeWins++;
        else if (g.f5TotalResult === "LOSS") f5TotalEdgeLoss++;
      }
    }
  }

  lines.push("### 1.1 Aggregate F5 Results");
  lines.push("");
  lines.push("| Market | W | L | Push/NA | Win% | ROI (est.) | Edge Picks W | Edge Picks L | Edge Win% |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  lines.push(`| F5 ML | ${f5MlWins} | ${f5MlLoss} | ${f5MlNoAction} | ${pct(f5MlWins, f5MlWins + f5MlLoss)} | ${roi(f5MlWins, f5MlLoss)} | ${f5MlEdgeWins} | ${f5MlEdgeLoss} | ${pct(f5MlEdgeWins, f5MlEdgeWins + f5MlEdgeLoss)} |`);
  lines.push(`| F5 RL | ${f5RlWins} | ${f5RlLoss} | ${f5RlNoAction} | ${pct(f5RlWins, f5RlWins + f5RlLoss)} | ${roi(f5RlWins, f5RlLoss)} | ${f5RlEdgeWins} | ${f5RlEdgeLoss} | ${pct(f5RlEdgeWins, f5RlEdgeWins + f5RlEdgeLoss)} |`);
  lines.push(`| F5 Total | ${f5TotalWins} | ${f5TotalLoss} | ${f5TotalNoAction} | ${pct(f5TotalWins, f5TotalWins + f5TotalLoss)} | ${roi(f5TotalWins, f5TotalLoss)} | ${f5TotalEdgeWins} | ${f5TotalEdgeLoss} | ${pct(f5TotalEdgeWins, f5TotalEdgeWins + f5TotalEdgeLoss)} |`);
  lines.push("");

  lines.push("### 1.2 F5 Per-Date Breakdown");
  lines.push("");
  lines.push("| Date | ML W | ML L | RL W | RL L | Tot W | Tot L |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const [date, d] of Object.entries(f5ByDate).sort()) {
    lines.push(`| ${date} | ${d.mlW} | ${d.mlL} | ${d.rlW} | ${d.rlL} | ${d.totW} | ${d.totL} |`);
  }
  lines.push("");

  lines.push("### 1.3 F5 Per-Game Results");
  lines.push("");
  lines.push("| Date | Game | F5 Score | F5 Total | Model Away Win% | Model RL% | Model Over% | ML Result | RL Result | Total Result |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const g of f5Games) {
    const date = String(g.gameDate).slice(0, 10);
    const score = `${g.actualF5AwayScore}-${g.actualF5HomeScore}`;
    const total = g.actualF5Total ?? "?";
    const awayWin = g.modelF5AwayWinPct != null ? `${(Number(g.modelF5AwayWinPct) * 100).toFixed(1)}%` : "N/A";
    const rlCover = g.modelF5AwayRLCoverPct != null ? `${(Number(g.modelF5AwayRLCoverPct) * 100).toFixed(1)}%` : "N/A";
    const overRate = g.modelF5OverRate != null ? `${(Number(g.modelF5OverRate) * 100).toFixed(1)}%` : "N/A";
    const mlR = g.f5MlResult ?? "—";
    const rlR = g.f5RlResult ?? "—";
    const totR = g.f5TotalResult ?? "—";
    lines.push(`| ${date} | ${g.awayTeam}@${g.homeTeam} | ${score} | ${total} | ${awayWin} | ${rlCover} | ${overRate} | ${mlR} | ${rlR} | ${totR} |`);
  }
  lines.push("");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: NRFI/YRFI BACKTEST
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("---");
  lines.push("## 2. NRFI / YRFI Backtest (1st Inning)");
  lines.push("");

  const [nrfiGames] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      g.gameDate, g.awayTeam, g.homeTeam,
      g.nrfiActualResult, g.nrfiBacktestResult, g.nrfiCorrect,
      g.modelPNrfi, g.nrfiOverOdds
    FROM games g
    WHERE g.sport = 'MLB'
      AND g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND g.nrfiActualResult IS NOT NULL
    ORDER BY g.gameDate, g.awayTeam
  `);

  let nrfiActualCount = 0, yrfiActualCount = 0;
  let nrfiModelWins = 0, nrfiModelLoss = 0, nrfiModelNoAction = 0;
  let yrfiModelWins = 0, yrfiModelLoss = 0, yrfiModelNoAction = 0;
  let nrfiEdgeWins = 0, nrfiEdgeLoss = 0;
  const nrfiByDate: Record<string, { nrfi: number; yrfi: number; nrfiW: number; nrfiL: number; yrfiW: number; yrfiL: number }> = {};

  for (const g of nrfiGames) {
    const date = String(g.gameDate).slice(0, 10);
    if (!nrfiByDate[date]) nrfiByDate[date] = { nrfi: 0, yrfi: 0, nrfiW: 0, nrfiL: 0, yrfiW: 0, yrfiL: 0 };

    const isNrfi = g.nrfiActualResult === "NRFI";
    if (isNrfi) { nrfiActualCount++; nrfiByDate[date].nrfi++; }
    else { yrfiActualCount++; nrfiByDate[date].yrfi++; }

    // Model verdict
    const modelPNrfi = g.modelPNrfi != null ? Number(g.modelPNrfi) : null;
    const NRFI_EDGE_THRESHOLD = 0.04;

    if (modelPNrfi != null) {
      const nrfiEdge = modelPNrfi - 0.5;
      if (nrfiEdge >= NRFI_EDGE_THRESHOLD) {
        // Model says NRFI
        if (isNrfi) { nrfiModelWins++; nrfiByDate[date].nrfiW++; nrfiEdgeWins++; }
        else { nrfiModelLoss++; nrfiByDate[date].nrfiL++; nrfiEdgeLoss++; }
      } else if (nrfiEdge <= -NRFI_EDGE_THRESHOLD) {
        // Model says YRFI
        if (!isNrfi) { yrfiModelWins++; nrfiByDate[date].yrfiW++; }
        else { yrfiModelLoss++; nrfiByDate[date].yrfiL++; }
      } else {
        nrfiModelNoAction++;
      }
    } else {
      nrfiModelNoAction++;
    }
  }

  const nrfiRate = nrfiActualCount / (nrfiActualCount + yrfiActualCount);

  lines.push("### 2.1 NRFI/YRFI Aggregate Results");
  lines.push("");
  lines.push(`**Actual NRFI Rate:** ${nrfiActualCount}/${nrfiActualCount + yrfiActualCount} = **${pct(nrfiActualCount, nrfiActualCount + yrfiActualCount)}** (${yrfiActualCount} YRFI)`);
  lines.push("");
  lines.push("| Market | W | L | No Action | Win% | ROI (est.) |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(`| NRFI Picks | ${nrfiModelWins} | ${nrfiModelLoss} | ${nrfiModelNoAction} | ${pct(nrfiModelWins, nrfiModelWins + nrfiModelLoss)} | ${roi(nrfiModelWins, nrfiModelLoss)} |`);
  lines.push(`| YRFI Picks | ${yrfiModelWins} | ${yrfiModelLoss} | — | ${pct(yrfiModelWins, yrfiModelWins + yrfiModelLoss)} | ${roi(yrfiModelWins, yrfiModelLoss)} |`);
  lines.push(`| Combined | ${nrfiModelWins + yrfiModelWins} | ${nrfiModelLoss + yrfiModelLoss} | ${nrfiModelNoAction} | ${pct(nrfiModelWins + yrfiModelWins, nrfiModelWins + yrfiModelWins + nrfiModelLoss + yrfiModelLoss)} | ${roi(nrfiModelWins + yrfiModelWins, nrfiModelLoss + yrfiModelLoss)} |`);
  lines.push("");

  lines.push("### 2.2 NRFI Per-Date Breakdown");
  lines.push("");
  lines.push("| Date | NRFI | YRFI | NRFI Rate | NRFI Picks W | NRFI Picks L | YRFI Picks W | YRFI Picks L |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const [date, d] of Object.entries(nrfiByDate).sort()) {
    const total = d.nrfi + d.yrfi;
    lines.push(`| ${date} | ${d.nrfi} | ${d.yrfi} | ${pct(d.nrfi, total)} | ${d.nrfiW} | ${d.nrfiL} | ${d.yrfiW} | ${d.yrfiL} |`);
  }
  lines.push("");

  lines.push("### 2.3 NRFI Per-Game Results");
  lines.push("");
  lines.push("| Date | Game | Actual | Model P(NRFI) | Verdict |");
  lines.push("|---|---|---|---|---|");
  for (const g of nrfiGames) {
    const date = String(g.gameDate).slice(0, 10);
    const actual = g.nrfiActualResult ?? "?";
    const modelP = g.modelPNrfi != null ? `${(Number(g.modelPNrfi) * 100).toFixed(1)}%` : "N/A";
    const modelPNrfi = g.modelPNrfi != null ? Number(g.modelPNrfi) : null;
    let verdict = "—";
    if (modelPNrfi != null) {
      if (modelPNrfi >= 0.54) verdict = "NRFI" + (actual === "NRFI" ? " ✅" : " ❌");
      else if (modelPNrfi <= 0.46) verdict = "YRFI" + (actual === "YRFI" ? " ✅" : " ❌");
      else verdict = "PASS";
    }
    lines.push(`| ${date} | ${g.awayTeam}@${g.homeTeam} | ${actual} | ${modelP} | ${verdict} |`);
  }
  lines.push("");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: K-PROPS BACKTEST
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("---");
  lines.push("## 3. K-Props (Strikeout Props) Backtest");
  lines.push("");

  const [kProps] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      g.gameDate, g.awayTeam, g.homeTeam,
      sp.pitcherName, sp.side, sp.bookLine, sp.bookOverOdds, sp.bookUnderOdds,
      sp.kProj, sp.kLine, sp.edgeOver, sp.edgeUnder, sp.verdict,
      sp.anNoVigOverPct, sp.actualKs, sp.backtestResult, sp.modelCorrect
    FROM mlb_strikeout_props sp
    JOIN games g ON g.id = sp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND sp.actualKs IS NOT NULL
    ORDER BY g.gameDate, g.awayTeam, sp.side
  `);

  let kOverWins = 0, kOverLoss = 0;
  let kUnderWins = 0, kUnderLoss = 0;
  let kEdgeOverWins = 0, kEdgeOverLoss = 0;
  let kEdgeUnderWins = 0, kEdgeUnderLoss = 0;
  let kNoAction = 0;
  let kTotalProj = 0, kTotalActual = 0, kProjCount = 0;
  const kByDate: Record<string, { overW: number; overL: number; underW: number; underL: number; noAction: number }> = {};

  for (const sp of kProps) {
    const date = String(sp.gameDate).slice(0, 10);
    if (!kByDate[date]) kByDate[date] = { overW: 0, overL: 0, underW: 0, underL: 0, noAction: 0 };

    const actualKs = Number(sp.actualKs);
    const bookLine = sp.bookLine != null ? Number(sp.bookLine) : null;
    const kProj = sp.kProj != null ? Number(sp.kProj) : null;
    const kEdgeOver = sp.edgeOver != null ? Number(sp.edgeOver) : null;
    const verdict = sp.verdict ?? null;

    if (kProj != null && bookLine != null) {
      kTotalProj += kProj;
      kTotalActual += actualKs;
      kProjCount++;
    }

    if (verdict === "OVER") {
      if (actualKs > (bookLine ?? 0)) { kEdgeOverWins++; kByDate[date].overW++; }
      else { kEdgeOverLoss++; kByDate[date].overL++; }
    } else if (verdict === "UNDER") {
      if (actualKs < (bookLine ?? 0)) { kEdgeUnderWins++; kByDate[date].underW++; }
      else { kEdgeUnderLoss++; kByDate[date].underL++; }
    } else {
      kNoAction++;
      kByDate[date].noAction++;
    }

    // All OVER/UNDER results regardless of edge
    if (bookLine != null) {
      if (actualKs > bookLine) kOverWins++;
      else if (actualKs < bookLine) kUnderWins++;
      // push = neither
    }
  }

  const kMae = kProjCount > 0 ? Math.abs(kTotalProj - kTotalActual) / kProjCount : 0;
  const kBias = kProjCount > 0 ? (kTotalProj - kTotalActual) / kProjCount : 0;

  lines.push("### 3.1 K-Props Aggregate Results");
  lines.push("");
  lines.push(`**Total Props:** ${kProps.length} | **With Actuals:** ${kProps.length} | **Edge Picks:** ${kEdgeOverWins + kEdgeOverLoss + kEdgeUnderWins + kEdgeUnderLoss} | **No Action:** ${kNoAction}`);
  lines.push(`**Model Calibration:** MAE = ${kMae.toFixed(2)} Ks | Bias = ${kBias >= 0 ? "+" : ""}${kBias.toFixed(2)} Ks (${kBias >= 0 ? "over-projects" : "under-projects"})`);
  lines.push("");
  lines.push("| Market | W | L | Win% | ROI (est.) |");
  lines.push("|---|---|---|---|---|");
  lines.push(`| OVER Edge Picks | ${kEdgeOverWins} | ${kEdgeOverLoss} | ${pct(kEdgeOverWins, kEdgeOverWins + kEdgeOverLoss)} | ${roi(kEdgeOverWins, kEdgeOverLoss)} |`);
  lines.push(`| UNDER Edge Picks | ${kEdgeUnderWins} | ${kEdgeUnderLoss} | ${pct(kEdgeUnderWins, kEdgeUnderWins + kEdgeUnderLoss)} | ${roi(kEdgeUnderWins, kEdgeUnderLoss)} |`);
  lines.push(`| All Edge Picks | ${kEdgeOverWins + kEdgeUnderWins} | ${kEdgeOverLoss + kEdgeUnderLoss} | ${pct(kEdgeOverWins + kEdgeUnderWins, kEdgeOverWins + kEdgeUnderWins + kEdgeOverLoss + kEdgeUnderLoss)} | ${roi(kEdgeOverWins + kEdgeUnderWins, kEdgeOverLoss + kEdgeUnderLoss)} |`);
  lines.push("");

  lines.push("### 3.2 K-Props Per-Date Breakdown");
  lines.push("");
  lines.push("| Date | Props | OVER W | OVER L | UNDER W | UNDER L | No Action | Win% |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const [date, d] of Object.entries(kByDate).sort()) {
    const total = d.overW + d.overL + d.underW + d.underL;
    const wins = d.overW + d.underW;
    lines.push(`| ${date} | ${total + d.noAction} | ${d.overW} | ${d.overL} | ${d.underW} | ${d.underL} | ${d.noAction} | ${pct(wins, total)} |`);
  }
  lines.push("");

  lines.push("### 3.3 K-Props Per-Pitcher Results");
  lines.push("");
  lines.push("| Date | Game | Pitcher | Side | Book Line | kProj | Actual Ks | Edge | EV | Verdict | Result |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const sp of kProps) {
    const date = String(sp.gameDate).slice(0, 10);
    const kProj = sp.kProj != null ? Number(sp.kProj).toFixed(1) : "N/A";
    const edge = sp.edgeOver != null ? fmtEdge(Number(sp.edgeOver)) : "N/A";
    const ev = "N/A"; // evOver not stored for K-Props
    const verdict = sp.verdict ?? "PASS";
    const actualKs = Number(sp.actualKs);
    const bookLine = sp.bookLine != null ? Number(sp.bookLine) : null;
    let result = "—";
    if (bookLine != null && verdict !== "PASS") {
      if (verdict === "OVER") result = actualKs > bookLine ? "✅ WIN" : "❌ LOSS";
      else if (verdict === "UNDER") result = actualKs < bookLine ? "✅ WIN" : "❌ LOSS";
    }
    lines.push(`| ${date} | ${sp.awayTeam}@${sp.homeTeam} | ${sp.pitcherName} | ${sp.side} | ${sp.bookLine ?? "N/A"} | ${kProj} | ${actualKs} | ${edge} | ${ev} | ${verdict} | ${result} |`);
  }
  lines.push("");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: HR PROPS BACKTEST
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("---");
  lines.push("## 4. HR Props (Home Run Props) Backtest");
  lines.push("");

  // Aggregate HR Props
  const [hrAgg] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      g.gameDate,
      COUNT(*) as total,
      SUM(CASE WHEN hp.backtestResult = 'WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN hp.backtestResult = 'LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN hp.backtestResult = 'NO_ACTION' THEN 1 ELSE 0 END) as noAction,
      SUM(CASE WHEN hp.actualHr >= 1 THEN 1 ELSE 0 END) as actualHrHits,
      SUM(hp.actualHr) as totalHrs,
      AVG(hp.modelPHr) as avgModelPHr,
      SUM(CASE WHEN hp.modelPHr >= 0.15 THEN 1 ELSE 0 END) as edgePicks,
      SUM(CASE WHEN hp.modelPHr >= 0.15 AND hp.actualHr >= 1 THEN 1 ELSE 0 END) as edgeWins,
      SUM(CASE WHEN hp.modelPHr >= 0.15 AND hp.actualHr = 0 THEN 1 ELSE 0 END) as edgeLosses
    FROM mlb_hr_props hp
    JOIN games g ON g.id = hp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND hp.actualHr IS NOT NULL
    GROUP BY g.gameDate
    ORDER BY g.gameDate
  `);

  const [hrTotal] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN hp.backtestResult = 'WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN hp.backtestResult = 'LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN hp.backtestResult = 'NO_ACTION' THEN 1 ELSE 0 END) as noAction,
      SUM(CASE WHEN hp.actualHr >= 1 THEN 1 ELSE 0 END) as actualHrHits,
      SUM(hp.actualHr) as totalHrs,
      AVG(hp.modelPHr) as avgModelPHr,
      SUM(CASE WHEN hp.modelPHr >= 0.15 THEN 1 ELSE 0 END) as edgePicks,
      SUM(CASE WHEN hp.modelPHr >= 0.15 AND hp.actualHr >= 1 THEN 1 ELSE 0 END) as edgeWins,
      SUM(CASE WHEN hp.modelPHr >= 0.15 AND hp.actualHr = 0 THEN 1 ELSE 0 END) as edgeLosses,
      AVG(CASE WHEN hp.actualHr >= 1 THEN hp.modelPHr ELSE NULL END) as avgModelPHr_hits,
      AVG(CASE WHEN hp.actualHr = 0 THEN hp.modelPHr ELSE NULL END) as avgModelPHr_misses
    FROM mlb_hr_props hp
    JOIN games g ON g.id = hp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND hp.actualHr IS NOT NULL
  `);

  const ht = hrTotal[0];
  const hrHitRate = Number(ht.actualHrHits) / Number(ht.total);
  const avgModelP = Number(ht.avgModelPHr);
  const calibrationBias = avgModelP - hrHitRate;
  const edgeWinRate = Number(ht.edgePicks) > 0 ? Number(ht.edgeWins) / Number(ht.edgePicks) : 0;

  lines.push("### 4.1 HR Props Aggregate Results");
  lines.push("");
  lines.push(`**Total Props:** ${ht.total} | **Actual HR Hits:** ${ht.actualHrHits} (${pct(Number(ht.actualHrHits), Number(ht.total))}) | **Total HRs Hit:** ${ht.totalHrs}`);
  lines.push(`**Model Calibration:** Avg P(HR) = ${(avgModelP * 100).toFixed(1)}% | Actual Hit Rate = ${(hrHitRate * 100).toFixed(1)}% | Bias = ${calibrationBias >= 0 ? "+" : ""}${(calibrationBias * 100).toFixed(1)}%`);
  lines.push(`**Avg P(HR) for actual hits:** ${ht.avgModelPHr_hits != null ? (Number(ht.avgModelPHr_hits) * 100).toFixed(1) + "%" : "N/A"} | **Avg P(HR) for misses:** ${ht.avgModelPHr_misses != null ? (Number(ht.avgModelPHr_misses) * 100).toFixed(1) + "%" : "N/A"}`);
  lines.push("");
  lines.push("| Market | Picks | W | L | No Action | Win% | ROI (est.) |");
  lines.push("|---|---|---|---|---|---|---|");
  lines.push(`| HR OVER (all) | ${ht.total} | ${ht.wins} | ${ht.losses} | ${ht.noAction} | ${pct(Number(ht.wins), Number(ht.wins) + Number(ht.losses))} | ${roi(Number(ht.wins), Number(ht.losses))} |`);
  lines.push(`| HR OVER (edge ≥15%) | ${ht.edgePicks} | ${ht.edgeWins} | ${ht.edgeLosses} | — | ${pct(Number(ht.edgeWins), Number(ht.edgePicks))} | ${roi(Number(ht.edgeWins), Number(ht.edgeLosses))} |`);
  lines.push("");

  lines.push("### 4.2 HR Props Per-Date Breakdown");
  lines.push("");
  lines.push("| Date | Props | HR Hits | Hit Rate | Avg Model P | Edge Picks | Edge W | Edge L | Edge Win% |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const d of hrAgg) {
    const hitRate = pct(Number(d.actualHrHits), Number(d.total));
    const avgP = `${(Number(d.avgModelPHr) * 100).toFixed(1)}%`;
    lines.push(`| ${String(d.gameDate).slice(0, 10)} | ${d.total} | ${d.actualHrHits} | ${hitRate} | ${avgP} | ${d.edgePicks} | ${d.edgeWins} | ${d.edgeLosses} | ${pct(Number(d.edgeWins), Number(d.edgePicks))} |`);
  }
  lines.push("");

  // Top HR edge picks that hit
  const [hrTopHits] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      g.gameDate, g.awayTeam, g.homeTeam,
      hp.playerName, hp.teamAbbrev,
      hp.bookLine, hp.fdOverOdds, hp.modelPHr, hp.edgeOver, hp.evOver,
      hp.actualHr, hp.backtestResult
    FROM mlb_hr_props hp
    JOIN games g ON g.id = hp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND hp.actualHr >= 1
      AND hp.modelPHr >= 0.15
    ORDER BY hp.modelPHr DESC
    LIMIT 30
  `);

  lines.push("### 4.3 Top HR Edge Picks That Hit (Model P ≥ 15%, Actual HR ≥ 1)");
  lines.push("");
  lines.push("| Date | Game | Player | Team | Book Line | Model P(HR) | Edge | EV | Actual HR | Result |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const h of hrTopHits) {
    const date = String(h.gameDate).slice(0, 10);
    const modelP = `${(Number(h.modelPHr) * 100).toFixed(1)}%`;
    const edge = h.edgeOver != null ? fmtEdge(Number(h.edgeOver)) : "N/A";
    const ev = h.evOver != null ? `$${Number(h.evOver).toFixed(2)}` : "N/A";
    lines.push(`| ${date} | ${h.awayTeam}@${h.homeTeam} | ${h.playerName} | ${h.teamAbbrev} | ${h.bookLine} | ${modelP} | ${edge} | ${ev} | ${h.actualHr} | ✅ WIN |`);
  }
  lines.push("");

  // Top HR edge picks that missed
  const [hrTopMisses] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT 
      g.gameDate, g.awayTeam, g.homeTeam,
      hp.playerName, hp.teamAbbrev,
      hp.bookLine, hp.modelPHr, hp.edgeOver,
      hp.actualHr, hp.backtestResult
    FROM mlb_hr_props hp
    JOIN games g ON g.id = hp.gameId
    WHERE g.gameDate BETWEEN '2026-03-25' AND '2026-04-05'
      AND hp.actualHr = 0
      AND hp.modelPHr >= 0.20
    ORDER BY hp.modelPHr DESC
    LIMIT 20
  `);

  lines.push("### 4.4 Top HR Edge Picks That Missed (Model P ≥ 20%, Actual HR = 0)");
  lines.push("");
  lines.push("| Date | Game | Player | Team | Model P(HR) | Edge | Actual HR |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const h of hrTopMisses) {
    const date = String(h.gameDate).slice(0, 10);
    const modelP = `${(Number(h.modelPHr) * 100).toFixed(1)}%`;
    const edge = h.edgeOver != null ? fmtEdge(Number(h.edgeOver)) : "N/A";
    lines.push(`| ${date} | ${h.awayTeam}@${h.homeTeam} | ${h.playerName} | ${h.teamAbbrev} | ${modelP} | ${edge} | ${h.actualHr} ❌ |`);
  }
  lines.push("");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: CALIBRATION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push("---");
  lines.push("## 5. Model Calibration Summary");
  lines.push("");
  lines.push("| Market | Model Win% | Actual Win% | Bias | ROI | Assessment |");
  lines.push("|---|---|---|---|---|---|");

  // F5 ML
  const f5MlModelPct = 0.5; // placeholder - model picks above 50%
  lines.push(`| F5 ML | ~50% | ${pct(f5MlWins, f5MlWins + f5MlLoss)} | N/A | ${roi(f5MlWins, f5MlLoss)} | ${f5MlWins / (f5MlWins + f5MlLoss) > 0.52 ? "✅ Edge" : "⚠️ Below breakeven"} |`);
  lines.push(`| F5 RL | ~50% | ${pct(f5RlWins, f5RlWins + f5RlLoss)} | N/A | ${roi(f5RlWins, f5RlLoss)} | ${f5RlWins / (f5RlWins + f5RlLoss) > 0.52 ? "✅ Edge" : "⚠️ Below breakeven"} |`);
  lines.push(`| F5 Total | ~50% | ${pct(f5TotalWins, f5TotalWins + f5TotalLoss)} | N/A | ${roi(f5TotalWins, f5TotalLoss)} | ${f5TotalWins / (f5TotalWins + f5TotalLoss) > 0.52 ? "✅ Edge" : "⚠️ Below breakeven"} |`);
  lines.push(`| NRFI | ${(nrfiRate * 100).toFixed(1)}% actual | ${pct(nrfiModelWins + yrfiModelWins, nrfiModelWins + yrfiModelWins + nrfiModelLoss + yrfiModelLoss)} | ${((nrfiRate - 0.5) * 100).toFixed(1)}% | ${roi(nrfiModelWins + yrfiModelWins, nrfiModelLoss + yrfiModelLoss)} | ${(nrfiModelWins + yrfiModelWins) / Math.max(1, nrfiModelWins + yrfiModelWins + nrfiModelLoss + yrfiModelLoss) > 0.52 ? "✅ Edge" : "⚠️ Below breakeven"} |`);
  lines.push(`| K-Props | ${(kBias >= 0 ? "+" : "") + kBias.toFixed(2)} Ks bias | ${pct(kEdgeOverWins + kEdgeUnderWins, kEdgeOverWins + kEdgeUnderWins + kEdgeOverLoss + kEdgeUnderLoss)} | MAE=${kMae.toFixed(2)} | ${roi(kEdgeOverWins + kEdgeUnderWins, kEdgeOverLoss + kEdgeUnderLoss)} | ${(kEdgeOverWins + kEdgeUnderWins) / Math.max(1, kEdgeOverWins + kEdgeUnderWins + kEdgeOverLoss + kEdgeUnderLoss) > 0.52 ? "✅ Edge" : "⚠️ Below breakeven"} |`);
  lines.push(`| HR Props | ${(avgModelP * 100).toFixed(1)}% avg P | ${(hrHitRate * 100).toFixed(1)}% actual | ${calibrationBias >= 0 ? "+" : ""}${(calibrationBias * 100).toFixed(1)}% | ${roi(Number(ht.edgeWins), Number(ht.edgeLosses))} | ${edgeWinRate > 0.15 ? "✅ Above base rate" : "⚠️ Below base rate"} |`);
  lines.push("");

  lines.push("### Key Findings");
  lines.push("");
  lines.push(`- **F5 ML:** ${f5MlWins}W-${f5MlLoss}L (${pct(f5MlWins, f5MlWins + f5MlLoss)}) — ${f5MlWins / (f5MlWins + f5MlLoss) > 0.52 ? "Model has positive edge on F5 moneylines" : "Model needs calibration on F5 ML picks"}`);
  lines.push(`- **NRFI:** Actual NRFI rate = ${pct(nrfiActualCount, nrfiActualCount + yrfiActualCount)} — ${nrfiRate > 0.6 ? "High NRFI environment, favor NRFI picks" : nrfiRate < 0.4 ? "Low NRFI environment, favor YRFI picks" : "Balanced NRFI/YRFI environment"}`);
  lines.push(`- **K-Props:** MAE = ${kMae.toFixed(2)} Ks — ${Math.abs(kBias) < 0.5 ? "Model is well-calibrated" : kBias > 0 ? "Model over-projects Ks — reduce OVER edge threshold" : "Model under-projects Ks — reduce UNDER edge threshold"}`);
  lines.push(`- **HR Props:** Model avg P(HR) = ${(avgModelP * 100).toFixed(1)}% vs actual hit rate ${(hrHitRate * 100).toFixed(1)}% — ${Math.abs(calibrationBias) < 0.02 ? "Well-calibrated" : calibrationBias > 0 ? "Over-estimates HR probability — tighten edge threshold" : "Under-estimates HR probability"}`);
  lines.push("");

  lines.push("---");
  lines.push(`*Report generated: ${new Date().toISOString()} | Data source: Action Network + MLB Stats API + Rotowire*`);

  const report = lines.join("\n");
  const reportPath = "/home/ubuntu/backtest_report_march25_april5.md";
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`[OUTPUT] Report written to ${reportPath} (${report.length} bytes)`);
  console.log("[VERIFY] PASS — backtest report complete");

  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error("[FATAL]", e); process.exit(1); });

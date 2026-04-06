/**
 * mlbRetroactiveOutcomesFetcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches actual game outcomes from MLB Stats API for all completed games
 * in a given date range and populates:
 *
 *   games table:
 *     - actualF5AwayScore, actualF5HomeScore (from linescore innings 1-5)
 *     - nrfiActualResult ('NRFI' | 'YRFI') (from linescore inning 1)
 *     - actualAwayScore, actualHomeScore (from linescore total)
 *
 *   mlb_strikeout_props:
 *     - actualKs (from boxscore pitcher strikeouts)
 *     - backtestResult ('WIN' | 'LOSS' | 'PUSH' | 'NO_ACTION')
 *     - modelError (actualKs - kProj)
 *     - modelCorrect (1/0)
 *
 *   mlb_hr_props:
 *     - actualHr (1 if HR hit, 0 if not)
 *     - backtestResult ('WIN' | 'LOSS' | 'NO_ACTION')
 *
 * [INPUT]  startDate, endDate (YYYY-MM-DD)
 * [OUTPUT] per-game structured log + summary stats
 */
import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GameRecord {
  id: number;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  mlbGamePk: number;
  gameStatus: string;
}

interface LinescoreInning {
  num: number;
  away: { runs: number; hits: number; errors: number };
  home: { runs: number; hits: number; errors: number };
}

interface LinescoreData {
  innings: LinescoreInning[];
}

interface BoxscorePitcher {
  personId: number;
  fullName: string;
  strikeOuts: number;
  inningsPitched: string;
  isStarter: boolean;
}

interface BoxscoreBatter {
  personId: number;
  fullName: string;
  homeRuns: number;
  atBats: number;
}

interface BoxscoreData {
  awayPitchers: BoxscorePitcher[];
  homePitchers: BoxscorePitcher[];
  awayBatters: BoxscoreBatter[];
  homeBatters: BoxscoreBatter[];
}

interface GameOutcome {
  gamePk: number;
  gameId: number;
  awayTeam: string;
  homeTeam: string;
  gameDate: string;
  // F5
  f5AwayRuns: number;
  f5HomeRuns: number;
  f5Total: number;
  // Inning 1
  inning1AwayRuns: number;
  inning1HomeRuns: number;
  nrfiResult: "NRFI" | "YRFI";
  // Full game
  finalAwayScore: number;
  finalHomeScore: number;
  // Pitchers
  pitchers: BoxscorePitcher[];
  // Batters
  batters: BoxscoreBatter[];
  // Errors
  fetchErrors: string[];
}

// ─── MLB Stats API helpers ─────────────────────────────────────────────────────

const MLB_API = "https://statsapi.mlb.com/api/v1";

async function fetchLinescore(gamePk: number): Promise<LinescoreData | null> {
  try {
    const resp = await fetch(`${MLB_API}/game/${gamePk}/linescore`);
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    if (!data.innings || data.innings.length === 0) return null;
    return data as LinescoreData;
  } catch {
    return null;
  }
}

async function fetchBoxscore(gamePk: number): Promise<BoxscoreData | null> {
  try {
    const resp = await fetch(`${MLB_API}/game/${gamePk}/boxscore`);
    if (!resp.ok) return null;
    const data = await resp.json() as any;

    const awayPitchers: BoxscorePitcher[] = [];
    const homePitchers: BoxscorePitcher[] = [];
    const awayBatters: BoxscoreBatter[] = [];
    const homeBatters: BoxscoreBatter[] = [];

    const awayPlayers = data.teams?.away?.players ?? {};
    const homePlayers = data.teams?.home?.players ?? {};
    const awayPitcherIds: number[] = data.teams?.away?.pitchers ?? [];
    const homePitcherIds: number[] = data.teams?.home?.pitchers ?? [];
    const awayBatterIds: number[] = data.teams?.away?.batters ?? [];
    const homeBatterIds: number[] = data.teams?.home?.batters ?? [];

    // Extract pitchers
    for (const pid of awayPitcherIds) {
      const p = awayPlayers[`ID${pid}`];
      if (!p) continue;
      awayPitchers.push({
        personId: pid,
        fullName: p.person?.fullName ?? `ID${pid}`,
        strikeOuts: p.stats?.pitching?.strikeOuts ?? 0,
        inningsPitched: p.stats?.pitching?.inningsPitched ?? "0.0",
        isStarter: awayPitcherIds.indexOf(pid) === 0,
      });
    }
    for (const pid of homePitcherIds) {
      const p = homePlayers[`ID${pid}`];
      if (!p) continue;
      homePitchers.push({
        personId: pid,
        fullName: p.person?.fullName ?? `ID${pid}`,
        strikeOuts: p.stats?.pitching?.strikeOuts ?? 0,
        inningsPitched: p.stats?.pitching?.inningsPitched ?? "0.0",
        isStarter: homePitcherIds.indexOf(pid) === 0,
      });
    }

    // Extract batters
    for (const pid of awayBatterIds) {
      const p = awayPlayers[`ID${pid}`];
      if (!p) continue;
      awayBatters.push({
        personId: pid,
        fullName: p.person?.fullName ?? `ID${pid}`,
        homeRuns: p.stats?.batting?.homeRuns ?? 0,
        atBats: p.stats?.batting?.atBats ?? 0,
      });
    }
    for (const pid of homeBatterIds) {
      const p = homePlayers[`ID${pid}`];
      if (!p) continue;
      homeBatters.push({
        personId: pid,
        fullName: p.person?.fullName ?? `ID${pid}`,
        homeRuns: p.stats?.batting?.homeRuns ?? 0,
        atBats: p.stats?.batting?.atBats ?? 0,
      });
    }

    return { awayPitchers, homePitchers, awayBatters, homeBatters };
  } catch {
    return null;
  }
}

// ─── Outcome computation ───────────────────────────────────────────────────────

async function fetchGameOutcome(game: GameRecord): Promise<GameOutcome> {
  const outcome: GameOutcome = {
    gamePk: game.mlbGamePk,
    gameId: game.id,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    gameDate: game.gameDate,
    f5AwayRuns: 0,
    f5HomeRuns: 0,
    f5Total: 0,
    inning1AwayRuns: 0,
    inning1HomeRuns: 0,
    nrfiResult: "YRFI",
    finalAwayScore: 0,
    finalHomeScore: 0,
    pitchers: [],
    batters: [],
    fetchErrors: [],
  };

  // Fetch linescore
  const ls = await fetchLinescore(game.mlbGamePk);
  if (!ls) {
    outcome.fetchErrors.push(`linescore fetch failed for gamePk=${game.mlbGamePk}`);
  } else {
    // F5 runs (innings 1-5)
    for (let i = 0; i < Math.min(5, ls.innings.length); i++) {
      const inn = ls.innings[i];
      outcome.f5AwayRuns += inn.away?.runs ?? 0;
      outcome.f5HomeRuns += inn.home?.runs ?? 0;
    }
    outcome.f5Total = outcome.f5AwayRuns + outcome.f5HomeRuns;

    // Inning 1
    if (ls.innings.length > 0) {
      outcome.inning1AwayRuns = ls.innings[0].away?.runs ?? 0;
      outcome.inning1HomeRuns = ls.innings[0].home?.runs ?? 0;
      outcome.nrfiResult = (outcome.inning1AwayRuns + outcome.inning1HomeRuns) === 0 ? "NRFI" : "YRFI";
    }

    // Final score
    for (const inn of ls.innings) {
      outcome.finalAwayScore += inn.away?.runs ?? 0;
      outcome.finalHomeScore += inn.home?.runs ?? 0;
    }
  }

  // Fetch boxscore
  const bs = await fetchBoxscore(game.mlbGamePk);
  if (!bs) {
    outcome.fetchErrors.push(`boxscore fetch failed for gamePk=${game.mlbGamePk}`);
  } else {
    outcome.pitchers = [...bs.awayPitchers, ...bs.homePitchers];
    outcome.batters = [...bs.awayBatters, ...bs.homeBatters];
  }

  return outcome;
}

// ─── DB update helpers ─────────────────────────────────────────────────────────

async function updateGameActuals(
  conn: mysql2.Connection,
  outcome: GameOutcome
): Promise<void> {
  await conn.execute(
    `UPDATE games SET
      actualF5AwayScore = ?,
      actualF5HomeScore = ?,
      nrfiActualResult = ?,
      actualAwayScore = ?,
      actualHomeScore = ?
    WHERE id = ?`,
    [
      outcome.f5AwayRuns,
      outcome.f5HomeRuns,
      outcome.nrfiResult,
      outcome.finalAwayScore,
      outcome.finalHomeScore,
      outcome.gameId,
    ]
  );
}

async function updateKPropsActuals(
  conn: mysql2.Connection,
  outcome: GameOutcome
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Get all K-Props for this game
  const [props] = await conn.execute<mysql2.RowDataPacket[]>(
    `SELECT id, pitcherName, bookLine, kProj, verdict, side FROM mlb_strikeout_props WHERE gameId = ?`,
    [outcome.gameId]
  );

  for (const prop of props) {
    // Match pitcher to boxscore by name (normalize)
    const normalize = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

    const propNorm = normalize(prop.pitcherName);
    const matched = outcome.pitchers.find((p) => {
      const pNorm = normalize(p.fullName);
      return pNorm === propNorm || pNorm.includes(propNorm) || propNorm.includes(pNorm);
    });

    if (!matched) {
      errors.push(`[K-PROPS] No pitcher match for "${prop.pitcherName}" in ${outcome.awayTeam}@${outcome.homeTeam}`);
      continue;
    }

    const actualKs = matched.strikeOuts;
    const bookLine = parseFloat(prop.bookLine ?? "0");
    const kProj = parseFloat(prop.kProj ?? "0");
    const modelError = actualKs - kProj;

    // Backtest result
    let backtestResult: string;
    let modelCorrect: number | null = null;

    if (prop.verdict === "OVER") {
      backtestResult = actualKs > bookLine ? "WIN" : actualKs === bookLine ? "PUSH" : "LOSS";
      modelCorrect = actualKs > bookLine ? 1 : 0;
    } else if (prop.verdict === "UNDER") {
      backtestResult = actualKs < bookLine ? "WIN" : actualKs === bookLine ? "PUSH" : "LOSS";
      modelCorrect = actualKs < bookLine ? 1 : 0;
    } else {
      backtestResult = "NO_ACTION";
    }

    await conn.execute(
      `UPDATE mlb_strikeout_props SET
        actualKs = ?,
        modelError = ?,
        backtestResult = ?,
        modelCorrect = ?
      WHERE id = ?`,
      [actualKs, modelError.toFixed(2), backtestResult, modelCorrect, prop.id]
    );
    updated++;
  }

  return { updated, errors };
}

async function updateHrPropsActuals(
  conn: mysql2.Connection,
  outcome: GameOutcome
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Get all HR Props for this game
  const [props] = await conn.execute<mysql2.RowDataPacket[]>(
    `SELECT id, playerName, mlbamId, verdict FROM mlb_hr_props WHERE gameId = ?`,
    [outcome.gameId]
  );

  // Build mlbamId → HR map from boxscore
  const hrByMlbamId = new Map<number, number>();
  for (const b of outcome.batters) {
    hrByMlbamId.set(b.personId, b.homeRuns);
  }

  // Build name → HR map as fallback
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
  const hrByName = new Map<string, number>();
  for (const b of outcome.batters) {
    hrByName.set(normalize(b.fullName), b.homeRuns);
  }

  for (const prop of props) {
    let actualHr: number | null = null;

    // Try mlbamId first
    if (prop.mlbamId && hrByMlbamId.has(Number(prop.mlbamId))) {
      actualHr = hrByMlbamId.get(Number(prop.mlbamId))! > 0 ? 1 : 0;
    } else {
      // Fallback: name match
      const propNorm = normalize(prop.playerName ?? "");
      const hrVal = hrByName.get(propNorm);
      if (hrVal !== undefined) {
        actualHr = hrVal > 0 ? 1 : 0;
      } else {
        // Partial name match
        for (const entry of Array.from(hrByName.entries())) {
          const [name, hr] = entry;
          if (name.includes(propNorm) || propNorm.includes(name)) {
            actualHr = hr > 0 ? 1 : 0;
            break;
          }
        }
      }
    }

    if (actualHr === null) {
      // Player didn't appear in boxscore (DNP) — treat as 0 HRs
      actualHr = 0;
    }

    // Backtest result
    let backtestResult: string;
    if (prop.verdict === "OVER") {
      backtestResult = actualHr === 1 ? "WIN" : "LOSS";
    } else {
      backtestResult = "NO_ACTION";
    }

    await conn.execute(
      `UPDATE mlb_hr_props SET actualHr = ?, backtestResult = ? WHERE id = ?`,
      [actualHr, backtestResult, prop.id]
    );
    updated++;
  }

  return { updated, errors };
}

async function computeF5Backtest(
  conn: mysql2.Connection,
  outcome: GameOutcome,
  gameRow: mysql2.RowDataPacket
): Promise<void> {
  const f5Away = outcome.f5AwayRuns;
  const f5Home = outcome.f5HomeRuns;
  const f5Total = outcome.f5Total;

  // F5 ML result
  let f5MlResult: string | null = null;
  let f5MlCorrect: number | null = null;
  if (gameRow.modelF5AwayWinPct != null) {
    const modelPredAway = parseFloat(gameRow.modelF5AwayWinPct) > 50;
    const actualAway = f5Away > f5Home;
    const tie = f5Away === f5Home;
    if (tie) {
      f5MlResult = "PUSH";
    } else {
      f5MlResult = modelPredAway === actualAway ? "WIN" : "LOSS";
      f5MlCorrect = modelPredAway === actualAway ? 1 : 0;
    }
  }

  // F5 RL result (away -0.5 standard)
  let f5RlResult: string | null = null;
  let f5RlCorrect: number | null = null;
  if (gameRow.f5AwayRunLine != null && gameRow.modelF5AwayRLCoverPct != null) {
    const rl = parseFloat(gameRow.f5AwayRunLine);
    const modelCoverPct = parseFloat(gameRow.modelF5AwayRLCoverPct);
    const modelPredCover = modelCoverPct > 50;
    const margin = f5Away - f5Home;
    const actualCovers = margin + rl > 0;
    const push = margin + rl === 0;
    if (push) {
      f5RlResult = "PUSH";
    } else {
      f5RlResult = modelPredCover === actualCovers ? "WIN" : "LOSS";
      f5RlCorrect = modelPredCover === actualCovers ? 1 : 0;
    }
  }

  // F5 Total result
  let f5TotalResult: string | null = null;
  let f5TotalCorrect: number | null = null;
  if (gameRow.f5Total != null && gameRow.modelF5OverRate != null) {
    const bookTotal = parseFloat(gameRow.f5Total);
    const modelOverRate = parseFloat(gameRow.modelF5OverRate);
    const modelPredOver = modelOverRate > 50;
    if (f5Total > bookTotal) {
      f5TotalResult = "OVER";
      f5TotalCorrect = modelPredOver ? 1 : 0;
    } else if (f5Total < bookTotal) {
      f5TotalResult = "UNDER";
      f5TotalCorrect = modelPredOver ? 0 : 1;
    } else {
      f5TotalResult = "PUSH";
    }
  }

  // NRFI backtest
  let nrfiBacktestResult: string | null = null;
  let nrfiCorrect: number | null = null;
  if (gameRow.modelPNrfi != null) {
    const modelPNrfi = parseFloat(gameRow.modelPNrfi);
    const modelPredNrfi = modelPNrfi > 50;
    const actualNrfi = outcome.nrfiResult === "NRFI";
    nrfiBacktestResult = modelPredNrfi === actualNrfi ? "WIN" : "LOSS";
    nrfiCorrect = modelPredNrfi === actualNrfi ? 1 : 0;
  }

  await conn.execute(
    `UPDATE games SET
      f5MlResult = ?,
      f5RlResult = ?,
      f5TotalResult = ?,
      f5MlCorrect = ?,
      f5RlCorrect = ?,
      f5TotalCorrect = ?,
      f5BacktestRunAt = ?,
      nrfiBacktestResult = ?,
      nrfiCorrect = ?,
      nrfiBacktestRunAt = ?
    WHERE id = ?`,
    [
      f5MlResult,
      f5RlResult,
      f5TotalResult,
      f5MlCorrect,
      f5RlCorrect,
      f5TotalCorrect,
      Date.now(),
      nrfiBacktestResult,
      nrfiCorrect,
      Date.now(),
      outcome.gameId,
    ]
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export interface RetroactiveOutcomesSummary {
  gamesProcessed: number;
  gamesFailed: number;
  kPropsUpdated: number;
  hrPropsUpdated: number;
  f5BacktestRun: number;
  nrfiBacktestRun: number;
  errors: string[];
}

export async function fetchRetroactiveOutcomes(
  startDate: string,
  endDate: string
): Promise<RetroactiveOutcomesSummary> {
  const mysql2 = await import("mysql2/promise");
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

  const summary: RetroactiveOutcomesSummary = {
    gamesProcessed: 0,
    gamesFailed: 0,
    kPropsUpdated: 0,
    hrPropsUpdated: 0,
    f5BacktestRun: 0,
    nrfiBacktestRun: 0,
    errors: [],
  };

  try {
    // Get all Final games with mlbGamePk in range
    const [games] = await conn.execute<mysql2.RowDataPacket[]>(`
      SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus,
             modelF5AwayWinPct, modelF5AwayRLCoverPct, modelF5OverRate,
             f5AwayRunLine, f5Total, modelPNrfi
      FROM games
      WHERE sport = 'MLB'
        AND gameDate BETWEEN ? AND ?
        AND mlbGamePk IS NOT NULL
        AND (gameStatus LIKE '%Final%' OR gameStatus LIKE '%Game Over%' OR gameStatus LIKE '%final%')
      ORDER BY gameDate, id
    `, [startDate, endDate]);

    console.log(`\n[INPUT] ${games.length} Final games to process (${startDate} → ${endDate})`);

    for (const game of games) {
      const g: GameRecord = {
        id: game.id,
        gameDate: game.gameDate,
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        mlbGamePk: Number(game.mlbGamePk),
        gameStatus: game.gameStatus,
      };

      console.log(`\n[STEP] Processing ${g.gameDate} ${g.awayTeam}@${g.homeTeam} (pk=${g.mlbGamePk})`);

      // Fetch outcomes
      const outcome = await fetchGameOutcome(g);

      if (outcome.fetchErrors.length > 0) {
        for (const e of outcome.fetchErrors) {
          console.log(`  [ERROR] ${e}`);
          summary.errors.push(e);
        }
        summary.gamesFailed++;
        continue;
      }

      console.log(`  [STATE] F5: ${outcome.f5AwayRuns}-${outcome.f5HomeRuns} | Inning1: ${outcome.inning1AwayRuns}-${outcome.inning1HomeRuns} (${outcome.nrfiResult}) | Final: ${outcome.finalAwayScore}-${outcome.finalHomeScore}`);
      console.log(`  [STATE] Pitchers: ${outcome.pitchers.length} | Batters: ${outcome.batters.length}`);

      // Log all pitchers
      for (const p of outcome.pitchers) {
        console.log(`    [PITCHER] ${p.fullName}: ${p.strikeOuts} Ks (${p.inningsPitched} IP)${p.isStarter ? " [SP]" : ""}`);
      }

      // Log HRs
      const hrBatters = outcome.batters.filter((b) => b.homeRuns > 0);
      for (const b of hrBatters) {
        console.log(`    [HR] ${b.fullName}: ${b.homeRuns} HR`);
      }

      // Update game actuals
      await updateGameActuals(conn, outcome);

      // Update K-Props
      const kResult = await updateKPropsActuals(conn, outcome);
      summary.kPropsUpdated += kResult.updated;
      for (const e of kResult.errors) {
        console.log(`  [WARN] ${e}`);
        summary.errors.push(e);
      }

      // Update HR Props
      const hrResult = await updateHrPropsActuals(conn, outcome);
      summary.hrPropsUpdated += hrResult.updated;
      for (const e of hrResult.errors) {
        console.log(`  [WARN] ${e}`);
        summary.errors.push(e);
      }

      // F5 + NRFI backtest
      await computeF5Backtest(conn, outcome, game);
      if (game.modelF5AwayWinPct != null || game.modelF5OverRate != null) {
        summary.f5BacktestRun++;
      }
      if (game.modelPNrfi != null) {
        summary.nrfiBacktestRun++;
      }

      summary.gamesProcessed++;

      console.log(`  [VERIFY] PASS — game ${g.awayTeam}@${g.homeTeam} outcomes stored`);

      // Rate limit: 1 game per 200ms to avoid MLB API throttle
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[OUTPUT] Retroactive outcomes fetch complete`);
    console.log(`  Games processed: ${summary.gamesProcessed}`);
    console.log(`  Games failed: ${summary.gamesFailed}`);
    console.log(`  K-Props updated: ${summary.kPropsUpdated}`);
    console.log(`  HR Props updated: ${summary.hrPropsUpdated}`);
    console.log(`  F5 backtest run: ${summary.f5BacktestRun}`);
    console.log(`  NRFI backtest run: ${summary.nrfiBacktestRun}`);
    console.log(`  Errors: ${summary.errors.length}`);
    console.log(`[VERIFY] ${summary.errors.length === 0 ? "PASS" : "WARN"} — ${summary.errors.length} non-fatal errors`);

  } finally {
    await conn.end();
  }

  return summary;
}

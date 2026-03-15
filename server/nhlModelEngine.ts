/**
 * nhlModelEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TypeScript wrapper that spawns the Python NHL model engine for a single game.
 *
 * Execution flow:
 *   1. Receives NhlModelEngineInput with team stats + goalie stats + market lines
 *   2. Spawns `python3.11 server/nhl_model_engine.py` as a child process
 *   3. Writes the input as JSON to the process's stdin
 *   4. Reads the result JSON from stdout (last line)
 *   5. Returns a typed NhlModelResult
 */

import { spawn } from "child_process";
import { getDefaultTeamStats } from "./nhlNaturalStatScraper.js";
import path from "path";
import { fileURLToPath } from "url";
import type { NhlTeamStats, NhlGoalieStats } from "./nhlNaturalStatScraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlModelEngineInput {
  away_team:         string;   // Full team name
  home_team:         string;
  away_abbrev:       string;   // NHL abbreviation
  home_abbrev:       string;
  away_goalie:       string | null;
  home_goalie:       string | null;
  away_goalie_gp:    number;
  home_goalie_gp:    number;
  away_goalie_gsax:  number;
  home_goalie_gsax:  number;
  mkt_puck_line:     number;   // Always -1.5 (home) / +1.5 (away)
  mkt_away_pl_odds:  number | null;
  mkt_home_pl_odds:  number | null;
  mkt_total:         number | null;
  mkt_over_odds:     number | null;
  mkt_under_odds:    number | null;
  mkt_away_ml:       number | null;
  mkt_home_ml:       number | null;
  away_goalie_shots_faced?: number;   // shots faced this season (for goalie_effect)
  home_goalie_shots_faced?: number;
  away_rest_days?:  number;           // days since last game (fatigue)
  home_rest_days?:  number;
  team_stats:        Record<string, {
    // Percentage-based
    xGF_pct: number; xGA_pct: number;
    CF_pct: number; SCF_pct: number; HDCF_pct: number;
    SH_pct: number; SV_pct: number; GF: number; GA: number;
    // Per-60 rate stats (Sharp Line Engine)
    xGF_60?: number | null; xGA_60?: number | null;
    HDCF_60?: number | null; HDCA_60?: number | null;
    Rush_60?: number | null; RushA_60?: number | null;
    Reb_60?: number | null; SA_60?: number | null; SlotShots?: number | null;
  }>;
}

export interface NhlModelEdge {
  type:           "PUCK_LINE" | "TOTAL" | "ML";
  side:           string;
  model_prob:     number;   // Model probability at market threshold (0–100)
  mkt_prob:       number;   // Vig-free market probability (0–100)
  mkt_prob_raw:   number;   // Raw implied probability before vig removal (0–100)
  edge_vs_be:     number;   // Probability edge in percentage points
  ev:             number;   // Expected value per $100 wagered
  fair_odds:      number;   // Model fair price in American odds
  price_edge:     number;   // fair_odds − market_odds (positive = favorable)
  classification: "ELITE EDGE" | "STRONG EDGE" | "PLAYABLE EDGE" | "SMALL EDGE" | "NO EDGE";
  conf:           "HIGH" | "MOD" | "LOW";
}

export interface NhlModelResult {
  ok:                  boolean;
  game:                string;
  away_name:           string;
  home_name:           string;
  away_abbrev:         string;
  home_abbrev:         string;
  away_goalie:         string | null;
  home_goalie:         string | null;
  // Projected goals
  proj_away_goals:     number;
  proj_home_goals:     number;
  // Puck line (always ±1.5)
  away_puck_line:      string;
  away_puck_line_odds: number;
  home_puck_line:      string;
  home_puck_line_odds: number;
  // Moneylines
  away_ml:             number;
  home_ml:             number;
  // Total
  total_line:          number;
  over_odds:           number;
  under_odds:          number;
  // Probabilities
  away_win_pct:        number;
  home_win_pct:        number;
  away_pl_cover_pct:   number;
  home_pl_cover_pct:   number;
  over_pct:            number;
  under_pct:           number;
  // Edges
  edges:               NhlModelEdge[];
  error:               string | null;
}

// ─── Engine Runner ────────────────────────────────────────────────────────────

const PYTHON_TIMEOUT_MS = 60_000;  // 60 seconds max

export async function runNhlModelForGame(input: NhlModelEngineInput): Promise<NhlModelResult> {
  const enginePath = path.join(__dirname, "nhl_model_engine.py");
  const inputJson  = JSON.stringify(input);

  console.log(`[NhlModelEngine] ► Spawning Python engine for: ${input.away_team} @ ${input.home_team}`);
  console.log(`[NhlModelEngine]   Away goalie: ${input.away_goalie ?? "TBD"} (GSAx=${input.away_goalie_gsax.toFixed(2)} GP=${input.away_goalie_gp})`);
  console.log(`[NhlModelEngine]   Home goalie: ${input.home_goalie ?? "TBD"} (GSAx=${input.home_goalie_gsax.toFixed(2)} GP=${input.home_goalie_gp})`);
  console.log(`[NhlModelEngine]   Market: PL_odds=${input.mkt_away_pl_odds}/${input.mkt_home_pl_odds} Total=${input.mkt_total} ML=${input.mkt_away_ml}/${input.mkt_home_ml}`);

  return new Promise<NhlModelResult>((resolve) => {
    // Clear PYTHONHOME and PYTHONPATH to prevent conflicts with the server's
    // uv-managed Python 3.13 environment (which sets PYTHONHOME to 3.13 stdlib).
    // python3.11 must use its own /usr/lib/python3.11 standard library.
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYTHONHOME;
    delete cleanEnv.PYTHONPATH;

    const proc = spawn("/usr/bin/python3.11", [enginePath], {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      // Forward Python stderr to Node console for debugging
      process.stdout.write(`[NhlModelEngine][py] ${line}`);
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        ok: false,
        game: `${input.away_team} @ ${input.home_team}`,
        away_name: input.away_team,
        home_name: input.home_team,
        away_abbrev: input.away_abbrev,
        home_abbrev: input.home_abbrev,
        away_goalie: input.away_goalie,
        home_goalie: input.home_goalie,
        proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0,
        total_line: 0, over_odds: 0, under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0,
        edges: [],
        error: `Python engine timeout after ${PYTHON_TIMEOUT_MS}ms`,
      });
    }, PYTHON_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        console.error(`[NhlModelEngine] ✗ Python exited with code ${code}`);
        console.error(`[NhlModelEngine]   stderr: ${stderr.slice(-500)}`);
        resolve({
          ok: false,
          game: `${input.away_team} @ ${input.home_team}`,
          away_name: input.away_team,
          home_name: input.home_team,
          away_abbrev: input.away_abbrev,
          home_abbrev: input.home_abbrev,
          away_goalie: input.away_goalie,
          home_goalie: input.home_goalie,
          proj_away_goals: 0, proj_home_goals: 0,
          away_puck_line: "+1.5", away_puck_line_odds: 0,
          home_puck_line: "-1.5", home_puck_line_odds: 0,
          away_ml: 0, home_ml: 0,
          total_line: 0, over_odds: 0, under_odds: 0,
          away_win_pct: 0, home_win_pct: 0,
          away_pl_cover_pct: 0, home_pl_cover_pct: 0,
          over_pct: 0, under_pct: 0,
          edges: [],
          error: `Python exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Extract last non-empty line as the JSON result
      const lines = stdout.trim().split("\n").filter(l => l.trim());
      const lastLine = lines[lines.length - 1] ?? "";

      try {
        const result = JSON.parse(lastLine) as NhlModelResult;
        if (result.ok) {
          console.log(
            `[NhlModelEngine] ✅ ${input.away_team} @ ${input.home_team} | ` +
            `Goals: ${result.proj_away_goals}/${result.proj_home_goals} | ` +
            `PL: ${result.away_puck_line_odds}/${result.home_puck_line_odds} | ` +
            `ML: ${result.away_ml}/${result.home_ml} | ` +
            `Total: ${result.total_line} (${result.over_odds}/${result.under_odds}) | ` +
            `Edges: ${result.edges.length}`
          );
        } else {
          console.error(`[NhlModelEngine] ✗ Model error: ${result.error}`);
        }
        resolve(result);
      } catch (parseErr) {
        console.error(`[NhlModelEngine] ✗ JSON parse error: ${parseErr}`);
        console.error(`[NhlModelEngine]   stdout: ${stdout.slice(-500)}`);
        resolve({
          ok: false,
          game: `${input.away_team} @ ${input.home_team}`,
          away_name: input.away_team,
          home_name: input.home_team,
          away_abbrev: input.away_abbrev,
          home_abbrev: input.home_abbrev,
          away_goalie: input.away_goalie,
          home_goalie: input.home_goalie,
          proj_away_goals: 0, proj_home_goals: 0,
          away_puck_line: "+1.5", away_puck_line_odds: 0,
          home_puck_line: "-1.5", home_puck_line_odds: 0,
          away_ml: 0, home_ml: 0,
          total_line: 0, over_odds: 0, under_odds: 0,
          away_win_pct: 0, home_win_pct: 0,
          away_pl_cover_pct: 0, home_pl_cover_pct: 0,
          over_pct: 0, under_pct: 0,
          edges: [],
          error: `JSON parse error: ${parseErr}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      console.error(`[NhlModelEngine] ✗ Process spawn error: ${err.message}`);
      resolve({
        ok: false,
        game: `${input.away_team} @ ${input.home_team}`,
        away_name: input.away_team,
        home_name: input.home_team,
        away_abbrev: input.away_abbrev,
        home_abbrev: input.home_abbrev,
        away_goalie: input.away_goalie,
        home_goalie: input.home_goalie,
        proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0,
        total_line: 0, over_odds: 0, under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0,
        edges: [],
        error: `Process spawn error: ${err.message}`,
      });
    });

    // Write input to stdin
    proc.stdin.write(inputJson);
    proc.stdin.end();
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format ML as string with sign (e.g. "+135", "-155") */
export function formatNhlML(ml: number): string {
  return ml > 0 ? `+${ml}` : String(ml);
}

/** Build team_stats dict for Python engine from NhlTeamStats map (full per-60 + percentage fields) */
export function buildTeamStatsDict(
  awayAbbrev: string,
  homeAbbrev: string,
  teamStatsMap: Map<string, NhlTeamStats>
): Record<string, {
  xGF_pct: number; xGA_pct: number;
  CF_pct: number; SCF_pct: number; HDCF_pct: number;
  SH_pct: number; SV_pct: number; GF: number; GA: number;
  xGF_60?: number | null; xGA_60?: number | null;
  HDCF_60?: number | null; HDCA_60?: number | null;
  Rush_60?: number | null; RushA_60?: number | null;
  Reb_60?: number | null; SA_60?: number | null; SlotShots?: number | null;
}> {
  const result: Record<string, {
    xGF_pct: number; xGA_pct: number;
    CF_pct: number; SCF_pct: number; HDCF_pct: number;
    SH_pct: number; SV_pct: number; GF: number; GA: number;
    xGF_60?: number | null; xGA_60?: number | null;
    HDCF_60?: number | null; HDCA_60?: number | null;
    Rush_60?: number | null; RushA_60?: number | null;
    Reb_60?: number | null; SA_60?: number | null; SlotShots?: number | null;
  }> = {};

  for (const abbrev of [awayAbbrev, homeAbbrev]) {
    const stats = teamStatsMap.get(abbrev) ?? getDefaultTeamStats(abbrev);
    if (stats) {
      result[abbrev] = {
        // Percentage-based
        xGF_pct:  stats.xGF_pct,
        xGA_pct:  stats.xGA_pct,
        CF_pct:   stats.CF_pct,
        SCF_pct:  stats.SCF_pct,
        HDCF_pct: stats.HDCF_pct,
        SH_pct:   stats.SH_pct,
        SV_pct:   stats.SV_pct,
        GF:       stats.GF,
        GA:       stats.GA,
        // Per-60 rate stats (Sharp Line Engine)
        xGF_60:    stats.xGF_60,
        xGA_60:    stats.xGA_60,
        HDCF_60:   stats.HDCF_60,
        HDCA_60:   stats.HDCA_60,
        Rush_60:   stats.Rush_60,
        RushA_60:  stats.RushA_60,
        Reb_60:    stats.Reb_60,
        SA_60:     stats.SA_60,
        SlotShots: stats.SlotShots,
      };
    }
  }

  return result;
}

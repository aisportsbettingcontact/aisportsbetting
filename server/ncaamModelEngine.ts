/**
 * ncaamModelEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TypeScript wrapper that spawns the Python v9 model engine for a single game.
 *
 * Execution flow:
 *   1. Receives a ModelGameInput with all required game parameters
 *   2. Spawns `python3.11 server/model_v9_engine.py` as a child process
 *   3. Writes the input as JSON to the process's stdin
 *   4. Reads the result JSON from stdout
 *   5. Returns a typed ModelGameResult
 *
 * The Python engine handles all KenPom fetching, conference calibration,
 * 50k Monte Carlo simulation, and edge detection internally.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelGameInput {
  /** KenPom team name (e.g. "Iowa St.", "N.C. State") */
  away_team: string;
  home_team: string;
  /** ncaamTeams.conference value (e.g. "Big 12", "Atlantic 10") */
  conf_a: string;
  conf_h: string;
  /** Market spread: negative = away favored (e.g. -5.5 means away -5.5) */
  mkt_sp: number;
  mkt_to: number;
  /** Market ML (null if not posted) */
  mkt_ml_a: number | null;
  mkt_ml_h: number | null;
  kenpom_email: string;
  kenpom_pass: string;
}

export interface ModelEdge {
  type: "SPREAD" | "TOTAL" | "ML";
  conf: "HIGH" | "MOD" | "LOW";
  side: string;
  signal: string;
  cover_pct: number;
  edge_vs_be: number;
}

export interface ModelGameResult {
  ok: boolean;
  game: string;
  away_name: string;
  home_name: string;
  conf_a: string;
  conf_h: string;
  // Originated (band-clamped) values
  orig_away_score: number;
  orig_home_score: number;
  orig_away_sp: number;
  orig_home_sp: number;
  orig_total: number;
  // Raw (pre-band) values
  raw_away_score: number;
  raw_home_score: number;
  raw_away_sp: number;
  raw_home_sp: number;
  raw_total: number;
  // Market implied
  mkt_away_score: number;
  mkt_home_score: number;
  mkt_total: number;
  // Fair ML
  ml_away_pct: number;
  ml_home_pct: number;
  away_ml_fair: number;
  home_ml_fair: number;
  // Over/under
  over_rate: number;
  under_rate: number;
  // Simulation metadata
  spread_clamped: boolean;
  total_clamped: boolean;
  cover_direction: "OVER" | "UNDER" | "NONE";
  cover_adj: number;
  def_suppression: number;
  sigma_away: number;
  sigma_home: number;
  // Edges
  edges: ModelEdge[];
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE RUNNER
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_PATH = path.join(__dirname, "model_v9_engine.py");
const ENGINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per game (KenPom fetches take ~30s)

export async function runModelForGame(
  input: ModelGameInput
): Promise<ModelGameResult> {
  return new Promise((resolve) => {
    const inputJson = JSON.stringify(input);

    // Use a minimal, clean environment for the Python 3.11 subprocess.
    // The webdev server process injects PYTHONHOME/PYTHONPATH/VIRTUAL_ENV pointing
    // at uv-managed Python 3.13 packages, causing "Python path configuration" errors
    // when /usr/bin/python3.11 tries to run. Solution: pass only the essential env vars
    // needed by the engine (KenPom credentials, HOME, TMPDIR) and nothing Python-related.
    const cleanEnv: NodeJS.ProcessEnv = {
      // System essentials
      HOME:    process.env.HOME    ?? "/home/ubuntu",
      USER:    process.env.USER    ?? "ubuntu",
      TMPDIR:  process.env.TMPDIR  ?? "/tmp",
      TMP:     process.env.TMP     ?? "/tmp",
      TEMP:    process.env.TEMP    ?? "/tmp",
      LANG:    process.env.LANG    ?? "en_US.UTF-8",
      LC_ALL:  process.env.LC_ALL  ?? "en_US.UTF-8",
      // Minimal PATH — only system bins, no uv, no nvm, no pnpm
      PATH:    "/usr/local/bin:/usr/bin:/bin",
      // Python 3.11 site-packages only — no uv packages
      PYTHONPATH: "/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages",
      // KenPom credentials from server env
      KENPOM_EMAIL:    process.env.KENPOM_EMAIL    ?? "",
      KENPOM_PASSWORD: process.env.KENPOM_PASSWORD ?? "",
    };

    const proc = spawn("/usr/bin/python3.11", [ENGINE_PATH], {
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({
        ok: false,
        game: `${input.away_team} @ ${input.home_team}`,
        away_name: input.away_team,
        home_name: input.home_team,
        conf_a: input.conf_a,
        conf_h: input.conf_h,
        orig_away_score: 0, orig_home_score: 0,
        orig_away_sp: 0, orig_home_sp: 0, orig_total: 0,
        raw_away_score: 0, raw_home_score: 0,
        raw_away_sp: 0, raw_home_sp: 0, raw_total: 0,
        mkt_away_score: 0, mkt_home_score: 0, mkt_total: 0,
        ml_away_pct: 0, ml_home_pct: 0,
        away_ml_fair: 0, home_ml_fair: 0,
        over_rate: 0, under_rate: 0,
        spread_clamped: false, total_clamped: false,
        cover_direction: "NONE", cover_adj: 0,
        def_suppression: 0, sigma_away: 0, sigma_home: 0,
        edges: [],
        error: `Timeout after ${ENGINE_TIMEOUT_MS / 1000}s`,
      });
    }, ENGINE_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const lastLine = stdout.trim().split("\n").pop() ?? "";
      try {
        const result = JSON.parse(lastLine) as ModelGameResult;
        resolve(result);
      } catch {
        resolve({
          ok: false,
          game: `${input.away_team} @ ${input.home_team}`,
          away_name: input.away_team,
          home_name: input.home_team,
          conf_a: input.conf_a,
          conf_h: input.conf_h,
          orig_away_score: 0, orig_home_score: 0,
          orig_away_sp: 0, orig_home_sp: 0, orig_total: 0,
          raw_away_score: 0, raw_home_score: 0,
          raw_away_sp: 0, raw_home_sp: 0, raw_total: 0,
          mkt_away_score: 0, mkt_home_score: 0, mkt_total: 0,
          ml_away_pct: 0, ml_home_pct: 0,
          away_ml_fair: 0, home_ml_fair: 0,
          over_rate: 0, under_rate: 0,
          spread_clamped: false, total_clamped: false,
          cover_direction: "NONE", cover_adj: 0,
          def_suppression: 0, sigma_away: 0, sigma_home: 0,
          edges: [],
          error: `Parse error (exit ${code}): ${stderr.slice(0, 500)}`,
        });
      }
    });

    proc.stdin.write(inputJson);
    proc.stdin.end();
  });
}

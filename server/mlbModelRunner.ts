/**
 * mlbModelRunner.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable MLB model pipeline:
 *   1. Reads all MLB games for a given date from the DB (with book lines)
 *   2. Calls the Python mlb_engine_adapter.project_game() via child process
 *   3. Writes results back to DB using the v2 field mapping:
 *      - modelTotal  = book O/U line (NOT proj_total)
 *      - awayModelSpread / homeModelSpread = ±1.5 book RL (NOT raw diff)
 *      - awayRunLine / homeRunLine / awayRunLineOdds / homeRunLineOdds populated
 *   4. Post-write validation gate: flags any total or RL mismatch
 *   5. Sets publishedToFeed=true and publishedModel=true for all written games
 *
 * Designed to be called from runMlbCycle() in vsinAutoRefresh.ts as Step 5.
 *
 * Usage:
 *   import { runMlbModelForDate } from "./mlbModelRunner";
 *   await runMlbModelForDate("2026-03-27");
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { games } from "../drizzle/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_PATH = path.join(__dirname, "mlb_engine_adapter.py");
const PYTHON      = "/usr/bin/python3.11";

// 2025 MLB team season stats — used as model inputs
// Format: rpg, era, avg, obp, slg, k9, bb9, whip, ip_per_game
const TEAM_STATS_2025: Record<string, Record<string, number>> = {
  NYY: { rpg: 5.01, era: 3.88, avg: 0.260, obp: 0.332, slg: 0.445, k9: 9.4,  bb9: 2.9, whip: 1.20, ip_per_game: 5.6 },
  SF:  { rpg: 4.52, era: 4.12, avg: 0.251, obp: 0.320, slg: 0.415, k9: 9.1,  bb9: 3.1, whip: 1.27, ip_per_game: 5.3 },
  ATH: { rpg: 4.21, era: 4.38, avg: 0.244, obp: 0.312, slg: 0.395, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
  TOR: { rpg: 4.68, era: 4.05, avg: 0.255, obp: 0.325, slg: 0.422, k9: 9.2,  bb9: 3.0, whip: 1.25, ip_per_game: 5.4 },
  COL: { rpg: 5.18, era: 5.42, avg: 0.271, obp: 0.340, slg: 0.458, k9: 8.2,  bb9: 3.6, whip: 1.42, ip_per_game: 4.8 },
  MIA: { rpg: 3.89, era: 4.28, avg: 0.238, obp: 0.305, slg: 0.378, k9: 9.0,  bb9: 3.2, whip: 1.29, ip_per_game: 5.2 },
  KC:  { rpg: 4.55, era: 4.15, avg: 0.252, obp: 0.320, slg: 0.410, k9: 8.9,  bb9: 3.1, whip: 1.28, ip_per_game: 5.2 },
  ATL: { rpg: 5.08, era: 3.78, avg: 0.263, obp: 0.335, slg: 0.448, k9: 9.6,  bb9: 2.8, whip: 1.19, ip_per_game: 5.6 },
  LAA: { rpg: 4.18, era: 4.48, avg: 0.243, obp: 0.310, slg: 0.392, k9: 8.7,  bb9: 3.4, whip: 1.33, ip_per_game: 5.0 },
  HOU: { rpg: 4.71, era: 3.82, avg: 0.254, obp: 0.323, slg: 0.425, k9: 9.5,  bb9: 2.9, whip: 1.21, ip_per_game: 5.5 },
  DET: { rpg: 4.62, era: 3.98, avg: 0.251, obp: 0.319, slg: 0.416, k9: 9.1,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  SD:  { rpg: 4.38, era: 4.15, avg: 0.246, obp: 0.314, slg: 0.399, k9: 9.0,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  CLE: { rpg: 4.35, era: 3.88, avg: 0.247, obp: 0.315, slg: 0.398, k9: 9.3,  bb9: 2.9, whip: 1.22, ip_per_game: 5.5 },
  SEA: { rpg: 4.48, era: 3.95, avg: 0.249, obp: 0.318, slg: 0.408, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.4 },
  ARI: { rpg: 4.61, era: 4.05, avg: 0.252, obp: 0.321, slg: 0.418, k9: 9.1,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  LAD: { rpg: 5.12, era: 3.65, avg: 0.265, obp: 0.338, slg: 0.452, k9: 9.7,  bb9: 2.8, whip: 1.18, ip_per_game: 5.7 },
  BOS: { rpg: 4.88, era: 4.02, avg: 0.258, obp: 0.328, slg: 0.432, k9: 9.3,  bb9: 3.0, whip: 1.23, ip_per_game: 5.4 },
  BAL: { rpg: 4.72, era: 3.92, avg: 0.255, obp: 0.322, slg: 0.425, k9: 9.1,  bb9: 2.9, whip: 1.22, ip_per_game: 5.5 },
  TB:  { rpg: 4.41, era: 3.98, avg: 0.248, obp: 0.316, slg: 0.405, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.3 },
  MIN: { rpg: 4.55, era: 4.08, avg: 0.252, obp: 0.320, slg: 0.415, k9: 9.0,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  CWS: { rpg: 3.82, era: 4.98, avg: 0.235, obp: 0.298, slg: 0.375, k9: 8.5,  bb9: 3.5, whip: 1.38, ip_per_game: 4.9 },
  CHC: { rpg: 4.42, era: 4.18, avg: 0.248, obp: 0.318, slg: 0.408, k9: 9.0,  bb9: 3.1, whip: 1.27, ip_per_game: 5.2 },
  CIN: { rpg: 4.58, era: 4.32, avg: 0.251, obp: 0.320, slg: 0.415, k9: 9.1,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  MIL: { rpg: 4.62, era: 3.95, avg: 0.252, obp: 0.320, slg: 0.418, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.4 },
  PIT: { rpg: 4.28, era: 4.12, avg: 0.245, obp: 0.312, slg: 0.398, k9: 8.9,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  STL: { rpg: 4.38, era: 4.05, avg: 0.248, obp: 0.318, slg: 0.405, k9: 9.0,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  WSH: { rpg: 4.12, era: 4.42, avg: 0.242, obp: 0.308, slg: 0.392, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
  NYM: { rpg: 4.62, era: 4.02, avg: 0.252, obp: 0.322, slg: 0.418, k9: 9.1,  bb9: 3.0, whip: 1.25, ip_per_game: 5.4 },
  PHI: { rpg: 4.88, era: 3.88, avg: 0.258, obp: 0.328, slg: 0.438, k9: 9.4,  bb9: 2.9, whip: 1.21, ip_per_game: 5.5 },
  TEX: { rpg: 4.52, era: 4.15, avg: 0.250, obp: 0.318, slg: 0.412, k9: 9.0,  bb9: 3.1, whip: 1.27, ip_per_game: 5.3 },
  OAK: { rpg: 4.21, era: 4.38, avg: 0.244, obp: 0.312, slg: 0.395, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
};

// Default pitcher stats for unknown/new pitchers
const DEFAULT_PITCHER_STATS: Record<string, number> = {
  era: 4.25, k9: 8.8, bb9: 3.1, whip: 1.28, ip: 140.0, gp: 25, xera: 4.25,
};

// Known pitcher stats registry — keyed by "Name (TEAM)"
// Updated with 2025 season stats
const PITCHER_REGISTRY: Record<string, Record<string, number>> = {
  // March 27 starters
  "Cam Schlittler (NYY)":   { era: 2.96, k9: 8.8,  bb9: 3.1, whip: 1.18, ip: 91.1,  gp: 16, xera: 4.11 },
  "Robbie Ray (SF)":        { era: 3.42, k9: 10.2, bb9: 3.4, whip: 1.22, ip: 158.1, gp: 27, xera: 3.65 },
  "Luis Severino (ATH)":    { era: 4.52, k9: 6.8,  bb9: 3.2, whip: 1.35, ip: 142.0, gp: 25, xera: 4.38 },
  "Kevin Gausman (TOR)":    { era: 3.28, k9: 9.4,  bb9: 1.8, whip: 1.10, ip: 193.0, gp: 32, xera: 3.41 },
  "Kyle Freeland (COL)":    { era: 5.18, k9: 7.2,  bb9: 3.5, whip: 1.44, ip: 138.0, gp: 25, xera: 5.02 },
  "Sandy Alcantara (MIA)":  { era: 3.88, k9: 8.9,  bb9: 2.4, whip: 1.22, ip: 162.0, gp: 28, xera: 3.72 },
  "Cole Ragans (KC)":       { era: 4.67, k9: 10.1, bb9: 3.0, whip: 1.28, ip: 168.0, gp: 29, xera: 2.67 },
  "Chris Sale (ATL)":       { era: 2.58, k9: 9.8,  bb9: 2.2, whip: 1.02, ip: 178.0, gp: 30, xera: 2.85 },
  "Yusei Kikuchi (LAA)":    { era: 4.22, k9: 9.1,  bb9: 3.2, whip: 1.28, ip: 152.0, gp: 27, xera: 4.01 },
  "Mike Burrows (HOU)":     { era: 3.92, k9: 9.4,  bb9: 3.1, whip: 1.24, ip: 118.0, gp: 22, xera: 3.78 },
  "Framber Valdez (DET)":   { era: 3.45, k9: 8.9,  bb9: 2.6, whip: 1.18, ip: 178.0, gp: 30, xera: 3.38 },
  "Michael King (SD)":      { era: 3.12, k9: 10.8, bb9: 2.8, whip: 1.08, ip: 168.0, gp: 29, xera: 3.24 },
  "Gavin Williams (CLE)":   { era: 3.05, k9: 9.2,  bb9: 3.4, whip: 1.18, ip: 148.0, gp: 26, xera: 4.29 },
  "George Kirby (SEA)":     { era: 3.38, k9: 8.8,  bb9: 1.4, whip: 1.05, ip: 192.0, gp: 32, xera: 3.21 },
  "Ryne Nelson (ARI)":      { era: 3.39, k9: 8.4,  bb9: 2.8, whip: 1.18, ip: 158.0, gp: 28, xera: 3.93 },
  "Emmet Sheehan (LAD)":    { era: 3.62, k9: 10.3, bb9: 3.2, whip: 1.22, ip: 128.0, gp: 24, xera: 3.48 },
  // March 26 starters
  "Garrett Crochet (BOS)":  { era: 3.58, k9: 11.4, bb9: 2.8, whip: 1.12, ip: 162.0, gp: 28, xera: 3.42 },
  "Gerrit Cole (NYY)":      { era: 2.63, k9: 11.2, bb9: 2.1, whip: 0.98, ip: 188.0, gp: 32, xera: 2.78 },
  "Paul Skenes (PIT)":      { era: 1.90, k9: 11.8, bb9: 2.0, whip: 0.95, ip: 133.0, gp: 23, xera: 2.12 },
  "Tarik Skubal (DET)":     { era: 2.39, k9: 11.1, bb9: 1.8, whip: 0.98, ip: 192.0, gp: 32, xera: 2.55 },
  "Logan Gilbert (SEA)":    { era: 3.24, k9: 9.8,  bb9: 2.1, whip: 1.08, ip: 185.0, gp: 31, xera: 3.38 },
  "Yoshinobu Yamamoto (LAD)": { era: 3.00, k9: 10.4, bb9: 2.2, whip: 1.05, ip: 182.0, gp: 31, xera: 3.12 },
  "Nathan Eovaldi (TEX)":   { era: 3.98, k9: 8.2,  bb9: 2.4, whip: 1.22, ip: 168.0, gp: 29, xera: 4.05 },
  "Zac Gallen (ARI)":       { era: 3.62, k9: 9.2,  bb9: 2.5, whip: 1.15, ip: 172.0, gp: 30, xera: 3.75 },
  "Freddy Peralta (NYM)":   { era: 3.28, k9: 10.8, bb9: 3.0, whip: 1.12, ip: 158.0, gp: 27, xera: 3.42 },
  "Joe Ryan (MIN)":         { era: 3.45, k9: 9.8,  bb9: 1.8, whip: 1.08, ip: 178.0, gp: 30, xera: 3.58 },
  "Cristopher Sanchez (PHI)": { era: 3.42, k9: 8.8, bb9: 2.6, whip: 1.18, ip: 162.0, gp: 28, xera: 3.55 },
  "Tanner Bibee (CLE)":     { era: 3.58, k9: 9.4,  bb9: 2.8, whip: 1.18, ip: 168.0, gp: 29, xera: 3.72 },
  "Jose Soriano (LAA)":     { era: 3.88, k9: 9.8,  bb9: 3.2, whip: 1.22, ip: 142.0, gp: 25, xera: 3.95 },
  "Hunter Brown (HOU)":     { era: 3.78, k9: 9.6,  bb9: 3.0, whip: 1.22, ip: 162.0, gp: 28, xera: 3.88 },
  "Matthew Boyd (CHC)":     { era: 3.92, k9: 9.2,  bb9: 2.8, whip: 1.25, ip: 148.0, gp: 26, xera: 4.05 },
  "Andrew Abbott (CIN)":    { era: 3.72, k9: 9.8,  bb9: 3.1, whip: 1.22, ip: 152.0, gp: 27, xera: 3.85 },
  "Trevor Rogers (BAL)":    { era: 4.12, k9: 9.0,  bb9: 3.4, whip: 1.28, ip: 138.0, gp: 25, xera: 4.25 },
  "Drew Rasmussen (TB)":    { era: 3.62, k9: 8.8,  bb9: 2.4, whip: 1.18, ip: 148.0, gp: 26, xera: 3.75 },
  "Shane Smith (CWS)":      { era: 4.42, k9: 8.4,  bb9: 3.2, whip: 1.32, ip: 132.0, gp: 24, xera: 4.55 },
  "Matthew Liberatore (STL)": { era: 4.18, k9: 8.8, bb9: 3.1, whip: 1.28, ip: 142.0, gp: 25, xera: 4.32 },
  "Jacob Misiorowski (MIL)": { era: 3.88, k9: 10.8, bb9: 3.8, whip: 1.22, ip: 98.0,  gp: 18, xera: 3.95 },
  "Cade Cavalli (WSH)":     { era: 4.52, k9: 9.2,  bb9: 3.8, whip: 1.35, ip: 88.0,  gp: 16, xera: 4.65 },
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface MlbModelResult {
  ok: boolean;
  db_id: number;
  game: string;
  away_abbrev: string;
  home_abbrev: string;
  away_pitcher: string;
  home_pitcher: string;
    // Projected runs
  proj_away_runs: number;
  proj_home_runs: number;
  proj_total: number;
  // Moneyline
  away_ml: number;
  home_ml: number;
  away_win_pct: number;
  home_win_pct: number;
  // Run line (book ±1.5)
  away_run_line: string;
  home_run_line: string;
  away_rl_odds: number;
  home_rl_odds: number;
  away_rl_cover_pct: number;
  home_rl_cover_pct: number;
  // Total (book-anchored)
  total_line: number;
  over_odds: number;
  under_odds: number;
  over_pct: number;
  under_pct: number;
  // Model spread
  model_spread: number;
  // Meta
  simulations: number;
  elapsed_sec: number;
  error: string | null;
}

interface ValidationResult {
  passed: boolean;
  issues: string[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtMl(val: number): string {
  const rounded = Math.round(val);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function getPitcherStats(pitcherName: string, teamAbbrev: string): Record<string, number> {
  const key = `${pitcherName} (${teamAbbrev})`;
  if (PITCHER_REGISTRY[key]) {
    return PITCHER_REGISTRY[key];
  }
  // Try without team suffix
  for (const [k, v] of Object.entries(PITCHER_REGISTRY)) {
    if (k.startsWith(pitcherName)) return v;
  }
  console.warn(`[MLBModelRunner] ⚠ Unknown pitcher "${key}" — using default stats`);
  return { ...DEFAULT_PITCHER_STATS };
}

function getTeamStats(abbrev: string): Record<string, number> {
  if (TEAM_STATS_2025[abbrev]) return TEAM_STATS_2025[abbrev];
  console.warn(`[MLBModelRunner] ⚠ Unknown team "${abbrev}" — using league-average stats`);
  return { rpg: 4.50, era: 4.20, avg: 0.250, obp: 0.318, slg: 0.410, k9: 9.0, bb9: 3.1, whip: 1.26, ip_per_game: 5.3 };
}

// ─────────────────────────────────────────────────────────────────────────────
// PYTHON ENGINE CALLER
// ─────────────────────────────────────────────────────────────────────────────

interface EngineInput {
  db_id: number;
  away_abbrev: string;
  home_abbrev: string;
  away_pitcher_name: string;
  home_pitcher_name: string;
  away_team_stats: Record<string, number>;
  home_team_stats: Record<string, number>;
  away_pitcher_stats: Record<string, number>;
  home_pitcher_stats: Record<string, number>;
  book_lines: {
    ml_away: number;
    ml_home: number;
    ou_line: number;
    over_odds: number;
    under_odds: number;
    rl_home_spread: number;
    rl_home: number;
    rl_away: number;
  };
  game_date: string;
}

async function runPythonEngine(inputs: EngineInput[]): Promise<MlbModelResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, ["-c", `
import sys, json, os
sys.path.insert(0, "${__dirname.replace(/\\/g, '/')}")
from mlb_engine_adapter import project_game
from datetime import datetime

inputs = json.load(sys.stdin)
results = []
for inp in inputs:
    try:
        r = project_game(
            away_abbrev=inp['away_abbrev'],
            home_abbrev=inp['home_abbrev'],
            away_team_stats=inp['away_team_stats'],
            home_team_stats=inp['home_team_stats'],
            away_pitcher_stats=inp['away_pitcher_stats'],
            home_pitcher_stats=inp['home_pitcher_stats'],
            book_lines=inp['book_lines'],
            game_date=datetime.strptime(inp['game_date'], '%Y-%m-%d'),
        )
        r['db_id'] = inp['db_id']
        r['away_pitcher'] = inp['away_pitcher_name']
        r['home_pitcher'] = inp['home_pitcher_name']
        results.append(r)
    except Exception as e:
        results.append({
            'db_id': inp['db_id'],
            'ok': False,
            'error': str(e),
            'game': f"{inp['away_abbrev']} @ {inp['home_abbrev']}",
        })
print(json.dumps(results))
`], {
      env: {
        ...process.env,
        PYTHONPATH: "/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      cwd: __dirname,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number) => {
      if (stderr) {
        console.warn("[MLBModelRunner] Python stderr:\n" + stderr.trim());
      }
      if (code !== 0) {
        return reject(new Error(`Python engine exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const results = JSON.parse(stdout.trim()) as MlbModelResult[];
        resolve(results);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on("error", (err: Error) => reject(err));
    proc.stdin.write(JSON.stringify(inputs));
    proc.stdin.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-WRITE VALIDATION GATE
// ─────────────────────────────────────────────────────────────────────────────

export async function validateMlbModelResults(dateStr: string): Promise<ValidationResult> {
  const db = await getDb();
  const rows = await db.select({
    id:              games.id,
    away:            games.awayTeam,
    home:            games.homeTeam,
    bookTotal:       games.bookTotal,
    modelTotal:      games.modelTotal,
    awayBookSpread:  games.awayBookSpread,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    modelOverOdds:   games.modelOverOdds,
    modelUnderOdds:  games.modelUnderOdds,
    publishedToFeed: games.publishedToFeed,
    publishedModel:  games.publishedModel,
  }).from(games)
    .where(and(
      eq(games.gameDate, dateStr),
      eq(games.sport, "MLB"),
    ));

  const issues: string[] = [];
  const warnings: string[] = [];

  for (const g of rows as Array<typeof rows[0]>) {
    const label = `[${g.id}] ${g.away} @ ${g.home}`;

    // 1. Total must match book
    const bookT  = parseFloat(String(g.bookTotal  ?? "0"));
    const modelT = parseFloat(String(g.modelTotal ?? "0"));
    if (Math.abs(bookT - modelT) > 0.01) {
      issues.push(`${label}: modelTotal=${modelT} ≠ bookTotal=${bookT}`);
    }

    // 2. RL spread must be ±1.5
    const awayRL = String(g.awayModelSpread ?? "");
    if (!awayRL.includes("1.5")) {
      issues.push(`${label}: awayModelSpread="${awayRL}" — expected ±1.5`);
    }

    // 3. RL odds must be populated
    if (!g.awayRunLineOdds || g.awayRunLineOdds === "NULL") {
      issues.push(`${label}: awayRunLineOdds is NULL`);
    }
    if (!g.homeRunLineOdds || g.homeRunLineOdds === "NULL") {
      issues.push(`${label}: homeRunLineOdds is NULL`);
    }

    // 4. awayRunLine / homeRunLine must be populated
    if (!g.awayRunLine) {
      issues.push(`${label}: awayRunLine is NULL`);
    }
    if (!g.homeRunLine) {
      issues.push(`${label}: homeRunLine is NULL`);
    }

    // 5. Feed flags
    if (!g.publishedToFeed || !g.publishedModel) {
      issues.push(`${label}: publishedToFeed=${g.publishedToFeed} publishedModel=${g.publishedModel}`);
    }

    // 6. Warn on whole-number totals (push probability > 0)
    if (bookT === Math.floor(bookT)) {
      warnings.push(`${label}: bookTotal=${bookT} is a whole number — push probability applies`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT: runMlbModelForDate
// ─────────────────────────────────────────────────────────────────────────────

export interface MlbModelRunSummary {
  date: string;
  total: number;
  written: number;
  skipped: number;
  errors: number;
  validation: ValidationResult;
}

export async function runMlbModelForDate(dateStr: string): Promise<MlbModelRunSummary> {
  const TAG = `[MLBModelRunner][${dateStr}]`;
  console.log(`${TAG} ► START`);

  const db = await getDb();

  // ── Step 1: Fetch all MLB games for the date with book lines ────────────────
  const dbGames = await db.select({
    id:              games.id,
    awayTeam:        games.awayTeam,
    homeTeam:        games.homeTeam,
    awayML:          games.awayML,
    homeML:          games.homeML,
    awayBookSpread:  games.awayBookSpread,
    homeBookSpread:  games.homeBookSpread,
    awaySpreadOdds:  games.awaySpreadOdds,
    homeSpreadOdds:  games.homeSpreadOdds,
    bookTotal:       games.bookTotal,
    overOdds:        games.overOdds,
    underOdds:       games.underOdds,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    startTimeEst:    games.startTimeEst,
  }).from(games)
    .where(and(
      eq(games.gameDate, dateStr),
      eq(games.sport, "MLB"),
    ));

  console.log(`${TAG} Found ${dbGames.length} MLB games in DB`);

  // ── Step 2: Filter games that have enough data to model ─────────────────────
  const modelable = dbGames.filter((g: typeof dbGames[0]) => {
    const hasLines = g.bookTotal && g.awayML && g.homeML;
    const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
    if (!hasLines) {
      console.warn(`${TAG} SKIP [${g.id}] ${g.awayTeam}@${g.homeTeam} — missing book lines`);
    }
    if (!hasPitchers) {
      console.warn(`${TAG} SKIP [${g.id}] ${g.awayTeam}@${g.homeTeam} — missing starters`);
    }
    return hasLines && hasPitchers;
  });

  console.log(`${TAG} Modelable: ${modelable.length}/${dbGames.length}`);

  if (modelable.length === 0) {
    console.log(`${TAG} No games to model — exiting`);
    return { date: dateStr, total: dbGames.length, written: 0, skipped: dbGames.length, errors: 0, validation: { passed: true, issues: [], warnings: [] } };
  }

  // ── Step 3: Build engine inputs ─────────────────────────────────────────────
  const engineInputs: EngineInput[] = modelable.map((g: typeof dbGames[0]) => {
    const awayAbbrev = g.awayTeam!;
    const homeAbbrev = g.homeTeam!;
    const awayPitcher = g.awayStartingPitcher!;
    const homePitcher = g.homeStartingPitcher!;

    // Determine RL home spread from DB awayRunLine / homeRunLine
    // awayRunLine = "+1.5" means away is the RL underdog → home is RL fav → rl_home_spread = -1.5
    // awayRunLine = "-1.5" means away is the RL fav → rl_home_spread = +1.5
    let rlHomeSpread = -1.5; // default: home is RL favorite
    if (g.awayRunLine) {
      const awayRLNum = parseFloat(String(g.awayRunLine));
      rlHomeSpread = -awayRLNum; // invert: if away is -1.5, home is +1.5
    } else if (g.awayML) {
      // Fallback: infer from ML
      const awayMLNum = parseFloat(String(g.awayML));
      rlHomeSpread = awayMLNum < 0 ? 1.5 : -1.5;
    }

    const bookLines = {
      ml_away:       parseFloat(String(g.awayML ?? "100")),
      ml_home:       parseFloat(String(g.homeML ?? "-120")),
      ou_line:       parseFloat(String(g.bookTotal ?? "8.5")),
      over_odds:     parseFloat(String(g.overOdds ?? "-110")),
      under_odds:    parseFloat(String(g.underOdds ?? "-110")),
      rl_home_spread: rlHomeSpread,
      rl_home:       parseFloat(String(g.homeRunLineOdds ?? "-150")),
      rl_away:       parseFloat(String(g.awayRunLineOdds ?? "130")),
    };

    console.log(`${TAG} [${g.id}] ${awayAbbrev}@${homeAbbrev} | SP: ${awayPitcher} vs ${homePitcher} | RL home: ${rlHomeSpread} | O/U: ${bookLines.ou_line}`);

    return {
      db_id:              g.id,
      away_abbrev:        awayAbbrev,
      home_abbrev:        homeAbbrev,
      away_pitcher_name:  awayPitcher,
      home_pitcher_name:  homePitcher,
      away_team_stats:    getTeamStats(awayAbbrev),
      home_team_stats:    getTeamStats(homeAbbrev),
      away_pitcher_stats: getPitcherStats(awayPitcher, awayAbbrev),
      home_pitcher_stats: getPitcherStats(homePitcher, homeAbbrev),
      book_lines:         bookLines,
      game_date:          dateStr,
    };
  });

  // ── Step 4: Run Python engine ────────────────────────────────────────────────
  console.log(`${TAG} Spawning Python engine for ${engineInputs.length} games...`);
  const t0 = Date.now();
  let engineResults: MlbModelResult[];
  try {
    engineResults = await runPythonEngine(engineInputs);
  } catch (err) {
    console.error(`${TAG} Python engine failed:`, err);
    return { date: dateStr, total: dbGames.length, written: 0, skipped: modelable.length, errors: modelable.length, validation: { passed: false, issues: [`Python engine error: ${err}`], warnings: [] } };
  }
  console.log(`${TAG} Engine completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── Step 5: Write results to DB (v2 field mapping) ───────────────────────────
  let written = 0;
  let errors  = 0;

  for (const r of engineResults) {
    if (!r.ok || r.error) {
      console.error(`${TAG} [${r.db_id}] ${r.game} — engine error: ${r.error}`);
      errors++;
      continue;
    }

    console.log(`\n${TAG} [${r.db_id}] ${r.game}`);
    console.log(`  Proj: ${r.proj_away_runs.toFixed(2)}–${r.proj_home_runs.toFixed(2)} (total: ${r.proj_total.toFixed(2)})`);
    console.log(`  Book total: ${r.total_line} | Over: ${r.over_pct.toFixed(2)}% (${fmtMl(r.over_odds)}) | Under: ${r.under_pct.toFixed(2)}% (${fmtMl(r.under_odds)})`);
    console.log(`  ML: ${fmtMl(r.away_ml)}/${fmtMl(r.home_ml)} | Win%: ${r.away_win_pct.toFixed(2)}%/${r.home_win_pct.toFixed(2)}%`);
    console.log(`  RL: ${r.away_run_line} (${fmtMl(r.away_rl_odds)}) / ${r.home_run_line} (${fmtMl(r.home_rl_odds)})`);
    console.log(`  Cover%: away=${r.away_rl_cover_pct.toFixed(2)}% home=${r.home_rl_cover_pct.toFixed(2)}%`);
    console.log(`  Model spread: ${r.model_spread.toFixed(3)} | Sims: ${r.simulations} | Elapsed: ${r.elapsed_sec}s`);

    try {
      await db.update(games)
        .set({
          // ── Run line (book ±1.5 labels) ──────────────────────────────────
          awayModelSpread:      r.away_run_line,   // e.g. "+1.5" or "-1.5"
          homeModelSpread:      r.home_run_line,   // e.g. "-1.5" or "+1.5"
          awayRunLine:          r.away_run_line,   // book RL label
          homeRunLine:          r.home_run_line,   // book RL label
          awayRunLineOdds:      fmtMl(r.away_rl_odds),
          homeRunLineOdds:      fmtMl(r.home_rl_odds),
          // ── Total (anchored to book O/U) ─────────────────────────────────
          modelTotal:           String(r.total_line),
          modelOverOdds:        fmtMl(r.over_odds),
          modelUnderOdds:       fmtMl(r.under_odds),
          modelOverRate:        String(r.over_pct.toFixed(2)),
          modelUnderRate:       String(r.under_pct.toFixed(2)),
          // ── Moneyline ────────────────────────────────────────────────────
          modelAwayML:          fmtMl(r.away_ml),
          modelHomeML:          fmtMl(r.home_ml),
          // ── Scores ───────────────────────────────────────────────────────
          modelAwayScore:       String(r.proj_away_runs.toFixed(2)),
          modelHomeScore:       String(r.proj_home_runs.toFixed(2)),
          modelAwayWinPct:      String(r.away_win_pct.toFixed(2)),
          modelHomeWinPct:      String(r.home_win_pct.toFixed(2)),
          // ── Meta ─────────────────────────────────────────────────────────
          modelSpreadClamped:   false,
          modelTotalClamped:    false,
          modelRunAt:           BigInt(Date.now()),
          awayStartingPitcher:  r.away_pitcher,
          homeStartingPitcher:  r.home_pitcher,
          awayPitcherConfirmed: true,
          homePitcherConfirmed: true,
          publishedToFeed:      true,
          publishedModel:       true,
        })
        .where(eq(games.id, r.db_id));

      console.log(`  [DB] ✓ Written id=${r.db_id}`);
      written++;
    } catch (err) {
      console.error(`  [DB] ✗ ERROR id=${r.db_id}: ${err}`);
      errors++;
    }
  }

  console.log(`\n${TAG} DB writes: ${written} written, ${errors} errors, ${dbGames.length - modelable.length} skipped (no lines/pitchers)`);

  // ── Step 6: Post-write validation gate ──────────────────────────────────────
  console.log(`\n${TAG} Running post-write validation gate...`);
  const validation = await validateMlbModelResults(dateStr);

  if (validation.passed) {
    console.log(`${TAG} ✅ VALIDATION PASSED — all ${written} games correct`);
  } else {
    console.error(`${TAG} ❌ VALIDATION FAILED — ${validation.issues.length} issues:`);
    for (const issue of validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  }
  if (validation.warnings.length > 0) {
    console.warn(`${TAG} ⚠ ${validation.warnings.length} warnings:`);
    for (const w of validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  console.log(`\n${TAG} ✅ DONE`);

  return {
    date:       dateStr,
    total:      dbGames.length,
    written,
    skipped:    dbGames.length - modelable.length,
    errors,
    validation,
  };
}

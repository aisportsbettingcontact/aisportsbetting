/**
 * Debug script: trace p_f5_push through the Python→TypeScript pipeline
 * Runs the Python engine directly on KC@DET and prints the raw JSON output
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pythonPath = "python3.11";
const modelPath = path.resolve(__dirname, "../server/MLBAIModel.py");

// Minimal KC@DET input matching what the runner sends
const input = {
  db_id: 2250232,
  game: "KC@DET",
  date: "2026-04-14",
  away_team: "KC",
  home_team: "DET",
  away_rpg: 4.55,
  home_rpg: 4.62,
  away_era: 4.15,
  home_era: 3.98,
  away_pitcher: "Cole Ragans",
  home_pitcher: "Framber Valdez",
  book_lines: {
    ml_away: 107,
    ml_home: -128,
    ou_line: 8,
    over_odds: -105,
    under_odds: -114,
    rl_home_spread: 1.5,
    rl_home: -204,
    rl_away: 204,
  },
  nrfi_combined_signal: 0.5346,
  nrfi_filter_pass: false,
  away_pitcher_nrfi: 0.5208,
  home_pitcher_nrfi: 0.5484,
  away_pitcher_nrfi_starts: 48,
  home_pitcher_nrfi_starts: 62,
  away_team_nrfi: null,
  home_team_nrfi: null,
  away_f5_rs: null,
  home_f5_rs: null,
  park_factor: 0.9967,
  mlb_game_pk: 824292,
  umpire_k_mod: 1.0197,
  umpire_bb_mod: 0.8390,
  away_bullpen_era: 4.56,
  home_bullpen_era: 3.18,
  away_bullpen_fip: 4.52,
  home_bullpen_fip: 4.24,
  away_bullpen_k9: 9.47,
  home_bullpen_k9: 8.82,
  away_bullpen_bb9: 5.26,
  home_bullpen_bb9: 5.47,
  away_bullpen_kbb: 0.1558,
  home_bullpen_kbb: 0.1242,
  away_bullpen_count: 9,
  home_bullpen_count: 8,
};

console.log("[INPUT]  Running Python engine for KC@DET (2250232) — debug F5 push trace");
console.log("[INPUT]  away_pitcher_nrfi_starts=48 home_pitcher_nrfi_starts=62");

const proc = spawn(pythonPath, [modelPath], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env },
});

let stdout = "";
let stderr = "";

proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

proc.on("close", (code: number) => {
  if (code !== 0) {
    console.error(`[ERROR]  Python exited with code ${code}`);
    console.error(stderr.slice(0, 1000));
    process.exit(1);
  }

  try {
    const results = JSON.parse(stdout.trim());
    const r = Array.isArray(results) ? results[0] : results;

    console.log(`\n[STATE]  Raw Python result keys: ${Object.keys(r).join(", ")}`);
    console.log(`[STATE]  p_f5_push = ${r.p_f5_push} (type: ${typeof r.p_f5_push})`);
    console.log(`[STATE]  p_f5_push_raw = ${r.p_f5_push_raw} (type: ${typeof r.p_f5_push_raw})`);
    console.log(`[STATE]  p_f5_home_win = ${r.p_f5_home_win}`);
    console.log(`[STATE]  p_f5_away_win = ${r.p_f5_away_win}`);
    console.log(`[STATE]  f5_ml_home = ${r.f5_ml_home}`);
    console.log(`[STATE]  f5_ml_away = ${r.f5_ml_away}`);

    // Simulate the DB write mapping
    const modelF5PushPct = r.p_f5_push != null ? String(r.p_f5_push.toFixed(4)) : null;
    const modelF5PushRaw = r.p_f5_push_raw != null ? String(r.p_f5_push_raw.toFixed(4)) : null;

    console.log(`\n[STATE]  modelF5PushPct (after mapping) = ${modelF5PushPct}`);
    console.log(`[STATE]  modelF5PushRaw (after mapping) = ${modelF5PushRaw}`);

    if (modelF5PushPct !== null) {
      console.log(`\n[VERIFY] PASS — p_f5_push flows correctly through the pipeline`);
    } else {
      console.log(`\n[VERIFY] FAIL — p_f5_push is null after mapping`);
      console.log(`[DEBUG]  'p_f5_push' in result: ${'p_f5_push' in r}`);
      console.log(`[DEBUG]  result.p_f5_push === null: ${r.p_f5_push === null}`);
      console.log(`[DEBUG]  result.p_f5_push === undefined: ${r.p_f5_push === undefined}`);
    }
  } catch (e) {
    console.error(`[ERROR]  Failed to parse Python output: ${e}`);
    console.error(`[DEBUG]  stdout (first 500): ${stdout.slice(0, 500)}`);
    process.exit(1);
  }
});

proc.stdin.write(JSON.stringify([input]));
proc.stdin.end();

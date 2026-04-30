/**
 * Minimal single-game test: run the Python engine for KC@DET and print the raw JSON result
 * This isolates whether p_f5_push is present in the Python JSON output
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = "python3.11";
const ENGINE_DIR = path.resolve(__dirname, "../server");

// Minimal input for KC@DET (2026-04-14)
const inputs = [{
  db_id: 2250232,
  away_abbrev: "KC",
  home_abbrev: "DET",
  away_pitcher_name: "Cole Ragans",
  home_pitcher_name: "Framber Valdez",
  away_team_stats: { rpg: 4.55, era: 4.15 },
  home_team_stats: { rpg: 4.62, era: 3.98 },
  away_pitcher_stats: {
    hand: "L", xfip: 2.45, fip: 2.60, k_pct: 0.3825, bb_pct: 0.0650,
    hr_pct: 0.0328, whiff: 0.3440, ip_per_g: 4.74, rolling_starts: 5,
    rolling_era: 5.57, fip_minus: 59.3, era_minus: 110.7,
    vs_batter_hand: "L", batter_k_pct: 0.1659, batter_bb_pct: 0.0581,
    batter_hr_pct: 0.0138, batter_woba: 0.296,
  },
  home_pitcher_stats: {
    hand: "L", xfip: 3.34, fip: 3.90, k_pct: 0.2407, bb_pct: 0.0752,
    hr_pct: 0.0310, whiff: 0.1412, ip_per_g: 6.19, rolling_starts: 5,
    rolling_era: 6.51, fip_minus: 80.8, era_minus: 89.8,
    vs_batter_hand: "L", batter_k_pct: 0.1792, batter_bb_pct: 0.0750,
    batter_hr_pct: 0.0258, batter_woba: 0.343,
  },
  book_lines: {
    ml_away: 107, ml_home: -128, ou_line: 8.0,
    over_odds: -105, under_odds: -114,
    rl_home_spread: 1.5, rl_home: -204, rl_away: 204,
  },
  game_date: "2026-04-14",
  park_factor_3yr: 0.9967,
  away_bullpen: { era: 4.56, fip: 4.52, k9: 9.47, bb9: 5.26, kbb: 0.1558, count: 9 },
  home_bullpen: { era: 3.18, fip: 4.24, k9: 8.82, bb9: 5.47, kbb: 0.1242, count: 8 },
  umpire_k_mod: 1.0197,
  umpire_bb_mod: 0.8390,
  umpire_name: "Cory Blaser",
  mlb_game_pk: 824292,
  away_pitcher_nrfi: 0.5208,
  home_pitcher_nrfi: 0.5484,
  away_pitcher_nrfi_starts: 48,
  home_pitcher_nrfi_starts: 62,
  away_team_nrfi: null,
  home_team_nrfi: null,
  away_f5_rs: null,
  home_f5_rs: null,
}];

console.log("[INPUT]  Running Python engine for KC@DET — single game debug");

const proc = spawn(PYTHON, ["-c", `
import sys, json, os
sys.path.insert(0, "${ENGINE_DIR.replace(/\\/g, '/')}")
from MLBAIModel import project_game
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
            park_factor_3yr=inp.get('park_factor_3yr', 1.0),
            away_bullpen=inp.get('away_bullpen'),
            home_bullpen=inp.get('home_bullpen'),
            umpire_k_mod=inp.get('umpire_k_mod', 1.0),
            umpire_bb_mod=inp.get('umpire_bb_mod', 1.0),
            umpire_name=inp.get('umpire_name', 'UNKNOWN'),
            mlb_game_pk=inp.get('mlb_game_pk'),
            away_pitcher_nrfi=inp.get('away_pitcher_nrfi'),
            home_pitcher_nrfi=inp.get('home_pitcher_nrfi'),
            away_pitcher_nrfi_starts=inp.get('away_pitcher_nrfi_starts'),
            home_pitcher_nrfi_starts=inp.get('home_pitcher_nrfi_starts'),
            away_team_nrfi=inp.get('away_team_nrfi'),
            home_team_nrfi=inp.get('home_team_nrfi'),
            away_f5_rs=inp.get('away_f5_rs'),
            home_f5_rs=inp.get('home_f5_rs'),
            verbose=False,
        )
        r['db_id'] = inp['db_id']
        r['away_pitcher'] = inp['away_pitcher_name']
        r['home_pitcher'] = inp['home_pitcher_name']
        results.append(r)
    except Exception as e:
        import traceback
        results.append({'db_id': inp['db_id'], 'ok': False, 'error': str(e), 'traceback': traceback.format_exc()})
print(json.dumps(results))
`], {
  env: (() => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'PYTHONHOME') env[k] = v;
    }
    env['PYTHONPATH'] = '/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages';
    env['PYTHONDONTWRITEBYTECODE'] = '1';
    return env;
  })(),
  cwd: ENGINE_DIR,
});

let stdout = "";
let stderrBuf = "";
proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
proc.stderr.on("data", (d: Buffer) => { stderrBuf += d.toString(); });

proc.on("close", (code: number) => {
  if (code !== 0) {
    console.error(`[ERROR]  Python exited with code ${code}`);
    console.error(stderrBuf.slice(0, 2000));
    process.exit(1);
  }
  try {
    const results = JSON.parse(stdout.trim()) as any[];
    const r = results[0];
    if (!r.ok && r.error) {
      console.error(`[ERROR]  Python error: ${r.error}`);
      console.error(r.traceback);
      process.exit(1);
    }
    console.log(`\n[STATE]  Python result keys (F5-related):`);
    const f5Keys = Object.keys(r).filter(k => k.includes('f5') || k.includes('push'));
    for (const k of f5Keys) {
      console.log(`  ${k} = ${r[k]} (type: ${typeof r[k]})`);
    }
    console.log(`\n[VERIFY] p_f5_push = ${r.p_f5_push} | p_f5_push_raw = ${r.p_f5_push_raw}`);
    const pushPct = r.p_f5_push != null ? String((r.p_f5_push as number).toFixed(4)) : null;
    const pushRaw = r.p_f5_push_raw != null ? String((r.p_f5_push_raw as number).toFixed(4)) : null;
    console.log(`[VERIFY] modelF5PushPct (mapped) = ${pushPct}`);
    console.log(`[VERIFY] modelF5PushRaw (mapped) = ${pushRaw}`);
    if (pushPct !== null) {
      console.log(`\n[PASS]   F5 push values flow correctly through Python→TypeScript pipeline`);
    } else {
      console.log(`\n[FAIL]   p_f5_push is null after mapping — BUG CONFIRMED`);
    }
  } catch (e) {
    console.error(`[ERROR]  Failed to parse Python output: ${e}`);
    console.error(`stdout: ${stdout.slice(0, 500)}`);
    process.exit(1);
  }
});

proc.stdin.write(JSON.stringify(inputs));
proc.stdin.end();

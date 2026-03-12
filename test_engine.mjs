import { spawnSync } from "child_process";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config();

const email = process.env.VSIN_EMAIL || "";
const pass  = process.env.VSIN_PASSWORD || "";

console.log(`email present: ${!!email} | pass present: ${!!pass}`);

const input = JSON.stringify({
  away_team:    "Massachusetts",
  home_team:    "Miami OH",
  conf_a:       "MAC",
  conf_h:       "MAC",
  mkt_sp:       7.5,
  mkt_to:       163.5,
  mkt_ml_a:     250,
  mkt_ml_h:     -310,
  kenpom_email: email,
  kenpom_pass:  pass,
});

const enginePath = path.join(__dirname, "server", "model_v9_engine.py");
console.log(`Engine path: ${enginePath}`);

const r = spawnSync("python3.11", [enginePath], {
  input,
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env },
});

console.log(`Exit code: ${r.status}`);
console.log(`Stderr (last 600 chars):\n${r.stderr?.slice(-600)}`);
console.log(`Stdout (last 400 chars):\n${r.stdout?.slice(-400)}`);

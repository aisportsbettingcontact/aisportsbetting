/**
 * runApril3Mlb.mjs
 * Force-refresh AN API book lines for April 3, 2026 MLB games,
 * then run the MLB model for all games.
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

const DATE = "2026-04-03";
const AN_DATE = "20260403";

const u = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: parseInt(u.port || "3306"),
  user: u.username,
  password: u.password,
  database: u.pathname.replace(/^\//, "").split("?")[0],
  ssl: { rejectUnauthorized: false },
});

const fmt = (n) => (n == null ? null : n > 0 ? `+${n}` : String(n));

// ── Step 1: Fetch AN API odds ─────────────────────────────────────────────────
console.log("\n" + "═".repeat(72));
console.log(`  STEP 1: Fetching AN API DK odds for ${DATE}`);
console.log("═".repeat(72));

const AN_URL = `https://api.actionnetwork.com/web/v1/scoreboard/mlb?period=game&bookIds=15&date=${AN_DATE}`;
let anGames = [];
try {
  const resp = await fetch(AN_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
      "Referer": "https://www.actionnetwork.com/",
    },
  });
  if (!resp.ok) throw new Error(`AN API HTTP ${resp.status}`);
  const data = await resp.json();
  anGames = data.games || [];
  console.log(`[INPUT] AN API returned ${anGames.length} MLB games for ${DATE}`);
} catch (err) {
  console.error(`[FATAL] AN API fetch failed: ${err.message}`);
  await conn.end();
  process.exit(1);
}

// ── Step 2: Fetch DB games ────────────────────────────────────────────────────
const [dbGames] = await conn.execute(
  `SELECT id, awayTeam, homeTeam, mlbGamePk FROM games WHERE sport='MLB' AND gameDate=? ORDER BY sortOrder`,
  [DATE]
);
console.log(`[INPUT] DB has ${dbGames.length} MLB games for ${DATE}`);

// Build AN abbreviation → DB game map (case-insensitive)
// DB stores team abbreviations like "LAD", "WSH", "STL", "DET" etc.
const dbByAway = new Map(dbGames.map(g => [g.awayTeam?.toUpperCase(), g]));
const dbByHome = new Map(dbGames.map(g => [g.homeTeam?.toUpperCase(), g]));

// ── Step 3: Match and write odds ──────────────────────────────────────────────
console.log("\n" + "═".repeat(72));
console.log("  STEP 2: Writing book lines to DB");
console.log("═".repeat(72));

let written = 0;
let skipped = 0;
const errors = [];

for (const ag of anGames) {
  // Extract team abbreviations from the embedded teams array
  const awayTeamObj = (ag.teams || []).find(t => t.id === ag.away_team_id);
  const homeTeamObj = (ag.teams || []).find(t => t.id === ag.home_team_id);
  const awayAbbr = awayTeamObj?.abbr?.toUpperCase();
  const homeAbbr = homeTeamObj?.abbr?.toUpperCase();

  if (!awayAbbr || !homeAbbr) {
    console.log(`[SKIP] Game ${ag.id}: could not resolve team abbreviations`);
    skipped++;
    continue;
  }

  // Match DB game by both away+home abbr
  const dbGame = dbGames.find(
    g => g.awayTeam?.toUpperCase() === awayAbbr && g.homeTeam?.toUpperCase() === homeAbbr
  );

  if (!dbGame) {
    console.log(`[SKIP] ${awayAbbr}@${homeAbbr} (pk=${ag.id}): no matching DB game`);
    skipped++;
    continue;
  }

  // Extract DK odds (bookId=15)
  const dk = (ag.odds || []).find(o => o.book_id === 15);
  if (!dk) {
    console.log(`[SKIP] ${awayAbbr}@${homeAbbr}: no DK (book_id=15) odds`);
    skipped++;
    continue;
  }

  // Parse all three markets
  const awayML = fmt(dk.ml_away);
  const homeML = fmt(dk.ml_home);
  const bookTotal = dk.total ?? null;
  const overOdds = fmt(dk.over);
  const underOdds = fmt(dk.under);

  // Run line (spread_away is the RL label, e.g. -1.5 for favorite)
  const awayBookSpread = dk.spread_away ?? null;
  const homeBookSpread = dk.spread_home ?? null;
  const awaySpreadOdds = fmt(dk.spread_away_line);
  const homeSpreadOdds = fmt(dk.spread_home_line);
  const awayRunLine = awayBookSpread != null ? fmt(awayBookSpread) : null;
  const homeRunLine = homeBookSpread != null ? fmt(homeBookSpread) : null;
  const awayRunLineOdds = awaySpreadOdds;
  const homeRunLineOdds = homeSpreadOdds;

  try {
    await conn.execute(
      `UPDATE games SET
        awayML=?, homeML=?,
        bookTotal=?, overOdds=?, underOdds=?,
        awayBookSpread=?, homeBookSpread=?,
        awaySpreadOdds=?, homeSpreadOdds=?,
        awayRunLine=?, homeRunLine=?,
        awayRunLineOdds=?, homeRunLineOdds=?
       WHERE id=?`,
      [
        awayML, homeML,
        bookTotal, overOdds, underOdds,
        awayBookSpread, homeBookSpread,
        awaySpreadOdds, homeSpreadOdds,
        awayRunLine, homeRunLine,
        awayRunLineOdds, homeRunLineOdds,
        dbGame.id,
      ]
    );
    console.log(
      `[OUTPUT] ✅ ${awayAbbr}@${homeAbbr}: ML=${awayML}/${homeML} ` +
      `Total=${bookTotal}(${overOdds}/${underOdds}) ` +
      `RL=${awayRunLine}(${awayRunLineOdds}/${homeRunLineOdds})`
    );
    written++;
  } catch (err) {
    console.error(`[ERROR] ${awayAbbr}@${homeAbbr}: ${err.message}`);
    errors.push(`${awayAbbr}@${homeAbbr}: ${err.message}`);
  }
}

console.log(`\n[STATE] Book lines written: ${written} | skipped: ${skipped} | errors: ${errors.length}`);
await conn.end();

if (written === 0) {
  console.error("[FATAL] No book lines written — aborting model run");
  process.exit(1);
}

// ── Step 3: Run the MLB model ─────────────────────────────────────────────────
console.log("\n" + "═".repeat(72));
console.log(`  STEP 3: Running MLB model for ${DATE}`);
console.log("═".repeat(72));

try {
  execSync(
    `cd /home/ubuntu/ai-sports-betting && npx tsx scripts/runMlbModelDate.ts ${DATE}`,
    { stdio: "inherit", timeout: 600_000 }
  );
} catch (err) {
  console.error("[FATAL] Model run failed:", err.message);
  process.exit(1);
}

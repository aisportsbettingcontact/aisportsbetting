/**
 * MLB Schedule Seed Script — 2026 Season
 *
 * Seeds all 2,430 regular season games from the pre-fetched MLB Stats API JSON
 * into the `games` table.
 *
 * Data source: /tmp/mlb_full_schedule.json (fetched from statsapi.mlb.com)
 * Schema: games table with MLB-specific columns (mlbGamePk, broadcaster,
 *         awayStartingPitcher, homeStartingPitcher, venue, doubleHeader, gameNumber)
 *
 * Run: node server/seed-mlb-schedule.mjs
 */

import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

const LOG  = (msg) => console.log(`[seed-mlb-schedule] ${msg}`);
const WARN = (msg) => console.warn(`[seed-mlb-schedule][WARN] ${msg}`);

// ─── MLB Stats API abbreviation → internal app abbreviation ──────────────────
// The app uses the same abbreviations as MLB Stats API for most teams.
// Only exceptions: TB (API) = TB (app), SF (API) = SF (app), SD (API) = SD (app)
const MLB_ABBREV_MAP = {
  BAL: "BAL", BOS: "BOS", NYY: "NYY", TB:  "TB",  TOR: "TOR",
  CWS: "CWS", CLE: "CLE", DET: "DET", KC:  "KC",  MIN: "MIN",
  ATH: "ATH", HOU: "HOU", LAA: "LAA", SEA: "SEA", TEX: "TEX",
  ATL: "ATL", MIA: "MIA", NYM: "NYM", PHI: "PHI", WSH: "WSH",
  CHC: "CHC", CIN: "CIN", MIL: "MIL", PIT: "PIT", STL: "STL",
  ARI: "ARI", COL: "COL", LAD: "LAD", SD:  "SD",  SF:  "SF",
  OAK: "ATH", // Athletics moved to Sacramento
  AZ:  "ARI", // Diamondbacks use AZ in some API responses
};

// ─── ET offset by month (approximate, ignores DST transitions mid-month) ─────
function utcToEtDisplay(isoUtc) {
  // isoUtc: "2026-03-26T00:05:00Z"
  const month = parseInt(isoUtc.substring(5, 7), 10);
  const etOffset = (month <= 3 || month >= 11) ? -5 : -4; // EST vs EDT
  const utcHour = parseInt(isoUtc.substring(11, 13), 10);
  const utcMin  = parseInt(isoUtc.substring(14, 16), 10);
  let etHour = (utcHour + etOffset + 24) % 24;
  const ampm = etHour >= 12 ? "PM" : "AM";
  if (etHour > 12) etHour -= 12;
  if (etHour === 0) etHour = 12;
  return `${etHour}:${String(utcMin).padStart(2, "0")} ${ampm} ET`;
}

// ─── Load cached schedule JSON ────────────────────────────────────────────────
LOG("Loading cached MLB schedule from /tmp/mlb_full_schedule.json...");
const rawGames = JSON.parse(readFileSync("/tmp/mlb_full_schedule.json", "utf8"));
LOG(`Loaded ${rawGames.length} games`);

// ─── Transform games ──────────────────────────────────────────────────────────
const games = [];
const unknownAbbrevs = new Set();

for (const g of rawGames) {
  const awayAbbrev = MLB_ABBREV_MAP[g.awayAbbrev];
  const homeAbbrev = MLB_ABBREV_MAP[g.homeAbbrev];

  if (!awayAbbrev) { unknownAbbrevs.add(g.awayAbbrev); continue; }
  if (!homeAbbrev) { unknownAbbrevs.add(g.homeAbbrev); continue; }

  // Primary broadcaster: first unique TV entry
  const tvList = [...new Set(g.tv || [])];
  const broadcaster = tvList.length > 0 ? tvList[0] : null;

  games.push({
    gamePk:               g.gamePk,
    gameDate:             g.date,                          // "2026-03-25"
    startTimeEst:         utcToEtDisplay(g.gameTime),      // "8:05 PM ET"
    awayTeam:             awayAbbrev,
    homeTeam:             homeAbbrev,
    venue:                g.venue || null,
    broadcaster,
    awayStartingPitcher:  g.awayPitcherName || null,
    homeStartingPitcher:  g.homePitcherName || null,
    doubleHeader:         g.doubleHeader || "N",
    gameNumber:           g.gameNumber || 1,
  });
}

if (unknownAbbrevs.size > 0) {
  WARN(`Unknown abbreviations skipped: ${[...unknownAbbrevs].join(", ")}`);
}
LOG(`Games to seed: ${games.length}`);

// ─── Verify March 25 opener ───────────────────────────────────────────────────
const opener = games.find(g => g.gameDate === "2026-03-25");
if (opener) {
  LOG(`March 25 opener: ${opener.awayTeam} @ ${opener.homeTeam} | ${opener.startTimeEst} | ${opener.venue} | ${opener.broadcaster || "N/A"} | SP: ${opener.awayStartingPitcher} vs ${opener.homeStartingPitcher}`);
} else {
  WARN("March 25 opener not found!");
}

// ─── Database operations ──────────────────────────────────────────────────────
const db = await createConnection(process.env.DATABASE_URL);
LOG("Connected to database");

// Check existing count
const [existingRows] = await db.execute("SELECT COUNT(*) as cnt FROM games WHERE sport = 'MLB'");
const existingCount = existingRows[0].cnt;
LOG(`Existing MLB games in DB: ${existingCount}`);

// Batch upsert
let inserted = 0;
let updated  = 0;
let errors   = 0;
const BATCH_SIZE = 50;

for (let i = 0; i < games.length; i += BATCH_SIZE) {
  const batch = games.slice(i, i + BATCH_SIZE);

  for (const g of batch) {
    try {
      const [result] = await db.execute(
        `INSERT INTO games
           (sport, fileId, gameDate, startTimeEst, awayTeam, homeTeam, gameType,
            mlbGamePk, venue, broadcaster,
            awayStartingPitcher, homeStartingPitcher,
            doubleHeader, gameNumber,
            publishedToFeed, publishedModel)
         VALUES (?, 0, ?, ?, ?, ?, 'regular_season', ?, ?, ?, ?, ?, ?, ?, 0, 0)
         ON DUPLICATE KEY UPDATE
           gameDate             = VALUES(gameDate),
           startTimeEst         = VALUES(startTimeEst),
           awayTeam             = VALUES(awayTeam),
           homeTeam             = VALUES(homeTeam),
           venue                = VALUES(venue),
           broadcaster          = VALUES(broadcaster),
           awayStartingPitcher  = VALUES(awayStartingPitcher),
           homeStartingPitcher  = VALUES(homeStartingPitcher),
           doubleHeader         = VALUES(doubleHeader),
           gameNumber           = VALUES(gameNumber)`,
        [
          "MLB",
          g.gameDate,
          g.startTimeEst,
          g.awayTeam,
          g.homeTeam,
          g.gamePk,
          g.venue,
          g.broadcaster,
          g.awayStartingPitcher,
          g.homeStartingPitcher,
          g.doubleHeader,
          g.gameNumber,
        ]
      );

      if (result.affectedRows === 1) inserted++;
      else updated++;
    } catch (err) {
      WARN(`Failed game ${g.gamePk} (${g.awayTeam} @ ${g.homeTeam} on ${g.gameDate}): ${err.message}`);
      errors++;
    }
  }

  // Log progress every 500 games
  if (i % 500 === 0 && i > 0) {
    LOG(`  Progress: ${i}/${games.length} (${inserted} inserted, ${updated} updated, ${errors} errors)`);
  }
}

// ─── Final verification ───────────────────────────────────────────────────────
const [finalRows] = await db.execute("SELECT COUNT(*) as cnt FROM games WHERE sport = 'MLB'");
const finalCount = finalRows[0].cnt;

LOG("─────────────────────────────────────────────────────────────────");
LOG(`Seed complete:`);
LOG(`  Games processed: ${games.length}`);
LOG(`  Inserted:        ${inserted}`);
LOG(`  Updated:         ${updated}`);
LOG(`  Errors:          ${errors}`);
LOG(`  Total MLB in DB: ${finalCount}`);
LOG("─────────────────────────────────────────────────────────────────");

// Spot-check March 25 in DB
const [openerRows] = await db.execute(
  `SELECT id, gameDate, startTimeEst, awayTeam, homeTeam, venue, broadcaster,
          awayStartingPitcher, homeStartingPitcher
   FROM games WHERE sport = 'MLB' AND gameDate = '2026-03-25' LIMIT 5`
);
LOG(`March 25 games in DB (${openerRows.length}):`);
for (const row of openerRows) {
  LOG(`  [id=${row.id}] ${row.awayTeam} @ ${row.homeTeam} | ${row.startTimeEst} | ${row.venue} | ${row.broadcaster || "N/A"} | SP: ${row.awayStartingPitcher} vs ${row.homeStartingPitcher}`);
}

// Spot-check date range
const [rangeRows] = await db.execute(
  `SELECT MIN(gameDate) as first, MAX(gameDate) as last, COUNT(*) as total
   FROM games WHERE sport = 'MLB'`
);
LOG(`Date range: ${rangeRows[0].first} → ${rangeRows[0].last} (${rangeRows[0].total} total)`);

await db.end();
LOG("Done.");

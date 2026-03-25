/**
 * ingestStrikeoutProps.mjs
 *
 * One-shot script: reads the JSON output from StrikeoutModel.py and
 * upserts the two pitcher rows into mlb_strikeout_props for game 2250006.
 *
 * Usage: node server/ingestStrikeoutProps.mjs /tmp/strikeout_nyasf_20260325.json 2250006
 */

import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const TAG = "[IngestStrikeoutProps]";

const GAME_ID = parseInt(process.argv[3] ?? "2250006", 10);
const JSON_PATH = process.argv[2] ?? "/tmp/strikeout_nyasf_20260325.json";

console.log(`${TAG} Reading JSON from: ${JSON_PATH}`);
console.log(`${TAG} Target gameId: ${GAME_ID}`);

const raw = fs.readFileSync(JSON_PATH, "utf-8");
const data = JSON.parse(raw);

console.log(`${TAG} Parsed JSON: awayTeam=${data.awayTeam} homeTeam=${data.homeTeam} gameDate=${data.gameDate}`);
console.log(`${TAG} Away pitcher: ${data.away?.pitcherName} kProj=${data.away?.kProj}`);
console.log(`${TAG} Home pitcher: ${data.home?.pitcherName} kProj=${data.home?.kProj}`);

// Connect to DB
const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log(`${TAG} DB connected`);

const now = Date.now();

for (const [side, proj] of [["away", data.away], ["home", data.home]]) {
  if (!proj) {
    console.warn(`${TAG} ⚠ No projection for side=${side}, skipping`);
    continue;
  }

  const sql = `
    INSERT INTO mlb_strikeout_props (
      gameId, side, pitcherName, pitcherHand, retrosheetId, mlbamId,
      kProj, kLine, kPer9, kMedian, kP5, kP95,
      bookLine, bookOverOdds, bookUnderOdds,
      pOver, pUnder, modelOverOdds, modelUnderOdds,
      edgeOver, edgeUnder, verdict, bestEdge, bestSide, bestMlStr,
      signalBreakdown, matchupRows, distribution, inningBreakdown,
      modelRunAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?
    )
    ON DUPLICATE KEY UPDATE
      pitcherName=VALUES(pitcherName),
      pitcherHand=VALUES(pitcherHand),
      retrosheetId=VALUES(retrosheetId),
      mlbamId=VALUES(mlbamId),
      kProj=VALUES(kProj),
      kLine=VALUES(kLine),
      kPer9=VALUES(kPer9),
      kMedian=VALUES(kMedian),
      kP5=VALUES(kP5),
      kP95=VALUES(kP95),
      bookLine=VALUES(bookLine),
      bookOverOdds=VALUES(bookOverOdds),
      bookUnderOdds=VALUES(bookUnderOdds),
      pOver=VALUES(pOver),
      pUnder=VALUES(pUnder),
      modelOverOdds=VALUES(modelOverOdds),
      modelUnderOdds=VALUES(modelUnderOdds),
      edgeOver=VALUES(edgeOver),
      edgeUnder=VALUES(edgeUnder),
      verdict=VALUES(verdict),
      bestEdge=VALUES(bestEdge),
      bestSide=VALUES(bestSide),
      bestMlStr=VALUES(bestMlStr),
      signalBreakdown=VALUES(signalBreakdown),
      matchupRows=VALUES(matchupRows),
      distribution=VALUES(distribution),
      inningBreakdown=VALUES(inningBreakdown),
      modelRunAt=VALUES(modelRunAt),
      updatedAt=NOW()
  `;

  const vals = [
    GAME_ID,
    side,
    proj.pitcherName ?? null,
    proj.pitcherHand ?? null,
    proj.retrosheetId ?? null,
    proj.mlbamId ?? null,
    proj.kProj ?? null,
    proj.kLine ?? null,
    proj.kPer9 ?? null,
    proj.kMedian ?? null,
    proj.kP5 ?? null,
    proj.kP95 ?? null,
    proj.bookLine ?? null,
    proj.bookOverOdds ?? null,
    proj.bookUnderOdds ?? null,
    proj.pOver ?? null,
    proj.pUnder ?? null,
    proj.modelOverOdds ?? null,
    proj.modelUnderOdds ?? null,
    proj.edgeOver ?? null,
    proj.edgeUnder ?? null,
    proj.verdict ?? null,
    proj.bestEdge ?? null,
    proj.bestSide ?? null,
    proj.bestMlStr ?? null,
    proj.signalBreakdown ? JSON.stringify(proj.signalBreakdown) : null,
    proj.matchupRows ? JSON.stringify(proj.matchupRows) : null,
    proj.distribution ? JSON.stringify(proj.distribution) : null,
    proj.inningBreakdown ? JSON.stringify(proj.inningBreakdown) : null,
    now,
  ];

  const [result] = await conn.execute(sql, vals);
  console.log(`${TAG} ✓ Upserted side=${side} pitcher=${proj.pitcherName} affectedRows=${result.affectedRows}`);
}

await conn.end();
console.log(`${TAG} ✓ Done. DB connection closed.`);

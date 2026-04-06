/**
 * mlbStatcastSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches 2025 Statcast leaderboard data from Baseball Savant and populates
 * iso, barrelPct, hardHitPct, xSlg columns in the mlb_players table.
 *
 * Data source: https://baseballsavant.mlb.com/leaderboard/custom
 *   - min 50 PA, 2025 season
 *   - Returns CSV with: player_id (MLBAM), barrel_batted_rate, hard_hit_percent, xslg, iso
 *
 * Match strategy:
 *   1. Primary: mlbamId exact match (player_id from Savant = mlbamId in mlb_players)
 *   2. Fallback: name normalization match
 *
 * [INPUT]  none (fetches live from Baseball Savant)
 * [OUTPUT] { updated: number, notFound: number, errors: number }
 */

import * as https from "https";
import * as http from "http";
import { getDb } from "./db";
import { mlbPlayers } from "../drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";

const TAG = "[StatcastSync]";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatcastRow {
  mlbamId: number;
  playerName: string;
  barrelPct: number | null;   // barrel_batted_rate (%)
  hardHitPct: number | null;  // hard_hit_percent (%)
  xSlg: number | null;        // xslg (decimal, e.g. 0.411)
  iso: number | null;         // iso (decimal, e.g. 0.185)
}

export interface StatcastSyncResult {
  fetched: number;
  updated: number;
  notFound: number;
  errors: number;
  notFoundNames: string[];
}

// ─── HTTP fetch helper ────────────────────────────────────────────────────────

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StatcastSync/1.0)",
        "Accept": "text/csv,*/*",
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          fetchUrl(location).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("Request timeout after 20s"));
    });
  });
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseStatcastCsv(csv: string): StatcastRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  // Parse header using proper CSV parser to handle quoted fields with commas
  // e.g. "last_name, first_name" is a single quoted field containing a comma
  const header = parseCSVLine(lines[0].replace(/^\uFEFF/, ""))
    .map(h => h.replace(/^"|"$/g, "").trim());

  const playerIdIdx = header.indexOf("player_id");
  const barrelIdx = header.indexOf("barrel_batted_rate");
  const hardHitIdx = header.indexOf("hard_hit_percent");
  const xSlgIdx = header.indexOf("xslg");
  const isoIdx = header.indexOf("iso");

  console.log(`${TAG} [STATE] CSV header indices: player_id=${playerIdIdx} barrel=${barrelIdx} hardHit=${hardHitIdx} xslg=${xSlgIdx} iso=${isoIdx}`);

  const rows: StatcastRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted CSV fields
    const fields = parseCSVLine(line);

    const mlbamId = parseInt(fields[playerIdIdx]?.replace(/"/g, "") ?? "", 10);
    if (isNaN(mlbamId) || mlbamId <= 0) continue;

    const playerName = fields[1]?.replace(/"/g, "").trim() ?? "";

    const parseNum = (idx: number): number | null => {
      if (idx < 0 || idx >= fields.length) return null;
      const raw = fields[idx]?.replace(/"/g, "").trim();
      if (!raw || raw === "" || raw === "null") return null;
      const n = parseFloat(raw);
      return isNaN(n) ? null : n;
    };

    rows.push({
      mlbamId,
      playerName,
      barrelPct: parseNum(barrelIdx),
      hardHitPct: parseNum(hardHitIdx),
      xSlg: parseNum(xSlgIdx),
      iso: parseNum(isoIdx),
    });
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ─── Main sync function ───────────────────────────────────────────────────────

export async function syncStatcastData(year: number = 2025): Promise<StatcastSyncResult> {
  const result: StatcastSyncResult = {
    fetched: 0,
    updated: 0,
    notFound: 0,
    errors: 0,
    notFoundNames: [],
  };

  console.log(`${TAG} [INPUT] Fetching Statcast ${year} leaderboard from Baseball Savant`);

  // ── Step 1: Fetch CSV from Baseball Savant ──────────────────────────────────
  const url = `https://baseballsavant.mlb.com/leaderboard/custom?year=${year}&type=batter&filter=&min=50&selections=player_id,player_name,b_ab,b_home_run,exit_velocity_avg,barrel_batted_rate,hard_hit_percent,xslg,iso&chart=false&x=exit_velocity_avg&y=exit_velocity_avg&r=no&chartType=beeswarm&csv=true`;

  let csv: string;
  try {
    csv = await fetchUrl(url);
    console.log(`${TAG} [STEP] CSV fetched, length=${csv.length} bytes`);
  } catch (err) {
    console.error(`${TAG} [ERROR] Failed to fetch Statcast CSV: ${err}`);
    result.errors++;
    return result;
  }

  // ── Step 2: Parse CSV ───────────────────────────────────────────────────────
  const rows = parseStatcastCsv(csv);
  result.fetched = rows.length;
  console.log(`${TAG} [STATE] Parsed ${rows.length} Statcast rows`);

  if (rows.length === 0) {
    console.error(`${TAG} [ERROR] No rows parsed from CSV`);
    result.errors++;
    return result;
  }

  // ── Step 3: Build lookup map by mlbamId ─────────────────────────────────────
  const statcastByMlbamId = new Map<number, StatcastRow>();
  for (const row of rows) {
    statcastByMlbamId.set(row.mlbamId, row);
  }

  // ── Step 4: Fetch all mlb_players with mlbamId ──────────────────────────────
  const db = await getDb();
  const players = await db
    .select({
      id: mlbPlayers.id,
      mlbamId: mlbPlayers.mlbamId,
      name: mlbPlayers.name,
    })
    .from(mlbPlayers)
    .where(isNotNull(mlbPlayers.mlbamId));

  console.log(`${TAG} [STATE] ${players.length} mlb_players with mlbamId to match`);

  // ── Step 5: Update each player ──────────────────────────────────────────────
  const now = Date.now();
  let batchUpdated = 0;
  let batchNotFound = 0;

  for (const player of players) {
    if (!player.mlbamId) continue;

    const statcast = statcastByMlbamId.get(player.mlbamId);
    if (!statcast) {
      batchNotFound++;
      result.notFoundNames.push(player.name);
      continue;
    }

    try {
      await db
        .update(mlbPlayers)
        .set({
          iso: statcast.iso,
          barrelPct: statcast.barrelPct,
          hardHitPct: statcast.hardHitPct,
          xSlg: statcast.xSlg,
          statcastFetchedAt: now,
        })
        .where(eq(mlbPlayers.id, player.id));

      batchUpdated++;
    } catch (err) {
      console.error(`${TAG} [ERROR] Failed to update player ${player.name} (id=${player.id}): ${err}`);
      result.errors++;
    }
  }

  result.updated = batchUpdated;
  result.notFound = batchNotFound;

  console.log(`${TAG} [OUTPUT] updated=${result.updated} notFound=${result.notFound} errors=${result.errors}`);
  console.log(`${TAG} [VERIFY] ${result.errors === 0 ? "PASS" : "WARN"} — ${result.errors} errors`);

  // Log sample of not-found players (pitchers/bench players expected to be missing)
  if (result.notFoundNames.length > 0 && result.notFoundNames.length <= 20) {
    console.log(`${TAG} [STATE] Not found in Savant (likely pitchers/low-PA): ${result.notFoundNames.slice(0, 10).join(", ")}`);
  }

  return result;
}

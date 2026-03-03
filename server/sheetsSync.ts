/**
 * sheetsSync.ts
 *
 * Fetches the latest NCAAM model data directly from the public Google Sheet
 * and upserts it into the games table.
 *
 * The sheet uses the canonical 03-02-2026 column format:
 *   date, start_time_est, away_team, away_book_spread, away_model_spread,
 *   home_team, home_book_spread, book_total, home_model_spread, model_total,
 *   spread_edge, spread_diff, total_edge, total_diff
 *
 * Strategy:
 * 1. Enumerate all sheet tabs by fetching the spreadsheet's gviz/tq JSON.
 * 2. Filter to tabs whose name matches MM-DD-YYYY.
 * 3. Sort descending and take the most recent N sheets (default: all).
 * 4. For each sheet, fetch CSV, parse with the canonical parser, upsert.
 */

import { parseCsvBuffer } from "./fileParser";
import type { InsertGame } from "../drizzle/schema";

const SHEET_ID = "1JBYA8dRB0QwCbIb0k2iWorx-dvzQRspBpzoZhMmXH84";
const SPORT = "NCAAM";

// Virtual file ID used for all Google Sheets-sourced rows
export const SHEETS_FILE_ID = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gvizCsvUrl(sheetName: string): string {
  const encoded = encodeURIComponent(sheetName);
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encoded}`;
}

function gvizJsonUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

/**
 * Get all sheet tab names from the spreadsheet.
 * Falls back to a hardcoded list of recent dates if the metadata fetch fails.
 */
async function getSheetNames(): Promise<string[]> {
  try {
    const raw = await fetchText(gvizJsonUrl());
    // Strip google.visualization.Query.setResponse( ... ) wrapper
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    const json = JSON.parse(raw.slice(start, end)) as {
      table?: { cols?: Array<{ label?: string }> };
    };
    // The gviz JSON doesn't expose sheet names directly.
    // We'll use a different approach: parse the HTML to find sheet names.
    // Since that's fragile, we'll use the export URL approach below.
    void json;
  } catch {
    // ignore
  }

  // Use the Sheets HTML page to extract tab names
  try {
    const htmlUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
    const html = await fetchText(htmlUrl);
    // Sheet names appear in the HTML as data-name attributes
    const matches = Array.from(html.matchAll(/data-name="([^"]+)"/g));
    const names = matches.map((m) => m[1]!).filter(Boolean);
    if (names.length > 0) return names;
  } catch {
    // ignore
  }

  // Last resort: generate date-based names for the past 30 days
  const names: string[] = [];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    names.push(`${mm}-${dd}-${yyyy}`);
  }
  return names;
}

/**
 * Fetch CSV for a single sheet and parse into game rows.
 * Returns empty array if the sheet doesn't match the canonical format.
 */
async function fetchSheetGames(sheetName: string): Promise<InsertGame[]> {
  const url = gvizCsvUrl(sheetName);
  try {
    const csv = await fetchText(url);
    if (!csv.trim()) return [];
    const buf = Buffer.from(csv, "utf-8");
    return parseCsvBuffer(buf, SHEETS_FILE_ID, SPORT);
  } catch (err) {
    // Non-canonical format or fetch error — skip silently
    console.log(`[SheetsSync] Skipping sheet "${sheetName}": ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SyncResult {
  sheetsProcessed: number;
  gamesFound: number;
  sheetNames: string[];
}

/**
 * Fetch all matching sheets from the Google Spreadsheet and return parsed games.
 * Does NOT write to the database — caller is responsible for persistence.
 */
export async function fetchAllSheetsGames(): Promise<{
  games: InsertGame[];
  result: SyncResult;
}> {
  const allNames = await getSheetNames();

  // Filter to MM-DD-YYYY pattern
  const datePattern = /^\d{2}-\d{2}-\d{4}$/;
  const dateSheets = allNames.filter((n) => datePattern.test(n));

  // Sort descending (most recent first)
  dateSheets.sort((a, b) => {
    const toDate = (s: string) => {
      const [mm, dd, yyyy] = s.split("-");
      return new Date(`${yyyy}-${mm}-${dd}`).getTime();
    };
    return toDate(b) - toDate(a);
  });

  console.log(`[SheetsSync] Found ${dateSheets.length} date-named sheets`);

  const allGames: InsertGame[] = [];
  const processedSheets: string[] = [];

  for (const name of dateSheets) {
    const games = await fetchSheetGames(name);
    if (games.length > 0) {
      allGames.push(...games);
      processedSheets.push(name);
      console.log(`[SheetsSync] Sheet "${name}": ${games.length} games`);
    }
  }

  return {
    games: allGames,
    result: {
      sheetsProcessed: processedSheets.length,
      gamesFound: allGames.length,
      sheetNames: processedSheets,
    },
  };
}

/**
 * Fetch only the most recent sheet's games.
 * Used for quick dashboard refresh.
 */
export async function fetchLatestSheetGames(): Promise<{
  games: InsertGame[];
  sheetName: string | null;
}> {
  const allNames = await getSheetNames();
  const datePattern = /^\d{2}-\d{2}-\d{4}$/;
  const dateSheets = allNames
    .filter((n) => datePattern.test(n))
    .sort((a, b) => {
      const toDate = (s: string) => {
        const [mm, dd, yyyy] = s.split("-");
        return new Date(`${yyyy}-${mm}-${dd}`).getTime();
      };
      return toDate(b) - toDate(a);
    });

  for (const name of dateSheets) {
    const games = await fetchSheetGames(name);
    if (games.length > 0) {
      console.log(`[SheetsSync] Latest sheet "${name}": ${games.length} games`);
      return { games, sheetName: name };
    }
  }

  return { games: [], sheetName: null };
}

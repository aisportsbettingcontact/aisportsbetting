/**
 * Data layer for the /splits Discord command.
 *
 * Pulls today's games directly from the database (no HTTP round-trip needed
 * since the bot runs inside the same server process).
 *
 * Deep logging: every row is audited for completeness and logged at debug level.
 * Set LOG_LEVEL=debug to see per-row field values.
 */

import { listGames } from "../db";
import { resolveTeam } from "./teamRegistry";

export interface SpreadSplits {
  away_ticket_pct: number | null;
  away_money_pct:  number | null;
  home_ticket_pct: number | null;
  home_money_pct:  number | null;
}

export interface TotalSplits {
  over_ticket_pct:   number | null;
  over_money_pct:    number | null;
  under_ticket_pct:  number | null;
  under_money_pct:   number | null;
}

export interface MoneylineSplits {
  away_ticket_pct: number | null;
  away_money_pct:  number | null;
  home_ticket_pct: number | null;
  home_money_pct:  number | null;
}

export interface GameSplits {
  id:          number;
  league:      string;
  game_date:   string;
  start_time:  string;
  away_team:   string;
  home_team:   string;
  away_abbr:   string;
  home_abbr:   string;
  away_color:  string;
  home_color:  string;
  away_color2: string;
  home_color2: string;
  away_color3: string;
  home_color3: string;
  away_logo:   string;
  home_logo:   string;
  spread:      SpreadSplits;
  total:       TotalSplits;
  moneyline:   MoneylineSplits;
}

// ─── Logger ───────────────────────────────────────────────────────────────────
const IS_DEBUG = process.env.LOG_LEVEL === "debug";
function log(stage: string, msg: string, level: "info" | "warn" | "error" | "debug" = "info") {
  if (level === "debug" && !IS_DEBUG) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}][SplitsBot][fetch:${stage}]`;
  if (level === "error") console.error(`${prefix} ❌ ${msg}`);
  else if (level === "warn") console.warn(`${prefix} ⚠️  ${msg}`);
  else console.log(`${prefix} ${msg}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Returns today's date in ET as YYYY-MM-DD */
function todayEt(): string {
  return new Date()
    .toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year:  "numeric",
      month: "2-digit",
      day:   "2-digit",
    })
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2");
}

/** Formats a raw "HH:MM" 24-h string into "H:MM AM/PM ET" */
function formatTime(raw: string | null | undefined): string {
  if (!raw) return "TBD";
  const [hStr, mStr] = raw.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return raw;
  const period = h >= 12 ? "PM" : "AM";
  const h12    = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period} ET`;
}

function complement(pct: number | null): number | null {
  if (pct === null || pct === undefined) return null;
  return Math.round(100 - pct);
}

/**
 * Fetch all daily betting splits for a given date (defaults to today ET).
 * Reads directly from the database — no HTTP overhead.
 */
export async function fetchAllDailySplits(dateOverride?: string): Promise<GameSplits[]> {
  const gameDate = dateOverride ?? todayEt();
  log("init", `Fetching splits for date: ${gameDate}`);

  const t0   = Date.now();
  const rows = await listGames({ gameDate });
  const dbMs = Date.now() - t0;
  log("db", `DB query returned ${rows.length} row(s) in ${dbMs}ms`);

  if (rows.length === 0) {
    log("db", `No games in DB for ${gameDate}`, "warn");
    return [];
  }

  // Log raw DB row summary
  for (const row of rows) {
    const key = `${row.awayTeam} @ ${row.homeTeam}`;
    log("db", `  row[${row.id}] ${key} | sport=${row.sport} | startTime=${row.startTimeEst}`, "debug");
    log("db", `    spread: awayBetsPct=${row.spreadAwayBetsPct} awayMoneyPct=${row.spreadAwayMoneyPct}`, "debug");
    log("db", `    total:  overBetsPct=${row.totalOverBetsPct}  overMoneyPct=${row.totalOverMoneyPct}`, "debug");
    log("db", `    ml:     awayBetsPct=${row.mlAwayBetsPct}     awayMoneyPct=${row.mlAwayMoneyPct}`, "debug");
  }

  const result: GameSplits[] = rows.map((row, idx) => {
    const key = `[${idx + 1}/${rows.length}] ${row.awayTeam} @ ${row.homeTeam}`;

    // Resolve team registry entries
    const awayEntry = resolveTeam(row.awayTeam, row.sport);
    const homeEntry = resolveTeam(row.homeTeam, row.sport);
    log("team", `${key} — away resolved: abbr=${awayEntry.abbrev} color=${awayEntry.primaryColor} logo=${awayEntry.logoUrl ? "✓" : "NONE"}`, "debug");
    log("team", `${key} — home resolved: abbr=${homeEntry.abbrev} color=${homeEntry.primaryColor} logo=${homeEntry.logoUrl ? "✓" : "NONE"}`, "debug");

    // Warn if team resolution fell back to slug
    if (!awayEntry.abbrev || awayEntry.abbrev === row.awayTeam.slice(0, 3).toUpperCase()) {
      log("team", `${key} — away team "${row.awayTeam}" may not be in registry (abbrev=${awayEntry.abbrev})`, "warn");
    }
    if (!homeEntry.abbrev || homeEntry.abbrev === row.homeTeam.slice(0, 3).toUpperCase()) {
      log("team", `${key} — home team "${row.homeTeam}" may not be in registry (abbrev=${homeEntry.abbrev})`, "warn");
    }

    // Extract raw split values
    const spreadAwayTicket = row.spreadAwayBetsPct  ?? null;
    const spreadAwayMoney  = row.spreadAwayMoneyPct ?? null;
    const overTicket       = row.totalOverBetsPct   ?? null;
    const overMoney        = row.totalOverMoneyPct  ?? null;
    const mlAwayTicket     = row.mlAwayBetsPct      ?? null;
    const mlAwayMoney      = row.mlAwayMoneyPct     ?? null;

    // Warn on any null splits
    const nullFields: string[] = [];
    if (spreadAwayTicket === null) nullFields.push("spreadAwayTicket");
    if (spreadAwayMoney  === null) nullFields.push("spreadAwayMoney");
    if (overTicket       === null) nullFields.push("overTicket");
    if (overMoney        === null) nullFields.push("overMoney");
    if (mlAwayTicket     === null) nullFields.push("mlAwayTicket");
    if (mlAwayMoney      === null) nullFields.push("mlAwayMoney");
    if (nullFields.length > 0) {
      log("splits", `${key} — null fields (will show 50/50): ${nullFields.join(", ")}`, "warn");
    } else {
      log("splits", `${key} — all splits present ✓`, "debug");
    }

    const game: GameSplits = {
      id:          row.id,
      league:      row.sport,
      game_date:   row.gameDate ?? gameDate,
      start_time:  formatTime(row.startTimeEst),
      away_team:   awayEntry.displayName,
      home_team:   homeEntry.displayName,
      away_abbr:   awayEntry.abbrev,
      home_abbr:   homeEntry.abbrev,
      away_color:  awayEntry.primaryColor,
      home_color:  homeEntry.primaryColor,
      away_color2: awayEntry.secondaryColor,
      home_color2: homeEntry.secondaryColor,
      away_color3: awayEntry.tertiaryColor,
      home_color3: homeEntry.tertiaryColor,
      away_logo:   awayEntry.logoUrl,
      home_logo:   homeEntry.logoUrl,
      spread: {
        away_ticket_pct: spreadAwayTicket,
        away_money_pct:  spreadAwayMoney,
        home_ticket_pct: complement(spreadAwayTicket),
        home_money_pct:  complement(spreadAwayMoney),
      },
      total: {
        over_ticket_pct:  overTicket,
        over_money_pct:   overMoney,
        under_ticket_pct: complement(overTicket),
        under_money_pct:  complement(overMoney),
      },
      moneyline: {
        away_ticket_pct: mlAwayTicket,
        away_money_pct:  mlAwayMoney,
        home_ticket_pct: complement(mlAwayTicket),
        home_money_pct:  complement(mlAwayMoney),
      },
    };

    log("map", `${key} — mapped: spread=${spreadAwayTicket}%/${complement(spreadAwayTicket)}% total=${overTicket}%/${complement(overTicket)}% ml=${mlAwayTicket}%/${complement(mlAwayTicket)}%`);
    return game;
  });

  const totalMs = Date.now() - t0;
  log("done", `fetchAllDailySplits complete — ${result.length} games in ${totalMs}ms`);
  return result;
}

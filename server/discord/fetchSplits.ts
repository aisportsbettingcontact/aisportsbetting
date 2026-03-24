/**
 * Data layer for the /splits Discord command.
 *
 * Pulls today's games directly from the database (no HTTP round-trip needed
 * since the bot runs inside the same server process).
 */

import { listGames } from "../db";
import { resolveTeam } from "./teamRegistry";

export interface SpreadSplits {
  away_ticket_pct: number | null;
  away_money_pct: number | null;
  home_ticket_pct: number | null;
  home_money_pct: number | null;
}

export interface TotalSplits {
  over_ticket_pct: number | null;
  over_money_pct: number | null;
  under_ticket_pct: number | null;
  under_money_pct: number | null;
}

export interface MoneylineSplits {
  away_ticket_pct: number | null;
  away_money_pct: number | null;
  home_ticket_pct: number | null;
  home_money_pct: number | null;
}

export interface GameSplits {
  id: number;
  league: string;
  game_date: string;
  start_time: string;
  away_team: string;
  home_team: string;
  away_abbr: string;
  home_abbr: string;
  away_color: string;
  home_color: string;
  away_color2: string;
  home_color2: string;
  away_logo: string;
  home_logo: string;
  spread: SpreadSplits;
  total: TotalSplits;
  moneyline: MoneylineSplits;
}

/** Returns today's date in ET as YYYY-MM-DD */
function todayEt(): string {
  return new Date()
    .toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
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
  const h12 = h % 12 === 0 ? 12 : h % 12;
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
  console.log(`[SplitsBot] fetchAllDailySplits — date: ${gameDate}`);

  const rows = await listGames({ gameDate });
  console.log(`[SplitsBot] ${rows.length} games found for ${gameDate}`);

  const result: GameSplits[] = rows.map((row) => {
    const awayEntry = resolveTeam(row.awayTeam, row.sport);
    const homeEntry = resolveTeam(row.homeTeam, row.sport);

    const spreadAwayTicket = row.spreadAwayBetsPct ?? null;
    const spreadAwayMoney = row.spreadAwayMoneyPct ?? null;
    const overTicket = row.totalOverBetsPct ?? null;
    const overMoney = row.totalOverMoneyPct ?? null;
    const mlAwayTicket = row.mlAwayBetsPct ?? null;
    const mlAwayMoney = row.mlAwayMoneyPct ?? null;

    return {
      id: row.id,
      league: row.sport,
      game_date: row.gameDate ?? gameDate,
      start_time: formatTime(row.startTimeEst),
      away_team: awayEntry.displayName,
      home_team: homeEntry.displayName,
      away_abbr: awayEntry.abbrev,
      home_abbr: homeEntry.abbrev,
      away_color: awayEntry.primaryColor,
      home_color: homeEntry.primaryColor,
      away_color2: awayEntry.secondaryColor,
      home_color2: homeEntry.secondaryColor,
      away_logo: awayEntry.logoUrl,
      home_logo: homeEntry.logoUrl,
      spread: {
        away_ticket_pct: spreadAwayTicket,
        away_money_pct: spreadAwayMoney,
        home_ticket_pct: complement(spreadAwayTicket),
        home_money_pct: complement(spreadAwayMoney),
      },
      total: {
        over_ticket_pct: overTicket,
        over_money_pct: overMoney,
        under_ticket_pct: complement(overTicket),
        under_money_pct: complement(overMoney),
      },
      moneyline: {
        away_ticket_pct: mlAwayTicket,
        away_money_pct: mlAwayMoney,
        home_ticket_pct: complement(mlAwayTicket),
        home_money_pct: complement(mlAwayMoney),
      },
    };
  });

  return result;
}

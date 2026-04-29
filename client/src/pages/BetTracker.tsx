/**
 * BetTracker.tsx — Handicapper Bet Tracker v7
 *
 * New in v7:
 *   - BetCard full redesign: large team logos, 9-inning linescore grid (MLB),
 *     live/final scores, start time for upcoming games
 *   - getLinescores tRPC procedure used for per-inning MLB data
 *   - Real-time auto-grade polling: 60s interval when PENDING bets exist,
 *     fires immediately when gameStatus transitions to "Final"
 *   - RL fix: line value embedded inline in pick string, no duplicate field
 *
 * Access: OWNER | ADMIN | HANDICAPPER only.
 *   - OWNER / ADMIN: can view any handicapper's bets via selector
 *   - HANDICAPPER: sees only their own bets
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import {
  Clock, TrendingUp, Minus, AlertCircle,
  ChevronLeft, Plus, Pencil, Trash2, CheckCircle2,
  DollarSign, Hash, ChevronDown, Zap, RefreshCw, BarChart2,
} from "lucide-react";
import type { TrackedBet } from "@shared/types";
import { EquityChart, BreakdownGrid, HandicapperSelector } from "@/components/BetTrackerAnalytics";
import type { StatsData } from "@/components/BetTrackerAnalytics";

// ─── Types ────────────────────────────────────────────────────────────────────

/** TrackedBet enriched with SlateGame data from the list procedure */
type EnrichedBet = TrackedBet & {
  awayLogo:     string | null;
  homeLogo:     string | null;
  awayFull:     string | null;
  homeFull:     string | null;
  awayNickname: string | null;
  homeNickname: string | null;
  awayColor:    string | null;
  homeColor:    string | null;
  gameTime:     string | null;
  startUtc:     string | null;
  gameStatus:   string | null;
};

/** Per-inning linescore entry returned by getLinescores */
type LinescoreEntry = {
  gamePk:        number;
  gameDate:      string;
  awayAbbrev:    string;
  homeAbbrev:    string;
  innings:       { num: number; awayRuns: number | null; homeRuns: number | null }[];
  awayR:         number | null;
  awayH:         number | null;
  awayE:         number | null;
  homeR:         number | null;
  homeH:         number | null;
  homeE:         number | null;
  currentInning: number | null;
  inningState:   string | null;
  status:        string;
};

const SPORTS = ["MLB", "NHL", "NBA", "NCAAM"] as const;
type Sport = typeof SPORTS[number];

type Timeframe = "FULL_GAME" | "FIRST_5" | "FIRST_INNING" | "NRFI" | "YRFI" | "REGULATION" | "FIRST_PERIOD" | "FIRST_HALF" | "FIRST_QUARTER";
type Market    = "ML" | "RL" | "TOTAL";
type PickSide  = "AWAY" | "HOME" | "OVER" | "UNDER";
type Result    = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
type StakeMode = "$" | "U";

interface OddsEntry { odds: number; value: number; }
interface GameOdds {
  awayMl: OddsEntry | null; homeMl: OddsEntry | null;
  awayRl: OddsEntry | null; homeRl: OddsEntry | null;
  over:   OddsEntry | null; under:  OddsEntry | null;
  bookId: number;
}
interface SlateGame {
  id:           number;
  awayTeam:     string;
  homeTeam:     string;
  awayFull:     string;
  homeFull:     string;
  awayNickname: string;
  homeNickname: string;
  awayLogo:     string;
  homeLogo:     string;
  awayColor:    string;
  homeColor:    string;
  gameTime:     string;
  sport:        string;
  gameDate:     string;
  status:       string;
  odds:         GameOdds;
}

// ─── Sport-aware timeframe options ───────────────────────────────────────────

const TIMEFRAMES_BY_SPORT: Record<Sport, { value: Timeframe; label: string }[]> = {
  MLB:   [
    { value: "FULL_GAME",    label: "Full Game" },
    { value: "FIRST_5",      label: "First 5 Innings (F5)" },
    { value: "FIRST_INNING", label: "First Inning" },
    { value: "NRFI",         label: "NRFI (No Run First Inning)" },
    { value: "YRFI",         label: "YRFI (Yes Run First Inning)" },
  ],
  NHL:   [
    { value: "FULL_GAME",    label: "Full Game (incl. OT/SO)" },
    { value: "REGULATION",   label: "Regulation" },
    { value: "FIRST_PERIOD", label: "1st Period" },
  ],
  NBA:   [
    { value: "FULL_GAME",    label: "Full Game" },
    { value: "FIRST_HALF",   label: "1st Half" },
    { value: "FIRST_QUARTER", label: "1st Quarter" },
  ],
  NCAAM: [
    { value: "FULL_GAME",    label: "Full Game" },
    { value: "FIRST_HALF",   label: "1st Half" },
  ],
};

const MARKET_LABELS: Record<Sport, Record<Market, string>> = {
  MLB:   { ML: "Moneyline", RL: "Run Line",   TOTAL: "Total (Runs)" },
  NHL:   { ML: "Moneyline", RL: "Puck Line",  TOTAL: "Total (Goals)" },
  NBA:   { ML: "Moneyline", RL: "Spread",     TOTAL: "Total (Points)" },
  NCAAM: { ML: "Moneyline", RL: "Spread",     TOTAL: "Total (Points)" },
};

const RESULTS = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayEst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function calcToWin(odds: number, risk: number): number {
  if (!odds || !risk || risk <= 0) return 0;
  if (odds >= 100) return parseFloat((risk * (odds / 100)).toFixed(4));
  return parseFloat((risk * (100 / Math.abs(odds))).toFixed(4));
}

function fmtOdds(o: number): string {
  return o >= 0 ? `+${o}` : `${o}`;
}

function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${str}` : `$${str}`;
}

function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toFixed(2);
  return n < 0 ? `-${str}u` : `${str}u`;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function resultColor(r: Result): string {
  switch (r) {
    case "WIN":     return "text-green-400";
    case "LOSS":    return "text-red-400";
    case "PUSH":    return "text-yellow-400";
    case "PENDING": return "text-zinc-400";
    case "VOID":    return "text-zinc-500";
  }
}

function resultBg(r: Result): string {
  switch (r) {
    case "WIN":     return "bg-green-500/10 border-green-500/30 text-green-400";
    case "LOSS":    return "bg-red-500/10 border-red-500/30 text-red-400";
    case "PUSH":    return "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";
    case "PENDING": return "bg-zinc-800 border-zinc-700 text-zinc-400";
    case "VOID":    return "bg-zinc-900 border-zinc-800 text-zinc-500";
  }
}

function timeframeShort(tf: string): string {
  switch (tf) {
    case "FIRST_5":       return "F5";
    case "FIRST_INNING":  return "F1";
    case "NRFI":          return "NRFI";
    case "YRFI":          return "YRFI";
    case "REGULATION":    return "REG";
    case "FIRST_PERIOD":  return "1P";
    case "FIRST_HALF":    return "1H";
    case "FIRST_QUARTER": return "1Q";
    default:              return "";
  }
}

function getPickOdds(odds: GameOdds | null, market: Market, pickSide: PickSide): number | null {
  if (!odds) return null;
  switch (market) {
    case "ML":    return pickSide === "AWAY" ? odds.awayMl?.odds ?? null : odds.homeMl?.odds ?? null;
    case "RL":    return pickSide === "AWAY" ? odds.awayRl?.odds ?? null : odds.homeRl?.odds ?? null;
    case "TOTAL": return pickSide === "OVER" ? odds.over?.odds  ?? null : odds.under?.odds  ?? null;
  }
}

function getPickLine(odds: GameOdds | null, market: Market, pickSide: PickSide): number | null {
  if (!odds) return null;
  switch (market) {
    case "RL":    return pickSide === "AWAY" ? odds.awayRl?.value ?? null : odds.homeRl?.value ?? null;
    case "TOTAL": return pickSide === "OVER" ? odds.over?.value   ?? null : odds.under?.value  ?? null;
    default:      return null;
  }
}

/** Format a local start time from a UTC ISO string */
function fmtStartTime(utcStr: string | null, gameTime: string | null): string {
  if (utcStr) {
    try {
      const d = new Date(utcStr);
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch { /* fall through */ }
  }
  if (gameTime) return `${gameTime} ET`;
  return "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color,
}: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white/4 border border-white/8 rounded-lg px-3 py-2.5 flex flex-col gap-0.5 min-w-0">
      <div className={`text-base sm:text-lg font-bold truncate ${color ?? "text-white"}`}>{value}</div>
      <div className="text-[10px] text-zinc-500 tracking-wider uppercase truncate">{label}</div>
      {sub && <div className="text-[10px] text-zinc-600 truncate">{sub}</div>}
    </div>
  );
}

function SelectField({
  label, value, onChange, options, placeholder, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 pr-8 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      </div>
    </div>
  );
}

function PickButton({
  selected, onClick, logo, teamAbbr, teamNickname, odds, line, side, disabled,
}: {
  selected:     boolean;
  onClick:      () => void;
  logo?:        string;
  teamAbbr?:    string;
  teamNickname?: string;
  odds:         number | null;
  line?:        number | null;
  side:         "AWAY" | "HOME" | "OVER" | "UNDER";
  disabled?:    boolean;
}) {
  const isTotal = side === "OVER" || side === "UNDER";
  const sideLabel = isTotal ? (side === "OVER" ? "OVER" : "UNDER") : (side === "AWAY" ? "AWAY" : "HOME");

  return (
    <button type="button" onClick={onClick}
      disabled={disabled}
      className={`
        flex-1 flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all
        min-w-0 relative
        ${selected
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800"
        }
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {selected && (
        <div className="absolute top-1.5 right-1.5">
          <CheckCircle2 size={12} className="text-emerald-400" />
        </div>
      )}
      {!isTotal && logo ? (
        <img src={logo} alt={teamAbbr} className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className={`text-lg font-black ${isTotal ? (side === "OVER" ? "text-emerald-400" : "text-blue-400") : "text-zinc-400"}`}>
          {side === "OVER" ? "O" : side === "UNDER" ? "U" : ""}
        </div>
      )}
      <div className="text-center">
        {!isTotal ? (
          <>
            <div className="text-[11px] font-black text-white tracking-wider leading-tight">{teamAbbr}</div>
            {teamNickname && <div className="text-[9px] text-zinc-500 leading-tight truncate max-w-[64px]">{teamNickname}</div>}
          </>
        ) : (
          <div className="text-[11px] font-black text-zinc-300 tracking-wider">{sideLabel}</div>
        )}
      </div>
      {line !== null && line !== undefined && (
        <div className="text-[10px] font-bold text-zinc-400">
          {line > 0 ? `+${line}` : `${line}`}
        </div>
      )}
      <div className={`text-[11px] font-bold font-mono ${odds !== null ? (odds >= 0 ? "text-emerald-400" : "text-zinc-300") : "text-zinc-600"}`}>
        {odds !== null ? fmtOdds(odds) : "—"}
      </div>
    </button>
  );
}

function GameSelector({
  games, selectedId, onSelect, loading, sport, formDate,
}: {
  games:      SlateGame[];
  selectedId: number | null;
  onSelect:   (game: SlateGame) => void;
  loading:    boolean;
  sport:      string;
  formDate:   string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = games.find(g => g.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5">
        <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-zinc-500 text-sm">Loading slate…</span>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-500 text-sm">
        No {sport} games on {fmtDate(formDate)}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors text-left"
      >
        {selected ? (
          <>
            <img src={selected.awayLogo} alt={selected.awayTeam} className="w-5 h-5 object-contain shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <span className="font-bold text-white">{selected.awayTeam}</span>
            <span className="text-zinc-500">@</span>
            <img src={selected.homeLogo} alt={selected.homeTeam} className="w-5 h-5 object-contain shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <span className="font-bold text-white">{selected.homeTeam}</span>
            <span className="text-zinc-600 text-xs ml-1">{selected.gameTime} ET</span>
            {selected.status !== "scheduled" && (
              <span className="text-[10px] text-yellow-400 font-bold ml-1 uppercase">{selected.status}</span>
            )}
          </>
        ) : (
          <span className="text-zinc-500">Select game…</span>
        )}
        <ChevronDown size={14} className={`ml-auto text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {games.map(g => (
            <button type="button" key={g.id}
              onClick={() => { onSelect(g); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left ${g.id === selectedId ? "bg-emerald-500/10" : ""}`}
            >
              <img src={g.awayLogo} alt={g.awayTeam} className="w-6 h-6 object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="font-bold text-white text-sm w-8 shrink-0">{g.awayTeam}</span>
              <span className="text-zinc-600 text-xs">@</span>
              <img src={g.homeLogo} alt={g.homeTeam} className="w-6 h-6 object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="font-bold text-white text-sm w-8 shrink-0">{g.homeTeam}</span>
              <span className="text-zinc-500 text-xs ml-1">{g.gameTime} ET</span>
              {g.status !== "scheduled" && (
                <span className="text-[9px] font-bold text-yellow-400 uppercase ml-auto shrink-0">{g.status}</span>
              )}
              {g.odds?.awayMl && (
                <span className="text-[10px] text-zinc-600 ml-auto shrink-0 font-mono">
                  {fmtOdds(g.odds.awayMl.odds)} / {g.odds.homeMl ? fmtOdds(g.odds.homeMl.odds) : "—"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LinescoreGrid ────────────────────────────────────────────────────────────

function LinescoreGrid({
  ls, awayAbbrev, homeAbbrev,
}: {
  ls:          LinescoreEntry;
  awayAbbrev:  string;
  homeAbbrev:  string;
}) {
  // Always show 9 columns (innings 1-9), pad with null if game not complete
  const cols = Array.from({ length: 9 }, (_, i) => {
    const inn = ls.innings.find(x => x.num === i + 1);
    return inn ?? { num: i + 1, awayRuns: null, homeRuns: null };
  });

  const isLive  = ls.status === "Live";
  const isFinal = ls.status === "Final";

  function cellCls(runs: number | null, isCurrentInning: boolean): string {
    if (runs === null) return "text-zinc-700";
    if (isCurrentInning && isLive) return "text-emerald-300 font-bold";
    return "text-zinc-300";
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th className="text-[9px] text-zinc-600 font-medium text-left pr-2 pb-1 w-8">
              {/* Team abbrev column */}
            </th>
            {cols.map(c => (
              <th key={c.num} className={`text-[9px] font-bold pb-1 w-6 ${
                isLive && ls.currentInning === c.num ? "text-emerald-400" : "text-zinc-600"
              }`}>
                {c.num}
              </th>
            ))}
            <th className="text-[9px] font-bold text-zinc-400 pb-1 px-1">R</th>
            <th className="text-[9px] font-bold text-zinc-600 pb-1 px-1">H</th>
            <th className="text-[9px] font-bold text-zinc-600 pb-1 px-1">E</th>
          </tr>
        </thead>
        <tbody>
          {/* Away row */}
          <tr>
            <td className="text-[9px] font-bold text-zinc-400 text-left pr-2">{awayAbbrev}</td>
            {cols.map(c => (
              <td key={c.num} className={`text-[10px] font-mono ${cellCls(c.awayRuns, isLive && ls.currentInning === c.num)}`}>
                {c.awayRuns !== null ? c.awayRuns : (isFinal ? "0" : "·")}
              </td>
            ))}
            <td className="text-[11px] font-bold font-mono text-white px-1">
              {ls.awayR !== null ? ls.awayR : "—"}
            </td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">
              {ls.awayH !== null ? ls.awayH : "—"}
            </td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">
              {ls.awayE !== null ? ls.awayE : "—"}
            </td>
          </tr>
          {/* Home row */}
          <tr>
            <td className="text-[9px] font-bold text-zinc-400 text-left pr-2">{homeAbbrev}</td>
            {cols.map(c => (
              <td key={c.num} className={`text-[10px] font-mono ${cellCls(c.homeRuns, isLive && ls.currentInning === c.num)}`}>
                {c.homeRuns !== null ? c.homeRuns : (isFinal ? "0" : "·")}
              </td>
            ))}
            <td className="text-[11px] font-bold font-mono text-white px-1">
              {ls.homeR !== null ? ls.homeR : "—"}
            </td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">
              {ls.homeH !== null ? ls.homeH : "—"}
            </td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">
              {ls.homeE !== null ? ls.homeE : "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── BetCard ──────────────────────────────────────────────────────────────────

function BetCard({
  bet, stakeMode, unitSize, onResult, onDelete, onEdit, linescore,
}: {
  bet:        EnrichedBet;
  stakeMode:  StakeMode;
  unitSize:   number;
  onResult:   (id: number, result: Result) => void;
  onDelete:   (id: number) => void;
  onEdit:     (bet: TrackedBet) => void;
  linescore?: LinescoreEntry;
}) {
  const risk  = parseFloat(bet.risk);
  const toWin = parseFloat(bet.toWin);

  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  const tfShort = timeframeShort(bet.timeframe ?? "FULL_GAME");
  const result  = bet.result as Result;

  // ── Game state ──────────────────────────────────────────────────────────────
  // Priority order for game state detection:
  //   1. Bet is graded (result !== PENDING) → treat as Final (scores are in DB)
  //   2. Linescore status (most accurate for today's games)
  //   3. AN status (fallback)
  const isGraded   = bet.result !== "PENDING" && bet.result !== "VOID";
  const lsStatus   = linescore?.status ?? null;
  const anStatus   = bet.gameStatus ?? null;

  const isFinal    = isGraded || lsStatus === "Final" || anStatus === "complete";
  const isLive     = !isFinal && (lsStatus === "Live" || anStatus === "in_progress");

  // Scores:
  //   - Graded bets: use DB-stored awayScore/homeScore (authoritative, always present)
  //   - Live bets: use linescore totals (real-time)
  //   - Upcoming: no scores
  const dbAwayScore = bet.awayScore !== null && bet.awayScore !== undefined
    ? parseFloat(String(bet.awayScore))
    : null;
  const dbHomeScore = bet.homeScore !== null && bet.homeScore !== undefined
    ? parseFloat(String(bet.homeScore))
    : null;

  const awayR = isGraded
    ? dbAwayScore
    : (linescore?.awayR ?? dbAwayScore);
  const homeR = isGraded
    ? dbHomeScore
    : (linescore?.homeR ?? dbHomeScore);
  const hasScore = awayR !== null && homeR !== null;

  // Inning indicator for live games
  const currentInning = linescore?.currentInning ?? null;
  const inningState   = linescore?.inningState ?? null;
  const inningLabel   = currentInning
    ? `${inningState === "Top" ? "▲" : inningState === "Bottom" ? "▼" : ""}${currentInning}`
    : null;

  // ── Pick display ────────────────────────────────────────────────────────────
  // For RL bets, pick string already has the line embedded (e.g. "SF RL +1.5")
  // Don't show a separate line badge in that case
  const pickIsAway = bet.pickSide === "AWAY";
  const pickIsHome = bet.pickSide === "HOME";

  // Market label
  const mktLabel = bet.market === "ML" ? "ML"
    : bet.market === "RL" ? (bet.sport === "NHL" ? "PL" : "RL")
    : "TOT";

  // Away/home abbreviations (for display only)
  const awayAbbrev = linescore?.awayAbbrev || bet.awayTeam || "AWY";
  const homeAbbrev = linescore?.homeAbbrev || bet.homeTeam || "HME";

  return (
    <div className={`relative bg-zinc-900/90 border rounded-xl overflow-hidden transition-all ${
      result === "WIN"  ? "border-green-500/30" :
      result === "LOSS" ? "border-red-500/25" :
      result === "PUSH" ? "border-yellow-500/25" :
      "border-zinc-800"
    }`}>
      {/* Result accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
        result === "WIN"  ? "bg-green-500" :
        result === "LOSS" ? "bg-red-500" :
        result === "PUSH" ? "bg-yellow-500" :
        result === "PENDING" ? "bg-zinc-700" :
        "bg-zinc-800"
      }`} />

      <div className="pl-4 pr-3 pt-3 pb-3 space-y-3">

        {/* ── Row 1: Matchup header with large logos ── */}
        <div className="flex items-center gap-3">
          {/* Away team */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            {bet.awayLogo ? (
              <img src={bet.awayLogo} alt={bet.awayTeam ?? ""} className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                <span className="text-[9px] font-bold text-zinc-500">{(bet.awayTeam ?? "?").slice(0, 3)}</span>
              </div>
            )}
            <span className="text-[9px] font-bold text-zinc-400 tracking-wider">{bet.awayTeam ?? "?"}</span>
          </div>

          {/* Center: score / status / time */}
          <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
            {/* Date + sport */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] tracking-widest text-zinc-600 uppercase">{bet.sport}</span>
              <span className="text-zinc-700 text-[9px]">·</span>
              <span className="text-[9px] text-zinc-600">{fmtDate(bet.gameDate)}</span>
            </div>

            {/* Score / Time / Live indicator */}
            {isFinal && hasScore ? (
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-black font-mono ${
                    pickIsAway ? (result === "WIN" ? "text-green-400" : result === "LOSS" ? "text-red-400" : "text-white") : "text-zinc-300"
                  }`}>{awayR}</span>
                  <span className="text-zinc-600 text-sm font-bold">-</span>
                  <span className={`text-xl font-black font-mono ${
                    pickIsHome ? (result === "WIN" ? "text-green-400" : result === "LOSS" ? "text-red-400" : "text-white") : "text-zinc-300"
                  }`}>{homeR}</span>
                </div>
                <span className="text-[9px] font-bold text-zinc-500 tracking-widest uppercase">Final</span>
              </div>
            ) : isLive && hasScore ? (
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black font-mono text-white">{awayR}</span>
                  <span className="text-zinc-600 text-sm font-bold">-</span>
                  <span className="text-xl font-black font-mono text-white">{homeR}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] font-bold text-emerald-400 tracking-widest uppercase">
                    {inningLabel ? `${inningLabel} INN` : "LIVE"}
                  </span>
                </div>
              </div>
            ) : isLive ? (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-bold text-emerald-400 tracking-widest uppercase">
                  {inningLabel ? `${inningLabel} INN` : "LIVE"}
                </span>
              </div>
            ) : (
              /* Upcoming */
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm font-bold text-zinc-400">
                  {fmtStartTime(bet.startUtc, bet.gameTime) || "—"}
                </span>
                <span className="text-[9px] text-zinc-600 tracking-widest uppercase">Start Time</span>
              </div>
            )}
          </div>

          {/* Home team */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            {bet.homeLogo ? (
              <img src={bet.homeLogo} alt={bet.homeTeam ?? ""} className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                <span className="text-[9px] font-bold text-zinc-500">{(bet.homeTeam ?? "?").slice(0, 3)}</span>
              </div>
            )}
            <span className="text-[9px] font-bold text-zinc-400 tracking-wider">{bet.homeTeam ?? "?"}</span>
          </div>

          {/* Edit/Delete */}
          <div className="flex flex-col gap-1 shrink-0 ml-1">
            <button type="button" onClick={() => onEdit(bet)}
              className="p-1.5 rounded-lg text-zinc-700 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
              title="Edit bet"
            >
              <Pencil size={11} />
            </button>
            <button type="button" onClick={() => onDelete(bet.id)}
              className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-all"
              title="Delete bet"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {/* ── Row 2: Pick + Bet Details ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {/* Pick team logo highlight */}
            {(pickIsAway && bet.awayLogo) && (
              <img src={bet.awayLogo} alt="" className="w-4 h-4 object-contain opacity-80" />
            )}
            {(pickIsHome && bet.homeLogo) && (
              <img src={bet.homeLogo} alt="" className="w-4 h-4 object-contain opacity-80" />
            )}
            {/* Pick label */}
            <span className="text-white font-bold text-sm">{bet.pick}</span>
            {/* Market badge */}
            <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium tracking-wider">{mktLabel}</span>
            {/* Timeframe badge */}
            {tfShort && (
              <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-medium">{tfShort}</span>
            )}
            {/* Odds */}
            <span className={`text-[11px] font-bold font-mono ${
              bet.odds >= 0 ? "text-emerald-400" : "text-zinc-300"
            }`}>
              {fmtOdds(bet.odds)}
            </span>
          </div>

          {/* Result badge */}
          <span className={`px-2 py-1 rounded-lg text-[9px] font-bold border shrink-0 ${resultBg(result)}`}>
            {result}
          </span>
        </div>

        {/* ── Row 4: Stake + P/L + Quick result buttons ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">Risk</div>
              <div className="text-xs font-mono text-zinc-300">{fmtStake(risk)}</div>
            </div>
            <div className="text-zinc-700 text-xs">→</div>
            <div className="text-center">
              <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">To Win</div>
              <div className="text-xs font-mono text-emerald-400">{fmtStake(toWin)}</div>
            </div>
            {result !== "PENDING" && result !== "VOID" && (
              <>
                <div className="text-zinc-700 text-xs">→</div>
                <div className="text-center">
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">P/L</div>
                  <div className={`text-xs font-mono font-bold ${resultColor(result)}`}>
                    {result === "WIN"  ? `+${fmtStake(toWin)}`
                     : result === "LOSS" ? `-${fmtStake(risk)}`
                     : result === "PUSH" ? "PUSH"
                     : "—"}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick result buttons */}
          <div className="flex items-center gap-1">
            {(["WIN", "LOSS", "PUSH"] as const).map(r => (
              <button key={r} type="button"
                onClick={() => onResult(bet.id, r)}
                className={`px-2 py-1 rounded-lg text-[9px] font-bold tracking-wider transition-all border ${
                  result === r
                    ? resultBg(r)
                    : "border-zinc-800 text-zinc-700 hover:border-zinc-600 hover:text-zinc-400"
                }`}
              >
                {r === "WIN" ? "W" : r === "LOSS" ? "L" : "P"}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        {bet.notes && (
          <div className="text-[10px] text-zinc-500 bg-zinc-800/40 rounded-lg px-3 py-1.5 italic">
            {bet.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BetTracker() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading } = useAppAuth();

  useEffect(() => {
    if (!authLoading && !appUser) navigate("/");
  }, [authLoading, appUser, navigate]);

  const role      = appUser?.role ?? "user";
  const canAccess = ["owner", "admin", "handicapper"].includes(role);
  const isOwnerOrAdmin = role === "owner" || role === "admin";

  // ── Stake mode ────────────────────────────────────────────────────────────
  const [stakeMode, setStakeMode] = useState<StakeMode>(() => {
    try { return (localStorage.getItem("bt_stakeMode") as StakeMode) || "$"; } catch { return "$"; }
  });
  const [unitSize, setUnitSize] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem("bt_unitSize") || "100"); } catch { return 100; }
  });

  useEffect(() => { try { localStorage.setItem("bt_stakeMode", stakeMode); } catch {} }, [stakeMode]);
  useEffect(() => { try { localStorage.setItem("bt_unitSize", String(unitSize)); } catch {} }, [unitSize]);

  // ── Handicapper selector + analytics state ────────────────────────────────
  const [targetUserId, setTargetUserId]   = useState<number | undefined>(undefined);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [filterAllTime, setFilterAllTime] = useState(false);

  const effectiveUserId = isOwnerOrAdmin && targetUserId ? targetUserId : undefined;

  // ── Sport / filter state ──────────────────────────────────────────────────
  const [activeSport, setActiveSport]   = useState<Sport>("MLB");
  const [filterDate, setFilterDate]     = useState(todayEst);
  const [filterResult, setFilterResult] = useState<Result | "">("");

  // ── Form state ────────────────────────────────────────────────────────────
  const [formDate, setFormDate]           = useState(todayEst);
  const [formGame, setFormGame]           = useState<SlateGame | null>(null);
  const [formTimeframe, setFormTimeframe] = useState<Timeframe>("FULL_GAME");
  const [formMarket, setFormMarket]       = useState<Market>("ML");
  const [formPickSide, setFormPickSide]   = useState<PickSide>("AWAY");
  const [formOdds, setFormOdds]           = useState("");
  const [formRisk, setFormRisk]           = useState("2");
  const [formNotes, setFormNotes]         = useState("");
  const [formError, setFormError]         = useState("");

  // Edit / delete modal
  const [editBet, setEditBet]       = useState<TrackedBet | null>(null);
  const [editNotes, setEditNotes]   = useState("");
  const [editResult, setEditResult] = useState<Result>("PENDING");
  const [deleteId, setDeleteId]     = useState<number | null>(null);

  // Auto-grade toast
  const [gradeToast, setGradeToast] = useState<{ graded: number; wins: number; losses: number; pushes: number; stillPending: number } | null>(null);

  // ── Derived values ────────────────────────────────────────────────────────
  const oddsNum = parseInt(formOdds, 10);
  const riskNum = parseFloat(formRisk);

  const toWinCalc = useMemo(() => {
    if (!isNaN(oddsNum) && oddsNum !== 0 && !isNaN(riskNum) && riskNum > 0) {
      return calcToWin(oddsNum, riskNum);
    }
    return null;
  }, [oddsNum, riskNum]);

  const riskLabel  = stakeMode === "$" ? "Risk $" : "Risk (u)";
  const toWinLabel = stakeMode === "$" ? "To Win $" : "To Win (u)";

  function fmtToWin(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(n);
  }

  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  const timeframeOptions = TIMEFRAMES_BY_SPORT[activeSport];

  useEffect(() => { setFormTimeframe("FULL_GAME"); }, [activeSport]);
  useEffect(() => { setFormGame(null); setFormPickSide("AWAY"); setFormOdds(""); }, [formDate, activeSport]);

  // NRFI/YRFI: auto-set market=TOTAL and pickSide when timeframe changes
  useEffect(() => {
    if (formTimeframe === "NRFI") {
      setFormMarket("TOTAL");
      setFormPickSide("UNDER");
    } else if (formTimeframe === "YRFI") {
      setFormMarket("TOTAL");
      setFormPickSide("OVER");
    }
  }, [formTimeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const newSide: PickSide = formMarket === "TOTAL" ? "OVER" : "AWAY";
    setFormPickSide(newSide);
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, newSide);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formMarket]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, formPickSide);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formGame, formMarket, formPickSide]);

  // ── tRPC ──────────────────────────────────────────────────────────────────
  const slateQuery = trpc.betTracker.getSlate.useQuery(
    { sport: activeSport, gameDate: formDate },
    { enabled: canAccess, staleTime: 4 * 60 * 1000, retry: 1 }
  );

  const listQuery = trpc.betTracker.list.useQuery(
    {
      sport:        filterAllTime ? undefined : activeSport,
      gameDate:     filterAllTime ? undefined : (filterDate || undefined),
      result:       filterResult || undefined,
      targetUserId: effectiveUserId,
    },
    { enabled: canAccess }
  );

  const statsQuery = trpc.betTracker.getStats.useQuery(
    {
      sport:        filterAllTime ? undefined : activeSport,
      gameDate:     filterAllTime ? undefined : (filterDate || undefined),
      targetUserId: effectiveUserId,
    },
    { enabled: canAccess }
  );

  const handicappersQuery = trpc.betTracker.listHandicappers.useQuery(
    undefined,
    { enabled: canAccess && isOwnerOrAdmin }
  );

  // ── Linescore query (MLB only) ─────────────────────────────────────────────
  // Collect unique MLB dates from the current bet list
  const enrichedBets = (listQuery.data ?? []) as EnrichedBet[];
  const mlbDates = useMemo(() => {
    const dates = new Set<string>();
    for (const b of enrichedBets) {
      if (b.sport === "MLB") dates.add(b.gameDate);
    }
    return Array.from(dates).sort();
  }, [enrichedBets]);

  const linescoreQuery = trpc.betTracker.getLinescores.useQuery(
    { sport: "MLB", dates: mlbDates },
    {
      enabled: canAccess && mlbDates.length > 0,
      staleTime: 30_000,          // 30s — refresh frequently for live games
      refetchInterval: 60_000,    // poll every 60s automatically
      retry: 1,
    }
  );

  // Map gamePk → LinescoreEntry for O(1) lookup in BetCard
  // We also need to match by awayAbbrev+homeAbbrev since bets don't store gamePk
  const linescoreByTeams = useMemo(() => {
    const map = new Map<string, LinescoreEntry>();
    if (!linescoreQuery.data) return map;
    for (const ls of Object.values(linescoreQuery.data)) {
      const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}`;
      map.set(key, ls);
    }
    return map;
  }, [linescoreQuery.data]);

  const utils = trpc.useUtils();
  const invalidate = useCallback(() => {
    utils.betTracker.list.invalidate();
    utils.betTracker.getStats.invalidate();
  }, [utils]);

  const createMut    = trpc.betTracker.create.useMutation({ onSuccess: invalidate });
  const updateMut    = trpc.betTracker.update.useMutation({ onSuccess: invalidate });
  const deleteMut    = trpc.betTracker.delete.useMutation({ onSuccess: invalidate });
  const autoGradeMut = trpc.betTracker.autoGrade.useMutation({
    onSuccess: (data) => {
      console.log(`[BetTracker][OUTPUT] autoGrade: graded=${data.graded} wins=${data.wins} losses=${data.losses} pushes=${data.pushes} stillPending=${data.stillPending}`);
      invalidate();
      setGradeToast(data);
      setTimeout(() => setGradeToast(null), 6000);
    },
    onError: (err) => {
      console.log(`[BetTracker][ERROR] autoGrade: ${err.message}`);
    },
  });

  // ── Real-time auto-grade polling ───────────────────────────────────────────
  // Poll every 60s when any bet is PENDING. Fire immediately when linescore
  // transitions to "Final" for a game that has a PENDING bet.
  const prevLinescoreRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!canAccess) return;

    const pendingBets = enrichedBets.filter(b => b.result === "PENDING");
    if (pendingBets.length === 0) return;

    // Check if any game just went Final (status transition)
    if (linescoreQuery.data) {
      let newFinalFound = false;
      for (const ls of Object.values(linescoreQuery.data)) {
        const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}`;
        const prev = prevLinescoreRef.current[key];
        if (ls.status === "Final" && prev && prev !== "Final") {
          // A game just went Final — check if we have a PENDING bet on it
          const hasPending = pendingBets.some(b =>
            b.gameDate === ls.gameDate &&
            (b.awayTeam === ls.awayAbbrev || b.homeTeam === ls.homeAbbrev)
          );
          if (hasPending) {
            console.log(`[BetTracker][STATE] autoGrade: game ${ls.awayAbbrev}@${ls.homeAbbrev} just went Final — firing immediate grade`);
            newFinalFound = true;
          }
        }
        prevLinescoreRef.current[key] = ls.status;
      }
      if (newFinalFound && !autoGradeMut.isPending) {
        autoGradeMut.mutate({});
      }
    }

    // Set up 60s polling interval
    const interval = setInterval(() => {
      if (!autoGradeMut.isPending) {
        console.log(`[BetTracker][STEP] autoGrade: 60s poll — grading ${pendingBets.length} PENDING bets`);
        autoGradeMut.mutate({});
      }
    }, 60_000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedBets, linescoreQuery.data, canAccess]);

  // ── Game selection ────────────────────────────────────────────────────────
  const slateGames = (slateQuery.data ?? []) as SlateGame[];

  const handleGameSelect = useCallback((game: SlateGame) => {
    console.log(`[BetTracker][INPUT] game selected: id=${game.id} ${game.awayTeam}@${game.homeTeam}`);
    setFormGame(game);
    setFormPickSide("AWAY");
    const o = getPickOdds(game.odds, formMarket, "AWAY");
    setFormOdds(o !== null ? String(o) : "");
  }, [formMarket]);

  const handlePickSide = useCallback((side: PickSide) => {
    setFormPickSide(side);
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, side);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formGame, formMarket]);

  const pickButtons = useMemo(() => {
    if (!formGame) return null;
    const { odds, awayTeam, homeTeam, awayLogo, homeLogo, awayNickname, homeNickname } = formGame;

    if (formMarket === "TOTAL") {
      return (
        <div className="flex gap-2">
          <PickButton selected={formPickSide === "OVER"} onClick={() => handlePickSide("OVER")}
            odds={odds?.over?.odds ?? null} line={getPickLine(odds, "TOTAL", "OVER")} side="OVER" />
          <PickButton selected={formPickSide === "UNDER"} onClick={() => handlePickSide("UNDER")}
            odds={odds?.under?.odds ?? null} line={getPickLine(odds, "TOTAL", "UNDER")} side="UNDER" />
        </div>
      );
    }

    const awayOdds = formMarket === "ML" ? (odds?.awayMl?.odds ?? null) : (odds?.awayRl?.odds ?? null);
    const homeOdds = formMarket === "ML" ? (odds?.homeMl?.odds ?? null) : (odds?.homeRl?.odds ?? null);
    const awayLine = formMarket === "RL" ? (odds?.awayRl?.value ?? null) : null;
    const homeLine = formMarket === "RL" ? (odds?.homeRl?.value ?? null) : null;

    return (
      <div className="flex gap-2">
        <PickButton selected={formPickSide === "AWAY"} onClick={() => handlePickSide("AWAY")}
          logo={awayLogo} teamAbbr={awayTeam} teamNickname={awayNickname}
          odds={awayOdds} line={awayLine} side="AWAY" />
        <PickButton selected={formPickSide === "HOME"} onClick={() => handlePickSide("HOME")}
          logo={homeLogo} teamAbbr={homeTeam} teamNickname={homeNickname}
          odds={homeOdds} line={homeLine} side="HOME" />
      </div>
    );
  }, [formGame, formMarket, formPickSide, handlePickSide]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setFormError("");
    if (!formGame) { setFormError("Select a game from the slate."); return; }
    if (isNaN(oddsNum) || oddsNum === 0) { setFormError("Enter valid American odds (e.g. -110, +145)."); return; }
    if (isNaN(riskNum) || riskNum <= 0)  { setFormError(`Enter a valid ${stakeMode === "U" ? "unit" : "dollar"} amount.`); return; }

    const riskDollars  = stakeMode === "U" ? riskNum * unitSize : riskNum;
    const toWinDollars = stakeMode === "U" ? (toWinCalc ?? 0) * unitSize : (toWinCalc ?? calcToWin(oddsNum, riskNum));

    // NRFI/YRFI: enforce market=TOTAL, line=0.5, and correct pickSide
    // These are fixed by definition — not user-configurable
    let effectiveMarket   = formMarket;
    let effectivePickSide = formPickSide;
    let linePick: number | undefined = undefined;

    if (formTimeframe === "NRFI") {
      effectiveMarket   = "TOTAL";
      effectivePickSide = "UNDER";
      linePick          = 0.5;
      console.log(`[BetTracker][STATE] NRFI bet: enforcing market=TOTAL pickSide=UNDER line=0.5`);
    } else if (formTimeframe === "YRFI") {
      effectiveMarket   = "TOTAL";
      effectivePickSide = "OVER";
      linePick          = 0.5;
      console.log(`[BetTracker][STATE] YRFI bet: enforcing market=TOTAL pickSide=OVER line=0.5`);
    } else if (formGame?.odds) {
      const lv = getPickLine(formGame.odds, effectiveMarket, effectivePickSide);
      if (lv !== null && lv !== undefined) linePick = Math.abs(lv);
    }

    await createMut.mutateAsync({
      anGameId:  formGame.id,
      sport:     activeSport,
      gameDate:  formDate,
      awayTeam:  formGame.awayTeam,
      homeTeam:  formGame.homeTeam,
      timeframe: formTimeframe,
      market:    effectiveMarket,
      pickSide:  effectivePickSide,
      odds:      oddsNum,
      risk:      riskDollars,
      toWin:     toWinDollars,
      line:      linePick,
      notes:     formNotes || undefined,
    });

    setFormGame(null);
    setFormTimeframe("FULL_GAME");
    setFormMarket("ML");
    setFormPickSide("AWAY");
    setFormOdds("");
    setFormRisk("2");
    setFormNotes("");
  };

  const handleResult = async (id: number, result: Result) => {
    await updateMut.mutateAsync({ id, result });
  };

  const handleEditSave = async () => {
    if (!editBet) return;
    await updateMut.mutateAsync({ id: editBet.id, notes: editNotes, result: editResult });
    setEditBet(null);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = (statsQuery.data ?? {
    totalBets: 0, wins: 0, losses: 0, pushes: 0, pending: 0,
    totalRisk: 0, netProfit: 0, roi: 0,
    bestWin: 0, worstLoss: 0,
    byType: [], bySize: [], byMonth: [], bySport: [], byResult: [], byTimeframe: [],
    equityCurve: [],
  }) as StatsData;

  // ── Bet list with day separators ──────────────────────────────────────────
  const bets = listQuery.data ?? [];

  const betsWithSeparators = useMemo(() => {
    const result: Array<{ type: "separator"; date: string; wins: number; losses: number; pushes: number; pending: number } | { type: "bet"; bet: EnrichedBet }> = [];
    let lastDate = "";
    for (const bet of enrichedBets) {
      const d = bet.gameDate ?? "";
      if (d !== lastDate) {
        const dayBets = enrichedBets.filter(b => b.gameDate === d);
        const wins    = dayBets.filter(b => b.result === "WIN").length;
        const losses  = dayBets.filter(b => b.result === "LOSS").length;
        const pushes  = dayBets.filter(b => b.result === "PUSH").length;
        const pending = dayBets.filter(b => b.result === "PENDING").length;
        result.push({ type: "separator", date: d, wins, losses, pushes, pending });
        lastDate = d;
      }
      result.push({ type: "bet", bet });
    }
    return result;
  }, [enrichedBets]);

  // ── Access guard ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <AlertCircle className="mx-auto text-red-400" size={32} />
          <p className="text-white font-bold">Access Restricted</p>
          <p className="text-zinc-500 text-sm">Bet Tracker is available to Handicappers, Admins, and Owners only.</p>
          <button type="button" onClick={() => navigate("/")} className="text-emerald-400 text-sm underline">Go back</button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate("/")} className="text-zinc-500 hover:text-white transition-colors p-1">
              <ChevronLeft size={18} />
            </button>
            <TrendingUp size={18} className="text-emerald-400" />
            <span className="font-bold tracking-wider text-sm sm:text-base">BET TRACKER</span>
          </div>

          <div className="flex items-center gap-2">
            {/* $ / Units toggle */}
            <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
              <button type="button" onClick={() => setStakeMode("$")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${stakeMode === "$" ? "bg-emerald-500 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                <DollarSign size={11} />$
              </button>
              <button type="button" onClick={() => setStakeMode("U")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${stakeMode === "U" ? "bg-emerald-500 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                <Hash size={11} />U
              </button>
            </div>
            {/* Unit size (only in U mode) */}
            {stakeMode === "U" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-zinc-500">1u=$</span>
                <input
                  type="number"
                  value={unitSize}
                  onChange={e => setUnitSize(parseFloat(e.target.value) || 100)}
                  className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  min={1}
                />
              </div>
            )}
            {/* Analytics toggle */}
            <button
              type="button"
              onClick={() => setShowAnalytics(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                showAnalytics
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
              }`}
              title="Toggle Analytics Panel"
            >
              <BarChart2 size={13} />
              <span className="hidden sm:inline">Analytics</span>
            </button>
            {/* Role badge */}
            <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full border uppercase ${
              role === "owner"      ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              : role === "admin"    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            }`}>
              {appUser?.username ?? role}
            </span>
          </div>
        </div>

        {/* Sport tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 pb-0">
          {SPORTS.map(s => (
            <button type="button" key={s}
              onClick={() => setActiveSport(s)}
              className={`px-4 py-2.5 text-xs font-bold tracking-wider transition-all border-b-2 ${
                activeSport === s ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900/50 border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-3">

          {/* Handicapper selector + All-time toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {isOwnerOrAdmin && (handicappersQuery.data?.length ?? 0) > 0 && (
              <HandicapperSelector
                handicappers={handicappersQuery.data ?? []}
                selectedId={targetUserId}
                onSelect={setTargetUserId}
                currentUserId={appUser!.id}
              />
            )}
            <button
              type="button"
              onClick={() => setFilterAllTime(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                filterAllTime
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              All-Time
            </button>
            {statsQuery.isLoading && (
              <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Stat cards row */}
          <div className="grid grid-cols-4 sm:grid-cols-9 gap-2">
            <StatCard label="Total"   value={stats.totalBets} />
            <StatCard label="Wins"    value={stats.wins}   color="text-green-400" />
            <StatCard label="Losses"  value={stats.losses} color="text-red-400" />
            <StatCard label="Pushes"  value={stats.pushes} color="text-yellow-400" />
            <div className="hidden sm:block">
              <StatCard label="Pending" value={stats.pending} color="text-zinc-400" />
            </div>
            <div className="hidden sm:block">
              <StatCard
                label="Net P/L"
                value={fmtStake(stats.netProfit)}
                color={stats.netProfit >= 0 ? "text-green-400" : "text-red-400"}
              />
            </div>
            <div className="hidden sm:block">
              <StatCard
                label="ROI"
                value={`${stats.roi}%`}
                color={stats.roi >= 0 ? "text-green-400" : "text-red-400"}
                sub={`on ${fmtStake(stats.totalRisk)} risked`}
              />
            </div>
            <div className="hidden sm:block">
              <StatCard
                label="Best Win"
                value={stats.bestWin > 0 ? `+${fmtStake(stats.bestWin)}` : "—"}
                color="text-green-400"
              />
            </div>
            <div className="hidden sm:block">
              <StatCard
                label="Worst L"
                value={stats.worstLoss > 0 ? `-${fmtStake(stats.worstLoss)}` : "—"}
                color="text-red-400"
              />
            </div>
          </div>

          {/* Mobile: P/L + ROI on second row */}
          <div className="grid grid-cols-2 gap-2 mt-2 sm:hidden">
            <StatCard
              label="Net P/L"
              value={fmtStake(stats.netProfit)}
              color={stats.netProfit >= 0 ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="ROI"
              value={`${stats.roi}%`}
              color={stats.roi >= 0 ? "text-green-400" : "text-red-400"}
              sub={`on ${fmtStake(stats.totalRisk)} risked`}
            />
          </div>
        </div>
      </div>

      {/* ── Analytics Panel ────────────────────────────────────────────────── */}
      {showAnalytics && (
        <div className="bg-zinc-900/30 border-b border-zinc-800/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-emerald-400" />
                <span className="text-xs font-bold tracking-widest text-zinc-400 uppercase">Equity Curve</span>
                <span className="text-[10px] text-zinc-600 ml-1">
                  {filterAllTime ? "All-Time" : `${activeSport} · ${filterDate ? fmtDate(filterDate) : "All Dates"}`}
                </span>
              </div>
              <EquityChart points={stats.equityCurve} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={14} className="text-emerald-400" />
                <span className="text-xs font-bold tracking-widest text-zinc-400 uppercase">Breakdowns</span>
              </div>
              <BreakdownGrid stats={stats} />
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6">

          {/* ── Add Bet Form ──────────────────────────────────────────────── */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-4 h-fit">
            <div className="flex items-center gap-2 pb-1 border-b border-zinc-800">
              <Plus size={15} className="text-emerald-400" />
              <h2 className="font-bold text-sm tracking-wider">ADD BET</h2>
            </div>

            {/* DATE */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Date</label>
              <input
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* GAME */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Game</label>
              <GameSelector
                games={slateGames}
                selectedId={formGame?.id ?? null}
                onSelect={handleGameSelect}
                loading={slateQuery.isLoading}
                sport={activeSport}
                formDate={formDate}
              />
            </div>

            {/* TIMEFRAME */}
            <SelectField
              label="Timeframe"
              value={formTimeframe}
              onChange={v => setFormTimeframe(v as Timeframe)}
              options={timeframeOptions}
            />

            {/* MARKET — hidden for NRFI/YRFI (auto-set to TOTAL) */}
            {formTimeframe !== "NRFI" && formTimeframe !== "YRFI" && (
              <SelectField
                label={`Market — ${MARKET_LABELS[activeSport][formMarket]}`}
                value={formMarket}
                onChange={v => setFormMarket(v as Market)}
                options={(["ML", "RL", "TOTAL"] as Market[]).map(m => ({
                  value: m,
                  label: MARKET_LABELS[activeSport][m],
                }))}
              />
            )}

            {/* NRFI/YRFI locked info banner */}
            {(formTimeframe === "NRFI" || formTimeframe === "YRFI") && (
              <div className="flex items-start gap-2 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2.5">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-zinc-300 leading-relaxed">
                  <span className="font-bold text-emerald-400">{formTimeframe}</span>
                  {formTimeframe === "NRFI"
                    ? " — No Run First Inning. Auto-set: TOTAL UNDER 0.5 runs in inning 1. WIN if neither team scores in the 1st."
                    : " — Yes Run First Inning. Auto-set: TOTAL OVER 0.5 runs in inning 1. WIN if either team scores in the 1st."}
                </div>
              </div>
            )}

            {/* PICK — hidden for NRFI/YRFI (auto-set) */}
            {formTimeframe !== "NRFI" && formTimeframe !== "YRFI" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Pick</label>
                {formGame ? (
                  pickButtons
                ) : (
                  <div className="flex gap-2">
                    {(formMarket === "TOTAL" ? ["OVER", "UNDER"] : ["AWAY", "HOME"]).map(s => (
                      <div key={s} className="flex-1 flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 border-zinc-800 bg-zinc-900/50 opacity-40">
                        <div className="w-8 h-8 rounded-full bg-zinc-800" />
                        <div className="text-[10px] text-zinc-600 font-bold">{s}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ODDS + RISK + TO WIN */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Odds</label>
                <input
                  type="number"
                  value={formOdds}
                  onChange={e => setFormOdds(e.target.value)}
                  placeholder="-110"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">{riskLabel}</label>
                <input
                  type="number"
                  value={formRisk}
                  onChange={e => setFormRisk(e.target.value)}
                  placeholder={stakeMode === "U" ? "2" : "200"}
                  min={0}
                  step={stakeMode === "U" ? "0.5" : "10"}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">{toWinLabel}</label>
                <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm font-mono text-emerald-400 min-h-[42px] flex items-center">
                  {toWinCalc !== null
                    ? fmtToWin(toWinCalc)
                    : <span className="text-zinc-600"><Minus size={12} /></span>
                  }
                </div>
              </div>
            </div>

            {/* Unit math explainer */}
            {stakeMode === "U" && toWinCalc !== null && riskNum > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-2">
                <Hash size={10} className="text-emerald-400 shrink-0" />
                <span>
                  {fmtUnits(riskNum)} to win {fmtUnits(toWinCalc)}
                  {unitSize > 0 && (
                    <span className="text-zinc-600 ml-1">
                      ({fmtDollar(riskNum * unitSize)} to win {fmtDollar(toWinCalc * unitSize)})
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* NOTES */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Notes (optional)</label>
              <textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Model edge, reasoning, context…"
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder:text-zinc-600"
              />
            </div>

            {/* Error */}
            {formError && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle size={13} />
                {formError}
              </div>
            )}

            {/* Submit */}
            <button type="button" onClick={handleSubmit}
              disabled={createMut.isPending || !formGame}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm tracking-wider transition-all"
            >
              {createMut.isPending ? "Saving…" : "TRACK BET"}
            </button>
          </div>

          {/* ── Bets List ─────────────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="flex items-center gap-3 flex-wrap">
              {!filterAllTime && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Filter Date</label>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Result</label>
                <div className="relative">
                  <select
                    value={filterResult}
                    onChange={e => setFilterResult(e.target.value as Result | "")}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
                  >
                    <option value="">All Results</option>
                    {RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2 self-end pb-2">
                <span className="text-xs text-zinc-500">{bets.length} bet{bets.length !== 1 ? "s" : ""}</span>
                {/* Linescore refresh indicator */}
                {linescoreQuery.isFetching && (
                  <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" title="Refreshing linescores…" />
                )}
                <button type="button" onClick={() => {
                    autoGradeMut.mutate({ sport: activeSport, gameDate: filterAllTime ? undefined : (filterDate || undefined) });
                  }}
                  disabled={autoGradeMut.isPending || enrichedBets.filter(b => b.result === "PENDING").length === 0}
                  title="Auto-grade all pending bets using official league scores"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold tracking-wider hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {autoGradeMut.isPending
                    ? <><RefreshCw size={11} className="animate-spin" /> Grading…</>
                    : <><Zap size={11} /> GRADE BETS</>}
                </button>
              </div>
            </div>

            {/* Bet cards with day separators */}
            {listQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : bets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <Clock size={28} className="text-zinc-700" />
                <p className="text-zinc-500 text-sm">
                  {filterAllTime
                    ? "No bets tracked yet."
                    : `No bets tracked yet for ${activeSport} on ${fmtDate(filterDate)}.`}
                </p>
                <p className="text-zinc-600 text-xs">Use the form to add your first bet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {betsWithSeparators.map((item, idx) => {
                  if (item.type === "separator") {
                    const record = `${item.wins}W-${item.losses}L${item.pushes > 0 ? `-${item.pushes}P` : ""}${item.pending > 0 ? ` (${item.pending} pending)` : ""}`;
                    return (
                      <div key={`sep-${item.date}-${idx}`} className="flex items-center gap-3 py-2">
                        <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                          {item.date ? fmtDate(item.date) : "Unknown Date"}
                        </div>
                        <div className="flex-1 h-px bg-zinc-800" />
                        <div className="text-[10px] font-mono text-zinc-600">{record}</div>
                      </div>
                    );
                  }
                  // Look up linescore for this bet (MLB only)
                  const ls = item.bet.sport === "MLB"
                    ? linescoreByTeams.get(`${item.bet.gameDate}:${item.bet.awayTeam}:${item.bet.homeTeam}`) ?? undefined
                    : undefined;
                  return (
                    <BetCard
                      key={item.bet.id}
                      bet={item.bet}
                      stakeMode={stakeMode}
                      unitSize={unitSize}
                      onResult={handleResult}
                      onDelete={id => setDeleteId(id)}
                      onEdit={b => { setEditBet(b); setEditNotes(b.notes ?? ""); setEditResult(b.result as Result); }}
                      linescore={ls}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {editBet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider">EDIT BET</h3>
            <div className="text-xs text-zinc-400">{editBet.pick} · {fmtOdds(editBet.odds)}</div>
            <SelectField
              label="Result"
              value={editResult}
              onChange={v => setEditResult(v as Result)}
              options={RESULTS.map(r => ({ value: r, label: r }))}
            />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Notes</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditBet(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleEditSave}
                disabled={updateMut.isPending}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold transition-colors disabled:opacity-40"
              >
                {updateMut.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Grade toast ─────────────────────────────────────────────────────── */}
      {gradeToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-emerald-500/40 rounded-2xl shadow-2xl p-4 w-72 animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-emerald-400" />
            <span className="text-sm font-bold text-white tracking-wider">BETS GRADED</span>
            <button type="button" onClick={() => setGradeToast(null)} className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors">
              <Minus size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-zinc-800 rounded-lg px-3 py-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Graded</div>
              <div className="text-white font-bold">{gradeToast.graded}</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Wins</div>
              <div className="text-green-400 font-bold">{gradeToast.wins}</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Losses</div>
              <div className="text-red-400 font-bold">{gradeToast.losses}</div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Pushes</div>
              <div className="text-yellow-400 font-bold">{gradeToast.pushes}</div>
            </div>
          </div>
          {gradeToast.stillPending > 0 && (
            <div className="mt-2 text-[10px] text-zinc-500 text-center">
              {gradeToast.stillPending} bet{gradeToast.stillPending !== 1 ? "s" : ""} still pending (game not final)
            </div>
          )}
        </div>
      )}

      {/* ── Delete confirm modal ────────────────────────────────────────────── */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-xs space-y-4 text-center">
            <Trash2 size={24} className="mx-auto text-red-400" />
            <p className="font-bold text-sm">Delete this bet?</p>
            <p className="text-zinc-500 text-xs">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={async () => { await deleteMut.mutateAsync({ id: deleteId }); setDeleteId(null); }}
                disabled={deleteMut.isPending}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-bold transition-colors disabled:opacity-40"
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

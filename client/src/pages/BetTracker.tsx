/*
 * BetTracker.tsx — Handicapper Bet Tracker v8
 *
 * Changes in v8:
 *   - Default handicapper selector = logged-in user (not "All Handicappers")
 *   - All-Time toggle ON by default
 *   - PREGAME / LIVE wager type toggle in the add-bet form
 *   - Custom line field for RL and TOTAL bets (editable, overrides API value)
 *   - TO WIN is now a fully editable/typable field (not auto-read-only)
 *   - LOGS tab: owner/admin/sippi can view all bets created + all edit requests
 *   - Porter/Hank bets are IMMUTABLE: edit/delete shows "Submit Request" modal
 *   - bySize analytics: exact 10U/5U/4U/3U/2U/1U buckets with plus/minus money logic
 *   - wagerType badge on BetCard (PREGAME / LIVE)
 *   - customLine displayed on BetCard for RL/TOTAL bets
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
  FileText, Radio, Lock,
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
type WagerType = "PREGAME" | "LIVE";
type ActiveTab = "BETS" | "LOGS";

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
  selected, onClick, logo, teamAbbr, teamNickname, odds, line, side, disabled, customLine,
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
  customLine?:  string; // when set, override the API line display
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
      {/* Line display: prefer customLine over API line; TOTAL shows bare number, RL shows signed */}
      {(customLine !== undefined && customLine !== "" && customLine !== null) ? (
        <div className="text-[10px] font-bold text-emerald-400">
          {isTotal
            ? `${parseFloat(customLine)}`
            : (parseFloat(customLine) > 0 ? `+${parseFloat(customLine)}` : `${parseFloat(customLine)}`)}
        </div>
      ) : (line !== null && line !== undefined) ? (
        <div className="text-[10px] font-bold text-zinc-400">
          {isTotal ? `${line}` : (line > 0 ? `+${line}` : `${line}`)}
        </div>
      ) : null}
      <div className={`text-[11px] font-bold font-mono ${odds !== null ? (odds >= 0 ? "text-emerald-400" : "text-zinc-300") : "text-zinc-600"}`}>
        {odds !== null ? fmtOdds(odds) : "—"}
      </div>
    </button>
  );
}

function GameSelector({
  games, selectedId, onSelect, loading, sport, formDate, linescoreByTeams,
}: {
  games:              SlateGame[];
  selectedId:         number | null;
  onSelect:           (game: SlateGame) => void;
  loading:            boolean;
  sport:              string;
  formDate:           string;
  linescoreByTeams?:  Map<string, LinescoreEntry>;
}) {
  /** Get linescore for a game using the gameDate:away:home key */
  function getLs(g: SlateGame): LinescoreEntry | undefined {
    if (!linescoreByTeams) return undefined;
    return linescoreByTeams.get(`${g.gameDate}:${g.awayTeam}:${g.homeTeam}`);
  }
  /** Render inline score/status for a game */
  function GameStatus({ g, compact }: { g: SlateGame; compact?: boolean }) {
    const ls = getLs(g);
    const isComplete = g.status === "complete" || ls?.status === "Final";
    const isLive = !isComplete && (g.status === "in_progress" || ls?.status === "Live");
    if (isComplete) {
      const awayR = ls?.awayR ?? null;
      const homeR = ls?.homeR ?? null;
      if (awayR !== null && homeR !== null) {
        return (
          <span className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] font-bold font-mono text-zinc-300">{awayR}–{homeR}</span>
            <span className="text-[9px] font-bold text-yellow-400 uppercase">FINAL</span>
          </span>
        );
      }
      return <span className="text-[9px] font-bold text-yellow-400 uppercase">FINAL</span>;
    }
    if (isLive) {
      const awayR = ls?.awayR ?? null;
      const homeR = ls?.homeR ?? null;
      const inn = ls?.currentInning;
      const state = ls?.inningState;
      const innLabel = inn ? `${state === "Top" ? "▲" : state === "Bottom" ? "▼" : ""}${inn}` : "";
      return (
        <span className="flex items-center gap-1 shrink-0">
          {awayR !== null && homeR !== null && (
            <span className="text-[10px] font-bold font-mono text-white">{awayR}–{homeR}</span>
          )}
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] font-bold text-emerald-400 uppercase">
              {innLabel ? `${innLabel}${compact ? "" : " INN"}` : "LIVE"}
            </span>
          </span>
        </span>
      );
    }
    // Not started — show start time in EST
    return <span className="text-zinc-500 text-xs">{g.gameTime} ET</span>;
  }
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
            <span className="ml-1"><GameStatus g={selected} compact /></span>
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
              <span className="ml-auto"><GameStatus g={g} compact /></span>
              {/* Show ML odds only for scheduled games */}
              {g.status === "scheduled" && g.odds?.awayMl && (
                <span className="text-[10px] text-zinc-600 shrink-0 font-mono">
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
            <th className="text-[9px] text-zinc-600 font-medium text-left pr-2 pb-1 w-8" />
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
          <tr>
            <td className="text-[9px] font-bold text-zinc-400 text-left pr-2">{awayAbbrev}</td>
            {cols.map(c => (
              <td key={c.num} className={`text-[10px] font-mono ${cellCls(c.awayRuns, isLive && ls.currentInning === c.num)}`}>
                {c.awayRuns !== null ? c.awayRuns : (isFinal ? "0" : "·")}
              </td>
            ))}
            <td className="text-[11px] font-bold font-mono text-white px-1">{ls.awayR !== null ? ls.awayR : "—"}</td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">{ls.awayH !== null ? ls.awayH : "—"}</td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">{ls.awayE !== null ? ls.awayE : "—"}</td>
          </tr>
          <tr>
            <td className="text-[9px] font-bold text-zinc-400 text-left pr-2">{homeAbbrev}</td>
            {cols.map(c => (
              <td key={c.num} className={`text-[10px] font-mono ${cellCls(c.homeRuns, isLive && ls.currentInning === c.num)}`}>
                {c.homeRuns !== null ? c.homeRuns : (isFinal ? "0" : "·")}
              </td>
            ))}
            <td className="text-[11px] font-bold font-mono text-white px-1">{ls.homeR !== null ? ls.homeR : "—"}</td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">{ls.homeH !== null ? ls.homeH : "—"}</td>
            <td className="text-[10px] font-mono text-zinc-500 px-1">{ls.homeE !== null ? ls.homeE : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── BetCard ──────────────────────────────────────────────────────────────────

function BetCard({
  bet, stakeMode, unitSize, onResult, onDelete, onEdit, linescore, canDirectEdit,
}: {
  bet:           EnrichedBet;
  stakeMode:     StakeMode;
  unitSize:      number;
  onResult:      (id: number, result: Result) => void;
  onDelete:      (id: number) => void;
  onEdit:        (bet: TrackedBet) => void;
  linescore?:    LinescoreEntry;
  canDirectEdit: boolean; // false for porter/hank viewing own bets
}) {
  const risk  = parseFloat(bet.risk);
  const toWin = parseFloat(bet.toWin);

  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  const tfShort = timeframeShort(bet.timeframe ?? "FULL_GAME");
  const result  = bet.result as Result;

  const isGraded   = bet.result !== "PENDING" && bet.result !== "VOID";
  const lsStatus   = linescore?.status ?? null;
  const anStatus   = bet.gameStatus ?? null;

  const isFinal    = isGraded || lsStatus === "Final" || anStatus === "complete";
  const isLive     = !isFinal && (lsStatus === "Live" || anStatus === "in_progress");

  const dbAwayScore = bet.awayScore !== null && bet.awayScore !== undefined
    ? parseFloat(String(bet.awayScore)) : null;
  const dbHomeScore = bet.homeScore !== null && bet.homeScore !== undefined
    ? parseFloat(String(bet.homeScore)) : null;

  const awayR = isGraded ? dbAwayScore : (linescore?.awayR ?? dbAwayScore);
  const homeR = isGraded ? dbHomeScore : (linescore?.homeR ?? dbHomeScore);
  const hasScore = awayR !== null && homeR !== null;

  const currentInning = linescore?.currentInning ?? null;
  const inningState   = linescore?.inningState ?? null;
  const inningLabel   = currentInning
    ? `${inningState === "Top" ? "▲" : inningState === "Bottom" ? "▼" : ""}${currentInning}`
    : null;

  const pickIsAway = bet.pickSide === "AWAY";
  const pickIsHome = bet.pickSide === "HOME";

  const mktLabel = bet.market === "ML" ? "ML"
    : bet.market === "RL" ? (bet.sport === "NHL" ? "PL" : "RL")
    : "TOT";

  // Custom line display (for RL/TOTAL bets) — must be computed BEFORE getFullPickLabel
  const customLine = (bet as any).customLine;
  const lineDisplay = customLine !== null && customLine !== undefined
    ? parseFloat(String(customLine))
    : null;

  // Full team name for pick display (e.g. "DIAMONDBACKS" instead of "ARI")
  const awayFullName = (bet as any).awayFull as string | null | undefined;
  const homeFullName = (bet as any).homeFull as string | null | undefined;
  // Build display pick: replace abbrev with full nickname (last word of full name)
  function getFullPickLabel(): string {
    const side = bet.pickSide;
    if (side === "OVER") {
      const line = lineDisplay !== null ? ` ${lineDisplay}` : "";
      return `OVER${line}`;
    }
    if (side === "UNDER") {
      const line = lineDisplay !== null ? ` ${lineDisplay}` : "";
      return `UNDER${line}`;
    }
    const fullName = side === "AWAY" ? awayFullName : homeFullName;
    // Use last word of full name as nickname (e.g. "Arizona Diamondbacks" -> "DIAMONDBACKS")
    const nickname = fullName ? fullName.trim().split(" ").pop()?.toUpperCase() ?? bet.awayTeam : (side === "AWAY" ? bet.awayTeam : bet.homeTeam);
    const mkt = bet.market === "ML" ? "ML"
      : bet.market === "RL" ? (bet.sport === "NHL" ? "PL" : "RL")
      : "TOT";
    if (bet.market === "RL" && lineDisplay !== null) {
      const rlSign = (side === "AWAY" ? lineDisplay : -lineDisplay);
      const rlStr = rlSign > 0 ? `+${rlSign}` : `${rlSign}`;
      return `${nickname} ${rlStr}`;
    }
    return `${nickname} ${mkt}`;
  }
  const fullPickLabel = getFullPickLabel();

  const awayAbbrev = linescore?.awayAbbrev || bet.awayTeam || "AWY";
  const homeAbbrev = linescore?.homeAbbrev || bet.homeTeam || "HME";

  // Wager type badge
  const wagerType = (bet as any).wagerType as WagerType | undefined;

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
            <div className="flex items-center gap-1.5">
              {/* League logo */}
              {bet.sport === "MLB" && (
                <img src="https://www.mlbstatic.com/team-logos/league-on-dark/1.svg" alt="MLB" className="w-4 h-4 object-contain shrink-0" />
              )}
              {bet.sport === "NHL" && (
                <img src="https://assets.nhle.com/logos/nhl/svg/NHL_light.svg" alt="NHL" className="w-4 h-4 object-contain shrink-0" />
              )}
              {bet.sport === "NBA" && (
                <img src="https://cdn.nba.com/logos/leagues/logo-nba.svg" alt="NBA" className="w-4 h-4 object-contain shrink-0" />
              )}
              <span className="text-sm font-bold tracking-widest text-white uppercase">{bet.sport}</span>
              <span className="text-zinc-600 text-sm">·</span>
              <span className="text-sm font-semibold text-white">{fmtDate(bet.gameDate)}</span>
              {/* Wager type badge */}
              {wagerType === "LIVE" && (
                <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
                  <Radio size={8} />LIVE
                </span>
              )}
              {wagerType === "PREGAME" && (
                <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">PRE</span>
              )}
            </div>

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
                <span className="text-[9px] font-bold text-zinc-500 tracking-widest uppercase">
                  {bet.timeframe === "FIRST_5" ? "F5" :
                   bet.timeframe === "FIRST_INNING" ? "INN 1" :
                   bet.timeframe === "NRFI" ? "NRFI" :
                   bet.timeframe === "YRFI" ? "YRFI" :
                   bet.timeframe === "FIRST_PERIOD" ? "P1" :
                   bet.timeframe === "FIRST_HALF" ? "1H" :
                   bet.timeframe === "FIRST_QUARTER" ? "Q1" :
                   bet.timeframe === "REGULATION" ? "REG" :
                   "Final"}
                </span>
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

          {/* Edit/Delete buttons */}
          <div className="flex flex-col gap-1 shrink-0 ml-1">
            {canDirectEdit ? (
              <>
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
              </>
            ) : (
              <>
                <button type="button" onClick={() => onEdit(bet)}
                  className="p-1.5 rounded-lg text-zinc-700 hover:text-yellow-400 hover:bg-yellow-500/10 transition-all"
                  title="Request edit"
                >
                  <FileText size={11} />
                </button>
                <button type="button" onClick={() => onDelete(bet.id)}
                  className="p-1.5 rounded-lg text-zinc-700 hover:text-yellow-400 hover:bg-yellow-500/10 transition-all"
                  title="Request deletion"
                >
                  <Lock size={11} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Row 2: Pick + Bet Details ── */}
        <div className="flex flex-col items-center gap-2">

          {/* Pick row */}
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {(pickIsAway && bet.awayLogo) && (
              <img src={bet.awayLogo} alt="" className="w-4 h-4 object-contain opacity-80" />
            )}
            {(pickIsHome && bet.homeLogo) && (
              <img src={bet.homeLogo} alt="" className="w-4 h-4 object-contain opacity-80" />
            )}
            <span className="text-white font-bold text-sm">{fullPickLabel}</span>
            <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium tracking-wider">{mktLabel}</span>
            {tfShort && (
              <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-medium">{tfShort}</span>
            )}
            <span className={`text-[11px] font-bold font-mono ${
              bet.odds >= 0 ? "text-emerald-400" : "text-zinc-300"
            }`}>
              {fmtOdds(bet.odds)}
            </span>
            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold border ${resultBg(result)}`}>
              {result}
            </span>
          </div>

          {/* Stake row */}
          <div className="flex items-center justify-center gap-2 w-full">
            <div className="flex items-center gap-1.5 bg-zinc-800/50 rounded-lg px-3 py-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Risk</span>
              <span className="text-xs font-bold font-mono text-white">{fmtStake(risk)}</span>
            </div>
            <span className="text-zinc-700 text-xs">→</span>
            <div className="flex items-center gap-1.5 bg-zinc-800/50 rounded-lg px-3 py-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Win</span>
              <span className="text-xs font-bold font-mono text-emerald-400">{fmtStake(toWin)}</span>
            </div>
            {result !== "PENDING" && result !== "VOID" && (
              <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
                result === "WIN" ? "bg-green-500/10" : result === "LOSS" ? "bg-red-500/10" : "bg-yellow-500/10"
              }`}>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">P/L</span>
                <span className={`text-xs font-bold font-mono ${resultColor(result)}`}>
                  {result === "WIN"  ? `+${fmtStake(toWin)}` :
                   result === "LOSS" ? `-${fmtStake(risk)}` :
                   "PUSH"}
                </span>
              </div>
            )}
          </div>

          {/* Quick result buttons (only for direct-edit users) */}
          {canDirectEdit && result === "PENDING" && (
            <div className="flex items-center gap-1.5 w-full justify-center">
              {(["WIN", "LOSS", "PUSH", "VOID"] as Result[]).map(r => (
                <button key={r} type="button" onClick={() => onResult(bet.id, r)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all hover:opacity-80 ${resultBg(r)}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Linescore (MLB only) */}
        {linescore && bet.sport === "MLB" && (
          <LinescoreGrid ls={linescore} awayAbbrev={awayAbbrev} homeAbbrev={homeAbbrev} />
        )}

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

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

function LogsTab({
  logsQuery,
  reviewMut,
  invalidateLogs,
}: {
  logsQuery: ReturnType<typeof trpc.betTracker.getLogs.useQuery>;
  reviewMut: ReturnType<typeof trpc.betTracker.reviewEditRequest.useMutation>;
  invalidateLogs: () => void;
}) {
  const [reviewId, setReviewId]     = useState<number | null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "DENY">("APPROVE");
  const [reviewNote, setReviewNote] = useState("");
  const [activeSection, setActiveSection] = useState<"BETS" | "REQUESTS">("REQUESTS");

  const data = logsQuery.data as { editRequests: any[]; bets: any[] } | undefined;
  const editRequests = data?.editRequests ?? [];
  const bets         = data?.bets ?? [];
  const pendingRequests = editRequests.filter((r: any) => r.status === "PENDING");

  function handleReview() {
    if (reviewId === null) return;
    reviewMut.mutate(
      { requestId: reviewId, action: reviewAction, reviewNote: reviewNote || undefined },
      {
        onSuccess: () => {
          setReviewId(null);
          setReviewNote("");
          invalidateLogs();
        },
      }
    );
  }

  if (logsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
        <button type="button"
          onClick={() => setActiveSection("REQUESTS")}
          className={`px-4 py-2 text-xs font-bold tracking-wider rounded-lg transition-all ${
            activeSection === "REQUESTS"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          EDIT REQUESTS
          {pendingRequests.length > 0 && (
            <span className="ml-2 bg-yellow-500 text-black text-[10px] font-black px-1.5 py-0.5 rounded-full">
              {pendingRequests.length}
            </span>
          )}
        </button>
        <button type="button"
          onClick={() => setActiveSection("BETS")}
          className={`px-4 py-2 text-xs font-bold tracking-wider rounded-lg transition-all ${
            activeSection === "BETS"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          ALL BETS LOG
          <span className="ml-2 text-zinc-600 text-[10px]">({bets.length})</span>
        </button>
      </div>

      {/* Edit Requests */}
      {activeSection === "REQUESTS" && (
        <div className="space-y-3">
          {editRequests.length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-sm">No edit requests submitted yet.</div>
          ) : (
            editRequests.map((req: any) => (
              <div key={req.id} className={`bg-zinc-900/80 border rounded-xl p-4 space-y-2 ${
                req.status === "PENDING" ? "border-yellow-500/30" :
                req.status === "APPROVED" ? "border-green-500/20" :
                "border-zinc-800"
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      req.status === "PENDING"  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                      req.status === "APPROVED" ? "bg-green-500/10 border-green-500/30 text-green-400" :
                      "bg-zinc-800 border-zinc-700 text-zinc-500"
                    }`}>{req.status}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      req.requestType === "DELETE"
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                    }`}>{req.requestType}</span>
                    <span className="text-xs text-zinc-400 font-medium">@{req.requesterUsername}</span>
                    <span className="text-[10px] text-zinc-600">Bet #{req.betId}</span>
                  </div>
                  <span className="text-[10px] text-zinc-600">
                    {new Date(req.createdAt).toLocaleString()}
                  </span>
                </div>
                {req.reason && (
                  <div className="text-xs text-zinc-400 bg-zinc-800/50 rounded-lg px-3 py-2 italic">
                    "{req.reason}"
                  </div>
                )}
                {req.proposedChanges && (
                  <div className="text-[10px] text-zinc-500 bg-zinc-800/30 rounded px-2 py-1 font-mono">
                    Changes: {req.proposedChanges}
                  </div>
                )}
                {req.reviewerUsername && (
                  <div className="text-[10px] text-zinc-500">
                    Reviewed by @{req.reviewerUsername}
                    {req.reviewNote && `: "${req.reviewNote}"`}
                  </div>
                )}
                {req.status === "PENDING" && (
                  <div className="flex gap-2 pt-1">
                    <button type="button"
                      onClick={() => { setReviewId(req.id); setReviewAction("APPROVE"); setReviewNote(""); }}
                      className="flex-1 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold hover:bg-green-500/20 transition-all"
                    >
                      Approve
                    </button>
                    <button type="button"
                      onClick={() => { setReviewId(req.id); setReviewAction("DENY"); setReviewNote(""); }}
                      className="flex-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* All Bets Log */}
      {activeSection === "BETS" && (
        <div className="space-y-2">
          {bets.length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-sm">No bets tracked yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                    <th className="text-left py-2 px-2">ID</th>
                    <th className="text-left py-2 px-2">User</th>
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-left py-2 px-2">Sport</th>
                    <th className="text-left py-2 px-2">Pick</th>
                    <th className="text-left py-2 px-2">Odds</th>
                    <th className="text-left py-2 px-2">Risk</th>
                    <th className="text-left py-2 px-2">ToWin</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Result</th>
                    <th className="text-left py-2 px-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map((b: any) => (
                    <tr key={b.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                      <td className="py-2 px-2 text-zinc-600 font-mono">#{b.id}</td>
                      <td className="py-2 px-2">
                        <span className="text-zinc-300 font-medium">@{b.username}</span>
                        <span className={`ml-1 text-[9px] font-bold uppercase px-1 py-0.5 rounded ${
                          b.userRole === "owner" ? "text-yellow-400" :
                          b.userRole === "admin" ? "text-blue-400" :
                          "text-emerald-400"
                        }`}>{b.userRole}</span>
                      </td>
                      <td className="py-2 px-2 text-zinc-400 font-mono">{fmtDate(b.gameDate)}</td>
                      <td className="py-2 px-2 text-zinc-500">{b.sport}</td>
                      <td className="py-2 px-2 text-white font-medium">{b.pick}</td>
                      <td className={`py-2 px-2 font-mono font-bold ${b.odds >= 0 ? "text-emerald-400" : "text-zinc-300"}`}>
                        {fmtOdds(b.odds)}
                      </td>
                      <td className="py-2 px-2 text-zinc-400 font-mono">{parseFloat(b.risk).toFixed(2)}</td>
                      <td className="py-2 px-2 text-emerald-400 font-mono">{parseFloat(b.toWin).toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          (b as any).wagerType === "LIVE"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-zinc-800 text-zinc-500"
                        }`}>{(b as any).wagerType ?? "PRE"}</span>
                      </td>
                      <td className={`py-2 px-2 font-bold text-[10px] ${resultColor(b.result as Result)}`}>{b.result}</td>
                      <td className="py-2 px-2 text-zinc-600 font-mono text-[10px]">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Review modal */}
      {reviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider">
              {reviewAction === "APPROVE" ? "✅ Approve Request" : "❌ Deny Request"}
            </h3>
            <p className="text-zinc-400 text-xs">Request #{reviewId}</p>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Note (optional)</label>
              <textarea
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                rows={2}
                placeholder="Reason for decision…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setReviewId(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleReview}
                disabled={reviewMut.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 ${
                  reviewAction === "APPROVE" ? "bg-green-600 hover:bg-green-500" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {reviewMut.isPending ? "Processing…" : reviewAction}
              </button>
            </div>
          </div>
        </div>
      )}
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

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("BETS");

  // ── Handicapper selector: default to logged-in user ───────────────────────
  // Initialize to appUser.id once loaded; owner/admin can change it
  const [targetUserId, setTargetUserId] = useState<number | undefined>(undefined);
  const [showAnalytics, setShowAnalytics] = useState(false);
  // All-Time ON by default
  const [filterAllTime, setFilterAllTime] = useState(true);

  // Set default targetUserId to logged-in user once appUser loads
  useEffect(() => {
    if (appUser && targetUserId === undefined) {
      setTargetUserId(appUser.id);
    }
  }, [appUser, targetUserId]);

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
  const [formToWin, setFormToWin]         = useState(""); // editable toWin
  const [formToWinManual, setFormToWinManual] = useState(false); // true if user typed it
  const [formNotes, setFormNotes]         = useState("");
  const [formError, setFormError]         = useState("");
  const [formWagerType, setFormWagerType] = useState<WagerType>("PREGAME");
  const [formCustomLine, setFormCustomLine] = useState(""); // custom line for RL/TOTAL

  // Edit / delete modal
  const [editBet, setEditBet]       = useState<TrackedBet | null>(null);
  const [editNotes, setEditNotes]   = useState("");
  const [editResult, setEditResult] = useState<Result>("PENDING");
  const [editIsRequest, setEditIsRequest] = useState(false); // true = submit request, not direct edit
  const [editRequestReason, setEditRequestReason] = useState("");

  // Delete modal
  const [deleteId, setDeleteId]         = useState<number | null>(null);
  const [deleteIsRequest, setDeleteIsRequest] = useState(false);
  const [deleteRequestReason, setDeleteRequestReason] = useState("");

  // Auto-grade toast
  const [gradeToast, setGradeToast] = useState<{ graded: number; wins: number; losses: number; pushes: number; stillPending: number } | null>(null);

  // ── Derived values ────────────────────────────────────────────────────────
  const oddsNum = parseInt(formOdds, 10);
  const riskNum = parseFloat(formRisk);

  const autoToWin = useMemo(() => {
    if (!isNaN(oddsNum) && oddsNum !== 0 && !isNaN(riskNum) && riskNum > 0) {
      return calcToWin(oddsNum, riskNum);
    }
    return null;
  }, [oddsNum, riskNum]);

  // Sync auto-calculated toWin into the field when not manually overridden
  useEffect(() => {
    if (!formToWinManual && autoToWin !== null) {
      setFormToWin(String(autoToWin));
    }
  }, [autoToWin, formToWinManual]);

  // Reset manual override when odds/risk change significantly
  useEffect(() => {
    setFormToWinManual(false);
  }, [formOdds, formRisk]);

  const toWinNum = parseFloat(formToWin);

  const riskLabel  = stakeMode === "$" ? "Risk $" : "Risk (U)";
  const toWinLabel = stakeMode === "$" ? "To Win $" : "To Win (U)";

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
  useEffect(() => { setFormGame(null); setFormPickSide("AWAY"); setFormOdds(""); setFormCustomLine(""); }, [formDate, activeSport]);

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
    // Reset custom line when market changes
    setFormCustomLine("");
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
      unitSize:     unitSize > 0 ? unitSize : 100,
    },
    { enabled: canAccess }
  );

  const handicappersQuery = trpc.betTracker.listHandicappers.useQuery(
    undefined,
    { enabled: canAccess && isOwnerOrAdmin }
  );

  // ── Linescore query (MLB only) ─────────────────────────────────────────────
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
      staleTime: 30_000,
      refetchInterval: 60_000,
      retry: 1,
    }
  );

  const linescoreByTeams = useMemo(() => {
    const map = new Map<string, LinescoreEntry>();
    if (!linescoreQuery.data) return map;
    for (const ls of Object.values(linescoreQuery.data)) {
      const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}`;
      map.set(key, ls);
    }
    return map;
  }, [linescoreQuery.data]);

  // ── Logs query (owner/admin only) ─────────────────────────────────────────
  const logsQuery = trpc.betTracker.getLogs.useQuery(
    { limit: 200, offset: 0 },
    { enabled: canAccess && isOwnerOrAdmin && activeTab === "LOGS" }
  );

  const utils = trpc.useUtils();
  const invalidate = useCallback(() => {
    utils.betTracker.list.invalidate();
    utils.betTracker.getStats.invalidate();
  }, [utils]);
  const invalidateLogs = useCallback(() => {
    utils.betTracker.getLogs.invalidate();
    invalidate();
  }, [utils, invalidate]);

  const createMut    = trpc.betTracker.create.useMutation({ onSuccess: invalidate });
  const updateMut    = trpc.betTracker.update.useMutation({ onSuccess: invalidate });
  const deleteMut    = trpc.betTracker.delete.useMutation({ onSuccess: invalidate });
  const submitRequestMut = trpc.betTracker.submitEditRequest.useMutation({ onSuccess: invalidateLogs });
  const reviewMut    = trpc.betTracker.reviewEditRequest.useMutation({ onSuccess: invalidateLogs });
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
  const prevLinescoreRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!canAccess) return;

    const pendingBets = enrichedBets.filter(b => b.result === "PENDING");
    if (pendingBets.length === 0) return;

    if (linescoreQuery.data) {
      let newFinalFound = false;
      for (const ls of Object.values(linescoreQuery.data)) {
        const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}`;
        const prev = prevLinescoreRef.current[key];
        if (ls.status === "Final" && prev && prev !== "Final") {
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
    setFormCustomLine("");
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
            odds={odds?.over?.odds ?? null} line={getPickLine(odds, "TOTAL", "OVER")} side="OVER"
            customLine={formCustomLine || undefined} />
          <PickButton selected={formPickSide === "UNDER"} onClick={() => handlePickSide("UNDER")}
            odds={odds?.under?.odds ?? null} line={getPickLine(odds, "TOTAL", "UNDER")} side="UNDER"
            customLine={formCustomLine || undefined} />
        </div>
      );
    }

    const awayOdds = formMarket === "ML" ? (odds?.awayMl?.odds ?? null) : (odds?.awayRl?.odds ?? null);
    const homeOdds = formMarket === "ML" ? (odds?.homeMl?.odds ?? null) : (odds?.homeRl?.odds ?? null);
    const awayLine = formMarket === "RL" ? (odds?.awayRl?.value ?? null) : null;
    const homeLine = formMarket === "RL" ? (odds?.homeRl?.value ?? null) : null;

    // For RL: customLine is a magnitude (e.g. "1.5"), apply sign per side
    const awayCustomLine = formMarket === "RL" && formCustomLine
      ? String(-Math.abs(parseFloat(formCustomLine))) : undefined;
    const homeCustomLine = formMarket === "RL" && formCustomLine
      ? String(+Math.abs(parseFloat(formCustomLine))) : undefined;

    return (
      <div className="flex gap-2">
        <PickButton selected={formPickSide === "AWAY"} onClick={() => handlePickSide("AWAY")}
          logo={awayLogo} teamAbbr={awayTeam} teamNickname={awayNickname}
          odds={awayOdds} line={awayLine} side="AWAY" customLine={awayCustomLine} />
        <PickButton selected={formPickSide === "HOME"} onClick={() => handlePickSide("HOME")}
          logo={homeLogo} teamAbbr={homeTeam} teamNickname={homeNickname}
          odds={homeOdds} line={homeLine} side="HOME" customLine={homeCustomLine} />
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
    const toWinFinal   = !isNaN(toWinNum) && toWinNum > 0
      ? (stakeMode === "U" ? toWinNum * unitSize : toWinNum)
      : (stakeMode === "U" ? (autoToWin ?? 0) * unitSize : (autoToWin ?? calcToWin(oddsNum, riskNum)));

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

    // Custom line override (for RL/TOTAL)
    const customLineNum = formCustomLine.trim() !== "" ? parseFloat(formCustomLine) : undefined;
    const effectiveCustomLine = (effectiveMarket === "RL" || effectiveMarket === "TOTAL") && customLineNum !== undefined && !isNaN(customLineNum)
      ? customLineNum
      : undefined;

    console.log(`[BetTracker][INPUT] create: sport=${activeSport} date=${formDate} game=${formGame.awayTeam}@${formGame.homeTeam} market=${effectiveMarket} pickSide=${effectivePickSide} odds=${oddsNum} risk=${riskDollars} toWin=${toWinFinal} wagerType=${formWagerType} customLine=${effectiveCustomLine ?? "null"}`);

    // Compute unit-denominated values for accurate bySize analytics
    const riskUnitsVal  = stakeMode === "U" ? riskNum : (unitSize > 0 ? riskDollars / unitSize : riskDollars);
    const toWinFinalU   = !isNaN(toWinNum) && toWinNum > 0
      ? (stakeMode === "U" ? toWinNum : (unitSize > 0 ? toWinFinal / unitSize : toWinFinal))
      : (stakeMode === "U" ? (autoToWin ?? 0) : (unitSize > 0 ? toWinFinal / unitSize : toWinFinal));
    console.log(`[BetTracker][STATE] riskUnits=${riskUnitsVal.toFixed(2)} toWinUnits=${toWinFinalU.toFixed(2)}`);

    await createMut.mutateAsync({
      anGameId:   formGame.id,
      sport:      activeSport,
      gameDate:   formDate,
      awayTeam:   formGame.awayTeam,
      homeTeam:   formGame.homeTeam,
      timeframe:  formTimeframe,
      market:     effectiveMarket,
      pickSide:   effectivePickSide,
      odds:       oddsNum,
      risk:       riskDollars,
      toWin:      toWinFinal,
      riskUnits:  parseFloat(riskUnitsVal.toFixed(4)),
      toWinUnits: parseFloat(toWinFinalU.toFixed(4)),
      line:       linePick,
      notes:      formNotes || undefined,
      wagerType:  formWagerType,
      customLine: effectiveCustomLine,
    });

    setFormGame(null);
    setFormTimeframe("FULL_GAME");
    setFormMarket("ML");
    setFormPickSide("AWAY");
    setFormOdds("");
    setFormRisk("2");
    setFormToWin("");
    setFormToWinManual(false);
    setFormNotes("");
    setFormWagerType("PREGAME");
    setFormCustomLine("");
  };

  const handleResult = async (id: number, result: Result) => {
    await updateMut.mutateAsync({ id, result });
  };

  const handleEditSave = async () => {
    if (!editBet) return;
    if (editIsRequest) {
      // Submit edit request for porter/hank
      await submitRequestMut.mutateAsync({
        betId:       editBet.id,
        requestType: "EDIT",
        reason:      editRequestReason || undefined,
        proposedChanges: { notes: editNotes, result: editResult },
      });
    } else {
      await updateMut.mutateAsync({ id: editBet.id, notes: editNotes, result: editResult });
    }
    setEditBet(null);
    setEditIsRequest(false);
    setEditRequestReason("");
  };

  const handleDeleteConfirm = async () => {
    if (deleteId === null) return;
    if (deleteIsRequest) {
      await submitRequestMut.mutateAsync({
        betId:       deleteId,
        requestType: "DELETE",
        reason:      deleteRequestReason || undefined,
      });
    } else {
      await deleteMut.mutateAsync({ id: deleteId });
    }
    setDeleteId(null);
    setDeleteIsRequest(false);
    setDeleteRequestReason("");
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
                <span className="text-xs font-bold tracking-widest text-zinc-400 uppercase">+/- UNITS</span>
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

            {/* WAGER TYPE: PREGAME / LIVE */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Wager Type</label>
              <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg p-0.5 w-fit">
                <button type="button" onClick={() => setFormWagerType("PREGAME")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    formWagerType === "PREGAME"
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  PRE-GAME
                </button>
                <button type="button" onClick={() => setFormWagerType("LIVE")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    formWagerType === "LIVE"
                      ? "bg-red-500/20 border border-red-500/30 text-red-400"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <Radio size={10} />LIVE
                </button>
              </div>
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
                linescoreByTeams={linescoreByTeams}
              />
            </div>

            {/* TIMEFRAME */}
            <SelectField
              label="Timeframe"
              value={formTimeframe}
              onChange={v => setFormTimeframe(v as Timeframe)}
              options={timeframeOptions}
            />

            {/* MARKET — hidden for NRFI/YRFI */}
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
                    ? " — No Run First Inning. Auto-set: TOTAL UNDER 0.5 runs in inning 1."
                    : " — Yes Run First Inning. Auto-set: TOTAL OVER 0.5 runs in inning 1."}
                </div>
              </div>
            )}

            {/* PICK — hidden for NRFI/YRFI */}
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

            {/* CUSTOM LINE (for RL and TOTAL only) */}
            {(formMarket === "RL" || formMarket === "TOTAL") && formTimeframe !== "NRFI" && formTimeframe !== "YRFI" && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">
                  {formMarket === "TOTAL" ? "Total Line (e.g. 8, 8.5)" : "Run Line (e.g. -1.5, +1.5)"}
                </label>
                <input
                  type="number"
                  value={formCustomLine}
                  onChange={e => setFormCustomLine(e.target.value)}
                  placeholder={formMarket === "TOTAL" ? "8.0" : "-1.5"}
                  step="0.5"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                />

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
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">
                  {toWinLabel}
                  {formToWinManual && (
                    <button type="button"
                      onClick={() => { setFormToWinManual(false); if (autoToWin !== null) setFormToWin(String(autoToWin)); }}
                      className="ml-1 text-[9px] text-emerald-400 underline"
                    >
                      reset
                    </button>
                  )}
                </label>
                <input
                  type="number"
                  value={formToWin}
                  onChange={e => { setFormToWin(e.target.value); setFormToWinManual(true); }}
                  placeholder={autoToWin !== null ? String(autoToWin) : "0"}
                  min={0}
                  step={stakeMode === "U" ? "0.5" : "10"}
                  className={`w-full bg-zinc-900 border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors ${
                    formToWinManual ? "border-emerald-500/50 text-emerald-400" : "border-zinc-700"
                  }`}
                />
              </div>
            </div>

            {/* Unit math explainer */}
            {stakeMode === "U" && !isNaN(toWinNum) && toWinNum > 0 && riskNum > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-2">
                <Hash size={10} className="text-emerald-400 shrink-0" />
                <span>
                  {fmtUnits(riskNum)} to win {fmtUnits(toWinNum)}
                  {unitSize > 0 && (
                    <span className="text-zinc-600 ml-1">
                      ({fmtDollar(riskNum * unitSize)} to win {fmtDollar(toWinNum * unitSize)})
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

          {/* ── Right Panel: Tabs (BETS | LOGS) ──────────────────────────── */}
          <div className="space-y-4">

            {/* Tab bar */}
            <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
              <button type="button"
                onClick={() => setActiveTab("BETS")}
                className={`px-4 py-2.5 text-xs font-bold tracking-wider border-b-2 transition-all ${
                  activeTab === "BETS"
                    ? "border-emerald-400 text-emerald-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                BETS
              </button>
              {isOwnerOrAdmin && (
                <button type="button"
                  onClick={() => setActiveTab("LOGS")}
                  className={`px-4 py-2.5 text-xs font-bold tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                    activeTab === "LOGS"
                      ? "border-emerald-400 text-emerald-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <FileText size={11} />LOGS
                </button>
              )}
            </div>

            {/* BETS Tab */}
            {activeTab === "BETS" && (
              <>
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
                            <div className="text-base font-bold tracking-wider text-white">
                              {item.date ? fmtDate(item.date) : "Unknown Date"}
                            </div>
                            <div className="flex-1 h-px bg-zinc-800" />
                            <div className="text-[10px] font-mono text-zinc-600">{record}</div>
                          </div>
                        );
                      }
                      const ls = item.bet.sport === "MLB"
                        ? linescoreByTeams.get(`${item.bet.gameDate}:${item.bet.awayTeam}:${item.bet.homeTeam}`) ?? undefined
                        : undefined;
                      // canDirectEdit: owner/admin can always edit; handicapper can only edit their own
                      // porter/hank (handicapper role) must submit request
                      const betOwnerIsHandicapper = item.bet.userId === appUser?.id && role === "handicapper";
                      const canDirectEdit = isOwnerOrAdmin || !betOwnerIsHandicapper;
                      return (
                        <BetCard
                          key={item.bet.id}
                          bet={item.bet}
                          stakeMode={stakeMode}
                          unitSize={unitSize}
                          onResult={handleResult}
                          onDelete={id => {
                            setDeleteId(id);
                            setDeleteIsRequest(!isOwnerOrAdmin);
                            setDeleteRequestReason("");
                          }}
                          onEdit={b => {
                            setEditBet(b);
                            setEditNotes(b.notes ?? "");
                            setEditResult(b.result as Result);
                            setEditIsRequest(!isOwnerOrAdmin);
                            setEditRequestReason("");
                          }}
                          linescore={ls}
                          canDirectEdit={canDirectEdit}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* LOGS Tab */}
            {activeTab === "LOGS" && isOwnerOrAdmin && (
              <LogsTab
                logsQuery={logsQuery}
                reviewMut={reviewMut}
                invalidateLogs={invalidateLogs}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {editBet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider">
              {editIsRequest ? "📋 REQUEST EDIT" : "EDIT BET"}
            </h3>
            {editIsRequest && (
              <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-3 py-2.5">
                <Lock size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-zinc-300">
                  Your bets are immutable. This will submit an edit request for owner/admin review.
                </p>
              </div>
            )}
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
            {editIsRequest && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Reason for Request</label>
                <textarea
                  value={editRequestReason}
                  onChange={e => setEditRequestReason(e.target.value)}
                  rows={2}
                  placeholder="Explain why this change is needed…"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-yellow-500 transition-colors"
                />
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditBet(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleEditSave}
                disabled={updateMut.isPending || submitRequestMut.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 ${
                  editIsRequest ? "bg-yellow-600 hover:bg-yellow-500" : "bg-emerald-500 hover:bg-emerald-400"
                }`}
              >
                {(updateMut.isPending || submitRequestMut.isPending)
                  ? "Saving…"
                  : editIsRequest ? "Submit Request" : "Save"}
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
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded
-lg px-3 py-2">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Pushes</div>
              <div className="text-yellow-400 font-bold">{gradeToast.pushes}</div>
            </div>
          </div>
          {gradeToast.stillPending > 0 && (
            <div className="mt-2 text-[10px] text-zinc-500">
              {gradeToast.stillPending} bet{gradeToast.stillPending !== 1 ? "s" : ""} still pending (game not final yet)
            </div>
          )}
        </div>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider text-red-400">
              {deleteIsRequest ? "📋 REQUEST DELETION" : "DELETE BET"}
            </h3>
            {deleteIsRequest ? (
              <>
                <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-3 py-2.5">
                  <Lock size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-zinc-300">
                    Your bets are immutable. This will submit a deletion request for owner/admin review.
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Reason for Request</label>
                  <textarea
                    value={deleteRequestReason}
                    onChange={e => setDeleteRequestReason(e.target.value)}
                    rows={2}
                    placeholder="Explain why this bet should be removed…"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-yellow-500 transition-colors"
                  />
                </div>
              </>
            ) : (
              <p className="text-zinc-400 text-sm">This action cannot be undone. The bet will be permanently removed.</p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setDeleteId(null); setDeleteIsRequest(false); setDeleteRequestReason(""); }}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleDeleteConfirm}
                disabled={deleteMut.isPending || submitRequestMut.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 ${
                  deleteIsRequest ? "bg-yellow-600 hover:bg-yellow-500" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {(deleteMut.isPending || submitRequestMut.isPending)
                  ? "Processing…"
                  : deleteIsRequest ? "Submit Request" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

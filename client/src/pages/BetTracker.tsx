/**
 * BetTracker.tsx — Handicapper Bet Tracker v4
 *
 * Form structure (fully structured, no free-text):
 *   1. DATE        — date picker (defaults to today EST)
 *   2. GAME        — dropdown with team logos + time from Action Network slate
 *   3. TIMEFRAME   — sport-aware (MLB: Full/F5/F1 | NHL: Full/Regulation/1st Period | NBA: Full/1H/1Q)
 *   4. MARKET      — Moneyline | Run Line/Puck Line/Spread | Total
 *   5. PICK        — logo + team name + live odds (context-aware per market)
 *   6. ODDS        — auto-filled from AN slate; editable
 *   7. RISK / TO WIN — units or dollars; correct unit math (1u = 1 unit, not $1)
 *   8. NOTES       — optional textarea
 *
 * Unit math:
 *   - Risk field accepts units (e.g. 2 = 2u)
 *   - To Win = risk × (odds payout ratio) in units
 *   - Display: "2.00u to win 1.82u" — never dollars in unit mode
 *
 * Access: OWNER | ADMIN | HANDICAPPER only.
 *
 * Logging convention:
 *   [BetTracker][INPUT]  — user action / form input
 *   [BetTracker][STEP]   — operation in progress
 *   [BetTracker][STATE]  — intermediate computed values
 *   [BetTracker][OUTPUT] — final result
 *   [BetTracker][VERIFY] — validation pass/fail
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import {
  Clock, TrendingUp, Minus, AlertCircle,
  ChevronLeft, Plus, Pencil, Trash2, CheckCircle2,
  DollarSign, Hash, ChevronDown, Zap, RefreshCw,
} from "lucide-react";
import type { TrackedBet } from "@shared/types";

// ─── Types ────────────────────────────────────────────────────────────────────

const SPORTS = ["MLB", "NHL", "NBA", "NCAAM"] as const;
type Sport = typeof SPORTS[number];

type Timeframe = "FULL_GAME" | "FIRST_5" | "FIRST_INNING" | "REGULATION" | "FIRST_PERIOD" | "FIRST_HALF" | "FIRST_QUARTER";
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
    { value: "FIRST_5",      label: "First 5 Innings" },
    { value: "FIRST_INNING", label: "First Inning" },
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

/**
 * Calculate toWin from American odds + risk amount (in any unit).
 * Works for both dollar and unit modes — the unit is preserved.
 */
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

/**
 * Format a unit value.
 * n is already in units (e.g. 2.5 → "2.50u").
 * No conversion needed — risk input IS in units.
 */
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
    case "REGULATION":    return "REG";
    case "FIRST_PERIOD":  return "1P";
    case "FIRST_HALF":    return "1H";
    case "FIRST_QUARTER": return "1Q";
    default:              return "";
  }
}

/** Get the live odds for a given pick from a GameOdds object */
function getPickOdds(odds: GameOdds | null, market: Market, pickSide: PickSide): number | null {
  if (!odds) return null;
  switch (market) {
    case "ML":    return pickSide === "AWAY" ? odds.awayMl?.odds ?? null : odds.homeMl?.odds ?? null;
    case "RL":    return pickSide === "AWAY" ? odds.awayRl?.odds ?? null : odds.homeRl?.odds ?? null;
    case "TOTAL": return pickSide === "OVER" ? odds.over?.odds  ?? null : odds.under?.odds  ?? null;
  }
}

/** Get the line value (spread / total) for a given pick */
function getPickLine(odds: GameOdds | null, market: Market, pickSide: PickSide): number | null {
  if (!odds) return null;
  switch (market) {
    case "RL":    return pickSide === "AWAY" ? odds.awayRl?.value ?? null : odds.homeRl?.value ?? null;
    case "TOTAL": return pickSide === "OVER" ? odds.over?.value   ?? null : odds.under?.value  ?? null;
    default:      return null;
  }
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

/** Native <select> wrapper with consistent dark styling */
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

/**
 * GamePickButton — a clickable card showing team logo + name + odds.
 * Used for the PICK selection (Away/Home/Over/Under).
 */
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
      {/* Selected indicator */}
      {selected && (
        <div className="absolute top-1.5 right-1.5">
          <CheckCircle2 size={12} className="text-emerald-400" />
        </div>
      )}

      {/* Logo or icon */}
      {!isTotal && logo ? (
        <img
          src={logo}
          alt={teamAbbr}
          className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className={`text-lg font-black ${isTotal ? (side === "OVER" ? "text-emerald-400" : "text-blue-400") : "text-zinc-400"}`}>
          {side === "OVER" ? "O" : side === "UNDER" ? "U" : ""}
        </div>
      )}

      {/* Team abbr / side label */}
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

      {/* Line value (RL / Total) */}
      {line !== null && line !== undefined && (
        <div className="text-[10px] font-bold text-zinc-400">
          {line > 0 ? `+${line}` : `${line}`}
        </div>
      )}

      {/* Odds */}
      <div className={`text-[11px] font-bold font-mono ${odds !== null ? (odds >= 0 ? "text-emerald-400" : "text-zinc-300") : "text-zinc-600"}`}>
        {odds !== null ? fmtOdds(odds) : "—"}
      </div>
    </button>
  );
}

/**
 * GameDropdownOption — renders a game option with team logos in the custom dropdown.
 * Since native <select> doesn't support images, we use a custom listbox.
 */
function GameSelector({
  games,
  selectedId,
  onSelect,
  loading,
  sport,
  formDate,
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

  // Close on outside click
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
      {/* Trigger */}
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

      {/* Dropdown list */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {games.map(g => (
            <button type="button" key={g.id}
              onClick={() => { onSelect(g); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left ${g.id === selectedId ? "bg-emerald-500/10" : ""}`}
            >
              {/* Away team */}
              <img src={g.awayLogo} alt={g.awayTeam} className="w-6 h-6 object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="font-bold text-white text-sm w-8 shrink-0">{g.awayTeam}</span>
              <span className="text-zinc-600 text-xs">@</span>
              {/* Home team */}
              <img src={g.homeLogo} alt={g.homeTeam} className="w-6 h-6 object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="font-bold text-white text-sm w-8 shrink-0">{g.homeTeam}</span>
              {/* Time */}
              <span className="text-zinc-500 text-xs ml-1">{g.gameTime} ET</span>
              {/* Status badge */}
              {g.status !== "scheduled" && (
                <span className="text-[9px] font-bold text-yellow-400 uppercase ml-auto shrink-0">{g.status}</span>
              )}
              {/* ML odds preview */}
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

// ─── BetCard ──────────────────────────────────────────────────────────────────

function BetCard({
  bet, stakeMode, unitSize, onResult, onDelete, onEdit,
}: {
  bet:       TrackedBet;
  stakeMode: StakeMode;
  unitSize:  number;
  onResult:  (id: number, result: Result) => void;
  onDelete:  (id: number) => void;
  onEdit:    (bet: TrackedBet) => void;
}) {
  const risk  = parseFloat(bet.risk);
  const toWin = parseFloat(bet.toWin);

  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    // In unit mode: risk/toWin stored as dollar amounts, convert to units
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  const tfShort  = timeframeShort(bet.timeframe ?? "FULL_GAME");
  const mktLabel = bet.market === "ML" ? "ML" : bet.market === "RL" ? "RL" : "TOT";

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] tracking-widest text-zinc-500 font-medium uppercase">{bet.sport}</span>
            {bet.awayTeam && bet.homeTeam && (
              <span className="text-[10px] text-zinc-600">{bet.awayTeam} @ {bet.homeTeam}</span>
            )}
            {bet.gameDate && (
              <span className="text-[10px] text-zinc-700">{fmtDate(bet.gameDate)}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-white font-bold text-sm">{bet.pick}</span>
            {tfShort && (
              <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium">{tfShort}</span>
            )}
            <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium">{mktLabel}</span>
          </div>
        </div>
        <span className={`text-[10px] border rounded-full px-2 py-0.5 font-medium uppercase tracking-wide shrink-0 ${resultBg(bet.result as Result)}`}>
          {bet.result}
        </span>
      </div>

      {/* Odds / Stake */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="text-zinc-400 font-mono font-bold">{fmtOdds(bet.odds)}</span>
        <span className="text-zinc-500">Risk: <span className="text-white font-medium">{fmtStake(risk)}</span></span>
        <span className="text-zinc-500">To Win: <span className="text-emerald-400 font-medium">{fmtStake(toWin)}</span></span>
      </div>

      {/* Notes */}
      {bet.notes && (
        <p className="text-xs text-zinc-500 italic border-l-2 border-zinc-700 pl-2">{bet.notes}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-1.5 flex-wrap">
          {(["WIN", "LOSS", "PUSH"] as Result[]).map(r => (
            <button type="button" key={r}
              onClick={() => onResult(bet.id, r)}
              className={`text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-md border transition-all ${
                bet.result === r ? resultBg(r) : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 bg-transparent"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onEdit(bet)}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
          <button type="button" onClick={() => onDelete(bet.id)}
            className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BetTracker() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading } = useAppAuth();

  useEffect(() => {
    if (!authLoading && !appUser) navigate("/");
  }, [authLoading, appUser, navigate]);

  const role      = appUser?.role ?? "user";
  const canAccess = ["owner", "admin", "handicapper"].includes(role);

  // ── Stake mode ────────────────────────────────────────────────────────────
  const [stakeMode, setStakeMode] = useState<StakeMode>(() => {
    try { return (localStorage.getItem("bt_stakeMode") as StakeMode) || "$"; } catch { return "$"; }
  });
  const [unitSize, setUnitSize] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem("bt_unitSize") || "100"); } catch { return 100; }
  });

  useEffect(() => { try { localStorage.setItem("bt_stakeMode", stakeMode); } catch {} }, [stakeMode]);
  useEffect(() => { try { localStorage.setItem("bt_unitSize", String(unitSize)); } catch {} }, [unitSize]);

  // ── Sport / filter state ──────────────────────────────────────────────────
  const [activeSport, setActiveSport]     = useState<Sport>("MLB");
  const [filterDate, setFilterDate]       = useState(todayEst);
  const [filterResult, setFilterResult]   = useState<Result | "">("");

  // ── Form state ────────────────────────────────────────────────────────────
  const [formDate, setFormDate]           = useState(todayEst);
  const [formGame, setFormGame]           = useState<SlateGame | null>(null);
  const [formTimeframe, setFormTimeframe] = useState<Timeframe>("FULL_GAME");
  const [formMarket, setFormMarket]       = useState<Market>("ML");
  const [formPickSide, setFormPickSide]   = useState<PickSide>("AWAY");
  const [formOdds, setFormOdds]           = useState("");
  const [formRisk, setFormRisk]           = useState("2");   // default 2 units
  const [formNotes, setFormNotes]         = useState("");
  const [formError, setFormError]         = useState("");

  // Edit / delete modal
  const [editBet, setEditBet]           = useState<TrackedBet | null>(null);
  const [editNotes, setEditNotes]       = useState("");
  const [editResult, setEditResult]     = useState<Result>("PENDING");
  const [deleteId, setDeleteId]         = useState<number | null>(null);

  // Auto-grade toast
  const [gradeToast, setGradeToast] = useState<{ graded: number; wins: number; losses: number; pushes: number; stillPending: number } | null>(null);

  // ── Derived values ────────────────────────────────────────────────────────
  const oddsNum = parseInt(formOdds, 10);
  const riskNum = parseFloat(formRisk);

  /**
   * toWin calculation:
   *   - In $ mode: risk is dollars → toWin is dollars
   *   - In U mode: risk is units → toWin is units
   *   Both use the same formula; the "unit" is just the input value.
   */
  const toWinCalc = useMemo(() => {
    if (!isNaN(oddsNum) && oddsNum !== 0 && !isNaN(riskNum) && riskNum > 0) {
      return calcToWin(oddsNum, riskNum);
    }
    return null;
  }, [oddsNum, riskNum]);

  // Risk label
  const riskLabel = stakeMode === "$" ? "Risk $" : "Risk (u)";
  const toWinLabel = stakeMode === "$" ? "To Win $" : "To Win (u)";

  // Format toWin for display (same unit as risk input)
  function fmtToWin(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(n);  // n is already in units
  }

  // Format stake for bet cards (convert stored dollar amount to units if needed)
  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  // Sport-aware timeframe options
  const timeframeOptions = TIMEFRAMES_BY_SPORT[activeSport];

  // Reset timeframe when sport changes
  useEffect(() => {
    setFormTimeframe("FULL_GAME");
  }, [activeSport]);

  // Reset game + pickSide when date or sport changes
  useEffect(() => {
    setFormGame(null);
    setFormPickSide("AWAY");
    setFormOdds("");
  }, [formDate, activeSport]);

  // Reset pickSide when market changes
  useEffect(() => {
    const newSide: PickSide = formMarket === "TOTAL" ? "OVER" : "AWAY";
    setFormPickSide(newSide);
    // Auto-fill odds for new market + new side
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, newSide);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formMarket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill odds when game, market, or pickSide changes
  useEffect(() => {
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, formPickSide);
      console.log(`[BetTracker][STATE] auto-fill odds: game=${formGame.awayTeam}@${formGame.homeTeam} market=${formMarket} side=${formPickSide} → odds=${o}`);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formGame, formMarket, formPickSide]);

  // ── tRPC ──────────────────────────────────────────────────────────────────
  const slateQuery = trpc.betTracker.getSlate.useQuery(
    { sport: activeSport, gameDate: formDate },
    { enabled: canAccess, staleTime: 4 * 60 * 1000, retry: 1 }
  );

  const listQuery = trpc.betTracker.list.useQuery(
    { sport: activeSport, gameDate: filterDate || undefined, result: filterResult || undefined },
    { enabled: canAccess }
  );

  const statsQuery = trpc.betTracker.getStats.useQuery(
    { sport: activeSport, gameDate: filterDate || undefined },
    { enabled: canAccess }
  );

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

  // ── Game selection ────────────────────────────────────────────────────────
  const slateGames = (slateQuery.data ?? []) as SlateGame[];

  const handleGameSelect = useCallback((game: SlateGame) => {
    console.log(`[BetTracker][INPUT] game selected: id=${game.id} ${game.awayTeam}@${game.homeTeam} odds=${JSON.stringify(game.odds)}`);
    setFormGame(game);
    setFormPickSide("AWAY");
    // Auto-fill ML odds for away by default
    const o = getPickOdds(game.odds, formMarket, "AWAY");
    setFormOdds(o !== null ? String(o) : "");
  }, [formMarket]);

  // ── Pick side selection ───────────────────────────────────────────────────
  const handlePickSide = useCallback((side: PickSide) => {
    console.log(`[BetTracker][INPUT] pick side: ${side} market=${formMarket}`);
    setFormPickSide(side);
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, side);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formGame, formMarket]);

  // ── Pick buttons for current market ──────────────────────────────────────
  const pickButtons = useMemo(() => {
    if (!formGame) return null;
    const { odds, awayTeam, homeTeam, awayLogo, homeLogo, awayNickname, homeNickname } = formGame;

    if (formMarket === "TOTAL") {
      const overLine  = getPickLine(odds, "TOTAL", "OVER");
      const underLine = getPickLine(odds, "TOTAL", "UNDER");
      return (
        <div className="flex gap-2">
          <PickButton
            selected={formPickSide === "OVER"}
            onClick={() => handlePickSide("OVER")}
            odds={odds?.over?.odds ?? null}
            line={overLine}
            side="OVER"
          />
          <PickButton
            selected={formPickSide === "UNDER"}
            onClick={() => handlePickSide("UNDER")}
            odds={odds?.under?.odds ?? null}
            line={underLine}
            side="UNDER"
          />
        </div>
      );
    }

    // ML or RL
    const awayOdds = formMarket === "ML" ? (odds?.awayMl?.odds ?? null) : (odds?.awayRl?.odds ?? null);
    const homeOdds = formMarket === "ML" ? (odds?.homeMl?.odds ?? null) : (odds?.homeRl?.odds ?? null);
    const awayLine = formMarket === "RL" ? (odds?.awayRl?.value ?? null) : null;
    const homeLine = formMarket === "RL" ? (odds?.homeRl?.value ?? null) : null;

    return (
      <div className="flex gap-2">
        <PickButton
          selected={formPickSide === "AWAY"}
          onClick={() => handlePickSide("AWAY")}
          logo={awayLogo}
          teamAbbr={awayTeam}
          teamNickname={awayNickname}
          odds={awayOdds}
          line={awayLine}
          side="AWAY"
        />
        <PickButton
          selected={formPickSide === "HOME"}
          onClick={() => handlePickSide("HOME")}
          logo={homeLogo}
          teamAbbr={homeTeam}
          teamNickname={homeNickname}
          odds={homeOdds}
          line={homeLine}
          side="HOME"
        />
      </div>
    );
  }, [formGame, formMarket, formPickSide, handlePickSide]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setFormError("");

    if (!formGame) { setFormError("Select a game from the slate."); return; }
    if (isNaN(oddsNum) || oddsNum === 0) { setFormError("Enter valid American odds (e.g. -110, +145)."); return; }
    if (isNaN(riskNum) || riskNum <= 0)  { setFormError(`Enter a valid ${stakeMode === "U" ? "unit" : "dollar"} amount.`); return; }

    // In unit mode: convert units to dollars for storage (risk × unitSize)
    const riskDollars  = stakeMode === "U" ? riskNum * unitSize : riskNum;
    const toWinDollars = stakeMode === "U" ? (toWinCalc ?? 0) * unitSize : (toWinCalc ?? calcToWin(oddsNum, riskNum));

    console.log(`[BetTracker][INPUT] submit: game=${formGame.awayTeam}@${formGame.homeTeam} timeframe=${formTimeframe} market=${formMarket} pickSide=${formPickSide} odds=${oddsNum} risk=${riskNum}${stakeMode}(=$${riskDollars}) toWin=${toWinCalc}${stakeMode}(=$${toWinDollars})`);

    // Derive the line value for RL/Total bets from the AN slate odds
    let linePick: number | undefined = undefined;
    if (formGame?.odds) {
      const lv = getPickLine(formGame.odds, formMarket, formPickSide);
      if (lv !== null && lv !== undefined) linePick = Math.abs(lv);
    }
    console.log(`[BetTracker][STATE] submit: linePick=${linePick ?? "N/A"} (market=${formMarket} side=${formPickSide})`);

    await createMut.mutateAsync({
      anGameId:  formGame.id,
      sport:     activeSport,
      gameDate:  formDate,
      awayTeam:  formGame.awayTeam,
      homeTeam:  formGame.homeTeam,
      timeframe: formTimeframe,
      market:    formMarket,
      pickSide:  formPickSide,
      odds:      oddsNum,
      risk:      riskDollars,
      toWin:     toWinDollars,
      line:      linePick,
      notes:     formNotes || undefined,
    });

    console.log(`[BetTracker][OUTPUT] submit: SUCCESS — bet created`);

    // Reset form (keep date + sport + stake mode)
    setFormGame(null);
    setFormTimeframe("FULL_GAME");
    setFormMarket("ML");
    setFormPickSide("AWAY");
    setFormOdds("");
    setFormRisk("2");
    setFormNotes("");
  };

  // ── Quick result ──────────────────────────────────────────────────────────
  const handleResult = async (id: number, result: Result) => {
    await updateMut.mutateAsync({ id, result });
  };

  // ── Edit save ─────────────────────────────────────────────────────────────
  const handleEditSave = async () => {
    if (!editBet) return;
    await updateMut.mutateAsync({ id: editBet.id, notes: editNotes, result: editResult });
    setEditBet(null);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = statsQuery.data ?? {
    totalBets: 0, wins: 0, losses: 0, pushes: 0, pending: 0,
    totalRisk: 0, netProfit: 0, roi: 0,
  };

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

  const bets = listQuery.data ?? [];

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
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

            {/* MARKET */}
            <SelectField
              label={`Market — ${MARKET_LABELS[activeSport][formMarket]}`}
              value={formMarket}
              onChange={v => setFormMarket(v as Market)}
              options={(["ML", "RL", "TOTAL"] as Market[]).map(m => ({
                value: m,
                label: MARKET_LABELS[activeSport][m],
              }))}
            />

            {/* PICK — logo buttons */}
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

            {/* ODDS + RISK + TO WIN */}
            <div className="grid grid-cols-3 gap-3">
              {/* ODDS */}
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

              {/* RISK */}
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

              {/* TO WIN (auto-calc) */}
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

            {/* Unit math explainer (U mode only) */}
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
              <div className="flex flex-col gap-1">
                <label className="text-[10px] tracking-widest text-zinc-500 uppercase font-medium">Filter Date</label>
                <input
                  type="date"
                  value={filterDate}
                  onChange={e => setFilterDate(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>
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
                {/* Grade Bets button — runs autoGrade for current sport + date */}
                <button type="button" onClick={() => {
                    console.log(`[BetTracker][INPUT] Grade Bets clicked: sport=${activeSport} date=${filterDate}`);
                    autoGradeMut.mutate({ sport: activeSport, gameDate: filterDate || undefined });
                  }}
                  disabled={autoGradeMut.isPending || bets.filter((b: TrackedBet) => b.result === "PENDING").length === 0}
                  title="Auto-grade all pending bets using official league scores"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold tracking-wider hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {autoGradeMut.isPending
                    ? <><RefreshCw size={11} className="animate-spin" /> Grading…</>
                    : <><Zap size={11} /> GRADE BETS</>}
                </button>
              </div>
            </div>

            {/* Bet cards */}
            {listQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : bets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <Clock size={28} className="text-zinc-700" />
                <p className="text-zinc-500 text-sm">No bets tracked yet for {activeSport} on {fmtDate(filterDate)}.</p>
                <p className="text-zinc-600 text-xs">Use the form to add your first bet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bets.map((bet: TrackedBet) => (
                  <BetCard
                    key={bet.id}
                    bet={bet}
                    stakeMode={stakeMode}
                    unitSize={unitSize}
                    onResult={handleResult}
                    onDelete={id => setDeleteId(id)}
                    onEdit={b => { setEditBet(b); setEditNotes(b.notes ?? ""); setEditResult(b.result as Result); }}
                  />
                ))}
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

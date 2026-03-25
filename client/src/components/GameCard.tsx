/**
 * GameCard — Model Projection Card
 *
 * Layout (desktop ≥ lg):
 *   ┌──────────────────┬──────────────────────────────┬──────────────────┐
 *   │  SCORE PANEL     │  ODDS/LINES                  │  BETTING SPLITS  │
 *   │  Clock/Status    │  Column headers              │                  │
 *   │  Away logo+name  │  Away row                    │                  │
 *   │  [score]         │  Home row                    │                  │
 *   │  Home logo+name  │  Edge verdict                │                  │
 *   │  [score]         │                              │                  │
 *   └──────────────────┴──────────────────────────────┴──────────────────┘
 *
 * Layout (mobile < lg):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  SCORE PANEL  (full width, top row)                               │
 *   ├─────────────────────────────┬──────────────────────────────────────┤
 *   │  ODDS/LINES (left)          │  BETTING SPLITS (right)             │
 *   └─────────────────────────────┴──────────────────────────────────────┘
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc";
import { getTeamByDbSlug } from "@shared/ncaamTeams";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";
import { NHL_BY_DB_SLUG } from "@shared/nhlTeams";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { BettingSplitsPanel } from "./BettingSplitsPanel";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GameRow = RouterOutput["games"]["list"][number];

// ── Time formatting ───────────────────────────────────────────────────────────
// NCAAM uses PST (Pacific Standard Time) to avoid midnight confusion for
// late-night West Coast games. NBA and NHL use EST.
function formatMilitaryTime(time: string, sport?: string): string {
  const upper = time?.toUpperCase() ?? "";
  if (!time || upper === "TBD" || upper === "TBA" || !time.includes(":")) return "TBD";
  // Handle already-formatted 12-hour strings like "7:05 PM ET" or "12:15 PM ET"
  const already12h = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
  if (already12h) {
    const h = parseInt(already12h[1], 10);
    const m = already12h[2];
    const ap = already12h[3].toUpperCase();
    const tz = sport === "NCAAM" ? "PST" : "ET";
    return `${h}:${m} ${ap} ${tz}`;
  }
  // Military time format (e.g. "19:05")
  const parts = time.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1]?.slice(0, 2) ?? "00";
  if (isNaN(hours)) return "TBD";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  // NCAAM uses PST; NBA, NHL, and MLB use ET
  const tz = sport === "NCAAM" ? "PST" : "ET";
  return `${hours}:${minutes} ${ampm} ${tz}`;
}

// ── Date formatting ───────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ── Edge Calculation Engine (spec-compliant) ─────────────────────────────────
//
// RULE: Edge lives in the juice, not the line.
// The line tells you what you're betting. The juice tells you what you're paying.
// Edge = modelImplied - bookImplied (expressed as percentage points)
//
// Each market (spread, total, ML) is independent — never averaged, never combined.
// Recalculate on every render (derived state, not stored state).

/** Convert American odds to implied probability (raw, with vig). */
function americanToImplied(odds: number): number {
  if (isNaN(odds)) return NaN;
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

/**
 * Calculate edge in percentage points.
 * Positive = model likes this bet over book price.
 * Negative = book is more efficient than model here.
 * Returns NaN if either input is NaN (missing data).
 */
function calculateEdge(bookOdds: number, modelOdds: number): number {
  const bookImplied  = americanToImplied(bookOdds);
  const modelImplied = americanToImplied(modelOdds);
  if (isNaN(bookImplied) || isNaN(modelImplied)) return NaN;
  return (modelImplied - bookImplied) * 100;
}

/** 6-tier verdict from edge pp value. */
function getVerdict(edge: number): string {
  if (isNaN(edge)) return '—';
  if (edge >= 8)    return 'ELITE';
  if (edge >= 5)    return 'STRONG';
  if (edge >= 2.5)  return 'PLAYABLE';
  if (edge >= 0.5)  return 'SMALL';
  if (edge >= -1)   return 'NEUTRAL';
  return 'FADE';
}

/** Color for a given edge pp value (spec-compliant 6-tier scale). */
function getEdgeColor(edge: number): string {
  if (isNaN(edge))  return 'rgba(255,255,255,0.30)';
  if (edge >= 8)    return '#39FF14';   // ELITE   — full neon green
  if (edge >= 5)    return '#7FFF00';   // STRONG  — chartreuse
  if (edge >= 2.5)  return '#ADFF2F';   // PLAYABLE — yellow-green
  if (edge >= 0.5)  return 'rgba(255,255,255,0.60)';  // SMALL — white/60
  if (edge >= -1)   return 'rgba(255,255,255,0.30)';  // NEUTRAL — white/30
  return '#FF2244';                     // FADE    — red
}


// ── Spread sign helper ────────────────────────────────────────────────────────
function spreadSign(n: number): string {
  if (isNaN(n)) return "—";
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

// ── toNum helper ──────────────────────────────────────────────────────────────
function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  return typeof v === "number" ? v : parseFloat(v);
}

// ── Parse ROI% from edge label ───────────────────────────────────────────────
// Label format: "HIGH | TCU +2.5 | 56.12% | +3.74% vs BE | 7.13% ROI"
function parseRoiFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/([\d.]+)%\s*ROI/);
  return m ? parseFloat(m[1]) : null;
}

// Parse the betting side from the label (e.g. "TCU +2.5" or "OVER 145.5")
function parseSideFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const parts = label.split('|');
  if (parts.length < 2) return null;
  return parts[1].trim();
}

// ── Normalize edge label ──────────────────────────────────────────────────────
function normalizeEdgeLabel(label: string | null | undefined): string {
  if (!label || label.toUpperCase() === "PASS") return "PASS";
  return label.replace(/^([a-z][a-z0-9_]*)(\s+\()/i, (_, slug, rest) => {
    const ncaa = getTeamByDbSlug(slug);
    if (ncaa) return ncaa.ncaaName + rest;
    const nba = getNbaTeamByDbSlug(slug);
    if (nba) return nba.name + rest;
    return slug.replace(/_/g, " ") + rest;
  });
}

// ── TeamLogo ──────────────────────────────────────────────────────────────────
function TeamLogo({ slug, name, logoUrl, size = 36 }: { slug: string; name: string; logoUrl?: string; size?: number }) {
  const [error, setError] = useState(false);
  // Use CSS clamp so logos scale proportionally with viewport width
  // size prop acts as the "base" for the clamp midpoint (in vw units)
  const vwRatio = (size / 16).toFixed(2); // convert px to approximate vw
  const cssSize = `clamp(${Math.round(size * 0.7)}px, ${vwRatio}vw, ${Math.round(size * 1.5)}px)`;
  if (!logoUrl || error) {
    return (
      <div
        className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
        style={{
          width: cssSize, height: cssSize,
          minWidth: Math.round(size * 0.7), minHeight: Math.round(size * 0.7),
          background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
          fontSize: `clamp(${Math.max(7, Math.round(size * 0.2))}px, ${(size * 0.018).toFixed(2)}vw, ${Math.round(size * 0.32)}px)`,
        }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={name}
      style={{ width: cssSize, height: cssSize, minWidth: Math.round(size * 0.7), minHeight: Math.round(size * 0.7), objectFit: "contain", mixBlendMode: "screen", flexShrink: 0 }}
      onError={() => setError(true)}
    />
  );
}

// ── useAutoFontSize ─────────────────────────────────────────────────────────
/**
 * Measures the actual rendered width of a text string at a given font size
 * using an off-screen Canvas context (no DOM reflow, sub-millisecond).
 * Returns the minimum font size (px) at which the text fits within maxWidth.
 *
 * Algorithm:
 *   1. Start at maxFontSize and step down by 0.5px increments.
 *   2. At each size, measure text width with Canvas measureText.
 *   3. Return the first size where textWidth ≤ maxWidth.
 *   4. If even minFontSize overflows, return minFontSize (text will wrap
 *      gracefully via overflowWrap: anywhere).
 *
 * Debug logging (console group [AutoFontSize]) fires whenever the computed
 * size changes, reporting: name, container width, text width at each tried
 * size, and the final chosen size.
 */
const _autoFontCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const _autoFontCtx = _autoFontCanvas?.getContext("2d") ?? null;

function measureTextWidth(text: string, fontPx: number, fontWeight: number): number {
  if (!_autoFontCtx) return 0;
  _autoFontCtx.font = `${fontWeight} ${fontPx}px Inter, system-ui, sans-serif`;
  return _autoFontCtx.measureText(text).width;
}

function computeAutoFontSize(
  text: string,
  containerWidth: number,
  fontWeight: number,
  maxFontPx: number,
  minFontPx: number,
  debugLabel?: string
): number {
  if (containerWidth <= 0 || !text) return maxFontPx;
  const STEP = 0.5;
  let chosen = minFontPx;
  const triedSizes: { size: number; textWidth: number }[] = [];
  for (let size = maxFontPx; size >= minFontPx; size -= STEP) {
    const tw = measureTextWidth(text, size, fontWeight);
    triedSizes.push({ size: parseFloat(size.toFixed(1)), textWidth: parseFloat(tw.toFixed(1)) });
    if (tw <= containerWidth) {
      chosen = size;
      break;
    }
  }
  // Debug: only log when the chosen size is below maxFontPx (i.e. scaling kicked in)
  if (chosen < maxFontPx - 0.5 && debugLabel) {
    console.groupCollapsed(
      `%c[AutoFontSize] "${text}" → ${chosen.toFixed(1)}px (container=${containerWidth}px)`,
      "color:#39FF14;font-weight:700;font-size:10px"
    );
    console.log(`  label        : ${debugLabel}`);
    console.log(`  containerW   : ${containerWidth}px`);
    console.log(`  maxFont      : ${maxFontPx}px  minFont: ${minFontPx}px`);
    console.log(`  chosen       : ${chosen.toFixed(1)}px`);
    console.log(`  sizes tried  :`, triedSizes.slice(0, 20)); // cap at 20 entries
    console.groupEnd();
  }
  return chosen;
}

/**
 * React hook: returns a [ref, fontSize] pair.
 * Attach `ref` to the container element whose width constrains the text.
 * `fontSize` is the largest px value at which `text` fits in one line.
 */
function useAutoFontSize(
  text: string,
  fontWeight: number,
  maxFontPx: number,
  minFontPx: number,
  debugLabel?: string
): [React.RefObject<HTMLDivElement | null>, number] {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(maxFontPx);

  const recompute = useCallback((width: number) => {
    const next = computeAutoFontSize(text, width, fontWeight, maxFontPx, minFontPx, debugLabel);
    setFontSize(prev => {
      if (Math.abs(prev - next) < 0.25) return prev; // avoid micro-updates
      return next;
    });
  }, [text, fontWeight, maxFontPx, minFontPx, debugLabel]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Initial measure
    recompute(el.getBoundingClientRect().width);
    // Watch for container resize
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      recompute(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [recompute]);

  return [containerRef, fontSize];
}

// ── MobileTeamNameBlock ─────────────────────────────────────────────────────
/**
 * Renders the school name + nickname stacked vertically inside the frozen
 * left panel (used on both mobile and desktop).
 *
 * Font sizes are UNIFORM across all teams — based on viewport width only.
 * No truncation — full name always visible. Container expands to fit content.
 *
 * School name: clamp(13px, 1.1vw, 18px) — 13px mobile, ~15.8px at 1440px, 18px max
 * Nickname:    clamp(11px, 0.9vw, 15px) — always smaller than school name
 */
function MobileTeamNameBlock({
  schoolName,
  nickname,
  isWinner,
  isFinalGame,
}: {
  schoolName: string;
  nickname?: string;
  isWinner: boolean;
  isFinalGame: boolean;
}) {
  const displayName = schoolName;

  // Uniform fluid font sizes — same for every team, scale with viewport width
  const NAME_FONT = 'clamp(13px, 1.1vw, 18px)';
  const NICK_FONT = 'clamp(11px, 0.9vw, 15px)';

  return (
    <div
      className="flex flex-col"
      style={{ lineHeight: 1.25 }}
    >
      <span style={{
        fontSize: NAME_FONT,
        fontWeight: 700,
        color: '#ffffff',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {displayName}
      </span>
      {nickname && (
        <span
          style={{
            fontSize: NICK_FONT,
            fontWeight: 600,
            color: '#ffffff',
            letterSpacing: '0.02em',
            textTransform: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {nickname}
        </span>
      )}
    </div>
  );
}

// ── VerdictSide ───────────────────────────────────────────────────────────────
function VerdictSide({ diff, label, isStrong, logoUrl, teamSlug, teamName, compact = false }: {
  diff: number | null;
  label: string | null;
  isStrong: boolean;
  logoUrl?: string;
  teamSlug?: string;
  teamName?: string;
  compact?: boolean;
}) {
  const normalized = normalizeEdgeLabel(label);
  const isPass = normalized === "PASS" || (diff ?? 0) <= 0;
  const color = getEdgeColor(diff ?? 0);
  // Parse ROI% and side label from the full edge string
  const roi = parseRoiFromLabel(label);
  const sideLabel = parseSideFromLabel(label);

  if (isPass) {
    return (
      <div className="flex flex-col items-center gap-0.5 py-0.5">
        <span className="text-[11px] font-medium tracking-wide" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
          PASS
        </span>
      </div>
    );
  }

  if (compact) {
    // Compact inline version: side label + ROI% on one line
    const showArrow = (diff ?? 0) >= 3;
    const displayLabel = sideLabel ?? normalized;
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5">
        {(logoUrl || teamSlug) && (
          <TeamLogo slug={teamSlug ?? ""} name={teamName ?? ""} logoUrl={logoUrl} size={16} />
        )}
        <span className="font-bold leading-none whitespace-nowrap uppercase tracking-wide text-[11px]" style={{ color: "hsl(var(--foreground))" }}>
          {showArrow && <span className="mr-0.5 text-[9px]" style={{ color }}>▲</span>}
          {displayLabel}
        </span>
        {roi !== null ? (
          <span className="text-[10px] leading-none font-extrabold" style={{ color }}>
            {roi.toFixed(2)}% ROI
          </span>
        ) : (
          <span className="text-[10px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
            <span style={{ color, fontWeight: 800 }}>{diff}{diff === 1 ? "PT" : "PTS"}</span>
          </span>
        )}
      </div>
    );
  }

  const betNameSize = isStrong ? "17px" : "15px";
  const showArrow = (diff ?? 0) >= 3;
  const displayLabel = sideLabel ?? normalized;

  return (
    <div className="flex flex-col items-center gap-1 py-0.5">
      <div className="flex items-center gap-1.5">
        {(logoUrl || teamSlug) && (
          <TeamLogo slug={teamSlug ?? ""} name={teamName ?? ""} logoUrl={logoUrl} size={22} />
        )}
        <span className="font-bold leading-none whitespace-nowrap uppercase tracking-wide" style={{ fontSize: betNameSize, color: "hsl(var(--foreground))" }}>
          {showArrow && <span className="mr-0.5 text-[10px]" style={{ color }}>▲</span>}
          {displayLabel}
        </span>
      </div>
      {roi !== null ? (
        <span className="text-[13px] leading-none font-extrabold" style={{ color }}>
          {roi.toFixed(2)}% ROI
        </span>
      ) : (
        <span className="text-[13px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
          EDGE:{" "}
          <span style={{ color, fontWeight: 800 }}>{diff} {diff === 1 ? "PT" : "PTS"}</span>
        </span>
      )}
    </div>
  );
}

// ── EdgeVerdict ───────────────────────────────────────────────────────────────
function EdgeVerdict({
  spreadDiff, spreadEdge, totalDiff, totalEdge,
  awayLogoUrl, homeLogoUrl, awaySlug, homeSlug, awayDisplayName, homeDisplayName,
  compact = false,
}: {
  spreadDiff: number | null; spreadEdge: string | null;
  totalDiff: number | null; totalEdge: string | null;
  awayLogoUrl?: string; homeLogoUrl?: string;
  awaySlug?: string; homeSlug?: string;
  awayDisplayName?: string; homeDisplayName?: string;
  compact?: boolean;
}) {
  const spreadPass = normalizeEdgeLabel(spreadEdge) === "PASS" || (spreadDiff ?? 0) <= 0;
  const totalPass  = normalizeEdgeLabel(totalEdge)  === "PASS" || (totalDiff ?? 0)  <= 0;

  if (spreadPass && totalPass) {
    return (
      <div className="mt-2 pt-2 flex items-center justify-center" style={{ borderTop: "1px solid hsl(var(--border))" }}>
        <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
          PASS
        </span>
      </div>
    );
  }

  const spreadIsStronger = (spreadDiff ?? 0) >= (totalDiff ?? 0);

  // Determine which team logo to show for the spread edge
  // The spread edge label starts with the team's display name
  const spreadEdgeIsAway = spreadEdge && awayDisplayName
    ? normalizeEdgeLabel(spreadEdge).toLowerCase().startsWith(awayDisplayName.toLowerCase())
    : false;
  const spreadLogoUrl = spreadEdgeIsAway ? awayLogoUrl : homeLogoUrl;
  const spreadSlug = spreadEdgeIsAway ? awaySlug : homeSlug;
  const spreadTeamName = spreadEdgeIsAway ? awayDisplayName : homeDisplayName;

  if (compact) {
    // Compact horizontal layout: spread edge | divider | total edge, all on one row
    return (
      <div className="flex items-center justify-center gap-0 w-full py-0 my-0">
        {!spreadPass && (
          <VerdictSide
            diff={spreadDiff}
            label={spreadEdge}
            isStrong={spreadIsStronger && !spreadPass}
            logoUrl={spreadLogoUrl}
            teamSlug={spreadSlug}
            teamName={spreadTeamName}
            compact
          />
        )}
        {!spreadPass && !totalPass && (
          <div style={{ width: 1, height: 24, background: "hsl(var(--border) / 0.5)", flexShrink: 0 }} />
        )}
        {!totalPass && (
          <VerdictSide diff={totalDiff} label={totalEdge} isStrong={!spreadIsStronger && !totalPass} compact />
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 flex flex-col gap-2" style={{ borderTop: "1px solid hsl(var(--border))" }}>
      {!spreadPass && (
        <div className="flex items-center justify-center">
          <VerdictSide
            diff={spreadDiff}
            label={spreadEdge}
            isStrong={spreadIsStronger && !spreadPass}
            logoUrl={spreadLogoUrl}
            teamSlug={spreadSlug}
            teamName={spreadTeamName}
          />
        </div>
      )}
      {!totalPass && (
        <div className="flex items-center justify-center">
          <VerdictSide diff={totalDiff} label={totalEdge} isStrong={!spreadIsStronger && !totalPass} />
        </div>
      )}
    </div>
  );
}

// ── DesktopMergedPanel ───────────────────────────────────────────────────────
// Desktop-only (≥ lg) unified panel: merges ODDS + SPLITS into a single table.
// Layout per section (SPREAD | TOTAL | MONEYLINE):
//   Section header
//   BOOK row (away / home)
//   Tickets split bar
//   Handle split bar
//   MODEL row (away / home, neon green for edge)
// Plus EdgeVerdict column on the far right.
// Mobile/tablet: this component is NEVER rendered (hidden lg:flex wraps it).

// ── Inline split bar for DesktopMergedPanel ───────────────────────────────────
const MERGED_LABEL_STROKE = '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 6px rgba(0,0,0,0.9)';

function MergedSplitBar({
  awayPct, homePct, awayColor, homeColor, rowLabel, awayLabel, homeLabel,
}: {
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
  rowLabel: string;
  awayLabel?: string;
  homeLabel?: string;
}) {
  const hasData = awayPct != null && homePct != null;
  const headerLabelStyle: React.CSSProperties = {
    fontSize: 'clamp(8px, 0.65vw, 10px)',
    color: '#FFFFFF',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
  const teamLabelStyle: React.CSSProperties = {
    fontSize: 'clamp(8px, 0.68vw, 11px)',
    color: 'rgba(255,255,255,0.55)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '38%',
  };
  return (
    <div className="flex flex-col w-full" style={{ gap: 2 }}>
      {/* Row label line: away label | TICKETS/MONEY | home label */}
      <div className="flex items-center justify-between" style={{ gap: 4 }}>
        <span style={teamLabelStyle}>{awayLabel ?? ''}</span>
        <span style={headerLabelStyle}>{rowLabel}</span>
        <span style={{ ...teamLabelStyle, textAlign: 'right' }}>{homeLabel ?? ''}</span>
      </div>
      {/* Bar */}
      {hasData ? (() => {
        const away = awayPct!;
        const home = homePct!;
        const isAwayFull = away >= 100;
        const isHomeFull = home >= 100;
        // letterSpacing: was 0.2em, decreased by 0.2 → 0em (no uniform spacing)
        // The 0.1 gap before % is handled by inserting a thin-space (U+2009) before % in the rendered text
        const segLabel: React.CSSProperties = {
          fontSize: 'clamp(10px, 0.85vw, 13px)',
          color: '#fff',
          fontWeight: 800,
          whiteSpace: 'nowrap',
          textShadow: MERGED_LABEL_STROKE,
          lineHeight: 1,
          letterSpacing: '0em',
        };
        return (
          <div style={{
            height: 'clamp(22px, 2.2vw, 32px)',
            display: 'flex',
            borderRadius: '9999px',
            border: '1px solid rgba(255,255,255,0.12)',
            overflow: 'hidden',
            width: '100%',
          }}>
            {away > 0 && !isHomeFull && (
              <div style={{
                flexGrow: isAwayFull ? 1 : away,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: away < 10 ? 36 : 30,
                background: awayColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                paddingLeft: 'clamp(4px,0.4vw,8px)',
                paddingRight: 'clamp(4px,0.4vw,8px)',
                borderRadius: isAwayFull ? '9999px' : '9999px 0 0 9999px',
              }} className="transition-all duration-700">
                {/* thin-space U+2009 before % = 0.1em gap between digit and % symbol */}
                <span style={{ ...segLabel, textAlign: 'left' }}>{away} %</span>
              </div>
            )}
            {!isAwayFull && !isHomeFull && away > 0 && home > 0 && (
              <div style={{ width: 1, background: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
            )}
            {home > 0 && !isAwayFull && (
              <div style={{
                flexGrow: isHomeFull ? 1 : home,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: home < 10 ? 36 : 30,
                background: homeColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingLeft: 'clamp(4px,0.4vw,8px)',
                paddingRight: 'clamp(4px,0.4vw,8px)',
                borderRadius: isHomeFull ? '9999px' : '0 9999px 9999px 0',
              }} className="transition-all duration-700">
                <span style={{ ...segLabel, textAlign: 'right' }}>{home} %</span>
              </div>
            )}
            {isAwayFull && (
              <div style={{ flex: 1, background: awayColor, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px' }}>
                <span style={{ ...segLabel, textAlign: 'center' }}>100 %</span>
              </div>
            )}
            {isHomeFull && (
              <div style={{ flex: 1, background: homeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px' }}>
                <span style={{ ...segLabel, textAlign: 'center' }}>100 %</span>
              </div>
            )}
          </div>
        );
      })() : (
        <div style={{ height: 'clamp(22px,2.2vw,32px)', background: 'rgba(255,255,255,0.05)', borderRadius: '9999px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', opacity: 0.35 }}>—</span>
        </div>
      )}
    </div>
  );
}

interface DesktopMergedPanelProps {
  // Book values
  awayBookSpread: number;
  homeBookSpread: number;
  bookTotal: number;
  awayML: string;
  homeML: string;
  // Model values
  awayModelSpread: number;
  homeModelSpread: number;
  modelTotal: number;
  modelAwayML: string | null | undefined;
  modelHomeML: string | null | undefined;
  // Edge
  spreadDiff: number;
  totalDiff: number;
  computedSpreadEdge: string | null;
  computedTotalEdge: string | null;
  // Team identity
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  awaySlug?: string;
  homeSlug?: string;
  awayDisplayName?: string;
  homeDisplayName?: string;
  // Model toggle
  showModel: boolean;
  onToggleModel: () => void;
  // Splits data
  game: {
    sport: string | null;
    awayTeam: string;
    homeTeam: string;
    awayBookSpread?: string | null;
    homeBookSpread?: string | null;
    bookTotal?: string | null;
    spreadAwayBetsPct: number | null | undefined;
    spreadAwayMoneyPct: number | null | undefined;
    totalOverBetsPct: number | null | undefined;
    totalOverMoneyPct: number | null | undefined;
    mlAwayBetsPct: number | null | undefined;
    mlAwayMoneyPct: number | null | undefined;
    awayML: string | null | undefined;
    homeML: string | null | undefined;
    awaySpreadOdds?: string | null;
    homeSpreadOdds?: string | null;
    overOdds?: string | null;
    underOdds?: string | null;
    // Open line fields (from AN HTML ingest)
    openAwaySpread?: string | null;
    openHomeSpread?: string | null;
    openAwaySpreadOdds?: string | null;
    openHomeSpreadOdds?: string | null;
    openTotal?: string | null;
    openOverOdds?: string | null;
    openUnderOdds?: string | null;
    openAwayML?: string | null;
    openHomeML?: string | null;
    // Note: DK NJ current lines are in awayBookSpread/homeBookSpread/bookTotal/awayML/homeML
    // (populated by ingestAnHtml from AN HTML best-odds table).
    // NHL model puck line and total odds (from nhl_model_engine.py)
    modelAwayPLOdds?: string | null;
    modelHomePLOdds?: string | null;
    modelOverOdds?: string | null;
    modelUnderOdds?: string | null;
    // NCAAM model fair odds at derived model spread/total line
    modelAwaySpreadOdds?: string | null;
    modelHomeSpreadOdds?: string | null;
  };
}

function DesktopMergedPanel({
  awayBookSpread: awaySpread,
  homeBookSpread: homeSpread,
  bookTotal: bkTotal,
  awayML: awayMl,
  homeML: homeMl,
  awayModelSpread: mdlAwaySpread,
  homeModelSpread: mdlHomeSpread,
  modelTotal: mdlTotal,
  modelAwayML,
  modelHomeML,
  spreadDiff,
  totalDiff,
  computedSpreadEdge,
  computedTotalEdge,
  awayLogoUrl,
  homeLogoUrl,
  awaySlug,
  homeSlug,
  awayDisplayName,
  homeDisplayName,
  showModel,
  onToggleModel,
  game,
}: DesktopMergedPanelProps) {
  // ── Team colors for split bars ────────────────────────────────────────────
  const sport = game.sport ?? 'NCAAM';
  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam: game.awayTeam, homeTeam: game.homeTeam, sport },
    { staleTime: 1000 * 60 * 60 }
  );

  const FALLBACK_AWAY = '#1a4a8a';
  const FALLBACK_HOME = '#c84b0c';

  const isUnusable = (hex: string | null | undefined): boolean => {
    if (!hex) return false;
    const clean = hex.replace(/^#/, '');
    if (clean.length !== 6 && clean.length !== 3) return false;
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum < 0.04 || lum > 0.90;
  };

  const tooSimilar = (hexA: string, hexB: string): boolean => {
    const toRgb = (h: string) => {
      const c = h.replace(/^#/, '');
      const f = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
      return [parseInt(f.slice(0,2),16), parseInt(f.slice(2,4),16), parseInt(f.slice(4,6),16)];
    };
    try {
      const [r1,g1,b1] = toRgb(hexA);
      const [r2,g2,b2] = toRgb(hexB);
      return Math.sqrt((r1-r2)**2+(g1-g2)**2+(b1-b2)**2) < 60;
    } catch { return false; }
  };

  const pickColor = (p: string|null|undefined, s: string|null|undefined, t: string|null|undefined, fb: string): string => {
    for (const c of [p,s,t]) { if (c && !isUnusable(c)) return c; }
    return fb;
  };

  const homeColor = pickColor(colors?.home?.primaryColor, colors?.home?.secondaryColor, colors?.home?.tertiaryColor, FALLBACK_HOME);
  const awayColor = (() => {
    for (const c of [colors?.away?.primaryColor, colors?.away?.secondaryColor, colors?.away?.tertiaryColor, FALLBACK_AWAY]) {
      if (!c) continue;
      if (isUnusable(c)) continue;
      if (!tooSimilar(c, homeColor)) return c;
    }
    return FALLBACK_AWAY;
  })();

  const awayAbbr = colors?.away?.abbrev ?? (awayDisplayName ?? '');
  const homeAbbr = colors?.home?.abbrev ?? (homeDisplayName ?? '');

  // ── Book / Model value strings ────────────────────────────────────────────
  const hasModelData = !isNaN(mdlAwaySpread) || !isNaN(mdlTotal) || (modelAwayML != null && modelAwayML !== '—');

  // Spread odds in parentheses, e.g. "+1.5 (-225)" / "-1.5 (+185)"
  // Only append odds when they exist; omit if null (standard -110 assumed)
  const awaySpreadOddsStr = game.awaySpreadOdds ?? null;
  const homeSpreadOddsStr = game.homeSpreadOdds ?? null;
  const overOddsStr  = game.overOdds ?? null;
  const underOddsStr = game.underOdds ?? null;

  const bkAwaySpread  = !isNaN(awaySpread)
    ? (awaySpreadOddsStr ? `${spreadSign(awaySpread)} (${awaySpreadOddsStr})` : spreadSign(awaySpread))
    : '—';
  const bkHomeSpread  = !isNaN(homeSpread)
    ? (homeSpreadOddsStr ? `${spreadSign(homeSpread)} (${homeSpreadOddsStr})` : spreadSign(homeSpread))
    : '—';
  const bkOver  = !isNaN(bkTotal)
    ? (overOddsStr  ? `${String(bkTotal)} (${overOddsStr})`  : String(bkTotal))
    : '—';
  const bkUnder = !isNaN(bkTotal)
    ? (underOddsStr ? `${String(bkTotal)} (${underOddsStr})` : String(bkTotal))
    : '—';

  // ── Open line strings (from AN HTML ingest) ───────────────────────────────
  // fmtLine: format open line string; normalizeSpread adds '+' to positive spread values
  const normalizeSpread = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const n = parseFloat(s);
    if (!isNaN(n) && n > 0 && !s.startsWith('+')) return `+${s}`;
    return s;
  };
  const fmtLine = (line: string | null | undefined, odds: string | null | undefined): string | null => {
    if (!line) return null;
    return odds ? `${line} (${odds})` : line;
  };
  const openAwaySpreadStr = fmtLine(normalizeSpread(game.openAwaySpread), game.openAwaySpreadOdds);
  const openHomeSpreadStr = fmtLine(normalizeSpread(game.openHomeSpread), game.openHomeSpreadOdds);
  const openOverStr       = fmtLine(game.openTotal, game.openOverOdds);
  const openUnderStr      = fmtLine(game.openTotal, game.openUnderOdds);
  const openAwayMlStr     = game.openAwayML ?? null;
  const openHomeMlStr     = game.openHomeML ?? null;

    // DK NJ lines ARE the primary book columns (awayBookSpread IS the DK line)
  const displayAwaySpread = bkAwaySpread;
  const displayHomeSpread = bkHomeSpread;
  const displayOver       = bkOver;
  const displayUnder      = bkUnder;
  const displayAwayML     = game.awayML ?? '—';
  const displayHomeML     = game.homeML ?? '—';

  // For NHL/NCAAM games, append model odds in parentheses
  const isNhlGame   = game.sport === 'NHL';
  const isNcaamGame = game.sport === 'NCAAM';
  const isMlbGame   = game.sport === 'MLB';
  const mdlAwayPLOdds = game.modelAwayPLOdds ?? null;
  const mdlHomePLOdds = game.modelHomePLOdds ?? null;
  const mdlOverOdds   = game.modelOverOdds ?? null;
  const mdlUnderOdds  = game.modelUnderOdds ?? null;
  // NCAAM model fair odds at book's spread line (computed by Python engine)
  const mdlAwaySpreadOdds = game.modelAwaySpreadOdds ?? null;
  const mdlHomeSpreadOdds = game.modelHomeSpreadOdds ?? null;

  const mdlAwaySpreadStr = hasModelData && !isNaN(mdlAwaySpread)
    ? (isNhlGame && mdlAwayPLOdds
        ? `${spreadSign(mdlAwaySpread)} (${mdlAwayPLOdds})`
        : (isNcaamGame || isMlbGame) && mdlAwaySpreadOdds
          ? `${spreadSign(mdlAwaySpread)} (${mdlAwaySpreadOdds})`
          : spreadSign(mdlAwaySpread))
    : '—';
  const mdlHomeSpreadStr = hasModelData && !isNaN(mdlHomeSpread)
    ? (isNhlGame && mdlHomePLOdds
        ? `${spreadSign(mdlHomeSpread)} (${mdlHomePLOdds})`
        : (isNcaamGame || isMlbGame) && mdlHomeSpreadOdds
          ? `${spreadSign(mdlHomeSpread)} (${mdlHomeSpreadOdds})`
          : spreadSign(mdlHomeSpread))
    : '—';
  // For NHL: display BOOK's total line with model fair odds at that line
  // For NCAAM/MLB: display model's own total with model fair odds at that line
  const mdlDisplayTotal = isNhlGame && !isNaN(bkTotal) ? bkTotal : mdlTotal;
  const mdlOver = hasModelData && !isNaN(mdlDisplayTotal)
    ? ((isNhlGame || isNcaamGame || isMlbGame) && mdlOverOdds
        ? `${String(mdlDisplayTotal)} (${mdlOverOdds})`
        : String(mdlDisplayTotal))
    : '—';
  const mdlUnder = hasModelData && !isNaN(mdlDisplayTotal)
    ? ((isNhlGame || isNcaamGame || isMlbGame) && mdlUnderOdds
        ? `${String(mdlDisplayTotal)} (${mdlUnderOdds})`
        : String(mdlDisplayTotal))
    : '—';
  const mdlAwayMlStr     = hasModelData ? (modelAwayML ?? '—') : '—';
  const mdlHomeMlStr     = hasModelData ? (modelHomeML ?? '—') : '—';

  // ── Edge detection ────────────────────────────────────────────────────────
  // For NHL: puck line is always ±1.5 or ±2.5 from the simulation.
  // Comparing mdlAwaySpread < awaySpread is meaningless (both are ±1.5).
  // Edge direction is determined by the Python engine and stored in computedSpreadEdge.
  const spreadEdgeIsAway = (() => {
    if (isNaN(spreadDiff) || spreadDiff <= 0) return null;
    if (isNhlGame) {
      // For NHL: parse edge direction from computedSpreadEdge string (e.g. "MTL +1.5 [LEAN]")
      // The Python engine sets spreadEdge to the team that has the probability edge.
      // We detect away by checking if the edge string contains the away team name.
      if (!computedSpreadEdge || computedSpreadEdge === 'PASS') return null;
      // computedSpreadEdge format: "TEAM_NAME +1.5 [CLASS]" or "TEAM_NAME -1.5 [CLASS]"
      // Away edge = contains "+1.5" (away is always the underdog getting +1.5)
      return computedSpreadEdge.includes('+1.5') || computedSpreadEdge.includes('+2.5');
    }
    if (!isNaN(mdlAwaySpread) && !isNaN(awaySpread)) return mdlAwaySpread < awaySpread;
    return null;
  })();
  const totalEdgeIsOver = (() => {
    if (isNaN(totalDiff) || totalDiff <= 0) return null;
    // For NHL: edge direction must come from computedTotalEdge (set by Python engine from model odds
    // at the book's line), NOT from comparing model expected total vs book line.
    // The model could have E_total > book line but P(over) < 50% due to distribution shape.
    if (isNhlGame) {
      if (!computedTotalEdge || computedTotalEdge === 'PASS') return null;
      const normalized = computedTotalEdge.toUpperCase();
      if (normalized.startsWith('OVER')) return true;
      if (normalized.startsWith('UNDER')) return false;
      return null;
    }
    if (!isNaN(mdlTotal) && !isNaN(bkTotal)) return mdlTotal > bkTotal;
    return null;
  })();
  const hasSpreadEdge = !isNaN(spreadDiff) && spreadDiff > 0;
  const hasTotalEdge  = !isNaN(totalDiff)  && totalDiff  > 0;

  // ── Style helpers ────────────────────────────────────────────────────────────────────────────────────
  // Typography hierarchy (desktop):
  //   BOOK/MODEL column headers: HDR_FS (the largest)
  //   Value rows: VAL_FS = HDR_FS - 4pt
  //   Abbreviation/OVER/UNDER prefix labels: ABBR_FS = VAL_FS - 1pt
  //   Section title (SPREAD/TOTAL/MONEYLINE): TITLE_FS
  //
  // Using clamp: HDR_FS = clamp(14px,1.15vw,18px), VAL_FS = clamp(10px,0.85vw,14px), ABBR_FS = clamp(9px,0.78vw,13px)
  const HDR_FS  = 'clamp(14px,1.15vw,18px)';  // BOOK / MODEL column header labels
  const VAL_FS  = 'clamp(10px,0.85vw,14px)';  // Value rows (spread, total, ML numbers) — 4pt below HDR
  const ABBR_FS = 'clamp(9px,0.78vw,13px)';   // Abbreviation / OVER / UNDER prefix — 1pt below VAL
  // TITLE_FS must be 1.5pt larger than HDR_FS at every breakpoint:
  // At min (mobile): HDR_FS=14px → TITLE_FS=15.5px
  // At mid (1366px): HDR_FS≈15.7px → TITLE_FS≈17.2px
  // At max (1920px): HDR_FS=18px → TITLE_FS=19.5px
  const TITLE_FS = 'clamp(15.5px,1.32vw,19.5px)'; // Section title (SPREAD / TOTAL / MONEYLINE) — 1.5pt above HDR_FS
  // Colors:
  //   Book values: #D3D3D3 (light gray), weight 500
  //   Model non-edge values: #FFFFFF (white), weight 600
  //   Model edge values: #39FF14 (neon green), weight 700
  const bookCell: React.CSSProperties = { fontSize: VAL_FS, fontWeight: 500, color: '#D3D3D3', letterSpacing: '0.02em' } as React.CSSProperties;
  const modelGreen: React.CSSProperties = { fontSize: VAL_FS, fontWeight: 700, color: '#39FF14', letterSpacing: '0.02em' };
  const modelWhite: React.CSSProperties = { fontSize: VAL_FS, fontWeight: 600, color: '#FFFFFF', letterSpacing: '0.02em' };
  const dimCell:    React.CSSProperties = { fontSize: VAL_FS, fontWeight: 500, color: 'rgba(57,255,20,0.28)', letterSpacing: '0.02em' };
  const awaySpreadModelStyle = showModel ? (hasSpreadEdge && spreadEdgeIsAway  ? modelGreen : modelWhite) : dimCell;
  const homeSpreadModelStyle = showModel ? (hasSpreadEdge && !spreadEdgeIsAway ? modelGreen : modelWhite) : dimCell;
  const overTotalModelStyle  = showModel ? (hasTotalEdge  && totalEdgeIsOver   ? modelGreen : modelWhite) : dimCell;
  const underTotalModelStyle = showModel ? (hasTotalEdge  && !totalEdgeIsOver  ? modelGreen : modelWhite) : dimCell;
  const awayMlModelStyle     = showModel ? (hasSpreadEdge && spreadEdgeIsAway  ? modelGreen : modelWhite) : dimCell;
  const homeMlModelStyle     = showModel ? (hasSpreadEdge && !spreadEdgeIsAway ? modelGreen : modelWhite) : dimCell;

  // ── Splits data ───────────────────────────────────────────────────────────
  const awaySpreadLabel = !isNaN(awaySpread) ? `${awayAbbr} (${spreadSign(awaySpread)})` : awayAbbr;
  const homeSpreadLabel = !isNaN(homeSpread) ? `${homeAbbr} (${spreadSign(homeSpread)})` : homeAbbr;
  const awayMlLabel = game.awayML ? `${awayAbbr} (${game.awayML})` : awayAbbr;
  const homeMlLabel = game.homeML ? `${homeAbbr} (${game.homeML})` : homeAbbr;

  const spreadTicketsPct = game.spreadAwayBetsPct ?? null;
  const spreadHandlePct  = game.spreadAwayMoneyPct ?? null;
  const totalTicketsPct  = game.totalOverBetsPct ?? null;
  const totalHandlePct   = game.totalOverMoneyPct ?? null;
  const mlTicketsPct     = game.mlAwayBetsPct ?? null;
  const mlHandlePct      = game.mlAwayMoneyPct ?? null;

  // ── Section column renderer ───────────────────────────────────────────────
  // Layout per section (exact spec):
  //   ┌─────────────────────────────────────────┐
  //   │            SECTION TITLE                │
  //   │  AWAY LABEL              HOME LABEL     │  (or OVER / total / UNDER)
  //   │  ─────────────────────────────────────  │
  //   │  BOOK LINE   MODEL LINE  BOOK LINE  MODEL LINE  │  ← header row
  //   │  away book   away model  home book  home model  │  ← values row (single row)
  //   │  ─────────────────────────────────────  │
  //   │  AWAY LABEL   TICKETS   HOME LABEL      │
  //   │  [████████████████████████████████████] │
  //   │  AWAY LABEL    MONEY    HOME LABEL      │
  //   │  [████████████████████████████████████] │
  //   └─────────────────────────────────────────┘
  const SectionCol = ({
    title,
    awayLabel, homeLabel,
    awayBook, homeBook,
    awayModel, homeModel,
    awayModelStyle, homeModelStyle,
    ticketsPct, handlePct,
    totalLine,
    awayLogoUrl: sectionAwayLogoUrl,
    homeLogoUrl: sectionHomeLogoUrl,
    awayAbbr: sectionAwayAbbr,
    homeAbbr: sectionHomeAbbr,
    openAwayBook, openHomeBook,
  }: {
    title: string;
    awayLabel: string; homeLabel: string;
    awayBook: string; homeBook: string;
    awayModel: string; homeModel: string;
    awayModelStyle: React.CSSProperties;
    homeModelStyle: React.CSSProperties;
    ticketsPct: number | null;
    handlePct: number | null;
    totalLine?: string;
    /** Team logo URL for the away row (shown left of values in SPREAD/ML, NOT for TOTAL) */
    awayLogoUrl?: string;
    /** Team logo URL for the home row (shown left of values in SPREAD/ML, NOT for TOTAL) */
    homeLogoUrl?: string;
    /** Team abbreviation for the away row (shown right of logo in SPREAD/ML) */
    awayAbbr?: string;
    /** Team abbreviation for the home row (shown right of logo in SPREAD/ML) */
    homeAbbr?: string;
    /** Open line string for away (shown above DK line in BOOK cell, muted) */
    openAwayBook?: string | null;
    /** Open line string for home (shown above DK line in BOOK cell, muted) */
    openHomeBook?: string | null;
  }) => {
    const awayTickets = ticketsPct != null ? ticketsPct : null;
    const homeTickets = ticketsPct != null ? 100 - ticketsPct : null;
    const awayHandle  = handlePct  != null ? handlePct  : null;
    const homeHandle  = handlePct  != null ? 100 - handlePct  : null;

    // For OVER/UNDER split bars: use OVER/UNDER as team labels
    const barAwayLabel = totalLine ? 'OVER' : awayLabel;
    const barHomeLabel = totalLine ? 'UNDER' : homeLabel;

    // Column header style — HDR_FS (largest in hierarchy, 4pt above value rows)
    const colHdrStyle = (color: string): React.CSSProperties => ({
      fontSize: HDR_FS,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      color,
      whiteSpace: 'nowrap' as const,
    });

    // Row label style — ABBR_FS (1pt below value rows)
    // Used for team abbreviations (SPREAD/ML) and OVER/UNDER labels (TOTAL)
    const _rowLabelStyle: React.CSSProperties = {
      fontSize: ABBR_FS,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.55)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      whiteSpace: 'nowrap' as const,
      marginRight: 2,
    };

    // Value font size — VAL_FS (4pt below HDR_FS)
    const valFontSize = VAL_FS;

    return (
      /* flex: 1 1 0% ensures all three SectionCols grow equally from 0 base — identical width regardless of content */
      <div className="flex flex-col" style={{ flex: '1 1 0%', minWidth: 0, width: 0, padding: '8px 10px 10px' }}>

        {/* ── Section title ── */}
        <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
          {/* Change 5: SPREAD/TOTAL/MONEYLINE title fontWeight reduced by 50 (900→850) */}
          <span style={{ fontSize: TITLE_FS, fontWeight: 850, color: '#fff', letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>

        {/* ── Uniform spacer row — same fixed height for ALL three sections ── */}
        {/* TOTAL previously showed OVER / 139.5 / UNDER here — now removed per spec */}
        {/* All three sections show an invisible spacer to keep the odds grid and splits bars aligned */}
        <div style={{ height: 'clamp(16px,1.4vw,22px)', marginBottom: 3 }} />

        {/* ── Odds grid: 2 columns — BOOK | MODEL ── */}
        {/*
          SPREAD/ML: logo immediately left of value in BOTH BOOK and MODEL cells.
          TOTAL:     "OVER"/"UNDER" text only — no o{}/u{} prefix, no logos.
        */}
        {/*
          OddsCell pill grid — 2 columns (BOOK | MODEL), 2 rows (away/over | home/under).
          BOOK pills: rounded border, bold main value, smaller juice below, optional open line above.
          MODEL pills: transparent bg, neon green when edge, white otherwise.
          isEdge is detected by comparing awayModelStyle / homeModelStyle to the modelGreen object.
          LOG: [OddsCell] logs are emitted in dev whenever isBest or isEdge is true.
        */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', marginBottom: 8, alignItems: 'start' }}>
          {/* Header row */}
          <span className="text-center" style={colHdrStyle('#FFFFFF')}>BOOK</span>
          <span className="text-center" style={colHdrStyle('#39FF14')}>MODEL</span>

          {/* Away / OVER — BOOK pill */}
          <OddsCell
            mainValue={totalLine ? `o${awayBook}` : awayBook}
            juiceStr={null}
            isBook={true}
            openLine={openAwayBook}
            size="md"
            wrapperStyle={{ justifySelf: 'center', width: '100%' }}
          />

          {/* Away / OVER — MODEL pill */}
          <OddsCell
            mainValue={totalLine ? `o${awayModel}` : awayModel}
            juiceStr={null}
            isBook={false}
            isEdge={awayModelStyle === modelGreen}
            size="md"
            wrapperStyle={{ justifySelf: 'center', width: '100%' }}
          />

          {/* Home / UNDER — BOOK pill */}
          <OddsCell
            mainValue={totalLine ? `u${homeBook}` : homeBook}
            juiceStr={null}
            isBook={true}
            openLine={openHomeBook}
            size="md"
            wrapperStyle={{ justifySelf: 'center', width: '100%' }}
          />

          {/* Home / UNDER — MODEL pill */}
          <OddsCell
            mainValue={totalLine ? `u${homeModel}` : homeModel}
            juiceStr={null}
            isBook={false}
            isEdge={homeModelStyle === modelGreen}
            size="md"
            wrapperStyle={{ justifySelf: 'center', width: '100%' }}
          />
        </div>

        {/* ── Thin separator ── */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', marginBottom: 7 }} />

        {/* ── TICKETS split bar ── */}
        <div style={{ marginTop: 4 }}>
          <MergedSplitBar
            awayPct={awayTickets} homePct={homeTickets}
            awayColor={awayColor} homeColor={homeColor}
            rowLabel="TICKETS"
            awayLabel={barAwayLabel} homeLabel={barHomeLabel}
          />
        </div>

        {/* ── MONEY split bar ── */}
        <div style={{ marginTop: 4 }}>
          <MergedSplitBar
            awayPct={awayHandle} homePct={homeHandle}
            awayColor={awayColor} homeColor={homeColor}
            rowLabel="MONEY"
            awayLabel={barAwayLabel} homeLabel={barHomeLabel}
          />
        </div>

      </div>
    );
  };

  // ── EdgeVerdict column ────────────────────────────────────────────────────
  const spreadPass = normalizeEdgeLabel(computedSpreadEdge) === 'PASS' || (spreadDiff ?? 0) <= 0;
  const totalPass  = normalizeEdgeLabel(computedTotalEdge)  === 'PASS' || (totalDiff  ?? 0) <= 0;
  const spreadIsStronger = (spreadDiff ?? 0) >= (totalDiff ?? 0);
  const spreadEdgeIsAwayForVerdict = computedSpreadEdge && awayDisplayName
    ? normalizeEdgeLabel(computedSpreadEdge).toLowerCase().startsWith(awayDisplayName.toLowerCase())
    : false;
  const spreadLogoUrl = spreadEdgeIsAwayForVerdict ? awayLogoUrl : homeLogoUrl;
  const spreadVerdictSlug = spreadEdgeIsAwayForVerdict ? awaySlug : homeSlug;
  const spreadVerdictTeam = spreadEdgeIsAwayForVerdict ? awayDisplayName : homeDisplayName;

  return (
    <div className="flex items-stretch w-full" style={{ minHeight: '100%' }}>
      {/* SPREAD section */}
      <SectionCol
        title="Spread"
        awayLabel={awaySpreadLabel} homeLabel={homeSpreadLabel}
        awayBook={displayAwaySpread} homeBook={displayHomeSpread}
        awayModel={mdlAwaySpreadStr} homeModel={mdlHomeSpreadStr}
        awayModelStyle={awaySpreadModelStyle} homeModelStyle={homeSpreadModelStyle}
        ticketsPct={spreadTicketsPct} handlePct={spreadHandlePct}
        awayLogoUrl={awayLogoUrl} homeLogoUrl={homeLogoUrl}
        awayAbbr={awayAbbr} homeAbbr={homeAbbr}
        openAwayBook={openAwaySpreadStr}
        openHomeBook={openHomeSpreadStr}
      />
      {/* Divider */}
      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />
      {/* TOTAL section — no logos, OVER/UNDER baked into value cells */}
      <SectionCol
        title="Total"
        awayLabel="OVER" homeLabel="UNDER"
        awayBook={displayOver} homeBook={displayUnder}
        awayModel={String(mdlOver)} homeModel={String(mdlUnder)}
        awayModelStyle={overTotalModelStyle} homeModelStyle={underTotalModelStyle}
        ticketsPct={totalTicketsPct} handlePct={totalHandlePct}
        totalLine={!isNaN(bkTotal) ? String(bkTotal) : undefined}
        openAwayBook={openOverStr}
        openHomeBook={openUnderStr}
      />
      {/* Divider */}
      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />
      {/* MONEYLINE section */}
      <SectionCol
        title="Moneyline"
        awayLabel={awayMlLabel} homeLabel={homeMlLabel}
        awayBook={displayAwayML} homeBook={displayHomeML}
        awayModel={mdlAwayMlStr} homeModel={mdlHomeMlStr}
        awayModelStyle={awayMlModelStyle} homeModelStyle={homeMlModelStyle}
        ticketsPct={mlTicketsPct} handlePct={mlHandlePct}
        awayLogoUrl={awayLogoUrl} homeLogoUrl={homeLogoUrl}
        awayAbbr={awayAbbr} homeAbbr={homeAbbr}
        openAwayBook={openAwayMlStr}
        openHomeBook={openHomeMlStr}
      />
      {/* Divider */}
      <div style={{ width: 1, background: 'rgba(255,255,255,0.12)', flexShrink: 0, alignSelf: 'stretch' }} />
      {/* EdgeVerdict column */}
      {showModel ? (
        <div className="flex flex-col items-start justify-center" style={{ flex: '0 0 clamp(150px,11.5vw,190px)', width: 'clamp(150px,11.5vw,190px)', padding: '10px 12px', gap: 0 }}>
          {/* EDGE header */}
          <span style={{ fontSize: 'clamp(9px,0.7vw,11px)', fontWeight: 800, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8, alignSelf: 'center' }}>EDGE</span>
          {spreadPass && totalPass ? (
            <div style={{ alignSelf: 'center', padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 'clamp(10px,0.85vw,13px)', fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>PASS</span>
            </div>
          ) : (
            <div className="flex flex-col w-full" style={{ gap: 6 }}>
              {!spreadPass && (() => {
                const diff = isNaN(spreadDiff) ? null : spreadDiff;
                const edgeColor = getEdgeColor(diff ?? 0);
                const normalized = normalizeEdgeLabel(computedSpreadEdge);
                const showArrow = (diff ?? 0) >= 3;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '5px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${edgeColor}33` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {(spreadLogoUrl || spreadVerdictSlug) && (
                        <TeamLogo slug={spreadVerdictSlug ?? ''} name={spreadVerdictTeam ?? ''} logoUrl={spreadLogoUrl} size={16} />
                      )}
                      <span style={{ fontSize: 'clamp(9px,0.75vw,11px)', fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {showArrow && <span style={{ color: edgeColor, marginRight: 2, fontSize: '0.8em' }}>▲</span>}
                        {normalized}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 'clamp(8px,0.65vw,10px)', color: 'rgba(255,255,255,0.35)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Spread</span>
                      <span style={{ fontSize: 'clamp(9px,0.75vw,11px)', fontWeight: 800, color: edgeColor, letterSpacing: '0.02em' }}>{diff}{diff === 1 ? 'PT' : 'PTS'}</span>
                    </div>
                  </div>
                );
              })()}
              {!totalPass && (() => {
                const diff = isNaN(totalDiff) ? null : totalDiff;
                const edgeColor = getEdgeColor(diff ?? 0);
                const normalized = normalizeEdgeLabel(computedTotalEdge);
                const showArrow = (diff ?? 0) >= 3;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '5px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${edgeColor}33` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 'clamp(9px,0.75vw,11px)', fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {showArrow && <span style={{ color: edgeColor, marginRight: 2, fontSize: '0.8em' }}>▲</span>}
                        {normalized}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 'clamp(8px,0.65vw,10px)', color: 'rgba(255,255,255,0.35)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total</span>
                      <span style={{ fontSize: 'clamp(9px,0.75vw,11px)', fontWeight: 800, color: edgeColor, letterSpacing: '0.02em' }}>{diff}{diff === 1 ? 'PT' : 'PTS'}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: '0 0 clamp(120px,10vw,160px)', width: 'clamp(120px,10vw,160px)', flexShrink: 0 }} />
      )}
    </div>
  );
}


// ── OddsCell ─────────────────────────────────────────────────────────────────
//
// Pill-style odds cell inspired by Action Network's book-cell design.
//
// Visual spec:
//   ┌─────────────────────────────────────────────────────────────────┐
//   │  [🔖 orange bookmark badge — top-left corner, only when best]  │
//   │                                                                 │
//   │              +5.5          ← mainValue (bold, large)           │
//   │              -115          ← juiceStr  (muted, smaller)        │
//   │                                                                 │
//   └─────────────────────────────────────────────────────────────────┘
//
// Props:
//   mainValue  — the primary line value, e.g. "+5.5", "o139.5", "-148"
//   juiceStr   — the odds/juice, e.g. "-115", "-110" (null = omit second line)
//   isBest     — when true, renders the orange bookmark badge (top-left)
//   isEdge     — when true, applies neon green highlight to the pill
//   isBook     — when true, renders book styling (light bg pill); else model styling (transparent)
//   openLine   — optional open line string shown above pill in muted text
//   size       — 'sm' (mobile) | 'md' (tablet/desktop)
//
// Sizing strategy:
//   All font sizes use CSS clamp() so the pill scales fluidly from 320px to 1920px viewport.
//   The pill container uses percentage-based padding so it never overflows its grid cell.
//
// Debug logging:
//   In development, logs [OddsCell] mainValue + juiceStr + isBest + isEdge to console
//   whenever isBest or isEdge is true (to avoid noise for normal cells).

interface OddsCellProps {
  mainValue: string;
  juiceStr?: string | null;
  isBest?: boolean;
  isEdge?: boolean;
  isBook?: boolean;
  openLine?: string | null;
  size?: 'sm' | 'md';
  /** Optional additional style overrides for the outer wrapper */
  wrapperStyle?: React.CSSProperties;
}

function OddsCell({
  mainValue,
  juiceStr,
  isBest = false,
  isEdge = false,
  isBook = true,
  openLine,
  size = 'md',
  wrapperStyle,
}: OddsCellProps) {
  // ── Debug logging ──────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'development' && (isBest || isEdge)) {
    console.log(
      `%c[OddsCell] ${mainValue} ${juiceStr ?? ''} | isBest=${isBest} isEdge=${isEdge} isBook=${isBook} size=${size}`,
      `color:${isEdge ? '#39FF14' : '#F5A623'};font-size:9px`
    );
  }

  // ── Sizing ─────────────────────────────────────────────────────────────────
  // sm (mobile): mainValue 11-13px, juice 9-10px, pill padding 3px 5px
  // md (desktop): mainValue 13-17px, juice 10-12px, pill padding 4px 8px
  const mainFs = size === 'sm'
    ? 'clamp(10.5px, 2.6vw, 12.5px)'
    : 'clamp(13px, 1.1vw, 17px)';
  const juiceFs = size === 'sm'
    ? 'clamp(9px, 2.1vw, 10.5px)'
    : 'clamp(10px, 0.85vw, 12px)';
  const openFs = size === 'sm'
    ? 'clamp(7px, 1.7vw, 8.5px)'
    : 'clamp(8px, 0.65vw, 10px)';
  const pillPadding = size === 'sm' ? '3px 5px' : '4px 8px';
  const borderRadius = size === 'sm' ? '8px' : '10px';

  // ── Colors ─────────────────────────────────────────────────────────────────
  // Book pill: light semi-transparent background, dark text on light → use white text on dark bg
  // Model pill: transparent bg, colored text
  // Edge: neon green border + text
  const pillBg = isBook
    ? (isEdge
        ? 'rgba(57,255,20,0.10)'
        : 'rgba(255,255,255,0.07)')
    : 'transparent';
  const pillBorder = isBook
    ? (isEdge
        ? '1px solid rgba(57,255,20,0.45)'
        : '1px solid rgba(255,255,255,0.13)')
    : (isEdge
        ? '1px solid rgba(57,255,20,0.30)'
        : '1px solid transparent');
  const mainColor = isEdge ? '#39FF14' : (isBook ? '#FFFFFF' : '#FFFFFF');
  const mainWeight = isEdge ? 800 : (isBook ? 700 : 700);
  // Model cells: juice is always neon green (edge = full, non-edge = 60%); book cells: muted gray
  const juiceColor = isBook
    ? (isEdge ? 'rgba(57,255,20,0.70)' : 'rgba(200,200,200,0.60)')
    : (isEdge ? '#39FF14' : 'rgba(57,255,20,0.65)');

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ gap: 1, ...wrapperStyle }}
    >
      {/* Open line — shown above the pill in muted text */}
      {openLine && (
        <span
          className="tabular-nums"
          style={{
            fontSize: openFs,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.30)',
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
            lineHeight: 1,
            marginBottom: 1,
          }}
        >
          o:{openLine}
        </span>
      )}

      {/* Pill container */}
      <div
        style={{
          position: 'relative',
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: pillPadding,
          borderRadius,
          background: pillBg,
          border: pillBorder,
          minWidth: size === 'sm' ? 42 : 48,
          gap: 1,
          transition: 'background 200ms, border 200ms',
        }}
      >
        {/* Orange bookmark badge — top-left corner */}
        {isBest && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: size === 'sm' ? 12 : 15,
              height: size === 'sm' ? 16 : 20,
              overflow: 'hidden',
              borderTopLeftRadius: borderRadius,
            }}
            title="Best available odds"
          >
            {/* Bookmark ribbon SVG — orange fill, star icon */}
            <svg
              viewBox="0 0 15 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ width: '100%', height: '100%' }}
            >
              <path d="M0 0 H15 V20 L7.5 14 L0 20 Z" fill="#F5A623" />
              <text
                x="7.5"
                y="10"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="7"
                fill="white"
                fontWeight="bold"
              >★</text>
            </svg>
          </div>
        )}

        {/* Main value — bold, large */}
        <span
          className="tabular-nums"
          style={{
            fontSize: mainFs,
            fontWeight: mainWeight,
            color: mainColor,
            letterSpacing: '0.01em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}
        >
          {mainValue}
        </span>

        {/* Juice/odds — smaller, muted */}
        {juiceStr && (
          <span
            className="tabular-nums"
            style={{
              fontSize: juiceFs,
              fontWeight: 500,
              color: juiceColor,
              letterSpacing: '0.01em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {juiceStr}
          </span>
        )}
      </div>
    </div>
  );
}

// ── BookOddsCell (legacy shim — kept for backward compat with OddsLinesPanel) ─
// Two-line cell for mobile BOOK column: spread/total on line 1, odds on line 2.
// When oddsStr is null/empty, renders a single centered line (no second line).
function BookOddsCell({ spreadStr, oddsStr, style }: {
  spreadStr: string;
  oddsStr: string | null | undefined;
  style: React.CSSProperties;
}) {
  if (!oddsStr) {
    return (
      <div className="flex items-center justify-center">
        <span className="tabular-nums" style={style}>{spreadStr}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center" style={{ gap: 0, lineHeight: 1.2 }}>
      <span className="tabular-nums" style={{ ...style, fontSize: '10px', fontWeight: style.fontWeight }}>{spreadStr}</span>
      <span className="tabular-nums" style={{ ...style, fontSize: '8.5px', fontWeight: 400, opacity: 0.85 }}>({oddsStr})</span>
    </div>
  );
}

// ── OddsLinesPanel ───────────────────────────────────────────────────────────
// IMPORTANT: This MUST be defined at module level (not inside GameCard) to avoid
// React treating it as a new component type on every render, which causes an
// infinite re-render loop / "Maximum call stack size exceeded" error.

interface OddsLinesPanelProps {
  // Book values
  awayBookSpread: number;
  homeBookSpread: number;
  bookTotal: number;
  awayML: string;
  homeML: string;
  // Book odds (for parenthetical display, e.g. "+6.5 (-110)")
  awaySpreadOdds?: string | null;
  homeSpreadOdds?: string | null;
  overOdds?: string | null;
  underOdds?: string | null;
  // Open line strings (from AN HTML ingest)
  openAwaySpreadStr?: string | null;
  openHomeSpreadStr?: string | null;
  openOverStr?: string | null;
  openUnderStr?: string | null;
  openAwayMlStr?: string | null;
  openHomeMlStr?: string | null;
  // DK NJ current line strings (from AN HTML ingest)
  displayAwaySpread?: string;
  displayHomeSpread?: string;
  displayOver?: string;
  displayUnder?: string;
  displayAwayML?: string;
  displayHomeML?: string;
  // Model values
  awayModelSpread: number;
  homeModelSpread: number;
  modelTotal: number;
  modelAwayML: string | null | undefined;
  modelHomeML: string | null | undefined;
  // Computed edge values
  spreadDiff: number;
  totalDiff: number;
  computedSpreadEdge: string | null;
  computedTotalEdge: string | null;
  // Team identity for EdgeVerdict logos
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  awaySlug?: string;
  homeSlug?: string;
  awayDisplayName?: string;
  homeDisplayName?: string;
  // Controlled model toggle (lifted to parent)
  showModel: boolean;
  onToggleModel: () => void;
  // Sport identifier (for NHL puck line odds display)
  sport?: string | null;
  // NHL model puck line and total odds
  modelAwayPLOdds?: string | null;
  modelHomePLOdds?: string | null;
  modelOverOdds?: string | null;
  modelUnderOdds?: string | null;
  // NCAAM model fair odds at book's spread line
  modelAwaySpreadOdds?: string | null;
  modelHomeSpreadOdds?: string | null;
}

function OddsLinesPanel({
  awayBookSpread: awaySpread,
  homeBookSpread: homeSpread,
  bookTotal: bkTotal,
  awayML: awayMl,
  homeML: homeMl,
  awaySpreadOdds,
  homeSpreadOdds,
  overOdds,
  underOdds,
  openAwaySpreadStr,
  openHomeSpreadStr,
  openOverStr,
  openUnderStr,
  openAwayMlStr,
  openHomeMlStr,
  displayAwaySpread: dkAwaySpreadProp,
  displayHomeSpread: dkHomeSpreadProp,
  displayOver: dkOverProp,
  displayUnder: dkUnderProp,
  displayAwayML: dkAwayMlProp,
  displayHomeML: dkHomeMlProp,
  awayModelSpread: mdlAwaySpread,
  homeModelSpread: mdlHomeSpread,
  modelTotal: mdlTotal,
  modelAwayML,
  modelHomeML,
  spreadDiff,
  totalDiff,
  computedSpreadEdge,
  computedTotalEdge,
  awayLogoUrl,
  homeLogoUrl,
  awaySlug,
  homeSlug,
  awayDisplayName,
  homeDisplayName,
  showModel,
  onToggleModel,
  sport,
  modelAwayPLOdds,
  modelHomePLOdds,
  modelOverOdds,
  modelUnderOdds,
  modelAwaySpreadOdds,
  modelHomeSpreadOdds,
}: OddsLinesPanelProps) {

  const mdlAwayMl = modelAwayML ?? '—';
  const mdlHomeMl = modelHomeML ?? '—';
  const hasModelData = !isNaN(mdlAwaySpread) || !isNaN(mdlTotal) || mdlAwayMl !== '—';

  // Book values — use DK-specific if available, otherwise fall back to awayBookSpread (from AN API)
  const bkTotalStr    = !isNaN(bkTotal) ? String(bkTotal) : '—';
  const bkAwaySpreadBase  = !isNaN(awaySpread)
    ? (awaySpreadOdds ? `${spreadSign(awaySpread)} (${awaySpreadOdds})` : spreadSign(awaySpread))
    : '—';
  const bkHomeSpreadBase  = !isNaN(homeSpread)
    ? (homeSpreadOdds ? `${spreadSign(homeSpread)} (${homeSpreadOdds})` : spreadSign(homeSpread))
    : '—';
  const bkOverTotalBase   = !isNaN(bkTotal)
    ? (overOdds  ? `o${bkTotalStr} (${overOdds})`  : `o${bkTotalStr}`)
    : 'o—';
  const bkUnderTotalBase  = !isNaN(bkTotal)
    ? (underOdds ? `u${bkTotalStr} (${underOdds})` : `u${bkTotalStr}`)
    : 'u—';
  // Prefer DK-specific display values when available
  const bkAwaySpread  = dkAwaySpreadProp ?? bkAwaySpreadBase;
  const bkHomeSpread  = dkHomeSpreadProp ?? bkHomeSpreadBase;
  const bkOverTotal   = dkOverProp   ? `o${dkOverProp}`   : bkOverTotalBase;
  const bkUnderTotal  = dkUnderProp  ? `u${dkUnderProp}`  : bkUnderTotalBase;
  const awayMlDisplay = dkAwayMlProp ?? awayMl;
  const homeMlDisplay = dkHomeMlProp ?? homeMl;

  // Model values — for NHL/NCAAM/MLB games, append odds in parentheses
  const isNhlGame   = sport === 'NHL';
  const isNcaamGame = sport === 'NCAAM';
  const isMlbGame   = sport === 'MLB';
  const mdlAwaySpreadStr = hasModelData && !isNaN(mdlAwaySpread)
    ? (isNhlGame && modelAwayPLOdds
        ? `${spreadSign(mdlAwaySpread)} (${modelAwayPLOdds})`
        : (isNcaamGame || isMlbGame) && modelAwaySpreadOdds
          ? `${spreadSign(mdlAwaySpread)} (${modelAwaySpreadOdds})`
          : spreadSign(mdlAwaySpread))
    : '—';
  const mdlHomeSpreadStr = hasModelData && !isNaN(mdlHomeSpread)
    ? (isNhlGame && modelHomePLOdds
        ? `${spreadSign(mdlHomeSpread)} (${modelHomePLOdds})`
        : (isNcaamGame || isMlbGame) && modelHomeSpreadOdds
          ? `${spreadSign(mdlHomeSpread)} (${modelHomeSpreadOdds})`
          : spreadSign(mdlHomeSpread))
    : '—';
  // For NHL: display BOOK's total line with model fair odds at that line
  // For NCAAM/MLB: display model's own total with model fair odds at that line
  const mdlDisplayTotal = isNhlGame && !isNaN(bkTotal) ? bkTotal : mdlTotal;
  const mdlOverTotal = hasModelData && !isNaN(mdlDisplayTotal)
    ? ((isNhlGame || isNcaamGame || isMlbGame) && modelOverOdds
        ? `${String(mdlDisplayTotal)} (${modelOverOdds})`
        : String(mdlDisplayTotal))
    : '—';
  const mdlUnderTotal = hasModelData && !isNaN(mdlDisplayTotal)
    ? ((isNhlGame || isNcaamGame || isMlbGame) && modelUnderOdds
        ? `${String(mdlDisplayTotal)} (${modelUnderOdds})`
        : String(mdlDisplayTotal))
    : '—';
  const mdlAwayMlStr     = hasModelData ? mdlAwayMl : '—';
  const mdlHomeMlStr     = hasModelData ? mdlHomeMl : '—';

  // Grid: 6 columns when model is ON (Book|Model per group), 3 columns when model is OFF (Book only)
  const GRID = showModel ? 'grid-cols-6' : 'grid-cols-3';

  // Determine which side has the spread edge (away or home)
  const spreadEdgeIsAway = (() => {
    if (isNaN(spreadDiff) || spreadDiff <= 0) return null;
    // For NHL: use computedSpreadEdge string (set by Python engine) — line comparison is meaningless
    if (isNhlGame) {
      if (!computedSpreadEdge || computedSpreadEdge === 'PASS') return null;
      return computedSpreadEdge.includes('+1.5') || computedSpreadEdge.includes('+2.5');
    }
    if (!isNaN(mdlAwaySpread) && !isNaN(awaySpread)) {
      return mdlAwaySpread < awaySpread; // model favors away more than book → away edge
    }
    return null;
  })();
  const totalEdgeIsOver = (() => {
    if (isNaN(totalDiff) || totalDiff <= 0) return null;
    // For NHL: edge direction must come from computedTotalEdge (set by Python engine from model odds
    // at the book's line), NOT from comparing model expected total vs book line.
    if (isNhlGame) {
      if (!computedTotalEdge || computedTotalEdge === 'PASS') return null;
      const normalized = computedTotalEdge.toUpperCase();
      if (normalized.startsWith('OVER')) return true;
      if (normalized.startsWith('UNDER')) return false;
      return null;
    }
    if (!isNaN(mdlTotal) && !isNaN(bkTotal)) {
      return mdlTotal > bkTotal; // model higher than book → over edge
    }
    return null;
  })();

  const hasSpreadEdge = spreadEdgeIsAway !== null;
  const hasTotalEdge  = totalEdgeIsOver !== null;

  // Base cell styles — book values are bolder when model is off (primary data), lighter when model is on (secondary)
  // Font sizes scale with viewport: clamp(min, preferred_vw, max)
  // Use smaller font when showing odds in parentheses (longer strings like "+6.5 (-110)")
  const cellFontSize = 'clamp(9.5px, 1.0vw, 13px)';
  const bookCell      = { fontSize: cellFontSize, fontWeight: showModel ? 400 : 600, color: '#E8E8E8', letterSpacing: '0.01em', textAlign: 'center' as const, lineHeight: '1.3', whiteSpace: 'nowrap' as const } as React.CSSProperties;
  // Model cells: neon green only when this specific cell is the edge side; otherwise bold white
  const modelGreen    = { fontSize: cellFontSize, fontWeight: 700, color: '#39FF14', letterSpacing: '0.01em', textAlign: 'center' as const } as React.CSSProperties;
  const modelWhite    = { fontSize: cellFontSize, fontWeight: 700, color: '#E8E8E8', letterSpacing: '0.01em', textAlign: 'center' as const } as React.CSSProperties;
  const dimCell       = { fontSize: cellFontSize, fontWeight: 700, color: 'rgba(57,255,20,0.28)', letterSpacing: '0.01em', textAlign: 'center' as const } as React.CSSProperties;

  // Per-cell model style helpers
  const awaySpreadModelStyle = showModel ? (hasSpreadEdge && spreadEdgeIsAway  ? modelGreen : modelWhite) : dimCell;
  const homeSpreadModelStyle = showModel ? (hasSpreadEdge && !spreadEdgeIsAway ? modelGreen : modelWhite) : dimCell;
  const overTotalModelStyle  = showModel ? (hasTotalEdge  && totalEdgeIsOver   ? modelGreen : modelWhite) : dimCell;
  const underTotalModelStyle = showModel ? (hasTotalEdge  && !totalEdgeIsOver  ? modelGreen : modelWhite) : dimCell;
  // ML edges: if spread edge is away → away ML is green; if home → home ML is green
  const awayMlModelStyle     = showModel ? (hasSpreadEdge && spreadEdgeIsAway  ? modelGreen : modelWhite) : dimCell;
  const homeMlModelStyle     = showModel ? (hasSpreadEdge && !spreadEdgeIsAway ? modelGreen : modelWhite) : dimCell;

  // Helper: cell value with style
  const Cell = ({ val, style }: { val: string; style: React.CSSProperties }) => (
    <div className="flex items-center justify-center">
      <span className="tabular-nums" style={style}>{val}</span>
    </div>
  );

  return (
    <div className="flex flex-col pl-2 pr-0 pt-0 pb-0 min-w-0" style={{ justifyContent: 'center' }}>
      {/* Top-level column group headers: SPREAD | TOTAL | MONEYLINE */}
      <div
        className={`grid ${GRID} pb-0.5`}
        style={{ transition: 'grid-template-columns 200ms ease' }}
      >
        {/* SPREAD/TOTAL/MONEYLINE: 1.5pt bigger than BOOK/MODEL sub-headers at clamp(8px,0.75vw,11px) */}
        {/* At min: 8+1.5=9.5px → use 9.5px; at max: 11+1.5=12.5px → use 12.5px */}
        <span className={`${showModel ? 'col-span-2' : ''} text-center font-extrabold uppercase tracking-widest`} style={{ fontSize: 'clamp(9.5px, 0.88vw, 12.5px)', color: '#E8E8E8' }}>Spread</span>
        <span className={`${showModel ? 'col-span-2' : ''} text-center font-extrabold uppercase tracking-widest`} style={{ fontSize: 'clamp(9.5px, 0.88vw, 12.5px)', color: '#E8E8E8' }}>Total</span>
        <span className={`${showModel ? 'col-span-2' : ''} text-center font-extrabold uppercase tracking-widest`} style={{ fontSize: 'clamp(9.5px, 0.88vw, 12.5px)', color: '#E8E8E8' }}>Moneyline</span>
      </div>

      {/* Sub-headers: BOOK only when model off; BOOK | MODEL when model on */}
      <div
        className={`grid ${GRID} pb-1 mb-0.5`}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', transition: 'grid-template-columns 200ms ease' }}
      >
        {showModel
          ? ['Book', 'Model', 'Book', 'Model', 'Book', 'Model'].map((lbl, i) => (
              <span
                key={i}
                className="text-center font-bold uppercase tracking-widest"
                style={{ fontSize: 'clamp(8px, 0.75vw, 11px)', color: lbl === 'Model' ? '#39FF14' : 'rgba(255,255,255,0.5)' }}
              >
                {lbl}
              </span>
            ))
          : ['Book', 'Book', 'Book'].map((lbl, i) => (
              <span
                key={i}
                className="text-center font-bold uppercase tracking-widest"
                style={{ fontSize: 'clamp(8px, 0.75vw, 11px)', color: 'rgba(255,255,255,0.5)' }}
              >
                {lbl}
              </span>
            ))
        }
      </div>

      {/* Away row — OddsCell pills for BOOK, plain spans for MODEL */}
      <div className={`grid ${GRID} py-2`} style={{ transition: 'grid-template-columns 200ms ease' }}>
        {/* Away Spread BOOK pill */}
        <OddsCell
          mainValue={bkAwaySpread}
          juiceStr={null}
          isBook={true}
          openLine={openAwaySpreadStr}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />
        {showModel && <OddsCell
          mainValue={mdlAwaySpreadStr}
          juiceStr={null}
          isBook={false}
          isEdge={awaySpreadModelStyle === modelGreen}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />}
        {/* Away Total BOOK pill */}
        <OddsCell
          mainValue={bkOverTotal}
          juiceStr={null}
          isBook={true}
          openLine={openOverStr}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />
        {showModel && <OddsCell
          mainValue={`o${mdlOverTotal}`}
          juiceStr={null}
          isBook={false}
          isEdge={overTotalModelStyle === modelGreen}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />}
        {/* Away ML BOOK pill */}
        <OddsCell
          mainValue={awayMlDisplay || '—'}
          juiceStr={null}
          isBook={true}
          openLine={openAwayMlStr}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />
        {showModel && <OddsCell
          mainValue={mdlAwayMlStr}
          juiceStr={null}
          isBook={false}
          isEdge={awayMlModelStyle === modelGreen}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

      {/* Home row — OddsCell pills for BOOK, plain spans for MODEL */}
      <div className={`grid ${GRID} py-2`} style={{ transition: 'grid-template-columns 200ms ease' }}>
        {/* Home Spread BOOK pill */}
        <OddsCell
          mainValue={bkHomeSpread}
          juiceStr={null}
          isBook={true}
          openLine={openHomeSpreadStr}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />
        {showModel && <OddsCell
          mainValue={mdlHomeSpreadStr}
          juiceStr={null}
          isBook={false}
          isEdge={homeSpreadModelStyle === modelGreen}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />}
        {/* Home Total BOOK pill */}
        <OddsCell
          mainValue={bkUnderTotal}
          juiceStr={null}
          isBook={true}
          openLine={openUnderStr}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />
        {showModel && <OddsCell
          mainValue={`u${mdlUnderTotal}`}
          juiceStr={null}
          isBook={false}
          isEdge={underTotalModelStyle === modelGreen}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />}
        {/* Home ML BOOK pill */}
        <OddsCell
          mainValue={homeMlDisplay || '—'}
          juiceStr={null}
          isBook={true}
          openLine={openHomeMlStr}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />
        {showModel && <OddsCell
          mainValue={mdlHomeMlStr}
          juiceStr={null}
          isBook={false}
          isEdge={homeMlModelStyle === modelGreen}
          size="md"
          wrapperStyle={{ justifySelf: 'center', width: '100%' }}
        />}
      </div>

    </div>
  );
}

// ── Main GameCard ─────────────────────────────────────────────────────────────

interface GameCardProps {
  game: GameRow;
  /** 'full' = all 3 panels (default), 'projections' = score+odds only, 'splits' = score+splits only */
  mode?: "full" | "projections" | "splits";
  /** When provided by a parent page, overrides internal model toggle state */
  showModel?: boolean;
  onToggleModel?: () => void;
  /** Set of favorited game IDs from the parent — avoids per-card fetches */
  favoriteGameIds?: Set<number>;
  onToggleFavorite?: (gameId: number) => void;
  /** Called when user favorites a game (not when unfavoriting) — used for in-page notification */
  onFavoriteNotify?: (gameId: number) => void;
  /**
   * Pass the parent's auth state down so GameCard doesn't need its own useAppAuth() query.
   * This avoids 33+ redundant tRPC calls and ensures the star renders immediately when
   * the parent already knows the user is authenticated.
   */
  isAppAuthed?: boolean;
  /**
   * Feed-level mobile tab override. When provided, the per-card tab state is ignored
   * and this value is used instead. The card will call onMobileTabChange when the user
   * interacts with the tab bar (but the tab bar is now rendered at the feed level).
   */
  mobileTab?: 'dual' | 'splits';
  onMobileTabChange?: (tab: 'dual' | 'splits') => void;
}

export function GameCard({ game, mode = "full", showModel: showModelProp, onToggleModel: onToggleModelProp, favoriteGameIds, onToggleFavorite, onFavoriteNotify, isAppAuthed: isAppAuthedProp, mobileTab: mobileTabProp, onMobileTabChange }: GameCardProps) {
  // Use custom app auth (app_session cookie) — NOT Manus OAuth — to gate the star button.
  // Prefer the prop passed from the parent (avoids 33+ redundant tRPC queries per page load).
  // Fall back to calling useAppAuth() only when no prop is provided (e.g., standalone usage).
  const { appUser: appUserFallback } = useAppAuth();
  const isAppAuthed = isAppAuthedProp !== undefined ? isAppAuthedProp : Boolean(appUserFallback);
  const utils = trpc.useUtils();
  const toggleFavMutation = trpc.favorites.toggle.useMutation({
    onSuccess: () => {
      utils.favorites.getMyFavorites.invalidate();
      utils.favorites.getMyFavoritesWithDates.invalidate();
    },
  });
  const isFavorited = favoriteGameIds?.has(game.id) ?? false;
  const handleStarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAppAuthed) return;
    const willBeFavorited = !isFavorited;
    if (onToggleFavorite) {
      onToggleFavorite(game.id);
    } else {
      toggleFavMutation.mutate({ gameId: game.id });
    }
    if (willBeFavorited && onFavoriteNotify) {
      onFavoriteNotify(game.id);
    }
  }, [isAppAuthed, onToggleFavorite, game.id, toggleFavMutation, isFavorited, onFavoriteNotify]);
  const awayBookSpread = toNum(game.awayBookSpread);
  const homeBookSpread = toNum(game.homeBookSpread);
  const isNhlGame   = game.sport === 'NHL';
  const isNcaamGame = game.sport === 'NCAAM';
  const isMlbGame   = game.sport === 'MLB';
  // For NHL: use modelAwayPuckLine/modelHomePuckLine (simulation-derived, e.g. "+1.5"/"-1.5")
  // instead of awayModelSpread/homeModelSpread (which may contain stale goal-differential values).
  // For NCAAM/NBA: use awayModelSpread/homeModelSpread as before.
  const awayModelSpread = isNhlGame
    ? toNum(game.modelAwayPuckLine ?? game.awayModelSpread)
    : toNum(game.awayModelSpread);
  const homeModelSpread = isNhlGame
    ? toNum(game.modelHomePuckLine ?? game.homeModelSpread)
    : toNum(game.homeModelSpread);
  const bookTotal = toNum(game.bookTotal);
  // For NHL: modelTotal from DB may be stale (8.5 from old goal-sum formula).
  // The correct simulation-derived total is stored in modelTotal after re-run.
  // Use it directly — it will be correct after the next model run.
  const modelTotal = toNum(game.modelTotal);

  // Use game.spreadDiff (probability edge in pp, set by Python engine) for NHL.
  // For NCAAM/NBA: compute diff from line values as before.
  const spreadDiff = isNhlGame
    ? toNum(game.spreadDiff)
    : (!isNaN(awayModelSpread) && !isNaN(awayBookSpread))
      ? Math.round(Math.abs(awayModelSpread - awayBookSpread) * 10) / 10
      : toNum(game.spreadDiff);
  // For NHL: totalDiff is a probability edge in percentage points (set by Python engine).
  // Do NOT recalculate from |modelTotal - bookTotal| — that produces a goal difference (0.49)
  // which is always below the 8pp threshold, suppressing all total edges.
  // For NCAAM/NBA: compute diff from line values as before.
  const totalDiff = isNhlGame
    ? toNum(game.totalDiff)
    : (!isNaN(modelTotal) && !isNaN(bookTotal))
      ? Math.round(Math.abs(modelTotal - bookTotal) * 10) / 10
      : toNum(game.totalDiff);
  // ── Open line strings (from AN HTML ingest) — available in GameCard scope ─
  const _normSpread = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const n = parseFloat(s);
    if (!isNaN(n) && n > 0 && !s.startsWith('+')) return `+${s}`;
    return s;
  };
  const _fmtLine = (line: string | null | undefined, odds: string | null | undefined): string | null => {
    if (!line) return null;
    return odds ? `${line} (${odds})` : line;
  };
  const openAwaySpreadStr = _fmtLine(_normSpread(game.openAwaySpread), game.openAwaySpreadOdds);
  const openHomeSpreadStr = _fmtLine(_normSpread(game.openHomeSpread), game.openHomeSpreadOdds);
  const openOverStr       = _fmtLine(game.openTotal, game.openOverOdds);
  const openUnderStr      = _fmtLine(game.openTotal, game.openUnderOdds);
  const openAwayMlStr     = game.openAwayML ?? null;
  const openHomeMlStr     = game.openHomeML ?? null;
  // ── Display strings: use awayBookSpread (DK line from AN HTML ingest) ─────
  const _spreadSign = (n: number) => n > 0 ? `+${n}` : String(n);
  const _bkAwaySpreadStr = !isNaN(awayBookSpread)
    ? (game.awaySpreadOdds ? `${_spreadSign(awayBookSpread)} (${game.awaySpreadOdds})` : _spreadSign(awayBookSpread))
    : '—';
  const _bkHomeSpreadStr = !isNaN(homeBookSpread)
    ? (game.homeSpreadOdds ? `${_spreadSign(homeBookSpread)} (${game.homeSpreadOdds})` : _spreadSign(homeBookSpread))
    : '—';
  const _bkOver  = !isNaN(bookTotal)
    ? (game.overOdds  ? `${bookTotal} (${game.overOdds})`  : String(bookTotal))
    : '—';
  const _bkUnder = !isNaN(bookTotal)
    ? (game.underOdds ? `${bookTotal} (${game.underOdds})` : String(bookTotal))
    : '—';
  const displayAwaySpread = _bkAwaySpreadStr;
  const displayHomeSpread = _bkHomeSpreadStr;
  const displayOver       = _bkOver;
  const displayUnder      = _bkUnder;
  const displayAwayML     = game.awayML ?? '—';
  const displayHomeML     = game.homeML ?? '—';

  // Resolve team info from NCAA, NBA, or NHL registry
  const awayNcaa = getTeamByDbSlug(game.awayTeam);
  const homeNcaa = getTeamByDbSlug(game.homeTeam);
  const awayNba  = !awayNcaa ? getNbaTeamByDbSlug(game.awayTeam) : null;
  const homeNba  = !homeNcaa ? getNbaTeamByDbSlug(game.homeTeam) : null;
  const awayNhl  = (!awayNcaa && !awayNba) ? NHL_BY_DB_SLUG.get(game.awayTeam) ?? null : null;
  const homeNhl  = (!homeNcaa && !homeNba) ? NHL_BY_DB_SLUG.get(game.homeTeam) ?? null : null;
  const awayMlb  = (!awayNcaa && !awayNba && !awayNhl) ? MLB_BY_ABBREV.get(game.awayTeam) ?? null : null;
  const homeMlb  = (!homeNcaa && !homeNba && !homeNhl) ? MLB_BY_ABBREV.get(game.homeTeam) ?? null : null;
  // Normalize city abbreviations: "LA" → "Los Angeles" (defensive, DB should already have full name)
  const normCity = (c: string | undefined) => c === 'LA' ? 'Los Angeles' : c;
  const awayName = awayNcaa?.ncaaName ?? normCity(awayNba?.city) ?? awayNhl?.city ?? awayMlb?.city ?? game.awayTeam.replace(/_/g, " ");
  const homeName = homeNcaa?.ncaaName ?? normCity(homeNba?.city) ?? homeNhl?.city ?? homeMlb?.city ?? game.homeTeam.replace(/_/g, " ");
  const awayNickname = awayNcaa?.ncaaNickname ?? awayNba?.nickname ?? awayNhl?.nickname ?? awayMlb?.nickname ?? "";
  const homeNickname = homeNcaa?.ncaaNickname ?? homeNba?.nickname ?? homeNhl?.nickname ?? homeMlb?.nickname ?? "";
  const awayLogoUrl = awayNcaa?.logoUrl ?? awayNba?.logoUrl ?? awayNhl?.logoUrl ?? awayMlb?.logoUrl;
  const homeLogoUrl = homeNcaa?.logoUrl ?? homeNba?.logoUrl ?? homeNhl?.logoUrl ?? homeMlb?.logoUrl;

  const time = formatMilitaryTime(game.startTimeEst, game.sport);
  // NCAAM uses PST — no midnight date-shift needed (00:00 is no longer used for NCAAM).
  // NBA/NHL use EST — no date-shift needed either (games end before midnight EST).
  const displayDate = game.gameDate;
  const dateLabel = formatDate(displayDate);

  // Score state
  const isLive = game.gameStatus === 'live';
  const isFinal = game.gameStatus === 'final';
  const isUpcoming = !isLive && !isFinal;
  const hasScores = (game.awayScore !== null && game.awayScore !== undefined) &&
                    (game.homeScore !== null && game.homeScore !== undefined);
  // Fix: include isLive so leading team in live games also gets winner styling (was isFinal-only)
  const awayWins = (isFinal || isLive) && hasScores && (game.awayScore! > game.homeScore!);
  const homeWins = (isFinal || isLive) && hasScores && (game.homeScore! > game.awayScore!);

  // Model toggle state (lifted from OddsLinesPanel)
  const [showModelInternal, setShowModelInternal] = useState(true);
  const showModel = showModelProp !== undefined ? showModelProp : showModelInternal;
  const toggleModel = onToggleModelProp ?? (() => setShowModelInternal((v) => !v));

  // Mobile tab state — controls which section is active on mobile full mode
  // Two tabs only: 'dual' (MODEL PROJECTIONS — BOOK+MODEL both active) | 'splits' (BETTING SPLITS)
  // DEFAULT: 'dual'
  type MobileTab = 'dual' | 'splits';
  const MOBILE_TAB_KEY = 'prez_bets_mobile_tab_v2';
  const getPersistedTab = (): MobileTab => {
    try {
      const stored = localStorage.getItem(MOBILE_TAB_KEY);
      if (stored === 'dual' || stored === 'splits') return stored;
    } catch { /* localStorage unavailable (private browsing, etc.) */ }
    return 'dual'; // fallback default
  };
  const [mobileTabInternal, setMobileTabInternal] = useState<MobileTab>(getPersistedTab);
  // When a feed-level prop is provided, use it; otherwise fall back to internal state
  const mobileTab: MobileTab = (mobileTabProp === 'dual' || mobileTabProp === 'splits') ? mobileTabProp : mobileTabInternal;
  const setMobileTab = (next: MobileTab) => {
    if (onMobileTabChange) {
      onMobileTabChange(next); // bubble up to feed
    } else {
      setMobileTabInternal(next); // standalone mode
    }
  };

  // Persist tab preference whenever it changes (only in standalone mode)
  useEffect(() => {
    if (!mobileTabProp) {
      try { localStorage.setItem(MOBILE_TAB_KEY, mobileTabInternal); } catch { /* ignore */ }
    }
  }, [mobileTabInternal, mobileTabProp]);

  // Per-team score flash — only the team whose score increased flashes neon green
  const prevAwayScoreRef = useRef<number | null>(null);
  const prevHomeScoreRef = useRef<number | null>(null);
  const [awayScoreFlash, setAwayScoreFlash] = useState(false);
  const [homeScoreFlash, setHomeScoreFlash] = useState(false);
  useEffect(() => {
    const curAway = game.awayScore ?? null;
    const curHome = game.homeScore ?? null;
    if (curAway !== null && prevAwayScoreRef.current !== null && curAway > prevAwayScoreRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`%c[GameCard:scoreFlash] game=${game.id} AWAY ${prevAwayScoreRef.current}→${curAway}`, 'color:#39FF14;font-size:10px');
      }
      setAwayScoreFlash(true);
      const t = setTimeout(() => setAwayScoreFlash(false), 800);
      prevAwayScoreRef.current = curAway;
      return () => clearTimeout(t);
    }
    if (curHome !== null && prevHomeScoreRef.current !== null && curHome > prevHomeScoreRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`%c[GameCard:scoreFlash] game=${game.id} HOME ${prevHomeScoreRef.current}→${curHome}`, 'color:#39FF14;font-size:10px');
      }
      setHomeScoreFlash(true);
      const t = setTimeout(() => setHomeScoreFlash(false), 800);
      prevHomeScoreRef.current = curHome;
      return () => clearTimeout(t);
    }
    // Initialize refs on first render
    if (curAway !== null) prevAwayScoreRef.current = curAway;
    if (curHome !== null) prevHomeScoreRef.current = curHome;
  }, [game.awayScore, game.homeScore, game.id]);

  // Desktop detection — used to apply desktop-only styles in ScorePanel
  // Tailwind lg breakpoint = 1024px
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const maxDiff = Math.max(isNaN(spreadDiff) ? 0 : spreadDiff, isNaN(totalDiff) ? 0 : totalDiff);
  const borderColor = getEdgeColor(maxDiff);

  const awayDisplayName = awayNickname || awayName;
  const homeDisplayName = homeNickname || homeName;

  const computedSpreadEdge: string | null = (() => {
    if (isNaN(spreadDiff) || spreadDiff <= 0) return "PASS";
    // For NHL: edge direction comes from game.spreadEdge (set by Python engine from P(margin>=2)).
    // Line arithmetic is invalid for NHL since both model and book always have ±1.5.
    if (isNhlGame) return game.spreadEdge ?? null;
    if (isNaN(awayModelSpread) || isNaN(awayBookSpread)) return game.spreadEdge;
    if (awayModelSpread < awayBookSpread) {
      return `${awayDisplayName} ${spreadSign(awayBookSpread)}`;
    } else {
      return `${homeDisplayName} ${spreadSign(homeBookSpread)}`;
    }
  })();

  const computedTotalEdge: string | null = (() => {
    if (isNaN(totalDiff) || totalDiff <= 0) return "PASS";
    // For NHL: edge direction must come from model odds at the book's line, NOT from comparing
    // model expected total vs book line. The model could have E_total > book line but still have
    // P(over) < 50% due to distribution shape. Use game.totalEdge (set by Python engine) for NHL.
    if (isNhlGame) return game.totalEdge ?? null;
    if (isNaN(modelTotal) || isNaN(bookTotal)) return game.totalEdge;
    return modelTotal > bookTotal ? `Over ${bookTotal}` : `Under ${bookTotal}`;
  })();

  const awayConsensus = isNaN(awayBookSpread) && isNaN(bookTotal)
    ? "—"
    : awayBookSpread < 0
    ? spreadSign(awayBookSpread)
    : isNaN(bookTotal) ? "—" : `${bookTotal}`;
  const homeConsensus = isNaN(homeBookSpread) && isNaN(bookTotal)
    ? "—"
    : homeBookSpread < 0
    ? spreadSign(homeBookSpread)
    : isNaN(bookTotal) ? "—" : `${bookTotal}`;

  // ── Score Panel ─────────────────────────────────────────────────────────────
  // Compact score panel for splits mode — logo + name only, score pushed right
  // NCAAM: show school name (awayName/homeName); NBA: show team nickname (awayNickname/homeNickname)
  const isNba = !awayNcaa && !!awayNba;
  const compactAwayLabel = isNba ? (awayNickname || awayName) : awayName;
  const compactHomeLabel = isNba ? (homeNickname || homeName) : homeName;

  // Mobile abbreviations: city-based 3-char uppercase label for frozen score panel
  // NHL: use official abbrev (e.g. "NSH", "EDM"). NBA: use abbrev if available.
  // NCAAM: derive from city/school name (first word, max 4 chars).
  const makeCityAbbr = (nhlEntry: typeof awayNhl, _nbaEntry: typeof awayNba, name: string): string => {
    if (nhlEntry?.abbrev) return nhlEntry.abbrev;          // NHL: official 3-letter abbrev
    // NCAAM / NBA fallback: first word of city/school name, max 4 chars
    const word = (name || '').split(/\s+/)[0] ?? name;
    return word.slice(0, 4).toUpperCase();
  };
  const awayAbbr = makeCityAbbr(awayNhl, awayNba, awayName);
  const homeAbbr = makeCityAbbr(homeNhl, homeNba, homeName);

  const CompactScorePanel = () => (
    <div className="flex flex-col justify-center h-full px-2 py-3 gap-2" style={{ minWidth: 0 }}>
      {/* Status: [star] [clock] [LIVE] */}
      <div className="flex items-center gap-1 mb-1">
        {isAppAuthed && (
          <button
            onClick={handleStarClick}
            aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
            title={isFavorited ? "Remove from favorites" : "Add to favorites"}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "2px 3px", lineHeight: 1, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: isFavorited ? "#FFD700" : "rgba(255,255,255,0.65)",
              opacity: 1,
              transition: "color 0.15s, transform 0.15s, filter 0.15s",
              filter: isFavorited ? "drop-shadow(0 0 3px #FFD700)" : "none",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.25)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24"
              fill={isFavorited ? "#FFD700" : "none"}
              stroke={isFavorited ? "#FFD700" : "rgba(255,255,255,0.85)"}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        )}
        {isLive ? (
          <>
            {game.gameClock && (
              <span className="text-[9px] tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>{game.gameClock}</span>
            )}
            <span className="flex items-center gap-0.5 text-[8px] font-black tracking-widest uppercase flex-shrink-0" style={{ color: "#39FF14" }}>
              <span className="w-1 h-1 rounded-full animate-pulse inline-block" style={{ background: "#39FF14" }} />
              LIVE
            </span>
          </>
        ) : isFinal ? (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide" style={{ background: "rgba(255,255,255,0.07)", color: "hsl(var(--muted-foreground))" }}>FINAL</span>
        ) : (
          <span className="text-[10px] font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>{time}</span>
        )}
      </div>
      {/* Away row */}
      <div className="flex items-center justify-between gap-1 w-full">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={22} />
          <span className="font-bold truncate" style={{ fontSize: 11, color: awayWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))", fontWeight: awayWins ? 800 : 600 }}>
            {compactAwayLabel}
          </span>
        </div>
        {(isLive || isFinal) && hasScores && (
          // winner=750, loser=600; font-black removed
          <span className="tabular-nums flex-shrink-0" style={{ fontSize: 20, lineHeight: 1,
            fontWeight: awayWins ? 750 : (isFinal || isLive) ? 600 : 900,
            color: awayWins ? "hsl(var(--foreground))" : (isFinal || isLive) ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
            {game.awayScore}
          </span>
        )}
      </div>
      <div style={{ height: 1, background: "hsl(var(--border) / 0.4)" }} />
      {/* Home row */}
      <div className="flex items-center justify-between gap-1 w-full">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={22} />
          <span className="font-bold truncate" style={{ fontSize: 11, color: homeWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))", fontWeight: homeWins ? 800 : 600 }}>
            {compactHomeLabel}
          </span>
        </div>
        {(isLive || isFinal) && hasScores && (
          // winner=750, loser=600; font-black removed
          <span className="tabular-nums flex-shrink-0" style={{ fontSize: 20, lineHeight: 1,
            fontWeight: homeWins ? 750 : (isFinal || isLive) ? 600 : 900,
            color: homeWins ? "hsl(var(--foreground))" : (isFinal || isLive) ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
            {game.homeScore}
          </span>
        )}
      </div>
    </div>
  );

  // Shows: game clock/status at top, then two team rows (logo + name + score)
  // Score sits immediately after the team name, not pushed to the far right.
  // For upcoming games: shows start time instead of scores.
  function ScorePanel() {
    // Uniform font sizes — same for every team, scale with viewport width only
    // No per-name auto-scaling; no truncation     // Winner: 700 bold; loser: 600 (500+100 = back up by 100 from previous iteration)
    const awayFontWeight = awayWins ? 700 : isFinal ? 600 : 600;
    const homeFontWeight = homeWins ? 700 : isFinal ? 600 : 600;
    // School name: clamp(13px, 1.1vw, 18px) — 13px mobile, ~15.8px at 1440px, 18px max
    const NAME_FONT_SIZE = 'clamp(13px, 1.1vw, 18px)';
    // Nickname: clamp(11px, 0.9vw, 15px) — always smaller than school name
    const NICK_FONT_SIZE = 'clamp(11px, 0.9vw, 15px)';
    // Desktop-specific sizes: 1.5× the NAME_FONT_SIZE (clamp(13px,1.1vw,18px))
    // → clamp(19.5px, 1.65vw, 27px) for star/clock/LIVE/FINAL/time
  // ── Change 3: reduce gameClock/LIVE/FINAL/star by 25% ──────────────────────
  // Before: desktop 24px star → now 18px (×0.75); clamp values ×0.75
  // Before: CLOCK 16-20px → now 12-15px; LIVE 14-18px → 10.5-13.5px; FINAL 16-20px → 12-15px
  const HEADER_ICON_SIZE = isDesktop ? 18 : 12; // star SVG px — was 24/16, now ×0.75
  const CLOCK_FONT_SIZE = isDesktop ? 'clamp(12px, 1.01vw, 15px)' : '8.25px';  // was clamp(16,1.35vw,20)/11px
  const LIVE_FONT_SIZE  = isDesktop ? 'clamp(10.5px, 0.83vw, 13.5px)' : '6.75px'; // was clamp(14,1.1vw,18)/9px
  const FINAL_FONT_SIZE = isDesktop ? 'clamp(12px, 1.01vw, 15px)' : '7.5px';   // was clamp(16,1.35vw,20)/10px
  const TIME_FONT_SIZE  = isDesktop ? 'clamp(12px, 1.01vw, 15px)' : '9.75px';  // was clamp(16,1.35vw,20)/13px
    // Desktop: teams pushed toward top (justify-start + small paddingTop)
    // Mobile: teams vertically centered (justify-center)
    const teamGroupJustify = 'center';
    const teamGroupPaddingTop = '0px';
    return (
    <div className="flex flex-col pl-2 pr-2 pt-0 pb-0" style={{ minHeight: '100%', justifyContent: 'center' }}>
      {/* Status row: [star] [clock/status] [LIVE badge]
          This row acts as the header spacer to align away/home rows with OddsTable.
          The OddsLinesPanel header (SPREAD/TOTAL/MONEYLINE + BOOK/MODEL rows) takes
          roughly the same height, so we use flex-grow on the team rows to fill space. */}
      <div className="flex items-center gap-1.5 mb-0.5">
        {/* Star / Favorite button — always left of status */}
        {isAppAuthed && (
          <button
            onClick={handleStarClick}
            aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
            title={isFavorited ? "Remove from favorites" : "Add to favorites"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: isDesktop ? "3px 4px" : "3px 4px",
              lineHeight: 1,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isFavorited ? "#FFD700" : "rgba(255,255,255,0.65)",
              opacity: 1,
              transition: "color 0.15s, transform 0.15s, filter 0.15s",
              // ── Change 6: reduce star glow by ~50% (4px→2px radius, opacity 0.6) ──
              filter: isFavorited ? "drop-shadow(0 0 2px rgba(255,215,0,0.6))" : "none",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.25)"; if (!isFavorited) e.currentTarget.style.color = "rgba(255,255,255,0.95)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; if (!isFavorited) e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
          >
            {/* Desktop: 24px star (1.5× mobile 16px) */}
            <svg width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} viewBox="0 0 24 24"
              fill={isFavorited ? "#FFD700" : "none"}
              stroke={isFavorited ? "#FFD700" : "rgba(255,255,255,0.85)"}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        )}
        {/* Game status: time / FINAL / clock */}
        {isLive ? (
          <>            {/* LIVE pill FIRST (left), then gameClock to the right */}
            {/* LIVE indicator — same pill format as FINAL badge, fully rounded, LEFT of clock */}
            {/* Desktop: clamp(14px,1.1vw,18px) — 1.5× mobile 9px */}
            <span
              className="px-1.5 py-0.5 font-bold tracking-wide flex-shrink-0 flex items-center"
              style={{
                fontSize: LIVE_FONT_SIZE,
                background: "rgba(57,255,20,0.12)",
                color: "#39FF14",
                border: "1px solid rgba(57,255,20,0.4)",
                letterSpacing: "0.08em",
                // ── Change 1: borderRadius halved (9999px → 12px) ──────────────
                borderRadius: '12px',
                // ── Change 2: gap between dot and LIVE text increased (gap-1=4px → 8px) ──
                gap: '8px',
              }}
            >
              <span
                className="rounded-full animate-pulse inline-block flex-shrink-0"
                style={{
                  width: isDesktop ? '8px' : '5px',
                  height: isDesktop ? '8px' : '5px',
                  background: "#39FF14",
                }}
              />
              LIVE
            </span>
            {/* gameClock to the RIGHT of LIVE pill */}
            {game.gameClock && (
              /* Desktop: clamp(16px,1.35vw,20px) — 1.5× mobile 11px */
              <span className="font-semibold tabular-nums" style={{ fontSize: CLOCK_FONT_SIZE, color: "hsl(var(--muted-foreground))" }}>
                {game.gameClock}
              </span>
            )}
          </>
        ) : isFinal ? (
          /* Desktop: neon green FINAL badge — 1.5× mobile 10px */
          <span
            className="px-1.5 py-0.5 font-bold tracking-wide"
            style={{
              fontSize: FINAL_FONT_SIZE,
              background: isDesktop ? "rgba(57,255,20,0.12)" : "rgba(255,255,255,0.07)",
              color: isDesktop ? "#39FF14" : "hsl(var(--muted-foreground))",
              border: isDesktop ? "1px solid rgba(57,255,20,0.4)" : "none",
              // ── Change 1: FINAL pill borderRadius matches LIVE (12px) ──────
              borderRadius: '12px',
            }}
          >
            FINAL
          </span>
        ) : (
          /* Desktop: clamp(16px,1.35vw,20px) — 1.5× mobile 13px */
          <span className="font-bold" style={{ fontSize: TIME_FONT_SIZE, color: "hsl(var(--foreground))" }}>
            {time}
          </span>
        )}
      </div>

      {/* Team group — desktop: pushed toward top; mobile: vertically centered */}
      <div className="flex flex-1 flex-col" style={{ gap: 0, justifyContent: teamGroupJustify, paddingTop: teamGroupPaddingTop }}>
      {/* Away team row */}
      <div className="flex items-center justify-between gap-2 py-1 w-full">
        {/* Left: logo + name/nickname — always two lines for both NCAAM and NBA */}
          <div className="flex items-center gap-2">
          <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={36} />
          {/* Uniform font size — no auto-scaling, no truncation */}
          <div className="flex flex-col">
            <span
              className="font-semibold leading-tight"
              style={{
                fontSize: NAME_FONT_SIZE,
                color: awayWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: awayFontWeight,
                whiteSpace: 'nowrap',
                lineHeight: 1.15,
              }}
            >
              {awayName}
            </span>
            {/* Nickname line 2 */}
            <span className="leading-none" style={{ fontSize: NICK_FONT_SIZE, color: "hsl(var(--muted-foreground))", whiteSpace: 'nowrap' }}>
              {awayNickname || "\u00A0"}
            </span>
          </div>
        </div>
        {/* Right: score pushed to far right */}
        {(isLive || isFinal) && hasScores && (
          <span
            className="tabular-nums flex-shrink-0 transition-colors duration-300"
            style={{
              /* NBA scores are 3 digits (100-130) — use smaller clamp to prevent overflow in 160px panel */
              fontSize: isNba ? "clamp(18px, 2vw, 38px)" : "clamp(22px, 2.5vw, 44px)",
              lineHeight: 1,
              /* Winner=750, loser=600 for FINAL+LIVE; pregame stays 900 */
              fontWeight: awayScoreFlash ? 900 : awayWins ? 700 : (isFinal || isLive) ? 600 : 900,
              color: awayScoreFlash
                ? "#39FF14"
                : awayWins
                ? "hsl(var(--foreground))"
                : (isFinal || isLive)
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--foreground))",
              textShadow: awayScoreFlash ? "0 0 12px rgba(57,255,20,0.7)" : "none",
            }}
          >
            {game.awayScore}
          </span>
        )}
      </div>

      {/* Divider — mirrors OddsLinesPanel divider */}
      <div style={{ height: 1, background: "hsl(var(--border) / 0.4)" }} />

      {/* Home team row */}
      <div className="flex items-center justify-between gap-2 py-1 w-full">
        {/* Left: logo + name/nickname — always two lines for both NCAAM and NBA */}
          <div className="flex items-center gap-2">
          <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={36} />
          {/* Uniform font size — no auto-scaling, no truncation */}
          <div className="flex flex-col">
            <span
              className="font-semibold leading-tight"
              style={{
                fontSize: NAME_FONT_SIZE,
                color: homeWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: homeFontWeight,
                whiteSpace: 'nowrap',
                lineHeight: 1.15,
              }}
            >
              {homeName}
            </span>
            {/* Nickname line 2 */}
            <span className="leading-none" style={{ fontSize: NICK_FONT_SIZE, color: "hsl(var(--muted-foreground))", whiteSpace: 'nowrap' }}>
              {homeNickname || "\u00A0"}
            </span>
          </div>
        </div>
        {/* Right: score pushed to far right */}
        {(isLive || isFinal) && hasScores && (
          <span
            className="tabular-nums flex-shrink-0 transition-colors duration-300"
            style={{
              fontSize: isNba ? "clamp(18px, 2vw, 38px)" : "clamp(22px, 2.5vw, 44px)",
              lineHeight: 1,
              /* Winner=750, loser=600 for FINAL+LIVE; pregame stays 900 */
              fontWeight: homeScoreFlash ? 900 : homeWins ? 700 : (isFinal || isLive) ? 600 : 900,
              color: homeScoreFlash
                ? "#39FF14"
                : homeWins
                ? "hsl(var(--foreground))"
                : (isFinal || isLive)
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--foreground))",
              textShadow: homeScoreFlash ? "0 0 12px rgba(57,255,20,0.7)" : "none",
            }}
          >
            {game.homeScore}
          </span>
        )}
      </div>

      {/* MLB-specific metadata: venue, broadcaster, starting pitchers */}
      {isMlbGame && isUpcoming && (
        <div className="flex flex-col gap-0.5 px-2 pb-1.5" style={{ marginTop: 2 }}>
          {/* Venue + broadcaster on one line */}
          {(game.venue || game.broadcaster) && (
            <div className="flex items-center gap-1 flex-wrap">
              {game.venue && (
                <span style={{ fontSize: 'clamp(9px, 0.7vw, 11px)', color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
                  {game.venue}
                </span>
              )}
              {game.venue && game.broadcaster && (
                <span style={{ fontSize: 'clamp(9px, 0.7vw, 11px)', color: 'hsl(var(--border))' }}>·</span>
              )}
              {game.broadcaster && (
                <span style={{ fontSize: 'clamp(9px, 0.7vw, 11px)', color: '#60a5fa', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {game.broadcaster}
                </span>
              )}
              {(game.doubleHeader === 'Y' || game.doubleHeader === 'S') && (
                <span style={{ fontSize: 'clamp(8px, 0.65vw, 10px)', color: '#f59e0b', fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 2 }}>
                  DH-{game.doubleHeader === 'Y' ? '1' : '2'}
                </span>
              )}
            </div>
          )}
          {/* Starting pitchers */}
          {(game.awayStartingPitcher || game.homeStartingPitcher) && (
            <div className="flex items-center gap-1 flex-wrap">
              <span style={{ fontSize: 'clamp(8px, 0.65vw, 10px)', color: 'hsl(var(--muted-foreground))', opacity: 0.6, whiteSpace: 'nowrap' }}>SP:</span>
              {game.awayStartingPitcher && (
                <span style={{ fontSize: 'clamp(8px, 0.65vw, 10px)', color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
                  {game.awayStartingPitcher}{!game.awayPitcherConfirmed ? ' *' : ''}
                </span>
              )}
              {game.awayStartingPitcher && game.homeStartingPitcher && (
                <span style={{ fontSize: 'clamp(8px, 0.65vw, 10px)', color: 'hsl(var(--border))' }}>vs</span>
              )}
              {game.homeStartingPitcher && (
                <span style={{ fontSize: 'clamp(8px, 0.65vw, 10px)', color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
                  {game.homeStartingPitcher}{!game.homePitcherConfirmed ? ' *' : ''}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      </div>{/* end team group wrapper */}
    </div>
    );
  }

  // OddsLinesPanel is now a top-level component (defined above GameCard)
  // to prevent infinite re-render loops from component identity changes.

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full relative"
        style={{
          background: "hsl(var(--card))",
          borderTop: "1px solid hsl(var(--border))",
          borderBottom: "1px solid hsl(var(--border))",
          borderLeft: `3px solid ${borderColor}`,
          overflowX: "clip",
        }}
      >

        {/*
          DESKTOP (≥ lg): single horizontal 3-column row
            Score panel | Odds/Lines | Betting Splits
          MOBILE (< lg): 2-row layout
            Row 1: Score panel (full width)
            Row 2: Odds/Lines (left ~45%) | Betting Splits (right ~55%)
        */}

        {/* ── Desktop layout ── */}
        {/* MIN-HEIGHT: ensures a consistent baseline card height while allowing taller content (e.g. OPEN sub-rows) to expand naturally without clipping */}
        <div className="hidden lg:flex items-stretch w-full" style={{ minHeight: 'clamp(160px,14vw,220px)' }}>
          {/* Col 1: Score panel — fixed width so all SPREAD/TOTAL/ML/EDGE borders align at same horizontal position */}
          <div
            style={{
              flex: mode === "splits" ? "1 1 30%" : "0 0 clamp(200px,16vw,260px)",
              width: mode === "splits" ? undefined : 'clamp(200px,16vw,260px)',
              borderRight: "1px solid hsl(var(--border) / 0.5)",
            }}
          >
            <ScorePanel />
          </div>

          {/* Col 2+3: Merged panel (full + projections modes) — BOOK → splits → MODEL per section + EdgeVerdict */}
          {(mode === "projections" || mode === "full") && (
            <div className="flex-1 min-w-0" style={{ borderLeft: "1px solid hsl(var(--border) / 0.5)" }}>
              <DesktopMergedPanel
                awayBookSpread={awayBookSpread}
                homeBookSpread={homeBookSpread}
                bookTotal={bookTotal}
                awayML={game.awayML ?? '—'}
                homeML={game.homeML ?? '—'}
                awayModelSpread={awayModelSpread}
                homeModelSpread={homeModelSpread}
                modelTotal={modelTotal}
                modelAwayML={game.modelAwayML}
                modelHomeML={game.modelHomeML}
                spreadDiff={spreadDiff}
                totalDiff={totalDiff}
                computedSpreadEdge={computedSpreadEdge}
                computedTotalEdge={computedTotalEdge}
                awayLogoUrl={awayLogoUrl}
                homeLogoUrl={homeLogoUrl}
                awaySlug={game.awayTeam}
                homeSlug={game.homeTeam}
                awayDisplayName={awayDisplayName}
                homeDisplayName={homeDisplayName}
                showModel={showModel}
                onToggleModel={toggleModel}
                game={game}
              />
            </div>
          )}

          {/* Col 2: Odds/Lines — non-projections, non-full modes (splits mode uses its own layout below) */}
          {mode !== "projections" && mode !== "full" && mode !== "splits" && (
            <div
              className="flex flex-col justify-center"
              style={{
                flex: "1.5 1 28%",
                minWidth: 190,
                borderRight: "1px solid hsl(var(--border) / 0.5)",
              }}
            >
              <OddsLinesPanel
                awayBookSpread={awayBookSpread}
                homeBookSpread={homeBookSpread}
                bookTotal={bookTotal}
                awayML={game.awayML ?? '—'}
                homeML={game.homeML ?? '—'}
                awaySpreadOdds={game.awaySpreadOdds ?? null}
                homeSpreadOdds={game.homeSpreadOdds ?? null}
                overOdds={game.overOdds ?? null}
                underOdds={game.underOdds ?? null}
                openAwaySpreadStr={openAwaySpreadStr}
                openHomeSpreadStr={openHomeSpreadStr}
                openOverStr={openOverStr}
                openUnderStr={openUnderStr}
                openAwayMlStr={openAwayMlStr}
                openHomeMlStr={openHomeMlStr}
                displayAwaySpread={displayAwaySpread}
                displayHomeSpread={displayHomeSpread}
                displayOver={displayOver}
                displayUnder={displayUnder}
                displayAwayML={displayAwayML}
                displayHomeML={displayHomeML}
                awayModelSpread={awayModelSpread}
                homeModelSpread={homeModelSpread}
                modelTotal={modelTotal}
                modelAwayML={game.modelAwayML}
                modelHomeML={game.modelHomeML}
                spreadDiff={spreadDiff}
                totalDiff={totalDiff}
                computedSpreadEdge={computedSpreadEdge}
                computedTotalEdge={computedTotalEdge}
                awayLogoUrl={awayLogoUrl}
                homeLogoUrl={homeLogoUrl}
                awaySlug={game.awayTeam}
                homeSlug={game.homeTeam}
                awayDisplayName={awayDisplayName}
                homeDisplayName={homeDisplayName}
                showModel={showModel}
                onToggleModel={toggleModel}
                sport={game.sport}
                modelAwayPLOdds={game.modelAwayPLOdds}
                modelHomePLOdds={game.modelHomePLOdds}
                modelOverOdds={game.modelOverOdds}
                modelUnderOdds={game.modelUnderOdds}
                modelAwaySpreadOdds={game.modelAwaySpreadOdds ?? null}
                modelHomeSpreadOdds={game.modelHomeSpreadOdds ?? null}
              />
            </div>
          )}

          {/* Col 3: Betting Splits — non-projections, non-full, non-splits modes */}
          {mode !== "projections" && mode !== "full" && mode !== "splits" && (
            <div className="flex flex-col" style={{ flex: "2 1 40%", minWidth: 220, borderLeft: "1px solid hsl(var(--border) / 0.5)" }}>
              <div className="px-3 py-2">
                <BettingSplitsPanel
                  game={game}
                  awayLabel={awayName}
                  homeLabel={homeName}
                  awayNickname={awayNickname}
                  homeNickname={homeNickname}
                />
              </div>
            </div>
          )}
          {mode === "splits" && (
            <div className="flex-1 px-3 py-3" style={{ minWidth: 220 }}>
              <BettingSplitsPanel
                game={game}
                awayLabel={awayName}
                homeLabel={homeName}
                awayNickname={awayNickname}
                homeNickname={homeNickname}
              />
            </div>
          )}
        </div>

        {/* ── Mobile layout ── */}
        {/*
          KEY DESIGN: The score panel is NOT inside the scroll container.
          Instead, the card uses a CSS Grid with two columns:
            - Left column: fixed-width score panel (never scrolls)
            - Right column: overflow-x:auto scroll container (Odds/Lines + Splits)
          This completely eliminates the z-index bleed issue because the score
          panel and the scroll container are siblings, not parent/child.
        */}
        <div className="lg:hidden w-full">

          {/* Projections mode */}
          {mode === "projections" && (
            <div className="flex flex-col w-full">
              {/* Grid row: fixed score column | scrollable odds column */}
              {/* Score panel: 160px — wide enough for team name+score, narrow enough to give Odds/Lines full space */}
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", width: "100%" }}>
                {/* Fixed score panel — NOT inside scroll container */}
                <div
                  style={{
                    gridColumn: "1",
                    borderRight: "1px solid hsl(var(--border) / 0.5)",
                    background: "hsl(var(--card))",
                    zIndex: 1,
                  }}
                >
                  <ScorePanel />
                </div>
                {/* Scroll container — only the right column scrolls */}
                <div
                  style={{
                    gridColumn: "2",
                    overflowX: "auto",
                    overflowY: "hidden",
                  }}
                  className="flex flex-col justify-center"
                >
                   {/* minWidth = calc(100vw - clamp(170px,14vw,220px)): exactly fills scroll container so when scrolled fully right, 0px bleeds through */}
                   <div style={{ minWidth: "calc(100vw - clamp(170px, 14vw, 220px))" }} className="flex flex-col justify-center">
                    <OddsLinesPanel
                      awayBookSpread={awayBookSpread}
                      homeBookSpread={homeBookSpread}
                      bookTotal={bookTotal}
                      awayML={game.awayML ?? '—'}
                      homeML={game.homeML ?? '—'}
                      awaySpreadOdds={game.awaySpreadOdds ?? null}
                      homeSpreadOdds={game.homeSpreadOdds ?? null}
                      overOdds={game.overOdds ?? null}
                      underOdds={game.underOdds ?? null}
                      openAwaySpreadStr={openAwaySpreadStr}
                      openHomeSpreadStr={openHomeSpreadStr}
                      openOverStr={openOverStr}
                      openUnderStr={openUnderStr}
                      openAwayMlStr={openAwayMlStr}
                      openHomeMlStr={openHomeMlStr}
                      displayAwaySpread={displayAwaySpread}
                      displayHomeSpread={displayHomeSpread}
                      displayOver={displayOver}
                      displayUnder={displayUnder}
                      displayAwayML={displayAwayML}
                      displayHomeML={displayHomeML}
                      awayModelSpread={awayModelSpread}
                      homeModelSpread={homeModelSpread}
                      modelTotal={modelTotal}
                      modelAwayML={game.modelAwayML}
                      modelHomeML={game.modelHomeML}
                      spreadDiff={spreadDiff}
                      totalDiff={totalDiff}
                      computedSpreadEdge={computedSpreadEdge}
                      computedTotalEdge={computedTotalEdge}
                      awayLogoUrl={awayLogoUrl}
                      homeLogoUrl={homeLogoUrl}
                      awaySlug={game.awayTeam}
                      homeSlug={game.homeTeam}
                      awayDisplayName={awayDisplayName}
                      homeDisplayName={homeDisplayName}
                      showModel={showModel}
                      onToggleModel={toggleModel}
                      sport={game.sport}
                      modelAwayPLOdds={game.modelAwayPLOdds}
                      modelHomePLOdds={game.modelHomePLOdds}
                      modelOverOdds={game.modelOverOdds}
                      modelUnderOdds={game.modelUnderOdds}
                      modelAwaySpreadOdds={(game as unknown as Record<string, string | null>).modelAwaySpreadOdds ?? null}
                      modelHomeSpreadOdds={(game as unknown as Record<string, string | null>).modelHomeSpreadOdds ?? null}
                    />
                  </div>
                </div>
              </div>
              {/* Row 2: EdgeVerdict — compact horizontal row flush below the table */}
              {showModel && (
                <div
                  className="flex items-center justify-start w-full px-0 py-0"
                  style={{ borderTop: "1px solid hsl(var(--border) / 0.5)", minHeight: 24 }}
                >
                  <EdgeVerdict
                    spreadDiff={isNaN(spreadDiff) ? null : spreadDiff}
                    spreadEdge={computedSpreadEdge}
                    totalDiff={isNaN(totalDiff) ? null : totalDiff}
                    totalEdge={computedTotalEdge}
                    awayLogoUrl={awayLogoUrl}
                    homeLogoUrl={homeLogoUrl}
                    awaySlug={game.awayTeam}
                    homeSlug={game.homeTeam}
                    awayDisplayName={awayDisplayName}
                    homeDisplayName={homeDisplayName}
                    compact
                  />
                </div>
              )}
              {/* Subtle card separator */}
              <div style={{ height: 8 }} />
              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", width: "100%" }} />
            </div>
          )}

          {/* Splits mode: fixed CompactScore column | scrollable Splits column */}
          {mode === "splits" && (
            <div style={{ display: "grid", gridTemplateColumns: "clamp(170px, 14vw, 220px) 1fr", width: "100%" }}>
              {/* Fixed compact score — NOT inside scroll container */}
              <div
                style={{
                  gridColumn: "1",
                  borderRight: "1px solid hsl(var(--border) / 0.5)",
                  background: "hsl(var(--card))",
                  zIndex: 1,
                }}
              >
                <CompactScorePanel />
              </div>
              {/* Scroll container for splits */}
              <div
                style={{
                  gridColumn: "2",
                  overflowX: "auto",
                  overflowY: "hidden",
                }}
              >
                <div style={{ minWidth: 260 }}>
                  <BettingSplitsPanel
                    game={game}
                    awayLabel={awayName}
                    homeLabel={homeName}
                    awayNickname={awayNickname}
                    homeNickname={homeNickname}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────────────
               MOBILE FULL MODE — Tab-based layout
               ┌──────────────────────────────────────────────────────────────┐
               │  FROZEN LEFT PANEL (120px)  │  RIGHT PANEL (flex-1)         │
               │  Logo + Abbr + Score        │  [TAB BAR sticky]             │
               │                             │  Active section content       │
               │                             │  BOOK LINES / MODEL LINES /   │
               │                             │  SPLITS / EDGE                │
               └──────────────────────────────────────────────────────────────┘
               Tabs: BOOK LINES | MODEL LINES | SPLITS | EDGE
               Toggle dimming:
                 BOOK active  → book values white bold, model #39FF14 40% opacity
                 MODEL active → book values gray 40% opacity, model #39FF14 bold
          ──────────────────────────────────────────────────────────────────── */}
          {mode === "full" && (() => {
            // ── Structured logging: GameCard mobile full render ──────────────
            if (process.env.NODE_ENV === 'development') {
              console.groupCollapsed(
                `%c[GameCard:mobile] ${awayAbbr} @ ${homeAbbr} | tab=${mobileTab} | id=${game.id}`,
                'color:#39FF14;font-weight:700;font-size:11px'
              );
              console.log('[data] spread:', { awayBookSpread, homeBookSpread, awayModelSpread, homeModelSpread, spreadDiff });
              console.log('[data] total:', { bookTotal, modelTotal, totalDiff });
              console.log('[data] ml:', { awayML: game.awayML, homeML: game.homeML, modelAwayML: game.modelAwayML, modelHomeML: game.modelHomeML });
              console.log('[edge] spread:', computedSpreadEdge, '| total:', computedTotalEdge);
              console.log('[state] showModel:', showModel, '| mobileTab:', mobileTab, '| status:', game.gameStatus);
              console.groupEnd();
            }

            // ── Game clock formatter ──────────────────────────────────────
            // Period notation: 1Q/2Q/3Q/4Q, 1H/2H, 1P/2P/3P (never 1st/2nd/3rd/4th)
            const formatGameClock = (raw: string | null | undefined): string => {
              if (!raw) return '';
              const s = raw.trim();

              // ── Server-emitted NCAAM clock strings (already transformed) ──────
              // These come pre-formatted from ncaaScoreboard.ts; pass through directly.
              if (/^END\s+1ST\s+HALF$/i.test(s)) return 'END 1ST HALF';
              if (/^END\s+2ND\s+HALF$/i.test(s)) return 'END 2ND HALF';
              if (/^1ST\s+HALF$/i.test(s)) return '1ST HALF';
              if (/^2ND\s+HALF$/i.test(s)) return '2ND HALF';
              if (/^HALFTIME$/i.test(s)) return 'HALFTIME';

              // ── NHL intermission strings (server-emitted from nhlSchedule.ts) ──
              // "1ST INT", "2ND INT" = intermission after period 1/2
              if (/^1ST\s+INT$/i.test(s)) return '1ST INT';
              if (/^2ND\s+INT$/i.test(s)) return '2ND INT';
              if (/^OT\s+INT$/i.test(s)) return 'OT INT';
              // "END 1P", "END 2P", "END 3P", "END OT" = end of period
              if (/^END\s+(\d+P|OT)$/i.test(s)) return s.toUpperCase();
              // "Final/OT", "Final/SO" — pass through
              if (/^Final\/(OT|SO)$/i.test(s)) return s;
              // "SO" = shootout
              if (/^SO$/i.test(s)) return 'SO';
              // "OT" = overtime
              if (/^OT$/i.test(s)) return 'OT';
              // NHL period labels: "1P", "2P", "3P"
              if (/^[123]P$/i.test(s)) return s.toUpperCase();

              // ── Legacy / NBA / raw NCAA labels (fallback normalization) ───────
              // Raw half labels (in case old DB rows still have these)
              if (/^1st$/i.test(s)) return '1ST HALF';
              if (/^2nd$/i.test(s)) return '2ND HALF';
              if (/^half(time)?$/i.test(s)) return 'HALFTIME';
              // Quarter labels → 1Q/2Q/3Q/4Q (NBA)
              if (/^q?1(st)?$/i.test(s)) return '1Q';
              if (/^q?2(nd)?$/i.test(s)) return '2Q';
              if (/^q?3(rd)?$/i.test(s)) return '3Q';
              if (/^q?4(th)?$/i.test(s)) return '4Q';
              // Period labels (hockey legacy) → 1P/2P/3P
              if (/^1(st)?\s+period$/i.test(s)) return '1P';
              if (/^2(nd)?\s+period$/i.test(s)) return '2P';
              if (/^3(rd)?\s+period$/i.test(s)) return '3P';
              // MM:SS clock — pass through as-is
              if (/^\d{1,2}:\d{2}$/.test(s)) return s;
              // Compound: "09:36 1ST HALF" or "14:32 1P" — normalize period label then keep clock
              // Pattern: clock-first (server format) "MM:SS LABEL"
              const clockFirst = s.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
              if (clockFirst) {
                const [, mm, periodRaw] = clockFirst;
                const periodLabel = formatGameClock(periodRaw);
                // Check for zero clock
                const isZero = /^0?0:00$/.test(mm);
                if (isZero && /half/i.test(periodLabel)) {
                  return `END ${periodLabel}`;
                }
                if (isZero && /^[123]P$/i.test(periodLabel)) {
                  return `END ${periodLabel.toUpperCase()}`;
                }
                return `${mm} ${periodLabel}`;
              }
              // Pattern: period-first (legacy) "LABEL MM:SS"
              const compound = s.match(/^(q?\d|\d+(?:st|nd|rd|th)?(?:\s+(?:period|half))?|half(?:time)?)\s+(\d{1,2}:\d{2})$/i);
              if (compound) {
                const period = formatGameClock(compound[1]);
                return `${period} ${compound[2]}`;
              }
              return s;
            };
            const formattedClock = formatGameClock(game.gameClock);

               // ── Derived values for mobile odds table ─────────────────
            // Spread odds in parentheses, e.g. "+1.5 (-225)" / "-1.5 (+185)"
            const mbAwaySpreadOdds = game.awaySpreadOdds ?? null;
            const mbHomeSpreadOdds = game.homeSpreadOdds ?? null;
            const mbOverOdds  = game.overOdds ?? null;
            const mbUnderOdds = game.underOdds ?? null;
            const bkAwaySpreadStr  = !isNaN(awayBookSpread)
              ? (mbAwaySpreadOdds ? `${spreadSign(awayBookSpread)} (${mbAwaySpreadOdds})` : spreadSign(awayBookSpread))
              : '—';
            const bkHomeSpreadStr  = !isNaN(homeBookSpread)
              ? (mbHomeSpreadOdds ? `${spreadSign(homeBookSpread)} (${mbHomeSpreadOdds})` : spreadSign(homeBookSpread))
              : '—';
            const bkTotalStr       = !isNaN(bookTotal) ? String(bookTotal) : '—';
            // Over/Under strings with odds, e.g. "o5.5 (-107)" / "u5.5 (-113)"
            const bkOverStr  = !isNaN(bookTotal)
              ? (mbOverOdds  ? `o${bkTotalStr} (${mbOverOdds})`  : `o${bkTotalStr}`)
              : 'o—';
            const bkUnderStr = !isNaN(bookTotal)
              ? (mbUnderOdds ? `u${bkTotalStr} (${mbUnderOdds})` : `u${bkTotalStr}`)
              : 'u—';
            // For NHL/NCAAM: include puck line / spread odds and total odds in model display strings
            // LOG: [GameCard:MobileOdds] trace model odds for each sport
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:MobileOdds] game=${game.id} sport=${game.sport} ` +
                `mdlAwaySpreadOdds=${game.modelAwaySpreadOdds ?? 'null'} mdlHomeSpreadOdds=${game.modelHomeSpreadOdds ?? 'null'} ` +
                `mdlOverOdds=${game.modelOverOdds ?? 'null'} mdlUnderOdds=${game.modelUnderOdds ?? 'null'} ` +
                `isMlbGame=${isMlbGame} isNhlGame=${isNhlGame} isNcaamGame=${isNcaamGame}`,
                'color:#FF9900;font-size:9px'
              );
            }
            const mdlAwaySpreadStr = !isNaN(awayModelSpread)
              ? (isNhlGame && game.modelAwayPLOdds
                  ? `${spreadSign(awayModelSpread)} (${game.modelAwayPLOdds})`
                  : (isNcaamGame || isMlbGame) && game.modelAwaySpreadOdds
                  ? `${spreadSign(awayModelSpread)} (${game.modelAwaySpreadOdds})`
                  : spreadSign(awayModelSpread))
              : '—';
            const mdlHomeSpreadStr = !isNaN(homeModelSpread)
              ? (isNhlGame && game.modelHomePLOdds
                  ? `${spreadSign(homeModelSpread)} (${game.modelHomePLOdds})`
                  : (isNcaamGame || isMlbGame) && game.modelHomeSpreadOdds
                  ? `${spreadSign(homeModelSpread)} (${game.modelHomeSpreadOdds})`
                  : spreadSign(homeModelSpread))
              : '—';
            // For NHL: display the BOOK's total line with the model's fair odds at that line
            const mdlDisplayTotal = isNhlGame && !isNaN(bookTotal) ? bookTotal : modelTotal;
            const mdlTotalStr = !isNaN(mdlDisplayTotal) ? String(mdlDisplayTotal) : '—';
            // For NHL/NCAAM/MLB: total display strings include O/U odds at the model's line
            const mdlOverTotalStr  = !isNaN(mdlDisplayTotal)
              ? ((isNhlGame || isNcaamGame || isMlbGame) && game.modelOverOdds  ? `${mdlTotalStr} (${game.modelOverOdds})`  : mdlTotalStr)
              : '—';
            const mdlUnderTotalStr = !isNaN(mdlDisplayTotal)
              ? ((isNhlGame || isNcaamGame || isMlbGame) && game.modelUnderOdds ? `${mdlTotalStr} (${game.modelUnderOdds})` : mdlTotalStr)
              : '—';
            // ── Split helpers: parse "value (odds)" → { line, odds } for two-line pill rendering ──
            // Used by mobile OddsTable to pass mainValue and juiceStr separately to OddsCell
            const splitOddsStr = (s: string): { line: string; odds: string | null } => {
              const m = s.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
              if (m) return { line: m[1].trim(), odds: m[2].trim() };
              return { line: s, odds: null };
            };
            const mdlAwaySplit  = splitOddsStr(mdlAwaySpreadStr);
            const mdlHomeSplit  = splitOddsStr(mdlHomeSpreadStr);
            const mdlOverSplit  = splitOddsStr(mdlOverTotalStr);
            const mdlUnderSplit = splitOddsStr(mdlUnderTotalStr);

            // ML values — always show + prefix for positive (underdog) values
            // +100 displays as 'EV' (even money; -100 does not exist as a valid ML)
            // LOG: [GameCard:ML] logs raw→formatted for every game in dev
            const formatMl = (raw: string | number | null | undefined): string => {
              if (raw == null || raw === '' || raw === '—') return '—';
              const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''));
              if (isNaN(n)) return String(raw);
              if (n === 100) return 'EV';   // +100 = even money
              if (n > 0) return `+${n}`;
              return String(n);
            };
            const bkAwayMl  = formatMl(game.awayML);
            const bkHomeMl  = formatMl(game.homeML);
            const mdlAwayMl = formatMl(game.modelAwayML);
            const mdlHomeMl = formatMl(game.modelHomeML);

            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:ML] game=${game.id} bkAway=${bkAwayMl} bkHome=${bkHomeMl} mdlAway=${mdlAwayMl} mdlHome=${mdlHomeMl}`,
                'color:#39FF14;font-size:9px'
              );
            }

               // ── Edge direction helpers ────────────────────────────────────
            const spreadEdgeIsAway = (() => {
              if (isNaN(spreadDiff) || spreadDiff <= 0) return null;
              // For NHL: puck line is always ±1.5/±2.5 from simulation.
              // Line arithmetic is invalid — use computedSpreadEdge (from Python engine P(margin>=2)).
              if (isNhlGame) {
                if (!computedSpreadEdge || computedSpreadEdge === 'PASS') return null;
                return computedSpreadEdge.includes('+1.5') || computedSpreadEdge.includes('+2.5');
              }
              if (!isNaN(awayModelSpread) && !isNaN(awayBookSpread)) return awayModelSpread < awayBookSpread;
              return null;
            })();
            const totalEdgeIsOver = (() => {
              if (isNaN(totalDiff) || totalDiff <= 0) return null;
              // For NHL: edge direction must come from computedTotalEdge (set by Python engine from
              // model odds at the book's line), NOT from comparing model expected total vs book line.
              if (isNhlGame) {
                if (!computedTotalEdge || computedTotalEdge === 'PASS') return null;
                const normalized = computedTotalEdge.toUpperCase();
                if (normalized.startsWith('OVER')) return true;
                if (normalized.startsWith('UNDER')) return false;
                return null;
              }
              if (!isNaN(modelTotal) && !isNaN(bookTotal)) return modelTotal > bookTotal;
              return null;
            })();

            // ── ML edge detection — unified with spread edge direction ──────────────
            //
            // PRIMARY RULE: ML edge direction MUST match spread edge direction.
            //   spreadEdgeIsAway === true  → away team ML is the edge (same team covers spread)
            //   spreadEdgeIsAway === false → home team ML is the edge
            //   spreadEdgeIsAway === null  → no spread edge; fall back to implied-probability
            //
            // SECONDARY FALLBACK (only when no spread edge exists):
            //   Implied probability: p = 100 / (|ML| + 100) for positive ML (underdog)
            //                        p = |ML| / (|ML| + 100) for negative ML (favorite)
            //   Edge exists when model implied prob > book implied prob by >= 2%
            //
            // GUARANTEE: zero contradictions — you cannot have UCLA spread edge AND
            // Rutgers ML edge simultaneously; they always point to the same team.
            const mlImpliedProb = (ml: string | number | null | undefined): number => {
              if (ml == null || ml === '' || ml === '—') return NaN;
              const n = typeof ml === 'number' ? ml : Number(String(ml).replace(/[^\d.-]/g, ''));
              if (isNaN(n)) return NaN;
              if (n === 100) return 0.5;                    // EV: exactly 50%
              if (n > 0) return 100 / (n + 100);            // underdog
              return Math.abs(n) / (Math.abs(n) + 100);     // favorite
            };
            const bkAwayMlProb  = mlImpliedProb(game.awayML);
            const mdlAwayMlProb = mlImpliedProb(game.modelAwayML);
            const bkHomeMlProb  = mlImpliedProb(game.homeML);
            const mdlHomeMlProb = mlImpliedProb(game.modelHomeML);
            const ML_EDGE_THRESHOLD = 0.02;
            // Implied-probability fallback (only used when no spread edge exists)
            const awayMlProbEdge = !isNaN(bkAwayMlProb) && !isNaN(mdlAwayMlProb)
              ? (mdlAwayMlProb - bkAwayMlProb) >= ML_EDGE_THRESHOLD
              : false;
            const homeMlProbEdge = !isNaN(bkHomeMlProb) && !isNaN(mdlHomeMlProb)
              ? (mdlHomeMlProb - bkHomeMlProb) >= ML_EDGE_THRESHOLD
              : false;
            // Unified ML edge: spread direction takes priority; prob fallback only when no spread edge
            const awayMlEdgeDetected: boolean = spreadEdgeIsAway !== null
              ? spreadEdgeIsAway === true    // spread edge → away team wins ML too
              : awayMlProbEdge;              // no spread edge → use implied prob
            const homeMlEdgeDetected: boolean = spreadEdgeIsAway !== null
              ? spreadEdgeIsAway === false   // spread edge → home team wins ML too
              : homeMlProbEdge;              // no spread edge → use implied prob
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:MLEdge:UNIFIED] game=${game.id}` +
                ` spreadEdgeIsAway=${spreadEdgeIsAway}` +
                ` | away: bkProb=${bkAwayMlProb?.toFixed(3)} mdlProb=${mdlAwayMlProb?.toFixed(3)} probEdge=${awayMlProbEdge} → finalEdge=${awayMlEdgeDetected}` +
                ` | home: bkProb=${bkHomeMlProb?.toFixed(3)} mdlProb=${mdlHomeMlProb?.toFixed(3)} probEdge=${homeMlProbEdge} → finalEdge=${homeMlEdgeDetected}`,
                'color:#39FF14;font-size:9px'
              );
            }

            // ── Tab state ─────────────────────────────────────────────────────
            // isDualTab: BOOK + MODEL both active simultaneously
            // isBookTab / isModelTab: true when that tab is active OR dual is active
            const isDualTab  = mobileTab === 'dual';
            const isBookTab  = isDualTab; // MODEL PROJECTIONS tab = BOOK+MODEL both active
            const isModelTab = isDualTab;

            // ── Value style factories (reference image spec) ──────────────────
            // The table is ALWAYS visible. Tab controls which column is "primary":
            //
            // BOOK tab active:
            //   book  = white bold full opacity (primary)
            //   model = #39FF14 bold if edge, else white 40% opacity (secondary, always visible)
            //
            // MODEL tab active (default / reference image):
            //   book  = gray 50% opacity, unbolded (reference, always visible)
            //   model = #39FF14 bold if edge, else white bold full opacity (primary)
            //
            // Neither tab (SPLITS/EDGE):
            //   book  = gray 35% opacity, unbolded
            //   model = #39FF14 if edge, else white 40% opacity, unbolded
            //
            // LOG: [GameCard:OddsStyle] logs active tab + edge flags in dev
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:OddsStyle] game=${game.id} tab=${mobileTab} spreadEdge=${spreadEdgeIsAway} totalEdge=${totalEdgeIsOver}`,
                'color:#aaa;font-size:9px'
              );
            }

            // ── Value style factories (matches both reference images exactly) ──
            //
            // BOOK LINES tab active (ref image 1):
            //   book  = white BOLD full opacity     (primary)
            //   model = white unbolded 70% opacity  (secondary, visible)
            //   model edge = #39FF14 BOLD            (edge highlight always wins)
            //
            // MODEL LINES tab active (ref image 2):
            //   book  = white unbolded 70% opacity  (secondary, visible for reference)
            //   model non-edge = light gray BOLD     (primary, not edge)
            //   model edge = #39FF14 BOLD            (edge highlight always wins)
            //
            // SPLITS / EDGE tabs:
            //   both dimmed for context
            //
            // LOG: [GameCard:OddsStyle] logs tab + edge state in dev
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:OddsStyle] game=${game.id} tab=${mobileTab} spreadEdge=${spreadEdgeIsAway} totalEdge=${totalEdgeIsOver}`,
                'color:#aaa;font-size:9px'
              );
            }

            const bookStyle = (_isEdge?: boolean): React.CSSProperties => ({
              // unbolded book values: 10.5px; bolded book values: 10.25px (bold appears optically larger)
              fontSize: isDualTab ? '10.5px' : isBookTab ? '10.25px' : '10.5px',
              // DUAL mode: book = light gray unbolded (secondary to model primary)
              // BOOK-only: book = white bold (primary)
              // MODEL-only: book = white unbolded 70% (secondary, visible for reference)
              // SPLITS/EDGE: dimmed
              fontWeight: isDualTab ? 400 : isBookTab ? 700 : 400,
              color: isDualTab
                ? 'rgba(200,200,200,0.65)'          // DUAL: light gray unbolded
                : isBookTab
                  ? 'rgba(255,255,255,1)'           // BOOK-only: white bold (primary)
                  : isModelTab
                    ? 'rgba(255,255,255,0.70)'      // MODEL-only: white unbolded (secondary)
                    : 'rgba(255,255,255,0.30)',      // SPLITS/EDGE: dimmed
              letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
            });

            const modelStyle = (isEdge?: boolean): React.CSSProperties => {
              // ── MODEL value color/weight rules ────────────────────────────────
              // BOOK tab active:
              //   model (any)  = white unbolded 70% — secondary, visible but NOT primary
              //   edge does NOT trigger neon green when BOOK tab is active
              //
              // MODEL tab active:
              //   model edge   = #39FF14 BOLD — edge highlight (primary)
              //   model no-edge = white BOLD — primary non-edge (user request: white not gray)
              //
              // SPLITS/EDGE tabs:
              //   model (any)  = dimmed 30%
              //
              // LOG: [GameCard:modelStyle] isEdge + tab in dev
              if (process.env.NODE_ENV === 'development' && isEdge) {
                console.log(
                  `%c[GameCard:modelStyle] edge=true tab=${mobileTab} → ${isModelTab ? '#39FF14 bold' : 'white 70% unbolded'}`,
                  'color:#aaa;font-size:9px'
                );
              }
              if (isDualTab) {
                // DUAL mode: model is primary — edge = neon green bold, non-edge = white bold
                return {
                  fontSize: '10.25px',  // bolded model values: 10.25px
                  fontWeight: 700,
                  color: isEdge ? '#39FF14' : 'rgba(255,255,255,1)',
                  letterSpacing: '0.02em',
                  fontVariantNumeric: 'tabular-nums',
                };
              }
              if (isBookTab) {
                // BOOK-only tab: model is always secondary — white unbolded, no edge highlight
                return {
                  fontSize: '10.5px',  // unbolded model values: 10.5px
                  fontWeight: 400,
                  color: 'rgba(255,255,255,0.70)',
                  letterSpacing: '0.02em',
                  fontVariantNumeric: 'tabular-nums',
                };
              }
              if (isModelTab) {
                // MODEL-only tab: edge = neon green bold; non-edge = white bold
                return {
                  fontSize: '10.25px',  // bolded model values: 10.25px
                  fontWeight: 700,
                  color: isEdge ? '#39FF14' : 'rgba(255,255,255,1)',
                  letterSpacing: '0.02em',
                  fontVariantNumeric: 'tabular-nums',
                };
              }
              // SPLITS/EDGE tabs: dimmed
              return {
                fontSize: '10.5px',  // unbolded dimmed values: 10.5px
                fontWeight: 400,
                color: 'rgba(255,255,255,0.30)',
                letterSpacing: '0.02em',
                fontVariantNumeric: 'tabular-nums',
              };
            };

            // Per-cell edge detection
            const awaySpreadIsEdge  = spreadEdgeIsAway === true;
            const homeSpreadIsEdge  = spreadEdgeIsAway === false;
            const overTotalIsEdge   = totalEdgeIsOver  === true;
            const underTotalIsEdge  = totalEdgeIsOver  === false;
            // ML edge: unified with spread direction (awayMlEdgeDetected / homeMlEdgeDetected
            // are already computed above using spread-first logic with prob fallback)
            const awayMlIsEdge      = awayMlEdgeDetected;
            const homeMlIsEdge      = homeMlEdgeDetected;

            // ── Spec-compliant edge pp calculations (juice-only math, per market) ────────
            // RULE: Edge lives in the juice, not the line.
            // Each market is independent — never averaged, never combined.
            // Recalculate on every render (derived state, not stored state).
            // AWAY spread edge: book juice vs model juice
            // NHL uses puck-line odds (modelAwayPLOdds); MLB/NCAAM use run-line/spread odds (modelAwaySpreadOdds)
            const awaySpreadEdgePP: number = (() => {
              const bkOdds  = toNum(game.awaySpreadOdds);
              const mdlOdds = isNhlGame
                ? toNum(game.modelAwayPLOdds)
                : toNum((game as unknown as Record<string, string | null>).modelAwaySpreadOdds ?? null);
              if (process.env.NODE_ENV === 'development') {
                console.log(`%c[GameCard:SpreadEdgePP:AWAY] game=${game.id} sport=${game.sport} bkOdds=${bkOdds} mdlOdds=${mdlOdds} isNhlGame=${isNhlGame}`, 'color:#FF9900;font-size:9px');
              }
              return calculateEdge(bkOdds, mdlOdds);
            })();
            // HOME spread edge
            // NHL uses puck-line odds (modelHomePLOdds); MLB/NCAAM use run-line/spread odds (modelHomeSpreadOdds)
            const homeSpreadEdgePP: number = (() => {
              const bkOdds  = toNum(game.homeSpreadOdds);
              const mdlOdds = isNhlGame
                ? toNum(game.modelHomePLOdds)
                : toNum((game as unknown as Record<string, string | null>).modelHomeSpreadOdds ?? null);
              if (process.env.NODE_ENV === 'development') {
                console.log(`%c[GameCard:SpreadEdgePP:HOME] game=${game.id} sport=${game.sport} bkOdds=${bkOdds} mdlOdds=${mdlOdds} isNhlGame=${isNhlGame}`, 'color:#FF9900;font-size:9px');
              }
              return calculateEdge(bkOdds, mdlOdds);
            })();
            // OVER total edge
            const overEdgePP: number = (() => {
              const bkOdds  = toNum(game.overOdds);
              const mdlOdds = toNum(game.modelOverOdds);
              return calculateEdge(bkOdds, mdlOdds);
            })();
            // UNDER total edge
            const underEdgePP: number = (() => {
              const bkOdds  = toNum(game.underOdds);
              const mdlOdds = toNum(game.modelUnderOdds);
              return calculateEdge(bkOdds, mdlOdds);
            })();
            // AWAY ML edge
            const awayMlEdgePP: number = (() => {
              const bkOdds  = toNum(game.awayML);
              const mdlOdds = toNum(game.modelAwayML);
              return calculateEdge(bkOdds, mdlOdds);
            })();
            // HOME ML edge
            const homeMlEdgePP: number = (() => {
              const bkOdds  = toNum(game.homeML);
              const mdlOdds = toNum(game.modelHomeML);
              return calculateEdge(bkOdds, mdlOdds);
            })();
            // Best spread edge (away or home, whichever is higher)
            const spreadEdgePP: number = (() => {
              const a = isNaN(awaySpreadEdgePP) ? -Infinity : awaySpreadEdgePP;
              const h = isNaN(homeSpreadEdgePP) ? -Infinity : homeSpreadEdgePP;
              const best = Math.max(a, h);
              return best === -Infinity ? NaN : best;
            })();
            // Best total edge (over or under, whichever is higher)
            const totalEdgePP: number = (() => {
              const o = isNaN(overEdgePP) ? -Infinity : overEdgePP;
              const u = isNaN(underEdgePP) ? -Infinity : underEdgePP;
              const best = Math.max(o, u);
              return best === -Infinity ? NaN : best;
            })();
            // Best ML edge (away or home, whichever is higher)
            const mlEdgePP: number = (() => {
              const a = isNaN(awayMlEdgePP) ? -Infinity : awayMlEdgePP;
              const h = isNaN(homeMlEdgePP) ? -Infinity : homeMlEdgePP;
              const best = Math.max(a, h);
              return best === -Infinity ? NaN : best;
            })();
            // Best edge across all 3 markets (for EdgeBadge container styling)
            const bestEdgePP: number = (() => {
              const vals = [spreadEdgePP, totalEdgePP, mlEdgePP].filter(v => !isNaN(v));
              return vals.length > 0 ? Math.max(...vals) : NaN;
            })();
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:EdgePP] game=${game.id}` +
                ` spr=${isNaN(spreadEdgePP)?'NaN':spreadEdgePP.toFixed(2)}pp` +
                ` (away=${isNaN(awaySpreadEdgePP)?'NaN':awaySpreadEdgePP.toFixed(2)} home=${isNaN(homeSpreadEdgePP)?'NaN':homeSpreadEdgePP.toFixed(2)})` +
                ` | tot=${isNaN(totalEdgePP)?'NaN':totalEdgePP.toFixed(2)}pp` +
                ` (over=${isNaN(overEdgePP)?'NaN':overEdgePP.toFixed(2)} under=${isNaN(underEdgePP)?'NaN':underEdgePP.toFixed(2)})` +
                ` | ml=${isNaN(mlEdgePP)?'NaN':mlEdgePP.toFixed(2)}pp` +
                ` (away=${isNaN(awayMlEdgePP)?'NaN':awayMlEdgePP.toFixed(2)} home=${isNaN(homeMlEdgePP)?'NaN':homeMlEdgePP.toFixed(2)})` +
                ` | best=${isNaN(bestEdgePP)?'NaN':bestEdgePP.toFixed(2)}pp → ${getVerdict(bestEdgePP)}`,
                'color:#39FF14;font-size:9px'
              );
            }

            // ── Tab bar config ────────────────────────────────────────────────
            // Only 2 tabs: MODEL PROJECTIONS (dual) and BETTING SPLITS (splits)
            const TABS: { id: MobileTab; label: string }[] = [
              { id: 'dual',   label: 'MODEL PROJECTIONS' },
              { id: 'splits', label: 'BETTING SPLITS' },
            ];

            // ── Shared odds table (used by both BOOK and MODEL tabs) ──────────
            // ── Mobile market card helpers ─────────────────────────────────────────
            // Spec: flat 2-column grid inside each card. No circles.
            // BOOK and MODEL side-by-side. Line on top (9px dim), juice below (14px bold).
            // MODEL juice is neon green ONLY when that side has an edge (edgePP >= 1.5).
            // Both white when no edge. All 3 market columns are flex-1 (equal width).
            // ML card has an empty spacer row above the juice to align height with SPREAD/TOTAL.
            const MktCard = ({
              awayBookLine, awayBookJuice,
              awayModelLine, awayModelJuice, awayModelHasEdge,
              homeBookLine, homeBookJuice,
              homeModelLine, homeModelJuice, homeModelHasEdge,
              isML = false,
              roiEdgePP,
              roiLabel,
            }: {
              awayBookLine: string; awayBookJuice: string;
              awayModelLine: string; awayModelJuice: string; awayModelHasEdge: boolean;
              homeBookLine: string; homeBookJuice: string;
              homeModelLine: string; homeModelJuice: string; homeModelHasEdge: boolean;
              isML?: boolean;
              roiEdgePP?: number;   // best edge pp for this market (used for ROI footer)
              roiLabel?: string;    // label for the best edge side, e.g. "CGY +1.5", "U5.5"
            }) => {
              // SubCol: line row (dim 9px) + juice row (bold 14px)
              // modelJuiceColor: neon green only when this side has an edge, otherwise white
              const SubCol = ({ line, juice, isBook, hasEdge }: { line: string; juice: string; isBook: boolean; hasEdge: boolean }) => {
                const juiceColor = isBook
                  ? 'rgba(255,255,255,0.90)'                      // BOOK: always white
                  : hasEdge ? '#39FF14' : 'rgba(255,255,255,0.90)'; // MODEL: neon if edge, white if not
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: 0, flex: 1 }}>
                    {/* Spacer/line row: always rendered to keep height consistent */}
                    {isML
                      ? <span style={{ fontSize: '9px', lineHeight: 1, visibility: 'hidden' }}>&nbsp;</span>  // empty spacer for ML
                      : <span style={{ fontSize: '9px', fontWeight: 400, color: 'rgba(255,255,255,0.55)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{line}</span>
                    }
                    <span style={{ fontSize: '14px', fontWeight: 700, color: juiceColor, lineHeight: 1.15, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{juice}</span>
                  </div>
                );
              };

              const TeamRow = ({ bookLine, bookJuice, modelLine, modelJuice, modelHasEdge }: { bookLine: string; bookJuice: string; modelLine: string; modelJuice: string; modelHasEdge: boolean }) => (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', padding: '4px 3px' }}>
                  <SubCol line={bookLine} juice={bookJuice} isBook={true} hasEdge={false} />
                  <SubCol line={modelLine} juice={modelJuice} isBook={false} hasEdge={modelHasEdge} />
                </div>
              );

              return (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  background: '#2a2a2e', borderRadius: '10px',
                  overflow: 'hidden', flex: '1 1 0', minWidth: 0,
                }}>
                  {/* BOOK / MODEL header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '3px 4px 2px' }}>
                    <span style={{ fontSize: '6.5px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BOOK</span>
                    <span style={{ fontSize: '6.5px', fontWeight: 700, color: 'rgba(255,255,255,0.70)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODEL</span>
                  </div>
                  {/* Away row */}
                  <TeamRow bookLine={awayBookLine} bookJuice={awayBookJuice} modelLine={awayModelLine} modelJuice={awayModelJuice} modelHasEdge={awayModelHasEdge} />
                  {/* Divider */}
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
                  {/* Home row */}
                  <TeamRow bookLine={homeBookLine} bookJuice={homeBookJuice} modelLine={homeModelLine} modelJuice={homeModelJuice} modelHasEdge={homeModelHasEdge} />
                  {/* ROI footer — edge side label + ROI% in neon green, or NO EDGE in gray */}
                  {(() => {
                    const pp = roiEdgePP ?? NaN;
                    const hasEdge = !isNaN(pp) && pp >= 1.5;
                    const roiStr = hasEdge ? `+${pp.toFixed(2)}% ROI` : 'NO EDGE';
                    const roiColor = hasEdge ? getEdgeColor(pp) : 'rgba(200,200,200,0.45)';
                    const label = hasEdge && roiLabel ? roiLabel : '';
                    return (
                      <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.07)',
                        padding: '3px 4px 3px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1px',
                        background: hasEdge ? 'rgba(57,255,20,0.04)' : 'transparent',
                      }}>
                        {label ? (
                          <span style={{ fontSize: '7px', fontWeight: 700, color: roiColor, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{label}</span>
                        ) : null}
                        <span style={{ fontSize: '7.5px', fontWeight: hasEdge ? 800 : 400, color: roiColor, letterSpacing: '0.03em', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>{roiStr}</span>
                      </div>
                    );
                  })()}
                </div>
              );
            };

            const OddsTable = () => (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', width: '100%', padding: '4px 6px 4px', gap: '4px' }}>
                {/* Market cards row: SPREAD | TOTAL | ML — all flex-1 equal width, ROI footer inside each card */}
                {/* SPREAD card — edge flags drive MODEL juice color; ROI footer shows best-side edge */}
                {(() => {
                  // Spread: best edge side label (e.g. "CGY +1.5" or "EDM -1.5")
                  const spreadRoiPP = isNaN(awaySpreadEdgePP) && isNaN(homeSpreadEdgePP)
                    ? NaN
                    : (!isNaN(awaySpreadEdgePP) && (isNaN(homeSpreadEdgePP) || awaySpreadEdgePP >= homeSpreadEdgePP))
                      ? awaySpreadEdgePP
                      : homeSpreadEdgePP;
                  const spreadRoiLabel = (() => {
                    const isAway = !isNaN(awaySpreadEdgePP) && (isNaN(homeSpreadEdgePP) || awaySpreadEdgePP >= homeSpreadEdgePP);
                    const abbr = isAway ? awayAbbr : homeAbbr;
                    const line = isAway
                      ? (!isNaN(awayBookSpread) ? spreadSign(awayBookSpread) : '')
                      : (!isNaN(homeBookSpread) ? spreadSign(homeBookSpread) : '');
                    return line ? `${abbr} ${line}` : abbr;
                  })();
                  return (
                    <MktCard
                      awayBookLine={!isNaN(awayBookSpread) ? spreadSign(awayBookSpread) : '—'}
                      awayBookJuice={mbAwaySpreadOdds ? String(mbAwaySpreadOdds) : '—110'}
                      awayModelLine={mdlAwaySplit.line || '—'}
                      awayModelJuice={mdlAwaySplit.odds || '—'}
                      awayModelHasEdge={!isNaN(awaySpreadEdgePP) && awaySpreadEdgePP >= 1.5}
                      homeBookLine={!isNaN(homeBookSpread) ? spreadSign(homeBookSpread) : '—'}
                      homeBookJuice={mbHomeSpreadOdds ? String(mbHomeSpreadOdds) : '—110'}
                      homeModelLine={mdlHomeSplit.line || '—'}
                      homeModelJuice={mdlHomeSplit.odds || '—'}
                      homeModelHasEdge={!isNaN(homeSpreadEdgePP) && homeSpreadEdgePP >= 1.5}
                      roiEdgePP={spreadRoiPP}
                      roiLabel={spreadRoiLabel}
                    />
                  );
                })()}
                {/* TOTAL card */}
                {(() => {
                  // Total: best edge side label (e.g. "O5.5" or "U5.5")
                  const totalRoiPP = isNaN(overEdgePP) && isNaN(underEdgePP)
                    ? NaN
                    : (!isNaN(overEdgePP) && (isNaN(underEdgePP) || overEdgePP >= underEdgePP))
                      ? overEdgePP
                      : underEdgePP;
                  const totalRoiLabel = (() => {
                    const isOver = !isNaN(overEdgePP) && (isNaN(underEdgePP) || overEdgePP >= underEdgePP);
                    const prefix = isOver ? 'O' : 'U';
                    return !isNaN(bookTotal) ? `${prefix}${bkTotalStr}` : prefix;
                  })();
                  return (
                    <MktCard
                      awayBookLine={!isNaN(bookTotal) ? `o${bkTotalStr}` : 'o—'}
                      awayBookJuice={mbOverOdds ? String(mbOverOdds) : '—110'}
                      awayModelLine={`o${mdlOverSplit.line || '—'}`}
                      awayModelJuice={mdlOverSplit.odds || '—'}
                      awayModelHasEdge={!isNaN(overEdgePP) && overEdgePP >= 1.5}
                      homeBookLine={!isNaN(bookTotal) ? `u${bkTotalStr}` : 'u—'}
                      homeBookJuice={mbUnderOdds ? String(mbUnderOdds) : '—110'}
                      homeModelLine={`u${mdlUnderSplit.line || '—'}`}
                      homeModelJuice={mdlUnderSplit.odds || '—'}
                      homeModelHasEdge={!isNaN(underEdgePP) && underEdgePP >= 1.5}
                      roiEdgePP={totalRoiPP}
                      roiLabel={totalRoiLabel}
                    />
                  );
                })()}
                {/* ML card — juice IS the value; empty spacer row keeps height aligned */}
                {(() => {
                  // ML: best edge side label (e.g. "CGY ML" or "EDM ML")
                  const mlRoiPP = isNaN(awayMlEdgePP) && isNaN(homeMlEdgePP)
                    ? NaN
                    : (!isNaN(awayMlEdgePP) && (isNaN(homeMlEdgePP) || awayMlEdgePP >= homeMlEdgePP))
                      ? awayMlEdgePP
                      : homeMlEdgePP;
                  const mlRoiLabel = (() => {
                    const isAway = !isNaN(awayMlEdgePP) && (isNaN(homeMlEdgePP) || awayMlEdgePP >= homeMlEdgePP);
                    return `${isAway ? awayAbbr : homeAbbr} ML`;
                  })();
                  return (
                    <MktCard
                      awayBookLine={''}
                      awayBookJuice={bkAwayMl || '—'}
                      awayModelLine={''}
                      awayModelJuice={mdlAwayMl || '—'}
                      awayModelHasEdge={!isNaN(awayMlEdgePP) && awayMlEdgePP >= 1.5}
                      homeBookLine={''}
                      homeBookJuice={bkHomeMl || '—'}
                      homeModelLine={''}
                      homeModelJuice={mdlHomeMl || '—'}
                      homeModelHasEdge={!isNaN(homeMlEdgePP) && homeMlEdgePP >= 1.5}
                      isML={true}
                      roiEdgePP={mlRoiPP}
                      roiLabel={mlRoiLabel}
                    />
                  );
                })()}
              </div>
            );

            return (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>

                {/* ── TWO-COLUMN TEAM GRID: frozen left + scrollable right ─────── */}
                {/* Status row (star/LIVE/FINAL/time) is inside the frozen left panel, ABOVE the away team row */}
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', width: '100%', minHeight: 0 }}>

                {/* ── FROZEN LEFT PANEL: status row + team rows ── */}
                <div style={{
                  gridColumn: '1',
                  borderRight: '1px solid hsl(var(--border) / 0.5)',
                  background: 'hsl(var(--card))',
                  zIndex: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'stretch',
                  padding: '0 6px',
                  gap: 0,
                  alignSelf: 'stretch',
                }}>

                  {/* Status row: star + LIVE/FINAL/time — compact at 80px */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: '20px',
                    paddingLeft: '2px',
                    gap: '2px',
                    borderBottom: '1px solid rgba(255,255,255,0.10)',
                  }}>
                    {isAppAuthed && (
                      <button
                        onClick={handleStarClick}
                        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 1px', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', color: isFavorited ? '#FFD700' : 'rgba(255,255,255,0.65)', filter: isFavorited ? 'drop-shadow(0 0 4px #FFD700)' : 'none', transition: 'color 0.15s' }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill={isFavorited ? '#FFD700' : 'none'} stroke={isFavorited ? '#FFD700' : 'rgba(255,255,255,0.85)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}
                    {isLive ? (
                      <span className="flex items-center gap-0.5 font-black tracking-widest uppercase" style={{ color: '#39FF14', fontSize: '9px', whiteSpace: 'nowrap', flexWrap: 'nowrap' }}>
                        <span className="w-1 h-1 rounded-full animate-pulse inline-block" style={{ background: '#39FF14', flexShrink: 0 }} />
                        LIVE
                        {formattedClock && (
                          <span style={{ color: 'rgba(255,255,255,0.90)', fontWeight: 600, fontSize: '9px', letterSpacing: '0.03em', fontVariantNumeric: 'tabular-nums', marginLeft: '2px', whiteSpace: 'nowrap', display: 'inline', lineHeight: 1 }}>{formattedClock}</span>
                        )}
                      </span>
                    ) : isFinal ? (
                      <span className="font-bold tracking-wide" style={{ fontSize: '8px', color: '#39FF14', background: 'rgba(255,255,255,0.12)', borderRadius: '999px', padding: '1px 6px', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>FINAL</span>
                    ) : (
                      <span style={{ fontSize: '9px', fontWeight: 400, color: 'hsl(var(--foreground))', whiteSpace: 'nowrap' }}>{time}</span>
                    )}
                  </div>

                  {/* Away row: logo (28px) + abbr + score on same row */}
                  <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 0', minHeight: '40px', gap: '4px', paddingLeft: '2px', paddingRight: '4px', overflow: 'hidden' }}>
                    {/* Logo: 28px */}
                    <div style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={28} />
                    </div>
                    {/* Abbreviation — fills remaining space, truncates */}
                    <span style={{ flex: '1 1 0', minWidth: 0, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                      {awayAbbr}
                    </span>
                    {/* Score */}
                    {(isLive || isFinal) && hasScores && (
                      <span className="tabular-nums flex-shrink-0 transition-colors duration-300" style={{
                        fontSize: '13px', lineHeight: 1, fontWeight: awayScoreFlash ? 900 : awayWins ? 700 : 600,
                        color: awayScoreFlash ? '#39FF14' : awayWins ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                        textShadow: awayScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
                      }}>{game.awayScore}</span>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: 'hsl(var(--border) / 0.4)' }} />

                  {/* Home row: logo (28px) + abbr + score on same row */}
                  <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 0', minHeight: '40px', gap: '4px', paddingLeft: '2px', paddingRight: '4px', overflow: 'hidden' }}>
                    {/* Logo: 28px */}
                    <div style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={28} />
                    </div>
                    {/* Abbreviation — fills remaining space, truncates */}
                    <span style={{ flex: '1 1 0', minWidth: 0, fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                      {homeAbbr}
                    </span>
                    {/* Score */}
                    {(isLive || isFinal) && hasScores && (
                      <span className="tabular-nums flex-shrink-0 transition-colors duration-300" style={{
                        fontSize: '13px', lineHeight: 1, fontWeight: homeScoreFlash ? 900 : homeWins ? 700 : 600,
                        color: homeScoreFlash ? '#39FF14' : homeWins ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                        textShadow: homeScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
                      }}>{game.homeScore}</span>
                    )}
                  </div>
                </div>

                {/* ── RIGHT PANEL: content only (tab bar moved to full-width header) ── */}
                <div style={{ gridColumn: '2', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

                  {/* ── OddsTable: visible only when MODEL PROJECTIONS (dual) tab is active ── */}
                  {mobileTab === 'dual' && (
                    <OddsTable />
                  )}

                  {/* ── SPLITS tab (additional content below OddsTable) ──────── */}
                  {mobileTab === 'splits' && (
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <BettingSplitsPanel
                        game={game}
                        awayLabel={awayName}
                        homeLabel={homeName}
                        awayNickname={awayNickname}
                        homeNickname={homeNickname}
                      />
                    </div>
                  )}

                </div>
                </div>
              </div>
            );
          })()}
        </div>
      </motion.div>


    </>
  );
}

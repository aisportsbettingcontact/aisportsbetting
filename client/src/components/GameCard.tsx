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
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { BettingSplitsPanel } from "./BettingSplitsPanel";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GameRow = RouterOutput["games"]["list"][number];

// ── Time formatting ───────────────────────────────────────────────────────────
function formatMilitaryTime(time: string): string {
  const upper = time?.toUpperCase() ?? "";
  if (!time || upper === "TBD" || upper === "TBA" || !time.includes(":")) return "TBD";
  const parts = time.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1]?.slice(0, 2) ?? "00";
  if (isNaN(hours)) return "TBD";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} EST`;
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

// ── Edge color scale ──────────────────────────────────────────────────────────
function getEdgeColor(diff: number): string {
  if (diff <= 0)  return "hsl(var(--muted-foreground))";
  if (diff < 1.5) return "#FF3131";
  if (diff < 2.0) return "#FF6B00";
  if (diff < 2.5) return "#FF9500";
  if (diff < 3.0) return "#FFB800";
  if (diff < 3.5) return "#FFD700";
  if (diff < 4.0) return "#FFFF33";
  if (diff < 4.5) return "#AAFF1A";
  return "#39FF14";
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
 * Renders the school name + nickname stacked vertically inside the mobile
 * frozen left panel. Uses UNIFORM font sizes across all teams so every card
 * looks consistent — school names are all the same size, nicknames are all
 * the same size (and always smaller than school names).
 *
 * Font size system (panel width 170px, available for text ~96px with score):
 *   School name: clamp(9px, 2.4vw, 11px) — fits all 395 names incl. longest
 *   Nickname:    clamp(8px, 2.1vw, 10px) — always < school name
 *
 * The longest names after abbreviation are "ST. BONAVENTURE" and
 * "MISS VALLEY ST." (15 chars). At 9px they measure ~87px in 96px available.
 *
 * Debug: [MobileTeamName] logs fire on mount with the resolved font sizes.
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
  // Display name is already abbreviated in the registry — no St.→State transform needed
  const displayName = schoolName;

  // Uniform font sizes — same for every team (+3pt more school name, +1.5pt more nickname)
  const NAME_FONT = 'clamp(14px, 3.7vw, 16px)';
  const NICK_FONT = 'clamp(10.5px, 2.8vw, 12.5px)';

  // Debug log on mount (dev only) — use useEffect directly, not React.useEffect
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[MobileTeamName] "${displayName}" name=${NAME_FONT} nick=${NICK_FONT}`);
    }
  }, [displayName]);

  return (
    <div
      className="flex flex-col min-w-0"
      style={{ lineHeight: 1.25, width: '100%' }}
    >
      <span style={{
        fontSize: '13px',
        fontWeight: 700,
        color: '#ffffff',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        overflow: 'visible',
        display: 'block',
      }} title={displayName}>
        {displayName}
      </span>
      {nickname && (
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: '#ffffff',
            letterSpacing: '0.02em',
            textTransform: 'none',
            whiteSpace: 'nowrap',
            overflow: 'visible',
            display: 'block',
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
    // Compact inline version: logo + name + edge pts all on one line
    const showArrow = (diff ?? 0) >= 3;
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5">
        {(logoUrl || teamSlug) && (
          <TeamLogo slug={teamSlug ?? ""} name={teamName ?? ""} logoUrl={logoUrl} size={16} />
        )}
        <span className="font-bold leading-none whitespace-nowrap uppercase tracking-wide text-[11px]" style={{ color: "hsl(var(--foreground))" }}>
          {showArrow && <span className="mr-0.5 text-[9px]" style={{ color }}>▲</span>}
          {normalized}
        </span>
        <span className="text-[10px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
          <span style={{ color, fontWeight: 800 }}>{diff}{diff === 1 ? "PT" : "PTS"}</span>
        </span>
      </div>
    );
  }

  const betNameSize = isStrong ? "17px" : "15px";
  const showArrow = (diff ?? 0) >= 3;

  return (
    <div className="flex flex-col items-center gap-1 py-0.5">
      <div className="flex items-center gap-1.5">
        {(logoUrl || teamSlug) && (
          <TeamLogo slug={teamSlug ?? ""} name={teamName ?? ""} logoUrl={logoUrl} size={22} />
        )}
        <span className="font-bold leading-none whitespace-nowrap uppercase tracking-wide" style={{ fontSize: betNameSize, color: "hsl(var(--foreground))" }}>
          {showArrow && <span className="mr-0.5 text-[10px]" style={{ color }}>▲</span>}
          {normalized}
        </span>
      </div>
      <span className="text-[13px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
        EDGE:{" "}
        <span style={{ color, fontWeight: 800 }}>{diff} {diff === 1 ? "PT" : "PTS"}</span>
      </span>
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
}

function OddsLinesPanel({
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
}: OddsLinesPanelProps) {

  const mdlAwayMl = modelAwayML ?? '—';
  const mdlHomeMl = modelHomeML ?? '—';
  const hasModelData = !isNaN(mdlAwaySpread) || !isNaN(mdlTotal) || mdlAwayMl !== '—';

  // Book values
  const bkAwaySpread  = !isNaN(awaySpread) ? spreadSign(awaySpread) : '—';
  const bkHomeSpread  = !isNaN(homeSpread) ? spreadSign(homeSpread) : '—';
  const bkOverTotal   = !isNaN(bkTotal) ? String(bkTotal) : '—';
  const bkUnderTotal  = !isNaN(bkTotal) ? String(bkTotal) : '—';

  // Model values
  const mdlAwaySpreadStr = hasModelData && !isNaN(mdlAwaySpread) ? spreadSign(mdlAwaySpread) : '—';
  const mdlHomeSpreadStr = hasModelData && !isNaN(mdlHomeSpread) ? spreadSign(mdlHomeSpread) : '—';
  const mdlOverTotal     = hasModelData && !isNaN(mdlTotal) ? String(mdlTotal) : '—';
  const mdlUnderTotal    = hasModelData && !isNaN(mdlTotal) ? String(mdlTotal) : '—';
  const mdlAwayMlStr     = hasModelData ? mdlAwayMl : '—';
  const mdlHomeMlStr     = hasModelData ? mdlHomeMl : '—';

  // Grid: 6 columns when model is ON (Book|Model per group), 3 columns when model is OFF (Book only)
  const GRID = showModel ? 'grid-cols-6' : 'grid-cols-3';

  // Determine which side has the spread edge (away or home)
  const spreadEdgeIsAway = (() => {
    if (isNaN(spreadDiff) || spreadDiff <= 0) return null;
    if (!isNaN(mdlAwaySpread) && !isNaN(awaySpread)) {
      return mdlAwaySpread < awaySpread; // model favors away more than book → away edge
    }
    return null;
  })();
  const totalEdgeIsOver = (() => {
    if (isNaN(totalDiff) || totalDiff <= 0) return null;
    if (!isNaN(mdlTotal) && !isNaN(bkTotal)) {
      return mdlTotal > bkTotal; // model higher than book → over edge
    }
    return null;
  })();

  const hasSpreadEdge = spreadEdgeIsAway !== null;
  const hasTotalEdge  = totalEdgeIsOver !== null;

  // Base cell styles — book values are bolder when model is off (primary data), lighter when model is on (secondary)
  // Font sizes scale with viewport: clamp(min, preferred_vw, max)
  const cellFontSize = 'clamp(11px, 1.2vw, 17px)';
  const bookCell      = { fontSize: cellFontSize, fontWeight: showModel ? 400 : 600, color: '#E8E8E8', letterSpacing: '0.02em' } as React.CSSProperties;
  // Model cells: neon green only when this specific cell is the edge side; otherwise bold white
  const modelGreen    = { fontSize: cellFontSize, fontWeight: 700, color: '#39FF14', letterSpacing: '0.02em' } as React.CSSProperties;
  const modelWhite    = { fontSize: cellFontSize, fontWeight: 700, color: '#E8E8E8', letterSpacing: '0.02em' } as React.CSSProperties;
  const dimCell       = { fontSize: cellFontSize, fontWeight: 700, color: 'rgba(57,255,20,0.28)', letterSpacing: '0.02em' } as React.CSSProperties;

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
    <div className="flex flex-col pl-2 pr-0 pt-0 pb-0 min-w-0">
      {/* Top-level column group headers: SPREAD | TOTAL | MONEYLINE */}
      <div
        className={`grid ${GRID} pb-0.5`}
        style={{ transition: 'grid-template-columns 200ms ease' }}
      >
        <span className={`${showModel ? 'col-span-2' : ''} text-center font-extrabold uppercase tracking-widest`} style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: '#E8E8E8' }}>Spread</span>
        <span className={`${showModel ? 'col-span-2' : ''} text-center font-extrabold uppercase tracking-widest`} style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: '#E8E8E8' }}>Total</span>
        <span className={`${showModel ? 'col-span-2' : ''} text-center font-extrabold uppercase tracking-widest`} style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: '#E8E8E8' }}>Moneyline</span>
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

      {/* Away row */}
      <div className={`grid ${GRID} py-2`} style={{ transition: 'grid-template-columns 200ms ease' }}>
        <Cell val={bkAwaySpread} style={bookCell} />
        {showModel && <Cell val={mdlAwaySpreadStr} style={awaySpreadModelStyle} />}
        <Cell val={`o${bkOverTotal}`} style={bookCell} />
        {showModel && <Cell val={`o${mdlOverTotal}`} style={overTotalModelStyle} />}
        <Cell val={awayMl || '—'} style={bookCell} />
        {showModel && <Cell val={mdlAwayMlStr} style={awayMlModelStyle} />}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

      {/* Home row */}
      <div className={`grid ${GRID} py-2`} style={{ transition: 'grid-template-columns 200ms ease' }}>
        <Cell val={bkHomeSpread} style={bookCell} />
        {showModel && <Cell val={mdlHomeSpreadStr} style={homeSpreadModelStyle} />}
        <Cell val={`u${bkUnderTotal}`} style={bookCell} />
        {showModel && <Cell val={`u${mdlUnderTotal}`} style={underTotalModelStyle} />}
        <Cell val={homeMl || '—'} style={bookCell} />
        {showModel && <Cell val={mdlHomeMlStr} style={homeMlModelStyle} />}
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
}

export function GameCard({ game, mode = "full", showModel: showModelProp, onToggleModel: onToggleModelProp, favoriteGameIds, onToggleFavorite, onFavoriteNotify, isAppAuthed: isAppAuthedProp }: GameCardProps) {
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
  const awayModelSpread = toNum(game.awayModelSpread);
  const homeModelSpread = toNum(game.homeModelSpread);
  const bookTotal = toNum(game.bookTotal);
  const modelTotal = toNum(game.modelTotal);

  const spreadDiff = (!isNaN(awayModelSpread) && !isNaN(awayBookSpread))
    ? Math.abs(awayModelSpread - awayBookSpread)
    : toNum(game.spreadDiff);
  const totalDiff = (!isNaN(modelTotal) && !isNaN(bookTotal))
    ? Math.abs(modelTotal - bookTotal)
    : toNum(game.totalDiff);

  // Resolve team info from NCAA or NBA registry
  const awayNcaa = getTeamByDbSlug(game.awayTeam);
  const homeNcaa = getTeamByDbSlug(game.homeTeam);
  const awayNba  = !awayNcaa ? getNbaTeamByDbSlug(game.awayTeam) : null;
  const homeNba  = !homeNcaa ? getNbaTeamByDbSlug(game.homeTeam) : null;
  const awayName = awayNcaa?.ncaaName ?? awayNba?.city ?? game.awayTeam.replace(/_/g, " ");
  const homeName = homeNcaa?.ncaaName ?? homeNba?.city ?? game.homeTeam.replace(/_/g, " ");
  const awayNickname = awayNcaa?.ncaaNickname ?? awayNba?.nickname ?? "";
  const homeNickname = homeNcaa?.ncaaNickname ?? homeNba?.nickname ?? "";
  const awayLogoUrl = awayNcaa?.logoUrl ?? awayNba?.logoUrl;
  const homeLogoUrl = homeNcaa?.logoUrl ?? homeNba?.logoUrl;

  const time = formatMilitaryTime(game.startTimeEst);
  const displayDate = (() => {
    if (game.startTimeEst === "00:00") {
      const d = new Date(game.gameDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return game.gameDate;
  })();
  const dateLabel = formatDate(displayDate);

  // Score state
  const isLive = game.gameStatus === 'live';
  const isFinal = game.gameStatus === 'final';
  const isUpcoming = !isLive && !isFinal;
  const hasScores = (game.awayScore !== null && game.awayScore !== undefined) &&
                    (game.homeScore !== null && game.homeScore !== undefined);
  const awayWins = isFinal && hasScores && (game.awayScore! > game.homeScore!);
  const homeWins = isFinal && hasScores && (game.homeScore! > game.awayScore!);

  // Model toggle state (lifted from OddsLinesPanel)
  const [showModelInternal, setShowModelInternal] = useState(true);
  const showModel = showModelProp !== undefined ? showModelProp : showModelInternal;
  const toggleModel = onToggleModelProp ?? (() => setShowModelInternal((v) => !v));

  // Mobile tab state — controls which section is active on mobile full mode
  // Tabs: 'book' | 'model' | 'splits' | 'edge' | 'dual' (BOOK+MODEL both selected)
  // DEFAULT: 'dual' — BOOK + MODEL both active on every card mount and sport switch
  // Persisted in localStorage so the user's preference survives page reloads and sport switches.
  // Rules:
  //   1. At least one tab must always be active (cannot deselect last active tab)
  //   2. SPLITS and EDGE are exclusive single-select (cannot combine with BOOK/MODEL)
  //   3. BOOK + MODEL can be active simultaneously (dual mode)
  type MobileTab = 'book' | 'model' | 'splits' | 'edge' | 'dual';
  const MOBILE_TAB_KEY = 'prez_bets_mobile_tab';
  const getPersistedTab = (): MobileTab => {
    try {
      const stored = localStorage.getItem(MOBILE_TAB_KEY);
      if (stored === 'book' || stored === 'model' || stored === 'splits' || stored === 'edge' || stored === 'dual') {
        return stored;
      }
    } catch { /* localStorage unavailable (private browsing, etc.) */ }
    return 'dual'; // fallback default for new users
  };
  const [mobileTab, setMobileTab] = useState<MobileTab>(getPersistedTab);

  // Persist tab preference whenever it changes
  useEffect(() => {
    try { localStorage.setItem(MOBILE_TAB_KEY, mobileTab); } catch { /* ignore */ }
  }, [mobileTab]);

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

  const maxDiff = Math.max(isNaN(spreadDiff) ? 0 : spreadDiff, isNaN(totalDiff) ? 0 : totalDiff);
  const borderColor = getEdgeColor(maxDiff);

  const awayDisplayName = awayNickname || awayName;
  const homeDisplayName = homeNickname || homeName;

  const computedSpreadEdge: string | null = (() => {
    if (isNaN(spreadDiff) || spreadDiff <= 0) return "PASS";
    if (isNaN(awayModelSpread) || isNaN(awayBookSpread)) return game.spreadEdge;
    if (awayModelSpread < awayBookSpread) {
      return `${awayDisplayName} ${spreadSign(awayBookSpread)}`;
    } else {
      return `${homeDisplayName} ${spreadSign(homeBookSpread)}`;
    }
  })();

  const computedTotalEdge: string | null = (() => {
    if (isNaN(totalDiff) || totalDiff <= 0) return "PASS";
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

  // Mobile abbreviations: 3-4 char uppercase label for frozen score panel
  // Derived from nickname (first word, max 4 chars) — no DB migration needed
  const makeAbbr = (nickname: string, name: string): string => {
    const src = nickname || name;
    // Use first word of nickname/name, uppercase, max 4 chars
    const word = src.split(/\s+/)[0] ?? src;
    return word.slice(0, 4).toUpperCase();
  };
  const awayAbbr = makeAbbr(awayNickname, awayName);
  const homeAbbr = makeAbbr(homeNickname, homeName);

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
          <span className="tabular-nums font-black flex-shrink-0" style={{ fontSize: 20, lineHeight: 1, color: awayWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
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
          <span className="tabular-nums font-black flex-shrink-0" style={{ fontSize: 20, lineHeight: 1, color: homeWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
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
    // Auto-scaling font hooks — measure container width, shrink font until name fits
    // maxFont=15px, minFont=8px, step=0.5px; Canvas measureText (no DOM reflow)
    const awayFontWeight = awayWins ? 700 : 600;
    const homeFontWeight = homeWins ? 700 : 600;
    const [awayNameRef, awayNameFontSize] = useAutoFontSize(
      awayName, awayFontWeight, 15, 8, `away:${game.awayTeam}`
    );
    const [homeNameRef, homeNameFontSize] = useAutoFontSize(
      homeName, homeFontWeight, 15, 8, `home:${game.homeTeam}`
    );
    return (
    <div className="flex flex-col pl-2 pr-2 pt-0 pb-0 min-w-0" style={{ minWidth: 0 }}>
      {/* Status row: [star] [clock/status] [LIVE badge] */}
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
              padding: "3px 4px",
              lineHeight: 1,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isFavorited ? "#FFD700" : "rgba(255,255,255,0.65)",
              opacity: 1,
              transition: "color 0.15s, transform 0.15s, filter 0.15s",
              filter: isFavorited ? "drop-shadow(0 0 4px #FFD700)" : "none",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.25)"; if (!isFavorited) e.currentTarget.style.color = "rgba(255,255,255,0.95)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; if (!isFavorited) e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24"
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
          <>
            {game.gameClock && (
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>
                {game.gameClock}
              </span>
            )}
            {/* LIVE indicator — neon green, right of period/clock */}
            <span
              className="flex items-center gap-0.5 text-[9px] font-black tracking-widest uppercase flex-shrink-0"
              style={{ color: "#39FF14", letterSpacing: "0.1em" }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#39FF14" }} />
              LIVE
            </span>
          </>
        ) : isFinal ? (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide"
            style={{ background: "rgba(255,255,255,0.07)", color: "hsl(var(--muted-foreground))" }}
          >
            FINAL
          </span>
        ) : (
          <span className="text-[13px] font-bold" style={{ color: "hsl(var(--foreground))" }}>
            {time}
          </span>
        )}
      </div>

      {/* Away team row — py-2 mirrors OddsLinesPanel away row height */}
      <div className="flex items-center justify-between gap-2 py-2 w-full">
        {/* Left: logo + name/nickname — always two lines for both NCAAM and NBA */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
          <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={36} />
          {/* awayNameRef: ResizeObserver measures this div's width to auto-scale font */}
          <div ref={awayNameRef} className="flex flex-col min-w-0" style={{ overflow: 'hidden' }}>
            <span
              className="font-semibold leading-tight"
              style={{
                fontSize: awayNameFontSize,
                color: awayWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: awayFontWeight,
                whiteSpace: 'nowrap',
                lineHeight: 1.15,
              }}
            >
              {awayName}
            </span>
            {/* Always show nickname/team-name on line 2 — NCAAM: nickname, NBA: team name */}
            <span className="leading-none" style={{ fontSize: "clamp(9px, 2.2vw, 11px)", color: "hsl(var(--muted-foreground))", wordBreak: "break-word", overflowWrap: "anywhere" }}>
              {awayNickname || "\u00A0"}
            </span>
          </div>
        </div>
        {/* Right: score pushed to far right */}
        {(isLive || isFinal) && hasScores && (
          <span
            className="tabular-nums font-black flex-shrink-0 transition-colors duration-300"
            style={{
              /* NBA scores are 3 digits (100-130) — use smaller clamp to prevent overflow in 160px panel */
              fontSize: isNba ? "clamp(18px, 2vw, 38px)" : "clamp(22px, 2.5vw, 44px)",
              lineHeight: 1,
              color: awayScoreFlash
                ? "#39FF14"
                : awayWins
                ? "hsl(var(--foreground))"
                : isFinal
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

      {/* Home team row — py-2 mirrors OddsLinesPanel home row height */}
      <div className="flex items-center justify-between gap-2 py-2 w-full">
        {/* Left: logo + name/nickname — always two lines for both NCAAM and NBA */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
          <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={36} />
          {/* homeNameRef: ResizeObserver measures this div's width to auto-scale font */}
          <div ref={homeNameRef} className="flex flex-col min-w-0" style={{ overflow: 'hidden' }}>
            <span
              className="font-semibold leading-tight"
              style={{
                fontSize: homeNameFontSize,
                color: homeWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: homeFontWeight,
                whiteSpace: 'nowrap',
                lineHeight: 1.15,
              }}
            >
              {homeName}
            </span>
            {/* Always show nickname/team-name on line 2 — NCAAM: nickname, NBA: team name */}
            <span className="leading-none" style={{ fontSize: "clamp(9px, 2.2vw, 11px)", color: "hsl(var(--muted-foreground))", wordBreak: "break-word", overflowWrap: "anywhere" }}>
              {homeNickname || "\u00A0"}
            </span>
          </div>
        </div>
        {/* Right: score pushed to far right */}
        {(isLive || isFinal) && hasScores && (
          <span
            className="tabular-nums font-black flex-shrink-0 transition-colors duration-300"
            style={{
              fontSize: isNba ? "clamp(18px, 2vw, 38px)" : "clamp(22px, 2.5vw, 44px)",
              lineHeight: 1,
              color: homeScoreFlash
                ? "#39FF14"
                : homeWins
                ? "hsl(var(--foreground))"
                : isFinal
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--foreground))",
              textShadow: homeScoreFlash ? "0 0 12px rgba(57,255,20,0.7)" : "none",
            }}
          >
            {game.homeScore}
          </span>
        )}
      </div>
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
        <div className="hidden lg:flex items-stretch w-full">
          {/* Col 1: Score panel — always shown */}
          <div
            style={{
              flex: mode === "splits" ? "1 1 30%" : "0 0 220px",
              minWidth: 220,
              maxWidth: mode === "splits" ? undefined : 260,
              borderRight: "1px solid hsl(var(--border) / 0.5)",
            }}
          >
            <ScorePanel />
          </div>

          {/* Col 2: Odds/Lines — hidden in splits mode */}
          {mode !== "splits" && (
            <div
              className="flex flex-col justify-center"
            style={{
              flex: mode === "projections" ? "2 1 38%" : "1.5 1 28%",
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
              />
            </div>
          )}

          {/* Col 3: Betting Splits (always shown when not splits-only mode) */}
          {mode !== "splits" && (
            <div className="flex flex-col" style={{ flex: "2 1 40%", minWidth: 220, borderLeft: "1px solid hsl(var(--border) / 0.5)" }}>
              {/* Edge verdict row — only in projections mode when model is on */}
              {mode === "projections" && showModel && (
                <div
                  className="flex items-center justify-center px-2 py-1"
                  style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
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
                  />
                </div>
              )}
              {/* Betting splits panel */}
              <div className="flex-1 px-3 py-2">
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
                  {/* minWidth = calc(100vw - 160px): exactly fills scroll container so when scrolled fully right, 0px bleeds through */}
                  <div style={{ minWidth: "calc(100vw - 160px)" }} className="flex flex-col justify-center">
                    <OddsLinesPanel
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
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", width: "100%" }}>
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
              // Period labels (hockey) → 1P/2P/3P
              if (/^1(st)?\s+period$/i.test(s)) return '1P';
              if (/^2(nd)?\s+period$/i.test(s)) return '2P';
              if (/^3(rd)?\s+period$/i.test(s)) return '3P';
              if (/^ot$/i.test(s)) return 'OT';
              // MM:SS clock — pass through as-is
              if (/^\d{1,2}:\d{2}$/.test(s)) return s;
              // Compound: "09:36 1ST HALF" or "Q3 4:15" — normalize period label then keep clock
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

            // ── Derived values for mobile odds table ─────────────────────────
            const bkAwaySpreadStr  = !isNaN(awayBookSpread) ? spreadSign(awayBookSpread) : '—';
            const bkHomeSpreadStr  = !isNaN(homeBookSpread) ? spreadSign(homeBookSpread) : '—';
            const bkTotalStr       = !isNaN(bookTotal) ? String(bookTotal) : '—';
            const mdlAwaySpreadStr = !isNaN(awayModelSpread) ? spreadSign(awayModelSpread) : '—';
            const mdlHomeSpreadStr = !isNaN(homeModelSpread) ? spreadSign(homeModelSpread) : '—';
            const mdlTotalStr      = !isNaN(modelTotal) ? String(modelTotal) : '—';
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
              if (!isNaN(awayModelSpread) && !isNaN(awayBookSpread)) return awayModelSpread < awayBookSpread;
              return null;
            })();
            const totalEdgeIsOver = (() => {
              if (isNaN(totalDiff) || totalDiff <= 0) return null;
              if (!isNaN(modelTotal) && !isNaN(bookTotal)) return modelTotal > bookTotal;
              return null;
            })();

            // ── ML edge detection via implied probability ───────────────────────────
            // Implied probability: p = 100 / (|ML| + 100) for positive ML (underdog)
            //                      p = |ML| / (|ML| + 100) for negative ML (favorite)
            // +100 (EV) → implied prob = 0.50 exactly
            // Edge exists when model implied prob > book implied prob for the same team
            // (i.e., model thinks team is more likely to win than book does)
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
            // ML edge: model implies higher win probability than book (threshold: 2% difference)
            const ML_EDGE_THRESHOLD = 0.02;
            const awayMlEdgeDetected = !isNaN(bkAwayMlProb) && !isNaN(mdlAwayMlProb)
              ? (mdlAwayMlProb - bkAwayMlProb) >= ML_EDGE_THRESHOLD
              : false;
            const homeMlEdgeDetected = !isNaN(bkHomeMlProb) && !isNaN(mdlHomeMlProb)
              ? (mdlHomeMlProb - bkHomeMlProb) >= ML_EDGE_THRESHOLD
              : false;
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `%c[GameCard:MLEdge] game=${game.id} away: bkProb=${bkAwayMlProb?.toFixed(3)} mdlProb=${mdlAwayMlProb?.toFixed(3)} edge=${awayMlEdgeDetected} | home: bkProb=${bkHomeMlProb?.toFixed(3)} mdlProb=${mdlHomeMlProb?.toFixed(3)} edge=${homeMlEdgeDetected}`,
                'color:#39FF14;font-size:9px'
              );
            };

            // ── Tab state ─────────────────────────────────────────────────────
            // isDualTab: BOOK + MODEL both active simultaneously
            // isBookTab / isModelTab: true when that tab is active OR dual is active
            const isDualTab  = mobileTab === 'dual';
            const isBookTab  = mobileTab === 'book'  || isDualTab;
            const isModelTab = mobileTab === 'model' || isDualTab;

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
              // unbolded book values: 10px; bolded book values: 9.75px (bold appears optically larger)
              fontSize: isDualTab ? '10px' : isBookTab ? '9.75px' : '10px',
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
                  fontSize: '9.75px',  // bolded model values: 9.75px
                  fontWeight: 700,
                  color: isEdge ? '#39FF14' : 'rgba(255,255,255,1)',
                  letterSpacing: '0.02em',
                  fontVariantNumeric: 'tabular-nums',
                };
              }
              if (isBookTab) {
                // BOOK-only tab: model is always secondary — white unbolded, no edge highlight
                return {
                  fontSize: '10px',  // unbolded model values: 10px
                  fontWeight: 400,
                  color: 'rgba(255,255,255,0.70)',
                  letterSpacing: '0.02em',
                  fontVariantNumeric: 'tabular-nums',
                };
              }
              if (isModelTab) {
                // MODEL-only tab: edge = neon green bold; non-edge = white bold
                return {
                  fontSize: '9.75px',  // bolded model values: 9.75px
                  fontWeight: 700,
                  color: isEdge ? '#39FF14' : 'rgba(255,255,255,1)',
                  letterSpacing: '0.02em',
                  fontVariantNumeric: 'tabular-nums',
                };
              }
              // SPLITS/EDGE tabs: dimmed
              return {
                fontSize: '10px',  // unbolded dimmed values: 10px
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
            // ML edge uses independent implied-probability detection (not spread-derived)
            const awayMlIsEdge      = awayMlEdgeDetected;
            const homeMlIsEdge      = homeMlEdgeDetected;

            // ── Tab bar config ────────────────────────────────────────────────
            const TABS: { id: MobileTab; label: string }[] = [
              { id: 'book',   label: 'BOOK LINES' },
              { id: 'model',  label: 'MODEL LINES' },
              { id: 'splits', label: 'SPLITS' },
              { id: 'edge',   label: 'EDGE' },
            ];

            // ── Shared odds table (used by both BOOK and MODEL tabs) ──────────
            const OddsTable = () => (
              <div className="flex flex-col w-full px-2 pt-2 pb-1">
                {/* Column headers: SPREAD | TOTAL | MONEYLINE */}
                <div className="grid grid-cols-3 pb-1">
                  {['SPREAD', 'TOTAL', 'ML'].map(h => (
                    <span key={h} className="text-center font-extrabold uppercase tracking-widest"
                      style={{ fontSize: 'clamp(9.25px, 2.3vw, 11.25px)', color: '#E8E8E8' }}>{h}</span>
                  ))}
                </div>
                {/* Sub-headers: BOOK and MODEL are tab-responsive
                     BOOK-only:  BOOK = white BOLD,    MODEL = white unbolded
                     MODEL-only: BOOK = white unbolded, MODEL = neon green BOLD
                     DUAL:       BOOK = white BOLD,    MODEL = neon green BOLD (both active)
                     Other tabs: BOOK = gray 50%,      MODEL = gray 50%
                */}
                <div className="grid grid-cols-3 pb-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                  {[0,1,2].map(i => (
                    <div key={i} className="grid grid-cols-2">
                      <span className="text-center uppercase tracking-widest"
                        style={{
                          fontSize: '7.5px',
                          // DUAL: white bold | BOOK-only: white bold | MODEL-only: white unbolded | other: gray
                          fontWeight: (isDualTab || isBookTab) ? 700 : 400,
                          color: (isDualTab || isBookTab)
                            ? 'rgba(255,255,255,1)'          // DUAL or BOOK active: white bold
                            : isModelTab
                              ? 'rgba(255,255,255,0.75)'     // MODEL-only: white unbolded
                              : 'rgba(255,255,255,0.40)',     // SPLITS/EDGE: gray
                          letterSpacing: '0.05em',
                        }}>BOOK</span>
                      <span className="text-center uppercase tracking-widest"
                        style={{
                          fontSize: '7.5px',
                          // DUAL: neon green bold | MODEL-only: neon green bold | BOOK-only: white unbolded | other: gray
                          fontWeight: (isDualTab || isModelTab) ? 700 : 400,
                          color: (isDualTab || isModelTab)
                            ? '#39FF14'                      // DUAL or MODEL active: neon green bold
                            : isBookTab
                              ? 'rgba(255,255,255,0.75)'     // BOOK-only: white unbolded
                              : 'rgba(255,255,255,0.40)',     // SPLITS/EDGE: gray
                          letterSpacing: '0.05em',
                        }}>MODEL</span>
                    </div>
                  ))}
                </div>
                {/* Away row — height: 44px shared with frozen panel away row */}
                <div className="grid grid-cols-3" style={{ height: '44px', alignItems: 'center' }}>
                  <div className="grid grid-cols-2">
                    <span className="text-center tabular-nums" style={bookStyle(awaySpreadIsEdge)}>{bkAwaySpreadStr}</span>
                    <span className="text-center tabular-nums" style={modelStyle(awaySpreadIsEdge)}>{mdlAwaySpreadStr}</span>
                  </div>
                  <div className="grid grid-cols-2">
                    <span className="text-center tabular-nums" style={bookStyle(overTotalIsEdge)}>o{bkTotalStr}</span>
                    <span className="text-center tabular-nums" style={modelStyle(overTotalIsEdge)}>o{mdlTotalStr}</span>
                  </div>
                  <div className="grid grid-cols-2">
                    <span className="text-center tabular-nums" style={bookStyle(awayMlIsEdge)}>{bkAwayMl}</span>
                    <span className="text-center tabular-nums" style={modelStyle(awayMlIsEdge)}>{mdlAwayMl}</span>
                  </div>
                </div>
                {/* Divider */}
                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
                {/* Home row — height: 44px shared with frozen panel home row */}
                <div className="grid grid-cols-3" style={{ height: '44px', alignItems: 'center' }}>
                  <div className="grid grid-cols-2">
                    <span className="text-center tabular-nums" style={bookStyle(homeSpreadIsEdge)}>{bkHomeSpreadStr}</span>
                    <span className="text-center tabular-nums" style={modelStyle(homeSpreadIsEdge)}>{mdlHomeSpreadStr}</span>
                  </div>
                  <div className="grid grid-cols-2">
                    <span className="text-center tabular-nums" style={bookStyle(underTotalIsEdge)}>u{bkTotalStr}</span>
                    <span className="text-center tabular-nums" style={modelStyle(underTotalIsEdge)}>u{mdlTotalStr}</span>
                  </div>
                  <div className="grid grid-cols-2">
                    <span className="text-center tabular-nums" style={bookStyle(homeMlIsEdge)}>{bkHomeMl}</span>
                    <span className="text-center tabular-nums" style={modelStyle(homeMlIsEdge)}>{mdlHomeMl}</span>
                  </div>
                </div>
              </div>
            );

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', width: '100%', minHeight: 0 }}>

                {/* ── FROZEN LEFT PANEL: logo + abbr + score ─────────────────── */}
                <div style={{
                  gridColumn: '1',
                  borderRight: '1px solid hsl(var(--border) / 0.5)',
                  background: 'hsl(var(--card))',
                  zIndex: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',  /* vertically center all team rows + status */
                  alignItems: 'stretch',
                  padding: '0 6px',  /* no vertical padding — row heights are fixed */
                  gap: 0,
                  alignSelf: 'stretch',  /* fill full card height so centering works */
                }}>
                  {/* Status row: flex-1 to absorb OddsTable header height (pt-2 + col headers + sub-headers + pb-1 ≈ auto) */}
                  <div className="flex items-center gap-1" style={{ flex: '0 0 auto', paddingTop: '8px', paddingBottom: '4px' }}>
                    {isAppAuthed && (
                      <button
                        onClick={handleStarClick}
                        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', color: isFavorited ? '#FFD700' : 'rgba(255,255,255,0.65)', filter: isFavorited ? 'drop-shadow(0 0 5px #FFD700)' : 'none', transition: 'color 0.15s' }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorited ? '#FFD700' : 'none'} stroke={isFavorited ? '#FFD700' : 'rgba(255,255,255,0.85)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}
                    {isLive ? (
                      <span className="flex items-center gap-1 font-black tracking-widest uppercase" style={{ color: '#39FF14', fontSize: 'clamp(13px, 3.2vw, 16px)', whiteSpace: 'nowrap', flexWrap: 'nowrap' }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: '#39FF14' }} />
                        LIVE
                        {/* Clock inline right of LIVE — white font, NOT bold */}
                        {formattedClock && (
                          <span style={{
                            color: 'rgba(255,255,255,0.90)',
                            fontWeight: 600,
                            fontSize: 'clamp(10.5px, 2.6vw, 13.5px)',
                            letterSpacing: '0.03em',
                            fontVariantNumeric: 'tabular-nums',
                            marginLeft: '2px',
                            whiteSpace: 'nowrap',
                            display: 'inline',
                            lineHeight: 1,
                          }}>{formattedClock}</span>
                        )}
                      </span>
                    ) : isFinal ? (
                      <span className="font-bold tracking-wide px-1.5 py-0.5 rounded" style={{ fontSize: 'clamp(12.5px, 3.1vw, 15.5px)', background: 'rgba(255,255,255,0.07)', color: 'hsl(var(--muted-foreground))' }}>FINAL</span>
                    ) : (
                      <span style={{ fontSize: 'clamp(13.5px, 3.4vw, 16.5px)', fontWeight: 400, color: 'hsl(var(--foreground))' }}>{time}</span>
                    )}
                  </div>

                  {/* Away row: height: 44px — matches OddsTable away row exactly */}
                  <div className="flex items-center justify-between gap-1 w-full" style={{ alignItems: 'center', height: '44px' }}>
                    {/* Logo + name block */}
                    <div className="flex items-center gap-2 min-w-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
                      {/* Logo centered between school+nickname lines */}
                      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 33, height: 44 }}>
                        <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={33} />
                      </div>
                      <MobileTeamNameBlock
                        schoolName={awayName}
                        nickname={awayNickname}
                        isWinner={awayWins}
                        isFinalGame={isFinal}
                      />
                    </div>
                    {/* Score — fixed width so it never squeezes the name */}
                    {(isLive || isFinal) && hasScores && (
                      <span className="tabular-nums font-black flex-shrink-0 transition-colors duration-300" style={{
                        fontSize: 'clamp(15px, 4vw, 20px)', lineHeight: 1,
                        minWidth: '28px', textAlign: 'center',
                        color: awayScoreFlash ? '#39FF14' : awayWins ? 'hsl(var(--foreground))' : isFinal ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                        textShadow: awayScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
                      }}>{game.awayScore}</span>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: 'hsl(var(--border) / 0.4)' }} />

                  {/* Home row: height: 44px — matches OddsTable home row exactly */}
                  <div className="flex items-center justify-between gap-1 w-full" style={{ alignItems: 'center', height: '44px' }}>
                    {/* Logo + name block */}
                    <div className="flex items-center gap-2 min-w-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
                      {/* Logo centered between school+nickname lines */}
                      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 33, height: 44 }}>
                        <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={33} />
                      </div>
                      <MobileTeamNameBlock
                        schoolName={homeName}
                        nickname={homeNickname}
                        isWinner={homeWins}
                        isFinalGame={isFinal}
                      />
                    </div>
                    {/* Score — fixed width so it never squeezes the name */}
                    {(isLive || isFinal) && hasScores && (
                      <span className="tabular-nums font-black flex-shrink-0 transition-colors duration-300" style={{
                        fontSize: 'clamp(15px, 4vw, 20px)', lineHeight: 1,
                        minWidth: '28px', textAlign: 'center',
                        color: homeScoreFlash ? '#39FF14' : homeWins ? 'hsl(var(--foreground))' : isFinal ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                        textShadow: homeScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
                      }}>{game.homeScore}</span>
                    )}
                  </div>
                </div>

                {/* ── RIGHT PANEL: tab bar + active section ──────────────────── */}
                <div style={{ gridColumn: '2', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

                  {/* Sticky tab bar */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    borderBottom: '1px solid hsl(var(--border) / 0.5)',
                    background: 'hsl(var(--card))',
                    position: 'sticky',
                    top: 0,
                    zIndex: 3,
                    flexShrink: 0,
                  }}>
                    {TABS.map(tab => {
                      // Tab rules:
                      //   • BOOK + MODEL can be dual-active (default state)
                      //   • SPLITS and EDGE are exclusive single-select
                      //   • At least one tab must always be active (cannot deselect last)
                      const isActive = mobileTab === tab.id ||
                        (isDualTab && (tab.id === 'book' || tab.id === 'model'));
                      const handleTabClick = () => {
                        // ── Tab click rules ──────────────────────────────────────────
                        // 1. At least one tab must always be active (ignore deselect-last)
                        // 2. BOOK + MODEL can be dual-active; SPLITS/EDGE are exclusive
                        // 3. Clicking SPLITS/EDGE always switches to that single tab
                        // 4. Clicking BOOK when MODEL active → dual
                        //    Clicking MODEL when BOOK active → dual
                        //    Clicking BOOK/MODEL when dual → go to the other (cannot go to none)
                        //    Clicking BOOK when BOOK-only → no-op (already active, cannot deselect)
                        //    Clicking MODEL when MODEL-only → no-op (already active, cannot deselect)
                        let next: MobileTab = mobileTab;
                        if (tab.id === 'book') {
                          if (mobileTab === 'model') next = 'dual';              // MODEL active → add BOOK → dual
                          else if (isDualTab) next = 'model';                    // dual → remove BOOK → MODEL only
                          else next = 'book';                                     // already book or coming from splits/edge
                        } else if (tab.id === 'model') {
                          if (mobileTab === 'book') next = 'dual';               // BOOK active → add MODEL → dual
                          else if (isDualTab) next = 'book';                     // dual → remove MODEL → BOOK only
                          else next = 'model';                                    // already model or coming from splits/edge
                        } else {
                          // SPLITS or EDGE: exclusive single-select, always switch
                          next = tab.id;
                        }
                        if (process.env.NODE_ENV === 'development') {
                          console.log(`%c[GameCard:tab] ${game.id} ${awayAbbr}@${homeAbbr} current=${mobileTab} clicked=${tab.id} → ${next}`, 'color:#39FF14;font-size:10px');
                        }
                        setMobileTab(next);
                      };
                      return (
                        <button
                          key={tab.id}
                          onClick={handleTabClick}
                          style={{
                            padding: '6px 2px',
                            fontSize: '7.5px',
                            fontWeight: isActive ? 800 : 500,
                            letterSpacing: '0.06em',
                            color: isActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.45)',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: isActive ? '2px solid #39FF14' : '2px solid transparent',
                            cursor: 'pointer',
                            transition: 'color 0.15s, border-color 0.15s',
                            textTransform: 'uppercase',
                            lineHeight: 1.2,
                          }}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>                  {/* ── OddsTable: visible only when BOOK, MODEL, or DUAL tab is active ── */}
                  {/* Hidden entirely when SPLITS or EDGE tab is active               */}
                  {(mobileTab === 'book' || mobileTab === 'model' || mobileTab === 'dual') && (
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

                  {/* ── EDGE tab (additional content below OddsTable) ────────── */}
                  {mobileTab === 'edge' && (
                    <div className="flex items-center justify-center w-full" style={{ minHeight: 72, padding: '8px 4px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
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
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </motion.div>


    </>
  );
}

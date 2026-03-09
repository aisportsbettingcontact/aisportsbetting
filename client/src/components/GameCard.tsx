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
  return `${hours}:${minutes} ${ampm} ET`;
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
  // Tabs: 'book' | 'model' | 'splits' | 'edge'
  type MobileTab = 'book' | 'model' | 'splits' | 'edge';
  const [mobileTab, setMobileTab] = useState<MobileTab>('book');

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
  const ScorePanel = () => (
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
          <div className="flex flex-col min-w-0">
            <span
              className="font-semibold leading-tight"
              style={{
                fontSize: "clamp(11px, 3vw, 15px)",
                color: awayWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: awayWins ? 700 : 600,
                wordBreak: "break-word",
                overflowWrap: "anywhere",
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
          <div className="flex flex-col min-w-0">
            <span
              className="font-semibold leading-tight"
              style={{
                fontSize: "clamp(11px, 3vw, 15px)",
                color: homeWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: homeWins ? 700 : 600,
                wordBreak: "break-word",
                overflowWrap: "anywhere",
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
              flex: mode === "splits" ? "1 1 28%" : "1 1 18%",
              minWidth: 160,
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
                flex: mode === "projections" ? "2 1 40%" : "1.5 1 30%",
                minWidth: 200,
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
            // NCAAM: "1st" → "1H", "2nd" → "2H"; NBA: "Q1"–"Q4", "HALFTIME", "MM:SS"
            const formatGameClock = (raw: string | null | undefined): string => {
              if (!raw) return '';
              const s = raw.trim();
              // NCAAM half labels
              if (/^1st$/i.test(s)) return '1H';
              if (/^2nd$/i.test(s)) return '2H';
              if (/^1st\s+half$/i.test(s)) return '1H';
              if (/^2nd\s+half$/i.test(s)) return '2H';
              if (/^half(time)?$/i.test(s)) return isNba ? 'HALFTIME' : 'HT';
              // NBA quarter labels
              if (/^q?1(st)?$/i.test(s)) return 'Q1';
              if (/^q?2(nd)?$/i.test(s)) return 'Q2';
              if (/^q?3(rd)?$/i.test(s)) return 'Q3';
              if (/^q?4(th)?$/i.test(s)) return 'Q4';
              if (/^ot$/i.test(s)) return 'OT';
              // MM:SS clock — pass through as-is
              if (/^\d{1,2}:\d{2}$/.test(s)) return s;
              // Compound: "Q3 4:15" or "2nd 7:42" — normalize quarter label then keep clock
              const compound = s.match(/^(q?\d|\d+(?:st|nd|rd|th)?|half(?:time)?)\s+(\d{1,2}:\d{2})$/i);
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
            const bkAwayMl         = game.awayML ?? '—';
            const bkHomeMl         = game.homeML ?? '—';
            const mdlAwayMl        = game.modelAwayML ?? '—';
            const mdlHomeMl        = game.modelHomeML ?? '—';

            // ── Edge direction helpers ────────────────────────────────────────
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

            // ── Style factories ───────────────────────────────────────────────
            // bookActive: BOOK LINES tab — book bold white, model green 40% opacity
            // modelActive: MODEL LINES tab — book gray 40% opacity, model green bold
            const isBookTab  = mobileTab === 'book';
            const isModelTab = mobileTab === 'model';

            // ── Value style factories ────────────────────────────────────────────
            // BOOK LINES tab active  → book = white bold full opacity; model = light gray 20% opacity
            // MODEL LINES tab active → book = light gray 20% opacity; model = #39FF14 bold full opacity
            // Neither tab (SPLITS/EDGE) → both at 20% opacity (background context)
            const bookStyle  = (_isEdge?: boolean): React.CSSProperties => ({
              fontSize: 'clamp(11px, 3vw, 15px)',  // -2pt from previous 13px base
              fontWeight: isBookTab ? 700 : 400,
              color: isBookTab
                ? 'rgba(232,232,232,1)'         // active: white bold
                : 'rgba(232,232,232,0.20)',      // inactive: light gray 20% opacity
              letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
            });
            const modelStyle = (isEdge?: boolean): React.CSSProperties => ({
              fontSize: 'clamp(11px, 3vw, 15px)',  // -2pt from previous 13px base
              fontWeight: isModelTab ? 700 : 400,
              color: isModelTab
                ? (isEdge ? '#39FF14' : 'rgba(255,255,255,0.55)')  // edge=neon green; non-edge=white 55% opacity (more visible)
                : 'rgba(232,232,232,0.20)',           // inactive tab: light gray 20% opacity
              letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
            });

            // Per-cell edge detection
            const awaySpreadIsEdge  = spreadEdgeIsAway === true;
            const homeSpreadIsEdge  = spreadEdgeIsAway === false;
            const overTotalIsEdge   = totalEdgeIsOver  === true;
            const underTotalIsEdge  = totalEdgeIsOver  === false;
            const awayMlIsEdge      = spreadEdgeIsAway === true;
            const homeMlIsEdge      = spreadEdgeIsAway === false;

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
                      style={{ fontSize: 'clamp(9px, 2.2vw, 11px)', color: '#E8E8E8' }}>{h}</span>
                  ))}
                </div>
                {/* Sub-headers: BOOK / MODEL — active=bold white/neon, inactive=light gray unbolded */}
                <div className="grid grid-cols-3 pb-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                  {[0,1,2].map(i => (
                    <div key={i} className="grid grid-cols-2">
                      <span className="text-center uppercase tracking-widest"
                        style={{
                          fontSize: 'clamp(7px, 1.9vw, 10px)',
                          fontWeight: isBookTab ? 700 : 400,
                          color: isBookTab ? 'rgba(232,232,232,0.9)' : 'rgba(232,232,232,0.30)',
                          letterSpacing: '0.05em',
                        }}>BOOK</span>
                      <span className="text-center uppercase tracking-widest"
                        style={{
                          fontSize: 'clamp(7px, 1.9vw, 10px)',
                          fontWeight: isModelTab ? 700 : 400,
                          color: isModelTab ? '#39FF14' : 'rgba(232,232,232,0.30)',
                          letterSpacing: '0.05em',
                        }}>MODEL</span>
                    </div>
                  ))}
                </div>
                {/* Away row */}
                <div className="grid grid-cols-3 py-2">
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
                {/* Home row */}
                <div className="grid grid-cols-3 py-2">
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
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', width: '100%', minHeight: 0 }}>

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
                  padding: '8px 6px',
                  gap: 4,
                  alignSelf: 'stretch',  /* fill full card height so centering works */
                }}>
                  {/* Status row: star + time/status */}
                  <div className="flex items-center gap-1 mb-0.5">
                    {isAppAuthed && (
                      <button
                        onClick={handleStarClick}
                        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', color: isFavorited ? '#FFD700' : 'rgba(255,255,255,0.65)', filter: isFavorited ? 'drop-shadow(0 0 3px #FFD700)' : 'none', transition: 'color 0.15s' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill={isFavorited ? '#FFD700' : 'none'} stroke={isFavorited ? '#FFD700' : 'rgba(255,255,255,0.85)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}
                    {isLive ? (
                      <span className="flex items-center gap-1 text-[8px] font-black tracking-widest uppercase" style={{ color: '#39FF14' }}>
                        <span className="w-1 h-1 rounded-full animate-pulse inline-block" style={{ background: '#39FF14' }} />
                        LIVE
                        {/* Clock inline right of LIVE — white font, formatted */}
                        {formattedClock && (
                          <span style={{
                            color: 'rgba(255,255,255,0.90)',
                            fontWeight: 700,
                            fontSize: 'clamp(7px, 1.9vw, 9px)',
                            letterSpacing: '0.04em',
                            fontVariantNumeric: 'tabular-nums',
                            marginLeft: '2px',
                          }}>{formattedClock}</span>
                        )}
                      </span>
                    ) : isFinal ? (
                      <span className="text-[8px] font-bold tracking-wide px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.07)', color: 'hsl(var(--muted-foreground))' }}>FINAL</span>
                    ) : (
                      <span className="text-[9px] font-bold" style={{ color: 'hsl(var(--foreground))' }}>{time}</span>
                    )}
                  </div>

                  {/* Away row: logo + two-line name + score — items-center ensures score aligns with team row */}
                  <div className="flex items-center justify-between gap-1 w-full" style={{ alignItems: 'center' }}>
                    {/* Logo + name block */}
                    <div className="flex items-center gap-1 min-w-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
                      <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={18} />
                      <div className="flex flex-col min-w-0" style={{ lineHeight: 1.15 }}>
                        <span style={{
                          fontSize: 'clamp(10px, 2.6vw, 12px)',  /* +2pt: was 8px base */
                          fontWeight: awayWins ? 800 : 600,
                          color: awayWins ? 'hsl(var(--foreground))' : isFinal ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '76px',
                        }}>{awayName}</span>
                        {awayNickname && (
                          <span style={{
                            fontSize: 'clamp(8px, 2.1vw, 10px)',  /* +1pt: was 7px base */
                            fontWeight: 400,
                            color: awayWins ? 'rgba(232,232,232,0.75)' : 'rgba(232,232,232,0.50)',
                            letterSpacing: '0.02em',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '76px',
                          }}>{awayNickname}</span>
                        )}
                      </div>
                    </div>
                    {/* Score — fixed width so it never squeezes the name */}
                    {(isLive || isFinal) && hasScores && (
                      <span className="tabular-nums font-black flex-shrink-0 transition-colors duration-300" style={{
                        fontSize: 'clamp(15px, 4vw, 20px)', lineHeight: 1,
                        minWidth: '28px', textAlign: 'right',
                        color: awayScoreFlash ? '#39FF14' : awayWins ? 'hsl(var(--foreground))' : isFinal ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                        textShadow: awayScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
                      }}>{game.awayScore}</span>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: 'hsl(var(--border) / 0.4)' }} />

                  {/* Home row: logo + two-line name + score — items-center ensures score aligns with team row */}
                  <div className="flex items-center justify-between gap-1 w-full" style={{ alignItems: 'center' }}>
                    {/* Logo + name block */}
                    <div className="flex items-center gap-1 min-w-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
                      <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={18} />
                      <div className="flex flex-col min-w-0" style={{ lineHeight: 1.15 }}>
                        <span style={{
                          fontSize: 'clamp(10px, 2.6vw, 12px)',  /* +2pt: was 8px base */
                          fontWeight: homeWins ? 800 : 600,
                          color: homeWins ? 'hsl(var(--foreground))' : isFinal ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '76px',
                        }}>{homeName}</span>
                        {homeNickname && (
                          <span style={{
                            fontSize: 'clamp(8px, 2.1vw, 10px)',  /* +1pt: was 7px base */
                            fontWeight: 400,
                            color: homeWins ? 'rgba(232,232,232,0.75)' : 'rgba(232,232,232,0.50)',
                            letterSpacing: '0.02em',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '76px',
                          }}>{homeNickname}</span>
                        )}
                      </div>
                    </div>
                    {/* Score — fixed width so it never squeezes the name */}
                    {(isLive || isFinal) && hasScores && (
                      <span className="tabular-nums font-black flex-shrink-0 transition-colors duration-300" style={{
                        fontSize: 'clamp(15px, 4vw, 20px)', lineHeight: 1,
                        minWidth: '28px', textAlign: 'right',
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
                      const isActive = mobileTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => {
                            if (process.env.NODE_ENV === 'development') {
                              console.log(`%c[GameCard:tab] ${game.id} ${awayAbbr}@${homeAbbr} → ${tab.id}`, 'color:#39FF14;font-size:10px');
                            }
                            setMobileTab(tab.id);
                          }}
                          style={{
                            padding: '6px 2px',
                            fontSize: 'clamp(7px, 1.9vw, 9px)',
                            fontWeight: isActive ? 800 : 500,
                            letterSpacing: '0.06em',
                            /* Active: white text + neon green underline; inactive: gray */
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
                  </div>

                  {/* ── BOOK LINES tab ──────────────────────────────────────── */}
                  {mobileTab === 'book' && <OddsTable />}

                  {/* ── MODEL LINES tab ─────────────────────────────────────── */}
                  {mobileTab === 'model' && <OddsTable />}

                  {/* ── SPLITS tab ──────────────────────────────────────────── */}
                  {mobileTab === 'splits' && (
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <BettingSplitsPanel
                        game={game}
                        awayLabel={awayName}
                        homeLabel={homeName}
                        awayNickname={awayNickname}
                        homeNickname={homeNickname}
                      />
                    </div>
                  )}

                  {/* ── EDGE tab ────────────────────────────────────────────── */}
                  {mobileTab === 'edge' && (
                    <div className="flex items-center justify-center w-full" style={{ minHeight: 72, padding: '8px 4px' }}>
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

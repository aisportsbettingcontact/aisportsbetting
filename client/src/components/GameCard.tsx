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

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc";
import { getTeamByDbSlug } from "@shared/ncaamTeams";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";
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
  if (!logoUrl || error) {
    return (
      <div
        className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{
          width: size, height: size,
          background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
          fontSize: Math.max(9, size * 0.28),
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
      style={{ width: size, height: size, objectFit: "contain", mixBlendMode: "screen", flexShrink: 0 }}
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

  // 6-column grid: [Spread Book | Spread Model | Total Book | Total Model | ML Book | ML Model]
  const GRID = 'grid-cols-6';

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

  // Base cell styles
  const bookCell      = { fontSize: 'clamp(11px,1.6vw,13px)', fontWeight: 400, color: '#E8E8E8', letterSpacing: '0.02em' } as React.CSSProperties;
  // Model cells: neon green only when this specific cell is the edge side; otherwise bold white
  const modelGreen    = { fontSize: 'clamp(11px,1.6vw,13px)', fontWeight: 700, color: '#39FF14', letterSpacing: '0.02em' } as React.CSSProperties;
  const modelWhite    = { fontSize: 'clamp(11px,1.6vw,13px)', fontWeight: 700, color: '#E8E8E8', letterSpacing: '0.02em' } as React.CSSProperties;
  const dimCell       = { fontSize: 'clamp(11px,1.6vw,13px)', fontWeight: 700, color: 'rgba(57,255,20,0.28)', letterSpacing: '0.02em' } as React.CSSProperties;

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
      <div className={`grid ${GRID} pb-0.5`}>
        <span className="col-span-2 text-center text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#E8E8E8' }}>Spread</span>
        <span className="col-span-2 text-center text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#E8E8E8' }}>Total</span>
        <span className="col-span-2 text-center text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#E8E8E8' }}>Moneyline</span>
      </div>

      {/* Sub-headers: BOOK | MODEL per group */}
      <div
        className={`grid ${GRID} pb-1 mb-0.5`}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}
      >
        {['Book', 'Model', 'Book', 'Model', 'Book', 'Model'].map((lbl, i) => (
          <span
            key={i}
            className="text-center text-[9px] font-bold uppercase tracking-widest"
            style={{ color: lbl === 'Model' ? (showModel ? '#39FF14' : 'rgba(57,255,20,0.22)') : 'rgba(255,255,255,0.5)' }}
          >
            {lbl}
          </span>
        ))}
      </div>

      {/* Away row */}
      <div className={`grid ${GRID} py-2`}>
        <Cell val={bkAwaySpread} style={bookCell} />
        <Cell val={mdlAwaySpreadStr} style={awaySpreadModelStyle} />
        <Cell val={`o${bkOverTotal}`} style={bookCell} />
        <Cell val={`o${mdlOverTotal}`} style={overTotalModelStyle} />
        <Cell val={awayMl || '—'} style={bookCell} />
        <Cell val={mdlAwayMlStr} style={awayMlModelStyle} />
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

      {/* Home row */}
      <div className={`grid ${GRID} py-2`}>
        <Cell val={bkHomeSpread} style={bookCell} />
        <Cell val={mdlHomeSpreadStr} style={homeSpreadModelStyle} />
        <Cell val={`u${bkUnderTotal}`} style={bookCell} />
        <Cell val={`u${mdlUnderTotal}`} style={underTotalModelStyle} />
        <Cell val={homeMl || '—'} style={bookCell} />
        <Cell val={mdlHomeMlStr} style={homeMlModelStyle} />
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
}

export function GameCard({ game, mode = "full", showModel: showModelProp, onToggleModel: onToggleModelProp }: GameCardProps) {
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

  // Score flash animation
  const prevScoreRef = useRef<string | null>(null);
  const [scoreFlash, setScoreFlash] = useState(false);
  const scoreKey = hasScores ? `${game.awayScore}-${game.homeScore}` : null;
  useEffect(() => {
    if (scoreKey && prevScoreRef.current !== null && prevScoreRef.current !== scoreKey) {
      setScoreFlash(true);
      const t = setTimeout(() => setScoreFlash(false), 800);
      return () => clearTimeout(t);
    }
    prevScoreRef.current = scoreKey;
  }, [scoreKey]);

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

  const CompactScorePanel = () => (
    <div className="flex flex-col justify-center h-full px-2 py-3 gap-2" style={{ minWidth: 0 }}>
      {/* Status */}
      <div className="flex items-center gap-1 mb-1">
        {isLive ? (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide" style={{ background: "rgba(239,68,68,0.18)", color: "#ef4444" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#ef4444" }} />
            LIVE
          </span>
        ) : isFinal ? (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide" style={{ background: "rgba(255,255,255,0.07)", color: "hsl(var(--muted-foreground))" }}>FINAL</span>
        ) : (
          <span className="text-[10px] font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>{time}</span>
        )}
        {isLive && game.gameClock && (
          <span className="text-[9px] tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>{game.gameClock}</span>
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
    <div className="flex flex-col pl-2 pr-1 pt-0 pb-0 min-w-0" style={{ minWidth: 0 }}>
      {/* Status row: clock / LIVE badge / FINAL / start time — mirrors OddsLinesPanel header height */}
      <div className="flex items-center gap-1.5 mb-0.5">
        {isLive ? (
          <>
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.18)", color: "#ef4444" }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#ef4444" }} />
              LIVE
            </span>
            {game.gameClock && (
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>
                {game.gameClock}
              </span>
            )}
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
        {/* Left: logo + name/nickname */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={30} />
          <div className="flex flex-col min-w-0">
            <span
              className="font-semibold leading-tight truncate"
              style={{
                fontSize: "clamp(11px, 1.5vw, 13px)",
                color: awayWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: awayWins ? 700 : 600,
              }}
            >
              {awayName}
            </span>
            {awayNickname && (
              <span className="text-[9px] leading-none truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                {awayNickname}
              </span>
            )}
          </div>
        </div>
        {/* Right: score pushed to far right */}
        {(isLive || isFinal) && hasScores && (
          <span
            className="tabular-nums font-black flex-shrink-0 transition-colors duration-300"
            style={{
              fontSize: "clamp(24px, 4vw, 38px)",
              lineHeight: 1,
              color: scoreFlash
                ? "#39FF14"
                : awayWins
                ? "hsl(var(--foreground))"
                : isFinal
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--foreground))",
              textShadow: scoreFlash ? "0 0 12px rgba(57,255,20,0.7)" : "none",
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
        {/* Left: logo + name/nickname */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={30} />
          <div className="flex flex-col min-w-0">
            <span
              className="font-semibold leading-tight truncate"
              style={{
                fontSize: "clamp(11px, 1.5vw, 13px)",
                color: homeWins ? "hsl(var(--foreground))" : isFinal ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                fontWeight: homeWins ? 700 : 600,
              }}
            >
              {homeName}
            </span>
            {homeNickname && (
              <span className="text-[9px] leading-none truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                {homeNickname}
              </span>
            )}
          </div>
        </div>
        {/* Right: score pushed to far right */}
        {(isLive || isFinal) && hasScores && (
          <span
            className="tabular-nums font-black flex-shrink-0 transition-colors duration-300"
            style={{
              fontSize: "clamp(24px, 4vw, 38px)",
              lineHeight: 1,
              color: scoreFlash
                ? "#39FF14"
                : homeWins
                ? "hsl(var(--foreground))"
                : isFinal
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--foreground))",
              textShadow: scoreFlash ? "0 0 12px rgba(57,255,20,0.7)" : "none",
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
        className="w-full overflow-hidden relative"
        style={{
          background: "hsl(var(--card))",
          borderTop: "1px solid hsl(var(--border))",
          borderBottom: "1px solid hsl(var(--border))",
          borderLeft: `3px solid ${borderColor}`,
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
        <div className="hidden lg:flex items-stretch w-full" style={{ overflowX: "auto" }}>
          {/* Col 1: Score panel — always shown */}
          <div
            className="flex-shrink-0"
            style={{
              width: mode === "splits" ? "28%" : "20%",
              minWidth: 180,
              borderRight: "1px solid hsl(var(--border) / 0.5)",
            }}
          >
            <ScorePanel />
          </div>

          {/* Col 2: Odds/Lines — hidden in splits mode */}
          {mode !== "splits" && (
            <div
              className="flex-shrink-0 flex flex-col justify-center"
              style={{
                width: mode === "projections" ? "54%" : "28%",
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

          {/* Col 3: Edge Verdict (projections) or Betting Splits (full/splits) */}
          {mode === "projections" && showModel && (
            <div
              className="flex-1 flex items-center justify-center px-2 py-0"
              style={{ minWidth: 150, borderLeft: "none" }}
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
          {mode !== "projections" && (
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
        <div className="flex lg:hidden flex-col w-full">
          {/* Projections mode: Row 1 = Score | Odds/Lines, Row 2 = EdgeVerdict (full width below) */}
          {mode === "projections" && (
            <div className="flex flex-col w-full">
              {/* Row 1: Score panel + Odds/Lines table side by side */}
              <div className="flex items-stretch w-full" style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 140, width: "28%", borderRight: "1px solid hsl(var(--border) / 0.5)", flexShrink: 0 }}>
                  <ScorePanel />
                </div>
                <div style={{ minWidth: 180, flex: "1 1 0%" }} className="flex flex-col justify-center">
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
            </div>
          )}

          {/* Splits mode: CompactScore (fixed narrow left) + Splits (flex-1 right) */}
          {mode === "splits" && (
            <div className="flex items-stretch w-full">
              {/* Compact score: fixed 130px so splits get the majority of space */}
              <div style={{ width: 130, minWidth: 130, flexShrink: 0, borderRight: "1px solid hsl(var(--border) / 0.5)" }}>
                <CompactScorePanel />
              </div>
              {/* Splits: takes all remaining width */}
              <div className="flex-1 min-w-0">
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

          {/* Full mode: Score+Odds on top, Splits below */}
          {mode === "full" && (
            <>
              <div className="flex items-stretch w-full" style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)", overflowX: "auto" }}>
                <div className="flex-1" style={{ minWidth: 160, borderRight: "1px solid hsl(var(--border) / 0.5)" }}>
                  <ScorePanel />
                </div>
                <div className="flex-1" style={{ minWidth: 160 }}>
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
              <div className="w-full px-3 py-3">
                <BettingSplitsPanel
                  game={game}
                  awayLabel={awayName}
                  homeLabel={homeName}
                  awayNickname={awayNickname}
                  homeNickname={homeNickname}
                />
              </div>
            </>
          )}
        </div>
      </motion.div>


    </>
  );
}

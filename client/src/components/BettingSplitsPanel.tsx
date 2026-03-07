/**
 * BettingSplitsPanel
 *
 * DraftKings-style betting splits display for NCAAM and NBA games.
 * Team colors are fetched from the database (ncaam_teams / nba_teams tables)
 * via the teamColors.getForGame tRPC procedure — no hardcoded colors.
 *
 * Layout:
 *   - Team header: AWAY XX% ←→ YY% HOME (showing Handle/money%)
 *   - Per market (Spread, Total, and NBA-only Moneyline):
 *       • Handle % row (primary sharp-money signal) — colored bar using team primary color
 *       • Bets % row (public ticket count) — muted secondary bar
 *
 * NCAAM: Spread + Total only (no ML)
 * NBA:   Spread + Total + Moneyline
 */

import { trpc } from "@/lib/trpc";

interface BettingSplitsPanelProps {
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
  };
  awayLabel: string;   // e.g. "Arkansas" or "Magic"
  homeLabel: string;   // e.g. "Missouri" or "Timberwolves"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function spreadSign(n: number): string {
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

function toNum(v: string | null | undefined): number {
  if (v == null) return NaN;
  const n = parseFloat(v);
  return isNaN(n) ? NaN : n;
}

/** Fallback colors when DB lookup returns null */
const FALLBACK_AWAY_COLOR = "#39FF14";   // neon green
const FALLBACK_HOME_COLOR = "#FF6B6B";   // coral red
const FALLBACK_MUTED = "rgba(255,255,255,0.18)";

// ── SplitBar ─────────────────────────────────────────────────────────────────

interface SplitBarProps {
  /** Percentage for the left (away/over) side — 0-100 */
  pct: number | null | undefined;
  /** Bar fill color for left side */
  awayColor: string;
  /** Bar fill color for right side */
  homeColor: string;
  /** Row label shown in center, e.g. "Handle" or "Bets" */
  rowLabel: string;
  /** Left side label, e.g. "ARK +2.5" */
  leftLabel: string;
  /** Right side label, e.g. "MIZZ -2.5" */
  rightLabel: string;
  /** Whether this is the primary (Handle) row — larger text */
  primary?: boolean;
}

function SplitBar({
  pct, awayColor, homeColor, rowLabel, leftLabel, rightLabel, primary = false,
}: SplitBarProps) {
  const left = pct ?? null;
  const right = left !== null ? 100 - left : null;
  const hasData = left !== null && right !== null;

  const leftLeads = hasData && left > right;
  const rightLeads = hasData && right > left;

  const pctSize = primary ? "text-[13px]" : "text-[11px]";
  const labelSize = primary ? "text-[9px]" : "text-[8px]";
  const barHeight = primary ? 5 : 3;

  return (
    <div className="flex flex-col gap-0.5">
      {/* Pct + label row */}
      <div className="flex items-center justify-between gap-1">
        {/* Left (away / over) */}
        <div className="flex items-baseline gap-1" style={{ minWidth: 0, flex: "0 0 auto", maxWidth: "42%" }}>
          {hasData && (
            <span
              className={`${pctSize} font-bold tabular-nums leading-none`}
              style={{ color: leftLeads ? awayColor : "hsl(var(--muted-foreground))" }}
            >
              {left}%
            </span>
          )}
          <span
            className={`${labelSize} truncate`}
            style={{ color: "hsl(var(--muted-foreground))", opacity: 0.55 }}
          >
            {leftLabel}
          </span>
        </div>

        {/* Center label */}
        <span
          className="text-[8px] uppercase tracking-widest text-center"
          style={{ color: "hsl(var(--muted-foreground))", opacity: primary ? 0.6 : 0.4, flex: "1 1 auto" }}
        >
          {rowLabel}
        </span>

        {/* Right (home / under) */}
        <div className="flex items-baseline gap-1 justify-end" style={{ minWidth: 0, flex: "0 0 auto", maxWidth: "42%" }}>
          <span
            className={`${labelSize} truncate text-right`}
            style={{ color: "hsl(var(--muted-foreground))", opacity: 0.55 }}
          >
            {rightLabel}
          </span>
          {hasData && (
            <span
              className={`${pctSize} font-bold tabular-nums leading-none`}
              style={{ color: rightLeads ? homeColor : "hsl(var(--muted-foreground))" }}
            >
              {right}%
            </span>
          )}
        </div>
      </div>

      {/* Dual-color bar */}
      {hasData ? (
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{ height: barHeight, background: FALLBACK_MUTED }}
        >
          {/* Away/Over side */}
          <div
            className="absolute left-0 top-0 h-full rounded-l-full transition-all duration-700"
            style={{
              width: `${left}%`,
              background: awayColor,
              opacity: primary ? 0.9 : 0.55,
            }}
          />
          {/* Home/Under side — fills from right */}
          <div
            className="absolute right-0 top-0 h-full rounded-r-full transition-all duration-700"
            style={{
              width: `${right}%`,
              background: homeColor,
              opacity: primary ? 0.75 : 0.45,
            }}
          />
        </div>
      ) : (
        <div
          className="w-full rounded-full"
          style={{ height: barHeight, background: "rgba(255,255,255,0.05)" }}
        />
      )}
    </div>
  );
}

// ── MarketSection ─────────────────────────────────────────────────────────────

interface MarketSectionProps {
  title: string;
  titleColor: string;
  moneyPct: number | null | undefined;
  betsPct: number | null | undefined;
  awayColor: string;
  homeColor: string;
  leftMoneyLabel: string;
  rightMoneyLabel: string;
  leftBetsLabel: string;
  rightBetsLabel: string;
}

function MarketSection({
  title, titleColor,
  moneyPct, betsPct, awayColor, homeColor,
  leftMoneyLabel, rightMoneyLabel,
  leftBetsLabel, rightBetsLabel,
}: MarketSectionProps) {
  const hasAny = moneyPct != null || betsPct != null;
  if (!hasAny) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Market title */}
      <div className="flex items-center gap-1.5">
        <span
          className="text-[8px] uppercase tracking-widest font-bold"
          style={{ color: titleColor, opacity: 0.8 }}
        >
          {title}
        </span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      {/* Handle % (primary) */}
      {moneyPct != null && (
        <SplitBar
          pct={moneyPct}
          awayColor={awayColor}
          homeColor={homeColor}
          rowLabel="Handle"
          leftLabel={leftMoneyLabel}
          rightLabel={rightMoneyLabel}
          primary
        />
      )}

      {/* Bets % (secondary) */}
      {betsPct != null && (
        <SplitBar
          pct={betsPct}
          awayColor={awayColor}
          homeColor={homeColor}
          rowLabel="Bets"
          leftLabel={leftBetsLabel}
          rightLabel={rightBetsLabel}
          primary={false}
        />
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BettingSplitsPanel({ game, awayLabel, homeLabel }: BettingSplitsPanelProps) {
  const sport = game.sport ?? "NCAAM";
  const isNba = sport === "NBA";

  // Fetch team colors from the database
  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam: game.awayTeam, homeTeam: game.homeTeam, sport },
    { staleTime: 1000 * 60 * 60 } // cache for 1 hour — colors don't change
  );

  const awayPrimary = colors?.away?.primaryColor ?? FALLBACK_AWAY_COLOR;
  const homePrimary = colors?.home?.primaryColor ?? FALLBACK_HOME_COLOR;

  const hasSpreadSplits = game.spreadAwayMoneyPct != null || game.spreadAwayBetsPct != null;
  const hasTotalSplits = game.totalOverMoneyPct != null || game.totalOverBetsPct != null;
  const hasMlSplits = isNba && (game.mlAwayMoneyPct != null || game.mlAwayBetsPct != null);
  const hasAnySplits = hasSpreadSplits || hasTotalSplits || hasMlSplits;

  // Spread values for inline labels
  const awaySpread = toNum(game.awayBookSpread);
  const homeSpread = toNum(game.homeBookSpread);
  const bookTotal = toNum(game.bookTotal);

  const awaySpreadStr = !isNaN(awaySpread) ? spreadSign(awaySpread) : "";
  const homeSpreadStr = !isNaN(homeSpread) ? spreadSign(homeSpread) : "";
  const totalStr = !isNaN(bookTotal) ? `${bookTotal}` : "";

  // Header percentage (spread Handle% is the primary sharp signal)
  const headerPct = game.spreadAwayMoneyPct ?? game.spreadAwayBetsPct ?? null;

  if (!hasAnySplits) {
    return (
      <div
        className="px-3 py-3 flex items-center justify-center"
        style={{ borderTop: "1px solid hsl(var(--border) / 0.3)" }}
      >
        <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.4 }}>
          Splits not yet available
        </span>
      </div>
    );
  }

  return (
    <div
      className="px-3 pt-3 pb-3 flex flex-col gap-3"
      style={{ borderTop: "1px solid hsl(var(--border) / 0.3)" }}
    >
      {/* ── Team header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        {/* Away side */}
        <div className="flex items-baseline gap-1.5" style={{ minWidth: 0, flex: "0 0 auto" }}>
          {headerPct != null && (
            <span
              className="text-[16px] font-extrabold tabular-nums leading-none"
              style={{ color: awayPrimary }}
            >
              {headerPct}%
            </span>
          )}
          <span
            className="text-[10px] font-bold uppercase tracking-wide truncate"
            style={{ color: "hsl(var(--foreground))", maxWidth: 80 }}
          >
            {awayLabel}
          </span>
        </div>

        {/* Center */}
        <span
          className="text-[8px] uppercase tracking-widest text-center"
          style={{ color: "hsl(var(--muted-foreground))", opacity: 0.45, flex: "1 1 auto" }}
        >
          % of handle
        </span>

        {/* Home side */}
        <div className="flex items-baseline gap-1.5 justify-end" style={{ minWidth: 0, flex: "0 0 auto" }}>
          <span
            className="text-[10px] font-bold uppercase tracking-wide truncate text-right"
            style={{ color: "hsl(var(--foreground))", maxWidth: 80 }}
          >
            {homeLabel}
          </span>
          {headerPct != null && (
            <span
              className="text-[16px] font-extrabold tabular-nums leading-none"
              style={{ color: homePrimary }}
            >
              {100 - headerPct}%
            </span>
          )}
        </div>
      </div>

      {/* ── NBA only: Moneyline ──────────────────────────────────────────── */}
      {isNba && hasMlSplits && (
        <MarketSection
          title="Moneyline"
          titleColor="#A78BFA"
          moneyPct={game.mlAwayMoneyPct}
          betsPct={game.mlAwayBetsPct}
          awayColor={awayPrimary}
          homeColor={homePrimary}
          leftMoneyLabel={`${awayLabel}${game.awayML ? ` ${game.awayML}` : ""}`}
          rightMoneyLabel={`${game.homeML ? `${game.homeML} ` : ""}${homeLabel}`}
          leftBetsLabel={awayLabel}
          rightBetsLabel={homeLabel}
        />
      )}

      {/* ── Spread ──────────────────────────────────────────────────────── */}
      {hasSpreadSplits && (
        <MarketSection
          title="Spread"
          titleColor={awayPrimary}
          moneyPct={game.spreadAwayMoneyPct}
          betsPct={game.spreadAwayBetsPct}
          awayColor={awayPrimary}
          homeColor={homePrimary}
          leftMoneyLabel={`${awayLabel}${awaySpreadStr ? ` ${awaySpreadStr}` : ""}`}
          rightMoneyLabel={`${homeSpreadStr ? `${homeSpreadStr} ` : ""}${homeLabel}`}
          leftBetsLabel={`${awayLabel}${awaySpreadStr ? ` ${awaySpreadStr}` : ""}`}
          rightBetsLabel={`${homeSpreadStr ? `${homeSpreadStr} ` : ""}${homeLabel}`}
        />
      )}

      {/* ── Total ───────────────────────────────────────────────────────── */}
      {hasTotalSplits && (
        <MarketSection
          title="Total"
          titleColor="#FFB800"
          moneyPct={game.totalOverMoneyPct}
          betsPct={game.totalOverBetsPct}
          awayColor={awayPrimary}
          homeColor={homePrimary}
          leftMoneyLabel={`Over${totalStr ? ` ${totalStr}` : ""}`}
          rightMoneyLabel={`Under${totalStr ? ` ${totalStr}` : ""}`}
          leftBetsLabel={`Over${totalStr ? ` ${totalStr}` : ""}`}
          rightBetsLabel={`Under${totalStr ? ` ${totalStr}` : ""}`}
        />
      )}

      {/* Attribution */}
      <div className="flex items-center justify-center">
        <span
          className="text-[7px] uppercase tracking-widest"
          style={{ color: "hsl(var(--muted-foreground))", opacity: 0.3 }}
        >
          via VSiN / DraftKings
        </span>
      </div>
    </div>
  );
}

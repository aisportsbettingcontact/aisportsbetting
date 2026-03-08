/**
 * BettingSplitsPanel
 *
 * Desktop/Tablet layout (≥ md):
 *   BETTING SPLITS header
 *   ┌─────────────┬─────────────┬─────────────┐
 *   │   SPREAD    │    TOTAL    │     ML      │  ← side-by-side columns
 *   │  team labels│  O/U labels │  team labels│
 *   │  TICKETS %  │  TICKETS %  │  TICKETS %  │  ← bar on top
 *   │  HANDLE %   │  HANDLE %   │  HANDLE %   │  ← bar on bottom
 *   └─────────────┴─────────────┴─────────────┘
 *
 * Mobile (< md): vertical stacked (original layout)
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
  awayLabel: string;
  homeLabel: string;
  awayNickname?: string;
  homeNickname?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: string | null | undefined): number {
  if (v == null) return NaN;
  const n = parseFloat(v);
  return isNaN(n) ? NaN : n;
}

function spreadSign(n: number): string {
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

const FALLBACK_AWAY = "#1a4a8a";
const FALLBACK_HOME = "#c84b0c";

function isUnusableBarColor(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6 && clean.length !== 3) return false;
  const full = clean.length === 3
    ? clean.split("").map(c => c + c).join("")
    : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.04 || lum > 0.90;
}

function areColorsTooSimilar(hexA: string, hexB: string, threshold = 60): boolean {
  const toRgb = (hex: string) => {
    const clean = hex.replace(/^#/, "");
    const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  };
  try {
    const [r1, g1, b1] = toRgb(hexA);
    const [r2, g2, b2] = toRgb(hexB);
    const dist = Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
    return dist < threshold;
  } catch {
    return false;
  }
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  const full = clean.length === 3
    ? clean.split("").map(c => c + c).join("")
    : clean;
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = toLinear(parseInt(full.slice(0, 2), 16) / 255);
  const g = toLinear(parseInt(full.slice(2, 4), 16) / 255);
  const b = toLinear(parseInt(full.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function bestTextColor(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return "#ffffff";
  const bgLum = relativeLuminance(hex);
  const contrastWithWhite = (1 + 0.05) / (bgLum + 0.05);
  const contrastWithBlack = (bgLum + 0.05) / (0 + 0.05);
  return contrastWithBlack > contrastWithWhite ? "#000000" : "#ffffff";
}

function pickBarColor(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  tertiary: string | null | undefined,
  fallback: string
): string {
  for (const c of [primary, secondary, tertiary]) {
    if (c && !isUnusableBarColor(c)) return c;
  }
  return fallback;
}

// ── SplitBar ──────────────────────────────────────────────────────────────────
interface SplitBarProps {
  label: string;
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
  compact?: boolean;
}

function SplitBar({ label, awayPct, homePct, awayColor, homeColor, compact }: SplitBarProps) {
  const hasData = awayPct != null && homePct != null;
  const awayTextColor = bestTextColor(awayColor);
  const homeTextColor = bestTextColor(homeColor);
  const barH = compact ? 22 : 26;

  return (
    <div className="flex flex-col gap-0.5 w-full">
      <span
        className="text-center uppercase tracking-widest font-semibold"
        style={{ fontSize: 9, color: "rgba(255,255,255,0.55)" }}
      >
        {label}
      </span>
      {hasData ? (
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{
            height: barH,
            display: "flex",
            border: "1.5px solid rgba(255,255,255,0.14)",
            boxSizing: "border-box",
          }}
        >
          <div
            className="flex items-center justify-start pl-1.5 transition-all duration-700"
            style={{
              width: `${awayPct}%`,
              background: awayColor,
              minWidth: awayPct! > 0 ? 28 : 0,
              borderRadius: awayPct! >= 100 ? "9999px" : "9999px 0 0 9999px",
            }}
          >
            <span className="font-extrabold tabular-nums leading-none" style={{ fontSize: compact ? 10 : 11, color: awayTextColor }}>
              {awayPct}%
            </span>
          </div>
          <div style={{ width: 1.5, background: "rgba(255,255,255,0.3)", flexShrink: 0, alignSelf: "stretch" }} />
          <div
            className="flex items-center justify-end pr-1.5 transition-all duration-700"
            style={{
              width: `${homePct}%`,
              background: homeColor,
              minWidth: homePct! > 0 ? 28 : 0,
              borderRadius: homePct! >= 100 ? "9999px" : "0 9999px 9999px 0",
            }}
          >
            <span className="font-extrabold tabular-nums leading-none" style={{ fontSize: compact ? 10 : 11, color: homeTextColor }}>
              {homePct}%
            </span>
          </div>
        </div>
      ) : (
        <div
          className="w-full rounded-full flex items-center justify-center"
          style={{ height: barH, background: "rgba(255,255,255,0.05)" }}
        >
          <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", opacity: 0.35 }}>No data</span>
        </div>
      )}
    </div>
  );
}

// ── MarketColumn ──────────────────────────────────────────────────────────────
// One column in the horizontal layout: title + side labels + tickets bar + handle bar

interface MarketColumnProps {
  title: string;
  awayLabel: string;
  homeLabel: string;
  ticketsPct: number | null | undefined;   // away side %
  handlePct: number | null | undefined;    // away side %
  awayColor: string;
  homeColor: string;
  compact?: boolean;
}

function MarketColumn({ title, awayLabel, homeLabel, ticketsPct, handlePct, awayColor, homeColor, compact }: MarketColumnProps) {
  const hasTickets = ticketsPct != null;
  const hasHandle  = handlePct  != null;
  if (!hasTickets && !hasHandle) return null;

  const awayTickets = hasTickets ? ticketsPct! : null;
  const homeTickets = hasTickets ? 100 - ticketsPct! : null;
  const awayHandle  = hasHandle  ? handlePct!  : null;
  const homeHandle  = hasHandle  ? 100 - handlePct!  : null;

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0 px-2">
      {/* Market title */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span
          className="uppercase tracking-widest font-extrabold whitespace-nowrap"
          style={{ fontSize: compact ? 10 : 11, color: "#ffffff" }}
        >
          {title}
        </span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      {/* Side labels: away left, home right */}
      <div className="flex items-start justify-between gap-1">
        <span
          className="font-bold uppercase tracking-wide leading-tight"
          style={{ fontSize: compact ? 9 : 10, color: "#ffffff", maxWidth: "48%", wordBreak: "break-word" }}
        >
          {awayLabel}
        </span>
        <span
          className="font-bold uppercase tracking-wide leading-tight text-right"
          style={{ fontSize: compact ? 9 : 10, color: "#ffffff", maxWidth: "48%", wordBreak: "break-word" }}
        >
          {homeLabel}
        </span>
      </div>

      {/* Tickets bar */}
      <SplitBar
        label="Tickets"
        awayPct={awayTickets}
        homePct={homeTickets}
        awayColor={awayColor}
        homeColor={homeColor}
        compact={compact}
      />

      {/* Handle bar */}
      <SplitBar
        label="Handle"
        awayPct={awayHandle}
        homePct={homeHandle}
        awayColor={awayColor}
        homeColor={homeColor}
        compact={compact}
      />
    </div>
  );
}

// ── Vertical MarketSection (mobile fallback) ──────────────────────────────────
interface MarketSectionProps {
  title: string;
  awayLabel: string;
  homeLabel: string;
  moneyPct: number | null | undefined;
  betsPct: number | null | undefined;
  awayColor: string;
  homeColor: string;
}

function MarketSection({ title, awayLabel, homeLabel, moneyPct, betsPct, awayColor, homeColor }: MarketSectionProps) {
  const hasAny = moneyPct != null || betsPct != null;
  if (!hasAny) return null;

  const awayMoney = moneyPct != null ? moneyPct : null;
  const homeMoney = moneyPct != null ? 100 - moneyPct : null;
  const awayBets  = betsPct  != null ? betsPct  : null;
  const homeBets  = betsPct  != null ? 100 - betsPct  : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#ffffff' }}>{title}</span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div className="flex items-start justify-between gap-1 px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight" style={{ color: '#ffffff', maxWidth: "48%", wordBreak: "break-word" }}>{awayLabel}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-right" style={{ color: '#ffffff', maxWidth: "48%", wordBreak: "break-word" }}>{homeLabel}</span>
      </div>
      {betsPct != null && (
        <SplitBar label="Tickets" awayPct={awayBets} homePct={homeBets} awayColor={awayColor} homeColor={homeColor} />
      )}
      {moneyPct != null && betsPct != null && (
        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", borderRadius: 1 }} />
      )}
      {moneyPct != null && (
        <SplitBar label="Handle" awayPct={awayMoney} homePct={homeMoney} awayColor={awayColor} homeColor={homeColor} />
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BettingSplitsPanel({
  game, awayLabel, homeLabel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  awayNickname: _aN, homeNickname: _hN,
}: BettingSplitsPanelProps) {
  const sport = game.sport ?? "NCAAM";
  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam: game.awayTeam, homeTeam: game.homeTeam, sport },
    { staleTime: 1000 * 60 * 60 }
  );

  const homeColor = pickBarColor(
    colors?.home?.primaryColor,
    colors?.home?.secondaryColor,
    colors?.home?.tertiaryColor,
    FALLBACK_HOME
  );

  const awayColorCandidates: (string | null | undefined)[] = [
    colors?.away?.primaryColor,
    colors?.away?.secondaryColor,
    colors?.away?.tertiaryColor,
    FALLBACK_AWAY,
  ];
  const awayColor = (() => {
    for (const candidate of awayColorCandidates) {
      if (!candidate) continue;
      if (isUnusableBarColor(candidate)) continue;
      if (!areColorsTooSimilar(candidate, homeColor)) return candidate;
    }
    return FALLBACK_AWAY;
  })();

  // Book line values for labels
  const awaySpread = toNum(game.awayBookSpread);
  const homeSpread = toNum(game.homeBookSpread);
  const bookTotal  = toNum(game.bookTotal);

  const awaySpreadLabel = !isNaN(awaySpread) ? `${awayLabel} ${spreadSign(awaySpread)}` : awayLabel;
  const homeSpreadLabel = !isNaN(homeSpread) ? `${homeLabel} ${spreadSign(homeSpread)}` : homeLabel;
  const overLabel  = !isNaN(bookTotal) ? `Over ${bookTotal}`  : "Over";
  const underLabel = !isNaN(bookTotal) ? `Under ${bookTotal}` : "Under";
  const awayMlLabel = game.awayML ? `${awayLabel} ${game.awayML}` : awayLabel;
  const homeMlLabel = game.homeML ? `${homeLabel} ${game.homeML}` : homeLabel;

  const hasSpreadSplits = game.spreadAwayMoneyPct != null || game.spreadAwayBetsPct != null;
  const hasTotalSplits  = game.totalOverMoneyPct  != null || game.totalOverBetsPct  != null;
  const hasMlSplits     = (game.mlAwayMoneyPct != null || game.mlAwayBetsPct != null || game.awayML != null);
  const hasAnySplits    = hasSpreadSplits || hasTotalSplits || hasMlSplits;

  const header = (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
      <span className="text-[13px] font-black uppercase tracking-widest" style={{ color: '#d3d3d3', opacity: 0.85 }}>
        Betting Splits
      </span>
      <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
    </div>
  );

  if (!hasAnySplits) {
    return (
      <div className="flex flex-col gap-2 py-3">
        {header}
        <div className="w-full rounded-lg flex items-center justify-center" style={{ height: 40, background: "rgba(255,255,255,0.04)" }}>
          <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.35 }}>Not yet available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col py-2">
      {header}

      {/* ── DESKTOP / TABLET (≥ md): horizontal columns ── */}
      <div className="hidden md:flex items-stretch gap-0 w-full">
        {hasSpreadSplits && (
          <MarketColumn
            title="Spread"
            awayLabel={awaySpreadLabel}
            homeLabel={homeSpreadLabel}
            ticketsPct={game.spreadAwayBetsPct}
            handlePct={game.spreadAwayMoneyPct}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
        {hasSpreadSplits && (hasTotalSplits || hasMlSplits) && (
          <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch" }} />
        )}
        {hasTotalSplits && (
          <MarketColumn
            title="Total"
            awayLabel={overLabel}
            homeLabel={underLabel}
            ticketsPct={game.totalOverBetsPct}
            handlePct={game.totalOverMoneyPct}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
        {hasTotalSplits && hasMlSplits && (
          <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch" }} />
        )}
        {hasMlSplits && (
          <MarketColumn
            title="ML"
            awayLabel={awayMlLabel}
            homeLabel={homeMlLabel}
            ticketsPct={game.mlAwayBetsPct}
            handlePct={game.mlAwayMoneyPct}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
      </div>

      {/* ── MOBILE (< md): vertical stacked ── */}
      <div className="md:hidden flex flex-col gap-3">
        {hasSpreadSplits && (
          <MarketSection
            title="Spread"
            awayLabel={awaySpreadLabel}
            homeLabel={homeSpreadLabel}
            moneyPct={game.spreadAwayMoneyPct}
            betsPct={game.spreadAwayBetsPct}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
        {hasTotalSplits && (
          <MarketSection
            title="Total"
            awayLabel={overLabel}
            homeLabel={underLabel}
            moneyPct={game.totalOverMoneyPct}
            betsPct={game.totalOverBetsPct}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
        {hasMlSplits && (
          <MarketSection
            title="ML"
            awayLabel={awayMlLabel}
            homeLabel={homeMlLabel}
            moneyPct={game.mlAwayMoneyPct}
            betsPct={game.mlAwayBetsPct}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
      </div>
    </div>
  );
}

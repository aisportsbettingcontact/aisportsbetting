/*
 * BettingSplitsPanel
 *
 * Mobile  (< lg): 3 markets stacked vertically — ultra-compact rows
 *   Each row: [MARKET LABEL] [TICKETS bar] [HANDLE bar] — all inline
 *   Target: 3 rows together match the height of CompactScorePanel (~115px)
 *
 * Desktop (≥ lg): 3 markets side-by-side in equal columns (full layout)
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
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
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
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  try {
    const [r1, g1, b1] = toRgb(hexA);
    const [r2, g2, b2] = toRgb(hexB);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) < threshold;
  } catch { return false; }
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = toLinear(parseInt(full.slice(0, 2), 16) / 255);
  const g = toLinear(parseInt(full.slice(2, 4), 16) / 255);
  const b = toLinear(parseInt(full.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function bestTextColor(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return "#ffffff";
  const bgLum = relativeLuminance(hex);
  return (bgLum + 0.05) / 0.05 > 1.05 / (bgLum + 0.05) ? "#000000" : "#ffffff";
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

// ── LabeledBar — compact inline split bar with ABBR (LINE) - XX% labels ────────

interface LabeledBarProps {
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
  awayLineLabel: string;  // e.g. "LBS (-14.5)"
  homeLineLabel: string;  // e.g. "HAW (+14.5)"
  rowLabel: string;       // e.g. "Tickets" or "Money"
}

function LabeledBar({ awayPct, homePct, awayColor, homeColor, awayLineLabel, homeLineLabel, rowLabel }: LabeledBarProps) {
  const hasData = awayPct != null && homePct != null;
  const awayTextColor = bestTextColor(awayColor);
  const homeTextColor = bestTextColor(homeColor);

  if (!hasData) {
    return (
      <div className="w-full rounded-md flex items-center justify-center"
        style={{ height: 22, background: "rgba(255,255,255,0.05)", minWidth: 0 }}>
        <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", opacity: 0.35 }}>—</span>
      </div>
    );
  }

  const awayFullLabel = `${awayLineLabel} - ${awayPct}%`;
  const homeFullLabel = `${homeLineLabel} - ${homePct}%`;

  return (
    <div className="w-full flex flex-col gap-0.5">
      {/* Row label */}
      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1, paddingLeft: 2 }}>{rowLabel}</span>
      {/* Bar */}
      <div className="relative w-full rounded-md overflow-hidden flex"
        style={{ height: 20, border: "1px solid rgba(255,255,255,0.12)", boxSizing: "border-box", minWidth: 0 }}>
        <div className="flex items-center justify-start pl-1.5 transition-all duration-700 overflow-hidden"
          style={{ width: `${awayPct}%`, background: awayColor, minWidth: awayPct! > 0 ? 20 : 0, borderRadius: awayPct! >= 100 ? "4px" : "4px 0 0 4px", flexShrink: 0 }}>
          <span className="font-bold leading-none truncate" style={{ fontSize: 9, color: awayTextColor, whiteSpace: "nowrap" }}>{awayFullLabel}</span>
        </div>
        <div style={{ width: 1, background: "rgba(255,255,255,0.25)", flexShrink: 0, alignSelf: "stretch" }} />
        <div className="flex items-center justify-end pr-1.5 transition-all duration-700 overflow-hidden"
          style={{ width: `${homePct}%`, background: homeColor, minWidth: homePct! > 0 ? 20 : 0, borderRadius: homePct! >= 100 ? "4px" : "0 4px 4px 0", flexShrink: 0 }}>
          <span className="font-bold leading-none truncate" style={{ fontSize: 9, color: homeTextColor, whiteSpace: "nowrap", direction: "rtl" }}>{homeFullLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ── CompactMarketRow — one market row for mobile ──────────────────────────────
// Layout: [TITLE] [TICKETS bar] [HANDLE bar] stacked vertically

interface CompactMarketRowProps {
  title: string;
  ticketsPct: number | null | undefined;
  handlePct: number | null | undefined;
  awayColor: string;
  homeColor: string;
  awayLineLabel: string;  // e.g. "LBS (-14.5)"
  homeLineLabel: string;  // e.g. "HAW (+14.5)"
}

function CompactMarketRow({ title, ticketsPct, handlePct, awayColor, homeColor, awayLineLabel, homeLineLabel }: CompactMarketRowProps) {
  const hasTickets = ticketsPct != null;
  const hasHandle  = handlePct  != null;
  if (!hasTickets && !hasHandle) return null;

  const awayTickets = hasTickets ? ticketsPct! : null;
  const homeTickets = hasTickets ? 100 - ticketsPct! : null;
  const awayHandle  = hasHandle  ? handlePct!  : null;
  const homeHandle  = hasHandle  ? 100 - handlePct!  : null;

  const marketLabel = title === "Moneyline" ? "ML" : title === "Spread" ? "SPR" : "TOT";

  return (
    <div className="flex items-start gap-1.5 w-full" style={{ padding: "4px 8px" }}>
      {/* Market label */}
      <span
        className="uppercase font-extrabold tracking-widest flex-shrink-0 mt-4"
        style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", width: 26, letterSpacing: "0.1em", lineHeight: 1 }}
      >
        {marketLabel}
      </span>
      {/* Tickets + Handle bars stacked */}
      <div className="flex flex-col flex-1 min-w-0 gap-1.5">
        <LabeledBar
          awayPct={awayTickets} homePct={homeTickets}
          awayColor={awayColor} homeColor={homeColor}
          awayLineLabel={awayLineLabel} homeLineLabel={homeLineLabel}
          rowLabel="Tickets"
        />
        <LabeledBar
          awayPct={awayHandle} homePct={homeHandle}
          awayColor={awayColor} homeColor={homeColor}
          awayLineLabel={awayLineLabel} homeLineLabel={homeLineLabel}
          rowLabel="Money"
        />
      </div>
    </div>
  );
}

// ── SplitBar — full-size bar for desktop ──────────────────────────────────────

interface SplitBarProps {
  label: string;
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
}

function SplitBar({ label, awayPct, homePct, awayColor, homeColor }: SplitBarProps) {
  const hasData = awayPct != null && homePct != null;
  const awayTextColor = bestTextColor(awayColor);
  const homeTextColor = bestTextColor(homeColor);

  return (
    <div className="flex flex-col gap-1 w-full">
      <span className="text-center uppercase tracking-widest font-bold"
        style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em" }}>
        {label}
      </span>
      {hasData ? (
        <div className="relative w-full rounded-full overflow-hidden"
          style={{ height: 30, display: "flex", border: "1.5px solid rgba(255,255,255,0.15)", boxSizing: "border-box" }}>
          <div className="flex items-center justify-start pl-2 transition-all duration-700"
            style={{ width: `${awayPct}%`, background: awayColor, minWidth: awayPct! > 0 ? 36 : 0, borderRadius: awayPct! >= 100 ? "9999px" : "9999px 0 0 9999px" }}>
            <span className="font-extrabold tabular-nums leading-none" style={{ fontSize: 13, color: awayTextColor }}>{awayPct}%</span>
          </div>
          <div style={{ width: 1.5, background: "rgba(255,255,255,0.3)", flexShrink: 0, alignSelf: "stretch" }} />
          <div className="flex items-center justify-end pr-2 transition-all duration-700"
            style={{ width: `${homePct}%`, background: homeColor, minWidth: homePct! > 0 ? 36 : 0, borderRadius: homePct! >= 100 ? "9999px" : "0 9999px 9999px 0" }}>
            <span className="font-extrabold tabular-nums leading-none" style={{ fontSize: 13, color: homeTextColor }}>{homePct}%</span>
          </div>
        </div>
      ) : (
        <div className="w-full rounded-full flex items-center justify-center"
          style={{ height: 30, background: "rgba(255,255,255,0.05)" }}>
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", opacity: 0.35 }}>—</span>
        </div>
      )}
    </div>
  );
}

// ── MarketBlock — full-size column for desktop ────────────────────────────────

interface MarketBlockProps {
  title: string;
  awayLabel: string;
  homeLabel: string;
  totalValue?: number;
  ticketsPct: number | null | undefined;
  handlePct: number | null | undefined;
  awayColor: string;
  homeColor: string;
}

function MarketBlock({ title, awayLabel, homeLabel, totalValue, ticketsPct, handlePct, awayColor, homeColor }: MarketBlockProps) {
  const hasTickets = ticketsPct != null;
  const hasHandle  = handlePct  != null;
  if (!hasTickets && !hasHandle) return null;

  const awayTickets = hasTickets ? ticketsPct! : null;
  const homeTickets = hasTickets ? 100 - ticketsPct! : null;
  const awayHandle  = hasHandle  ? handlePct!  : null;
  const homeHandle  = hasHandle  ? 100 - handlePct!  : null;
  const isTotalMarket = totalValue !== undefined && !isNaN(totalValue);

  return (
    <div className="flex flex-col w-full" style={{ gap: 8, padding: "10px 12px" }}>
      <div className="flex items-center gap-2">
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
        <span className="uppercase tracking-widest font-extrabold whitespace-nowrap"
          style={{ fontSize: 11, color: "#ffffff", letterSpacing: "0.14em" }}>{title}</span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
      </div>
      {isTotalMarket ? (
        <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600, letterSpacing: "0.06em" }}>OVER</span>
          <span style={{ fontSize: 14, color: "#ffffff", fontWeight: 700 }}>{totalValue}</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600, letterSpacing: "0.06em" }}>UNDER</span>
        </div>
      ) : (
        <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2 }}>
          <span className="uppercase truncate" style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600, maxWidth: "48%", letterSpacing: "0.04em" }}>{awayLabel}</span>
          <span className="uppercase truncate text-right" style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600, maxWidth: "48%", letterSpacing: "0.04em" }}>{homeLabel}</span>
        </div>
      )}
      <SplitBar label="Tickets" awayPct={awayTickets} homePct={homeTickets} awayColor={awayColor} homeColor={homeColor} />
      <SplitBar label="Handle"  awayPct={awayHandle}  homePct={homeHandle}  awayColor={awayColor} homeColor={homeColor} />
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
    colors?.home?.primaryColor, colors?.home?.secondaryColor, colors?.home?.tertiaryColor, FALLBACK_HOME
  );

  const awayColorCandidates: (string | null | undefined)[] = [
    colors?.away?.primaryColor, colors?.away?.secondaryColor, colors?.away?.tertiaryColor, FALLBACK_AWAY,
  ];
  const awayColor = (() => {
    for (const candidate of awayColorCandidates) {
      if (!candidate) continue;
      if (isUnusableBarColor(candidate)) continue;
      if (!areColorsTooSimilar(candidate, homeColor)) return candidate;
    }
    return FALLBACK_AWAY;
  })();

  const awaySpread = toNum(game.awayBookSpread);
  const homeSpread = toNum(game.homeBookSpread);
  const bookTotal  = toNum(game.bookTotal);

  const awayAbbr = colors?.away?.abbrev ?? awayLabel;
  const homeAbbr = colors?.home?.abbrev ?? homeLabel;

  const awaySpreadLabel = !isNaN(awaySpread) ? `${awayAbbr} (${spreadSign(awaySpread)})` : awayAbbr;
  const homeSpreadLabel = !isNaN(homeSpread) ? `${homeAbbr} (${spreadSign(homeSpread)})` : homeAbbr;
  const awayMlLabel     = game.awayML ? `${awayAbbr} (${game.awayML})` : awayAbbr;
  const homeMlLabel     = game.homeML ? `${homeAbbr} (${game.homeML})` : homeAbbr;

  const hasSpreadSplits = game.spreadAwayMoneyPct != null || game.spreadAwayBetsPct != null;
  const hasTotalSplits  = game.totalOverMoneyPct  != null || game.totalOverBetsPct  != null;
  const hasMlSplits     = game.mlAwayMoneyPct != null || game.mlAwayBetsPct != null || game.awayML != null;
  const hasAnySplits    = hasSpreadSplits || hasTotalSplits || hasMlSplits;

  if (!hasAnySplits) {
    return (
      <div className="w-full flex items-center justify-center" style={{ minHeight: 80, padding: "16px 12px" }}>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", opacity: 0.4, letterSpacing: "0.06em" }}>
          Splits not yet available
        </span>
      </div>
    );
  }

  return (
    <>
      {/* ── Mobile (< lg): ultra-compact vertical rows ── */}
      <div className="flex flex-col w-full h-full justify-around lg:hidden" style={{ padding: "4px 0" }}>
        {hasSpreadSplits && (
          <>
            <CompactMarketRow
              title="Spread"
              ticketsPct={game.spreadAwayBetsPct}
              handlePct={game.spreadAwayMoneyPct}
              awayColor={awayColor}
              homeColor={homeColor}
              awayLineLabel={awaySpreadLabel}
              homeLineLabel={homeSpreadLabel}
            />
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 8px" }} />
          </>
        )}
        {hasTotalSplits && (
          <>
            <CompactMarketRow
              title="Total"
              ticketsPct={game.totalOverBetsPct}
              handlePct={game.totalOverMoneyPct}
              awayColor={awayColor}
              homeColor={homeColor}
              awayLineLabel={!isNaN(bookTotal) ? `OVER ${bookTotal}` : "OVER"}
              homeLineLabel={!isNaN(bookTotal) ? `UNDER ${bookTotal}` : "UNDER"}
            />
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 8px" }} />
          </>
        )}
        {hasMlSplits && (
          <CompactMarketRow
            title="Moneyline"
            ticketsPct={game.mlAwayBetsPct}
            handlePct={game.mlAwayMoneyPct}
            awayColor={awayColor}
            homeColor={homeColor}
            awayLineLabel={awayMlLabel}
            homeLineLabel={homeMlLabel}
          />
        )}
      </div>

      {/* ── Desktop (≥ lg): full-size horizontal 3-column layout ── */}
      <div className="hidden lg:flex items-stretch w-full">
        {hasSpreadSplits && (
          <>
            <div className="flex-1 min-w-0">
              <MarketBlock title="Spread" awayLabel={awaySpreadLabel} homeLabel={homeSpreadLabel}
                ticketsPct={game.spreadAwayBetsPct} handlePct={game.spreadAwayMoneyPct}
                awayColor={awayColor} homeColor={homeColor} />
            </div>
            {(hasTotalSplits || hasMlSplits) && (
              <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
            )}
          </>
        )}
        {hasTotalSplits && (
          <>
            <div className="flex-1 min-w-0">
              <MarketBlock title="Total" awayLabel="" homeLabel=""
                totalValue={isNaN(bookTotal) ? undefined : bookTotal}
                ticketsPct={game.totalOverBetsPct} handlePct={game.totalOverMoneyPct}
                awayColor={awayColor} homeColor={homeColor} />
            </div>
            {hasMlSplits && (
              <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
            )}
          </>
        )}
        {hasMlSplits && (
          <div className="flex-1 min-w-0">
            <MarketBlock title="Moneyline" awayLabel={awayMlLabel} homeLabel={homeMlLabel}
              ticketsPct={game.mlAwayBetsPct} handlePct={game.mlAwayMoneyPct}
              awayColor={awayColor} homeColor={homeColor} />
          </div>
        )}
      </div>
    </>
  );
}

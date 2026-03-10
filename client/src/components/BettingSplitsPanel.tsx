/*
 * BettingSplitsPanel
 *
 * Mobile  (< lg): 3 markets stacked vertically — ultra-compact rows
 *   Each row: [MARKET LABEL] [TICKETS bar] [HANDLE bar] — all inline
 *   Target: 3 rows together match the height of CompactScorePanel (~115px)
 *
 * Desktop (≥ lg): 3 markets side-by-side in equal columns (full layout)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

type MobileMarket = "spread" | "total" | "ml";

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
      <div className="w-full flex flex-col gap-0.5">
        {/* Header row */}
        <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontWeight: 700, letterSpacing: "0.04em" }}>{awayLineLabel}</span>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{rowLabel}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontWeight: 700, letterSpacing: "0.04em" }}>{homeLineLabel}</span>
        </div>
        {/* Empty bar */}
        <div className="w-full rounded-md flex items-center justify-center"
          style={{ height: 20, background: "rgba(255,255,255,0.05)", minWidth: 0 }}>
          <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", opacity: 0.35 }}>—</span>
        </div>
      </div>
    );
  }

  const LABEL_THRESHOLD = 15;
  const awayShowInside = (awayPct ?? 0) >= LABEL_THRESHOLD;
  const homeShowInside = (homePct ?? 0) >= LABEL_THRESHOLD;

  return (
    <div className="w-full flex flex-col gap-0.5">
      {/* Header row: AWAY_LABEL  [rowLabel]  HOME_LABEL */}
      <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2 }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontWeight: 700, letterSpacing: "0.03em" }}>{awayLineLabel}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.85)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em" }}>{rowLabel}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontWeight: 700, letterSpacing: "0.03em" }}>{homeLineLabel}</span>
      </div>
      {/* Bar — overflow:hidden on container, % labels inside or outside based on threshold */}
      <div className="relative w-full rounded-md"
        style={{ height: 20, minWidth: 0 }}>
        <div className="absolute inset-0 rounded-md overflow-hidden flex"
          style={{ border: "1px solid rgba(255,255,255,0.12)", boxSizing: "border-box" }}>
          {(awayPct ?? 0) > 0 && (
            <div className="flex items-center justify-start px-1.5 transition-all duration-700 flex-shrink-0"
              style={{ width: `${awayPct}%`, background: awayColor, borderRadius: (awayPct ?? 0) >= 100 ? "4px" : "4px 0 0 4px" }}>
              {awayShowInside && (
                <span className="font-extrabold leading-none whitespace-nowrap" style={{ fontSize: 10, color: '#ffffff', letterSpacing: '0.04em', textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)' }}>{awayPct}%</span>
              )}
            </div>
          )}
          {(awayPct ?? 0) > 0 && (homePct ?? 0) > 0 && (
            <div style={{ width: 1, background: "rgba(255,255,255,0.25)", flexShrink: 0, alignSelf: "stretch" }} />
          )}
          {(homePct ?? 0) > 0 && (
            <div className="flex items-center justify-end px-1.5 transition-all duration-700 flex-shrink-0"
              style={{ width: `${homePct}%`, background: homeColor, borderRadius: (homePct ?? 0) >= 100 ? "4px" : "0 4px 4px 0" }}>
              {homeShowInside && (
                <span className="font-extrabold leading-none whitespace-nowrap" style={{ fontSize: 10, color: '#ffffff', letterSpacing: '0.04em', textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)' }}>{homePct}%</span>
              )}
            </div>
          )}
        </div>
        {/* Outside labels for narrow segments — always white with shadow for visibility on dark bg */}
        {!awayShowInside && (awayPct ?? 0) > 0 && (
          <span
            className="absolute font-extrabold leading-none whitespace-nowrap"
            style={{
              fontSize: 9,
              color: "#ffffff",
              left: `calc(${awayPct}% / 2)`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              textShadow: "0 0 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9), 1px 1px 2px rgba(0,0,0,1)",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >{awayPct}%</span>
        )}
        {!homeShowInside && (homePct ?? 0) > 0 && (
          <span
            className="absolute font-extrabold leading-none whitespace-nowrap"
            style={{
              fontSize: 9,
              color: "#ffffff",
              right: `calc(${homePct}% / 2)`,
              top: "50%",
              transform: "translate(50%, -50%)",
              textShadow: "0 0 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9), 1px 1px 2px rgba(0,0,0,1)",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >{homePct}%</span>
        )}
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
    <div className="flex flex-col w-full" style={{ padding: "2px 8px 4px 8px", gap: 6 }}>
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

  // Determine if a segment is too narrow to show the % label inside
  // Threshold: if the segment is < 15% wide, show label outside (absolute positioned)
  const LABEL_THRESHOLD = 15;
  const awayShowInside = (awayPct ?? 0) >= LABEL_THRESHOLD;
  const homeShowInside = (homePct ?? 0) >= LABEL_THRESHOLD;

  return (
    <div className="flex flex-col gap-1 w-full">
      <span className="text-center uppercase tracking-widest font-bold"
        style={{ fontSize: 'clamp(9px, 0.75vw, 12px)', color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em" }}>
        {label}
      </span>
      {hasData ? (
        <div className="relative w-full"
          style={{ height: 'clamp(24px, 2.5vw, 40px)' }}>
          {/* Pill container — overflow:hidden clips segments cleanly */}
          <div className="absolute inset-0 rounded-full overflow-hidden flex"
            style={{ border: "1.5px solid rgba(255,255,255,0.15)", boxSizing: "border-box" }}>
            {(awayPct ?? 0) > 0 && (
              <div className="flex items-center justify-start pl-2 transition-all duration-700 flex-shrink-0"
                style={{
                  width: `${awayPct}%`,
                  background: awayColor,
                  borderRadius: (awayPct ?? 0) >= 100 ? "9999px" : "9999px 0 0 9999px",
                }}>
                {awayShowInside && (
                  <span className="font-extrabold tabular-nums leading-none whitespace-nowrap" style={{ fontSize: 'clamp(11px, 1vw, 16px)', color: '#ffffff', letterSpacing: '0.04em', textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)' }}>{awayPct}%</span>
                )}
              </div>
            )}
            {(awayPct ?? 0) > 0 && (homePct ?? 0) > 0 && (
              <div style={{ width: 1.5, background: "rgba(255,255,255,0.3)", flexShrink: 0, alignSelf: "stretch" }} />
            )}
            {(homePct ?? 0) > 0 && (
              <div className="flex items-center justify-end pr-2 transition-all duration-700 flex-shrink-0"
                style={{
                  width: `${homePct}%`,
                  background: homeColor,
                  borderRadius: (homePct ?? 0) >= 100 ? "9999px" : "0 9999px 9999px 0",
                }}>
                {homeShowInside && (
                  <span className="font-extrabold tabular-nums leading-none whitespace-nowrap" style={{ fontSize: 'clamp(11px, 1vw, 16px)', color: '#ffffff', letterSpacing: '0.04em', textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)' }}>{homePct}%</span>
                )}
              </div>
            )}
          </div>
          {/* Outside labels for narrow segments — always white with shadow for visibility on dark bg */}
          {!awayShowInside && (awayPct ?? 0) > 0 && (
            <span
              className="absolute font-extrabold tabular-nums leading-none whitespace-nowrap"
              style={{
                fontSize: 'clamp(9px, 0.8vw, 13px)',
                color: "#ffffff",
                left: `calc(${awayPct}% / 2)`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                textShadow: "0 0 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9), 1px 1px 2px rgba(0,0,0,1)",
                zIndex: 2,
                pointerEvents: "none",
              }}
            >{awayPct}%</span>
          )}
          {!homeShowInside && (homePct ?? 0) > 0 && (
            <span
              className="absolute font-extrabold tabular-nums leading-none whitespace-nowrap"
              style={{
                fontSize: 'clamp(9px, 0.8vw, 13px)',
                color: "#ffffff",
                right: `calc(${homePct}% / 2)`,
                top: "50%",
                transform: "translate(50%, -50%)",
                textShadow: "0 0 6px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9), 1px 1px 2px rgba(0,0,0,1)",
                zIndex: 2,
                pointerEvents: "none",
              }}
            >{homePct}%</span>
          )}
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
  // Never return null — always render the column so all 3 fill the full width

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
          style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: "#ffffff", letterSpacing: "0.14em" }}>{title}</span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
      </div>
      {isTotalMarket ? (
        <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2 }}>
          <span style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: "rgba(255,255,255,0.8)", fontWeight: 600, letterSpacing: "0.06em" }}>OVER</span>
          <span style={{ fontSize: 'clamp(12px, 1.1vw, 18px)', color: "#ffffff", fontWeight: 700 }}>{totalValue}</span>
          <span style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: "rgba(255,255,255,0.8)", fontWeight: 600, letterSpacing: "0.06em" }}>UNDER</span>
        </div>
      ) : (
        <div className="flex items-center justify-between" style={{ paddingLeft: 2, paddingRight: 2 }}>
          <span className="uppercase truncate" style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: "rgba(255,255,255,0.8)", fontWeight: 600, maxWidth: "48%", letterSpacing: "0.04em" }}>{awayLabel}</span>
          <span className="uppercase truncate text-right" style={{ fontSize: 'clamp(10px, 0.9vw, 14px)', color: "rgba(255,255,255,0.8)", fontWeight: 600, maxWidth: "48%", letterSpacing: "0.04em" }}>{homeLabel}</span>
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
  const [mobileMarket, setMobileMarket] = useState<MobileMarket>("spread");
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

  // Determine which markets are available; default to first available
  const availableMarkets: MobileMarket[] = [
    ...(hasSpreadSplits ? ["spread" as const] : []),
    ...(hasTotalSplits  ? ["total"  as const] : []),
    ...(hasMlSplits     ? ["ml"     as const] : []),
  ];
  // Resolve active market — fall back to first available if current isn't available
  const activeMarket: MobileMarket = availableMarkets.includes(mobileMarket)
    ? mobileMarket
    : (availableMarkets[0] ?? "spread");

  return (
    <>
      {/* ── Mobile (< lg): toggle + single active market ── */}
      <div className="flex flex-col w-full h-full lg:hidden" style={{ padding: "4px 0" }}>
        {/* 3-way toggle */}
        <div className="flex items-center" style={{ padding: "0 8px 4px 8px", gap: 4 }}>
          {(["spread", "total", "ml"] as MobileMarket[]).map((m) => {
            const label = m === "spread" ? "SPREAD" : m === "total" ? "TOTAL" : "MONEYLINE";
            const isActive = m === activeMarket;
            const isAvailable = availableMarkets.includes(m);
            return (
              <button
                key={m}
                onClick={() => setMobileMarket(m)}
                disabled={!isAvailable}
                style={{
                  flex: 1,
                  padding: "3px 0",
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  borderRadius: 4,
                  border: isActive ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.1)",
                  background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                  color: isActive ? "#ffffff" : isAvailable ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)",
                  cursor: isAvailable ? "pointer" : "default",
                  transition: "all 0.15s ease",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {/* Active market bars */}
        {activeMarket === "spread" && hasSpreadSplits && (
          <CompactMarketRow
            title="Spread"
            ticketsPct={game.spreadAwayBetsPct}
            handlePct={game.spreadAwayMoneyPct}
            awayColor={awayColor}
            homeColor={homeColor}
            awayLineLabel={awaySpreadLabel}
            homeLineLabel={homeSpreadLabel}
          />
        )}
        {activeMarket === "total" && hasTotalSplits && (
          <CompactMarketRow
            title="Total"
            ticketsPct={game.totalOverBetsPct}
            handlePct={game.totalOverMoneyPct}
            awayColor={awayColor}
            homeColor={homeColor}
            awayLineLabel={!isNaN(bookTotal) ? `OVER ${bookTotal}` : "OVER"}
            homeLineLabel={!isNaN(bookTotal) ? `UNDER ${bookTotal}` : "UNDER"}
          />
        )}
        {activeMarket === "ml" && hasMlSplits && (
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
      {/* Always render all 3 columns so the panel fills 100% width with no whitespace */}
      <div className="hidden lg:flex items-stretch w-full">
        {/* Spread column — always rendered */}
        <div className="flex-1 min-w-0">
          <MarketBlock title="Spread" awayLabel={awaySpreadLabel} homeLabel={homeSpreadLabel}
            ticketsPct={game.spreadAwayBetsPct} handlePct={game.spreadAwayMoneyPct}
            awayColor={awayColor} homeColor={homeColor} />
        </div>
        <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
        {/* Total column — always rendered */}
        <div className="flex-1 min-w-0">
          <MarketBlock title="Total" awayLabel="" homeLabel=""
            totalValue={isNaN(bookTotal) ? undefined : bookTotal}
            ticketsPct={game.totalOverBetsPct} handlePct={game.totalOverMoneyPct}
            awayColor={awayColor} homeColor={homeColor} />
        </div>
        <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
        {/* Moneyline column — always rendered */}
        <div className="flex-1 min-w-0">
          <MarketBlock title="Moneyline" awayLabel={awayMlLabel} homeLabel={homeMlLabel}
            ticketsPct={game.mlAwayBetsPct} handlePct={game.mlAwayMoneyPct}
            awayColor={awayColor} homeColor={homeColor} />
        </div>
      </div>
    </>
  );
}

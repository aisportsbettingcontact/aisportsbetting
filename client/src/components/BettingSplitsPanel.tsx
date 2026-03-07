/**
 * BettingSplitsPanel
 *
 * Always-visible betting splits display.
 * - "BETTING SPLITS" centered as h1
 * - "SPREAD" centered as h2, with "{Away Team} {Away Spread}" left and "{Home Team} {Home Spread}" right
 * - "TOTAL" centered as h2, with "OVER {Total}" left and "UNDER {Total}" right
 * - Two-color full-width bars (away color left, home color right)
 * - Sections: Spread + Total for NCAAM; Spread + Total + Moneyline for NBA
 * - Team colors fetched from DB via tRPC
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

/**
 * Returns true if a hex color is black or very dark (perceived luminance < 8%)
 * OR white / very light (luminance > 90%). Bars should never be black or white.
 */
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
  return lum < 0.08 || lum > 0.90; // too dark (black) OR too light (white)
}

// Keep backward-compat alias used in pickBarColor
const isTooDark = isUnusableBarColor;

/**
 * Compute perceptual color distance between two hex colors using
 * a simplified Euclidean distance in sRGB space (0–441 range).
 * Returns true if the colors are too similar to distinguish on screen.
 */
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

/**
 * Compute relative luminance of a hex color per WCAG 2.1.
 */
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

/**
 * Returns the text color (#000 or #fff) that maximises WCAG contrast ratio
 * against the given background hex color. Falls back to white if hex is invalid.
 */
function bestTextColor(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return "#ffffff";
  const bgLum = relativeLuminance(hex);
  // WCAG contrast ratio: (L1+0.05)/(L2+0.05) where L1 >= L2
  const contrastWithWhite = (1 + 0.05) / (bgLum + 0.05);
  const contrastWithBlack = (bgLum + 0.05) / (0 + 0.05);
  return contrastWithBlack > contrastWithWhite ? "#000000" : "#ffffff";
}

/**
 * Pick the best bar color: primary → secondary → tertiary → fallback.
 * Skips any color that is too dark (black/near-black).
 */
function pickBarColor(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  tertiary: string | null | undefined,
  fallback: string
): string {
  for (const c of [primary, secondary, tertiary]) {
    if (c && !isTooDark(c)) return c;
  }
  return fallback;
}

// ── SplitBar ─────────────────────────────────────────────────────────────────
// A single two-color bar with a centered label above it

interface SplitBarProps {
  label: string;
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
}

function SplitBar({ label, awayPct, homePct, awayColor, homeColor }: SplitBarProps) {
  const hasData = awayPct != null && homePct != null;
  // Adaptive text: use WCAG contrast ratio to pick the most readable text color
  const awayTextColor = bestTextColor(awayColor);
  const homeTextColor = bestTextColor(homeColor);
  return (
    <div className="flex flex-col gap-0.5">
      {/* Centered label — white */}
      <div className="flex items-center justify-center">
        <span
          className="text-[9px] uppercase tracking-widest font-semibold"
          style={{ color: "#ffffff", opacity: 0.75 }}
        >
          {label}
        </span>
      </div>
      {/* Two-color bar with border outline */}
      {hasData ? (
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{
            height: 28,
            display: "flex",
            border: "1.5px solid rgba(255,255,255,0.18)",
            boxSizing: "border-box",
          }}
        >
          <div
            className="flex items-center justify-start pl-2 transition-all duration-700"
            style={{
              width: `${awayPct}%`,
              background: awayColor,
              minWidth: awayPct! > 0 ? 32 : 0,
              borderRadius: awayPct! >= 100 ? "9999px" : "9999px 0 0 9999px",
            }}
          >
            <span className="text-[12px] font-extrabold tabular-nums leading-none drop-shadow-sm" style={{ color: awayTextColor }}>
              {awayPct}%
            </span>
          </div>
          {/* Split divider line between the two halves */}
          <div
            style={{
              width: 1.5,
              background: "rgba(255,255,255,0.35)",
              flexShrink: 0,
              alignSelf: "stretch",
            }}
          />
          <div
            className="flex items-center justify-end pr-2 transition-all duration-700"
            style={{
              width: `${homePct}%`,
              background: homeColor,
              minWidth: homePct! > 0 ? 32 : 0,
              borderRadius: homePct! >= 100 ? "9999px" : "0 9999px 9999px 0",
            }}
          >
            <span className="text-[12px] font-extrabold tabular-nums leading-none drop-shadow-sm" style={{ color: homeTextColor }}>
              {homePct}%
            </span>
          </div>
        </div>
      ) : (
        <div
          className="w-full rounded-full flex items-center justify-center"
          style={{ height: 28, background: "rgba(255,255,255,0.06)" }}
        >
          <span className="text-[9px]" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.4 }}>
            No data
          </span>
        </div>
      )}
    </div>
  );
}

// ── MarketSection ─────────────────────────────────────────────────────────────

interface MarketSectionProps {
  title: string;       // "SPREAD" | "TOTAL" | "MONEYLINE"
  awayLabel: string;   // e.g. "Arkansas +2.5" or "Over 159.5"
  homeLabel: string;   // e.g. "Missouri -2.5" or "Under 159.5"
  moneyPct: number | null | undefined;
  betsPct: number | null | undefined;
  awayColor: string;
  homeColor: string;
}

function MarketSection({
  title, awayLabel, homeLabel, moneyPct, betsPct, awayColor, homeColor,
}: MarketSectionProps) {
  const hasAny = moneyPct != null || betsPct != null;
  if (!hasAny) return null;

  const awayMoney = moneyPct != null ? moneyPct : null;
  const homeMoney = moneyPct != null ? 100 - moneyPct : null;
  const awayBets  = betsPct  != null ? betsPct  : null;
  const homeBets  = betsPct  != null ? 100 - betsPct  : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Centered h2-style section title with flanking rules */}
      <div className="flex items-center gap-2">
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span
          className="text-[13px] font-extrabold uppercase tracking-widest"
          style={{ color: '#d3d3d3', opacity: 0.9 }}
        >
          {title}
        </span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      {/* Away label left, Home label right — colored to match their bar side */}
      <div className="flex items-start justify-between gap-1 px-0.5">
        <span
          className="text-[11px] font-bold uppercase tracking-wide leading-tight"
          style={{ color: '#ffffff', maxWidth: "48%", wordBreak: "break-word" }}
        >
          {awayLabel}
        </span>
        <span
          className="text-[11px] font-bold uppercase tracking-wide leading-tight text-right"
          style={{ color: '#ffffff', maxWidth: "48%", wordBreak: "break-word" }}
        >
          {homeLabel}
        </span>
      </div>

      {/* Ticket % bar — TOP */}
      {betsPct != null && (
        <SplitBar
          label="Ticket %"
          awayPct={awayBets}
          homePct={homeBets}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      )}

      {/* Thin divider between the two bars */}
      {moneyPct != null && betsPct != null && (
        <div style={{ height: 1, background: "rgba(255,255,255,0.10)", borderRadius: 1 }} />
      )}

      {/* Money % bar — BOTTOM */}
      {moneyPct != null && (
        <SplitBar
          label="Money %"
          awayPct={awayMoney}
          homePct={homeMoney}
          awayColor={awayColor}
          homeColor={homeColor}
        />
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
  const isNba = sport === "NBA";

  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam: game.awayTeam, homeTeam: game.homeTeam, sport },
    { staleTime: 1000 * 60 * 60 }
  );

  // Home team keeps primary (unless unusable)
  const homeColor = pickBarColor(
    colors?.home?.primaryColor,
    colors?.home?.secondaryColor,
    colors?.home?.tertiaryColor,
    FALLBACK_HOME
  );

  // Away team: start with primary, then cycle secondary/tertiary/fallback
  // until the color is both usable AND visually distinct from homeColor
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
    // If all candidates are too similar, just use the fallback regardless
    return FALLBACK_AWAY;
  })();

  // Live book lines
  const awaySpread = toNum(game.awayBookSpread);
  const homeSpread = toNum(game.homeBookSpread);
  const bookTotal  = toNum(game.bookTotal);

  // Section side labels
  const awaySpreadLabel = !isNaN(awaySpread)
    ? `${awayLabel} ${spreadSign(awaySpread)}`
    : awayLabel;
  const homeSpreadLabel = !isNaN(homeSpread)
    ? `${homeLabel} ${spreadSign(homeSpread)}`
    : homeLabel;
  const overLabel  = !isNaN(bookTotal) ? `Over ${bookTotal}`  : "Over";
  const underLabel = !isNaN(bookTotal) ? `Under ${bookTotal}` : "Under";
  const awayMlLabel = game.awayML ? `${awayLabel} ${game.awayML}` : awayLabel;
  const homeMlLabel = game.homeML ? `${homeLabel} ${game.homeML}` : homeLabel;

  const hasSpreadSplits = game.spreadAwayMoneyPct != null || game.spreadAwayBetsPct != null;
  const hasTotalSplits  = game.totalOverMoneyPct  != null || game.totalOverBetsPct  != null;
  const hasMlSplits     = isNba && (game.mlAwayMoneyPct != null || game.mlAwayBetsPct != null);
  const hasAnySplits    = hasSpreadSplits || hasTotalSplits || hasMlSplits;

  if (!hasAnySplits) {
    return (
      <div className="flex flex-col gap-2 px-1 py-3">
        {/* Centered h1-style header even when no data */}
        <div className="flex items-center gap-2">
          <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
          <span
            className="text-[15px] font-black uppercase tracking-widest"
            style={{ color: '#d3d3d3', opacity: 0.7 }}
          >
            Betting Splits
          </span>
          <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
        </div>
        <div
          className="w-full rounded-lg flex items-center justify-center"
          style={{ height: 40, background: "rgba(255,255,255,0.04)" }}
        >
          <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.35 }}>
            Not yet available
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-1 py-1">
      {/* ── Centered h1-style "BETTING SPLITS" header ── */}
      <div className="flex items-center gap-2">
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
        <span
          className="text-[15px] font-black uppercase tracking-widest"
          style={{ color: '#d3d3d3', opacity: 0.85 }}
        >
          Betting Splits
        </span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
      </div>

      {/* ── Spread ── */}
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

      {/* ── Total ── */}
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

      {/* ── Moneyline (NBA only) ── */}
      {hasMlSplits && (
        <MarketSection
          title="Moneyline"
          awayLabel={awayMlLabel}
          homeLabel={homeMlLabel}
          moneyPct={game.mlAwayMoneyPct}
          betsPct={game.mlAwayBetsPct}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      )}
    </div>
  );
}

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
  return (
    <div className="flex flex-col gap-0.5">
      {/* Centered label */}
      <div className="flex items-center justify-center">
        <span
          className="text-[9px] uppercase tracking-widest"
          style={{ color: "hsl(var(--muted-foreground))", opacity: 0.5 }}
        >
          {label}
        </span>
      </div>
      {/* Two-color bar */}
      {hasData ? (
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{ height: 28, display: "flex" }}
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
            <span className="text-[12px] font-extrabold tabular-nums text-white leading-none drop-shadow-sm">
              {awayPct}%
            </span>
          </div>
          <div
            className="flex items-center justify-end pr-2 transition-all duration-700"
            style={{
              width: `${homePct}%`,
              background: homeColor,
              minWidth: homePct! > 0 ? 32 : 0,
              borderRadius: homePct! >= 100 ? "9999px" : "0 9999px 9999px 0",
            }}
          >
            <span className="text-[12px] font-extrabold tabular-nums text-white leading-none drop-shadow-sm">
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
          style={{ color: "hsl(var(--foreground))", opacity: 0.9 }}
        >
          {title}
        </span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      {/* Away label left, Home label right — colored to match their bar side */}
      <div className="flex items-start justify-between gap-1 px-0.5">
        <span
          className="text-[11px] font-bold uppercase tracking-wide leading-tight"
          style={{ color: awayColor, maxWidth: "48%", wordBreak: "break-word" }}
        >
          {awayLabel}
        </span>
        <span
          className="text-[11px] font-bold uppercase tracking-wide leading-tight text-right"
          style={{ color: homeColor, maxWidth: "48%", wordBreak: "break-word" }}
        >
          {homeLabel}
        </span>
      </div>

      {/* Money % bar */}
      {moneyPct != null && (
        <SplitBar
          label="Money %"
          awayPct={awayMoney}
          homePct={homeMoney}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      )}

      {/* Bets % bar */}
      {betsPct != null && (
        <SplitBar
          label="Bet %"
          awayPct={awayBets}
          homePct={homeBets}
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

  const awayColor = colors?.away?.primaryColor ?? FALLBACK_AWAY;
  const homeColor = colors?.home?.primaryColor ?? FALLBACK_HOME;

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
            style={{ color: "hsl(var(--foreground))", opacity: 0.7 }}
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
          style={{ color: "hsl(var(--foreground))", opacity: 0.85 }}
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

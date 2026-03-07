/**
 * BettingSplitsPanel
 *
 * Always-visible betting splits display matching the reference DraftKings/Action Network style.
 * - Two-color full-width bars (away color left, home color right)
 * - Team abbreviations above each bar
 * - Sections: Spread + Total for NCAAM; Spread + Total + Moneyline for NBA
 * - Team colors fetched from DB via tRPC — no hardcoded colors
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
  awayLabel: string;   // e.g. "Arkansas" or "Orlando"
  homeLabel: string;   // e.g. "Missouri" or "Timberwolves"
  awayNickname?: string; // e.g. "Razorbacks" or "Magic"
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

/** Shorten a team name to an abbreviation (up to 4 chars) */
function abbrev(name: string): string {
  // Common abbreviations
  const ABBREVS: Record<string, string> = {
    "Michigan": "MICH", "Illinois": "ILL", "Arkansas": "ARK", "Missouri": "MIZZ",
    "Kentucky": "UK", "Tennessee": "TENN", "Alabama": "ALA", "Auburn": "AUB",
    "Florida": "FLA", "Georgia": "UGA", "LSU": "LSU", "Mississippi": "MISS",
    "Mississippi State": "MSST", "South Carolina": "SC", "Vanderbilt": "VAN",
    "Texas A&M": "TAMU", "Oklahoma": "OU", "Texas": "TEX", "Kansas": "KU",
    "Duke": "DUKE", "North Carolina": "UNC", "Virginia": "UVA", "Louisville": "LOU",
    "Syracuse": "SYR", "Pittsburgh": "PITT", "Notre Dame": "ND", "Marquette": "MU",
    "Villanova": "NOVA", "Georgetown": "GTOWN", "Connecticut": "UCONN",
    "Providence": "PROV", "Creighton": "CRE", "Xavier": "XAV", "Butler": "BUT",
    "DePaul": "DEP", "Seton Hall": "SHU", "St. John's": "STJ",
    "UCLA": "UCLA", "USC": "USC", "Arizona": "ARIZ", "Oregon": "ORE",
    "Washington": "WASH", "Stanford": "STAN", "California": "CAL",
    "Utah": "UTAH", "Colorado": "COLO", "Arizona State": "ASU",
    "Ohio State": "OSU", "Michigan State": "MSU", "Penn State": "PSU",
    "Indiana": "IND", "Iowa": "IOWA", "Minnesota": "MINN", "Wisconsin": "WIS",
    "Northwestern": "NW", "Nebraska": "NEB", "Rutgers": "RUT", "Maryland": "MD",
    "Purdue": "PUR", "Illinois-Chicago": "UIC",
    // NBA cities (use distinct keys where they differ from college)
    "Boston": "BOS", "Brooklyn": "BKN", "New York": "NYK", "Philadelphia": "PHI",
    "Toronto": "TOR", "Chicago": "CHI", "Cleveland": "CLE", "Detroit": "DET",
    "Milwaukee": "MIL", "Atlanta": "ATL", "Charlotte": "CHA",
    "Miami": "MIA", "Orlando": "ORL",
    "Denver": "DEN", "Oklahoma City": "OKC", "Portland": "POR",
    "Golden State": "GSW", "LA": "LAC", "Los Angeles": "LAL",
    "Phoenix": "PHX", "Sacramento": "SAC", "Dallas": "DAL", "Houston": "HOU",
    "Memphis": "MEM", "New Orleans": "NOP", "San Antonio": "SAS",
  };
  if (ABBREVS[name]) return ABBREVS[name];
  // Auto-generate: take first 4 chars of each word, join, uppercase, max 4 chars
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words.map(w => w[0]).join("").toUpperCase().slice(0, 4);
}

const FALLBACK_AWAY = "#1a4a8a";
const FALLBACK_HOME = "#c84b0c";

// ── SplitRow ─────────────────────────────────────────────────────────────────

interface SplitRowProps {
  label: string;           // "Bet %" or "Money %"
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
  awayAbbrev: string;
  homeAbbrev: string;
}

function SplitRow({ label, awayPct, homePct, awayColor, homeColor, awayAbbrev, homeAbbrev }: SplitRowProps) {
  const hasData = awayPct != null && homePct != null;

  return (
    <div className="flex flex-col gap-0.5">
      {/* Labels row: AWAY | label | HOME */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
          {awayAbbrev}
        </span>
        <span className="text-[9px] uppercase tracking-widest" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.5 }}>
          {label}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
          {homeAbbrev}
        </span>
      </div>

      {/* Two-color bar */}
      {hasData ? (
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{ height: 28, display: "flex" }}
        >
          {/* Away side */}
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
          {/* Home side */}
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
  title: string;
  subtitle?: string;  // e.g. "ARK +2.5 / MIZZ -2.5"
  moneyPct: number | null | undefined;
  betsPct: number | null | undefined;
  awayColor: string;
  homeColor: string;
  awayAbbrev: string;
  homeAbbrev: string;
}

function MarketSection({ title, subtitle, moneyPct, betsPct, awayColor, homeColor, awayAbbrev, homeAbbrev }: MarketSectionProps) {
  const hasAny = moneyPct != null || betsPct != null;
  if (!hasAny) return null;

  const awayMoney = moneyPct != null ? moneyPct : null;
  const homeMoney = moneyPct != null ? 100 - moneyPct : null;
  const awayBets = betsPct != null ? betsPct : null;
  const homeBets = betsPct != null ? 100 - betsPct : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Section header */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "hsl(var(--foreground))", opacity: 0.85 }}>
          {title}
        </span>
        {subtitle && (
          <span className="text-[9px]" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.5 }}>
            {subtitle}
          </span>
        )}
      </div>

      {/* Money % row */}
      {moneyPct != null && (
        <SplitRow
          label="Money %"
          awayPct={awayMoney}
          homePct={homeMoney}
          awayColor={awayColor}
          homeColor={homeColor}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}

      {/* Bets % row */}
      {betsPct != null && (
        <SplitRow
          label="Bet %"
          awayPct={awayBets}
          homePct={homeBets}
          awayColor={awayColor}
          homeColor={homeColor}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BettingSplitsPanel({ game, awayLabel, homeLabel, awayNickname, homeNickname }: BettingSplitsPanelProps) {
  const sport = game.sport ?? "NCAAM";
  const isNba = sport === "NBA";

  // Fetch team colors from the database
  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam: game.awayTeam, homeTeam: game.homeTeam, sport },
    { staleTime: 1000 * 60 * 60 }
  );

  const awayColor = colors?.away?.primaryColor ?? FALLBACK_AWAY;
  const homeColor = colors?.home?.primaryColor ?? FALLBACK_HOME;

  // Abbreviations
  const awayAbbr = abbrev(awayLabel);
  const homeAbbr = abbrev(homeLabel);

  // Spread values for subtitles
  const awaySpread = toNum(game.awayBookSpread);
  const homeSpread = toNum(game.homeBookSpread);
  const bookTotal = toNum(game.bookTotal);
  const spreadSubtitle = (!isNaN(awaySpread) && !isNaN(homeSpread))
    ? `${awayAbbr} ${spreadSign(awaySpread)} / ${homeAbbr} ${spreadSign(homeSpread)}`
    : undefined;
  const totalSubtitle = !isNaN(bookTotal) ? `O/U ${bookTotal}` : undefined;
  const mlSubtitle = (game.awayML && game.homeML)
    ? `${awayAbbr} ${game.awayML} / ${homeAbbr} ${game.homeML}`
    : undefined;

  const hasSpreadSplits = game.spreadAwayMoneyPct != null || game.spreadAwayBetsPct != null;
  const hasTotalSplits = game.totalOverMoneyPct != null || game.totalOverBetsPct != null;
  const hasMlSplits = isNba && (game.mlAwayMoneyPct != null || game.mlAwayBetsPct != null);
  const hasAnySplits = hasSpreadSplits || hasTotalSplits || hasMlSplits;

  if (!hasAnySplits) {
    return (
      <div className="flex flex-col gap-1 px-1 py-3">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.5 }}>
          Betting Splits
        </span>
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
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.6 }}>
          Betting Splits
        </span>
        <div className="flex-1" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />
      </div>

      {/* Spread */}
      {hasSpreadSplits && (
        <MarketSection
          title="Spread"
          subtitle={spreadSubtitle}
          moneyPct={game.spreadAwayMoneyPct}
          betsPct={game.spreadAwayBetsPct}
          awayColor={awayColor}
          homeColor={homeColor}
          awayAbbrev={awayAbbr}
          homeAbbrev={homeAbbr}
        />
      )}

      {/* Total */}
      {hasTotalSplits && (
        <MarketSection
          title="Total"
          subtitle={totalSubtitle}
          moneyPct={game.totalOverMoneyPct}
          betsPct={game.totalOverBetsPct}
          awayColor={awayColor}
          homeColor={homeColor}
          awayAbbrev={`O ${!isNaN(bookTotal) ? bookTotal : ""}`}
          homeAbbrev={`U ${!isNaN(bookTotal) ? bookTotal : ""}`}
        />
      )}

      {/* Moneyline — NBA only */}
      {hasMlSplits && (
        <MarketSection
          title="Moneyline"
          subtitle={mlSubtitle}
          moneyPct={game.mlAwayMoneyPct}
          betsPct={game.mlAwayBetsPct}
          awayColor={awayColor}
          homeColor={homeColor}
          awayAbbrev={awayAbbr}
          homeAbbrev={homeAbbr}
        />
      )}
    </div>
  );
}

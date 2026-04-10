/**
 * OddsHistoryPanel
 *
 * Collapsible full-width panel rendered BELOW every game card (outside all
 * overflow:hidden containers). Displays a chronological timeline of every
 * odds snapshot for the game, with timestamps, lines, and VSIN betting splits.
 *
 * Architecture:
 *   - Rendered at the GameCard level so it can expand freely without clipping.
 *   - Lazy-loaded: only fetches data when the user expands the panel.
 *   - staleTime=30s: avoids redundant refetches during a session.
 *   - activeMarket prop: mirrors the SPREAD/TOTAL/MONEYLINE toggle in the
 *     BettingSplitsPanel — only the selected market's columns are shown.
 *
 * Column layout per market:
 *   SPREAD:    Time | [AWAY logo] Line 🎟️ 💰 | [HOME logo] Line 🎟️ 💰
 *   TOTAL:     Time | OVER Line 🎟️ 💰 | UNDER Line 🎟️ 💰
 *   MONEYLINE: Time | [AWAY logo] ML 🎟️ 💰 | [HOME logo] ML 🎟️ 💰
 *
 * Deduplication: consecutive rows with identical values for the active market
 * are collapsed — only the first occurrence of each unique state is shown.
 *
 * Timestamp format: DD/MM HH:MM AM/PM EST (e.g., "10/04 12:20 AM EDT")
 *
 * Emoji key:
 *   🎟️ = Tickets % (betting volume by number of bets)
 *   💰 = Money %  (betting volume by dollar handle)
 *
 * 0/0 guard: splits where both tickets AND money are 0 or null are treated
 * as "market not yet open" and displayed as "—" to avoid misleading zeros.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

export type ActiveMarket = "spread" | "total" | "ml";

interface OddsHistoryPanelProps {
  gameId: number;
  awayTeam: string;
  homeTeam: string;
  /** Mirrors the SPREAD/TOTAL/MONEYLINE toggle from BettingSplitsPanel */
  activeMarket: ActiveMarket;
}

// ── Logging helpers ────────────────────────────────────────────────────────────

function logPanel(msg: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[OddsHistoryPanel] ${msg}`, data);
  } else {
    console.log(`[OddsHistoryPanel] ${msg}`);
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────────

/**
 * Format a UTC epoch ms timestamp as: DD/MM HH:MM AM/PM TZ
 * Example: "10/04 12:20 AM EDT"
 */
function fmtTimestamp(epochMs: number): string {
  const d = new Date(epochMs);

  const day = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    day: "2-digit",
  });
  const month = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
  });

  const timePart = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const tzAbbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "ET";

  return `${day}/${month} ${timePart} ${tzAbbr}`;
}

/** Format a spread value with its juice: "+1.5 (-163)" */
function fmtSpreadWithOdds(
  value: string | null | undefined,
  odds: string | null | undefined
): string {
  if (!value) return "—";
  const v = parseFloat(value);
  if (isNaN(v)) return value;
  const sign = v > 0 ? "+" : "";
  const line = `${sign}${v}`;
  if (!odds) return line;
  return `${line} (${odds})`;
}

/** Format over side: "o8.5 (-115)" */
function fmtOverWithOdds(
  total: string | null | undefined,
  odds: string | null | undefined
): string {
  if (!total) return "—";
  const t = parseFloat(total);
  if (isNaN(t)) return total;
  const base = `o${t}`;
  return odds ? `${base} (${odds})` : base;
}

/** Format under side: "u8.5 (-105)" */
function fmtUnderWithOdds(
  total: string | null | undefined,
  odds: string | null | undefined
): string {
  if (!total) return "—";
  const t = parseFloat(total);
  if (isNaN(t)) return total;
  const base = `u${t}`;
  return odds ? `${base} (${odds})` : base;
}

/** Format a moneyline: "-149" or "+123" */
function fmtML(val: string | null | undefined): string {
  if (!val) return "—";
  return val;
}

/**
 * Format a percentage value as "##%" (integer, no decimals).
 * Returns "—" if null/undefined.
 */
function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${Math.round(val)}%`;
}

// ── Deduplication ──────────────────────────────────────────────────────────────

type HistoryRow = {
  id: number;
  scrapedAt: number;
  source: string | null;
  awaySpread: string | null;
  homeSpread: string | null;
  awaySpreadOdds: string | null;
  homeSpreadOdds: string | null;
  total: string | null;
  overOdds: string | null;
  underOdds: string | null;
  awayML: string | null;
  homeML: string | null;
  spreadAwayBetsPct: number | null;
  spreadAwayMoneyPct: number | null;
  totalOverBetsPct: number | null;
  totalOverMoneyPct: number | null;
  mlAwayBetsPct: number | null;
  mlAwayMoneyPct: number | null;
};

/**
 * Build a dedup key for the active market.
 * Consecutive rows with identical keys are collapsed — only the FIRST
 * occurrence (most recent, since rows are newest-first) is shown.
 */
function dedupKey(row: HistoryRow, market: ActiveMarket): string {
  if (market === "spread") {
    return [
      row.awaySpread, row.awaySpreadOdds,
      row.homeSpread, row.homeSpreadOdds,
      row.spreadAwayBetsPct, row.spreadAwayMoneyPct,
    ].join("|");
  }
  if (market === "total") {
    return [
      row.total, row.overOdds, row.underOdds,
      row.totalOverBetsPct, row.totalOverMoneyPct,
    ].join("|");
  }
  // ml
  return [
    row.awayML, row.homeML,
    row.mlAwayBetsPct, row.mlAwayMoneyPct,
  ].join("|");
}

/**
 * Filter rows: remove consecutive duplicates for the active market.
 * Rows are newest-first; we keep a row only when its key differs from
 * the previous kept row's key.
 */
function deduplicateRows(rows: HistoryRow[], market: ActiveMarket): HistoryRow[] {
  const out: HistoryRow[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const key = dedupKey(row, market);
    if (key !== lastKey) {
      out.push(row);
      lastKey = key;
    }
  }
  return out;
}

// ── Shared cell styles ─────────────────────────────────────────────────────────

const TH_BASE: React.CSSProperties = {
  color: "rgba(255,255,255,0.55)",
  borderBottom: "1px solid rgba(57,255,20,0.12)",
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  whiteSpace: "nowrap" as const,
};

const GROUP_BORDER_L: React.CSSProperties = {
  borderLeft: "1px solid rgba(57,255,20,0.18)",
};

const CELL_BORDER_L: React.CSSProperties = {
  borderLeft: "1px solid rgba(57,255,20,0.1)",
};

// ── Market color map ───────────────────────────────────────────────────────────

const MARKET_COLOR: Record<ActiveMarket, string> = {
  spread: "rgba(255,200,80,0.9)",
  total:  "rgba(80,200,255,0.9)",
  ml:     "rgba(180,120,255,0.9)",
};

// ── Team logo component ────────────────────────────────────────────────────────

function TeamLogo({
  logoUrl,
  abbrev,
  size = 18,
}: {
  logoUrl: string | null | undefined;
  abbrev: string | null | undefined;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={abbrev ?? ""}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          display: "inline-block",
          verticalAlign: "middle",
          flexShrink: 0,
        }}
        onError={(e) => {
          // Fallback to abbrev text if logo fails to load
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
      {abbrev ?? "?"}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OddsHistoryPanel({
  gameId,
  awayTeam,
  homeTeam,
  activeMarket,
}: OddsHistoryPanelProps) {
  const [open, setOpen] = useState(false);

  // Lazy-load: only fetch when panel is expanded
  const { data, isLoading, error } = trpc.oddsHistory.listForGame.useQuery(
    { gameId },
    { enabled: open, staleTime: 30_000 }
  );

  // Fetch team logos via the same teamColors query used by BettingSplitsPanel
  // sport is derived from the game context — we pass awayTeam/homeTeam as slugs
  // and let the server resolve the correct table. We try MLB first (most common),
  // then fall back gracefully. The sport prop isn't available here, so we use
  // a separate query that accepts raw team identifiers.
  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam, homeTeam, sport: "MLB" },
    { staleTime: 1000 * 60 * 60, enabled: open }
  );

  // Also try NHL and NBA in parallel for non-MLB games
  const { data: colorsNHL } = trpc.teamColors.getForGame.useQuery(
    { awayTeam, homeTeam, sport: "NHL" },
    { staleTime: 1000 * 60 * 60, enabled: open && !colors?.away?.logoUrl }
  );
  const { data: colorsNBA } = trpc.teamColors.getForGame.useQuery(
    { awayTeam, homeTeam, sport: "NBA" },
    { staleTime: 1000 * 60 * 60, enabled: open && !colors?.away?.logoUrl && !colorsNHL?.away?.logoUrl }
  );

  // Pick the first color set that has a logo
  const resolvedColors = colors?.away?.logoUrl ? colors
    : colorsNHL?.away?.logoUrl ? colorsNHL
    : colorsNBA?.away?.logoUrl ? colorsNBA
    : colors; // fallback to MLB even if no logo

  const awayLogo = resolvedColors?.away?.logoUrl;
  const homeLogo = resolvedColors?.home?.logoUrl;
  const awayAbbrev = resolvedColors?.away?.abbrev ?? awayTeam;
  const homeAbbrev = resolvedColors?.home?.abbrev ?? homeTeam;

  const rawRows = (data?.history ?? []) as HistoryRow[];

  // Deduplicate consecutive identical rows for the active market
  const rows = deduplicateRows(rawRows, activeMarket);

  // ── Structured logging ─────────────────────────────────────────────────────

  if (open && !isLoading && !error && rawRows.length > 0) {
    logPanel(
      `[RENDER] gameId=${gameId} market=${activeMarket} ` +
      `raw=${rawRows.length} deduped=${rows.length} | ` +
      `latest=${fmtTimestamp(rawRows[0]?.scrapedAt ?? 0)} | ` +
      `oldest=${fmtTimestamp(rawRows[rawRows.length - 1]?.scrapedAt ?? 0)}`
    );
  }
  if (open && error) {
    logPanel(`[ERROR] gameId=${gameId} | ${error.message}`);
  }

  const handleToggle = () => {
    const next = !open;
    logPanel(
      `[TOGGLE] gameId=${gameId} market=${activeMarket} | ${next ? "OPEN -> fetching" : "CLOSE"}`
    );
    setOpen(next);
  };

  const marketColor = MARKET_COLOR[activeMarket];

  const marketBadgeLabel =
    activeMarket === "spread" ? "SPREAD"
    : activeMarket === "total" ? "TOTAL"
    : "ML";

  return (
    <div className="border-t" style={{ borderColor: "rgba(57,255,20,0.15)" }}>
      {/* ── Toggle header ── */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} odds & splits history for ${awayTeam}`}
      >
        <div className="flex items-center gap-2">
          <Clock size={13} style={{ color: "#39FF14" }} />
          <span
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: "#39FF14" }}
          >
            Odds &amp; Splits History
          </span>
          {/* Active market badge */}
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
            style={{
              background: `${marketColor}22`,
              color: marketColor,
              border: `1px solid ${marketColor}55`,
            }}
          >
            {marketBadgeLabel}
          </span>
          {/* Snapshot count badge (deduped count) */}
          {rows.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(57,255,20,0.15)", color: "#39FF14" }}
            >
              {rows.length}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp size={14} style={{ color: "#39FF14" }} />
        ) : (
          <ChevronDown size={14} style={{ color: "rgba(57,255,20,0.6)" }} />
        )}
      </button>

      {/* ── Expanded table ── */}
      {open && (
        <div className="px-2 pb-3">
          {isLoading ? (
            <div
              className="flex items-center justify-center py-6 gap-2"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              <RefreshCw size={13} className="animate-spin" />
              <span className="text-xs">Loading history...</span>
            </div>
          ) : error ? (
            <p className="text-xs text-center py-4" style={{ color: "#ff4444" }}>
              Failed to load odds &amp; splits history.
            </p>
          ) : rows.length === 0 ? (
            <p
              className="text-xs text-center py-4"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              No snapshots yet — history will populate after the next 10-min refresh cycle.
            </p>
          ) : (
            <div
              className="overflow-x-auto rounded-md"
              style={{ border: "1px solid rgba(57,255,20,0.12)" }}
            >
              <table
                className="w-full text-[10px]"
                style={{ borderCollapse: "collapse" }}
              >
                <thead>
                  {/* ── Group header row ── */}
                  <tr style={{ background: "rgba(57,255,20,0.05)" }}>
                    {/* Time spacer */}
                    <th colSpan={1} className="px-3 py-1 text-left" style={TH_BASE} />

                    {/* SPREAD: AWAY group | HOME group */}
                    {activeMarket === "spread" && (
                      <>
                        <th
                          colSpan={3}
                          className="px-2 py-1 text-center"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          AWAY
                        </th>
                        <th
                          colSpan={3}
                          className="px-2 py-1 text-center"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          HOME
                        </th>
                      </>
                    )}

                    {/* TOTAL: OVER group | UNDER group */}
                    {activeMarket === "total" && (
                      <>
                        <th
                          colSpan={3}
                          className="px-2 py-1 text-center"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          OVER
                        </th>
                        <th
                          colSpan={3}
                          className="px-2 py-1 text-center"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          UNDER
                        </th>
                      </>
                    )}

                    {/* ML: AWAY group | HOME group */}
                    {activeMarket === "ml" && (
                      <>
                        <th
                          colSpan={3}
                          className="px-2 py-1 text-center"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          AWAY
                        </th>
                        <th
                          colSpan={3}
                          className="px-2 py-1 text-center"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          HOME
                        </th>
                      </>
                    )}
                  </tr>

                  {/* ── Column header row ── */}
                  <tr style={{ background: "rgba(57,255,20,0.08)" }}>
                    {/* Time */}
                    <th className="text-left px-3 py-2" style={TH_BASE}>
                      Time (ET)
                    </th>

                    {/* ── SPREAD columns ── */}
                    {activeMarket === "spread" && (
                      <>
                        {/* AWAY: Logo | Line | 🎟️ | 💰 */}
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <TeamLogo logoUrl={awayLogo} abbrev={awayAbbrev} size={14} />
                            <span>Line</span>
                          </div>
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${awayTeam} spread tickets %`}
                        >
                          🎟️
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${awayTeam} spread money %`}
                        >
                          💰
                        </th>
                        {/* HOME: Logo | Line | 🎟️ | 💰 */}
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <TeamLogo logoUrl={homeLogo} abbrev={homeAbbrev} size={14} />
                            <span>Line</span>
                          </div>
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${homeTeam} spread tickets % (inverse of away)`}
                        >
                          🎟️
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${homeTeam} spread money % (inverse of away)`}
                        >
                          💰
                        </th>
                      </>
                    )}

                    {/* ── TOTAL columns ── */}
                    {activeMarket === "total" && (
                      <>
                        {/* OVER: Line | 🎟️ | 💰 */}
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          Line
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title="Over tickets %"
                        >
                          🎟️
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title="Over money %"
                        >
                          💰
                        </th>
                        {/* UNDER: Line | 🎟️ | 💰 */}
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          Line
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title="Under tickets % (inverse of over)"
                        >
                          🎟️
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title="Under money % (inverse of over)"
                        >
                          💰
                        </th>
                      </>
                    )}

                    {/* ── ML columns ── */}
                    {activeMarket === "ml" && (
                      <>
                        {/* AWAY: Logo | ML | 🎟️ | 💰 */}
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <TeamLogo logoUrl={awayLogo} abbrev={awayAbbrev} size={14} />
                            <span>ML</span>
                          </div>
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${awayTeam} ML tickets %`}
                        >
                          🎟️
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${awayTeam} ML money %`}
                        >
                          💰
                        </th>
                        {/* HOME: Logo | ML | 🎟️ | 💰 */}
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, ...GROUP_BORDER_L, color: marketColor }}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <TeamLogo logoUrl={homeLogo} abbrev={homeAbbrev} size={14} />
                            <span>ML</span>
                          </div>
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${homeTeam} ML tickets % (inverse of away)`}
                        >
                          🎟️
                        </th>
                        <th
                          className="text-center px-2 py-2"
                          style={{ ...TH_BASE, color: "rgba(255,255,255,0.5)" }}
                          title={`${homeTeam} ML money % (inverse of away)`}
                        >
                          💰
                        </th>
                      </>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row, idx) => {
                    const isEven = idx % 2 === 0;

                    // 0/0 guard per market
                    const spreadPending =
                      (row.spreadAwayBetsPct == null || row.spreadAwayBetsPct === 0) &&
                      (row.spreadAwayMoneyPct == null || row.spreadAwayMoneyPct === 0);
                    const totalPending =
                      (row.totalOverBetsPct == null || row.totalOverBetsPct === 0) &&
                      (row.totalOverMoneyPct == null || row.totalOverMoneyPct === 0);
                    const mlPending =
                      (row.mlAwayBetsPct == null || row.mlAwayBetsPct === 0) &&
                      (row.mlAwayMoneyPct == null || row.mlAwayMoneyPct === 0);

                    // Inverse splits (home = 100 - away)
                    const spreadHomeBets = spreadPending ? null
                      : row.spreadAwayBetsPct != null ? 100 - row.spreadAwayBetsPct : null;
                    const spreadHomeMoney = spreadPending ? null
                      : row.spreadAwayMoneyPct != null ? 100 - row.spreadAwayMoneyPct : null;
                    const totalUnderBets = totalPending ? null
                      : row.totalOverBetsPct != null ? 100 - row.totalOverBetsPct : null;
                    const totalUnderMoney = totalPending ? null
                      : row.totalOverMoneyPct != null ? 100 - row.totalOverMoneyPct : null;
                    const mlHomeBets = mlPending ? null
                      : row.mlAwayBetsPct != null ? 100 - row.mlAwayBetsPct : null;
                    const mlHomeMoney = mlPending ? null
                      : row.mlAwayMoneyPct != null ? 100 - row.mlAwayMoneyPct : null;

                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: isEven ? "rgba(255,255,255,0.02)" : "transparent",
                          borderBottom:
                            idx < rows.length - 1
                              ? "1px solid rgba(255,255,255,0.04)"
                              : "none",
                        }}
                      >
                        {/* ── Timestamp: DD/MM HH:MM AM/PM TZ ── */}
                        <td
                          className="px-3 py-2 whitespace-nowrap font-mono"
                          style={{ color: "rgba(255,255,255,0.75)", fontSize: 10 }}
                        >
                          {fmtTimestamp(row.scrapedAt)}
                        </td>

                        {/* ── SPREAD market cells ── */}
                        {activeMarket === "spread" && (
                          <>
                            {/* AWAY: Line | 🎟️ | 💰 */}
                            <td
                              className="px-2 py-2 text-center font-mono whitespace-nowrap"
                              style={{ color: marketColor, ...CELL_BORDER_L }}
                            >
                              {fmtSpreadWithOdds(row.awaySpread, row.awaySpreadOdds)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: spreadPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {spreadPending ? "—" : fmtPct(row.spreadAwayBetsPct)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: spreadPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {spreadPending ? "—" : fmtPct(row.spreadAwayMoneyPct)}
                            </td>
                            {/* HOME: Line | 🎟️ | 💰 */}
                            <td
                              className="px-2 py-2 text-center font-mono whitespace-nowrap"
                              style={{ color: marketColor, ...CELL_BORDER_L }}
                            >
                              {fmtSpreadWithOdds(row.homeSpread, row.homeSpreadOdds)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: spreadPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {spreadPending ? "—" : fmtPct(spreadHomeBets)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: spreadPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {spreadPending ? "—" : fmtPct(spreadHomeMoney)}
                            </td>
                          </>
                        )}

                        {/* ── TOTAL market cells ── */}
                        {activeMarket === "total" && (
                          <>
                            {/* OVER: Line | 🎟️ | 💰 */}
                            <td
                              className="px-2 py-2 text-center font-mono whitespace-nowrap"
                              style={{ color: marketColor, ...CELL_BORDER_L }}
                            >
                              {fmtOverWithOdds(row.total, row.overOdds)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: totalPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {totalPending ? "—" : fmtPct(row.totalOverBetsPct)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: totalPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {totalPending ? "—" : fmtPct(row.totalOverMoneyPct)}
                            </td>
                            {/* UNDER: Line | 🎟️ | 💰 */}
                            <td
                              className="px-2 py-2 text-center font-mono whitespace-nowrap"
                              style={{ color: marketColor, ...CELL_BORDER_L }}
                            >
                              {fmtUnderWithOdds(row.total, row.underOdds)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: totalPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {totalPending ? "—" : fmtPct(totalUnderBets)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: totalPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {totalPending ? "—" : fmtPct(totalUnderMoney)}
                            </td>
                          </>
                        )}

                        {/* ── ML market cells ── */}
                        {activeMarket === "ml" && (
                          <>
                            {/* AWAY: ML | 🎟️ | 💰 */}
                            <td
                              className="px-2 py-2 text-center font-mono whitespace-nowrap"
                              style={{ color: marketColor, ...CELL_BORDER_L }}
                            >
                              {fmtML(row.awayML)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: mlPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {mlPending ? "—" : fmtPct(row.mlAwayBetsPct)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: mlPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {mlPending ? "—" : fmtPct(row.mlAwayMoneyPct)}
                            </td>
                            {/* HOME: ML | 🎟️ | 💰 */}
                            <td
                              className="px-2 py-2 text-center font-mono whitespace-nowrap"
                              style={{ color: marketColor, ...CELL_BORDER_L }}
                            >
                              {fmtML(row.homeML)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: mlPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {mlPending ? "—" : fmtPct(mlHomeBets)}
                            </td>
                            <td
                              className="px-2 py-2 text-center font-mono"
                              style={{ color: mlPending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.9)" }}
                            >
                              {mlPending ? "—" : fmtPct(mlHomeMoney)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* ── Footer: raw vs deduped count ── */}
              {rawRows.length !== rows.length && (
                <div
                  className="px-3 py-1.5 text-right"
                  style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.3)",
                    borderTop: "1px solid rgba(57,255,20,0.08)",
                  }}
                >
                  Showing {rows.length} unique snapshots ({rawRows.length} total — {rawRows.length - rows.length} consecutive duplicates hidden)
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * SituationalResultsPanel.tsx
 *
 * Situational Results panel for MLB, NBA, and NHL matchup cards.
 * Matches the Action Network reference design (second screenshot):
 *   - Tab selector: [Moneyline] [Total] [Spread/Run Line/Puck Line]
 *   - Side-by-side record bars for both teams:
 *       Overall Record, Last 10, Away/Home, Underdog/Favorite
 *   - Color bars: green = winning record, red = losing record
 *
 * Data source: DraftKings NJ via Action Network API (book_id=68)
 *   MLB  → trpc.mlbSchedule.getSituationalStats
 *   NBA  → trpc.nbaSchedule.getSituationalStats
 *   NHL  → trpc.nhlSchedule.getSituationalStats
 *
 * Logging: [SituationalResultsPanel][STEP] fully traceable
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { MLB_BY_AN_SLUG } from "@shared/mlbTeams";
import { NBA_BY_AN_SLUG } from "@shared/nbaTeams";
import { NHL_BY_AN_SLUG } from "@shared/nhlTeams";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sport = "MLB" | "NBA" | "NHL";
type SitTab = "ml" | "spread" | "total";

interface SituationalRecord {
  wins: number;
  losses: number;
  pushes?: number;
}

interface SituationalStats {
  ml: {
    overall: SituationalRecord;
    last10: SituationalRecord;
    home: SituationalRecord;
    away: SituationalRecord;
    favorite: SituationalRecord;
    underdog: SituationalRecord;
  };
  spread: {
    overall: SituationalRecord;
    last10: SituationalRecord;
    home: SituationalRecord;
    away: SituationalRecord;
    favorite: SituationalRecord;
    underdog: SituationalRecord;
  };
  total: {
    overall: SituationalRecord;
    last10: SituationalRecord;
    home: SituationalRecord;
    away: SituationalRecord;
    favorite: SituationalRecord;
    underdog: SituationalRecord;
  };
  gamesAnalyzed: number;
}

export interface SituationalResultsPanelProps {
  sport: Sport;
  awaySlug: string;
  homeSlug: string;
  awayAbbr: string;
  homeAbbr: string;
  awayName: string;
  homeName: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  borderColor?: string;
  /** When true, the panel starts collapsed. Defaults to false (expanded). */
  defaultCollapsed?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRecord(rec: SituationalRecord | undefined): string {
  if (!rec) return "—";
  const total = rec.wins + rec.losses + (rec.pushes ?? 0);
  if (total === 0) return "—";
  return `${rec.wins}-${rec.losses}`;
}

function winPct(rec: SituationalRecord | undefined): number {
  if (!rec) return 0;
  const total = rec.wins + rec.losses;
  if (total === 0) return 0;
  return rec.wins / total;
}

function barColor(rec: SituationalRecord | undefined): string {
  const pct = winPct(rec);
  if (pct >= 0.55) return "bg-emerald-700";
  if (pct >= 0.5)  return "bg-emerald-900";
  if (pct >= 0.45) return "bg-red-900";
  return "bg-red-700";
}

function resolveLogoUrl(slug: string, sport: Sport): string | undefined {
  if (sport === "MLB") return MLB_BY_AN_SLUG.get(slug)?.logoUrl;
  if (sport === "NBA") return NBA_BY_AN_SLUG.get(slug)?.logoUrl;
  if (sport === "NHL") return NHL_BY_AN_SLUG.get(slug)?.logoUrl;
  return undefined;
}

function spreadTabLabel(sport: Sport): string {
  if (sport === "MLB") return "Run Line";
  if (sport === "NHL") return "Puck Line";
  return "Spread";
}

// ─── Record Bar Row ───────────────────────────────────────────────────────────

function RecordRow({
  label,
  awayRec,
  homeRec,
  awayIsLeft,
}: {
  label: string;
  awayRec: SituationalRecord | undefined;
  homeRec: SituationalRecord | undefined;
  /** away team is always on the left (true), home on right */
  awayIsLeft: boolean;
}) {
  const leftRec  = awayIsLeft ? awayRec  : homeRec;
  const rightRec = awayIsLeft ? homeRec  : awayRec;

  return (
    <div className="mb-3">
      {/* Label row */}
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-[9px] text-gray-500 font-mono">{label}</span>
        <span className="text-[9px] text-gray-500 font-mono text-right">{label}</span>
      </div>
      {/* Bar row */}
      <div className="flex gap-2">
        {/* Left (away) bar */}
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1.5 rounded text-[11px] font-bold text-white font-mono",
            barColor(leftRec)
          )}
        >
          {fmtRecord(leftRec)}
        </div>
        {/* Right (home) bar */}
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1.5 rounded text-[11px] font-bold text-white font-mono",
            barColor(rightRec)
          )}
        >
          {fmtRecord(rightRec)}
        </div>
      </div>
    </div>
  );
}

// ─── Stats Section (one tab's worth of data) ─────────────────────────────────

function StatsSection({
  sport,
  awaySlug,
  homeSlug,
  awayAbbr,
  homeAbbr,
  awayLogoUrl,
  homeLogoUrl,
  tab,
}: {
  sport: Sport;
  awaySlug: string;
  homeSlug: string;
  awayAbbr: string;
  homeAbbr: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  tab: SitTab;
}) {
  // ── MLB query ────────────────────────────────────────────────────────────
  const mlbAwayQuery = trpc.mlbSchedule.getSituationalStats.useQuery(
    { teamSlug: awaySlug },
    { enabled: sport === "MLB", staleTime: 5 * 60 * 1000, retry: 1 }
  );
  const mlbHomeQuery = trpc.mlbSchedule.getSituationalStats.useQuery(
    { teamSlug: homeSlug },
    { enabled: sport === "MLB", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // ── NBA query ────────────────────────────────────────────────────────────
  const nbaAwayQuery = trpc.nbaSchedule.getSituationalStats.useQuery(
    { teamSlug: awaySlug },
    { enabled: sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }
  );
  const nbaHomeQuery = trpc.nbaSchedule.getSituationalStats.useQuery(
    { teamSlug: homeSlug },
    { enabled: sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // ── NHL query ────────────────────────────────────────────────────────────
  const nhlAwayQuery = trpc.nhlSchedule.getSituationalStats.useQuery(
    { teamSlug: awaySlug },
    { enabled: sport === "NHL", staleTime: 5 * 60 * 1000, retry: 1 }
  );
  const nhlHomeQuery = trpc.nhlSchedule.getSituationalStats.useQuery(
    { teamSlug: homeSlug },
    { enabled: sport === "NHL", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  const awayQuery =
    sport === "MLB" ? mlbAwayQuery
    : sport === "NBA" ? nbaAwayQuery
    : nhlAwayQuery;

  const homeQuery =
    sport === "MLB" ? mlbHomeQuery
    : sport === "NBA" ? nbaHomeQuery
    : nhlHomeQuery;

  const isLoading = awayQuery.isLoading || homeQuery.isLoading;
  const error = awayQuery.error ?? homeQuery.error;

  const awayStats = awayQuery.data as SituationalStats | undefined;
  const homeStats = homeQuery.data as SituationalStats | undefined;

  const awayLogo = awayLogoUrl ?? resolveLogoUrl(awaySlug, sport);
  const homeLogo = homeLogoUrl ?? resolveLogoUrl(homeSlug, sport);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 text-blue-400 animate-spin mr-2" />
        <span className="text-[10px] text-gray-500 font-mono">Loading situational stats...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-4">
        <p className="text-[10px] text-red-400 font-mono">Error: {error.message}</p>
      </div>
    );
  }

  // Select the correct sub-object based on tab
  const awayData = awayStats?.[tab];
  const homeData = homeStats?.[tab];

  return (
    <div className="px-3 py-3">
      {/* ── Team header row ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        {/* Away team */}
        <div className="flex items-center gap-2">
          {awayLogo && (
            <img
              src={awayLogo}
              alt={awayAbbr}
              className="w-6 h-6 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-[12px] font-bold text-white font-mono">{awayAbbr}</span>
        </div>
        {/* Home team */}
        <div className="flex items-center gap-2 flex-row-reverse">
          {homeLogo && (
            <img
              src={homeLogo}
              alt={homeAbbr}
              className="w-6 h-6 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-[12px] font-bold text-white font-mono">{homeAbbr}</span>
        </div>
      </div>

      {/* ── Record rows ─────────────────────────────────────────────────── */}
      <RecordRow
        label="Overall Record"
        awayRec={awayData?.overall}
        homeRec={homeData?.overall}
        awayIsLeft={true}
      />
      <RecordRow
        label="Last 10"
        awayRec={awayData?.last10}
        homeRec={homeData?.last10}
        awayIsLeft={true}
      />
      <RecordRow
        label={tab === "total" ? "Home O/U" : "Home"}
        awayRec={awayData?.home}
        homeRec={homeData?.home}
        awayIsLeft={true}
      />
      <RecordRow
        label={tab === "total" ? "Away O/U" : "Away"}
        awayRec={awayData?.away}
        homeRec={homeData?.away}
        awayIsLeft={true}
      />
      {tab !== "total" && (
        <>
          <RecordRow
            label="Underdog"
            awayRec={awayData?.underdog}
            homeRec={homeData?.underdog}
            awayIsLeft={true}
          />
          <RecordRow
            label="Favorite"
            awayRec={awayData?.favorite}
            homeRec={homeData?.favorite}
            awayIsLeft={true}
          />
        </>
      )}
      {tab === "total" && (
        <>
          <RecordRow
            label="Fav O/U"
            awayRec={awayData?.favorite}
            homeRec={homeData?.favorite}
            awayIsLeft={true}
          />
          <RecordRow
            label="Dog O/U"
            awayRec={awayData?.underdog}
            homeRec={homeData?.underdog}
            awayIsLeft={true}
          />
        </>
      )}


    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function SituationalResultsPanel({
  sport,
  awaySlug,
  homeSlug,
  awayAbbr,
  homeAbbr,
  awayName,
  homeName,
  awayLogoUrl,
  homeLogoUrl,
  borderColor = "hsl(var(--border))",
  defaultCollapsed = false,
}: SituationalResultsPanelProps) {
  const [tab, setTab] = useState<SitTab>("ml");
  // defaultCollapsed=true → starts collapsed; false → starts expanded (legacy default)
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  const sLabel = spreadTabLabel(sport);

  const tabs: { key: SitTab; label: string }[] = [
    { key: "ml",     label: "Moneyline" },
    { key: "total",  label: "Total"     },
    { key: "spread", label: sLabel      },
  ];

  return (
    <div
      className="w-full"
      style={{
        background: "hsl(var(--card))",
        borderLeft: `3px solid ${borderColor}`,
        borderBottom: "1px solid hsl(var(--border))",
      }}
    >
      {/* ── Collapsible Header ─────────────────────────────────────────────── */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 font-mono tracking-widest uppercase">
            Situational Results
          </span>
          <span className="text-[9px] text-gray-600 font-mono">
            ML · {sLabel} · Total
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
          }
        </div>
      </button>

      {/* ── Collapsible Body ───────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-white/[0.06]">
          {/* ── Tab selector ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.06]">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex-1 py-1.5 rounded-full text-[10px] font-bold font-mono transition-all",
                  tab === t.key
                    ? "bg-white/10 text-white"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Stats content ─────────────────────────────────────────────── */}
          <StatsSection
            sport={sport}
            awaySlug={awaySlug}
            homeSlug={homeSlug}
            awayAbbr={awayAbbr}
            homeAbbr={homeAbbr}
            awayLogoUrl={awayLogoUrl}
            homeLogoUrl={homeLogoUrl}
            tab={tab}
          />


        </div>
      )}
    </div>
  );
}

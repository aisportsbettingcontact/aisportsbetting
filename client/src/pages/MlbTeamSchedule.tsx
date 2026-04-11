/**
 * MlbTeamSchedule.tsx
 *
 * Full 2026 MLB team schedule page.
 * Accessed via /mlb/team/:slug (Action Network url_slug).
 *
 * Fixes applied (2026-04-11):
 *   1. Postponed games are EXCLUDED from both Upcoming/Live and Completed sections.
 *      Only "scheduled" / "inprogress" games appear in Upcoming/Live.
 *      Only "complete" games appear in Completed.
 *   2. Doubleheaders display correctly — both games share the same gameDate and
 *      are rendered as separate rows in chronological order.
 *   3. HOME/AWAY spelled out in full (not H/A abbreviation).
 *   4. Stats summary bar is a single responsive row: RECORD · RL COVER · O/U · GAMES.
 *   5. O/U stat shows Over record with pushes: "6O–5U–1P" format.
 *   6. Full responsive scaling from 320px (iPhone SE) → 1440px desktop.
 *      Tables use overflow-x-auto with no hard min-width that forces page overflow.
 *      Font sizes use clamp-style sm: breakpoints throughout.
 *
 * Logging: [MlbTeamSchedule][STEP] fully traceable in browser console.
 *
 * Data source: mlb_schedule_history table (Action Network DK NJ API)
 * Season filter: 2026-03-26 → present (enforced in backend service)
 */

import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { MLB_BY_AN_SLUG } from "@shared/mlbTeams";
import { ArrowLeft, RefreshCw, Calendar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleGame {
  id: number;
  anGameId: number;
  gameDate: string;
  startTimeUtc: string;
  gameStatus: string;
  awaySlug: string;
  awayAbbr: string;
  awayName: string;
  awayTeamId: number;
  awayScore: number | null;
  homeSlug: string;
  homeAbbr: string;
  homeName: string;
  homeTeamId: number;
  homeScore: number | null;
  dkAwayRunLine: string | null;
  dkAwayRunLineOdds: string | null;
  dkHomeRunLine: string | null;
  dkHomeRunLineOdds: string | null;
  dkTotal: string | null;
  dkOverOdds: string | null;
  dkUnderOdds: string | null;
  dkAwayML: string | null;
  dkHomeML: string | null;
  awayRunLineCovered: boolean | null;
  homeRunLineCovered: boolean | null;
  totalResult: string | null;
  awayWon: boolean | null;
}

// ─── Status classification ────────────────────────────────────────────────────
// "postponed" is excluded from BOTH sections — it has no score, no valid time,
// and should not appear anywhere on the schedule page.
const COMPLETE_STATUS   = "complete";
const POSTPONED_STATUS  = "postponed";

function isCompleteGame(g: ScheduleGame): boolean {
  return g.gameStatus === COMPLETE_STATUS;
}

function isUpcomingGame(g: ScheduleGame): boolean {
  // scheduled or inprogress — anything that is NOT complete and NOT postponed
  return g.gameStatus !== COMPLETE_STATUS && g.gameStatus !== POSTPONED_STATUS;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGameDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatStartTime(utcIso: string): string {
  const d = new Date(utcIso);
  return (
    d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET"
  );
}

/** Format run line: "+1.5 (+153)" or "—" */
function fmtRunLine(value: string | null, odds: string | null): string {
  if (!value) return "—";
  const v = parseFloat(value);
  const sign = v >= 0 ? "+" : "";
  const lineStr = `${sign}${v}`;
  if (!odds) return lineStr;
  return `${lineStr} (${odds})`;
}

/** Format total: "8.5 (-115/-105)" or "—" */
function fmtTotal(
  total: string | null,
  overOdds: string | null,
  underOdds: string | null
): string {
  if (!total) return "—";
  const t = parseFloat(total);
  if (!overOdds && !underOdds) return String(t);
  return `${t} (${overOdds ?? "—"}/${underOdds ?? "—"})`;
}

function mlColor(odds: string | null): string {
  if (!odds) return "text-gray-400";
  const n = parseInt(odds.replace("+", ""));
  if (n > 0) return "text-green-400";
  if (n < -150) return "text-red-400";
  return "text-yellow-300";
}

// ─── Result Badge ─────────────────────────────────────────────────────────────

function Badge({
  label,
  variant,
}: {
  label: string;
  variant: "win" | "loss" | "push" | "neutral";
}) {
  const cls = {
    win:     "bg-green-500/20 text-green-400 border-green-500/30",
    loss:    "bg-red-500/20 text-red-400 border-red-500/30",
    push:    "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    neutral: "bg-gray-700/50 text-gray-400 border-gray-600/30",
  }[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded text-[9px] sm:text-[10px] font-bold border font-mono tracking-wide px-1 py-0.5 whitespace-nowrap",
        cls
      )}
    >
      {label}
    </span>
  );
}

// ─── Game Row ─────────────────────────────────────────────────────────────────

function ScheduleRow({
  game,
  teamSlug,
  isUpcoming,
}: {
  game: ScheduleGame;
  teamSlug: string;
  isUpcoming: boolean;
}) {
  const isAway = game.awaySlug === teamSlug;

  const oppSlug   = isAway ? game.homeSlug   : game.awaySlug;
  const oppAbbr   = isAway ? game.homeAbbr   : game.awayAbbr;
  const oppName   = isAway ? game.homeName   : game.awayName;
  const oppTeamId = isAway ? game.homeTeamId : game.awayTeamId;
  const oppTeam   = MLB_BY_AN_SLUG.get(oppSlug);
  const oppLogo   =
    oppTeam?.logoUrl ??
    `https://www.mlbstatic.com/team-logos/${oppTeamId}.svg`;

  const myScore  = isAway ? game.awayScore : game.homeScore;
  const oppScore = isAway ? game.homeScore : game.awayScore;

  const myRunLine      = isAway ? game.dkAwayRunLine      : game.dkHomeRunLine;
  const myRunLineOdds  = isAway ? game.dkAwayRunLineOdds  : game.dkHomeRunLineOdds;
  const myML           = isAway ? game.dkAwayML           : game.dkHomeML;

  const myCovered = isAway ? game.awayRunLineCovered : game.homeRunLineCovered;
  const myWon     = game.awayWon != null
    ? (isAway ? game.awayWon : !game.awayWon)
    : null;

  const isComplete  = game.gameStatus === COMPLETE_STATUS;
  const isScheduled = game.gameStatus === "scheduled";

  // Score cell: final score if complete, start time if scheduled, "Live" otherwise
  const scoreStr =
    isComplete && myScore != null && oppScore != null
      ? `${myScore}–${oppScore}`
      : isScheduled
      ? formatStartTime(game.startTimeUtc)
      : "Live";

  const wlVariant: "win" | "loss" | "neutral" =
    myWon === true ? "win" : myWon === false ? "loss" : "neutral";
  const wlLabel = myWon === true ? "W" : myWon === false ? "L" : "—";

  const covVariant: "win" | "loss" | "neutral" =
    myCovered === true ? "win" : myCovered === false ? "loss" : "neutral";
  const covLabel =
    myCovered === true ? "COV" : myCovered === false ? "NO" : "—";

  const totalVariant: "win" | "loss" | "push" | "neutral" =
    game.totalResult === "OVER"  ? "win"
    : game.totalResult === "UNDER" ? "loss"
    : game.totalResult === "PUSH"  ? "push"
    : "neutral";
  const totalLabel = game.totalResult ?? "—";

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      {/* Date */}
      <td className="px-2 sm:px-3 py-2 text-[10px] sm:text-xs text-gray-400 whitespace-nowrap font-mono">
        {formatGameDate(game.gameDate)}
      </td>

      {/* HOME / AWAY — spelled out */}
      <td className="px-1 sm:px-2 py-2 text-center whitespace-nowrap">
        <span
          className={cn(
            "text-[9px] sm:text-[10px] font-bold font-mono px-1 sm:px-1.5 py-0.5 rounded",
            isAway
              ? "bg-blue-500/20 text-blue-400"
              : "bg-purple-500/20 text-purple-400"
          )}
        >
          {isAway ? "AWAY" : "HOME"}
        </span>
      </td>

      {/* Opponent */}
      <td className="px-2 sm:px-3 py-2">
        <div className="flex items-center gap-1.5">
          <img
            src={oppLogo}
            alt={oppAbbr}
            className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          {/* Full name on sm+, abbr on mobile */}
          <span className="hidden sm:block text-xs font-semibold text-white truncate max-w-[120px]">
            {oppName}
          </span>
          <span className="block sm:hidden text-[10px] font-bold text-white font-mono">
            {oppAbbr}
          </span>
        </div>
      </td>

      {/* Score / Time */}
      <td className="px-2 sm:px-3 py-2 text-center">
        <span
          className={cn(
            "text-[10px] sm:text-xs font-mono font-bold",
            isComplete
              ? myWon ? "text-green-400" : "text-red-400"
              : "text-gray-400"
          )}
        >
          {scoreStr}
        </span>
      </td>

      {/* W/L — hidden on upcoming rows (no result yet) */}
      <td className="px-1 sm:px-2 py-2 text-center">
        {isUpcoming
          ? <span className="text-[10px] text-gray-600 font-mono">—</span>
          : <Badge label={wlLabel} variant={wlVariant} />
        }
      </td>

      {/* Run Line */}
      <td className="px-2 sm:px-3 py-2">
        <div className="text-[10px] sm:text-xs font-mono text-gray-300 whitespace-nowrap">
          {fmtRunLine(myRunLine, myRunLineOdds)}
        </div>
      </td>

      {/* RL Cover — hidden on upcoming rows */}
      <td className="px-1 sm:px-2 py-2 text-center">
        {isUpcoming
          ? <span className="text-[10px] text-gray-600 font-mono">—</span>
          : <Badge label={covLabel} variant={covVariant} />
        }
      </td>

      {/* Total */}
      <td className="px-2 sm:px-3 py-2">
        <div className="text-[10px] sm:text-xs font-mono text-gray-300 whitespace-nowrap">
          {fmtTotal(game.dkTotal, game.dkOverOdds, game.dkUnderOdds)}
        </div>
      </td>

      {/* O/U Result — hidden on upcoming rows */}
      <td className="px-1 sm:px-2 py-2 text-center">
        {isUpcoming
          ? <span className="text-[10px] text-gray-600 font-mono">—</span>
          : <Badge label={totalLabel} variant={totalVariant} />
        }
      </td>

      {/* Moneyline */}
      <td className="px-2 sm:px-3 py-2 text-center">
        <span className={cn("text-[10px] sm:text-xs font-mono font-bold", mlColor(myML))}>
          {myML ?? "—"}
        </span>
      </td>
    </tr>
  );
}

// ─── Stats Summary Bar ────────────────────────────────────────────────────────
//
// Single responsive row: RECORD · RL COVER · O/U · GAMES
// O/U shows: {overs}O–{unders}U–{pushes}P (pushes shown only when > 0)

function StatsSummary({
  games,
  teamSlug,
}: {
  games: ScheduleGame[];
  teamSlug: string;
}) {
  const completed = games.filter(isCompleteGame);
  if (!completed.length) return null;

  // W/L record
  const wins = completed.filter((g) => {
    const ia = g.awaySlug === teamSlug;
    return ia ? g.awayWon === true : g.awayWon === false;
  }).length;
  const losses = completed.length - wins;

  // RL Cover record
  const covered = completed.filter((g) => {
    const ia = g.awaySlug === teamSlug;
    return ia ? g.awayRunLineCovered === true : g.homeRunLineCovered === true;
  }).length;
  const notCovered = completed.filter((g) => {
    const ia = g.awaySlug === teamSlug;
    return ia ? g.awayRunLineCovered === false : g.homeRunLineCovered === false;
  }).length;

  // O/U record — includes pushes
  const overs  = completed.filter((g) => g.totalResult === "OVER").length;
  const unders = completed.filter((g) => g.totalResult === "UNDER").length;
  const ouPush = completed.filter((g) => g.totalResult === "PUSH").length;

  const ouStr = ouPush > 0
    ? `${overs}O–${unders}U–${ouPush}P`
    : `${overs}O–${unders}U`;

  console.log(
    `[MlbTeamSchedule][StatsSummary] team="${teamSlug}"` +
    ` | record=${wins}-${losses}` +
    ` | rlCover=${covered}-${notCovered}` +
    ` | ou=${ouStr}` +
    ` | games=${completed.length}`
  );

  const stats = [
    {
      label: "RECORD",
      node: (
        <span className="text-xs sm:text-sm font-bold text-white font-mono">
          {wins}–{losses}
        </span>
      ),
    },
    {
      label: "RL COVER",
      node: (
        <span className="font-mono text-xs sm:text-sm font-bold">
          <span className="text-green-400">{covered}</span>
          <span className="text-gray-500 mx-0.5">–</span>
          <span className="text-red-400">{notCovered}</span>
        </span>
      ),
    },
    {
      label: "O/U",
      node: (
        <span className="font-mono text-xs sm:text-sm font-bold">
          <span className="text-green-400">{overs}O</span>
          <span className="text-gray-500 mx-0.5">–</span>
          <span className="text-red-400">{unders}U</span>
          {ouPush > 0 && (
            <>
              <span className="text-gray-500 mx-0.5">–</span>
              <span className="text-yellow-400">{ouPush}P</span>
            </>
          )}
        </span>
      ),
    },
    {
      label: "GAMES",
      node: (
        <span className="text-xs sm:text-sm font-bold text-white font-mono">
          {completed.length}
        </span>
      ),
    },
  ];

  return (
    // Single row — flex-nowrap, overflow-x-auto if screen is very narrow
    <div className="flex items-center gap-2 sm:gap-3 mb-4 overflow-x-auto pb-1">
      {stats.map(({ label, node }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 flex-shrink-0"
        >
          <span className="text-[9px] sm:text-[10px] text-gray-400 font-mono whitespace-nowrap">
            {label}
          </span>
          {node}
        </div>
      ))}
    </div>
  );
}

// ─── Schedule Table ───────────────────────────────────────────────────────────

function ScheduleTable({
  games,
  teamSlug,
  isUpcoming,
}: {
  games: ScheduleGame[];
  teamSlug: string;
  isUpcoming: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10 -mx-1 sm:mx-0">
      <table className="w-full text-left" style={{ minWidth: "480px" }}>
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            <th className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest whitespace-nowrap">DATE</th>
            <th className="px-1 sm:px-2 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest text-center whitespace-nowrap">LOC</th>
            <th className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest">OPP</th>
            <th className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest text-center whitespace-nowrap">
              {isUpcoming ? "TIME" : "SCORE"}
            </th>
            <th className="px-1 sm:px-2 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest text-center">W/L</th>
            <th className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest whitespace-nowrap">RUN LINE</th>
            <th className="px-1 sm:px-2 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest text-center">COV</th>
            <th className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest">TOTAL</th>
            <th className="px-1 sm:px-2 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest text-center">O/U</th>
            <th className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-500 font-mono tracking-widest text-center">ML</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <ScheduleRow
              key={game.anGameId}
              game={game}
              teamSlug={teamSlug}
              isUpcoming={isUpcoming}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MlbTeamSchedule() {
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const teamSlug = params.slug ?? "";

  const teamInfo = MLB_BY_AN_SLUG.get(teamSlug);

  const { data, isLoading, error, refetch, isFetching } =
    trpc.mlbSchedule.getTeamSchedule.useQuery(
      { teamSlug },
      { enabled: !!teamSlug, staleTime: 2 * 60 * 1000 }
    );

  const games = (data?.games ?? []) as ScheduleGame[];

  // ── Status partitioning ──────────────────────────────────────────────────────
  // CRITICAL: "postponed" games are excluded from BOTH sections.
  // They have no score, no valid time, and no betting result to display.
  const completedGames = games.filter(isCompleteGame);
  const upcomingGames  = games.filter(isUpcomingGame);
  const postponedCount = games.filter((g) => g.gameStatus === POSTPONED_STATUS).length;

  console.log(
    `[MlbTeamSchedule] [STATE] team="${teamSlug}"` +
    ` | total=${games.length}` +
    ` | complete=${completedGames.length}` +
    ` | upcoming=${upcomingGames.length}` +
    ` | postponed=${postponedCount} (hidden from display)`
  );

  if (!teamSlug) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <p className="text-gray-400 font-mono text-sm">No team specified.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">

      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#0a0e1a]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3">

          {/* Back */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/feed")}
            className="text-gray-400 hover:text-white gap-1 sm:gap-1.5 -ml-1 sm:-ml-2 px-2 sm:px-3 flex-shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="text-[10px] sm:text-xs font-mono">BACK</span>
          </Button>

          {/* Team logo */}
          {teamInfo && (
            <img
              src={teamInfo.logoUrl}
              alt={teamInfo.abbrev}
              className="w-7 h-7 sm:w-8 sm:h-8 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}

          {/* Team name + season label */}
          <div className="flex-1 min-w-0">
            <h1 className="text-xs sm:text-sm font-bold text-white font-mono tracking-wide truncate leading-tight">
              {teamInfo?.name ?? teamSlug.replace(/-/g, " ").toUpperCase()}
            </h1>
            <p className="text-[9px] sm:text-[10px] text-gray-500 font-mono leading-tight">
              2026 MLB SCHEDULE
            </p>
          </div>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-gray-400 hover:text-white gap-1 sm:gap-1.5 flex-shrink-0 px-2 sm:px-3"
          >
            <RefreshCw className={cn("w-3 h-3 sm:w-3.5 sm:h-3.5", isFetching && "animate-spin")} />
            <span className="text-[10px] sm:text-xs font-mono hidden sm:inline">REFRESH</span>
          </Button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 sm:py-20">
            <div className="text-center">
              <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 animate-spin mx-auto mb-3" />
              <p className="text-gray-400 font-mono text-xs sm:text-sm">Loading schedule...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 sm:p-4 mb-4">
            <p className="text-red-400 font-mono text-xs sm:text-sm">
              Error loading schedule: {error.message}
            </p>
          </div>
        )}

        {/* No data */}
        {!isLoading && !error && games.length === 0 && (
          <div className="text-center py-16 sm:py-20">
            <Calendar className="w-7 h-7 sm:w-8 sm:h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 font-mono text-xs sm:text-sm">
              No 2026 schedule data available.
            </p>
            <p className="text-gray-600 font-mono text-[10px] sm:text-xs mt-1">
              Run a backfill from the admin panel to populate data.
            </p>
          </div>
        )}

        {/* Stats summary — single row */}
        {!isLoading && completedGames.length > 0 && (
          <StatsSummary games={games} teamSlug={teamSlug} />
        )}

        {/* Upcoming / Live — excludes postponed */}
        {!isLoading && upcomingGames.length > 0 && (
          <div className="mb-5 sm:mb-6">
            <div className="flex items-center gap-2 mb-2.5 sm:mb-3">
              <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400 flex-shrink-0" />
              <h2 className="text-[10px] sm:text-xs font-bold text-blue-400 font-mono tracking-widest uppercase">
                Upcoming / Live
              </h2>
              <span className="text-[10px] sm:text-xs text-gray-600 font-mono">
                ({upcomingGames.length})
              </span>
            </div>
            <ScheduleTable
              games={upcomingGames}
              teamSlug={teamSlug}
              isUpcoming={true}
            />
          </div>
        )}

        {/* Completed Games */}
        {!isLoading && completedGames.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5 sm:mb-3">
              <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 flex-shrink-0" />
              <h2 className="text-[10px] sm:text-xs font-bold text-gray-400 font-mono tracking-widest uppercase">
                Completed Games
              </h2>
              <span className="text-[10px] sm:text-xs text-gray-600 font-mono">
                ({completedGames.length})
              </span>
            </div>
            <ScheduleTable
              games={completedGames}
              teamSlug={teamSlug}
              isUpcoming={false}
            />
          </div>
        )}

      </div>
    </div>
  );
}

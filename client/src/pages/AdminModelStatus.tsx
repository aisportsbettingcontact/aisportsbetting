/**
 * AdminModelStatus.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner-only admin page showing real-time MLB and NHL model pipeline health.
 *
 * Displays per-game status for today + tomorrow:
 *   - Matchup, game date, game status
 *   - Pitchers / Goalies (with confirmation status)
 *   - Model scores and projected lines
 *   - Modeled (green/red) and Published (green/red) indicators
 *   - modelRunAt timestamp
 *
 * Auto-refreshes every 30 seconds.
 * Route: /admin/model-status
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtOdds(v: number | null | undefined): string {
  if (v == null) return "—";
  return v > 0 ? `+${v}` : `${v}`;
}

function fmtScore(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtTs(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  }) + " ET";
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={
        ok
          ? "border-green-500 text-green-400 bg-green-950/40 font-mono text-xs"
          : "border-red-500 text-red-400 bg-red-950/40 font-mono text-xs"
      }
    >
      {ok ? "✓" : "✗"} {label}
    </Badge>
  );
}

// ─── MLB Table ───────────────────────────────────────────────────────────────

function MlbStatusTable({ games, dates }: { games: any[]; dates: string[] }) {
  if (games.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-8 text-sm">
        No MLB games found for {dates.join(", ")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="border-b border-zinc-700 text-zinc-400 text-left">
            <th className="py-2 px-3 whitespace-nowrap">Date</th>
            <th className="py-2 px-3 whitespace-nowrap">Matchup</th>
            <th className="py-2 px-3 whitespace-nowrap">Away SP</th>
            <th className="py-2 px-3 whitespace-nowrap">Home SP</th>
            <th className="py-2 px-3 whitespace-nowrap">Lineup</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Away</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Home</th>
            <th className="py-2 px-3 whitespace-nowrap">Model ML</th>
            <th className="py-2 px-3 whitespace-nowrap">Model Total</th>
            <th className="py-2 px-3 whitespace-nowrap">Modeled At</th>
            <th className="py-2 px-3 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g: any) => {
            const lu = g.lineup;
            const awayConf = lu?.awayLineupConfirmed;
            const homeConf = lu?.homeLineupConfirmed;
            const lineupStatus =
              awayConf && homeConf
                ? "CONFIRMED"
                : awayConf || homeConf
                ? "PARTIAL"
                : lu
                ? "EXPECTED"
                : "NONE";
            const lineupColor =
              lineupStatus === "CONFIRMED"
                ? "text-green-400"
                : lineupStatus === "PARTIAL"
                ? "text-yellow-400"
                : lineupStatus === "EXPECTED"
                ? "text-blue-400"
                : "text-zinc-500";

            return (
              <tr
                key={g.id}
                className="border-b border-zinc-800 hover:bg-zinc-800/30 transition-colors"
              >
                <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{g.gameDate}</td>
                <td className="py-2 px-3 text-white font-semibold whitespace-nowrap">
                  {g.awayTeam} @ {g.homeTeam}
                </td>
                <td className="py-2 px-3 text-zinc-300 whitespace-nowrap max-w-[120px] truncate">
                  {lu?.awayPitcherName ?? g.awayStartingPitcher ?? "—"}
                </td>
                <td className="py-2 px-3 text-zinc-300 whitespace-nowrap max-w-[120px] truncate">
                  {lu?.homePitcherName ?? g.homeStartingPitcher ?? "—"}
                </td>
                <td className={`py-2 px-3 whitespace-nowrap font-semibold ${lineupColor}`}>
                  {lineupStatus}
                </td>
                <td className="py-2 px-3 text-cyan-300 whitespace-nowrap">
                  {fmtScore(g.modelAwayScore)}
                </td>
                <td className="py-2 px-3 text-cyan-300 whitespace-nowrap">
                  {fmtScore(g.modelHomeScore)}
                </td>
                <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                  {fmtOdds(g.modelAwayML)} / {fmtOdds(g.modelHomeML)}
                </td>
                <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                  {g.modelTotal != null ? `O/U ${g.modelTotal}` : "—"}
                </td>
                <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">
                  {fmtTs(g.modelRunAt)}
                </td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <div className="flex gap-1 flex-wrap">
                    <StatusBadge ok={g.modeled} label="MODELED" />
                    <StatusBadge ok={g.published} label="PUBLISHED" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── NHL Table ───────────────────────────────────────────────────────────────

function NhlStatusTable({ games, dates }: { games: any[]; dates: string[] }) {
  if (games.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-8 text-sm">
        No NHL games found for {dates.join(", ")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="border-b border-zinc-700 text-zinc-400 text-left">
            <th className="py-2 px-3 whitespace-nowrap">Date</th>
            <th className="py-2 px-3 whitespace-nowrap">Matchup</th>
            <th className="py-2 px-3 whitespace-nowrap">Away Goalie</th>
            <th className="py-2 px-3 whitespace-nowrap">Home Goalie</th>
            <th className="py-2 px-3 whitespace-nowrap">Goalies</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Away</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Home</th>
            <th className="py-2 px-3 whitespace-nowrap">Model ML</th>
            <th className="py-2 px-3 whitespace-nowrap">Model Total</th>
            <th className="py-2 px-3 whitespace-nowrap">Modeled At</th>
            <th className="py-2 px-3 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g: any) => (
            <tr
              key={g.id}
              className="border-b border-zinc-800 hover:bg-zinc-800/30 transition-colors"
            >
              <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{g.gameDate}</td>
              <td className="py-2 px-3 text-white font-semibold whitespace-nowrap">
                {g.awayTeam} @ {g.homeTeam}
              </td>
              <td className="py-2 px-3 text-zinc-300 whitespace-nowrap max-w-[120px] truncate">
                {g.awayGoalie ?? "—"}
              </td>
              <td className="py-2 px-3 text-zinc-300 whitespace-nowrap max-w-[120px] truncate">
                {g.homeGoalie ?? "—"}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                <StatusBadge ok={g.bothGoalies} label={g.bothGoalies ? "BOTH" : "MISSING"} />
              </td>
              <td className="py-2 px-3 text-cyan-300 whitespace-nowrap">
                {fmtScore(g.modelAwayScore)}
              </td>
              <td className="py-2 px-3 text-cyan-300 whitespace-nowrap">
                {fmtScore(g.modelHomeScore)}
              </td>
              <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                {fmtOdds(g.modelAwayML)} / {fmtOdds(g.modelHomeML)}
              </td>
              <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                {g.modelTotal != null ? `O/U ${g.modelTotal}` : "—"}
              </td>
              <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">
                {fmtTs(g.modelRunAt)}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                <div className="flex gap-1 flex-wrap">
                  <StatusBadge ok={g.modeled} label="MODELED" />
                  <StatusBadge ok={g.published} label="PUBLISHED" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Summary Bar ─────────────────────────────────────────────────────────────

function SummaryBar({
  total,
  modeled,
  unmodeled,
  sport,
}: {
  total: number;
  modeled: number;
  unmodeled: number;
  sport: string;
}) {
  const pct = total > 0 ? Math.round((modeled / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4 text-sm mb-3">
      <span className="text-zinc-400 font-mono">
        {sport}: {total} games
      </span>
      <span className="text-green-400 font-mono font-semibold">
        ✓ {modeled} modeled
      </span>
      {unmodeled > 0 && (
        <span className="text-red-400 font-mono font-semibold">
          ✗ {unmodeled} unmodeled
        </span>
      )}
      <div className="flex-1 max-w-[200px] h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-zinc-400 font-mono text-xs">{pct}%</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminModelStatus() {
  const [tab, setTab] = useState<"mlb" | "nhl">("mlb");
  const [refreshKey, setRefreshKey] = useState(0);

  const mlbQuery = trpc.adminModelStatus.mlb.useQuery(
    {},
    {
      refetchInterval: 30_000,
      staleTime: 15_000,
    }
  );

  const nhlQuery = trpc.adminModelStatus.nhl.useQuery(
    {},
    {
      refetchInterval: 30_000,
      staleTime: 15_000,
    }
  );

  const handleRefresh = () => {
    mlbQuery.refetch();
    nhlQuery.refetch();
    setRefreshKey((k) => k + 1);
  };

  const mlbData = mlbQuery.data;
  const nhlData = nhlQuery.data;
  const lastUpdated = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Model Pipeline Status
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Today + Tomorrow · Auto-refreshes every 30s · Last updated: {lastUpdated} ET
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="border-zinc-600 text-zinc-300 hover:bg-zinc-800 font-mono text-xs"
        >
          ↻ Refresh Now
        </Button>
      </div>

      {/* Summary bars */}
      <div className="mb-4 space-y-1">
        {mlbData && (
          <SummaryBar
            sport="MLB"
            total={mlbData.total}
            modeled={mlbData.modeled}
            unmodeled={mlbData.unmodeled}
          />
        )}
        {nhlData && (
          <SummaryBar
            sport="NHL"
            total={nhlData.total}
            modeled={nhlData.modeled}
            unmodeled={nhlData.unmodeled}
          />
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "mlb" | "nhl")}>
        <TabsList className="bg-zinc-900 border border-zinc-700 mb-4">
          <TabsTrigger
            value="mlb"
            className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 font-mono text-xs"
          >
            MLB{" "}
            {mlbData && (
              <span
                className={`ml-2 font-semibold ${
                  mlbData.unmodeled > 0 ? "text-red-400" : "text-green-400"
                }`}
              >
                {mlbData.modeled}/{mlbData.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="nhl"
            className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 font-mono text-xs"
          >
            NHL{" "}
            {nhlData && (
              <span
                className={`ml-2 font-semibold ${
                  nhlData.unmodeled > 0 ? "text-red-400" : "text-green-400"
                }`}
              >
                {nhlData.modeled}/{nhlData.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mlb">
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono text-zinc-300">
                MLB Games — Today + Tomorrow
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {mlbQuery.isLoading ? (
                <div className="text-center text-zinc-500 py-8 text-sm font-mono">
                  Loading MLB pipeline status…
                </div>
              ) : mlbQuery.isError ? (
                <div className="text-center text-red-400 py-8 text-sm font-mono">
                  Error loading MLB status: {mlbQuery.error?.message}
                </div>
              ) : (
                <MlbStatusTable
                  games={(mlbData?.games ?? []) as any[]}
                  dates={mlbData?.dates ?? []}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nhl">
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono text-zinc-300">
                NHL Games — Today + Tomorrow
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {nhlQuery.isLoading ? (
                <div className="text-center text-zinc-500 py-8 text-sm font-mono">
                  Loading NHL pipeline status…
                </div>
              ) : nhlQuery.isError ? (
                <div className="text-center text-red-400 py-8 text-sm font-mono">
                  Error loading NHL status: {nhlQuery.error?.message}
                </div>
              ) : (
                <NhlStatusTable
                  games={(nhlData?.games ?? []) as any[]}
                  dates={nhlData?.dates ?? []}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

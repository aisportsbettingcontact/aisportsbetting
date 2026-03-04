/**
 * PublishProjections — Owner-only page for entering model projections and publishing games.
 *
 * Layout:
 *  - Header with date selector and "Publish All" button
 *  - Filter tabs: All | Regular Season | Conference Tournament
 *  - Game rows: each shows book lines, inputs for model spread + total, and a publish toggle
 *
 * Access: owner role only (redirects non-owners to /dashboard)
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff, Send, ChevronLeft, CheckCircle2, Trophy, Calendar } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(t: string): string {
  const clean = t.replace(":", "").padStart(4, "0");
  let h = parseInt(clean.slice(0, 2));
  const m = clean.slice(2);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function spreadDisplay(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v as string);
  if (isNaN(n)) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function totalDisplay(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v as string);
  if (isNaN(n)) return "—";
  return `${n}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type GameRow = {
  id: number;
  awayTeam: string;
  homeTeam: string;
  awayBookSpread: string | null;
  homeBookSpread: string | null;
  bookTotal: string | null;
  awayModelSpread: string | null;
  homeModelSpread: string | null;
  modelTotal: string | null;
  spreadEdge: string | null;
  spreadDiff: string | null;
  totalEdge: string | null;
  totalDiff: string | null;
  publishedToFeed: boolean;
  startTimeEst: string;
  gameDate: string;
  gameType: "regular_season" | "conference_tournament";
  conference: string | null;
};

// ── Row component ─────────────────────────────────────────────────────────────

function GameProjectionRow({
  game,
  onSaved,
}: {
  game: GameRow;
  onSaved: () => void;
}) {
  // Local state for inputs — initialized from DB values
  const [awaySpread, setAwaySpread] = useState(game.awayModelSpread ?? "");
  const [homeSpread, setHomeSpread] = useState(game.homeModelSpread ?? "");
  const [modelTotal, setModelTotal] = useState(game.modelTotal ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateMutation = trpc.games.updateProjections.useMutation();
  const publishMutation = trpc.games.setPublished.useMutation();

  // Sync inputs when game data changes from server
  useEffect(() => {
    setAwaySpread(game.awayModelSpread ?? "");
    setHomeSpread(game.homeModelSpread ?? "");
    setModelTotal(game.modelTotal ?? "");
    setDirty(false);
  }, [game.awayModelSpread, game.homeModelSpread, game.modelTotal]);

  const handleChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  // When away spread changes, auto-compute home spread as inverse
  const handleAwaySpreadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAwaySpread(val);
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setHomeSpread(String(-n));
    }
    setDirty(true);
  };

  const handleHomeSpreadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHomeSpread(val);
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setAwaySpread(String(-n));
    }
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const awayN = parseFloat(awaySpread);
      const homeN = parseFloat(homeSpread);
      const totalN = parseFloat(modelTotal);

      // Compute edge labels and diffs
      const awayBook = parseFloat(game.awayBookSpread ?? "");
      const homeBook = parseFloat(game.homeBookSpread ?? "");
      const bookTot = parseFloat(game.bookTotal ?? "");

      let spreadEdge: string | null = null;
      let spreadDiff: string | null = null;
      let totalEdge: string | null = null;
      let totalDiffVal: string | null = null;

      if (!isNaN(awayN) && !isNaN(homeN) && !isNaN(awayBook) && !isNaN(homeBook)) {
        // Spread edge: which team has model line better than book?
        const awayDiff = awayBook - awayN; // positive = model likes away more than book
        const homeDiff = homeBook - homeN;
        const bestDiff = Math.abs(awayDiff) >= Math.abs(homeDiff) ? awayDiff : homeDiff;
        const edgeTeam = Math.abs(awayDiff) >= Math.abs(homeDiff) ? game.awayTeam : game.homeTeam;
        const edgeSpread = Math.abs(awayDiff) >= Math.abs(homeDiff) ? awayN : homeN;

        if (Math.abs(bestDiff) > 0) {
          spreadEdge = `${edgeTeam} (${edgeSpread > 0 ? "+" : ""}${edgeSpread})`;
          spreadDiff = String(Math.abs(bestDiff));
        } else {
          spreadEdge = "PASS";
          spreadDiff = "0";
        }
      }

      if (!isNaN(totalN) && !isNaN(bookTot)) {
        const diff = totalN - bookTot;
        if (diff > 0) {
          totalEdge = `OVER ${totalN}`;
          totalDiffVal = String(Math.abs(diff));
        } else if (diff < 0) {
          totalEdge = `UNDER ${totalN}`;
          totalDiffVal = String(Math.abs(diff));
        } else {
          totalEdge = "PASS";
          totalDiffVal = "0";
        }
      }

      await updateMutation.mutateAsync({
        id: game.id,
        awayModelSpread: awaySpread || null,
        homeModelSpread: homeSpread || null,
        modelTotal: modelTotal || null,
        spreadEdge,
        spreadDiff,
        totalEdge,
        totalDiff: totalDiffVal,
      });

      setDirty(false);
      toast.success(`Saved ${game.awayTeam} @ ${game.homeTeam}`);
      onSaved();
    } catch {
      toast.error("Failed to save projections");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async () => {
    try {
      await publishMutation.mutateAsync({ id: game.id, published: !game.publishedToFeed });
      toast.success(game.publishedToFeed ? "Unpublished" : "Published to feed");
      onSaved();
    } catch {
      toast.error("Failed to update publish status");
    }
  };

  const isPublished = game.publishedToFeed;
  const hasModel = (game.awayModelSpread || game.homeModelSpread) && game.modelTotal;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "hsl(var(--card))",
        border: `1px solid ${isPublished ? "hsl(142 71% 45% / 0.4)" : "hsl(var(--border))"}`,
        borderLeft: `3px solid ${isPublished ? "#39FF14" : hasModel ? "#FFB800" : "hsl(var(--border))"}`,
      }}
    >
      {/* Game header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: "hsl(var(--background))", borderBottom: "1px solid hsl(var(--border))" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
            {game.awayTeam} <span style={{ color: "hsl(var(--muted-foreground))" }}>@</span> {game.homeTeam}
          </span>
          {game.gameType === "conference_tournament" && game.conference && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4" style={{ color: "#FFB800", borderColor: "#FFB800" }}>
              <Trophy size={8} className="mr-0.5" />
              {game.conference}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            {formatTime(game.startTimeEst)}
          </span>
          {isPublished && (
            <Badge className="text-[10px] px-1.5 py-0 h-4 bg-green-500/20 text-green-400 border-green-500/30">
              Live
            </Badge>
          )}
        </div>
      </div>

      {/* Odds + inputs */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Column headers */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
          <div className="text-[10px] uppercase tracking-widest text-center" style={{ color: "#D3D3D3" }}>Book Spread</div>
          <div className="text-[10px] uppercase tracking-widest text-center" style={{ color: "#D3D3D3" }}>Book O/U</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-center" style={{ color: "#39FF14" }}>Model Spread</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-center" style={{ color: "#39FF14" }}>Model O/U</div>
          <div className="w-16" />
        </div>

        {/* Away row */}
        <div className="grid items-center gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
          <div className="text-center text-sm font-mono" style={{ color: "hsl(var(--foreground))" }}>
            {spreadDisplay(game.awayBookSpread)}
          </div>
          <div className="text-center text-sm font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
            {totalDisplay(game.bookTotal)}
          </div>
          <Input
            value={awaySpread}
            onChange={handleAwaySpreadChange}
            placeholder="-3.5"
            className="h-7 text-xs text-center font-mono"
            style={{ background: "hsl(var(--background))", borderColor: dirty ? "#39FF14" : undefined }}
          />
          <Input
            value={modelTotal}
            onChange={handleChange(setModelTotal)}
            placeholder="142.5"
            className="h-7 text-xs text-center font-mono"
            style={{ background: "hsl(var(--background))", borderColor: dirty ? "#39FF14" : undefined }}
          />
          <div className="w-16 flex items-center justify-end gap-1">
            {dirty && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="h-7 px-2 text-xs"
                style={{ background: "#39FF14", color: "#000" }}
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
              </Button>
            )}
          </div>
        </div>

        {/* Home row */}
        <div className="grid items-center gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
          <div className="text-center text-sm font-mono" style={{ color: "hsl(var(--foreground))" }}>
            {spreadDisplay(game.homeBookSpread)}
          </div>
          <div className="text-center text-sm font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
            {totalDisplay(game.bookTotal)}
          </div>
          <Input
            value={homeSpread}
            onChange={handleHomeSpreadChange}
            placeholder="+3.5"
            className="h-7 text-xs text-center font-mono"
            style={{ background: "hsl(var(--background))", borderColor: dirty ? "#39FF14" : undefined }}
          />
          <div className="text-center text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
            {modelTotal ? `${modelTotal}` : "—"}
          </div>
          <div className="w-16 flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTogglePublish}
              disabled={publishMutation.isPending}
              className="h-7 px-2 text-xs gap-1"
              style={isPublished
                ? { borderColor: "#39FF14", color: "#39FF14", background: "transparent" }
                : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }
              }
            >
              {publishMutation.isPending
                ? <Loader2 size={10} className="animate-spin" />
                : isPublished
                  ? <><Eye size={10} /> Live</>
                  : <><EyeOff size={10} /> Off</>
              }
            </Button>
          </div>
        </div>

        {/* Edge preview (if model data exists) */}
        {hasModel && (game.spreadEdge || game.totalEdge) && (
          <div className="flex gap-3 pt-1" style={{ borderTop: "1px solid hsl(var(--border) / 0.4)" }}>
            {game.spreadEdge && game.spreadEdge !== "PASS" && (
              <span className="text-[10px]" style={{ color: "#FFB800" }}>
                Spread: {game.spreadEdge} ({game.spreadDiff && `+${game.spreadDiff}`})
              </span>
            )}
            {game.totalEdge && game.totalEdge !== "PASS" && (
              <span className="text-[10px]" style={{ color: "#FFB800" }}>
                Total: {game.totalEdge} ({game.totalDiff && `+${game.totalDiff}`})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PublishProjections() {
  const [, setLocation] = useLocation();
  const { appUser, isOwner, loading: authLoading } = useAppAuth();
  const [filter, setFilter] = useState<"all" | "regular_season" | "conference_tournament">("all");
  const [gameDate] = useState("2026-03-04");

  // Redirect non-owners
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      setLocation("/dashboard");
    }
  }, [authLoading, appUser, isOwner, setLocation]);

  const {
    data: games,
    isLoading,
    refetch,
  } = trpc.games.listStaging.useQuery(
    { gameDate },
    { enabled: !!appUser && isOwner, refetchOnWindowFocus: false }
  );

  const publishAllMutation = trpc.games.publishAll.useMutation({
    onSuccess: () => {
      toast.success("All games published to feed!");
      refetch();
    },
    onError: () => toast.error("Failed to publish all games"),
  });

  const handleRefetch = useCallback(() => { refetch(); }, [refetch]);

  const filtered = games?.filter((g) => {
    if (filter === "all") return true;
    return g.gameType === filter;
  }) ?? [];

  const publishedCount = games?.filter((g) => g.publishedToFeed).length ?? 0;
  const totalCount = games?.length ?? 0;
  const withModelCount = games?.filter((g) => g.awayModelSpread || g.modelTotal).length ?? 0;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(var(--background))" }}>
        <Loader2 className="animate-spin" style={{ color: "#39FF14" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      {/* Top bar */}
      <div
        className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3"
        style={{ background: "hsl(var(--card))", borderBottom: "1px solid hsl(var(--border))" }}
      >
        <button
          onClick={() => setLocation("/dashboard")}
          className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
        >
          <ChevronLeft size={18} style={{ color: "hsl(var(--muted-foreground))" }} />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>
            Publish Model Projections
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Calendar size={10} style={{ color: "hsl(var(--muted-foreground))" }} />
            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              March 4, 2026
            </span>
            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
            <span className="text-[11px]" style={{ color: "#39FF14" }}>
              {publishedCount}/{totalCount} live
            </span>
            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
            <span className="text-[11px]" style={{ color: "#FFB800" }}>
              {withModelCount} with model
            </span>
          </div>
        </div>

        <Button
          size="sm"
          onClick={() => publishAllMutation.mutate({ gameDate })}
          disabled={publishAllMutation.isPending || totalCount === 0}
          className="gap-1.5 text-xs h-8"
          style={{ background: "#39FF14", color: "#000" }}
        >
          {publishAllMutation.isPending
            ? <Loader2 size={12} className="animate-spin" />
            : <Send size={12} />
          }
          Publish All
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="px-4 pt-3 pb-2 flex gap-2">
        {(["all", "regular_season", "conference_tournament"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all"
            style={filter === f
              ? { background: "#39FF14", color: "#000" }
              : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
            }
          >
            {f === "all" ? `All (${totalCount})` : f === "regular_season" ? "Regular Season" : "Conf. Tournament"}
          </button>
        ))}
      </div>

      {/* Game list */}
      <div className="px-4 pb-8 space-y-3 mt-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin" style={{ color: "#39FF14" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
            No games found
          </div>
        ) : (
          filtered.map((game) => (
            <GameProjectionRow
              key={game.id}
              game={game as GameRow}
              onSaved={handleRefetch}
            />
          ))
        )}
      </div>
    </div>
  );
}

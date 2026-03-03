// Dashboard — MODEL PROJECTIONS main page
// Auto-syncs from Google Sheets on load, then shows live game data from DB

import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { User, LogOut, BarChart3, Loader2, RefreshCw, CheckCircle } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import { AgeModal } from "@/components/AgeModal";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [selectedSport, setSelectedSport] = useState("NCAAM");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const hasSynced = useRef(false);
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    const accepted = sessionStorage.getItem("age-accepted");
    if (!accepted) setShowAgeModal(true);
  }, []);

  // ─── Games query ──────────────────────────────────────────────────────────
  const { data: games, isLoading: gamesLoading, refetch: refetchGames } = trpc.games.list.useQuery(
    { sport: selectedSport },
    { refetchOnWindowFocus: false }
  );

  // ─── ESPN teams batch query (one call for all logos) ─────────────────────
  const { data: espnTeams } = trpc.teams.list.useQuery(
    { sport: selectedSport },
    { refetchOnWindowFocus: false, staleTime: 1000 * 60 * 60 }
  );

  // Build slug → logoUrl map
  const logoMap = (espnTeams ?? []).reduce<Record<string, string>>((acc, t) => {
    acc[t.slug] = t.logoUrl;
    return acc;
  }, {});

  // ─── Sheets sync mutation ─────────────────────────────────────────────────
  const syncMutation = trpc.sheets.syncLatest.useMutation({
    onSuccess: (data) => {
      setSyncStatus("done");
      refetchGames();
      if (data.gamesUpserted > 0) {
        toast.success("ALL NCAAM Games Updated");
      }
      // Reset status indicator after 3s
      setTimeout(() => setSyncStatus("idle"), 3000);
    },
    onError: (err) => {
      setSyncStatus("error");
      console.error("[Sheets sync error]", err);
      setTimeout(() => setSyncStatus("idle"), 3000);
    },
  });

  // Auto-sync on first mount
  useEffect(() => {
    if (!hasSynced.current) {
      hasSynced.current = true;
      setSyncStatus("syncing");
      syncMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRefresh = () => {
    setSyncStatus("syncing");
    syncMutation.mutate();
  };

  const handleAccept = () => {
    sessionStorage.setItem("age-accepted", "true");
    setShowAgeModal(false);
  };

  const handleCloseModal = () => {
    setShowAgeModal(false);
    setLocation("/");
  };

  const handleLogout = () => {
    sessionStorage.removeItem("age-accepted");
    setLocation("/");
    toast.success("Logged out successfully");
  };

  // Group games by date
  const gamesByDate = (games ?? []).reduce<Record<string, typeof games>>((acc, game) => {
    const date = game!.gameDate;
    if (!acc[date]) acc[date] = [];
    acc[date]!.push(game!);
    return acc;
  }, {});

  const sortedDates = Object.keys(gamesByDate).sort((a, b) => b.localeCompare(a));

  function formatDateHeader(dateStr: string): string {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  const sports = ["NCAAM"];
  const isLoading = gamesLoading || syncStatus === "syncing";

  return (
    <div className="min-h-screen bg-background">
      {showAgeModal && (
        <AgeModal onAccept={handleAccept} onClose={handleCloseModal} />
      )}

      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Top row: centered brand group | user icon right */}
        <div className="relative flex items-center px-4 py-2 max-w-3xl mx-auto">

          {/* Centered brand group: icon + PREZ BETS + AI MODEL PROJECTIONS */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            {/* Chart icon */}
            <BarChart3
              className="flex-shrink-0 text-primary"
              style={{ width: "clamp(14px, 2.5vw, 24px)", height: "clamp(14px, 2.5vw, 24px)" }}
            />
            {/* PREZ BETS — bold white */}
            <span
              className="font-black text-white whitespace-nowrap"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: "clamp(14px, 3.2vw, 26px)",
                letterSpacing: "0.08em",
              }}
            >
              PREZ BETS
            </span>
            {/* Divider dot */}
            <span className="text-border" style={{ fontSize: "clamp(10px, 2vw, 14px)" }}>|</span>
            {/* AI MODEL PROJECTIONS — light gray */}
            <span
              className="font-medium whitespace-nowrap"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: "clamp(12px, 2.6vw, 21px)",
                letterSpacing: "0.1em",
                color: "#9CA3AF",
              }}
            >
              AI MODEL PROJECTIONS
            </span>
          </div>

          {/* Invisible spacer to push user icon to the right */}
          <div className="flex-1" />

          {/* User menu — right */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* Sync status */}
            {syncStatus === "syncing" && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Syncing
              </span>
            )}
            {syncStatus === "done" && (
              <span className="text-[11px] text-green-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Updated
              </span>
            )}
            {/* Refresh button */}
            <button
              onClick={handleManualRefresh}
              disabled={syncStatus === "syncing"}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-40"
              title="Refresh from Google Sheets"
            >
              <RefreshCw className={`w-3 h-3 text-muted-foreground ${syncStatus === "syncing" ? "animate-spin" : ""}`} />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors"
                title={user ? user.name ?? "Account" : "Sign in"}
              >
                <User className="w-3.5 h-3.5 text-muted-foreground" />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-9 z-50 w-48 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                    {user ? (
                      <>
                        <div className="px-3 py-2.5 border-b border-border">
                          <p className="text-xs font-semibold text-foreground truncate">{user.name ?? "User"}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{user.email ?? ""}</p>
                        </div>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Sign out
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setShowUserMenu(false); setLocation("/login"); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        Sign in
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>


      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto pb-8">
        {isLoading && sortedDates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              {syncStatus === "syncing" ? "Syncing from Google Sheets…" : "Loading projections…"}
            </p>
          </div>
        ) : sortedDates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-6">
            <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">No projections available</p>
              <p className="text-xs text-muted-foreground">
                No games found for {selectedSport}. Try refreshing or selecting another sport.
              </p>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={syncStatus === "syncing"}
              className="mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {syncStatus === "syncing" ? "Syncing…" : "Refresh from Google Sheets"}
            </button>
          </div>
        ) : (
          sortedDates.map((date) => (
            <div key={date}>
              {/* Date section header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border sticky top-[45px] bg-background/95 backdrop-blur-sm z-10">
                <span
                  className="text-xs font-bold text-foreground tracking-widest uppercase"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                >
                  {formatDateHeader(date)}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/20">
                  {selectedSport}
                </span>
              </div>

              {/* Game Cards */}
              <div className="bg-card border-x border-border mx-0">
                {gamesByDate[date]!.map((game) => (
                  <GameCard key={game!.id} game={game!} logoMap={logoMap} />
                ))}
              </div>
            </div>
          ))
        )}

      </main>
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { User, LogOut, BarChart3, Loader2, Crown, Send, Search, X } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import { AgeModal } from "@/components/AgeModal";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { TEAM_NAMES } from "@/lib/teamNicknames";
import { getEspnLogoUrl } from "@/lib/espnTeamIds";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMilitaryTime(time: string | null | undefined): string {
  if (!time) return "TBD";
  const upper = time.trim().toUpperCase();
  if (upper === "TBD" || upper === "TBA" || upper === "") return "TBD";
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return "TBD";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix} ET`;
}

/** Convert HH:MM to a sortable number (minutes since midnight). TBD → 9999 */
function timeToMinutes(time: string | null | undefined): number {
  if (!time || time.toUpperCase() === "TBD" || time.toUpperCase() === "TBA") return 9999;
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return 9999;
  return h * 60 + m;
}

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

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── Search Dropdown Item ─────────────────────────────────────────────────────

function SearchResultItem({
  game,
  logoMap,
  onClick,
}: {
  game: NonNullable<ReturnType<typeof useMemo<any>>>[number];
  logoMap: Record<string, string>;
  onClick: () => void;
}) {
  const awayNames = TEAM_NAMES[game.awayTeam];
  const homeNames = TEAM_NAMES[game.homeTeam];
  const awaySchool = awayNames?.school ?? game.awayTeam.replace(/_/g, " ");
  const homeSchool = homeNames?.school ?? game.homeTeam.replace(/_/g, " ");
  const awayLogo = getEspnLogoUrl(game.awayTeam) ?? logoMap[game.awayTeam];
  const homeLogo = getEspnLogoUrl(game.homeTeam) ?? logoMap[game.homeTeam];
  const time = formatMilitaryTime(game.startTimeEst);
  const dateShort = formatDateShort(game.gameDate);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60 transition-colors text-left border-b border-border/40 last:border-0"
    >
      {/* Team logos */}
      <div className="flex flex-col gap-0.5 flex-shrink-0">
        {[{ logo: awayLogo, name: awaySchool }, { logo: homeLogo, name: homeSchool }].map(({ logo, name }, i) => (
          <div key={i} className="w-5 h-5 rounded overflow-hidden bg-secondary flex items-center justify-center">
            {logo ? (
              <img src={logo} alt={name} className="w-full h-full object-contain" />
            ) : (
              <span className="text-[7px] font-bold text-muted-foreground">{name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
        ))}
      </div>

      {/* Matchup text */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">
          {awaySchool} <span className="text-muted-foreground font-normal">@</span> {homeSchool}
        </p>
        <p className="text-[10px] text-muted-foreground">{dateShort} · {time}</p>
      </div>

      {/* Spread pill */}
      {game.awayBookSpread && (
        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{game.awayBookSpread}</span>
      )}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [selectedSport] = useState("NCAAM");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { appUser, isOwner, loading: appAuthLoading, refetch: refetchAppUser } = useAppAuth();

  // Redirect to home (paywall) if not authenticated as app user
  useEffect(() => {
    if (!appAuthLoading && !appUser) {
      setLocation("/");
    }
  }, [appUser, appAuthLoading, setLocation]);

  // Show Age modal if user has not yet accepted terms (DB-backed)
  useEffect(() => {
    if (!appAuthLoading && appUser && !appUser.termsAccepted) {
      setShowAgeModal(true);
    }
  }, [appAuthLoading, appUser]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const acceptTermsMutation = trpc.appUsers.acceptTerms.useMutation({
    onSuccess: () => {
      refetchAppUser();
      setShowAgeModal(false);
    },
  });

  const appLogoutMutation = trpc.appUsers.logout.useMutation({
    onSuccess: () => {
      setLocation("/");
      toast.success("Signed out");
    },
  });
  const appLogout = () => appLogoutMutation.mutate();

  // ─── Games query ──────────────────────────────────────────────────────────
  const { data: games, isLoading: gamesLoading } = trpc.games.list.useQuery(
    { sport: selectedSport },
    { refetchOnWindowFocus: false }
  );

  // ─── ESPN teams batch query (one call for all logos) ─────────────────────
  const { data: espnTeams } = trpc.teams.list.useQuery(
    { sport: selectedSport },
    { refetchOnWindowFocus: false, staleTime: 1000 * 60 * 60 }
  );

  // Build slug → logoUrl map
  const logoMap = useMemo(() =>
    (espnTeams ?? []).reduce<Record<string, string>>((acc, t) => {
      acc[t.slug] = t.logoUrl;
      return acc;
    }, {}),
    [espnTeams]
  );

  const handleAccept = () => acceptTermsMutation.mutate();
  const handleCloseModal = () => appLogout();
  const handleLogout = () => appLogout();

  // ─── Search filtering ─────────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();

  const filteredGames = useMemo(() => {
    if (!games) return [];
    if (!q) return games;

    return games.filter((game) => {
      if (!game) return false;
      const awayNames = TEAM_NAMES[game.awayTeam];
      const homeNames = TEAM_NAMES[game.homeTeam];

      const awaySchool = (awayNames?.school ?? game.awayTeam).toLowerCase();
      const awayNick = (awayNames?.nickname ?? "").toLowerCase();
      const homeSchool = (homeNames?.school ?? game.homeTeam).toLowerCase();
      const homeNick = (homeNames?.nickname ?? "").toLowerCase();
      const awaySlug = game.awayTeam.toLowerCase().replace(/_/g, " ");
      const homeSlug = game.homeTeam.toLowerCase().replace(/_/g, " ");

      return (
        awaySchool.includes(q) ||
        awayNick.includes(q) ||
        awaySlug.includes(q) ||
        homeSchool.includes(q) ||
        homeNick.includes(q) ||
        homeSlug.includes(q)
      );
    });
  }, [games, q]);

  // ─── Dropdown results: sorted by date asc, then start time asc ───────────
  const dropdownResults = useMemo(() => {
    if (!q || !filteredGames.length) return [];
    return [...filteredGames].sort((a, b) => {
      const dateCmp = (a!.gameDate ?? "").localeCompare(b!.gameDate ?? "");
      if (dateCmp !== 0) return dateCmp;
      return timeToMinutes(a!.startTimeEst) - timeToMinutes(b!.startTimeEst);
    });
  }, [filteredGames, q]);

  const showDropdown = searchFocused && q.length > 0;

  // Group all games by date (for the normal feed view)
  const gamesByDate = useMemo(() =>
    (games ?? []).reduce<Record<string, NonNullable<typeof games>[number][]>>((acc, game) => {
      const date = game!.gameDate;
      if (!acc[date]) acc[date] = [];
      acc[date]!.push(game!);
      return acc;
    }, {}),
    [games]
  );

  const sortedDates = useMemo(() =>
    Object.keys(gamesByDate).sort((a, b) => a.localeCompare(b)),
    [gamesByDate]
  );

  // Scroll to a game card by id
  const scrollToGame = (gameId: number) => {
    setSearchFocused(false);
    setSearchQuery("");
    setTimeout(() => {
      const el = document.getElementById(`game-card-${gameId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid hsl(var(--primary))";
        el.style.borderRadius = "12px";
        setTimeout(() => { el.style.outline = ""; }, 2000);
      }
    }, 100);
  };

  return (
    <div className="min-h-screen bg-background">
      {showAgeModal && (
        <AgeModal onAccept={handleAccept} onClose={handleCloseModal} />
      )}

      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Top row: centered brand | user icon right */}
        <div className="relative flex items-center px-4 py-2 max-w-3xl mx-auto">

          {/* Centered brand group */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <BarChart3
              className="flex-shrink-0 text-primary"
              style={{ width: "clamp(14px, 2.5vw, 24px)", height: "clamp(14px, 2.5vw, 24px)" }}
            />
            <span
              className="font-black text-white whitespace-nowrap"
              style={{ fontSize: "clamp(14px, 3.2vw, 26px)", letterSpacing: "0.08em" }}
            >
              PREZ BETS
            </span>
            <span className="text-border" style={{ fontSize: "clamp(10px, 2vw, 14px)" }}>|</span>
            <span
              className="font-medium whitespace-nowrap"
              style={{ fontSize: "clamp(12px, 2.6vw, 21px)", letterSpacing: "0.1em", color: "#9CA3AF" }}
            >
              AI MODEL PROJECTIONS
            </span>
          </div>

          {/* Invisible spacer */}
          <div className="flex-1" />

          {/* Right: user menu only */}
          <div className="flex-shrink-0 flex items-center gap-2">
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
                    {appUser ? (
                      <>
                        <div className="px-3 py-2.5 border-b border-border">
                          <div className="flex items-center gap-1.5">
                            {appUser.role === "owner" && <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                            <p className="text-xs font-semibold text-foreground truncate">@{appUser.username}</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{appUser.email}</p>
                        </div>
                        {isOwner && (
                          <>
                            <button
                              onClick={() => { setShowUserMenu(false); setLocation("/admin/publish"); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            >
                              <Send className="w-3.5 h-3.5 text-green-400" />
                              Publish Projections
                            </button>
                            <button
                              onClick={() => { setShowUserMenu(false); setLocation("/admin/users"); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                            >
                              <Crown className="w-3.5 h-3.5 text-yellow-400" />
                              User Management
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setShowUserMenu(false); appLogout(); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Sign out
                        </button>
                      </>
                    ) : user ? (
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
        {gamesLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading projections…</p>
          </div>
        ) : (
          <>
            {/* ── Search bar — between header and first date group ── */}
            <div
              ref={searchRef}
              className="relative px-4 pt-3 pb-2 max-w-3xl mx-auto"
            >
              <div
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors"
                style={{
                  background: "hsl(var(--secondary))",
                  borderColor: searchFocused ? "hsl(var(--primary) / 0.6)" : "hsl(var(--border))",
                }}
              >
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search teams, schools, nicknames…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {searchQuery && (
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Dropdown results */}
              {showDropdown && (
                <div
                  className="absolute left-4 right-4 top-full mt-1 z-50 rounded-lg border border-border shadow-2xl overflow-hidden"
                  style={{ background: "hsl(var(--card))", maxHeight: "60vh", overflowY: "auto" }}
                >
                  {dropdownResults.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                      <Search className="w-6 h-6 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">No games found for "{searchQuery}"</p>
                    </div>
                  ) : (
                    <>
                      <div className="px-4 py-2 border-b border-border/60 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                          {dropdownResults.length} game{dropdownResults.length !== 1 ? "s" : ""} found
                        </span>
                        <span className="text-[10px] text-muted-foreground">tap to jump</span>
                      </div>
                      {dropdownResults.map((game) => (
                        <SearchResultItem
                          key={game!.id}
                          game={game!}
                          logoMap={logoMap}
                          onClick={() => scrollToGame(game!.id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Date groups ── */}
            {sortedDates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">No projections available</p>
                  <p className="text-xs text-muted-foreground">No NCAAM games found for today.</p>
                </div>
              </div>
            ) : (
              sortedDates.map((date) => (
                <div key={date}>
                  {/* Date section header */}
                  <div className="flex items-center px-4 py-2 border-b border-border sticky top-[45px] bg-background/95 backdrop-blur-sm z-10">
                    <div className="flex-1" />
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span
                        className="font-bold text-foreground tracking-widest uppercase"
                        style={{ fontSize: "clamp(11px, 2vw, 13px)" }}
                      >
                        {formatDateHeader(date)}
                      </span>
                      <span className="text-muted-foreground/40" style={{ fontSize: "10px" }}>·</span>
                      <span
                        className="font-semibold hidden sm:inline"
                        style={{ color: "#a3a3a3", letterSpacing: "0.06em", fontSize: "clamp(10px, 1.8vw, 12px)" }}
                      >
                        Men's College Basketball
                      </span>
                    </div>
                    <div className="flex-1" />
                  </div>

                  {/* Game Cards */}
                  <div className="bg-card border-x border-border mx-0">
                    {gamesByDate[date]!.map((game) => (
                      <div key={game!.id} id={`game-card-${game!.id}`}>
                        <GameCard game={game!} logoMap={logoMap} />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </main>
    </div>
  );
}

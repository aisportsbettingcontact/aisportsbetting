import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { User, LogOut, BarChart3, Loader2, Crown, Send, Search, X } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import { AgeModal } from "@/components/AgeModal";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { getTeamName } from "@/lib/teamNicknames";
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
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return dateStr; }
}

// ─── Team Logo Badge ──────────────────────────────────────────────────────────
function TeamBadge({ slug, logoMap, size = 22 }: { slug: string; logoMap: Record<string, string>; size?: number }) {
  const logo = getEspnLogoUrl(slug) ?? logoMap[slug];
  const names = getTeamName(slug);
  const initials = (names.school || slug.replace(/_/g, " ")).slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {logo ? (
        <img src={logo} alt={initials} className="w-full h-full object-contain" />
      ) : (
        <span style={{ fontSize: 7 }} className="font-bold text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

// ─── Search Result Row ────────────────────────────────────────────────────────
type GameRow = { id: number; awayTeam: string; homeTeam: string; gameDate: string; startTimeEst: string | null; awayBookSpread?: string | null };

function SearchResultRow({ game, logoMap, onClick }: { game: GameRow; logoMap: Record<string, string>; onClick: () => void }) {
  const awayNames = getTeamName(game.awayTeam);
  const homeNames = getTeamName(game.homeTeam);
  const awaySchool = awayNames.school;
  const awayNick = awayNames.nickname;
  const homeSchool = homeNames.school;
  const homeNick = homeNames.nickname;
  const time = formatMilitaryTime(game.startTimeEst);
  const dateShort = formatDateShort(game.gameDate);

  return (
    <button
      onClick={onClick}
      className="w-full hover:bg-white/5 active:bg-white/10 transition-colors text-left border-b border-white/8 last:border-0"
    >
      {/* ── Shared layout: works on all screen sizes ── */}
      <div className="flex flex-col px-3 py-2.5 gap-1">

        {/* Row 1: Away @ Home */}
        <div className="flex items-center w-full gap-2">

          {/* Away side: logo + name block */}
          <div className="flex items-center gap-2" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
            <TeamBadge slug={game.awayTeam} logoMap={logoMap} size={26} />
            <div className="flex flex-col" style={{ minWidth: 0, overflow: "hidden" }}>
              <span className="text-[12px] font-bold text-white leading-tight" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{awaySchool}</span>
              {awayNick && <span className="text-[10px] font-normal text-gray-400 leading-tight" style={{ whiteSpace: "nowrap", display: "block" }}>{awayNick}</span>}
            </div>
          </div>

          {/* @ separator — fixed width, centered */}
          <span className="text-[11px] text-gray-500 font-medium flex-shrink-0 w-5 text-center">@</span>

          {/* Home side: name block + logo */}
          <div className="flex items-center gap-2 justify-end" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
            <div className="flex flex-col items-end" style={{ minWidth: 0, overflow: "hidden" }}>
              <span className="text-[12px] font-bold text-white leading-tight" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{homeSchool}</span>
              {homeNick && <span className="text-[10px] font-normal text-gray-400 leading-tight" style={{ whiteSpace: "nowrap", display: "block" }}>{homeNick}</span>}
            </div>
            <TeamBadge slug={game.homeTeam} logoMap={logoMap} size={26} />
          </div>

        </div>

        {/* Row 2: Date · Time — right-aligned */}
        <div className="flex justify-end">
          <span className="text-[10px] text-gray-500 leading-tight">{dateShort} · {time}</span>
        </div>

      </div>
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
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(88);

  // Measure header height so date banners stick directly below it
  useEffect(() => {
    if (!headerRef.current) return;
    const obs = new ResizeObserver(() => {
      setHeaderHeight(headerRef.current?.offsetHeight ?? 88);
    });
    obs.observe(headerRef.current);
    setHeaderHeight(headerRef.current.offsetHeight);
    return () => obs.disconnect();
  }, []);
  const { user } = useAuth();
  const { appUser, isOwner, loading: appAuthLoading, refetch: refetchAppUser } = useAppAuth();

  useEffect(() => {
    if (!appAuthLoading && !appUser) setLocation("/");
  }, [appUser, appAuthLoading, setLocation]);

  useEffect(() => {
    if (!appAuthLoading && appUser && !appUser.termsAccepted) setShowAgeModal(true);
  }, [appAuthLoading, appUser]);

  // Close dropdown on outside click
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
    onSuccess: () => { refetchAppUser(); setShowAgeModal(false); },
  });

  const appLogoutMutation = trpc.appUsers.logout.useMutation({
    onSuccess: () => { setLocation("/"); toast.success("Signed out"); },
  });
  const appLogout = () => appLogoutMutation.mutate();

  // ─── Data queries ─────────────────────────────────────────────────────────
  const { data: games, isLoading: gamesLoading } = trpc.games.list.useQuery(
    { sport: selectedSport }, { refetchOnWindowFocus: false }
  );
  const { data: espnTeams } = trpc.teams.list.useQuery(
    { sport: selectedSport }, { refetchOnWindowFocus: false, staleTime: 1000 * 60 * 60 }
  );
  const logoMap = useMemo(() =>
    (espnTeams ?? []).reduce<Record<string, string>>((acc, t) => { acc[t.slug] = t.logoUrl; return acc; }, {}),
    [espnTeams]
  );

  // ─── Search ───────────────────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();

  const dropdownResults = useMemo(() => {
    if (!games || !q) return [];
    const filtered = games.filter((game) => {
      if (!game) return false;
      const awayNames = getTeamName(game.awayTeam);
      const homeNames = getTeamName(game.homeTeam);
      const terms = [
        awayNames.school,
        awayNames.nickname,
        game.awayTeam.replace(/_/g, " "),
        homeNames.school,
        homeNames.nickname,
        game.homeTeam.replace(/_/g, " "),
      ].map(s => s.toLowerCase());
      return terms.some(t => t.includes(q));
    });
    return [...filtered].sort((a, b) => {
      const dateCmp = (a!.gameDate ?? "").localeCompare(b!.gameDate ?? "");
      if (dateCmp !== 0) return dateCmp;
      return timeToMinutes(a!.startTimeEst) - timeToMinutes(b!.startTimeEst);
    });
  }, [games, q]);

  const showDropdown = searchFocused && q.length > 0;

  // ─── Feed grouping ────────────────────────────────────────────────────────
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
    Object.keys(gamesByDate).sort((a, b) => a.localeCompare(b)), [gamesByDate]
  );

  // ─── Navigate to game card with highlight animation ───────────────────────
  const scrollToGame = (gameId: number) => {
    setSearchFocused(false);
    setSearchQuery("");
    setTimeout(() => {
      const el = document.getElementById(`game-card-${gameId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Pulse highlight: green glow → fade out
      el.style.transition = "box-shadow 0.15s ease, outline 0.15s ease";
      el.style.outline = "2px solid #22c55e";
      el.style.borderRadius = "12px";
      el.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.3), 0 0 24px rgba(34,197,94,0.2)";
      // Pulse twice then fade
      let count = 0;
      const pulse = setInterval(() => {
        count++;
        if (count % 2 === 0) {
          el.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.3), 0 0 24px rgba(34,197,94,0.2)";
          el.style.outline = "2px solid #22c55e";
        } else {
          el.style.boxShadow = "0 0 0 2px rgba(34,197,94,0.15)";
          el.style.outline = "2px solid rgba(34,197,94,0.4)";
        }
        if (count >= 5) {
          clearInterval(pulse);
          setTimeout(() => {
            el.style.outline = "";
            el.style.boxShadow = "";
            el.style.borderRadius = "";
            el.style.transition = "";
          }, 600);
        }
      }, 300);
    }, 120);
  };

  return (
    <div className="min-h-screen bg-background">
      {showAgeModal && <AgeModal onAccept={() => acceptTermsMutation.mutate()} onClose={appLogout} />}

      {/* ── Sticky Header (brand + search bar + user icon) ── */}
      <header ref={headerRef} className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">

        {/* Row 1: brand + user icon */}
        <div className="relative flex items-center px-4 pt-2 pb-1 max-w-3xl mx-auto">
          {/* Centered brand */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <BarChart3
              className="flex-shrink-0 text-primary"
              style={{ width: "clamp(14px, 2.5vw, 22px)", height: "clamp(14px, 2.5vw, 22px)" }}
            />
            <span className="font-black text-white whitespace-nowrap" style={{ fontSize: "clamp(13px, 3vw, 22px)", letterSpacing: "0.08em" }}>
              PREZ BETS
            </span>
            <span className="text-border" style={{ fontSize: "clamp(10px, 2vw, 13px)" }}>|</span>
            <span className="font-medium whitespace-nowrap" style={{ fontSize: "clamp(11px, 2.4vw, 18px)", letterSpacing: "0.1em", color: "#9CA3AF" }}>
              AI MODEL PROJECTIONS
            </span>
          </div>
          <div className="flex-1" />
          {/* User menu */}
          <div className="flex-shrink-0 relative">
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
                          <button onClick={() => { setShowUserMenu(false); setLocation("/admin/publish"); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Send className="w-3.5 h-3.5 text-green-400" /> Publish Projections
                          </button>
                          <button onClick={() => { setShowUserMenu(false); setLocation("/admin/users"); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Crown className="w-3.5 h-3.5 text-yellow-400" /> User Management
                          </button>
                        </>
                      )}
                      <button onClick={() => { setShowUserMenu(false); appLogout(); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </>
                  ) : user ? (
                    <>
                      <div className="px-3 py-2.5 border-b border-border">
                        <p className="text-xs font-semibold text-foreground truncate">{user.name ?? "User"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{user.email ?? ""}</p>
                      </div>
                      <button onClick={() => { setShowUserMenu(false); appLogout(); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setShowUserMenu(false); setLocation("/login"); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                      Sign in
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Search bar (always visible, sticky with header) */}
        <div ref={searchRef} className="relative px-4 pb-2 max-w-3xl mx-auto">
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150"
            style={{
              background: "hsl(var(--secondary))",
              borderColor: searchFocused ? "rgba(34,197,94,0.5)" : "hsl(var(--border))",
              boxShadow: searchFocused ? "0 0 0 1px rgba(34,197,94,0.15)" : "none",
            }}
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search for Games"
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

          {/* ── Dropdown overlay ── */}
          {showDropdown && (
            <div
              className="absolute left-4 right-4 top-full mt-0.5 z-50 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
              style={{ background: "#0f0f0f", maxHeight: "calc(3 * 68px + 44px)", overflowY: "auto" }}
            >
              {/* Header row */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/8 bg-black/60 sticky top-0">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                  {dropdownResults.length === 0 ? "No results" : `${dropdownResults.length} game${dropdownResults.length !== 1 ? "s" : ""}`}
                </span>
                {dropdownResults.length > 0 && (
                  <span className="text-[10px] text-gray-600">tap to jump</span>
                )}
              </div>

              {dropdownResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <Search className="w-5 h-5 text-gray-600" />
                  <p className="text-xs text-gray-500">No games found for "{searchQuery}"</p>
                </div>
              ) : (
                dropdownResults.map((game) => (
                  <SearchResultRow
                    key={game!.id}
                    game={game!}
                    logoMap={logoMap}
                    onClick={() => scrollToGame(game!.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Main Feed ── */}
      <main className="max-w-3xl mx-auto pb-8">
        {gamesLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading projections…</p>
          </div>
        ) : sortedDates.length === 0 ? (
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
              <div className="flex items-center px-4 py-2 border-b border-border sticky bg-background/95 backdrop-blur-sm z-10" style={{ top: headerHeight }}>
                <div className="flex-1" />
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="font-bold text-foreground tracking-widest uppercase" style={{ fontSize: "clamp(11px, 2vw, 13px)" }}>
                    {formatDateHeader(date)}
                  </span>
                  <span className="text-muted-foreground/40" style={{ fontSize: "10px" }}>·</span>
                  <span className="font-semibold hidden sm:inline" style={{ color: "#a3a3a3", letterSpacing: "0.06em", fontSize: "clamp(10px, 1.8vw, 12px)" }}>
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
      </main>
    </div>
  );
}

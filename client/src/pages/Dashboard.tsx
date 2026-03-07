import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { User, LogOut, BarChart3, Loader2, Crown, Send, Search, X, Clock } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import { AgeModal } from "@/components/AgeModal";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { getTeamByDbSlug } from "@shared/ncaamTeams";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";

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

// ─── Team Logo Badge ──────────────────────────────────────────────────────────────────────────────
function TeamBadge({ slug, size = 22 }: { slug: string; size?: number }) {
  const ncaa = getTeamByDbSlug(slug);
  const nba = !ncaa ? getNbaTeamByDbSlug(slug) : null;
  const logo = ncaa?.logoUrl ?? nba?.logoUrl;
  const initials = (ncaa?.ncaaName ?? nba?.name ?? slug.replace(/_/g, " ")).slice(0, 2).toUpperCase();
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

function SearchResultRow({ game, onClick }: { game: GameRow; onClick: () => void }) {
  const awayNcaa = getTeamByDbSlug(game.awayTeam);
  const homeNcaa = getTeamByDbSlug(game.homeTeam);
  const awayNba = !awayNcaa ? getNbaTeamByDbSlug(game.awayTeam) : null;
  const homeNba = !homeNcaa ? getNbaTeamByDbSlug(game.homeTeam) : null;
  // For NBA: show city on line 1, nickname on line 2
  const awaySchool = awayNcaa?.ncaaName ?? awayNba?.city ?? game.awayTeam.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const awayNick = awayNcaa?.ncaaNickname ?? awayNba?.nickname ?? "";
  const homeSchool = homeNcaa?.ncaaName ?? homeNba?.city ?? game.homeTeam.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const homeNick = homeNcaa?.ncaaNickname ?? homeNba?.nickname ?? "";
  const time = formatMilitaryTime(game.startTimeEst);
  const dateShort = formatDateShort(game.gameDate);

  return (
    <button
      onClick={onClick}
      className="w-full hover:bg-white/5 active:bg-white/10 transition-colors text-left border-b border-white/8 last:border-0"
    >
      {/* 3-column layout: away | center(@+date) | home */}
      <div className="flex items-center px-3 py-2.5 gap-2">

        {/* Away side: logo + name block */}
        <div className="flex items-center gap-1.5 sm:gap-2" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
          <TeamBadge slug={game.awayTeam} size={22} />
          <div className="flex flex-col" style={{ minWidth: 0, overflow: "hidden" }}>
            <span className="font-bold text-white leading-tight sm:text-[12px]" style={{ fontSize: "clamp(9px, 2.6vw, 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{awaySchool}</span>
            {awayNick && <span className="font-normal text-gray-400 leading-tight sm:text-[10px]" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", whiteSpace: "nowrap", display: "block" }}>{awayNick}</span>}
          </div>
        </div>

        {/* Center column: @ on top, date·time below */}
        <div className="flex flex-col items-center flex-shrink-0" style={{ minWidth: 66 }}>
          <span className="text-[11px] text-gray-500 font-medium leading-tight">@</span>
          <span className="text-[9px] text-gray-500 leading-tight text-center whitespace-nowrap mt-0.5">{dateShort}</span>
          <span className="text-[9px] text-gray-500 leading-tight text-center whitespace-nowrap">{time}</span>
        </div>

        {/* Home side: name block + logo */}
        <div className="flex items-center gap-1.5 sm:gap-2 justify-end" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
          <div className="flex flex-col items-end" style={{ minWidth: 0, overflow: "hidden" }}>
            <span className="font-bold text-white leading-tight sm:text-[12px]" style={{ fontSize: "clamp(9px, 2.6vw, 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{homeSchool}</span>
            {homeNick && <span className="font-normal text-gray-400 leading-tight sm:text-[10px]" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", whiteSpace: "nowrap", display: "block" }}>{homeNick}</span>}
          </div>
          <TeamBadge slug={game.homeTeam} size={22} />
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
  const [selectedSport, setSelectedSport] = useState<"NCAAM" | "NBA">("NCAAM");
  const [selectedStatus, setSelectedStatus] = useState<"all" | "upcoming" | "live" | "final">("all");
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

  // Reset status filter when sport changes (NBA doesn't have status tracking yet)
  useEffect(() => {
    if (selectedSport === "NBA") setSelectedStatus("all");
  }, [selectedSport]);

  // ─── Data queries ─────────────────────────────────────────────────────────
  const { data: allGames, isLoading: gamesLoading } = trpc.games.list.useQuery(
    { sport: selectedSport }, { refetchOnWindowFocus: false }
  );

  // Count live games for the badge
  const liveCount = useMemo(() =>
    (allGames ?? []).filter(g => g?.gameStatus === 'live').length,
    [allGames]
  );

  // Apply status filter client-side (avoids extra network round-trip)
  const games = useMemo(() => {
    if (!allGames) return allGames;
    if (selectedStatus === 'all') return allGames;
    return allGames.filter(g => g?.gameStatus === selectedStatus);
  }, [allGames, selectedStatus]);
  const { data: lastRefresh } = trpc.games.lastRefresh.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  // Tick every 30s so "X min ago" stays current without a full re-fetch
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const splitsAgoLabel = useMemo(() => {
    if (!lastRefresh?.refreshedAt) return "—";
    const diffMs = now - new Date(lastRefresh.refreshedAt).getTime();
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1 min ago";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.round(diffMin / 60);
    return diffHr === 1 ? "1 hr ago" : `${diffHr} hrs ago`;
  }, [lastRefresh, now]);
  // ─── Search ───────────────────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();

  const dropdownResults = useMemo(() => {
    if (!games || !q) return [];
    const filtered = games.filter((game) => {
      if (!game) return false;
      const awayNcaa = getTeamByDbSlug(game.awayTeam);
      const homeNcaa = getTeamByDbSlug(game.homeTeam);
      const awayNba = !awayNcaa ? getNbaTeamByDbSlug(game.awayTeam) : null;
      const homeNba = !homeNcaa ? getNbaTeamByDbSlug(game.homeTeam) : null;
      const terms = [
        awayNcaa?.ncaaName ?? awayNba?.name ?? "",
        awayNcaa?.ncaaNickname ?? awayNba?.nickname ?? "",
        game.awayTeam.replace(/_/g, " "),
        homeNcaa?.ncaaName ?? homeNba?.name ?? "",
        homeNcaa?.ncaaNickname ?? homeNba?.nickname ?? "",
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

        {/* Row 2: Sport filter toggle + splits timestamp */}
        <div className="px-4 pb-1 max-w-3xl mx-auto flex items-center gap-2">
          {/* NCAAM button */}
          <button
            onClick={() => setSelectedSport("NCAAM")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "NCAAM"
              ? { background: "rgba(57,255,20,0.15)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.4)" }
              : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
            }
          >
            <img
              src="https://www.ncaa.com/march-madness-live/assets/icons/ncaa/disc.svg"
              alt="NCAA"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "NCAAM" ? 1 : 0.5 }}
            />
            NCAAM
          </button>
          {/* NBA button */}
          <button
            onClick={() => setSelectedSport("NBA")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "NBA"
              ? { background: "rgba(200,16,46,0.15)", color: "#C8102E", border: "1px solid rgba(200,16,46,0.5)" }
              : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
            }
          >
            <img
              src="https://cdn.nba.com/logos/leagues/logo-nba.svg"
              alt="NBA"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "NBA" ? 1 : 0.5 }}
            />
            NBA
          </button>
          {/* Splits timestamp — pushed to the right */}
          <div className="ml-auto flex items-center gap-1.5">
            <Clock style={{ width: 11, height: 11, flexShrink: 0, color: "#39FF14" }} />
            <span style={{ fontSize: 11, whiteSpace: "nowrap", color: "#39FF14", fontWeight: 700, letterSpacing: "0.03em" }}>
              Updated {splitsAgoLabel}
            </span>
          </div>
        </div>

        {/* Row 3: Status filter tabs (NCAAM only) */}
        {selectedSport === "NCAAM" && (
          <div className="px-4 pb-1 max-w-3xl mx-auto flex items-center gap-1.5">
            {([
              { key: "all", label: "ALL" },
              { key: "upcoming", label: "UPCOMING" },
              { key: "live", label: "LIVE" },
              { key: "final", label: "FINAL" },
            ] as const).map(({ key, label }) => {
              const isActive = selectedStatus === key;
              const isLive = key === "live";
              return (
                <button
                  key={key}
                  onClick={() => setSelectedStatus(key)}
                  className="relative flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide transition-all"
                  style={isActive
                    ? isLive
                      ? { background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.45)" }
                      : { background: "rgba(57,255,20,0.12)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.35)" }
                    : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
                  }
                >
                  {isLive && liveCount > 0 && (
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: 6, height: 6, flexShrink: 0,
                        background: isActive ? "#ef4444" : "#ef4444",
                        boxShadow: isActive ? "0 0 6px #ef4444" : "none",
                        animation: "pulse 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                  {label}
                  {isLive && liveCount > 0 && (
                    <span
                      className="ml-0.5 text-[10px] font-black"
                      style={{ color: isActive ? "#ef4444" : "hsl(var(--muted-foreground))" }}
                    >
                      {liveCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Row 4: Search bar (always visible, sticky with header) */}
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
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 sticky top-0" style={{ background: "#0f0f0f", zIndex: 10 }}>
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
            <p className="text-sm font-semibold text-foreground mb-1">No games found</p>
            <p className="text-xs text-muted-foreground">
              {selectedStatus !== 'all'
                ? `No ${selectedStatus} ${selectedSport} games right now.`
                : `No ${selectedSport} games found.`
              }
            </p>
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
                    {selectedSport === "NCAAM" ? "Men's College Basketball" : "NBA"}
                  </span>
                </div>
                <div className="flex-1" />
              </div>

              {/* Game Cards */}
              <div className="bg-card border-x border-border mx-0">
                {gamesByDate[date]!.map((game) => (
                  <div key={game!.id} id={`game-card-${game!.id}`}>
                    <GameCard game={game!} />
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

/**
 * BettingSplits page — full 4-sport (NHL, NBA, MLB, NCAAM) betting splits feed.
 *
 * Shows matchup/score + BETTING SPLITS for every game across all leagues.
 * Odds/lines model projections are intentionally hidden — use /feed for those.
 *
 * Sport selector order: MLB → NHL → NBA → NCAAM (matches feed display order)
 * NCAAM: Final Four only (Illinois/Connecticut/Michigan/Arizona on 04/04/2026)
 * Refresh: auto-refetch every 60s; VSiN cron runs every 10min (14:01–04:59 UTC)
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { User, LogOut, BarChart3, Loader2, Crown, Send, Search, X, Clock } from "lucide-react";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import { GameCard } from "@/components/GameCard";
import { AgeModal } from "@/components/AgeModal";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { getTeamByDbSlug } from "@shared/ncaamTeams";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";
import { NHL_BY_DB_SLUG } from "@shared/nhlTeams";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { Link } from "wouter";

// ─── CDN Icons ────────────────────────────────────────────────────────────────
const CDN_TEST_TUBE   = "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/icon-test-tube_0cb720ac.png";
const CDN_MONEY_BAG   = "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/icon-money-bag_b9c73c5d.png";
const CDN_MARCH_MADNESS = "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/icon-march-madness_ecd8f481.png";
const CDN_NBA         = "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/icon-nba_3fa4f508.png";
const NHL_LOGO_URL    = "https://media.d3.nhle.com/image/private/t_q-best/prd/assets/nhl/logos/nhl_shield_wm_on_dark_fqkbph";
const MLB_LOGO_URL    = "https://www.mlbstatic.com/team-logos/league-on-dark/1.svg";

// ─── Sport type ───────────────────────────────────────────────────────────────
type Sport = "MLB" | "NHL" | "NBA" | "NCAAM";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function effectiveGameDate(gameDate: string, _startTimeEst: string | null | undefined): string {
  return gameDate;
}

function sortableMinutes(time: string | null | undefined): number {
  return timeToMinutes(time);
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

/** Resolve display names for any sport */
function resolveTeamNames(slug: string, sport: Sport): { school: string; nick: string } {
  if (sport === "NCAAM") {
    const t = getTeamByDbSlug(slug);
    return { school: t?.ncaaName ?? slug.replace(/_/g, " "), nick: t?.ncaaNickname ?? "" };
  }
  if (sport === "NBA") {
    const t = getNbaTeamByDbSlug(slug);
    return { school: t?.city ?? slug.replace(/_/g, " "), nick: t?.nickname ?? "" };
  }
  if (sport === "NHL") {
    const t = NHL_BY_DB_SLUG.get(slug);
    return { school: t?.city ?? slug.replace(/_/g, " "), nick: t?.nickname ?? "" };
  }
  // MLB — slug is abbreviation (e.g. "NYY")
  const t = MLB_BY_ABBREV.get(slug.toUpperCase());
  return { school: t?.city ?? slug, nick: t?.nickname ?? "" };
}

/** Sport display label */
function sportLabel(sport: Sport): string {
  switch (sport) {
    case "MLB":   return "MLB BASEBALL";
    case "NHL":   return "NHL HOCKEY";
    case "NBA":   return "NBA BASKETBALL";
    case "NCAAM": return "MEN'S COLLEGE BASKETBALL";
  }
}

// ─── Team Logo Badge ──────────────────────────────────────────────────────────
function TeamBadge({ slug, sport, size = 22 }: { slug: string; sport: Sport; size?: number }) {
  let logo: string | undefined;
  if (sport === "NCAAM") logo = getTeamByDbSlug(slug)?.logoUrl;
  else if (sport === "NBA") logo = getNbaTeamByDbSlug(slug)?.logoUrl;
  else if (sport === "NHL") logo = NHL_BY_DB_SLUG.get(slug)?.logoUrl;
  else {
    const t = MLB_BY_ABBREV.get(slug.toUpperCase());
    logo = t?.logoUrl;
  }
  const { school } = resolveTeamNames(slug, sport);
  const initials = school.slice(0, 2).toUpperCase();
  return (
    <div className="rounded overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      {logo
        ? <img src={logo} alt={initials} className="w-full h-full object-contain" />
        : <span style={{ fontSize: 7 }} className="font-bold text-muted-foreground">{initials}</span>
      }
    </div>
  );
}

// ─── Search Result Row ────────────────────────────────────────────────────────
type GameRow = { id: number; awayTeam: string; homeTeam: string; gameDate: string; startTimeEst: string | null; awayBookSpread?: string | null };

function SearchResultRow({ game, sport, onClick }: { game: GameRow; sport: Sport; onClick: () => void }) {
  const away = resolveTeamNames(game.awayTeam, sport);
  const home = resolveTeamNames(game.homeTeam, sport);
  const time = formatMilitaryTime(game.startTimeEst);
  const dateShort = formatDateShort(game.gameDate);
  return (
    <button onClick={onClick} className="w-full hover:bg-white/5 active:bg-white/10 transition-colors text-left border-b border-white/8 last:border-0">
      <div className="flex items-center px-3 py-2.5 gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
          <TeamBadge slug={game.awayTeam} sport={sport} size={22} />
          <div className="flex flex-col" style={{ minWidth: 0, overflow: "hidden" }}>
            <span className="font-bold text-white leading-tight" style={{ fontSize: "clamp(9px, 2.6vw, 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{away.school}</span>
            {away.nick && <span className="font-normal text-gray-400 leading-tight" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", whiteSpace: "nowrap", display: "block" }}>{away.nick}</span>}
          </div>
        </div>
        <div className="flex flex-col items-center flex-shrink-0" style={{ minWidth: 66 }}>
          <span className="text-[11px] text-gray-500 font-medium leading-tight">@</span>
          <span className="text-[9px] text-gray-500 leading-tight text-center whitespace-nowrap mt-0.5">{dateShort}</span>
          <span className="text-[9px] text-gray-500 leading-tight text-center whitespace-nowrap">{time}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 justify-end" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
          <div className="flex flex-col items-end" style={{ minWidth: 0, overflow: "hidden" }}>
            <span className="font-bold text-white leading-tight" style={{ fontSize: "clamp(9px, 2.6vw, 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{home.school}</span>
            {home.nick && <span className="font-normal text-gray-400 leading-tight" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", whiteSpace: "nowrap", display: "block" }}>{home.nick}</span>}
          </div>
          <TeamBadge slug={game.homeTeam} sport={sport} size={22} />
        </div>
      </div>
    </button>
  );
}

// ─── Sport Pill ───────────────────────────────────────────────────────────────
function SportPill({ sport, selected, onClick, hasGames }: {
  sport: Sport; selected: boolean; onClick: () => void; hasGames: boolean;
}) {
  const activeStyle = { background: "transparent", color: "#ffffff", border: "1px solid rgba(255,255,255,0.6)" };
  const inactiveStyle = { background: "hsl(var(--card))", color: "rgba(255,255,255,0.45)", border: "1px solid hsl(var(--border))" };
  const dimStyle = { background: "hsl(var(--card))", color: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.08)" };

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full font-bold tracking-wide transition-all flex-shrink-0"
      style={{ fontSize: "clamp(10px, 2.5vw, 11px)", ...(selected ? activeStyle : hasGames ? inactiveStyle : dimStyle) }}
    >
      {sport === "MLB" && (
        <img src={MLB_LOGO_URL} alt="MLB" width={10} height={10} style={{ objectFit: "contain", opacity: selected ? 1 : 0.5, flexShrink: 0 }} />
      )}
      {sport === "NHL" && (
        <img src={NHL_LOGO_URL} alt="NHL" width={10} height={10} style={{ objectFit: "contain", opacity: selected ? 1 : 0.5, flexShrink: 0 }} />
      )}
      {sport === "NBA" && (
        <img src={CDN_NBA} alt="NBA" width={10} height={10} style={{ objectFit: "contain", opacity: selected ? 1 : 0.5, flexShrink: 0 }} />
      )}
      {sport === "NCAAM" && (
        <img src={CDN_MARCH_MADNESS} alt="NCAAM" width={12} height={10} style={{ objectFit: "contain", filter: selected ? "invert(1)" : "invert(0.45)", flexShrink: 0 }} />
      )}
      {sport === "NCAAM" ? "MARCH MADNESS" : sport}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BettingSplitsPage() {
  const [, setLocation] = useLocation();
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Default sport order: MLB → NHL → NBA → NCAAM (matches feed display order)
  const [selectedSport, setSelectedSport] = useState<Sport>("MLB");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<"upcoming" | "live" | "final">>(new Set());
  const [selectedDate, setSelectedDate] = useState<string>(() => todayUTC());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(88);

  useEffect(() => {
    if (!headerRef.current) return;
    const obs = new ResizeObserver(() => {
      setHeaderHeight(Math.ceil(headerRef.current?.getBoundingClientRect().height ?? 88));
    });
    obs.observe(headerRef.current);
    setHeaderHeight(Math.ceil(headerRef.current.getBoundingClientRect().height));
    return () => obs.disconnect();
  }, []);

  const { user } = useAuth();
  const { appUser, isOwner, loading: appAuthLoading, refetch: refetchAppUser } = useAppAuth();

  useEffect(() => { if (!appAuthLoading && !appUser) setLocation("/"); }, [appUser, appAuthLoading, setLocation]);
  useEffect(() => { if (!appAuthLoading && appUser && !appUser.termsAccepted) setShowAgeModal(true); }, [appAuthLoading, appUser]);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const acceptTermsMutation = trpc.appUsers.acceptTerms.useMutation({ onSuccess: () => { refetchAppUser(); setShowAgeModal(false); } });
  const appLogoutMutation = trpc.appUsers.logout.useMutation({ onSuccess: () => { setLocation("/"); toast.success("Signed out"); } });
  const appLogout = () => appLogoutMutation.mutate();

  // Reset filters when sport changes
  useEffect(() => { setSelectedStatuses(new Set()); setSelectedDate(todayUTC()); }, [selectedSport]);

  // Active sports — which leagues have games today/tomorrow
  const { data: activeSports } = trpc.games.activeSports.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  // Auto-switch to first active sport on load
  useEffect(() => {
    if (!activeSports) return;
    const sportActive = activeSports[selectedSport as keyof typeof activeSports];
    if (!sportActive) {
      const fallback = (["MLB", "NHL", "NBA", "NCAAM"] as const).find(s => activeSports[s as keyof typeof activeSports]);
      if (fallback) setSelectedSport(fallback);
    }
  }, [activeSports]);

  // Fetch all games for selected sport
  const { data: allGames, isLoading: gamesLoading } = trpc.games.list.useQuery(
    { sport: selectedSport },
    { refetchOnWindowFocus: false, refetchInterval: 60 * 1000, staleTime: 30 * 1000 }
  );

  // Last refresh timestamp
  const { data: lastRefresh } = trpc.games.lastRefresh.useQuery(undefined, { refetchInterval: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
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

  // Sort/filter helpers
  const parseLiveSortKey = (gameClock: string | null): [number, number] => {
    if (!gameClock) return [-1, 9999];
    const upper = gameClock.trim().toUpperCase();
    if (upper === "HALF" || upper === "HALFTIME") return [2, 0];
    const bareOtMatch = upper.match(/^(\d*)OT$/);
    if (bareOtMatch) { const otNum = bareOtMatch[1] ? parseInt(bareOtMatch[1]) : 1; return [50 + otNum, 0]; }
    const clockOtMatch = upper.match(/^(\d{1,2}):(\d{2})\s+(\d*)OT$/);
    if (clockOtMatch) { const mins = parseInt(clockOtMatch[1]!); const secs = parseInt(clockOtMatch[2]!); const otNum = clockOtMatch[3] ? parseInt(clockOtMatch[3]) : 1; return [50 + otNum, mins * 60 + secs]; }
    const clockMatch = upper.match(/^(\d{1,2}):(\d{2})\s+(\d+)(ST|ND|RD|TH)?$/);
    if (clockMatch) { const mins = parseInt(clockMatch[1]!); const secs = parseInt(clockMatch[2]!); const period = parseInt(clockMatch[3]!); return [period, mins * 60 + secs]; }
    return [-1, 9999];
  };

  const compareGames = (a: NonNullable<typeof allGames>[number], b: NonNullable<typeof allGames>[number]): number => {
    const statusOrder = (s: string | null | undefined) => s === "live" ? 0 : s === "upcoming" ? 1 : s === "final" ? 2 : 3;
    const sSortA = statusOrder(a?.gameStatus); const sSortB = statusOrder(b?.gameStatus);
    if (sSortA !== sSortB) return sSortA - sSortB;
    if (a?.gameStatus === "live" && b?.gameStatus === "live") {
      const [periodA, clockA] = parseLiveSortKey(a?.gameClock ?? null);
      const [periodB, clockB] = parseLiveSortKey(b?.gameClock ?? null);
      if (periodA !== periodB) return periodB - periodA;
      return clockA - clockB;
    }
    return sortableMinutes(a?.startTimeEst) - sortableMinutes(b?.startTimeEst);
  };

  // All unique dates available for the current sport (sorted ascending)
  const allDates = useMemo(() => {
    if (!allGames) return [];
    const dateSet = new Set<string>();
    for (const g of allGames) if (g) dateSet.add(effectiveGameDate(g.gameDate, g.startTimeEst));
    return Array.from(dateSet).sort();
  }, [allGames]);

  // Auto-advance to first available date if selected date has no games
  useEffect(() => {
    if (!allGames || allDates.length === 0) return;
    if (!allDates.includes(selectedDate)) {
      setSelectedDate(allDates[0]!);
    }
  }, [allGames, allDates, selectedDate]);

  const games = useMemo(() => {
    if (!allGames) return allGames;
    let working = selectedStatuses.size === 0 ? allGames : allGames.filter(g => selectedStatuses.has(g?.gameStatus as "upcoming" | "live" | "final"));
    working = working.filter(g => g && effectiveGameDate(g.gameDate, g.startTimeEst) === selectedDate);
    const byDate: Record<string, NonNullable<typeof allGames>[number][]> = {};
    for (const g of working) {
      const d = effectiveGameDate(g!.gameDate, g!.startTimeEst);
      if (!byDate[d]) byDate[d] = [];
      byDate[d]!.push(g!);
    }
    const result: NonNullable<typeof allGames>[number][] = [];
    for (const d of Object.keys(byDate).sort()) result.push(...byDate[d]!.sort(compareGames));
    return result;
  }, [allGames, selectedStatuses, selectedDate]);

  // Search
  const q = searchQuery.trim().toLowerCase();
  const dropdownResults = useMemo(() => {
    if (!games || !q) return [];
    return [...games.filter(game => {
      if (!game) return false;
      const away = resolveTeamNames(game.awayTeam, selectedSport);
      const home = resolveTeamNames(game.homeTeam, selectedSport);
      const terms = [away.school, away.nick, game.awayTeam.replace(/_/g, " "), home.school, home.nick, game.homeTeam.replace(/_/g, " ")].map(s => s.toLowerCase());
      return terms.some(t => t.includes(q));
    })].sort((a, b) => {
      const dateCmp = (a!.gameDate ?? "").localeCompare(b!.gameDate ?? "");
      if (dateCmp !== 0) return dateCmp;
      return timeToMinutes(a!.startTimeEst) - timeToMinutes(b!.startTimeEst);
    });
  }, [games, q, selectedSport]);

  const showDropdown = searchFocused && q.length > 0;

  const gamesByDate = useMemo(() =>
    (games ?? []).reduce<Record<string, NonNullable<typeof games>[number][]>>((acc, game) => {
      const date = effectiveGameDate(game!.gameDate, game!.startTimeEst);
      if (!acc[date]) acc[date] = [];
      acc[date]!.push(game!);
      return acc;
    }, {}), [games]);
  const sortedDates = useMemo(() => Object.keys(gamesByDate).sort((a, b) => a.localeCompare(b)), [gamesByDate]);

  const scrollToGame = (gameId: number) => {
    setSearchFocused(false); setSearchQuery("");
    setTimeout(() => {
      const el = document.getElementById(`game-card-${gameId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "box-shadow 0.15s ease, outline 0.15s ease";
      el.style.outline = "2px solid #22c55e"; el.style.borderRadius = "12px";
      el.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.3), 0 0 24px rgba(34,197,94,0.2)";
      let count = 0;
      const pulse = setInterval(() => {
        count++;
        if (count % 2 === 0) { el.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.3), 0 0 24px rgba(34,197,94,0.2)"; el.style.outline = "2px solid #22c55e"; }
        else { el.style.boxShadow = "0 0 0 2px rgba(34,197,94,0.15)"; el.style.outline = "2px solid rgba(34,197,94,0.4)"; }
        if (count >= 5) { clearInterval(pulse); setTimeout(() => { el.style.outline = ""; el.style.boxShadow = ""; el.style.borderRadius = ""; el.style.transition = ""; }, 600); }
      }, 300);
    }, 120);
  };

  // Sport pills in display order: MLB → NHL → NBA → NCAAM
  const SPORT_ORDER: Sport[] = ["MLB", "NHL", "NBA", "NCAAM"];

  return (
    <div className="bg-background">
      {showAgeModal && <AgeModal onAccept={() => acceptTermsMutation.mutate()} onClose={appLogout} />}

      {/* ── Sticky Header ── */}
      <header ref={headerRef} className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm">

        {/* Row 1: brand + user icon */}
        <div className="relative flex items-center px-4 pt-2 pb-1">
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <BarChart3 className="flex-shrink-0 text-primary" style={{ width: "clamp(14px, 2.5vw, 22px)", height: "clamp(14px, 2.5vw, 22px)" }} />
            <span className="font-black text-white whitespace-nowrap" style={{ fontSize: "clamp(13px, 3vw, 22px)", letterSpacing: "0.08em" }}>PREZ BETS</span>
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
                          <button onClick={() => { setShowUserMenu(false); setLocation("/admin/publish"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Send className="w-3.5 h-3.5 text-green-400" /> Publish Projections
                          </button>
                          <button onClick={() => { setShowUserMenu(false); setLocation("/admin/users"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Crown className="w-3.5 h-3.5 text-yellow-400" /> User Management
                          </button>
                        </>
                      )}
                      <button onClick={() => { setShowUserMenu(false); appLogout(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </>
                  ) : user ? (
                    <>
                      <div className="px-3 py-2.5 border-b border-border">
                        <p className="text-xs font-semibold text-foreground truncate">{user.name ?? "User"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{user.email ?? ""}</p>
                      </div>
                      <button onClick={() => { setShowUserMenu(false); appLogout(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setShowUserMenu(false); setLocation("/login"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">Sign in</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Page tab bar — AI MODEL PROJECTIONS | BETTING SPLITS (active) */}
        <div className="flex w-full" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
          <Link href="/feed" className="flex-1">
            <button
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold tracking-wide transition-colors"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              <img src={CDN_TEST_TUBE} alt="Test tube" width={14} height={14} style={{ objectFit: "contain", filter: "invert(1)", opacity: 0.45 }} />
              <span>AI MODEL PROJECTIONS</span>
            </button>
          </Link>
          <Link href="/betting-splits" className="flex-1">
            <button
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold tracking-wide transition-colors relative"
              style={{ color: "#ffffff" }}
            >
              <img src={CDN_MONEY_BAG} alt="Money bag" width={14} height={14} style={{ objectFit: "contain", filter: "invert(1)" }} />
              <span>BETTING SPLITS</span>
              <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full" style={{ background: "#39FF14" }} />
            </button>
          </Link>
        </div>

        {/* Row 3: Filter bar — DATE | Sport pills | Search */}
        <div ref={searchRef} className="relative px-3 pt-1 pb-1 flex items-center gap-2 flex-wrap sm:flex-nowrap">

          {/* DATE picker */}
          <CalendarPicker
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            availableDates={new Set(allDates)}
            isAdmin={isOwner || user?.role === "admin"}
          />

          {/* Sport pills — MLB → NHL → NBA → NCAAM */}
          {SPORT_ORDER.map(sport => (
            <SportPill
              key={sport}
              sport={sport}
              selected={selectedSport === sport}
              onClick={() => setSelectedSport(sport)}
              hasGames={!activeSports || !!activeSports[sport as keyof typeof activeSports]}
            />
          ))}

          {/* Search bar */}
          <div className="flex-1 min-w-0" style={{ minWidth: 28 }}>
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-full border transition-all duration-150"
              style={{
                background: "hsl(var(--secondary))",
                borderColor: searchFocused ? "rgba(34,197,94,0.5)" : "hsl(var(--border))",
                boxShadow: searchFocused ? "0 0 0 1px rgba(34,197,94,0.15)" : "none",
              }}
            >
              <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
              />
              {searchQuery && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Search dropdown */}
          {showDropdown && (
            <div
              className="absolute left-3 right-3 top-full mt-0.5 z-50 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
              style={{ background: "#0f0f0f", maxHeight: "calc(3 * 68px + 44px)", overflowY: "auto" }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 sticky top-0" style={{ background: "#0f0f0f", zIndex: 10 }}>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                  {dropdownResults.length === 0 ? "No results" : `${dropdownResults.length} game${dropdownResults.length !== 1 ? "s" : ""}`}
                </span>
                {dropdownResults.length > 0 && <span className="text-[10px] text-gray-600">tap to jump</span>}
              </div>
              {dropdownResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <Search className="w-5 h-5 text-gray-600" />
                  <p className="text-xs text-gray-500">No games found for "{searchQuery}"</p>
                </div>
              ) : dropdownResults.map((game) => (
                <SearchResultRow key={game!.id} game={game!} sport={selectedSport} onClick={() => scrollToGame(game!.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Row 4: Date header */}
        {!gamesLoading && sortedDates.length > 0 && (
          <div className="flex items-center px-4 py-1 border-b border-border bg-background/95">
            <div className="flex-1" />
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center">
              <span
                className="font-bold tracking-widest uppercase"
                style={{ fontSize: "clamp(11px, 3.5vw, 19px)", color: "#ffffff", whiteSpace: "nowrap" }}
              >{formatDateHeader(selectedDate)}</span>
              <span style={{ fontSize: "clamp(14px, 3.5vw, 22px)", color: "#ffffff", fontWeight: 800, lineHeight: 1, flexShrink: 0 }}>·</span>
              <span
                className="font-semibold"
                style={{ color: "#a3a3a3", letterSpacing: "0.06em", fontSize: "clamp(9px, 2.8vw, 17px)", textTransform: "uppercase", whiteSpace: "nowrap" }}
              >{sportLabel(selectedSport)}</span>
            </div>
            <div className="flex-1 flex justify-end">
              {lastRefresh?.refreshedAt && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>
                    splits {splitsAgoLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ── Main Feed ── */}
      <main className="w-full pb-1">
        {gamesLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading betting splits…</p>
          </div>
        ) : sortedDates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
            <img
              src={CDN_MONEY_BAG}
              alt="Money bag"
              width={40}
              height={40}
              style={{ objectFit: "contain", filter: "invert(1)", opacity: 0.4 }}
            />
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">No games found</p>
              <p className="text-xs text-muted-foreground">
                {selectedStatuses.size > 0
                  ? `No ${Array.from(selectedStatuses).join(" or ")} ${selectedSport} games on ${formatDateShort(selectedDate)}.`
                  : `No ${selectedSport} games found for ${formatDateShort(selectedDate)}.`
                }
              </p>
              {selectedSport === "NCAAM" && (
                <p className="text-xs text-muted-foreground mt-1 opacity-70">
                  NCAAM: Final Four only (Apr 4, 2026)
                </p>
              )}
            </div>
          </div>
        ) : (
          sortedDates.map((date) => (
            <div key={date}>
              <div className="bg-card mx-0">
                {gamesByDate[date]!.map((game) => (
                  <div key={game!.id} id={`game-card-${game!.id}`}>
                    <GameCard game={game!} mode="splits" />
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

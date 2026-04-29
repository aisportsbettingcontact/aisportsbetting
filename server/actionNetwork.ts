/**
 * actionNetwork.ts — Action Network v2 Scoreboard Slate Fetcher
 *
 * Fetches the daily game slate for a given sport + date from:
 *   https://api.actionnetwork.com/web/v2/scoreboard/{sport}?bookIds=...&date=YYYYMMDD&periods=event
 *
 * Each SlateGame includes:
 *   - Team abbreviations, full names, logo URLs (MLB.com SVG / ESPN CDN)
 *   - Live ML / RL (spread) / Total odds from book 123 (Caesars) → fallback 15 (DK) → 30 (FD)
 *
 * Performance strategy:
 *   1. In-memory cache keyed by "SPORT:YYYY-MM-DD" — 5-minute TTL
 *   2. In-flight deduplication: concurrent requests for the same key share one fetch
 *   3. Pre-warm: server startup calls prewarmSlateCache() for today's date across all sports
 *
 * Logging convention:
 *   [AN][INPUT]  — raw parameters received
 *   [AN][STEP]   — operation in progress
 *   [AN][STATE]  — intermediate computed values
 *   [AN][OUTPUT] — final result
 *   [AN][VERIFY] — validation pass/fail
 *   [AN][CACHE]  — cache hit / miss / evict
 *   [AN][ERROR]  — failure with context
 */

import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Constants ────────────────────────────────────────────────────────────────

/** AN sport slug map — BetTracker sport → AN URL slug */
const AN_SPORT_SLUG: Record<string, string> = {
  MLB:   "mlb",
  NHL:   "nhl",
  NBA:   "nba",
  NCAAM: "ncaab",
  NFL:   "nfl",
};

/** All sports we pre-warm on startup */
const PREWARM_SPORTS = ["MLB", "NHL", "NBA", "NCAAM"] as const;

/**
 * Book IDs priority order for odds extraction.
 * We request all three; pick the first one that has data.
 *   123 = Caesars (most complete)
 *    15 = DraftKings NJ
 *    30 = FanDuel
 */
const BOOK_IDS = "15,30,123";
const BOOK_PRIORITY = [123, 15, 30];

const AN_BASE = "https://api.actionnetwork.com/web/v2/scoreboard";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/",
};

/** Cache TTL: 5 minutes in ms */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Fetch timeout: 8 seconds */
const FETCH_TIMEOUT_MS = 8_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Odds for a single side (ML, spread side, or total side) */
export interface OddsEntry {
  odds:  number;   // American odds, e.g. -155, +130
  value: number;   // Line value: spread amount or total; 0 for ML
}

/** Full odds snapshot for one game (consensus from best available book) */
export interface GameOdds {
  /** Away team moneyline, e.g. { odds: +130, value: 0 } */
  awayMl:    OddsEntry | null;
  /** Home team moneyline, e.g. { odds: -155, value: 0 } */
  homeMl:    OddsEntry | null;
  /** Away team run line / puck line / spread, e.g. { odds: -170, value: +1.5 } */
  awayRl:    OddsEntry | null;
  /** Home team run line / puck line / spread, e.g. { odds: +143, value: -1.5 } */
  homeRl:    OddsEntry | null;
  /** Over total, e.g. { odds: -110, value: 8.5 } */
  over:      OddsEntry | null;
  /** Under total, e.g. { odds: -110, value: 8.5 } */
  under:     OddsEntry | null;
  /** Which book_id the odds came from */
  bookId:    number;
}

export interface SlateGame {
  id:           number;   // AN game id
  awayTeam:     string;   // e.g. "ARI"
  homeTeam:     string;   // e.g. "BAL"
  awayFull:     string;   // e.g. "Arizona Diamondbacks"
  homeFull:     string;   // e.g. "Baltimore Orioles"
  awayNickname: string;   // e.g. "Diamondbacks"
  homeNickname: string;   // e.g. "Orioles"
  awayLogo:     string;   // Logo URL (MLB.com SVG or ESPN CDN)
  homeLogo:     string;   // Logo URL
  awayColor:    string;   // Primary brand hex, e.g. "#A71930"
  homeColor:    string;   // Primary brand hex, e.g. "#DF4601"
  gameTime:     string;   // e.g. "6:35 PM" (EST)
  startUtc:     string;   // ISO UTC string
  sport:        string;   // "MLB" | "NHL" | "NBA" | "NCAAM"
  gameDate:     string;   // "YYYY-MM-DD" (EST date)
  status:       string;   // "scheduled" | "in_progress" | "complete" | etc.
  odds:         GameOdds; // Live ML/RL/Total odds
}

interface CacheEntry {
  games:     SlateGame[];
  fetchedAt: number;   // Date.now() when cached
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

/** Primary cache: "SPORT:YYYY-MM-DD" → CacheEntry */
const slateCache = new Map<string, CacheEntry>();

/** In-flight deduplication: "SPORT:YYYY-MM-DD" → Promise<SlateGame[]> */
const inFlight = new Map<string, Promise<SlateGame[]>>();

function cacheKey(sport: string, dateStr: string): string {
  return `${sport.toUpperCase()}:${dateStr}`;
}

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/** Evict all expired entries (called before each cache write) */
function evictExpired(): void {
  let evicted = 0;
  for (const [k, v] of Array.from(slateCache.entries())) {
    if (!isCacheValid(v)) {
      slateCache.delete(k);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[AN][CACHE] Evicted ${evicted} expired entries | remaining=${slateCache.size}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a UTC ISO string to EST time string "H:MM AM/PM"
 */
function utcToEstTime(utcStr: string): string {
  try {
    const dt = new Date(utcStr);
    return dt.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour:     "numeric",
      minute:   "2-digit",
      hour12:   true,
    });
  } catch {
    return utcStr;
  }
}

/**
 * Convert a UTC ISO string to EST date string "YYYY-MM-DD"
 */
function utcToEstDate(utcStr: string): string {
  try {
    const dt = new Date(utcStr);
    return dt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch {
    return utcStr.slice(0, 10);
  }
}

/**
 * Today's date in EST as "YYYY-MM-DD"
 */
export function todayEstDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Resolve logo URL for a team.
 * For MLB: use MLB.com SVG via mlbId from MLB_BY_ABBREV.
 * For other sports: use the AN-provided logo URL as fallback.
 */
/**
 * MLB abbreviation aliases: some sources (MLB Stats API) use different abbreviations
 * than Action Network / MLB_BY_ABBREV. Normalize before lookup.
 */
const MLB_ABBREV_ALIASES: Record<string, string> = {
  "AZ":  "ARI",  // Arizona Diamondbacks: MLB API uses "AZ", AN/MLB_BY_ABBREV uses "ARI"
  "CWS": "CWS", // Chicago White Sox: consistent
  "KC":  "KC",  // Kansas City Royals: consistent
  "SD":  "SD",  // San Diego Padres: consistent
  "SF":  "SF",  // San Francisco Giants: consistent
  "TB":  "TB",  // Tampa Bay Rays: consistent
  "WSH": "WSH", // Washington Nationals: consistent
  "ATH": "ATH", // Athletics: consistent
};

export function resolveLogoUrl(sport: string, abbrev: string, anLogoUrl: string): string {
  if (sport === "MLB") {
    // Normalize abbreviation via alias map before lookup
    const normalized = MLB_ABBREV_ALIASES[abbrev] ?? abbrev;
    const team = MLB_BY_ABBREV.get(normalized) ?? MLB_BY_ABBREV.get(abbrev);
    if (team?.logoUrl) {
      console.log(`[AN][STEP]  Logo resolved: sport=MLB abbrev=${abbrev} (normalized=${normalized}) → mlbId=${team.mlbId} url=${team.logoUrl}`);
      return team.logoUrl;
    }
    console.warn(`[AN][STATE] Logo fallback: sport=MLB abbrev=${abbrev} (normalized=${normalized}) not in MLB_BY_ABBREV — using AN logo`);
  }
  return anLogoUrl;
}

/**
 * Resolve team nickname from MLB_BY_ABBREV.
 * Returns the team's nickname (e.g. "Diamondbacks") or falls back to display_name.
 */
function resolveNickname(sport: string, abbrev: string, anDisplayName: string): string {
  if (sport === "MLB") {
    const team = MLB_BY_ABBREV.get(abbrev);
    if (team?.nickname) return team.nickname;
  }
  return anDisplayName;
}

/**
 * Resolve primary brand color from MLB_BY_ABBREV.
 * Falls back to AN primary_color hex.
 */
function resolveColor(sport: string, abbrev: string, anColor: string): string {
  if (sport === "MLB") {
    const team = MLB_BY_ABBREV.get(abbrev);
    if (team?.primaryColor) return team.primaryColor;
  }
  return anColor ? `#${anColor}` : "#888888";
}

/**
 * Extract ML / RL / Total odds from the AN markets object.
 * markets = { [bookId]: { event: { moneyline: [...], spread: [...], total: [...] } } }
 *
 * Priority: BOOK_PRIORITY[0] → BOOK_PRIORITY[1] → BOOK_PRIORITY[2]
 * For each market type, pick the first book that has entries.
 */
function extractOdds(
  markets: Record<string, Record<string, Record<string, unknown[]>>>,
  awayTeamId: number,
  homeTeamId: number,
  gameId: number,
): GameOdds {
  const emptyOdds: GameOdds = {
    awayMl: null, homeMl: null,
    awayRl: null, homeRl: null,
    over:   null, under:  null,
    bookId: 0,
  };

  if (!markets || typeof markets !== "object") {
    console.warn(`[AN][STATE] game=${gameId}: markets field missing or invalid`);
    return emptyOdds;
  }

  // Find the best book that has at least moneyline data
  let bestBookId = 0;
  let bestEvent: Record<string, unknown[]> | null = null;

  for (const bookId of BOOK_PRIORITY) {
    const bookData = markets[String(bookId)];
    if (!bookData) continue;
    const eventData = bookData["event"] as Record<string, unknown[]> | undefined;
    if (!eventData) continue;
    const ml = eventData["moneyline"];
    if (Array.isArray(ml) && ml.length > 0) {
      bestBookId = bookId;
      bestEvent = eventData;
      console.log(`[AN][STATE] game=${gameId}: using book_id=${bookId} for odds`);
      break;
    }
  }

  if (!bestEvent) {
    console.warn(`[AN][STATE] game=${gameId}: no book with moneyline data found in books=${Object.keys(markets).join(",")}`);
    return emptyOdds;
  }

  type RawOutcome = { side: string; team_id?: number; odds: number; value: number };

  const mlList  = (bestEvent["moneyline"] ?? []) as RawOutcome[];
  const rlList  = (bestEvent["spread"]    ?? []) as RawOutcome[];
  const totList = (bestEvent["total"]     ?? []) as RawOutcome[];

  // ── Moneyline ──────────────────────────────────────────────────────────────
  const awayMlRaw = mlList.find(m => m.side === "away" || m.team_id === awayTeamId);
  const homeMlRaw = mlList.find(m => m.side === "home" || m.team_id === homeTeamId);

  // ── Run Line / Spread ──────────────────────────────────────────────────────
  // AN spread: away side has positive value (e.g. +1.5), home has negative (e.g. -1.5)
  const awayRlRaw = rlList.find(m => m.side === "away" || m.team_id === awayTeamId);
  const homeRlRaw = rlList.find(m => m.side === "home" || m.team_id === homeTeamId);

  // ── Total ──────────────────────────────────────────────────────────────────
  const overRaw  = totList.find(m => m.side === "over");
  const underRaw = totList.find(m => m.side === "under");

  const result: GameOdds = {
    awayMl: awayMlRaw ? { odds: awayMlRaw.odds, value: 0 }                 : null,
    homeMl: homeMlRaw ? { odds: homeMlRaw.odds, value: 0 }                 : null,
    awayRl: awayRlRaw ? { odds: awayRlRaw.odds, value: awayRlRaw.value }   : null,
    homeRl: homeRlRaw ? { odds: homeRlRaw.odds, value: homeRlRaw.value }   : null,
    over:   overRaw   ? { odds: overRaw.odds,   value: overRaw.value }     : null,
    under:  underRaw  ? { odds: underRaw.odds,  value: underRaw.value }    : null,
    bookId: bestBookId,
  };

  console.log(
    `[AN][STATE] game=${gameId} odds: ` +
    `ML away=${result.awayMl?.odds ?? "N/A"} home=${result.homeMl?.odds ?? "N/A"} | ` +
    `RL away=${result.awayRl?.value ?? "N/A"}(${result.awayRl?.odds ?? "N/A"}) home=${result.homeRl?.value ?? "N/A"}(${result.homeRl?.odds ?? "N/A"}) | ` +
    `Total O${result.over?.value ?? "N/A"}(${result.over?.odds ?? "N/A"}) U${result.under?.value ?? "N/A"}(${result.under?.odds ?? "N/A"})`
  );

  return result;
}

// ─── Core fetch (no cache) ────────────────────────────────────────────────────

async function fetchAnSlateRaw(sport: string, dateStr: string): Promise<SlateGame[]> {
  const slug = AN_SPORT_SLUG[sport.toUpperCase()];
  if (!slug) {
    console.error(`[AN][ERROR] Unknown sport="${sport}" — no AN slug mapping`);
    return [];
  }

  const anDate = dateStr.replace(/-/g, "");
  const url = `${AN_BASE}/${slug}?bookIds=${BOOK_IDS}&date=${anDate}&periods=event`;

  console.log(`[AN][INPUT] fetchAnSlateRaw: sport=${sport} date=${dateStr}`);
  console.log(`[AN][STEP]  Fetching: ${url}`);

  let raw: Record<string, unknown>;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
    clearTimeout(timer);

    console.log(`[AN][STATE] HTTP status=${resp.status} sport=${sport} date=${dateStr}`);

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[AN][ERROR] Non-OK: status=${resp.status} body=${body.slice(0, 200)}`);
      return [];
    }

    raw = (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.error(`[AN][ERROR] Fetch timeout after ${FETCH_TIMEOUT_MS}ms for sport=${sport} date=${dateStr}`);
    } else {
      console.error(`[AN][ERROR] Fetch failed: ${err}`);
    }
    return [];
  }

  const games = (raw.games as Record<string, unknown>[]) ?? [];
  console.log(`[AN][STATE] Raw games count=${games.length} sport=${sport} date=${dateStr}`);

  if (games.length === 0) {
    console.log(`[AN][OUTPUT] No games for sport=${sport} date=${dateStr}`);
    return [];
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  const result: SlateGame[] = [];
  let parseErrors = 0;
  let oddsFound   = 0;

  for (const g of games) {
    try {
      const id         = g.id as number;
      const startUtc   = g.start_time as string;
      const status     = (g.status as string) ?? "scheduled";
      const awayTeamId = g.away_team_id as number;
      const homeTeamId = g.home_team_id as number;

      const teams = (g.teams as Record<string, unknown>[]) ?? [];
      const teamMap = new Map<number, Record<string, unknown>>();
      for (const t of teams) teamMap.set(t.id as number, t);

      const away = teamMap.get(awayTeamId);
      const home = teamMap.get(homeTeamId);

      if (!away || !home) {
        console.warn(`[AN][STATE] game id=${id}: missing team — awayId=${awayTeamId} homeId=${homeTeamId}`);
        parseErrors++;
        continue;
      }

      const awayAbbr = (away.abbr as string) || (away.short_name as string) || "?";
      const homeAbbr = (home.abbr as string) || (home.short_name as string) || "?";
      const awayAnLogo = (away.logo as string) || "";
      const homeAnLogo = (home.logo as string) || "";
      const awayAnColor = (away.primary_color as string) || "";
      const homeAnColor = (home.primary_color as string) || "";

      // Extract odds from markets
      const markets = g.markets as Record<string, Record<string, Record<string, unknown[]>>>;
      const odds = extractOdds(markets, awayTeamId, homeTeamId, id);
      if (odds.awayMl) oddsFound++;

      result.push({
        id,
        awayTeam:     awayAbbr,
        homeTeam:     homeAbbr,
        awayFull:     (away.full_name as string) || awayAbbr,
        homeFull:     (home.full_name as string) || homeAbbr,
        awayNickname: resolveNickname(sport, awayAbbr, (away.display_name as string) || awayAbbr),
        homeNickname: resolveNickname(sport, homeAbbr, (home.display_name as string) || homeAbbr),
        awayLogo:     resolveLogoUrl(sport, awayAbbr, awayAnLogo),
        homeLogo:     resolveLogoUrl(sport, homeAbbr, homeAnLogo),
        awayColor:    resolveColor(sport, awayAbbr, awayAnColor),
        homeColor:    resolveColor(sport, homeAbbr, homeAnColor),
        gameTime:     utcToEstTime(startUtc),
        startUtc,
        sport:        sport.toUpperCase(),
        gameDate:     utcToEstDate(startUtc),
        status,
        odds,
      });
    } catch (err) {
      console.error(`[AN][ERROR] Parse error on game: ${err}`);
      parseErrors++;
    }
  }

  result.sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  console.log(`[AN][OUTPUT] Parsed ${result.length} games | sport=${sport} date=${dateStr} | oddsFound=${oddsFound}/${result.length} | errors=${parseErrors}`);
  console.log(`[AN][VERIFY] ${parseErrors === 0 ? "PASS" : "WARN"} — ${parseErrors} parse errors`);

  result.forEach((g, i) => {
    console.log(
      `[AN][OUTPUT]   [${i + 1}] id=${g.id} ${g.awayTeam} @ ${g.homeTeam} | ${g.gameTime} ET | ` +
      `ML: ${g.odds.awayMl?.odds ?? "N/A"}/${g.odds.homeMl?.odds ?? "N/A"} | ` +
      `RL: ${g.odds.awayRl?.value ?? "N/A"}(${g.odds.awayRl?.odds ?? "N/A"}) | ` +
      `Total: ${g.odds.over?.value ?? "N/A"}`
    );
  });

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch the daily slate from Action Network — with in-memory cache + in-flight dedup.
 *
 * @param sport   - "MLB" | "NHL" | "NBA" | "NCAAM"
 * @param dateStr - "YYYY-MM-DD" (EST date)
 * @returns       - Sorted SlateGame[] (by start time ASC), served from cache when fresh
 */
export async function fetchAnSlate(sport: string, dateStr: string): Promise<SlateGame[]> {
  const key = cacheKey(sport, dateStr);

  console.log(`[AN][INPUT] fetchAnSlate: sport=${sport} date=${dateStr} key=${key}`);

  // ── Cache hit ──────────────────────────────────────────────────────────────
  const cached = slateCache.get(key);
  if (cached && isCacheValid(cached)) {
    const ageMs = Date.now() - cached.fetchedAt;
    console.log(`[AN][CACHE] HIT key=${key} | age=${ageMs}ms | games=${cached.games.length}`);
    return cached.games;
  }

  // ── In-flight dedup ────────────────────────────────────────────────────────
  const existing = inFlight.get(key);
  if (existing) {
    console.log(`[AN][CACHE] IN-FLIGHT dedup key=${key} — awaiting existing request`);
    return existing;
  }

  // ── Cache miss — fetch ─────────────────────────────────────────────────────
  console.log(`[AN][CACHE] MISS key=${key} — initiating fetch`);

  const promise = fetchAnSlateRaw(sport, dateStr).then(games => {
    evictExpired();
    slateCache.set(key, { games, fetchedAt: Date.now() });
    inFlight.delete(key);
    console.log(`[AN][CACHE] STORED key=${key} | games=${games.length} | TTL=${CACHE_TTL_MS / 1000}s`);
    return games;
  }).catch(err => {
    inFlight.delete(key);
    console.error(`[AN][ERROR] fetchAnSlateRaw threw: ${err}`);
    return [] as SlateGame[];
  });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Pre-warm the slate cache for today's date across all 4 sports in parallel.
 * Called once on server startup to eliminate cold-start latency for the first user.
 */
export async function prewarmSlateCache(): Promise<void> {
  const today = todayEstDate();
  console.log(`[AN][CACHE] Pre-warming slate cache for date=${today} sports=${PREWARM_SPORTS.join(",")}`);

  const start = Date.now();
  const results = await Promise.allSettled(
    PREWARM_SPORTS.map(sport => fetchAnSlate(sport, today))
  );

  let totalGames = 0;
  results.forEach((r, i) => {
    const sport = PREWARM_SPORTS[i];
    if (r.status === "fulfilled") {
      totalGames += r.value.length;
      console.log(`[AN][CACHE] Pre-warm OK: sport=${sport} games=${r.value.length}`);
    } else {
      console.error(`[AN][CACHE] Pre-warm FAIL: sport=${sport} reason=${r.reason}`);
    }
  });

  const elapsed = Date.now() - start;
  console.log(`[AN][CACHE] Pre-warm complete | elapsed=${elapsed}ms | totalGames=${totalGames} | cacheSize=${slateCache.size}`);
}

/**
 * Manually invalidate a specific cache entry (e.g., after a date change).
 */
export function invalidateSlateCache(sport: string, dateStr: string): void {
  const key = cacheKey(sport, dateStr);
  const existed = slateCache.delete(key);
  console.log(`[AN][CACHE] Invalidate key=${key} | existed=${existed}`);
}

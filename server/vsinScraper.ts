/**
 * VSiN College Basketball Betting Splits Scraper
 *
 * Uses fetch + cheerio (NO Puppeteer) to load the VSiN CBB betting splits page
 * and extract the consensus spread and total for each game by team name matching.
 *
 * Auth flow:
 *   1. POST to Piano ID login endpoint → get access_token (JWT)
 *   2. Use access_token as __utp cookie when fetching the VSiN page
 *   3. The HTML is fully server-side rendered — no JS execution needed
 *
 * Table structure (no <tbody>, rows are direct children of <table>):
 *   Each game row has 10 <td> cells:
 *     [0] team names (away + home via anchors), [1] spread, [4] total, ...
 *
 * Spread format: td[1] contains two anchor links: "+2.5" (away) and "-2.5" (home)
 * Total format: td[4] contains two anchor links both showing the same value e.g. "154.5"
 */

import * as cheerio from "cheerio";
import { ENV } from "./_core/env";
import { BY_VSIN_SLUG } from "../shared/ncaamTeams";

export interface ScrapedOdds {
  awayTeam: string;   // display name from VSiN anchor text
  homeTeam: string;   // display name from VSiN anchor text
  awaySlug: string;   // DB slug derived from href (e.g. "central_connecticut")
  homeSlug: string;   // DB slug derived from href
  awaySpread: number | null;
  homeSpread: number | null;
  total: number | null;
  // ─── Betting Splits ─────────────────────────────────────────────────────────
  /** % of spread bets on away team (0-100), null if not available */
  spreadAwayBetsPct: number | null;
  /** % of spread money on away team (0-100), null if not available */
  spreadAwayMoneyPct: number | null;
  /** % of total bets on Over (0-100), null if not available */
  totalOverBetsPct: number | null;
  /** % of total money on Over (0-100), null if not available */
  totalOverMoneyPct: number | null;
  /** Away moneyline (e.g. "+130"), null if not available */
  awayML: string | null;
  /** Home moneyline (e.g. "-155"), null if not available */
  homeML: string | null;
  /** % of ML bets on away team (0-100), null if not available */
  mlAwayBetsPct: number | null;
  /** % of ML money on away team (0-100), null if not available */
  mlAwayMoneyPct: number | null;
  /** 0-based position of this game on the VSiN page (used for sortOrder) */
  vsinRowIndex: number;
  /** Date of the game as YYYYMMDD string, e.g. "20260304" */
  gameDate: string;
}

// Cache the access token so we don't re-login on every scrape
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Logs into VSiN via Piano ID and returns a JWT access token.
 * The token is cached and reused until it expires.
 */
async function getVsinAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiry > now + 5 * 60 * 1000) {
    return cachedToken;
  }

  const email = ENV.vsinEmail;
  const password = ENV.vsinPassword;

  if (!email || !password) {
    throw new Error("VSiN credentials not configured (VSIN_EMAIL / VSIN_PASSWORD)");
  }

  console.log("[VSiN] Logging in via Piano ID...");

  const resp = await fetch(
    "https://auth.vsin.com/id/api/v1/identity/login/token?aid=N1owYIiApu&lang=en_US",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://auth.vsin.com",
        "Referer": "https://auth.vsin.com/id/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        password,
        remember: true,
        login: email,
        loginType: "email",
      }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Piano ID login failed (${resp.status}): ${text.substring(0, 200)}`);
  }

  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!data.access_token) {
    throw new Error(`Piano ID login returned no token: ${JSON.stringify(data).substring(0, 200)}`);
  }

  cachedToken = data.access_token;
  // expires_in is in seconds; default to 30 days if not provided
  tokenExpiry = now + (data.expires_in ?? 2592000) * 1000;

  console.log(`[VSiN] Login successful, token expires in ${data.expires_in ?? "unknown"}s`);
  return cachedToken;
}

/**
 * Fetches the VSiN CBB betting splits page HTML using the access token as a cookie.
 */
async function fetchVsinPage(): Promise<string> {
  const token = await getVsinAccessToken();

  const resp = await fetch(
    "https://data.vsin.com/college-basketball/betting-splits/",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": `__utp=${token}`,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://vsin.com/",
      },
    }
  );

  if (!resp.ok) {
    throw new Error(`VSiN page fetch failed (${resp.status})`);
  }

  return resp.text();
}

/**
 * Converts a VSiN href team slug to a DB slug.
 * e.g. "/college-basketball/teams/central-conn-st" → "central_connecticut"
 *
 * Priority:
 *   1. Registry lookup by VSiN slug (canonical 365-team source)
 *   2. Hyphen → underscore conversion (fallback for any unregistered slug)
 */
function hrefToDbSlug(href: string): string {
  // Extract the last path segment: "/college-basketball/teams/central-conn-st" → "central-conn-st"
  const parts = href.split("/");
  const raw = parts[parts.length - 1].toLowerCase();
  // 1. Registry lookup (primary — canonical 365-team source)
  const team = BY_VSIN_SLUG.get(raw);
  if (team) return team.dbSlug;
  // 2. Default: replace hyphens with underscores
  return raw.replace(/-/g, "_");
}

/**
 * Parses a percentage value from a cell's visible text (e.g. "41%" → 41, "94%" → 94).
 * Returns null if the text doesn't look like a valid percentage.
 */
function parsePct(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/[^0-9]/g, "");
  if (!clean) return null;
  const val = parseInt(clean, 10);
  if (isNaN(val) || val < 0 || val > 100) return null;
  return val;
}

/**
 * Extracts the first visible percentage text from a td cell.
 * The VSiN splits cells contain two divs separated by <hr>; the first div is the away/over value.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFirstPct($: cheerio.CheerioAPI, td: any): number | null {
  // Get all direct div children that are NOT inside .collapse
  const divs = $(td).children("div").not(".collapse").toArray();
  if (divs.length === 0) return null;
  const text = $(divs[0]).text().trim();
  return parsePct(text);
}

/**
 * Parses a spread value from anchor link text.
 * Examples: "+2.5", "-3.5", "PK"
 */
function parseSpread(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/\s+/g, "");
  if (clean.toLowerCase() === "pk" || clean.toLowerCase() === "pick") return 0;
  const match = clean.match(/^([+-]?\d+\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (isNaN(val) || Math.abs(val) > 60) return null;
  return val;
}

/**
 * Parses a total value from anchor link text.
 * Examples: "154.5", "138"
 */
function parseTotal(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/\s+/g, "");
  const match = clean.match(/^(\d{2,3}\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (isNaN(val) || val < 100 || val > 300) return null;
  return val;
}

/**
 * Extracts visible text from anchor links within a td, filtering out collapsed content.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAnchorTexts($: cheerio.CheerioAPI, td: any): string[] {
  const texts: string[] = [];
  $(td)
    .find("a")
    .each((_i, el) => {
      // Skip elements inside .collapse containers (expanded splits)
      if ($(el).closest(".collapse").length > 0) return;
      const text = $(el).text().trim();
      if (text) texts.push(text);
    });
  return texts;
}

/**
 * Extracts the game date (YYYYMMDD) from the game_id data attribute.
 * Game IDs look like: "20260304CBB00652"
 */
function extractGameDate(gameId: string): string | null {
  const match = gameId.match(/^(\d{8})/);
  return match ? match[1] : null;
}

/**
 * Scrapes the VSiN CBB betting splits page for games on a given date.
 * @param dateLabel - Date string in YYYYMMDD format, e.g. "20260304"
 */
export async function scrapeVsinOdds(dateLabel: string): Promise<ScrapedOdds[]> {
  const startTime = Date.now();
  console.log(`[VSiN] Starting scrape for date: ${dateLabel}`);

  const html = await fetchVsinPage();
  console.log(`[VSiN] Page fetched in ${Date.now() - startTime}ms (${html.length} bytes)`);

  const $ = cheerio.load(html);
  const table = $("table.freezetable");

  if (!table.length) {
    // If no table found, the session may have expired — clear cached token and retry once
    console.warn("[VSiN] No table found — clearing cached token and retrying login");
    cachedToken = null;
    tokenExpiry = 0;
    const html2 = await fetchVsinPage();
    const $2 = cheerio.load(html2);
    if (!$2("table.freezetable").length) {
      throw new Error("[VSiN] No betting splits table found after re-login. Page may be behind paywall.");
    }
    return parseGames($2, dateLabel, startTime);
  }

  return parseGames($, dateLabel, startTime);
}

function parseGames(
  $: cheerio.CheerioAPI,
  dateLabel: string,
  startTime: number
): ScrapedOdds[] {
  const results: ScrapedOdds[] = [];

  // The table has no <tbody> — game rows are direct children with 10 <td> cells
  $("table.freezetable tr").each((_i, tr) => {
    const tds = $(tr).find("td").toArray();
    if (tds.length < 10) return; // Skip header rows

    // Extract team slugs from anchor links in td[0]
    const teamAnchors = $(tds[0])
      .find('a.txt-color-vsinred[href*="/teams/"]')
      .toArray()
      .filter((a) => $(a).closest(".collapse").length === 0);

    if (teamAnchors.length < 2) return; // Not a game row

    // Get game ID to extract date
    let gameId: string | null = null;
    $(tds[0])
      .find("[data-param2]")
      .each((_j, el) => {
        if (!gameId && $(el).closest(".collapse").length === 0) {
          gameId = $(el).attr("data-param2") || null;
        }
      });

    if (!gameId) return;

    const gameDate = extractGameDate(gameId);
    if (!gameDate) return;

    // Filter by requested date — pass "ALL" to return every date
    if (dateLabel !== "ALL" && gameDate !== dateLabel) return;

    // Extract team names from anchor text
    const awayTeam = $(teamAnchors[0]).text().trim();
    const homeTeam = $(teamAnchors[1]).text().trim();

    if (!awayTeam || !homeTeam) return;

    // Extract DB slugs from href attributes (deterministic, no fuzzy matching needed)
    const awayHref = $(teamAnchors[0]).attr("href") || "";
    const homeHref = $(teamAnchors[1]).attr("href") || "";
    const awaySlug = awayHref ? hrefToDbSlug(awayHref) : awayTeam.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const homeSlug = homeHref ? hrefToDbSlug(homeHref) : homeTeam.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    // Extract spread from td[1]: two anchor links (away spread, home spread)
    const spreadTexts = getAnchorTexts($, tds[1]);
    const awaySpread = spreadTexts.length > 0 ? parseSpread(spreadTexts[0]) : null;
    const homeSpread = spreadTexts.length > 1 ? parseSpread(spreadTexts[1]) : null;

    // Extract total from td[4]: two anchor links (both show same total)
    const totalTexts = getAnchorTexts($, tds[4]);
    const total = totalTexts.length > 0 ? parseTotal(totalTexts[0]) : null;    // ─── Betting Splits ─────────────────────────────────────────────────────────────────
    // VSiN column order (confirmed from raw HTML, 10 <td> per row):
    //   td[0] = matchup (team names)
    //   td[1] = spread lines (away/home anchors)
    //   td[2] = spread Bets%   (cellhightlight5 class) → e.g. 70%
    //   td[3] = spread Handle% (money)                 → e.g. 41%
    //   td[4] = total line (O/U anchor)
    //   td[5] = total Bets%   (over/under)             → e.g. 85%
    //   td[6] = total Handle% (money)                  → e.g. 71%
    //   td[7] = ML lines (away/home anchors)            → e.g. +130 / -155
    //   td[8] = ML Bets%   (away/home)                 → e.g. 49%
    //   td[9] = ML Handle% (money)                     → e.g. 66%
    // Note: Handle (money%) is the primary sharp-money signal
    const spreadAwayBetsPct  = tds.length > 2 ? getFirstPct($, tds[2]) : null;  // Bets   = td[2]
    const spreadAwayMoneyPct = tds.length > 3 ? getFirstPct($, tds[3]) : null;  // Handle = td[3]
    const totalOverBetsPct   = tds.length > 5 ? getFirstPct($, tds[5]) : null;  // Bets   = td[5]
    const totalOverMoneyPct  = tds.length > 6 ? getFirstPct($, tds[6]) : null;  // Handle = td[6]

    // ─── ML columns (td[7], td[8], td[9]) ─────────────────────────────────────────
    // td[7]: two anchor links — away ML then home ML (e.g. "+130" / "-155")
    let awayML: string | null = null;
    let homeML: string | null = null;
    if (tds.length > 7) {
      const mlTexts = getAnchorTexts($, tds[7]);
      awayML = mlTexts.length > 0 ? mlTexts[0].trim() : null;
      homeML = mlTexts.length > 1 ? mlTexts[1].trim() : null;
    }
    // td[8]: ML Bets% — first div is away %, second is home %
    const mlAwayBetsPct  = tds.length > 8 ? getFirstPct($, tds[8]) : null;
    // td[9]: ML Handle% — first div is away %, second is home %
    const mlAwayMoneyPct = tds.length > 9 ? getFirstPct($, tds[9]) : null;

    results.push({
      awayTeam,
      homeTeam,
      awaySlug,
      homeSlug,
      awaySpread,
      homeSpread,
      total,
      spreadAwayBetsPct,
      spreadAwayMoneyPct,
      totalOverBetsPct,
      totalOverMoneyPct,
      awayML,
      homeML,
      mlAwayBetsPct,
      mlAwayMoneyPct,
      vsinRowIndex: results.length, // 0-based position on VSiN page
      gameDate,                      // YYYYMMDD string, e.g. "20260304"
    });
  });

  console.log(
    `[VSiN] Parsed ${results.length} games for ${dateLabel} in ${Date.now() - startTime}ms`
  );

  return results;
}

/**
 * @deprecated This function is no longer used in the main pipeline.
 * All matching is done via href-derived slugs (deterministic).
 * Kept only for the test suite — do not call from production code.
 */
export function matchTeam(scrapedName: string, storedSlug: string): boolean {
  const norm = scrapedName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").trim();
  const slug = storedSlug.toLowerCase().replace(/[^a-z0-9_]/g, "");

  if (norm === slug) return true;

  // Comprehensive VSiN abbreviation → DB slug mappings
  // VSiN uses abbreviated names; DB uses full slugs
  const abbrevMap: Record<string, string> = {
    // VSiN abbreviated forms → DB full slugs
    n_alabama: "north_alabama",
    fl_gulf_coast: "florida_gulf_coast",
    fgcu: "florida_gulf_coast",
    florida_gulf_coast: "florida_gulf_coast",
    e_kentucky: "eastern_kentucky",
    eastern_kentucky: "eastern_kentucky",
    n_florida: "north_florida",
    north_florida: "north_florida",
    n_kentucky: "northern_kentucky",
    northern_kentucky: "northern_kentucky",
    scupstate: "south_carolina_upstate",
    sc_upstate: "south_carolina_upstate",
    south_carolina_upstate: "south_carolina_upstate",
    chicago_st: "chicago_state",
    chicago_state: "chicago_state",
    cleveland_st: "cleveland_state",
    cleveland_state: "cleveland_state",
    colorado_st: "colorado_state",
    colorado_state: "colorado_state",
    ohio_st: "ohio_state",
    ohio_state: "ohio_state",
    penn_st: "penn_state",
    penn_state: "penn_state",
    florida_st: "florida_state",
    florida_state: "florida_state",
    wright_st: "wright_state",
    wright_state: "wright_state",
    youngstown_st: "youngstown_state",
    youngstown_state: "youngstown_state",
    e_illinois: "eastern_illinois",
    eastern_illinois: "eastern_illinois",
    siuedwardsville: "siu_edwardsville",
    siu_edwardsville: "siu_edwardsville",
    arklittle_rock: "little_rock",
    little_rock: "little_rock",
    liubrooklyn: "liu",
    liu: "liu",
    long_island: "liu",
    loyolachicago: "loyola_chicago",
    loyola_chicago: "loyola_chicago",
    loyola_chicago_il: "loyola_chicago",
    uwmilwaukee: "milwaukee",
    milwaukee: "milwaukee",
    uw_milwaukee: "milwaukee",
    gardnerwebb: "gardner_webb",
    gardner_webb: "gardner_webb",
    lemoyne: "le_moyne",
    le_moyne: "le_moyne",
    w_georgia: "west_georgia",
    west_georgia: "west_georgia",
    c_conn_st: "central_connecticut",
    central_connecticut: "central_connecticut",
    st_josephs: "st_josephs",
    st_bonaventure: "st_bonaventure",
    georgia_st: "georgia_state",
    georgia_state: "georgia_state",
    miami_fl: "miami_fl",
    miami_florida: "miami_fl",
    ul_lafayette: "ul_lafayette",
    la_lafayette: "ul_lafayette",
    depaul: "depaul",
    detroit: "detroit_mercy",
    detroit_mercy: "detroit_mercy",
    smu: "smu",
    umkc: "umkc",
    uab: "uab",
    usc: "usc",
    saint_louis: "saint_louis",
    saint_louis_25: "saint_louis",
    new_mexico: "new_mexico",
    north_texas: "north_texas",
    oral_roberts: "oral_roberts",
    oakland: "oakland",
    lindenwood: "lindenwood",
    stonehill: "stonehill",
    fairleigh_dickinson: "fairleigh_dickinson",
    mercyhurst: "mercyhurst",
    wagner: "wagner",
    robert_morris: "robert_morris",
    bellarmine: "bellarmine",
    george_washington: "george_washington",
    la_salle: "la_salle",
    old_dominion: "old_dominion",
    old_dom: "old_dominion",
    georgia_southern: "georgia_southern",
    ga_southern: "georgia_southern",
    james_madison: "james_madison",
    jmu: "james_madison",
    // Additional teams found in full VSiN audit
    central_conn_st: "central_connecticut",
    liu_brooklyn: "liu",
    ark_little_rock: "little_rock",
  };

  const normMapped = abbrevMap[norm] || norm;
  const slugMapped = abbrevMap[slug] || slug;

  // Only exact match after alias resolution
  return normMapped === slugMapped;
}

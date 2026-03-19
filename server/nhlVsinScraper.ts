/**
 * VSiN NHL Betting Splits Scraper
 *
 * Mirrors nbaVsinScraper.ts but targets the NHL betting splits page:
 *   https://data.vsin.com/nhl/betting-splits/
 *
 * Auth flow: same Piano ID JWT as NCAAM/NBA scraper (shared token cache).
 *
 * Table structure: identical to NCAAM/NBA — freezetable with 10 <td> cells per row.
 *   [0] team names (away + home via anchors), [1] spread, [4] total
 *
 * Game ID format: "20260312NHL00064" (YYYYMMDD + "NHL" + number)
 * Team href format: "/nhl/teams/boston-bruins"
 *
 * NHL total range: 4.5 – 8.5 goals (NOT 100–300 like basketball).
 * NHL spread range: 0 – 3.5 pucks (NOT 0–60 like basketball).
 *
 * VSiN href aliases: NYI uses "ny-islanders" instead of "new-york-islanders".
 * All aliases are resolved via VSIN_NHL_HREF_ALIASES from the registry.
 */

import * as cheerio from "cheerio";
import { ENV } from "./_core/env";
import { NHL_BY_VSIN_SLUG, VSIN_NHL_HREF_ALIASES } from "../shared/nhlTeams";

export interface NhlScrapedOdds {
  awayTeam: string;   // display name from VSiN anchor text
  homeTeam: string;   // display name from VSiN anchor text
  awaySlug: string;   // DB slug derived from href (e.g. "boston_bruins")
  homeSlug: string;   // DB slug derived from href
  awaySpread: number | null;
  homeSpread: number | null;
  total: number | null;
  // ─── NHL Betting Splits (6 fields + ML odds) ──────────────────────────────
  /** % of spread bets on away team (0-100), null if not available */
  spreadAwayBetsPct: number | null;
  /** % of spread money on away team (0-100), null if not available */
  spreadAwayMoneyPct: number | null;
  /** % of total bets on Over (0-100), null if not available */
  totalOverBetsPct: number | null;
  /** % of total money on Over (0-100), null if not available */
  totalOverMoneyPct: number | null;
  /** % of ML bets on away team (0-100), null if not available */
  mlAwayBetsPct: number | null;
  /** % of ML money on away team (0-100), null if not available */
  mlAwayMoneyPct: number | null;
  /** Away team moneyline odds, e.g. "+120" or "-160" */
  awayML: string | null;
  /** Home team moneyline odds, e.g. "-142" or "+130" */
  homeML: string | null;
  /** 0-based position of this game on the VSiN page (used for sortOrder) */
  vsinRowIndex: number;
  /** Date of the game as YYYYMMDD string, e.g. "20260312" */
  gameDate: string;
}

// ─── Token cache (shared with NCAAM/NBA scrapers via same Piano ID account) ──
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Logs into VSiN via Piano ID and returns a JWT access token.
 * Token is cached and reused until it expires (with 5 min buffer).
 */
async function getVsinAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 5 * 60 * 1000) {
    console.log("[VSiN-NHL] Using cached Piano ID token");
    return cachedToken;
  }

  const email = ENV.vsinEmail;
  const password = ENV.vsinPassword;

  if (!email || !password) {
    throw new Error("[VSiN-NHL] Credentials not configured (VSIN_EMAIL / VSIN_PASSWORD)");
  }

  console.log("[VSiN-NHL] Logging in via Piano ID...");

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
    throw new Error(`[VSiN-NHL] Piano ID login failed (${resp.status}): ${text.substring(0, 200)}`);
  }

  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!data.access_token) {
    throw new Error(`[VSiN-NHL] Piano ID login returned no token: ${JSON.stringify(data).substring(0, 200)}`);
  }

  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in ?? 2592000) * 1000;

  console.log(`[VSiN-NHL] Login successful — token expires in ${data.expires_in ?? "unknown"}s`);
  return cachedToken;
}

/**
 * Fetches the VSiN NHL betting splits page HTML using the Piano ID token as a cookie.
 */
async function fetchNhlVsinPage(): Promise<string> {
  const token = await getVsinAccessToken();

  console.log("[VSiN-NHL] Fetching https://data.vsin.com/nhl/betting-splits/ ...");
  const resp = await fetch(
    "https://data.vsin.com/nhl/betting-splits/",
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
    throw new Error(`[VSiN-NHL] Page fetch failed (${resp.status})`);
  }

  const html = await resp.text();
  console.log(`[VSiN-NHL] Page fetched: ${html.length} bytes`);
  return html;
}

/**
 * Converts a VSiN NHL href slug to a DB slug.
 * e.g. "/nhl/teams/boston-bruins"  → "boston_bruins"
 *      "/nhl/teams/ny-islanders"   → "new_york_islanders" (via alias)
 */
function nhlHrefToDbSlug(href: string): string {
  const parts = href.split("/");
  const raw = parts[parts.length - 1].toLowerCase();

  // 1. Resolve alias (e.g. "ny-islanders" → "new-york-islanders")
  const canonical = VSIN_NHL_HREF_ALIASES[raw] ?? raw;

  // 2. Registry lookup (O(1), authoritative)
  const team = NHL_BY_VSIN_SLUG.get(canonical);
  if (team) {
    console.log(`[VSiN-NHL]   slug resolved: "${raw}" → "${team.dbSlug}"`);
    return team.dbSlug;
  }

  // 3. Fallback: replace hyphens with underscores
  const fallback = canonical.replace(/-/g, "_");
  console.warn(`[VSiN-NHL]   WARNING: unknown slug "${raw}" — using fallback "${fallback}"`);
  return fallback;
}

/**
 * Parses a spread value from anchor link text.
 * NHL spreads (puck lines) are typically ±1.5.
 * Examples: "+1.5", "-1.5", "PK"
 */
function parseSpread(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/\s+/g, "");
  if (clean.toLowerCase() === "pk" || clean.toLowerCase() === "pick") return 0;
  const match = clean.match(/^([+-]?\d+\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  // NHL spreads are typically 0–3.5 (puck line is almost always ±1.5)
  if (isNaN(val) || Math.abs(val) > 10) return null;
  return val;
}

/**
 * Parses a total value from anchor link text.
 * NHL totals are typically 4.5 – 8.5 goals.
 * Examples: "5.5", "6", "7"
 */
function parseTotal(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/\s+/g, "");
  const match = clean.match(/^(\d+\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  // NHL totals: 3.5 – 10 goals (generous range to handle edge cases)
  if (isNaN(val) || val < 3 || val > 12) return null;
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
      if ($(el).closest(".collapse").length > 0) return;
      const text = $(el).text().trim();
      if (text) texts.push(text);
    });
  return texts;
}

/**
 * Parses a percentage value from a cell's visible text (e.g. "41%" → 41).
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
  const divs = $(td).children("div").not(".collapse").toArray();
  if (divs.length === 0) return null;
  const text = $(divs[0]).text().trim();
  return parsePct(text);
}

/**
 * Extracts the game date (YYYYMMDD) from the game_id data attribute.
 * NHL game IDs look like: "20260312NHL00064"
 */
function extractGameDate(gameId: string): string | null {
  const match = gameId.match(/^(\d{8})/);
  return match ? match[1] : null;
}

/**
 * Parses game rows from the VSiN NHL betting splits table.
 *
 * VSiN NHL column order (10 <td> cells):
 *   td[0]  = team names (away + home via anchors with href="/nhl/teams/...")
 *   td[1]  = spread (away on top, home below)
 *   td[2]  = spread HANDLE % = money % (away on top)
 *   td[3]  = spread BETS % (away on top)
 *   td[4]  = total (both show same value)
 *   td[5]  = total HANDLE % = money % (over on top)
 *   td[6]  = total BETS % (over on top)
 *   td[7]  = moneyline odds (away ML on top, home ML below <hr>)
 *   td[8]  = ML HANDLE % = money % (away on top)
 *   td[9]  = ML BETS % (away on top)
 */
function parseNhlGames(
  $: cheerio.CheerioAPI,
  dateLabel: string,
  startTime: number
): NhlScrapedOdds[] {
  const results: NhlScrapedOdds[] = [];
  let rowsInspected = 0;
  let rowsSkipped = 0;

  $("table.freezetable tr").each((_i, tr) => {
    const tds = $(tr).find("td").toArray();
    rowsInspected++;

    if (tds.length < 10) {
      rowsSkipped++;
      return; // Skip header rows
    }

    // ── Step 1: Extract team anchors from td[0] ──────────────────────────────
    const teamAnchors = $(tds[0])
      .find('a.txt-color-vsinred[href*="/teams/"]')
      .toArray()
      .filter((a) => $(a).closest(".collapse").length === 0);

    if (teamAnchors.length < 2) {
      rowsSkipped++;
      return;
    }

    // ── Step 2: Extract game ID to get date ──────────────────────────────────
    let gameId: string | null = null;
    $(tds[0])
      .find("[data-param2]")
      .each((_j, el) => {
        if (!gameId && $(el).closest(".collapse").length === 0) {
          gameId = $(el).attr("data-param2") || null;
        }
      });

    if (!gameId) {
      rowsSkipped++;
      return;
    }

    const gameDate = extractGameDate(gameId);
    if (!gameDate) {
      rowsSkipped++;
      return;
    }

    // ── Step 3: Filter by requested date ────────────────────────────────────
    if (dateLabel !== "ALL" && gameDate !== dateLabel) {
      rowsSkipped++;
      return;
    }

    // ── Step 4: Extract team names and slugs ─────────────────────────────────
    const awayTeam = $(teamAnchors[0]).text().trim();
    const homeTeam = $(teamAnchors[1]).text().trim();
    if (!awayTeam || !homeTeam) {
      rowsSkipped++;
      return;
    }

    const awayHref = $(teamAnchors[0]).attr("href") || "";
    const homeHref = $(teamAnchors[1]).attr("href") || "";
    const awaySlug = awayHref ? nhlHrefToDbSlug(awayHref) : awayTeam.toLowerCase().replace(/\s+/g, "_");
    const homeSlug = homeHref ? nhlHrefToDbSlug(homeHref) : homeTeam.toLowerCase().replace(/\s+/g, "_");

    console.log(`[VSiN-NHL]   Game ${results.length + 1}: ${awayTeam} (${awaySlug}) @ ${homeTeam} (${homeSlug}) | gameId=${gameId}`);

    // ── Step 5: Spread from td[1] ────────────────────────────────────────────
    const spreadTexts = getAnchorTexts($, tds[1]);
    const awaySpread = spreadTexts.length > 0 ? parseSpread(spreadTexts[0]) : null;
    const homeSpread = spreadTexts.length > 1 ? parseSpread(spreadTexts[1]) : null;
    console.log(`[VSiN-NHL]     spread: away=${awaySpread ?? "null"} home=${homeSpread ?? "null"} (raw: ${spreadTexts.join(", ")})`);

    // ── Step 6: Total from td[4] ─────────────────────────────────────────────
    const totalTexts = getAnchorTexts($, tds[4]);
    const total = totalTexts.length > 0 ? parseTotal(totalTexts[0]) : null;
    console.log(`[VSiN-NHL]     total: ${total ?? "null"} (raw: ${totalTexts.join(", ")})`);

    // ── Step 7: Betting splits ───────────────────────────────────────────────
    // Column layout mirrors NBA exactly:
    //   td[2] = spread money % (away on top)
    //   td[3] = spread bets % (away on top)
    //   td[5] = total money % (over on top)
    //   td[6] = total bets % (over on top)
    //   td[7] = ML odds (away on top, home below <hr>)
    //   td[8] = ML money % (away on top)
    //   td[9] = ML bets % (away on top)
    const spreadAwayMoneyPct = tds.length > 2 ? getFirstPct($, tds[2]) : null;
    const spreadAwayBetsPct  = tds.length > 3 ? getFirstPct($, tds[3]) : null;
    const totalOverMoneyPct  = tds.length > 5 ? getFirstPct($, tds[5]) : null;
    const totalOverBetsPct   = tds.length > 6 ? getFirstPct($, tds[6]) : null;
    const mlTexts            = tds.length > 7 ? getAnchorTexts($, tds[7]) : [];
    const awayML             = mlTexts.length > 0 ? mlTexts[0].trim() || null : null;
    const homeML             = mlTexts.length > 1 ? mlTexts[1].trim() || null : null;
    const mlAwayMoneyPct     = tds.length > 8 ? getFirstPct($, tds[8]) : null;
    const mlAwayBetsPct      = tds.length > 9 ? getFirstPct($, tds[9]) : null;

    console.log(
      `[VSiN-NHL]     splits: spreadBets=${spreadAwayBetsPct ?? "?"}% spreadMoney=${spreadAwayMoneyPct ?? "?"}% ` +
      `overBets=${totalOverBetsPct ?? "?"}% overMoney=${totalOverMoneyPct ?? "?"}% ` +
      `mlBets=${mlAwayBetsPct ?? "?"}% mlMoney=${mlAwayMoneyPct ?? "?"}% ` +
      `awayML=${awayML ?? "?"} homeML=${homeML ?? "?"}`
    );

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
      mlAwayBetsPct,
      mlAwayMoneyPct,
      awayML,
      homeML,
      vsinRowIndex: results.length,
      gameDate,
    });
  });

  console.log(
    `[VSiN-NHL] Parsed ${results.length} NHL games for ${dateLabel} ` +
    `(${rowsInspected} rows inspected, ${rowsSkipped} skipped) ` +
    `in ${Date.now() - startTime}ms`
  );

  return results;
}

/**
 * Scrapes the VSiN NHL betting splits page for games on a given date.
 *
 * @param dateLabel - Date string in YYYYMMDD format (e.g. "20260312"), or "ALL" for all dates.
 * @returns Array of NhlScrapedOdds objects, one per game row found.
 */
export async function scrapeNhlVsinOdds(dateLabel: string): Promise<NhlScrapedOdds[]> {
  const startTime = Date.now();

  // Resolve "today" → YYYYMMDD in Eastern Time (VSiN game IDs use ET dates)
  if (dateLabel === "today") {
    const etDate = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }); // MM/DD/YYYY
    const [mm, dd, yyyy] = etDate.split("/");
    dateLabel = `${yyyy}${mm}${dd}`;
  }

  console.log(`[VSiN-NHL] ═══ Starting NHL scrape for date: ${dateLabel} ═══`);

  const html = await fetchNhlVsinPage();

  const $ = cheerio.load(html);
  const table = $("table.freezetable");

  if (!table.length) {
    // Session may have expired — clear cached token and retry once
    console.warn("[VSiN-NHL] No freezetable found — clearing cached token and retrying login");
    cachedToken = null;
    tokenExpiry = 0;
    const html2 = await fetchNhlVsinPage();
    const $2 = cheerio.load(html2);
    if (!$2("table.freezetable").length) {
      throw new Error("[VSiN-NHL] No betting splits table found after re-login. Page may be behind paywall.");
    }
    return parseNhlGames($2, dateLabel, startTime);
  }

  return parseNhlGames($, dateLabel, startTime);
}

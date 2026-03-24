/**
 * vsinBettingSplitsScraper.ts
 *
 * Scrapes VSiN DraftKings betting splits pages:
 *
 *   NBA/CBB/NHL (combined page):
 *     https://data.vsin.com/betting-splits/?bookid=dk&view=front   (today)
 *     https://data.vsin.com/betting-splits/?bookid=dk&view=tomorrow (tomorrow)
 *
 *   MLB (dedicated page, different column order):
 *     https://data.vsin.com/mlb/betting-splits/
 *
 * Extracts ONLY betting splits (Handle % and Bets %) for:
 *   - Spread / Run Line (away handle %, away bets %)
 *   - Total (over handle %, over bets %)
 *   - Moneyline (away handle %, away bets %)
 *
 * Does NOT extract odds values — those come from Action Network.
 *
 * ─── NBA/CBB/NHL table structure (10 <td> cells per game row) ───
 *   td[0]: team names (away/home) + game ID in data-param2
 *   td[1]: spread (away/home) — ignored
 *   td[2]: spread handle % (away/home) ← away = first value
 *   td[3]: spread bets % (away/home)   ← away = first value
 *   td[4]: total (over/under) — ignored
 *   td[5]: total handle % (over/under)  ← over = first value
 *   td[6]: total bets % (over/under)    ← over = first value
 *   td[7]: moneyline (away/home) — ignored
 *   td[8]: ML handle % (away/home)      ← away = first value
 *   td[9]: ML bets % (away/home)        ← away = first value
 *
 * ─── MLB table structure (10 <td> cells per game row) ───
 *   td[0]: team names (away/home) + game ID in data-param2
 *   td[1]: moneyline (away/home) — ignored
 *   td[2]: ML handle % (away/home)      ← away = first value
 *   td[3]: ML bets % (away/home)        ← away = first value
 *   td[4]: total (over/under) — ignored
 *   td[5]: total handle % (over/under)  ← over = first value
 *   td[6]: total bets % (over/under)    ← over = first value
 *   td[7]: run line (away/home) — ignored
 *   td[8]: RL handle % (away/home)      ← away = first value
 *   td[9]: RL bets % (away/home)        ← away = first value
 *
 * Team matching: VSiN uses href="/nba/teams/new-york-knicks" or
 *   "/mlb/teams/new-york-yankees" — we extract the last path segment
 *   as the vsinSlug.
 *
 * Game ID format: 20260313NBA00073 or 20260325MLB00029
 *
 * Auth: No authentication required — data is publicly accessible.
 */

import * as cheerio from "cheerio";

export type VsinSplitsSport = "NBA" | "CBB" | "NHL" | "MLB";

export interface VsinSplitsGame {
  /** VSiN game ID, e.g. "20260313NBA00073" */
  gameId: string;
  /** Sport: "NBA" | "CBB" | "NHL" */
  sport: VsinSplitsSport;
  /** Away team VSiN slug, e.g. "new-york-knicks" */
  awayVsinSlug: string;
  /** Home team VSiN slug, e.g. "indiana-pacers" */
  homeVsinSlug: string;
  /** Away team display name from VSiN */
  awayName: string;
  /** Home team display name from VSiN */
  homeName: string;
  /** % of spread handle on away team (0-100), null if not available */
  spreadAwayMoneyPct: number | null;
  /** % of spread bets on away team (0-100), null if not available */
  spreadAwayBetsPct: number | null;
  /** % of total handle on Over (0-100), null if not available */
  totalOverMoneyPct: number | null;
  /** % of total bets on Over (0-100), null if not available */
  totalOverBetsPct: number | null;
  /** % of ML handle on away team (0-100), null if not available */
  mlAwayMoneyPct: number | null;
  /** % of ML bets on away team (0-100), null if not available */
  mlAwayBetsPct: number | null;
}

const VSIN_BASE = "https://data.vsin.com/betting-splits/?bookid=dk";
const VSIN_MLB_URL = "https://data.vsin.com/mlb/betting-splits/";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://data.vsin.com/",
};

/**
 * Extract the first percentage integer from a <td> element.
 * Looks for text matching "XX%" in child divs.
 * Returns null if not found.
 */
function getFirstPct($: cheerio.CheerioAPI, td: any): number | null {
  const divs = $(td).children("div");
  for (let i = 0; i < divs.length; i++) {
    const text = $(divs[i]).text().trim().replace(/\s+/g, "");
    const m = text.match(/^(\d+)%/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Extract a VSiN team slug from an anchor href.
 * e.g. "/nba/teams/new-york-knicks" → "new-york-knicks"
 * e.g. "/cbb/teams/duke" → "duke"
 */
function extractVsinSlug(href: string): string {
  const parts = href.split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * Detect sport from a VSiN game ID string.
 * e.g. "20260313NBA00073" → "NBA"
 * e.g. "20260313CBB00891" → "CBB"
 * e.g. "20260313NHL00094" → "NHL"
 * e.g. "20260325MLB00001" → "MLB"
 */
function detectSportFromGameId(gameId: string): VsinSplitsSport | null {
  const m = gameId.match(/^\d{8}([A-Z]+)\d+$/);
  if (!m) return null;
  const code = m[1];
  if (code === "NBA") return "NBA";
  if (code === "CBB") return "CBB";
  if (code === "NHL") return "NHL";
  if (code === "MLB") return "MLB";
  return null;
}

/**
 * Parse game rows from a VSiN splits table.
 *
 * @param $ - Cheerio API instance
 * @param table - The freezetable element
 * @param isMlb - If true, use MLB column order (ML→Total→RL); otherwise use NBA/CBB/NHL order (Spread→Total→ML)
 * @param logTag - Prefix for log messages
 * @returns Array of VsinSplitsGame objects
 */
function parseGameRows(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<any>,
  isMlb: boolean,
  logTag: string
): VsinSplitsGame[] {
  const results: VsinSplitsGame[] = [];
  let currentSport: VsinSplitsSport = isMlb ? "MLB" : "NBA";
  let rowsProcessed = 0;
  let rowsSkipped = 0;

  table.find("tr").each((_i, row) => {
    const ths = $(row).find("th");
    if (ths.length > 0) {
      // Header row — detect sport from first th text (date header like "Wednesday,Mar 25")
      const headerText = $(ths[0]).text().trim();
      if (!isMlb) {
        if (headerText.includes("NBA")) currentSport = "NBA";
        else if (headerText.includes("CBB") || headerText.includes("College Basketball")) currentSport = "CBB";
        else if (headerText.includes("NHL")) currentSport = "NHL";
      }
      // MLB page always has MLB sport; header rows just show the date
      return; // continue to next row
    }

    const tds = $(row).find("td");
    if (tds.length < 10) {
      rowsSkipped++;
      return;
    }

    rowsProcessed++;

    // td[0]: team names + game ID in data-param2 attribute
    const td0 = tds[0];
    const gameIdEl = $(td0).find("a[data-param2]").first();
    const gameId = gameIdEl.attr("data-param2") ?? "";
    if (!gameId) {
      console.warn(`${logTag} Row ${rowsProcessed}: no game ID found, skipping`);
      return;
    }

    // Detect sport from game ID (most reliable — e.g. "20260325MLB00029" → MLB)
    const detectedSport = detectSportFromGameId(gameId);
    const sport: VsinSplitsSport = detectedSport ?? currentSport;

    // Extract team links — exclude "VSiN Pick" anchor links
    const teamLinks = $(td0).find("a.txt-color-vsinred").filter((_j, a) => {
      const text = $(a).text().trim();
      return !text.includes("VSiN Pick") && !text.includes("Pick");
    });

    if (teamLinks.length < 2) {
      console.warn(`${logTag} Game ${gameId}: found ${teamLinks.length} team links (expected 2), skipping`);
      return;
    }

    const awayLink = teamLinks[0];
    const homeLink = teamLinks[1];
    const awayName = $(awayLink).text().trim();
    const homeName = $(homeLink).text().trim().replace(/\s+/g, " ");
    const awayHref = $(awayLink).attr("href") ?? "";
    const homeHref = $(homeLink).attr("href") ?? "";
    const awayVsinSlug = extractVsinSlug(awayHref);
    const homeVsinSlug = extractVsinSlug(homeHref);

    if (!awayVsinSlug || !homeVsinSlug) {
      console.warn(`${logTag} Game ${gameId}: could not extract team slugs (away="${awayVsinSlug}" home="${homeVsinSlug}"), skipping`);
      return;
    }

    let spreadAwayMoneyPct: number | null;
    let spreadAwayBetsPct: number | null;
    let totalOverMoneyPct: number | null;
    let totalOverBetsPct: number | null;
    let mlAwayMoneyPct: number | null;
    let mlAwayBetsPct: number | null;

    if (isMlb) {
      // MLB column order: ML(1-3) → Total(4-6) → Run Line(7-9)
      // td[2]: ML handle % — first value = away
      mlAwayMoneyPct = getFirstPct($, tds[2]);
      // td[3]: ML bets % — first value = away
      mlAwayBetsPct = getFirstPct($, tds[3]);
      // td[5]: total handle % — first value = over
      totalOverMoneyPct = getFirstPct($, tds[5]);
      // td[6]: total bets % — first value = over
      totalOverBetsPct = getFirstPct($, tds[6]);
      // td[8]: run line handle % — first value = away (maps to spreadAwayMoneyPct)
      spreadAwayMoneyPct = getFirstPct($, tds[8]);
      // td[9]: run line bets % — first value = away (maps to spreadAwayBetsPct)
      spreadAwayBetsPct = getFirstPct($, tds[9]);
    } else {
      // NBA/CBB/NHL column order: Spread(1-3) → Total(4-6) → ML(7-9)
      // td[2]: spread handle % — first value = away
      spreadAwayMoneyPct = getFirstPct($, tds[2]);
      // td[3]: spread bets % — first value = away
      spreadAwayBetsPct = getFirstPct($, tds[3]);
      // td[5]: total handle % — first value = over
      totalOverMoneyPct = getFirstPct($, tds[5]);
      // td[6]: total bets % — first value = over
      totalOverBetsPct = getFirstPct($, tds[6]);
      // td[8]: ML handle % — first value = away
      mlAwayMoneyPct = getFirstPct($, tds[8]);
      // td[9]: ML bets % — first value = away
      mlAwayBetsPct = getFirstPct($, tds[9]);
    }

    console.log(
      `${logTag} ✅ ${gameId} | ${sport} | ${awayName} @ ${homeName}` +
      ` | RL/Spread: ${spreadAwayMoneyPct}%H ${spreadAwayBetsPct}%B` +
      ` | Total: ${totalOverMoneyPct}%H ${totalOverBetsPct}%B` +
      ` | ML: ${mlAwayMoneyPct}%H ${mlAwayBetsPct}%B`
    );

    results.push({
      gameId,
      sport,
      awayVsinSlug,
      homeVsinSlug,
      awayName,
      homeName,
      spreadAwayMoneyPct,
      spreadAwayBetsPct,
      totalOverMoneyPct,
      totalOverBetsPct,
      mlAwayMoneyPct,
      mlAwayBetsPct,
    });
  });

  console.log(
    `${logTag} Processed ${rowsProcessed} rows, skipped ${rowsSkipped}, parsed ${results.length} games`
  );
  return results;
}

/**
 * Scrapes the VSiN NBA/CBB/NHL betting splits page.
 *
 * @param view - "front" for today, "tomorrow" for tomorrow
 * @returns Array of VsinSplitsGame objects for NBA, CBB, and NHL
 */
export async function scrapeVsinBettingSplits(
  view: "front" | "tomorrow" = "front"
): Promise<VsinSplitsGame[]> {
  const url = `${VSIN_BASE}&view=${view}`;
  const logTag = `[VSiNSplits][${view}]`;
  console.log(`${logTag} Fetching ${url}...`);
  const startTime = Date.now();

  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    throw new Error(`${logTag} HTTP ${resp.status} fetching ${url}`);
  }
  const html = await resp.text();
  const $ = cheerio.load(html);

  const table = $("table.freezetable");
  if (!table.length) {
    console.warn(`${logTag} No freezetable found — page may have changed`);
    return [];
  }

  console.log(`${logTag} Found freezetable, parsing rows (NBA/CBB/NHL column order)...`);
  const results = parseGameRows($, table, false, logTag);

  console.log(
    `${logTag} ✅ DONE — ${results.length} games parsed in ${Date.now() - startTime}ms`
  );
  return results;
}

/**
 * Scrapes the VSiN MLB betting splits page (dedicated URL, different column order).
 *
 * MLB column order: Moneyline(1-3) → Total(4-6) → Run Line(7-9)
 * The run line splits are mapped to spreadAwayMoneyPct / spreadAwayBetsPct.
 *
 * @returns Array of VsinSplitsGame objects for MLB
 */
export async function scrapeVsinMlbBettingSplits(): Promise<VsinSplitsGame[]> {
  const logTag = `[VSiNSplits][MLB]`;
  console.log(`${logTag} Fetching ${VSIN_MLB_URL}...`);
  const startTime = Date.now();

  const resp = await fetch(VSIN_MLB_URL, { headers: HEADERS });
  if (!resp.ok) {
    throw new Error(`${logTag} HTTP ${resp.status} fetching ${VSIN_MLB_URL}`);
  }
  const html = await resp.text();
  const $ = cheerio.load(html);

  const table = $("table.freezetable");
  if (!table.length) {
    console.warn(`${logTag} No freezetable found on MLB page — page may have changed`);
    console.warn(`${logTag} Page HTML snippet (first 500 chars): ${html.substring(0, 500)}`);
    return [];
  }

  console.log(`${logTag} Found freezetable, parsing rows (MLB column order: ML→Total→RL)...`);
  const results = parseGameRows($, table, true, logTag);

  console.log(
    `${logTag} ✅ DONE — ${results.length} MLB games parsed in ${Date.now() - startTime}ms`
  );
  return results;
}

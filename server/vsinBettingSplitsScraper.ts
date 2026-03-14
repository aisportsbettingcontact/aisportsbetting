/**
 * vsinBettingSplitsScraper.ts
 *
 * Scrapes the VSiN DraftKings betting splits page at:
 *   https://data.vsin.com/betting-splits/?bookid=dk&view=front   (today)
 *   https://data.vsin.com/betting-splits/?bookid=dk&view=tomorrow (tomorrow)
 *
 * Extracts ONLY betting splits (Handle % and Bets %) for:
 *   - Spread (away handle %, away bets %)
 *   - Total (over handle %, over bets %)
 *   - Moneyline (away handle %, away bets %)
 *
 * Does NOT extract odds values — those come from Action Network.
 *
 * Table structure (per game row, 10 <td> cells):
 *   td[0]: team names (away/home) + game ID in data-param2
 *   td[1]: spread (away/home) — ignored
 *   td[2]: spread handle % (away/home) ← we take first value = away
 *   td[3]: spread bets % (away/home) ← we take first value = away
 *   td[4]: total (over/under) — ignored
 *   td[5]: total handle % (over/under) ← we take first value = over
 *   td[6]: total bets % (over/under) ← we take first value = over
 *   td[7]: moneyline (away/home) — ignored
 *   td[8]: ML handle % (away/home) ← we take first value = away
 *   td[9]: ML bets % (away/home) ← we take first value = away
 *
 * Team matching: VSiN uses href="/nba/teams/new-york-knicks" format
 * which matches the vsinSlug in our team registries.
 *
 * Game ID format: 20260313NBA00073 (YYYYMMDD + SPORT + team_id)
 *
 * Auth: No authentication required — data is publicly accessible.
 */

import * as cheerio from "cheerio";

export type VsinSplitsSport = "NBA" | "CBB" | "NHL";

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
 */
function detectSportFromGameId(gameId: string): VsinSplitsSport | null {
  const m = gameId.match(/^\d{8}([A-Z]+)\d+$/);
  if (!m) return null;
  const code = m[1];
  if (code === "NBA") return "NBA";
  if (code === "CBB") return "CBB";
  if (code === "NHL") return "NHL";
  return null;
}

/**
 * Scrapes the VSiN betting splits page and returns all game splits.
 *
 * @param view - "front" for today, "tomorrow" for tomorrow
 * @returns Array of VsinSplitsGame objects
 */
export async function scrapeVsinBettingSplits(
  view: "front" | "tomorrow" = "front"
): Promise<VsinSplitsGame[]> {
  const url = `${VSIN_BASE}&view=${view}`;
  console.log(`[VSiNSplits] Fetching ${url}...`);
  const startTime = Date.now();

  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    throw new Error(`[VSiNSplits] HTTP ${resp.status} fetching ${url}`);
  }
  const html = await resp.text();
  const $ = cheerio.load(html);

  const table = $("table.freezetable");
  if (!table.length) {
    console.warn("[VSiNSplits] No freezetable found — page may have changed");
    return [];
  }

  const results: VsinSplitsGame[] = [];
  let currentSport: VsinSplitsSport = "NBA";

  table.find("tr").each((_i, row) => {
    const ths = $(row).find("th");
    if (ths.length > 0) {
      // Header row — detect sport from first th text
      const headerText = $(ths[0]).text().trim();
      if (headerText.includes("NBA")) currentSport = "NBA";
      else if (headerText.includes("CBB") || headerText.includes("College Basketball")) currentSport = "CBB";
      else if (headerText.includes("NHL")) currentSport = "NHL";
      return; // continue
    }

    const tds = $(row).find("td");
    if (tds.length < 10) return; // skip non-game rows

    // td[0]: team names + game ID
    const td0 = tds[0];
    const gameIdEl = $(td0).find("a[data-param2]").first();
    const gameId = gameIdEl.attr("data-param2") ?? "";
    if (!gameId) return;

    // Detect sport from game ID (more reliable than header tracking)
    const detectedSport = detectSportFromGameId(gameId);
    const sport: VsinSplitsSport = detectedSport ?? currentSport;

    // Get team links (exclude "VSiN Pick" links)
    const teamLinks = $(td0).find("a.txt-color-vsinred").filter((_j, a) => {
      return !$(a).text().includes("VSiN Pick");
    });

    if (teamLinks.length < 2) return;

    const awayLink = teamLinks[0];
    const homeLink = teamLinks[1];
    const awayName = $(awayLink).text().trim();
    const homeName = $(homeLink).text().trim().replace(/\s+/g, " ");
    const awayHref = $(awayLink).attr("href") ?? "";
    const homeHref = $(homeLink).attr("href") ?? "";
    const awayVsinSlug = extractVsinSlug(awayHref);
    const homeVsinSlug = extractVsinSlug(homeHref);

    if (!awayVsinSlug || !homeVsinSlug) return;

    // td[2]: spread handle % — first value = away
    const spreadAwayMoneyPct = getFirstPct($, tds[2]);
    // td[3]: spread bets % — first value = away
    const spreadAwayBetsPct = getFirstPct($, tds[3]);
    // td[5]: total handle % — first value = over
    const totalOverMoneyPct = getFirstPct($, tds[5]);
    // td[6]: total bets % — first value = over
    const totalOverBetsPct = getFirstPct($, tds[6]);
    // td[8]: ML handle % — first value = away
    const mlAwayMoneyPct = getFirstPct($, tds[8]);
    // td[9]: ML bets % — first value = away
    const mlAwayBetsPct = getFirstPct($, tds[9]);

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
    `[VSiNSplits] Parsed ${results.length} games from ${view} in ${Date.now() - startTime}ms`
  );
  return results;
}

/**
 * vsinBettingSplitsScraper.ts
 *
 * Scrapes VSiN DraftKings betting splits from the unified page:
 *
 *   https://data.vsin.com/betting-splits/?bookid=dk&view=front   (today)
 *   https://data.vsin.com/betting-splits/?bookid=dk&view=tomorrow (tomorrow)
 *
 * VSiN migrated from table.freezetable to table.sp-table in March 2026.
 * The page now contains one sp-table block per sport (NBA, MLB, NHL, CBB)
 * all on the same unified URL. The MLB-specific URL now redirects here.
 *
 * ─── New sp-table row structure (11 <td> cells per game row, 0-indexed) ───
 *   td[0]:  action cell — contains <button data-gamecode="20260330MLB00008">
 *   td[1]:  team cell  — contains <a class="sp-team-link" href="/mlb/teams/minnesota-twins">
 *   td[2]:  spread/run-line value (ignored)
 *   td[3]:  spread handle %  ← away team row = away handle; home row = home handle
 *   td[4]:  spread bets %    ← away team row = away bets;   home row = home bets
 *   td[5]:  total line value (ignored)
 *   td[6]:  total handle %   ← away row = over handle
 *   td[7]:  total bets %     ← away row = over bets
 *   td[8]:  moneyline value (ignored)
 *   td[9]:  ML handle %      ← away team row = away ML handle
 *   td[10]: ML bets %        ← away team row = away ML bets
 *
 * Column order is IDENTICAL for all sports (NBA, MLB, NHL, CBB).
 *
 * Game rows come in pairs: away row first, home row second.
 * We only need the away row for all percentages (handle/bets are always
 * expressed as the away-team or over-side percentage).
 *
 * Sport detection: from data-gamecode value (e.g. "20260330MLB00008" → MLB).
 *
 * Team matching: slug extracted from href last segment
 *   e.g. "/mlb/teams/minnesota-twins" → "minnesota-twins"
 *
 * Auth: No authentication required — data is publicly accessible.
 */

import * as cheerio from "cheerio";

export type VsinSplitsSport = "NBA" | "CBB" | "NHL" | "MLB";

export interface VsinSplitsGame {
  /** VSiN game ID, e.g. "20260330MLB00008" */
  gameId: string;
  /** Sport: "NBA" | "CBB" | "NHL" | "MLB" */
  sport: VsinSplitsSport;
  /** Away team VSiN slug, e.g. "minnesota-twins" */
  awayVsinSlug: string;
  /** Home team VSiN slug, e.g. "kansas-city-royals" */
  homeVsinSlug: string;
  /** Away team display name from VSiN */
  awayName: string;
  /** Home team display name from VSiN */
  homeName: string;
  /** % of spread/run-line handle on away team (0-100), null if not available */
  spreadAwayMoneyPct: number | null;
  /** % of spread/run-line bets on away team (0-100), null if not available */
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
 * Extract the first integer percentage from a <td> element.
 * Looks for text matching "XX%" inside sp-badge spans.
 * Strips arrow indicators (▲▼) before parsing.
 * Returns null if not found.
 */
function extractPctFromTd($: cheerio.CheerioAPI, td: any): number | null {
  const badge = $(td).find("span.sp-badge").first();
  if (!badge.length) return null;
  // Get text content, strip HTML entities and arrow spans
  const raw = badge.clone().find("span").remove().end().text().trim();
  const m = raw.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract VSiN team slug from an anchor href.
 * e.g. "/mlb/teams/minnesota-twins" → "minnesota-twins"
 * e.g. "/nba/teams/new-york-knicks" → "new-york-knicks"
 */
function extractVsinSlug(href: string): string {
  const parts = href.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Detect sport from a VSiN game ID string.
 * e.g. "20260330MLB00008" → "MLB"
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
  if (code === "MLB") return "MLB";
  return null;
}

/**
 * Parse game rows from a single sp-table block.
 *
 * Rows come in pairs (away, home). We read the away row for all percentages
 * and the home row only for the home team name/slug.
 *
 * New column layout (same for ALL sports):
 *   td[3] = spread handle % (away)
 *   td[4] = spread bets %   (away)
 *   td[6] = total handle %  (over)
 *   td[7] = total bets %    (over)
 *   td[9] = ML handle %     (away)
 *   td[10]= ML bets %       (away)
 */
function parseSpTable(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<any>,
  logTag: string,
  filterSport?: VsinSplitsSport
): VsinSplitsGame[] {
  const results: VsinSplitsGame[] = [];

  // Collect only sp-row rows (skip header rows which have sp-sport-header class)
  const gameRows: cheerio.Cheerio<any>[] = [];
  table.find("tr.sp-row").each((_i, row) => {
    gameRows.push($(row));
  });

  console.log(`${logTag} Found ${gameRows.length} sp-row rows (${gameRows.length / 2} games)`);

  let gamesProcessed = 0;
  let gamesSkipped = 0;

  for (let i = 0; i < gameRows.length - 1; i += 2) {
    const awayRow = gameRows[i];
    const homeRow = gameRows[i + 1];

    // ── Extract game ID from action cell button ──────────────────────────────
    const gameId = awayRow.find("button[data-gamecode]").attr("data-gamecode") ?? "";
    if (!gameId) {
      console.warn(`${logTag} Row pair ${i}: no data-gamecode found, skipping`);
      gamesSkipped++;
      continue;
    }

    // ── Detect sport ─────────────────────────────────────────────────────────
    const sport = detectSportFromGameId(gameId);
    if (!sport) {
      console.warn(`${logTag} Game ${gameId}: unrecognized sport code, skipping`);
      gamesSkipped++;
      continue;
    }

    // Apply sport filter if requested
    if (filterSport && sport !== filterSport) {
      continue; // silently skip — different sport block
    }

    // ── Extract team names and slugs ─────────────────────────────────────────
    const awayLink = awayRow.find("a.sp-team-link").first();
    const homeLink = homeRow.find("a.sp-team-link").first();

    if (!awayLink.length || !homeLink.length) {
      console.warn(`${logTag} Game ${gameId}: missing sp-team-link (away=${awayLink.length} home=${homeLink.length}), skipping`);
      gamesSkipped++;
      continue;
    }

    const awayName = awayLink.text().trim();
    const homeName = homeLink.text().trim();
    const awayHref = awayLink.attr("href") ?? "";
    const homeHref = homeLink.attr("href") ?? "";
    const awayVsinSlug = extractVsinSlug(awayHref);
    const homeVsinSlug = extractVsinSlug(homeHref);

    if (!awayVsinSlug || !homeVsinSlug) {
      console.warn(`${logTag} Game ${gameId}: could not extract slugs (away="${awayVsinSlug}" home="${homeVsinSlug}"), skipping`);
      gamesSkipped++;
      continue;
    }

    // ── Extract percentages from away row (new unified column order) ─────────
    // td[0]=action, td[1]=team, td[2]=spread_line,
    // td[3]=spread_handle%, td[4]=spread_bets%,
    // td[5]=total_line, td[6]=total_handle%, td[7]=total_bets%,
    // td[8]=ml_line, td[9]=ml_handle%, td[10]=ml_bets%
    const awayTds = awayRow.find("td");

    if (awayTds.length < 11) {
      console.warn(`${logTag} Game ${gameId}: expected 11 tds, got ${awayTds.length}, skipping`);
      gamesSkipped++;
      continue;
    }

    const spreadAwayMoneyPct = extractPctFromTd($, awayTds.eq(3));
    const spreadAwayBetsPct  = extractPctFromTd($, awayTds.eq(4));
    const totalOverMoneyPct  = extractPctFromTd($, awayTds.eq(6));
    const totalOverBetsPct   = extractPctFromTd($, awayTds.eq(7));
    const mlAwayMoneyPct     = extractPctFromTd($, awayTds.eq(9));
    const mlAwayBetsPct      = extractPctFromTd($, awayTds.eq(10));

    console.log(
      `${logTag} ✅ ${gameId} | ${sport} | ${awayName} @ ${homeName}` +
      ` | Spread: ${spreadAwayMoneyPct}%H ${spreadAwayBetsPct}%B` +
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

    gamesProcessed++;
  }

  console.log(
    `${logTag} Parsed ${gamesProcessed} games, skipped ${gamesSkipped} pairs`
  );
  return results;
}

/**
 * Scrapes the VSiN unified betting splits page for NBA/CBB/NHL/MLB.
 *
 * VSiN now serves all sports from a single page with one sp-table block
 * per sport. The old freezetable format is gone as of March 2026.
 *
 * @param view - "front" for today, "tomorrow" for tomorrow
 * @param filterSport - Optional: only return games for this sport
 * @returns Array of VsinSplitsGame objects
 */
export async function scrapeVsinBettingSplits(
  view: "front" | "tomorrow" = "front",
  filterSport?: VsinSplitsSport
): Promise<VsinSplitsGame[]> {
  const url = `${VSIN_BASE}&view=${view}`;
  const logTag = `[VSiNSplits][${view}${filterSport ? `/${filterSport}` : ""}]`;
  console.log(`${logTag} Fetching ${url}...`);
  const startTime = Date.now();

  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    throw new Error(`${logTag} HTTP ${resp.status} fetching ${url}`);
  }
  const html = await resp.text();
  const $ = cheerio.load(html);

  // New format: one sp-table per sport block
  const tables = $("table.sp-table");
  if (!tables.length) {
    // Fallback: check for old freezetable (in case VSiN reverts)
    const legacyTable = $("table.freezetable");
    if (legacyTable.length) {
      console.warn(`${logTag} Found legacy freezetable — VSiN may have reverted to old format`);
      // Legacy parsing not supported in this version — return empty and log
      console.error(`${logTag} Legacy freezetable parsing removed. Update scraper to re-add support.`);
      return [];
    }
    console.error(`${logTag} No sp-table or freezetable found — page structure unknown`);
    console.error(`${logTag} Page HTML snippet: ${html.substring(0, 800)}`);
    return [];
  }

  console.log(`${logTag} Found ${tables.length} sp-table block(s)`);

  const allResults: VsinSplitsGame[] = [];
  tables.each((_i, table) => {
    // Detect which sport this table block covers from the sport header
    const sportHeader = $(table).find("th.sp-sport-name").text().trim();
    const blockSport = sportHeader.includes("NBA") ? "NBA"
      : sportHeader.includes("MLB") ? "MLB"
      : sportHeader.includes("NHL") ? "NHL"
      : sportHeader.includes("CBB") || sportHeader.includes("College") ? "CBB"
      : null;

    const blockTag = `${logTag}[${blockSport ?? "UNKNOWN"}]`;
    console.log(`${blockTag} Parsing sp-table block (header: "${sportHeader.substring(0, 60)}")`);

    const parsed = parseSpTable($, $(table), blockTag, filterSport);
    allResults.push(...parsed);
  });

  console.log(
    `${logTag} ✅ DONE — ${allResults.length} total games parsed in ${Date.now() - startTime}ms`
  );
  return allResults;
}

/**
 * Scrapes VSiN MLB betting splits specifically.
 *
 * Previously used a dedicated MLB URL (https://data.vsin.com/mlb/betting-splits/)
 * which now redirects to the unified page. This function is maintained for
 * backward compatibility with callers in vsinAutoRefresh.ts.
 *
 * @returns Array of VsinSplitsGame objects for MLB only
 */
export async function scrapeVsinMlbBettingSplits(): Promise<VsinSplitsGame[]> {
  const logTag = `[VSiNSplits][MLB]`;
  console.log(`${logTag} Fetching MLB splits from unified page (old MLB URL now redirects)...`);
  const startTime = Date.now();

  // Use the unified page with MLB filter — the old /mlb/betting-splits/ URL
  // redirects to /betting-splits/?source=DK&sport=MLB which is the same page
  const results = await scrapeVsinBettingSplits("front", "MLB");

  console.log(
    `${logTag} ✅ DONE — ${results.length} MLB games parsed in ${Date.now() - startTime}ms`
  );
  return results;
}

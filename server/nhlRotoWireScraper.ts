/**
 * nhlRotoWireScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes starting goalies and forward lines from RotoWire NHL Lineups page.
 *
 * Data source:
 *   https://www.rotowire.com/hockey/nhl-lineups.php
 *
 * Outputs:
 *   NhlLineupGame — per-game lineup with starting goalies confirmed/projected
 */

import * as cheerio from "cheerio";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlStartingGoalie {
  name: string;
  confirmed: boolean;   // true = confirmed starter, false = projected
  team: string;         // NHL abbreviation
}

export interface NhlLineupGame {
  awayTeam: string;     // NHL abbreviation (e.g. "BOS")
  homeTeam: string;     // NHL abbreviation (e.g. "TOR")
  awayGoalie: NhlStartingGoalie | null;
  homeGoalie: NhlStartingGoalie | null;
  gameTime: string;     // e.g. "7:00 PM ET"
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROTOWIRE_LINEUPS_URL = "https://www.rotowire.com/hockey/nhl-lineups.php";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.rotowire.com/",
};

// ─── Team Abbreviation Normalization ─────────────────────────────────────────
// RotoWire uses full team names or different abbreviations
const ROTOWIRE_TEAM_MAP: Record<string, string> = {
  "Anaheim Ducks":          "ANA",
  "Arizona Coyotes":        "ARI",
  "Utah Hockey Club":       "UTA",
  "Boston Bruins":          "BOS",
  "Buffalo Sabres":         "BUF",
  "Calgary Flames":         "CGY",
  "Carolina Hurricanes":    "CAR",
  "Chicago Blackhawks":     "CHI",
  "Colorado Avalanche":     "COL",
  "Columbus Blue Jackets":  "CBJ",
  "Dallas Stars":           "DAL",
  "Detroit Red Wings":      "DET",
  "Edmonton Oilers":        "EDM",
  "Florida Panthers":       "FLA",
  "Los Angeles Kings":      "LAK",
  "Minnesota Wild":         "MIN",
  "Montreal Canadiens":     "MTL",
  "Nashville Predators":    "NSH",
  "New Jersey Devils":      "NJD",
  "New York Islanders":     "NYI",
  "New York Rangers":       "NYR",
  "Ottawa Senators":        "OTT",
  "Philadelphia Flyers":    "PHI",
  "Pittsburgh Penguins":    "PIT",
  "San Jose Sharks":        "SJS",
  "Seattle Kraken":         "SEA",
  "St. Louis Blues":        "STL",
  "Tampa Bay Lightning":    "TBL",
  "Toronto Maple Leafs":    "TOR",
  "Vancouver Canucks":      "VAN",
  "Vegas Golden Knights":   "VGK",
  "Washington Capitals":    "WSH",
  "Winnipeg Jets":          "WPG",
};

function normalizeTeam(raw: string): string {
  const trimmed = raw.trim();
  return ROTOWIRE_TEAM_MAP[trimmed] ?? trimmed.toUpperCase().slice(0, 3);
}

// ─── Scraper ─────────────────────────────────────────────────────────────────

/**
 * Scrape RotoWire NHL lineups page for today's starting goalies.
 * Returns a list of games with away/home starting goalies.
 */
export async function scrapeNhlStartingGoalies(): Promise<NhlLineupGame[]> {
  console.log("[RotoWireScraper] ► Fetching NHL lineups from RotoWire...");
  console.log(`[RotoWireScraper]   URL: ${ROTOWIRE_LINEUPS_URL}`);

  const resp = await fetch(ROTOWIRE_LINEUPS_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) {
    throw new Error(`[RotoWireScraper] Fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  }
  const html = await resp.text();
  console.log(`[RotoWireScraper]   Received ${html.length} bytes`);

  const $ = cheerio.load(html);
  const games: NhlLineupGame[] = [];

  // RotoWire lineup page structure: each game is in a .lineup__box or .lineup-card container
  const gameContainers = $(".lineup__box, .lineup-card, [class*='lineup__box']");
  console.log(`[RotoWireScraper]   Found ${gameContainers.length} game containers`);

  if (gameContainers.length === 0) {
    // Try alternative structure
    return parseAlternativeStructure($, html);
  }

  gameContainers.each((idx, container) => {
    const $container = $(container);

    // Extract team names
    const teamNames = $container.find(".lineup__team-name, .team-name, [class*='team-name']");
    const awayTeamRaw = $(teamNames[0]).text().trim();
    const homeTeamRaw = $(teamNames[1]).text().trim();

    if (!awayTeamRaw || !homeTeamRaw) return;

    const awayTeam = normalizeTeam(awayTeamRaw);
    const homeTeam = normalizeTeam(homeTeamRaw);

    // Extract game time
    const gameTime = $container.find(".lineup__time, .game-time, [class*='game-time']").first().text().trim();

    // Extract starting goalies
    // RotoWire shows goalies in .lineup__goalie or similar
    const goalieEls = $container.find(".lineup__goalie, .goalie, [class*='goalie']");
    let awayGoalie: NhlStartingGoalie | null = null;
    let homeGoalie: NhlStartingGoalie | null = null;

    goalieEls.each((gIdx, goalieEl) => {
      const $goalie = $(goalieEl);
      const name = $goalie.find("a, .player-name, [class*='player']").first().text().trim()
        || $goalie.text().trim();
      const confirmed = !$goalie.hasClass("is-projected") && !$goalie.hasClass("projected");

      if (!name) return;

      if (gIdx === 0) {
        awayGoalie = { name, confirmed, team: awayTeam } as NhlStartingGoalie;
      } else if (gIdx === 1) {
        homeGoalie = { name, confirmed, team: homeTeam } as NhlStartingGoalie;
      }
    });

    const game: NhlLineupGame = {
      awayTeam, homeTeam,
      awayGoalie, homeGoalie,
      gameTime,
    };
    games.push(game);

    const awayG = awayGoalie as NhlStartingGoalie | null;
    const homeG = homeGoalie as NhlStartingGoalie | null;
    console.log(
      `[RotoWireScraper]   Game ${idx}: ${awayTeam} @ ${homeTeam} | ` +
      `Away G: ${awayG?.name ?? "TBD"} (${awayG?.confirmed ? "CONFIRMED" : "PROJECTED"}) | ` +
      `Home G: ${homeG?.name ?? "TBD"} (${homeG?.confirmed ? "CONFIRMED" : "PROJECTED"})`
    );
  });

  console.log(`[RotoWireScraper] ✅ Scraped ${games.length} games with goalie data`);
  return games;
}

/**
 * Alternative parser for when the primary selector doesn't match.
 * Tries to find goalie data from a different page structure.
 */
function parseAlternativeStructure($: cheerio.CheerioAPI, html: string): NhlLineupGame[] {
  console.log("[RotoWireScraper] ⚠ Trying alternative page structure...");
  const games: NhlLineupGame[] = [];

  // Look for any table or list with goalie names
  // Try to find game blocks by looking for team abbreviations
  const gameBlocks = $("[class*='game'], [class*='matchup'], [data-game-id]");
  console.log(`[RotoWireScraper]   Alternative: found ${gameBlocks.length} game blocks`);

  gameBlocks.each((idx, block) => {
    const $block = $(block);
    const text = $block.text();

    // Extract team abbreviations from data attributes or text
    const awayTeam = $block.attr("data-away-team") || $block.find("[class*='away'] [class*='abbrev']").text().trim();
    const homeTeam = $block.attr("data-home-team") || $block.find("[class*='home'] [class*='abbrev']").text().trim();

    if (!awayTeam || !homeTeam) return;

    games.push({
      awayTeam: awayTeam.toUpperCase(),
      homeTeam: homeTeam.toUpperCase(),
      awayGoalie: null,
      homeGoalie: null,
      gameTime: "",
    });
  });

  if (games.length === 0) {
    console.warn("[RotoWireScraper] ⚠ Could not parse any games from RotoWire — page structure unknown");
  }

  return games;
}

// ─── Goalie Name Lookup ───────────────────────────────────────────────────────

/**
 * Fuzzy match a goalie name from RotoWire against NaturalStatTrick goalie stats.
 * RotoWire may use "J. Swayman" while NST uses "Jeremy Swayman".
 */
export function matchGoalieName(
  rotoName: string,
  nstGoalieMap: Map<string, import("./nhlNaturalStatScraper").NhlGoalieStats>
): import("./nhlNaturalStatScraper").NhlGoalieStats | null {
  if (!rotoName) return null;

  // Try exact match first
  const exact = nstGoalieMap.get(rotoName) ?? nstGoalieMap.get(rotoName.toLowerCase());
  if (exact) return exact;

  // Try last name match
  const parts = rotoName.trim().split(/\s+/);
  const lastName = parts[parts.length - 1].toLowerCase();

  for (const entry of Array.from(nstGoalieMap.entries())) {
    const [key, stats] = entry;
    const keyParts = key.split(/\s+/);
    const keyLastName = keyParts[keyParts.length - 1].toLowerCase();
    if (keyLastName === lastName) {
      console.log(`[RotoWireScraper]   Goalie fuzzy match: "${rotoName}" → "${stats.name}"`);
      return stats;
    }
  }

  // Try first initial + last name (e.g. "J. Swayman")
  if (rotoName.includes(".")) {
    const initial = rotoName[0].toLowerCase();
    for (const entry of Array.from(nstGoalieMap.entries())) {
      const [key, stats] = entry;
      const keyParts = key.split(/\s+/);
      if (keyParts.length >= 2) {
        const keyInitial = keyParts[0][0].toLowerCase();
        const keyLastName = keyParts[keyParts.length - 1].toLowerCase();
        if (keyInitial === initial && keyLastName === lastName) {
          console.log(`[RotoWireScraper]   Goalie initial match: "${rotoName}" → "${stats.name}"`);
          return stats;
        }
      }
    }
  }

  console.warn(`[RotoWireScraper] ⚠ No goalie match found for: "${rotoName}"`);
  return null;
}

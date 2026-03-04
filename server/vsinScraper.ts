/**
 * VSiN College Basketball Betting Splits Scraper
 *
 * Uses Puppeteer to load the VSiN CBB betting splits page and extract
 * the consensus spread and total for each game by team name matching.
 *
 * The VSiN table is structured as alternating THEAD/TBODY pairs, one per date.
 * Each TBODY row has 10 cells:
 *   [0] team names (away + home), [1] spread, [4] total, ...
 *
 * Spread format: "+2.5-2.5" or "-3.5+3.5" — first number is away spread
 * Total format: "154.5154.5" — the number is duplicated, take first occurrence
 */

import puppeteer from "puppeteer";

export interface ScrapedOdds {
  awayTeam: string;
  homeTeam: string;
  awaySpread: number | null;
  homeSpread: number | null;
  total: number | null;
}

function parseSpread(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/\s+/g, "");
  // Spread looks like "+2.5-2.5", "-3.5+3.5", "pk"
  // Take the first number (away spread)
  const match = clean.match(/^([+-]?\d+\.?\d*)/);
  if (!match) {
    if (clean.toLowerCase() === "pk") return 0;
    return null;
  }
  const val = parseFloat(match[1]);
  if (isNaN(val) || Math.abs(val) > 60) return null;
  return val;
}

function parseTotal(text: string): number | null {
  if (!text) return null;
  const clean = text.trim().replace(/\s+/g, "");
  // Total looks like "154.5154.5" — duplicated, take first occurrence
  const match = clean.match(/^(\d{2,3}\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (isNaN(val) || val < 100 || val > 300) return null;
  return val;
}

/**
 * Scrapes the VSiN CBB betting splits page for a given date label.
 * @param dateLabel - Partial string to match the date header, e.g. "Mar 4" or "Wednesday"
 */
export async function scrapeVsinOdds(dateLabel: string): Promise<ScrapedOdds[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    await page.goto("https://data.vsin.com/college-basketball/betting-splits/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for the freeze table
    await page.waitForSelector("table.freezetable", { timeout: 30000 });
    // Brief settle for JS rendering
    await new Promise((r) => setTimeout(r, 1500));

    const rawGames = await page.evaluate((dateLabel: string) => {
      const wrapper = document.querySelector(".freezetable")?.closest("[class*='freeze']");
      if (!wrapper) return [];

      const children = Array.from(wrapper.children);
      const results: Array<{ teamRaw: string; spreadRaw: string; totalRaw: string }> = [];

      let currentDate = "";
      let capture = false;

      for (const child of children) {
        if (child.tagName === "THEAD") {
          const dateCell = child.querySelector("th");
          currentDate = dateCell?.textContent?.trim() || "";
          capture = currentDate.includes(dateLabel);
        } else if (child.tagName === "TBODY" && capture) {
          const rows = Array.from(child.querySelectorAll("tr"));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll("td, th")).map(
              (td) => td.textContent?.trim() || ""
            );
            if (cells.length < 5) continue;
            results.push({
              teamRaw: cells[0],
              spreadRaw: cells[1],
              totalRaw: cells[4],
            });
          }
        }
      }

      return results;
    }, dateLabel);

    const parsed: ScrapedOdds[] = [];

    for (const game of rawGames) {
      // Team name format: "Away Home        History 2 VSiN Picks"
      // Strip everything from "History" onwards
      const teamPart = game.teamRaw
        .replace(/\s+History.*$/i, "")
        .replace(/\s*\(\d+\)\s*/g, " ")
        .trim();

      // Split on 2+ consecutive spaces (the separator between away and home)
      const teamParts = teamPart.split(/\s{2,}/);
      let awayTeam = "";
      let homeTeam = "";

      if (teamParts.length >= 2) {
        awayTeam = teamParts[0].trim();
        homeTeam = teamParts[1].trim();
      } else {
        // Fallback: split on newline or tab
        const parts = teamPart.split(/[\n\t]/);
        if (parts.length >= 2) {
          awayTeam = parts[0].trim();
          homeTeam = parts[1].trim();
        } else {
          continue; // Can't parse team names
        }
      }

      const awaySpread = parseSpread(game.spreadRaw);
      const total = parseTotal(game.totalRaw);

      parsed.push({
        awayTeam,
        homeTeam,
        awaySpread,
        homeSpread: awaySpread !== null ? -awaySpread : null,
        total,
      });
    }

    return parsed;
  } finally {
    await browser.close();
  }
}

/**
 * Normalizes a team name for fuzzy matching against DB slugs.
 */
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .trim();
}

/**
 * Returns true if a scraped team name matches a stored DB team slug.
 */
export function matchTeam(scrapedName: string, storedSlug: string): boolean {
  const norm = normalizeTeamName(scrapedName);
  const slug = storedSlug.toLowerCase().replace(/[^a-z0-9_]/g, "");

  if (norm === slug) return true;
  if (norm.includes(slug) || slug.includes(norm)) return true;

  // Common abbreviation mappings
  const abbrevMap: Record<string, string> = {
    n_alabama: "north_alabama",
    fl_gulf_coast: "florida_gulf_coast",
    fgcu: "florida_gulf_coast",
    e_kentucky: "eastern_kentucky",
    n_florida: "north_florida",
    sc_upstate: "south_carolina_upstate",
    chicago_st: "chicago_state",
    long_island: "liu",
    liu: "long_island",
    la_salle: "la_salle",
    smu: "smu",
    miami_florida: "miami_fl",
    miami_fl: "miami_florida",
    george_washington: "george_washington",
    st_josephs: "st_josephs",
    st_bonaventure: "st_bonaventure",
    penn_state: "penn_state",
    ohio_state: "ohio_state",
    colorado_state: "colorado_state",
    new_mexico: "new_mexico",
    north_texas: "north_texas",
    loyola_chicago: "loyola_chicago",
    saint_louis: "saint_louis",
    florida_state: "florida_state",
    ul_lafayette: "ul_lafayette",
    georgia_southern: "georgia_southern",
    eastern_illinois: "eastern_illinois",
    siu_edwardsville: "siu_edwardsville",
    little_rock: "little_rock",
    lindenwood: "lindenwood",
    umkc: "umkc",
    oral_roberts: "oral_roberts",
    northern_kentucky: "northern_kentucky",
    oakland: "oakland",
    milwaukee: "milwaukee",
    detroit_mercy: "detroit_mercy",
    youngstown_state: "youngstown_state",
    robert_morris: "robert_morris",
    cleveland_state: "cleveland_state",
    wright_state: "wright_state",
    bellarmine: "bellarmine",
    north_alabama: "north_alabama",
    florida_gulf_coast: "florida_gulf_coast",
    eastern_kentucky: "eastern_kentucky",
    north_florida: "north_florida",
    west_georgia: "west_georgia",
    gardner_webb: "gardner_webb",
    stonehill: "stonehill",
    le_moyne: "le_moyne",
    fairleigh_dickinson: "fairleigh_dickinson",
    mercyhurst: "mercyhurst",
    wagner: "wagner",
    central_connecticut: "central_connecticut",
    chicago_state: "chicago_state",
  };

  const normMapped = abbrevMap[norm] || norm;
  const slugMapped = abbrevMap[slug] || slug;

  return (
    normMapped === slugMapped ||
    normMapped.includes(slugMapped) ||
    slugMapped.includes(normMapped)
  );
}


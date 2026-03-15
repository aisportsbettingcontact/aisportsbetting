/**
 * nhlNaturalStatScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes NHL team stats and goalie stats from NaturalStatTrick.com.
 *
 * Data sources:
 *   Team stats:   https://www.naturalstattrick.com/teamtable.php?fromseason=20252026&thruseason=20252026&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=410&gpt=&fd=&td=
 *   Goalie stats: https://www.naturalstattrick.com/goaliestats.php?fromseason=20252026&thruseason=20252026&stype=2&sit=5v5&score=all&rate=n&pos=G&loc=B&toi=0&gpfilt=GP&fd=&td=&tgp=410&lines=single&draftteam=ALL
 *
 * Outputs:
 *   NhlTeamStats   — keyed by NHL abbreviation (e.g. "BOS", "TOR")
 *   NhlGoalieStats — keyed by goalie full name (e.g. "Jeremy Swayman")
 */

import * as cheerio from "cheerio";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlTeamStats {
  abbrev: string;
  name: string;
  gp: number;
  xGF_pct: number;
  xGA_pct: number;
  CF_pct: number;
  SCF_pct: number;
  HDCF_pct: number;
  SH_pct: number;
  SV_pct: number;
  GF: number;
  GA: number;
}

export interface NhlGoalieStats {
  name: string;
  team: string;
  gp: number;
  sv_pct: number;
  gsax: number;   // Goals Saved Above Expected
  xga: number;    // Expected Goals Against
  ga: number;     // Goals Against
  shots: number;  // Shots Faced
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENT_SEASON = "20252026";

const TEAM_STATS_URL = `https://www.naturalstattrick.com/teamtable.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=410&gpt=&fd=&td=`;

const GOALIE_STATS_URL = `https://www.naturalstattrick.com/goaliestats.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=n&pos=G&loc=B&toi=0&gpfilt=GP&fd=&td=&tgp=410&lines=single&draftteam=ALL`;

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.naturalstattrick.com/",
};

// ─── Team Abbreviation Normalization ─────────────────────────────────────────
// NaturalStatTrick uses some non-standard abbreviations
const NST_ABBREV_MAP: Record<string, string> = {
  "VGK": "VGK",
  "NJD": "NJD",
  "SJS": "SJS",
  "LAK": "LAK",
  "TBL": "TBL",
  "CBJ": "CBJ",
  "PHX": "ARI",  // Arizona legacy
  "ARI": "ARI",
  "SEA": "SEA",
  "UTA": "UTA",  // Utah Hockey Club
};

function normalizeAbbrev(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return NST_ABBREV_MAP[upper] ?? upper;
}

// ─── Team Stats Scraper ───────────────────────────────────────────────────────

/**
 * Scrape NaturalStatTrick team stats table.
 * Returns a map keyed by NHL abbreviation.
 */
export async function scrapeNhlTeamStats(): Promise<Map<string, NhlTeamStats>> {
  console.log("[NSTScraper] ► Fetching team stats from NaturalStatTrick...");
  console.log(`[NSTScraper]   URL: ${TEAM_STATS_URL}`);

  const resp = await fetch(TEAM_STATS_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) {
    throw new Error(`[NSTScraper] Team stats fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  }
  const html = await resp.text();
  console.log(`[NSTScraper]   Received ${html.length} bytes`);

  const $ = cheerio.load(html);
  const results = new Map<string, NhlTeamStats>();

  // NaturalStatTrick team table has id="teams" or is the first large table
  const table = $("table#teams, table.tablesorter").first();
  if (!table.length) {
    console.warn("[NSTScraper] ⚠ Could not find team stats table — page structure may have changed");
    return results;
  }

  // Parse header row to find column indices
  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });
  console.log(`[NSTScraper]   Headers found: ${headers.join(", ")}`);

  const colIdx = (name: string) => headers.indexOf(name);

  // Column name mappings (NaturalStatTrick uses specific header text)
  const idxTeam  = colIdx("team");
  const idxGP    = colIdx("gp");
  const idxCF    = headers.findIndex(h => h === "cf%");
  const idxSCF   = headers.findIndex(h => h === "scf%");
  const idxHDCF  = headers.findIndex(h => h === "hdcf%");
  const idxXGF   = headers.findIndex(h => h === "xgf%");
  const idxXGA   = headers.findIndex(h => h === "xga%");
  const idxGF    = colIdx("gf");
  const idxGA    = colIdx("ga");
  const idxSH    = headers.findIndex(h => h === "sh%");
  const idxSV    = headers.findIndex(h => h === "sv%");

  console.log(`[NSTScraper]   Column indices — Team:${idxTeam} GP:${idxGP} CF%:${idxCF} SCF%:${idxSCF} HDCF%:${idxHDCF} xGF%:${idxXGF} xGA%:${idxXGA} GF:${idxGF} GA:${idxGA} SH%:${idxSH} SV%:${idxSV}`);

  table.find("tbody tr").each((rowIdx, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 5) return;

    const getText = (idx: number) => idx >= 0 ? $(cells[idx]).text().trim() : "";
    const getNum  = (idx: number) => parseFloat(getText(idx)) || 0;

    const rawTeam  = getText(idxTeam >= 0 ? idxTeam : 0);
    const abbrev   = normalizeAbbrev(rawTeam);
    const gp       = getNum(idxGP >= 0 ? idxGP : 1);
    const xGF_pct  = getNum(idxXGF);
    const xGA_pct  = getNum(idxXGA);
    const CF_pct   = getNum(idxCF);
    const SCF_pct  = getNum(idxSCF);
    const HDCF_pct = getNum(idxHDCF);
    const GF       = getNum(idxGF);
    const GA       = getNum(idxGA);
    const SH_pct   = getNum(idxSH);
    const SV_pct   = getNum(idxSV);

    if (!abbrev || gp === 0) return;

    const stats: NhlTeamStats = {
      abbrev, name: rawTeam, gp,
      xGF_pct, xGA_pct, CF_pct, SCF_pct, HDCF_pct,
      SH_pct, SV_pct, GF, GA,
    };
    results.set(abbrev, stats);

    if (rowIdx < 5) {
      console.log(`[NSTScraper]   Row ${rowIdx}: ${abbrev} GP=${gp} xGF%=${xGF_pct} CF%=${CF_pct} SCF%=${SCF_pct} HDCF%=${HDCF_pct} SH%=${SH_pct} SV%=${SV_pct}`);
    }
  });

  console.log(`[NSTScraper] ✅ Team stats scraped: ${results.size} teams`);
  return results;
}

// ─── Goalie Stats Scraper ─────────────────────────────────────────────────────

/**
 * Scrape NaturalStatTrick goalie stats table.
 * Returns a map keyed by goalie full name (lowercase for matching).
 */
export async function scrapeNhlGoalieStats(): Promise<Map<string, NhlGoalieStats>> {
  console.log("[NSTScraper] ► Fetching goalie stats from NaturalStatTrick...");
  console.log(`[NSTScraper]   URL: ${GOALIE_STATS_URL}`);

  const resp = await fetch(GOALIE_STATS_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) {
    throw new Error(`[NSTScraper] Goalie stats fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  }
  const html = await resp.text();
  console.log(`[NSTScraper]   Received ${html.length} bytes`);

  const $ = cheerio.load(html);
  const results = new Map<string, NhlGoalieStats>();

  const table = $("table#goalies, table.tablesorter").first();
  if (!table.length) {
    console.warn("[NSTScraper] ⚠ Could not find goalie stats table");
    return results;
  }

  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });
  console.log(`[NSTScraper]   Goalie headers: ${headers.join(", ")}`);

  const idxName  = headers.findIndex(h => h === "player" || h === "name");
  const idxTeam  = headers.findIndex(h => h === "team");
  const idxGP    = headers.findIndex(h => h === "gp");
  const idxSV    = headers.findIndex(h => h === "sv%");
  const idxGSAX  = headers.findIndex(h => h.includes("gsax") || h.includes("goals saved above expected"));
  const idxXGA   = headers.findIndex(h => h === "xga");
  const idxGA    = headers.findIndex(h => h === "ga");
  const idxShots = headers.findIndex(h => h === "sa" || h === "shots against");

  console.log(`[NSTScraper]   Goalie col indices — Name:${idxName} Team:${idxTeam} GP:${idxGP} SV%:${idxSV} GSAx:${idxGSAX} xGA:${idxXGA} GA:${idxGA} Shots:${idxShots}`);

  table.find("tbody tr").each((rowIdx, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 4) return;

    const getText = (idx: number) => idx >= 0 ? $(cells[idx]).text().trim() : "";
    const getNum  = (idx: number) => parseFloat(getText(idx)) || 0;

    const name   = getText(idxName >= 0 ? idxName : 0);
    const team   = normalizeAbbrev(getText(idxTeam >= 0 ? idxTeam : 1));
    const gp     = getNum(idxGP >= 0 ? idxGP : 2);
    const sv_pct = getNum(idxSV);
    const gsax   = getNum(idxGSAX);
    const xga    = getNum(idxXGA);
    const ga     = getNum(idxGA);
    const shots  = getNum(idxShots);

    if (!name || gp === 0) return;

    const stats: NhlGoalieStats = { name, team, gp, sv_pct, gsax, xga, ga, shots };
    // Store by both full name and lowercase for flexible lookup
    results.set(name.toLowerCase(), stats);
    results.set(name, stats);

    if (rowIdx < 5) {
      console.log(`[NSTScraper]   Goalie ${rowIdx}: ${name} (${team}) GP=${gp} SV%=${sv_pct} GSAx=${gsax}`);
    }
  });

  console.log(`[NSTScraper] ✅ Goalie stats scraped: ${results.size / 2} goalies`);
  return results;
}

// ─── Fallback / Default Stats ─────────────────────────────────────────────────

/**
 * Returns league-average team stats for teams not found in NaturalStatTrick.
 * Used as fallback to prevent model failures.
 */
export function getDefaultTeamStats(abbrev: string): NhlTeamStats {
  console.warn(`[NSTScraper] ⚠ Using default stats for team: ${abbrev}`);
  return {
    abbrev, name: abbrev, gp: 1,
    xGF_pct: 50.0, xGA_pct: 50.0,
    CF_pct: 50.0, SCF_pct: 50.0, HDCF_pct: 50.0,
    SH_pct: 9.5, SV_pct: 90.5,
    GF: 100, GA: 100,
  };
}

/**
 * Returns average goalie stats for goalies not found in NaturalStatTrick.
 */
export function getDefaultGoalieStats(name: string, team: string): NhlGoalieStats {
  console.warn(`[NSTScraper] ⚠ Using default goalie stats for: ${name} (${team})`);
  return {
    name, team, gp: 1,
    sv_pct: 90.5, gsax: 0.0, xga: 50.0, ga: 50.0, shots: 500,
  };
}

/**
 * nhlNaturalStatScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes NHL team stats and goalie stats from NaturalStatTrick.com.
 *
 * Data sources:
 *   Team stats (counts):  teamtable.php?...rate=n  — GF, GA, xGF%, CF%, etc.
 *   Team stats (per-60):  teamtable.php?...rate=y  — xGF/60, HDCF/60, Rush/60, etc.
 *   Goalie stats:         goaliestats.php           — GP, SV%, GSAx, xGA, GA, SA
 *
 * The Sharp Line Origination Engine (nhl_model_engine.py) requires BOTH:
 *   - Percentage-based stats (xGF_pct, CF_pct, HDCF_pct) — for fallback
 *   - Per-60 rate stats (xGF_60, HDCF_60, Rush_60, Reb_60, SA_60) — for full model
 *
 * Outputs:
 *   NhlTeamStats   — keyed by NHL abbreviation (e.g. "BOS", "TOR")
 *   NhlGoalieStats — keyed by goalie full name (e.g. "Jeremy Swayman")
 */

import * as cheerio from "cheerio";
import { NHL_TEAMS } from "../shared/nhlTeams";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlTeamStats {
  abbrev:    string;
  name:      string;
  gp:        number;

  // Percentage-based (from counts table, rate=n)
  xGF_pct:   number;
  xGA_pct:   number;
  CF_pct:    number;
  SCF_pct:   number;
  HDCF_pct:  number;
  SH_pct:    number;
  SV_pct:    number;
  GF:        number;
  GA:        number;

  // Per-60 rate stats (from rate table, rate=y) — used by Sharp Line Engine
  // Offensive
  xGF_60:    number | null;   // Expected Goals For per 60
  HDCF_60:   number | null;   // High-Danger Corsi For per 60
  Rush_60:   number | null;   // Rush shots per 60
  Reb_60:    number | null;   // Rebound shots per 60
  SA_60:     number | null;   // Shot Attempts per 60 (pace proxy)
  // Defensive
  xGA_60:    number | null;   // Expected Goals Against per 60
  HDCA_60:   number | null;   // High-Danger Corsi Against per 60
  RushA_60:  number | null;   // Rush shots against per 60
  SlotShots: number | null;   // Slot shots against per 60 (proxy for dangerous scoring chances against)
}

export interface NhlGoalieStats {
  name:         string;
  team:         string;
  gp:           number;
  sv_pct:       number;
  gsax:         number;   // Goals Saved Above Expected (season total)
  xga:          number;   // Expected Goals Against (season total)
  ga:           number;   // Goals Against (season total)
  shots:        number;   // Shots Faced (season total) — used for goalie_effect = GSAX/shots
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENT_SEASON = "20252026";

// Counts table (rate=n): GF, GA, xGF%, CF%, SCF%, HDCF%, SH%, SV%
// gpf=1 = include all teams with 1+ games played (no minimum game filter)
const TEAM_STATS_COUNT_URL = `https://www.naturalstattrick.com/teamtable.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=1&gpt=&fd=&td=`;

// Rate table (rate=y): xGF/60, HDCF/60, Rush/60, Rebound/60, SA/60, xGA/60, HDCA/60
const TEAM_STATS_RATE_URL  = `https://www.naturalstattrick.com/teamtable.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=y&team=all&loc=B&gpf=1&gpt=&fd=&td=`;

// Goalie stats — uses playerteams.php with stdoi=g (goalie mode), gpfilt=none (no minimum GP filter)
// NOTE: goaliestats.php is a 404; the correct endpoint is playerteams.php?stdoi=g
const GOALIE_STATS_URL = `https://www.naturalstattrick.com/playerteams.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&stdoi=g&rate=n&team=ALL&pos=S&loc=B&toi=0&gpfilt=none&fd=&td=&tgp=410&lines=single&draftteam=ALL`;

const FETCH_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer":         "https://www.naturalstattrick.com/",
};

// ─── Team Abbreviation Normalization ─────────────────────────────────────────

// Build a lookup map: full name (uppercase) → 3-letter abbreviation
// e.g. "CHICAGO BLACKHAWKS" → "CHI", "UTAH MAMMOTH" → "UTA"
const NST_NAME_TO_ABBREV: Map<string, string> = new Map(
  NHL_TEAMS.map(t => [t.name.toUpperCase(), t.abbrev])
);

// Additional 3-letter overrides for legacy/variant codes used by NST
const NST_ABBREV_OVERRIDES: Record<string, string> = {
  "VGK": "VGK",
  "NJD": "NJD",
  "SJS": "SJS",
  "LAK": "LAK",
  "TBL": "TBL",
  "CBJ": "CBJ",
  "PHX": "ARI",
  "ARI": "ARI",
  "SEA": "SEA",
  "UTA": "UTA",
  // NST uses "N.J" for New Jersey Devils
  "N.J": "NJD",
  // NST uses "S.J" for San Jose Sharks
  "S.J": "SJS",
  // NST uses "T.B" for Tampa Bay Lightning
  "T.B": "TBL",
  // NST uses "L.A" for Los Angeles Kings
  "L.A": "LAK",
};

/**
 * Normalize a raw team identifier from NaturalStatTrick to a 3-letter abbreviation.
 * Handles both full names ("Chicago Blackhawks") and short codes ("CHI", "N.J", etc.).
 */
function normalizeAbbrev(raw: string): string {
  const trimmed = raw.trim();
  const upper   = trimmed.toUpperCase();

  // 1. Check full-name lookup first (handles "Chicago Blackhawks" → "CHI")
  const byName = NST_NAME_TO_ABBREV.get(upper);
  if (byName) return byName;

  // 2. Check override map (handles "N.J" → "NJD", "PHX" → "ARI", etc.)
  const override = NST_ABBREV_OVERRIDES[upper];
  if (override) return override;

  // 3. Fall back to uppercased raw value (already a valid 3-letter code)
  return upper;
}

// ─── Helper: parse a NaturalStatTrick table ───────────────────────────────────

interface ParsedRow {
  abbrev:  string;
  cells:   string[];
  headers: string[];
}

function parseNstTable(html: string, tableLabel: string): { headers: string[]; rows: ParsedRow[] } {
  const $ = cheerio.load(html);
  const table = $("table#teams, table.tablesorter").first();

  if (!table.length) {
    console.warn(`[NSTScraper] ⚠ [${tableLabel}] Could not find team table — page structure may have changed`);
    return { headers: [], rows: [] };
  }

  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });
  console.log(`[NSTScraper]   [${tableLabel}] Headers (${headers.length}): ${headers.slice(0, 15).join(", ")}...`);

  const rows: ParsedRow[] = [];
  const idxTeam = headers.indexOf("team");
  table.find("tbody tr").each((rowIdx, tr) => {
    const cells: string[] = [];
    $(tr).find("td").each((_, td) => { cells.push($(td).text().trim()); });
    if (cells.length < 4) return;
    const rawTeam = cells[idxTeam >= 0 ? idxTeam : 0] ?? "";
    const abbrev  = normalizeAbbrev(rawTeam);
    if (!abbrev) return;
    rows.push({ abbrev, cells, headers });
  });return { headers, rows };
}

// ─── Team Stats Scraper (counts) ─────────────────────────────────────────────

async function scrapeTeamCountStats(): Promise<Map<string, Partial<NhlTeamStats>>> {
  console.log("[NSTScraper] ► Fetching team COUNT stats (rate=n)...");
  const resp = await fetch(TEAM_STATS_COUNT_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) throw new Error(`[NSTScraper] Count stats fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[NSTScraper]   Count stats: ${html.length} bytes`);

  const { headers, rows } = parseNstTable(html, "COUNT");
  const results = new Map<string, Partial<NhlTeamStats>>();

  const col = (name: string) => headers.indexOf(name);
  const idxGP    = col("gp");
  const idxCF    = headers.findIndex(h => h === "cf%");
  const idxSCF   = headers.findIndex(h => h === "scf%");
  const idxHDCF  = headers.findIndex(h => h === "hdcf%");
  const idxXGF   = headers.findIndex(h => h === "xgf%");
  const idxXGA   = headers.findIndex(h => h === "xga%");
  const idxGF    = col("gf");
  const idxGA    = col("ga");
  const idxSH    = headers.findIndex(h => h === "sh%");
  const idxSV    = headers.findIndex(h => h === "sv%");

  console.log(`[NSTScraper]   COUNT cols — GP:${idxGP} CF%:${idxCF} SCF%:${idxSCF} HDCF%:${idxHDCF} xGF%:${idxXGF} xGA%:${idxXGA} GF:${idxGF} GA:${idxGA} SH%:${idxSH} SV%:${idxSV}`);

  for (const { abbrev, cells } of rows) {
    const g = (i: number) => i >= 0 ? parseFloat(cells[i]) || 0 : 0;
    const gp = g(idxGP);
    if (!abbrev || gp === 0) continue;

    results.set(abbrev, {
      abbrev,
      name:      abbrev,
      gp,
      xGF_pct:   g(idxXGF),
      xGA_pct:   g(idxXGA),
      CF_pct:    g(idxCF),
      SCF_pct:   g(idxSCF),
      HDCF_pct:  g(idxHDCF),
      SH_pct:    g(idxSH),
      SV_pct:    g(idxSV),
      GF:        g(idxGF),
      GA:        g(idxGA),
    });
  }

  console.log(`[NSTScraper] ✅ COUNT stats: ${results.size} teams`);
  return results;
}

// ─── Team Stats Scraper (per-60 rates) ───────────────────────────────────────

async function scrapeTeamRateStats(): Promise<Map<string, Partial<NhlTeamStats>>> {
  console.log("[NSTScraper] ► Fetching team RATE stats (rate=y, per-60)...");
  const resp = await fetch(TEAM_STATS_RATE_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) throw new Error(`[NSTScraper] Rate stats fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[NSTScraper]   Rate stats: ${html.length} bytes`);

  const { headers, rows } = parseNstTable(html, "RATE");
  const results = new Map<string, Partial<NhlTeamStats>>();

  // NaturalStatTrick rate table column names (per-60):
  // "xgf", "xga", "hdcf", "hdca", "cf", "ca", "scf", "sca", "rush", "rusha", "reb", "reba", "sa", "saa"
  // Note: in rate table, these are per-60 values
  const col = (name: string) => headers.indexOf(name);
  const idxXGF60   = col("xgf");
  const idxXGA60   = col("xga");
  const idxHDCF60  = col("hdcf");
  const idxHDCA60  = col("hdca");
  const idxRush60  = col("rush");
  const idxRushA60 = col("rusha");
  const idxReb60   = col("reb");
  const idxSA60    = col("cf");   // In rate table, CF/60 ≈ shot attempts per 60 (pace proxy)
  const idxSAA60   = col("ca");   // Corsi Against per 60 (slot shots proxy)

  console.log(`[NSTScraper]   RATE cols — xGF/60:${idxXGF60} xGA/60:${idxXGA60} HDCF/60:${idxHDCF60} HDCA/60:${idxHDCA60} Rush/60:${idxRush60} RushA/60:${idxRushA60} Reb/60:${idxReb60} CF/60:${idxSA60} CA/60:${idxSAA60}`);

  for (const { abbrev, cells } of rows) {
    const g = (i: number) => i >= 0 ? parseFloat(cells[i]) || null : null;

    results.set(abbrev, {
      xGF_60:    g(idxXGF60),
      xGA_60:    g(idxXGA60),
      HDCF_60:   g(idxHDCF60),
      HDCA_60:   g(idxHDCA60),
      Rush_60:   g(idxRush60),
      RushA_60:  g(idxRushA60),
      Reb_60:    g(idxReb60),
      SA_60:     g(idxSA60),    // CF/60 as shot attempts proxy
      SlotShots: g(idxSAA60),   // CA/60 as slot shots against proxy
    });
  }

  console.log(`[NSTScraper] ✅ RATE stats: ${results.size} teams`);
  return results;
}

// ─── Public: Scrape All Team Stats ───────────────────────────────────────────

/**
 * Scrape both count and rate tables from NaturalStatTrick and merge them.
 * Returns a map keyed by NHL abbreviation with all fields populated.
 */
export async function scrapeNhlTeamStats(): Promise<Map<string, NhlTeamStats>> {
  console.log("[NSTScraper] ════════════════════════════════════════════════════");
  console.log("[NSTScraper] ► Scraping NaturalStatTrick team stats (count + rate)...");

  const [countStats, rateStats] = await Promise.all([
    scrapeTeamCountStats(),
    scrapeTeamRateStats(),
  ]);

  const merged = new Map<string, NhlTeamStats>();

  for (const [abbrev, count] of Array.from(countStats)) {
    const rate = rateStats.get(abbrev) ?? {};
    const stats: NhlTeamStats = {
      abbrev:    count.abbrev!,
      name:      count.name!,
      gp:        count.gp!,
      xGF_pct:   count.xGF_pct!,
      xGA_pct:   count.xGA_pct!,
      CF_pct:    count.CF_pct!,
      SCF_pct:   count.SCF_pct!,
      HDCF_pct:  count.HDCF_pct!,
      SH_pct:    count.SH_pct!,
      SV_pct:    count.SV_pct!,
      GF:        count.GF!,
      GA:        count.GA!,
      // Per-60 from rate table (null if not available)
      xGF_60:    rate.xGF_60   ?? null,
      xGA_60:    rate.xGA_60   ?? null,
      HDCF_60:   rate.HDCF_60  ?? null,
      HDCA_60:   rate.HDCA_60  ?? null,
      Rush_60:   rate.Rush_60  ?? null,
      RushA_60:  rate.RushA_60 ?? null,
      Reb_60:    rate.Reb_60   ?? null,
      SA_60:     rate.SA_60    ?? null,
      SlotShots: rate.SlotShots ?? null,
    };
    merged.set(abbrev, stats);
  }

  // Log sample
  const sample = Array.from(merged.entries()).slice(0, 3);
  for (const [abbrev, s] of sample) {
    console.log(`[NSTScraper]   ${abbrev}: xGF%=${s.xGF_pct} xGF/60=${s.xGF_60} HDCF/60=${s.HDCF_60} Rush/60=${s.Rush_60} SA/60=${s.SA_60}`);
  }

  console.log(`[NSTScraper] ✅ Merged team stats: ${merged.size} teams (${Array.from(merged.keys()).join(", ")})`);
  console.log("[NSTScraper] ════════════════════════════════════════════════════");
  return merged;
}

// ─── Goalie Stats Scraper ─────────────────────────────────────────────────────

/**
 * Scrape NaturalStatTrick goalie stats table.
 * Returns a map keyed by goalie full name (both original and lowercase).
 */
export async function scrapeNhlGoalieStats(): Promise<Map<string, NhlGoalieStats>> {
  console.log("[NSTScraper] ► Fetching goalie stats from NaturalStatTrick...");
  console.log(`[NSTScraper]   URL: ${GOALIE_STATS_URL}`);

  const resp = await fetch(GOALIE_STATS_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) throw new Error(`[NSTScraper] Goalie stats fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[NSTScraper]   Goalie stats: ${html.length} bytes`);

  const $ = cheerio.load(html);
  const results = new Map<string, NhlGoalieStats>();

  // playerteams.php?stdoi=g uses table#players (not table#goalies)
  const table = $("table#players, table#goalies, table.tablesorter").first();
  if (!table.length) {
    console.warn("[NSTScraper] ⚠ Could not find goalie stats table");
    return results;
  }

  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });
  console.log(`[NSTScraper]   Goalie headers: ${headers.join(", ")}`);

  // playerteams.php?stdoi=g column names (lowercased):
  //   "player", "team", "gp", "toi", "shots against", "saves", "goals against",
  //   "sv%", "gaa", "gsaa", "xg against", ...
  // Note: GSAA on this page = Goals Saved Above Average (same concept as GSAx for our purposes)
  const idxName  = headers.findIndex(h => h === "player" || h === "name");
  const idxTeam  = headers.findIndex(h => h === "team");
  const idxGP    = headers.findIndex(h => h === "gp");
  const idxSV    = headers.findIndex(h => h === "sv%");
  const idxGSAX  = headers.findIndex(h => h === "gsaa" || h.includes("gsax") || h.includes("goals saved above"));
  const idxXGA   = headers.findIndex(h => h === "xg against" || h === "xga");
  const idxGA    = headers.findIndex(h => h === "goals against" || h === "ga");
  const idxShots = headers.findIndex(h => h === "shots against" || h === "sa" || h === "shots");

  console.log(`[NSTScraper]   Goalie cols — Name:${idxName} Team:${idxTeam} GP:${idxGP} SV%:${idxSV} GSAx:${idxGSAX} xGA:${idxXGA} GA:${idxGA} SA:${idxShots}`);

  table.find("tbody tr").each((rowIdx, tr) => {
    const cells: string[] = [];
    $(tr).find("td").each((_, td) => { cells.push($(td).text().trim()); });
    if (cells.length < 4) return;

    const g = (i: number) => i >= 0 ? parseFloat(cells[i]) || 0 : 0;
    const name   = cells[idxName >= 0 ? idxName : 0] ?? "";
    const team   = normalizeAbbrev(cells[idxTeam >= 0 ? idxTeam : 1] ?? "");
    const gp     = g(idxGP);
    const sv_pct = g(idxSV);
    const gsax   = g(idxGSAX);
    const xga    = g(idxXGA);
    const ga     = g(idxGA);
    const shots  = g(idxShots);

    if (!name || gp === 0) return;

    const stats: NhlGoalieStats = { name, team, gp, sv_pct, gsax, xga, ga, shots };
    results.set(name.toLowerCase(), stats);
    results.set(name, stats);

    if (rowIdx < 5) {
      console.log(`[NSTScraper]   Goalie ${rowIdx}: ${name} (${team}) GP=${gp} SV%=${sv_pct} GSAx=${gsax} SA=${shots}`);
    }
  });

  console.log(`[NSTScraper] ✅ Goalie stats scraped: ${results.size / 2} goalies`);
  return results;
}

// ─── Fallback / Default Stats ─────────────────────────────────────────────────

/**
 * Returns league-average team stats for teams not found in NaturalStatTrick.
 * Per-60 values use 2025-26 NHL league averages.
 */
export function getDefaultTeamStats(abbrev: string): NhlTeamStats {
  console.warn(`[NSTScraper] ⚠ Using default stats for team: ${abbrev}`);
  return {
    abbrev, name: abbrev, gp: 1,
    // Percentage-based (league average = 50%)
    xGF_pct: 50.0, xGA_pct: 50.0,
    CF_pct: 50.0, SCF_pct: 50.0, HDCF_pct: 50.0,
    SH_pct: 9.5, SV_pct: 90.5,
    GF: 100, GA: 100,
    // Per-60 (league averages)
    xGF_60: 2.65, xGA_60: 2.65,
    HDCF_60: 1.05, HDCA_60: 1.05,
    Rush_60: 0.45, RushA_60: 0.45,
    Reb_60: 0.28, SA_60: 30.5, SlotShots: 17.0,
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

/**
 * nhlHockeyRefTeamStats.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fallback NHL team stats scraper using Hockey-Reference (hockey-reference.com)
 * when NaturalStatTrick is blocked by Cloudflare.
 *
 * Data source: https://www.hockey-reference.com/leagues/NHL_2026.html
 *   - stats_adv table (in HTML comment): CF%, xGF, xGA, SC%, HDSC%, SH%, SV%, GF, GA
 *
 * Per-60 rate computation:
 *   NST's rate=y table provides per-60 stats directly.
 *   HR only provides season totals. We compute per-60 using:
 *     stat_60 = (count / (GP_est * AVG_5V5_TOI_PER_GAME)) * 60
 *   where:
 *     GP_est = estimated from CF counts (CF_for + CF_against) / (2 * 57)
 *     AVG_5V5_TOI_PER_GAME = 38.0 minutes (league average 5v5 TOI per team per game)
 *
 * Outputs: Map<string, NhlTeamStats> keyed by NHL abbreviation (e.g. "BOS", "TOR")
 */

import * as cheerio from "cheerio";
import type { NhlTeamStats } from "./nhlNaturalStatScraper.js";
import { NHL_TEAMS } from "../shared/nhlTeams.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const HR_URL = "https://www.hockey-reference.com/leagues/NHL_2026.html";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.hockey-reference.com/",
};

// Average 5v5 TOI per team per game (minutes) — used to compute per-60 rates from counts
// NHL average is ~38 minutes of 5v5 play per team per game
const AVG_5V5_TOI_PER_GAME = 38.0;

// Approximate CF count per team per game (used to estimate GP from season totals)
const LEAGUE_CF_PER_GAME = 57.0;

// ─── HR team name → NHL abbreviation mapping ─────────────────────────────────

const HR_NAME_TO_ABBREV: Record<string, string> = {
  "Anaheim Ducks":          "ANA",
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
  "Utah Mammoth":           "UTA",
  "Vancouver Canucks":      "VAN",
  "Vegas Golden Knights":   "VGK",
  "Washington Capitals":    "WSH",
  "Winnipeg Jets":          "WPG",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 50.0 : n;
}

function num(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function svPctFromHR(val: string): number {
  // HR stores SV% as ".920" (decimal), NST stores as "92.0" (percentage)
  const n = parseFloat(val);
  if (isNaN(n)) return 91.5;
  // If value < 1, it's already decimal — convert to percentage
  return n < 1 ? n * 100 : n;
}

/**
 * Compute per-60 rate from season count total.
 * stat_60 = (count / (GP_est * AVG_5V5_TOI_PER_GAME)) * 60
 */
function toRate60(count: number, gp: number): number {
  if (gp <= 0) return 0;
  const toi = gp * AVG_5V5_TOI_PER_GAME;
  return (count / toi) * 60;
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

/**
 * Scrape NHL team advanced stats from Hockey-Reference.
 * Returns a Map<abbrev, NhlTeamStats> compatible with the NST scraper output.
 *
 * All logging prefixed with [HRTeamStats] for noise-free filtering.
 */
export async function scrapeNhlTeamStatsFromHockeyRef(): Promise<Map<string, NhlTeamStats>> {
  console.log(`[HRTeamStats] ── Fetching NHL team stats from Hockey-Reference ──`);
  console.log(`[HRTeamStats] URL: ${HR_URL}`);

  const res = await fetch(HR_URL, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`[HRTeamStats] HTTP ${res.status} from Hockey-Reference`);
  }

  const html = await res.text();
  console.log(`[HRTeamStats] Fetched ${html.length} bytes`);

  const $ = cheerio.load(html);

  // HR hides the stats_adv table in an HTML comment — extract it
  let advTableHtml = "";
  $("*").contents().each(function () {
    if (this.type === "comment" && (this as any).data.includes("stats_adv")) {
      advTableHtml = (this as any).data;
      return false; // break
    }
  });

  if (!advTableHtml) {
    throw new Error("[HRTeamStats] stats_adv table not found in HTML comments");
  }

  const $adv = cheerio.load(advTableHtml);
  const rows = $adv("#stats_adv tbody tr").toArray();

  console.log(`[HRTeamStats] stats_adv rows: ${rows.length}`);

  if (rows.length === 0) {
    throw new Error("[HRTeamStats] No rows found in stats_adv table");
  }

  const results = new Map<string, NhlTeamStats>();

  for (const row of rows) {
    const $row = $adv(row);
    const g = (stat: string) => $row.find(`td[data-stat="${stat}"]`).text().trim();

    const rawName = g("team_name").replace(/\*/g, "").trim();
    if (!rawName) continue;

    const abbrev = HR_NAME_TO_ABBREV[rawName];
    if (!abbrev) {
      console.warn(`[HRTeamStats] ⚠ Unknown team name: "${rawName}" — skipping`);
      continue;
    }

    const teamRecord = NHL_TEAMS.find(t => t.abbrev === abbrev);
    const teamName = teamRecord?.name ?? rawName;

    // ── Count stats from stats_adv ────────────────────────────────────────────
    const cf_for      = num(g("corsi_for_5on5"));
    const cf_against  = num(g("corsi_against_5on5"));
    const cf_pct      = pct(g("corsi_pct_5on5"));

    const sc_for      = num(g("sc_for"));
    const sc_against  = num(g("sc_against"));
    const sc_pct      = pct(g("sc_for_pct"));

    const hdsc_for    = num(g("hdsc_for"));
    const hdsc_against = num(g("hdsc_against"));
    const hdsc_pct    = pct(g("hdsc_for_pct"));

    const xgf_total   = num(g("exp_on_goals_for"));
    const xga_total   = num(g("exp_on_goals_against"));
    const gf          = num(g("actual_goals"));
    const ga          = num(g("actual_goals_against"));

    const sh_pct      = pct(g("shot_pct_5on5"));
    const sv_pct_raw  = svPctFromHR(g("sv_pct_5on5"));

    // ── GP estimation from CF counts ─────────────────────────────────────────
    // CF_for + CF_against ≈ 2 * GP * LEAGUE_CF_PER_GAME
    const gp = Math.round((cf_for + cf_against) / (2 * LEAGUE_CF_PER_GAME));
    const gpSafe = Math.max(gp, 1);

    // ── xGF% and xGA% ─────────────────────────────────────────────────────────
    const xg_total = xgf_total + xga_total;
    const xGF_pct = xg_total > 0 ? (xgf_total / xg_total) * 100 : 50.0;
    const xGA_pct = 100 - xGF_pct;

    // ── Per-60 rate stats ─────────────────────────────────────────────────────
    const xGF_60  = toRate60(xgf_total, gpSafe);
    const xGA_60  = toRate60(xga_total, gpSafe);
    const HDCF_60 = toRate60(hdsc_for, gpSafe);
    const HDCA_60 = toRate60(hdsc_against, gpSafe);
    const SCF_60  = toRate60(sc_for, gpSafe);
    const SCA_60  = toRate60(sc_against, gpSafe);
    const CF_60   = toRate60(cf_for, gpSafe);
    const CA_60   = toRate60(cf_against, gpSafe);

    const stats: NhlTeamStats = {
      abbrev,
      name: teamName,
      gp: gpSafe,
      xGF_pct,
      xGA_pct,
      CF_pct:   cf_pct,
      SCF_pct:  sc_pct,
      HDCF_pct: hdsc_pct,
      SH_pct:   sh_pct,
      SV_pct:   sv_pct_raw,
      GF:       gf,
      GA:       ga,
      xGF_60,
      xGA_60,
      HDCF_60,
      HDCA_60,
      SCF_60,
      SCA_60,
      CF_60,
      CA_60,
    };

    results.set(abbrev, stats);

    console.log(
      `[HRTeamStats]   ${abbrev}: GP≈${gpSafe} CF%=${cf_pct} ` +
      `xGF_60=${xGF_60.toFixed(2)} xGA_60=${xGA_60.toFixed(2)} ` +
      `HDCF_60=${HDCF_60.toFixed(2)} HDCA_60=${HDCA_60.toFixed(2)} ` +
      `SCF_60=${SCF_60.toFixed(2)} SCA_60=${SCA_60.toFixed(2)} ` +
      `CF_60=${CF_60.toFixed(2)} CA_60=${CA_60.toFixed(2)} ` +
      `SH%=${sh_pct} SV%=${sv_pct_raw.toFixed(1)} GF=${gf} GA=${ga}`
    );
  }

  console.log(`[HRTeamStats] ✅ Scraped ${results.size}/32 teams from Hockey-Reference`);

  if (results.size < 30) {
    throw new Error(`[HRTeamStats] Only ${results.size} teams scraped — expected ≥30`);
  }

  return results;
}

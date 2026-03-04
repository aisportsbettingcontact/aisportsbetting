/**
 * NCAA Scoreboard API scraper
 * Fetches game start times (in EST) from the NCAA GraphQL API.
 * No authentication required — public endpoint.
 */

const NCAA_API = "https://sdataprod.ncaa.com/";
const GET_CONTESTS_SHA =
  "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";

export interface NcaaGame {
  /** NCAA seoname for away team, e.g. "ohio-st" */
  awaySeoname: string;
  /** NCAA seoname for home team, e.g. "penn-st" */
  homeSeoname: string;
  /** Start time in EST as "HH:MM", e.g. "19:30" */
  startTimeEst: string;
  /** Whether the start time is confirmed (not TBA) */
  hasStartTime: boolean;
  /** Unix epoch in seconds (UTC) */
  startTimeEpoch: number;
}

/**
 * Convert a date string "YYYYMMDD" to NCAA API format "MM/DD/YYYY"
 */
function toNcaaDate(yyyymmdd: string): string {
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${m}/${d}/${y}`;
}

/**
 * Convert UTC epoch (seconds) to EST time string "HH:MM"
 * EST = UTC-5 (no DST adjustment — college basketball season is always EST)
 */
function epochToEst(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const utcH = d.getUTCHours();
  const utcM = d.getUTCMinutes();
  const estH = ((utcH - 5) + 24) % 24;
  return `${estH.toString().padStart(2, "0")}:${utcM.toString().padStart(2, "0")}`;
}

/**
 * Normalize an NCAA seoname to a DB-style slug.
 * NCAA uses hyphens, DB uses underscores. Some names differ slightly.
 */
function seonameToSlug(seoname: string): string {
  return seoname.replace(/-/g, "_");
}

/** Extra alias overrides for NCAA seonames that differ from DB slugs */
const NCAA_ALIAS: Record<string, string> = {
  // NCAA seoname → DB slug
  // Abbreviations
  "eastern_ill": "eastern_illinois",
  "long_island": "liu",
  "ualr": "little_rock",
  "lindenwood_mo": "lindenwood",
  "usc_upstate": "south_carolina_upstate",
  "fgcu": "florida_gulf_coast",
  "north_ala": "north_alabama",
  "eastern_ky": "eastern_kentucky",
  "detroit": "detroit_mercy",
  "saint_josephs": "st_josephs",
  "ga_southern": "georgia_southern",
  "old_dominion": "old_dominion",
  "fdu": "fairleigh_dickinson",
  "central_conn_st": "central_connecticut",
  "chicago_st": "chicago_state",
  // "St" abbreviations → full name
  "ohio_st": "ohio_state",
  "penn_st": "penn_state",
  "florida_st": "florida_state",
  "colorado_st": "colorado_state",
  "youngstown_st": "youngstown_state",
  "cleveland_st": "cleveland_state",
  "wright_st": "wright_state",
  "robert_morris": "robert_morris",
  // Geographic abbreviations
  "northern_ky": "northern_kentucky",
  "west_ga": "west_georgia",
  "southern_california": "usc",
  "north_florida": "north_florida",
  // Conference tournament names
  "umkc": "umkc",
  "oral_roberts": "oral_roberts",
  "rice": "rice",
  "north_texas": "north_texas",
};

function ncaaSlugToDb(seoname: string): string {
  const slug = seonameToSlug(seoname);
  return NCAA_ALIAS[slug] ?? slug;
}

/**
 * Fetch all DI men's basketball games for a given date from the NCAA API.
 * @param dateYYYYMMDD - e.g. "20260304"
 */
export async function fetchNcaaGames(dateYYYYMMDD: string): Promise<NcaaGame[]> {
  const contestDate = toNcaaDate(dateYYYYMMDD);
  // seasonYear is the year the season STARTED (e.g. 2025 for 2025-26 season)
  const seasonYear = parseInt(dateYYYYMMDD.slice(0, 4)) - 1;

  const variables = {
    sportCode: "MBB",
    divisionId: 1,
    contestDate,
    seasonYear,
  };
  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: GET_CONTESTS_SHA,
    },
  };

  const url = `${NCAA_API}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Origin: "https://www.ncaa.com",
      Referer: "https://www.ncaa.com/",
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(`NCAA API returned HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const contests: any[] = data?.data?.contests ?? [];

  const games: NcaaGame[] = [];
  for (const c of contests) {
    const away = c.teams?.find((t: any) => !t.isHome);
    const home = c.teams?.find((t: any) => t.isHome);
    if (!away || !home) continue;

    games.push({
      awaySeoname: ncaaSlugToDb(away.seoname),
      homeSeoname: ncaaSlugToDb(home.seoname),
      startTimeEst: epochToEst(c.startTimeEpoch),
      hasStartTime: c.hasStartTime ?? false,
      startTimeEpoch: c.startTimeEpoch,
    });
  }

  return games;
}

/**
 * Build a lookup map: "awaySlug@homeSlug" → startTimeEst
 */
export function buildStartTimeMap(
  games: NcaaGame[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of games) {
    map.set(`${g.awaySeoname}@${g.homeSeoname}`, g.startTimeEst);
  }
  return map;
}

/**
 * NCAA Scoreboard API scraper
 * Fetches game start times (in EST) from the NCAA GraphQL API.
 * No authentication required — public endpoint.
 *
 * NCAA seonames use hyphens (e.g. "michigan-st").
 * seonameToSlug() converts hyphens to underscores ("michigan_st").
 * NCAA_ALIAS then maps abbreviated forms to full DB slugs ("michigan_st" -> "michigan_state").
 */

const NCAA_API = "https://sdataprod.ncaa.com/";
const GET_CONTESTS_SHA =
  "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";

export interface NcaaGame {
  /** DB-style slug for away team, e.g. "ohio_state" */
  awaySeoname: string;
  /** DB-style slug for home team, e.g. "penn_state" */
  homeSeoname: string;
  /** Start time in EST as "HH:MM", e.g. "19:30" */
  startTimeEst: string;
  /** Whether the start time is confirmed (not TBA) */
  hasStartTime: boolean;
  /** Unix epoch in seconds (UTC) */
  startTimeEpoch: number;
}

function toNcaaDate(yyyymmdd: string): string {
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${m}/${d}/${y}`;
}

function epochToEst(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const estH = ((d.getUTCHours() - 5) + 24) % 24;
  return `${estH.toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function seonameToSlug(seoname: string): string {
  return seoname.replace(/-/g, "_");
}

/**
 * NCAA seoname (after hyphen->underscore) -> DB slug.
 * Only entries that differ from the default conversion are listed.
 */
const NCAA_ALIAS: Record<string, string> = {
  // _st abbreviations -> _state
  michigan_st:         "michigan_state",
  ohio_st:             "ohio_state",
  penn_st:             "penn_state",
  iowa_st:             "iowa_state",
  florida_st:          "florida_state",
  colorado_st:         "colorado_state",
  kansas_st:           "kansas_state",
  oklahoma_st:         "oklahoma_state",
  oregon_st:           "oregon_state",
  washington_st:       "washington_state",
  utah_st:             "utah_state",
  arizona_st:          "arizona_state",
  boise_st:            "boise_state",
  fresno_st:           "fresno_state",
  san_diego_st:        "san_diego_state",
  san_jose_st:         "san_jose_state",
  wichita_st:          "wichita_state",
  illinois_st:         "illinois_state",
  indiana_st:          "indiana_state",
  idaho_st:            "idaho_state",
  montana_st:          "montana_state",
  north_dakota_st:     "north_dakota_state",
  south_dakota_st:     "south_dakota_state",
  south_carolina_st:   "south_carolina_state",
  tennessee_st:        "tennessee_state",
  mississippi_st:      "mississippi_state",
  missouri_st:         "missouri_state",
  murray_st:           "murray_state",
  morehead_st:         "morehead_state",
  jackson_st:          "jackson_state",
  norfolk_st:          "norfolk_state",
  morgan_st:           "morgan_state",
  savannah_st:         "savannah_state",
  kennesaw_st:         "kennesaw_state",
  jacksonville_st:     "jacksonville_state",
  sam_houston_st:      "sam_houston_state",
  tarleton_st:         "tarleton_state",
  texas_st:            "texas_state",
  new_mexico_st:       "new_mexico_state",
  portland_st:         "portland_state",
  sacramento_st:       "sacramento_state",
  weber_st:            "weber_state",
  youngstown_st:       "youngstown_state",
  wright_st:           "wright_state",
  cleveland_st:        "cleveland_state",
  chicago_st:          "chicago_state",
  georgia_st:          "georgia_state",
  long_beach_st:       "long_beach_state",
  kent_st:             "kent_state",
  pittsburg_st:        "pittsburg_state",
  fort_hays_st:        "fort_hays_state",
  nicholls_st:         "nicholls_state",
  north_carolina_st:   "nc_state",
  southeast_mo_st:     "southeast_missouri_state",
  northwest_mo_st:     "northwest_missouri_state",
  northwestern_st:     "northwestern_state",
  west_virginia_st:    "west_virginia_state",
  wayne_st_mi:         "wayne_state",
  // Institutional abbreviations
  ualr:                "little_rock",
  fgcu:                "florida_gulf_coast",
  fdu:                 "fairleigh_dickinson",
  usc_upstate:         "south_carolina_upstate",
  long_island:         "liu",
  lindenwood_mo:       "lindenwood",
  central_conn_st:     "central_connecticut",
  // Geographic abbreviations
  north_ala:           "north_alabama",
  south_ala:           "south_alabama",
  west_ala:            "west_alabama",
  west_ga:             "west_georgia",
  northern_ky:         "northern_kentucky",
  eastern_ky:          "eastern_kentucky",
  eastern_ill:         "eastern_illinois",
  southern_ill:        "southern_illinois",
  southern_california: "usc",
  south_fla:           "south_florida",
  ga_southern:         "georgia_southern",
  north_ala_2:         "north_alabama", // alias
  // Display name differences
  detroit:             "detroit_mercy",
  saint_josephs:       "st_josephs",
  humboldt_st:         "cal_poly_humboldt",
};

function ncaaSlugToDb(seoname: string): string {
  const slug = seonameToSlug(seoname);
  return NCAA_ALIAS[slug] ?? slug;
}

export async function fetchNcaaGames(dateYYYYMMDD: string): Promise<NcaaGame[]> {
  const contestDate = toNcaaDate(dateYYYYMMDD);
  const seasonYear = parseInt(dateYYYYMMDD.slice(0, 4)) - 1;

  const variables = { sportCode: "MBB", divisionId: 1, contestDate, seasonYear };
  const extensions = { persistedQuery: { version: 1, sha256Hash: GET_CONTESTS_SHA } };
  const url = `${NCAA_API}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Origin: "https://www.ncaa.com",
      Referer: "https://www.ncaa.com/",
      Accept: "application/json",
    },
  });

  if (!resp.ok) throw new Error(`NCAA API returned HTTP ${resp.status}`);

  const data = await resp.json();
  const contests: any[] = data?.data?.contests ?? [];

  const games: NcaaGame[] = [];
  for (const c of contests) {
    const away = c.teams?.find((t: any) => !t.isHome);
    const home = c.teams?.find((t: any) => t.isHome);
    if (!away || !home) continue;

    // Use startTime if confirmed; fall back to epoch conversion if epoch is available.
    // NCAA sometimes sets hasStartTime=false even when the epoch is valid (time is known).
    let startTimeEst: string;
    if (c.startTime && c.hasStartTime) {
      startTimeEst = c.startTime;
    } else if (c.startTimeEpoch) {
      startTimeEst = epochToEst(c.startTimeEpoch);
    } else {
      startTimeEst = "TBD";
    }

    games.push({
      awaySeoname: ncaaSlugToDb(away.seoname),
      homeSeoname: ncaaSlugToDb(home.seoname),
      startTimeEst,
      hasStartTime: c.hasStartTime ?? false,
      startTimeEpoch: c.startTimeEpoch,
    });
  }

  return games;
}

export function buildStartTimeMap(games: NcaaGame[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of games) {
    map.set(`${g.awaySeoname}@${g.homeSeoname}`, g.startTimeEst);
  }
  return map;
}

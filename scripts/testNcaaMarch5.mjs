/**
 * Test: verify NCAA start time mapping for March 5 games
 * Run: node scripts/testNcaaMarch5.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const NCAA_API = "https://sdataprod.ncaa.com/";
const GET_CONTESTS_SHA = "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";

const NCAA_ALIAS = {
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
  "ohio_st": "ohio_state",
  "penn_st": "penn_state",
  "florida_st": "florida_state",
  "colorado_st": "colorado_state",
  "youngstown_st": "youngstown_state",
  "cleveland_st": "cleveland_state",
  "wright_st": "wright_state",
  "northern_ky": "northern_kentucky",
  "west_ga": "west_georgia",
  "southern_california": "usc",
  "north_florida": "north_florida",
  "michigan_st": "michigan_state",
  "iowa_st": "iowa_state",
  "le_moyne": "le_moyne",
  "west_georgia": "west_georgia",
  "miami_oh": "miami_oh",
};

function seonameToSlug(s) { return s.replace(/-/g, "_"); }
function ncaaSlugToDb(seoname) {
  const slug = seonameToSlug(seoname);
  return NCAA_ALIAS[slug] ?? slug;
}

const variables = { sportCode: "MBB", divisionId: 1, contestDate: "03/05/2026", seasonYear: 2025 };
const extensions = { persistedQuery: { version: 1, sha256Hash: GET_CONTESTS_SHA } };
const url = `${NCAA_API}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Origin: "https://www.ncaa.com", Referer: "https://www.ncaa.com/", Accept: "application/json" } });
const data = await resp.json();
const contests = data?.data?.contests ?? [];

console.log(`\n=== March 5 games (${contests.length} total) ===`);
for (const c of contests) {
  const away = c.teams?.find(t => !t.isHome);
  const home = c.teams?.find(t => t.isHome);
  if (!away || !home) continue;
  const awayDb = ncaaSlugToDb(away.seoname);
  const homeDb = ncaaSlugToDb(home.seoname);
  const startTime = c.startTime && c.hasStartTime ? c.startTime : (c.startTimeEpoch ? (() => {
    const d = new Date(c.startTimeEpoch * 1000);
    const estH = ((d.getUTCHours() - 5) + 24) % 24;
    return `${estH.toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}`;
  })() : "TBD");
  console.log(`  ${awayDb} @ ${homeDb} → ${startTime} ET (hasStartTime: ${c.hasStartTime})`);
}

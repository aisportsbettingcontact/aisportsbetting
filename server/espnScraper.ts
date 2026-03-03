/**
 * ESPN Team Scraper
 *
 * Automatically scrapes the ESPN NCAAM teams page to build a
 * team slug → ESPN ID + conference mapping. Runs on server startup
 * and refreshes daily. No manual maintenance required.
 *
 * Logo URL pattern: https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/{id}.png&scale=crop&cquality=40&location=origin&w=80&h=80
 */

import { getDb } from "./db";
import { espnTeams } from "../drizzle/schema";
import { sql } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EspnTeamEntry {
  slug: string;
  displayName: string;
  espnId: string;
  conference: string;
  sport: string;
}

// ─── ESPN API Fetcher ─────────────────────────────────────────────────────────

/**
 * Fetches all NCAAM teams from the ESPN public API.
 * Returns an array of { name, espnId, conference } entries.
 */
async function fetchEspnNcaamTeams(): Promise<
  Array<{ name: string; espnId: string; conference: string }>
> {
  const url =
    "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=600";
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ESPN API returned ${res.status}`);
  const data = (await res.json()) as {
    sports: Array<{
      leagues: Array<{
        teams: Array<{
          team: {
            id: string;
            displayName: string;
            shortDisplayName: string;
          };
        }>;
        groups?: Array<{
          name: string;
          teams?: Array<{ team: { id: string } }>;
        }>;
      }>;
    }>;
  };

  const league = data.sports?.[0]?.leagues?.[0];
  if (!league) throw new Error("ESPN API: no league data");

  // Build id → conference map from groups if available
  const idToConf: Record<string, string> = {};
  if (league.groups) {
    for (const group of league.groups) {
      for (const t of group.teams ?? []) {
        idToConf[t.team.id] = group.name;
      }
    }
  }

  return (league.teams ?? []).map((t) => ({
    name: t.team.displayName,
    espnId: t.team.id,
    conference: idToConf[t.team.id] ?? "",
  }));
}

// ─── Slug normalizer ──────────────────────────────────────────────────────────

/**
 * Converts an ESPN display name to the slug format used in model files.
 * e.g. "Duke Blue Devils" → "duke"
 *      "NC State Wolfpack" → "nc_state"
 *      "UNC Wilmington Seahawks" → "nc_wilmington"
 *      "College of Charleston Cougars" → "college_of_charleston"
 */
function toSlug(displayName: string): string {
  // Special overrides for names that don't follow the simple pattern
  const overrides: Record<string, string> = {
    "Duke Blue Devils": "duke",
    "NC State Wolfpack": "nc_state",
    "UNC Wilmington Seahawks": "nc_wilmington",
    "UIC Flames": "illinois_chicago",
    "College of Charleston Cougars": "college_of_charleston",
    "Purdue Fort Wayne Mastodons": "iupui",
    "La Salle Explorers": "la_salle",
    "Mount St. Mary's Mountaineers": "mount_st_marys",
    "Saint Peter's Peacocks": "saint_peters",
    "UAB Blazers": "uab",
    "UTSA Roadrunners": "utsa",
    "BYU Cougars": "byu",
    "SMU Mustangs": "smu",
    "UCF Knights": "ucf",
    "UNLV Rebels": "unlv",
    "USC Trojans": "usc",
    "UT Arlington Mavericks": "ut_arlington",
    "UTEP Miners": "utep",
    "VCU Rams": "vcu",
    "VMI Keydets": "vmi",
    "App State Mountaineers": "appalachian_state",
    "Loyola Chicago Ramblers": "loyola_chicago",
    "Loyola Maryland Greyhounds": "loyola_maryland",
    "St. John's Red Storm": "st_johns",
    "St. Bonaventure Bonnies": "st_bonaventure",
    "St. Joseph's Hawks": "st_josephs",
    "St. Francis Red Flash": "st_francis_pa",
    "St. Francis Brooklyn Terriers": "st_francis_bklyn",
    "St. Thomas Tommies": "st_thomas",
    "Seton Hall Pirates": "seton_hall",
    "San Diego State Aztecs": "san_diego_state",
    "San Diego Toreros": "san_diego",
    "San Francisco Dons": "san_francisco",
    "San Jose State Spartans": "san_jose_state",
    "Long Island University Sharks": "liu",
    "Long Beach State Beach": "long_beach_state",
    "Florida A&M Rattlers": "florida_am",
    "Texas A&M Aggies": "texas_am",
    "Texas A&M-Corpus Christi Islanders": "texas_am_corpus_christi",
    "Miami Hurricanes": "miami_fl",
    "Miami RedHawks": "miami_oh",
    "Illinois Fighting Illini": "illinois",
    "Indiana Hoosiers": "indiana",
    "Iowa Hawkeyes": "iowa",
    "Iowa State Cyclones": "iowa_state",
    "Ohio Bobcats": "ohio",
    "Western Illinois Leathernecks": "western_illinois",
    "Western Kentucky Hilltoppers": "western_kentucky",
    "Western Michigan Broncos": "western_michigan",
    "Eastern Illinois Panthers": "eastern_illinois",
    "Eastern Kentucky Colonels": "eastern_kentucky",
    "Eastern Michigan Eagles": "eastern_michigan",
    "Eastern Washington Eagles": "eastern_washington",
    "Northern Arizona Lumberjacks": "northern_arizona",
    "Northern Colorado Bears": "northern_colorado",
    "Northern Illinois Huskies": "northern_illinois",
    "Northern Iowa Panthers": "northern_iowa",
    "Northern Kentucky Norse": "northern_kentucky",
    "Central Arkansas Bears": "central_arkansas",
    "Central Connecticut Blue Devils": "central_connecticut",
    "Central Michigan Chippewas": "central_michigan",
    "South Florida Bulls": "south_florida",
    "South Carolina Gamecocks": "south_carolina",
    "South Dakota Coyotes": "south_dakota",
    "South Dakota State Jackrabbits": "south_dakota_state",
    "Southern Illinois Salukis": "southern_illinois",
    "Southern Miss Golden Eagles": "southern_miss",
    "Southern Utah Thunderbirds": "southern_utah",
    "Sacramento State Hornets": "sacramento_state",
    "Idaho State Bengals": "idaho_state",
    "Idaho Vandals": "idaho",
    "Montana Grizzlies": "montana",
    "Montana State Bobcats": "montana_state",
    "Portland State Vikings": "portland_state",
    "Weber State Wildcats": "weber_state",
    "Indiana State Sycamores": "indiana_state",
    "Murray State Racers": "murray_state",
    "Tennessee State Tigers": "tennessee_state",
    "Tennessee Tech Golden Eagles": "tennessee_tech",
    "Tennessee Volunteers": "tennessee",
    "Georgia State Panthers": "georgia_state",
    "Georgia Southern Eagles": "georgia_southern",
    "Georgia Tech Yellow Jackets": "georgia_tech",
    "Florida Atlantic Owls": "florida_atlantic",
    "Florida Gulf Coast Eagles": "florida_gulf_coast",
    "Florida International Panthers": "fiu",
    "Alabama A&M Bulldogs": "alabama_am",
    "Alabama State Hornets": "alabama_state",
    "Arizona State Sun Devils": "arizona_state",
    "Arizona Wildcats": "arizona",
    "Arkansas State Red Wolves": "arkansas_state",
    "Arkansas-Pine Bluff Golden Lions": "arkansas_pine_bluff",
    "Colorado State Rams": "colorado_state",
    "Colorado Buffaloes": "colorado",
    "Mississippi State Bulldogs": "mississippi_state",
    "Mississippi Valley State Delta Devils": "mississippi_valley_state",
    "Ole Miss Rebels": "ole_miss",
    "New Mexico State Aggies": "new_mexico_state",
    "New Mexico Lobos": "new_mexico",
    "New Orleans Privateers": "new_orleans",
    "North Texas Mean Green": "north_texas",
    "North Carolina A&T Aggies": "north_carolina_at",
    "North Carolina Central Eagles": "north_carolina_central",
    "North Carolina Tar Heels": "north_carolina",
    "Wichita State Shockers": "wichita_state",
    "Cleveland State Vikings": "cleveland_state",
    "Merrimack Warriors": "merrimack",
    "Quinnipiac Bobcats": "quinnipiac",
    "Rider Broncs": "rider",
    "Siena Saints": "siena",
    "Niagara Purple Eagles": "niagara",
    "Canisius Golden Griffins": "canisius",
    "Fairfield Stags": "fairfield",
    "Marist Red Foxes": "marist",
    "Manhattan Jaspers": "manhattan",
    "Iona Gaels": "iona",
    "Charlotte 49ers": "charlotte",
    "Davidson Wildcats": "davidson",
    "Rice Owls": "rice",
    "Temple Owls": "temple",
    "East Carolina Pirates": "east_carolina",
    "Evansville Purple Aces": "evansville",
    "Bradley Braves": "bradley",
    "Drake Bulldogs": "drake",
    "DePaul Blue Demons": "depaul",
    "Marquette Golden Eagles": "marquette",
    "Rutgers Scarlet Knights": "rutgers",
    "Maryland Terrapins": "maryland",
    "Michigan State Spartans": "michigan_state",
    "Purdue Boilermakers": "purdue",
    "Ohio State Buckeyes": "ohio_state",
    "Belmont Bruins": "belmont",
    "Memphis Tigers": "memphis",
  };

  if (overrides[displayName]) return overrides[displayName];

  // Generic: take the first word(s) before the mascot, lowercase, replace spaces with _
  // Strip common mascot words and convert to slug
  const slug = displayName
    .toLowerCase()
    // Remove common mascot suffixes
    .replace(
      /\s+(wildcats|tigers|bulldogs|eagles|hawks|bears|wolves|lions|panthers|cardinals|falcons|owls|rams|bulls|knights|pirates|trojans|cougars|bobcats|aggies|mustangs|longhorns|horned frogs|cowboys|cyclones|jayhawks|cornhuskers|huskers|gators|seminoles|hurricanes|tar heels|blue devils|wolfpack|demon deacons|cavaliers|hokies|orange|fighting irish|golden eagles|golden griffins|golden bears|golden flashes|golden gophers|golden hurricanes|golden panthers|golden tornadoes|green wave|grizzlies|hoosiers|horned frogs|jaguars|jaspers|lumberjacks|mastodons|mean green|mountaineers|musketeers|norse|peacocks|purple aces|purple eagles|racers|red foxes|red storm|redbirds|roadrunners|runnin\' rebels|salukis|scarlet knights|seahawks|shockers|skyhawks|spartans|sycamores|terrapins|thunderbirds|tommies|toreros|vikings|vols|volunteers|warhawks|warriors|yellow jackets|zips)$/,
      ""
    )
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_");

  return slug;
}

// ─── DB Upsert ────────────────────────────────────────────────────────────────

async function upsertEspnTeams(teams: EspnTeamEntry[]): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let count = 0;
  for (const team of teams) {
    await db
      .insert(espnTeams)
      .values(team)
      .onDuplicateKeyUpdate({
        set: {
          displayName: team.displayName,
          espnId: team.espnId,
          conference: team.conference,
          sport: team.sport,
        },
      });
    count++;
  }
  return count;
}

// ─── Main sync function ───────────────────────────────────────────────────────

export async function syncEspnTeams(sport = "NCAAM"): Promise<number> {
  console.log(`[ESPNScraper] Syncing ${sport} teams from ESPN...`);
  try {
    const rawTeams = await fetchEspnNcaamTeams();
    const entries: EspnTeamEntry[] = rawTeams.map((t) => ({
      slug: toSlug(t.name),
      displayName: t.name,
      espnId: t.espnId,
      conference: t.conference,
      sport,
    }));

    const count = await upsertEspnTeams(entries);
    console.log(`[ESPNScraper] Synced ${count} ${sport} teams`);
    return count;
  } catch (err) {
    console.error("[ESPNScraper] Sync failed:", err);
    return 0;
  }
}

// ─── Scheduled daily refresh ──────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function startEspnSyncSchedule(): void {
  // Run immediately on startup
  syncEspnTeams("NCAAM").catch(console.error);

  // Then refresh every 24 hours
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  syncTimer = setInterval(() => {
    syncEspnTeams("NCAAM").catch(console.error);
  }, MS_PER_DAY);

  console.log("[ESPNScraper] Daily sync scheduled");
}

export function stopEspnSyncSchedule(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

// ─── Logo URL builder ─────────────────────────────────────────────────────────

export function buildEspnLogoUrl(espnId: string, size = 80): string {
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/${espnId}.png&scale=crop&cquality=40&location=origin&w=${size}&h=${size}`;
}

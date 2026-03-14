import { NBA_TEAMS, NBA_BY_AN_SLUG } from "./shared/nbaTeams";
import { NHL_TEAMS, NHL_BY_AN_SLUG } from "./shared/nhlTeams";

// NBA game URL slugs from the browser
const NBA_GAME_URLS = [
  "/nba-game/wizards-celtics-score-odds-march-14-2026/281090",
  "/nba-game/magic-heat-score-odds-march-14-2026/281091",
  "/nba-game/nuggets-lakers-score-odds-march-14-2026/281093",
  "/nba-game/kings-clippers-score-odds-march-14-2026/281094",
  "/nba-game/bucks-hawks-score-odds-march-14-2026/281089",
  "/nba-game/hornets-spurs-score-odds-march-14-2026/281092",
  "/nba-game/nets-76ers-score-odds-march-14-2026/281088",
];

// NHL game URL slugs from the browser
const NHL_GAME_URLS = [
  "/nhl-game/rangers-wild-score-odds-march-14-2026/263572",
  "/nhl-game/kings-devils-score-odds-march-14-2026/263573",
  "/nhl-game/sharks-canadiens-score-odds-march-14-2026/263574",
  "/nhl-game/hurricanes-lightning-score-odds-march-14-2026/263575",
  "/nhl-game/maple-leafs-sabres-score-odds-march-14-2026/263576",
  "/nhl-game/flames-islanders-score-odds-march-14-2026/263577",
  "/nhl-game/blue-jackets-flyers-score-odds-march-14-2026/263578",
  "/nhl-game/red-wings-stars-score-odds-march-14-2026/263579",
  "/nhl-game/penguins-mammoth-score-odds-march-14-2026/263580",
  "/nhl-game/blackhawks-golden-knights-score-odds-march-14-2026/263581",
  "/nhl-game/kraken-canucks-score-odds-march-14-2026/263582",
  "/nhl-game/bruins-capitals-score-odds-march-14-2026/263570",
  "/nhl-game/avalanche-jets-score-odds-march-14-2026/263571",
  "/nhl-game/ducks-senators-score-odds-march-14-2026/263569",
];

// Build NBA slug lookup
const nbaByNorm = new Map<string, string>();
for (const t of NBA_TEAMS) {
  nbaByNorm.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
  nbaByNorm.set(t.anSlug, t.dbSlug);
  nbaByNorm.set(t.nbaSlug, t.dbSlug);
  nbaByNorm.set(t.vsinSlug, t.dbSlug);
}
// NBA URL slug aliases (short nicknames used in game URLs)
const NBA_URL_ALIASES: Record<string, string> = {
  "wizards": "washington_wizards",
  "celtics": "boston_celtics",
  "magic": "orlando_magic",
  "heat": "miami_heat",
  "nuggets": "denver_nuggets",
  "lakers": "los_angeles_lakers",
  "kings": "sacramento_kings",
  "clippers": "los_angeles_clippers",
  "bucks": "milwaukee_bucks",
  "hawks": "atlanta_hawks",
  "hornets": "charlotte_hornets",
  "spurs": "san_antonio_spurs",
  "nets": "brooklyn_nets",
  "76ers": "philadelphia_76ers",
  "knicks": "new_york_knicks",
  "raptors": "toronto_raptors",
  "bulls": "chicago_bulls",
  "cavaliers": "cleveland_cavaliers",
  "pistons": "detroit_pistons",
  "pacers": "indiana_pacers",
  "timberwolves": "minnesota_timberwolves",
  "thunder": "oklahoma_city_thunder",
  "jazz": "utah_jazz",
  "trail-blazers": "portland_trail_blazers",
  "warriors": "golden_state_warriors",
  "suns": "phoenix_suns",
  "mavericks": "dallas_mavericks",
  "rockets": "houston_rockets",
  "grizzlies": "memphis_grizzlies",
  "pelicans": "new_orleans_pelicans",
};
for (const [alias, dbSlug] of Object.entries(NBA_URL_ALIASES)) {
  nbaByNorm.set(alias, dbSlug);
}

// Build NHL slug lookup
const nhlByNorm = new Map<string, string>();
for (const t of NHL_TEAMS) {
  nhlByNorm.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
  nhlByNorm.set(t.anSlug, t.dbSlug);
  nhlByNorm.set(t.vsinSlug, t.dbSlug);
  nhlByNorm.set(t.nhlSlug, t.dbSlug);
}
// NHL URL slug aliases
const NHL_URL_ALIASES: Record<string, string> = {
  "rangers": "new_york_rangers",
  "wild": "minnesota_wild",
  "kings": "los_angeles_kings",
  "devils": "new_jersey_devils",
  "sharks": "san_jose_sharks",
  "canadiens": "montreal_canadiens",
  "hurricanes": "carolina_hurricanes",
  "lightning": "tampa_bay_lightning",
  "maple-leafs": "toronto_maple_leafs",
  "sabres": "buffalo_sabres",
  "flames": "calgary_flames",
  "islanders": "new_york_islanders",
  "blue-jackets": "columbus_blue_jackets",
  "flyers": "philadelphia_flyers",
  "red-wings": "detroit_red_wings",
  "stars": "dallas_stars",
  "penguins": "pittsburgh_penguins",
  "mammoth": "utah_hockey_club",
  "blackhawks": "chicago_blackhawks",
  "golden-knights": "vegas_golden_knights",
  "kraken": "seattle_kraken",
  "canucks": "vancouver_canucks",
  "bruins": "boston_bruins",
  "capitals": "washington_capitals",
  "avalanche": "colorado_avalanche",
  "jets": "winnipeg_jets",
  "ducks": "anaheim_ducks",
  "senators": "ottawa_senators",
  "oilers": "edmonton_oilers",
  "predators": "nashville_predators",
  "blues": "st_louis_blues",
  "panthers": "florida_panthers",
};
for (const [alias, dbSlug] of Object.entries(NHL_URL_ALIASES)) {
  nhlByNorm.set(alias, dbSlug);
}

function splitCombinedSlug(combined: string, lookup: Map<string, string>): [string, string] | null {
  const parts = combined.split("-");
  for (let i = 1; i < parts.length; i++) {
    const awayPart = parts.slice(0, i).join("-");
    const homePart = parts.slice(i).join("-");
    if (lookup.has(awayPart) && lookup.has(homePart)) {
      return [lookup.get(awayPart)!, lookup.get(homePart)!];
    }
  }
  return null;
}

console.log("\n=== NBA SLUG MATCHING ===");
let nbaMatched = 0, nbaFailed = 0;
for (const url of NBA_GAME_URLS) {
  const parts = url.split("/");
  const gamePart = parts[2] || "";
  const combined = gamePart.replace(/-score-odds-.*$/, "");
  const match = splitCombinedSlug(combined, nbaByNorm);
  if (match) {
    nbaMatched++;
    console.log(`✓ ${match[0]} @ ${match[1]}`);
  } else {
    nbaFailed++;
    console.log(`✗ NO_MATCH: "${combined}"`);
  }
}
console.log(`NBA: ${nbaMatched} matched, ${nbaFailed} failed\n`);

console.log("=== NHL SLUG MATCHING ===");
let nhlMatched = 0, nhlFailed = 0;
for (const url of NHL_GAME_URLS) {
  const parts = url.split("/");
  const gamePart = parts[2] || "";
  const combined = gamePart.replace(/-score-odds-.*$/, "");
  const match = splitCombinedSlug(combined, nhlByNorm);
  if (match) {
    nhlMatched++;
    console.log(`✓ ${match[0]} @ ${match[1]}`);
  } else {
    nhlFailed++;
    console.log(`✗ NO_MATCH: "${combined}"`);
  }
}
console.log(`NHL: ${nhlMatched} matched, ${nhlFailed} failed`);

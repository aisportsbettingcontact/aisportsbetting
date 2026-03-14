import { readFileSync } from "fs";
import { parseAnAllMarketsHtml } from "./server/anHtmlParser";
import { NBA_TEAMS } from "./shared/nbaTeams";
import { NHL_TEAMS } from "./shared/nhlTeams";

// ─── NBA Test ───────────────────────────────────────────────────────────────
const nbaHtml = readFileSync("/home/ubuntu/upload/nba_all_markets.html", "utf-8");
const nbaResult = parseAnAllMarketsHtml(nbaHtml, "nba");

console.log("\n=== NBA PARSE RESULTS ===");
console.log(`Games found: ${nbaResult.games.length}`);
console.log(`DK column: ${nbaResult.dkColumnIndex}`);
console.log(`Warnings: ${nbaResult.warnings.length}`);

// Build NBA slug lookup
const nbaByNorm = new Map<string, string>();
const NBA_URL_ALIASES: Record<string, string> = {
  "wizards": "washington_wizards", "celtics": "boston_celtics",
  "magic": "orlando_magic", "heat": "miami_heat",
  "nuggets": "denver_nuggets", "lakers": "los_angeles_lakers",
  "kings": "sacramento_kings", "clippers": "los_angeles_clippers",
  "bucks": "milwaukee_bucks", "hawks": "atlanta_hawks",
  "hornets": "charlotte_hornets", "spurs": "san_antonio_spurs",
  "nets": "brooklyn_nets", "76ers": "philadelphia_76ers",
  "knicks": "new_york_knicks", "raptors": "toronto_raptors",
  "bulls": "chicago_bulls", "cavaliers": "cleveland_cavaliers",
  "pistons": "detroit_pistons", "pacers": "indiana_pacers",
  "timberwolves": "minnesota_timberwolves", "thunder": "oklahoma_city_thunder",
  "jazz": "utah_jazz", "trail-blazers": "portland_trail_blazers",
  "warriors": "golden_state_warriors", "suns": "phoenix_suns",
  "mavericks": "dallas_mavericks", "rockets": "houston_rockets",
  "grizzlies": "memphis_grizzlies", "pelicans": "new_orleans_pelicans",
};
for (const [alias, dbSlug] of Object.entries(NBA_URL_ALIASES)) nbaByNorm.set(alias, dbSlug);
for (const t of NBA_TEAMS) {
  nbaByNorm.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
  nbaByNorm.set(t.anSlug, t.dbSlug);
  nbaByNorm.set(t.nbaSlug, t.dbSlug);
  nbaByNorm.set(t.vsinSlug, t.dbSlug);
}

function splitSlug(combined: string, lookup: Map<string, string>): [string, string] | null {
  const parts = combined.split("-");
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join("-");
    const h = parts.slice(i).join("-");
    if (lookup.has(a) && lookup.has(h)) return [lookup.get(a)!, lookup.get(h)!];
  }
  return null;
}

let nbaMatched = 0, nbaFailed = 0;
for (const g of nbaResult.games) {
  const urlParts = g.gameUrl.split("/");
  const gamePart = urlParts[2] || "";
  const combined = gamePart.replace(/-score-odds-.*$/, "");
  const match = splitSlug(combined, nbaByNorm);
  if (match) {
    nbaMatched++;
    const [away, home] = match;
    console.log(`  ✓ ${away} @ ${home}`);
    console.log(`    Spread: ${g.openAwaySpread?.line}/${g.openHomeSpread?.line} (open) | ${g.dkAwaySpread?.line}/${g.dkHomeSpread?.line} (DK)`);
    console.log(`    Total:  ${g.openOver?.line}/${g.openUnder?.line} (open) | ${g.dkOver?.line}/${g.dkUnder?.line} (DK)`);
    console.log(`    ML:     ${g.openAwayML?.line}/${g.openHomeML?.line} (open) | ${g.dkAwayML?.line}/${g.dkHomeML?.line} (DK)`);
  } else {
    nbaFailed++;
    console.log(`  ✗ NO_MATCH: "${combined}" (${g.awayName} @ ${g.homeName})`);
  }
}
console.log(`\nNBA: ${nbaMatched} matched, ${nbaFailed} failed`);

// ─── NHL Test ───────────────────────────────────────────────────────────────
const nhlHtml = readFileSync("/home/ubuntu/upload/nhl_all_markets_combined.html", "utf-8");
const nhlResult = parseAnAllMarketsHtml(nhlHtml, "nhl");

console.log("\n=== NHL PARSE RESULTS ===");
console.log(`Games found: ${nhlResult.games.length}`);
console.log(`DK column: ${nhlResult.dkColumnIndex}`);
console.log(`Warnings: ${nhlResult.warnings.length}`);

const nhlByNorm = new Map<string, string>();
const NHL_URL_ALIASES: Record<string, string> = {
  "rangers": "new_york_rangers", "wild": "minnesota_wild",
  "kings": "los_angeles_kings", "devils": "new_jersey_devils",
  "sharks": "san_jose_sharks", "canadiens": "montreal_canadiens",
  "hurricanes": "carolina_hurricanes", "lightning": "tampa_bay_lightning",
  "maple-leafs": "toronto_maple_leafs", "sabres": "buffalo_sabres",
  "flames": "calgary_flames", "islanders": "new_york_islanders",
  "blue-jackets": "columbus_blue_jackets", "flyers": "philadelphia_flyers",
  "red-wings": "detroit_red_wings", "stars": "dallas_stars",
  "penguins": "pittsburgh_penguins", "mammoth": "utah_hockey_club",
  "blackhawks": "chicago_blackhawks", "golden-knights": "vegas_golden_knights",
  "kraken": "seattle_kraken", "canucks": "vancouver_canucks",
  "bruins": "boston_bruins", "capitals": "washington_capitals",
  "avalanche": "colorado_avalanche", "jets": "winnipeg_jets",
  "ducks": "anaheim_ducks", "senators": "ottawa_senators",
  "oilers": "edmonton_oilers", "predators": "nashville_predators",
  "blues": "st_louis_blues", "panthers": "florida_panthers",
};
for (const [alias, dbSlug] of Object.entries(NHL_URL_ALIASES)) nhlByNorm.set(alias, dbSlug);
for (const t of NHL_TEAMS) {
  nhlByNorm.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
  nhlByNorm.set(t.anSlug, t.dbSlug);
  nhlByNorm.set(t.vsinSlug, t.dbSlug);
  nhlByNorm.set(t.nhlSlug, t.dbSlug);
}

let nhlMatched = 0, nhlFailed = 0;
for (const g of nhlResult.games) {
  const urlParts = g.gameUrl.split("/");
  const gamePart = urlParts[2] || "";
  const combined = gamePart.replace(/-score-odds-.*$/, "");
  const match = splitSlug(combined, nhlByNorm);
  if (match) {
    nhlMatched++;
    const [away, home] = match;
    console.log(`  ✓ ${away} @ ${home}`);
    console.log(`    Spread: ${g.openAwaySpread?.line}/${g.openHomeSpread?.line} (open) | ${g.dkAwaySpread?.line}/${g.dkHomeSpread?.line} (DK)`);
    console.log(`    Total:  ${g.openOver?.line}/${g.openUnder?.line} (open) | ${g.dkOver?.line}/${g.dkUnder?.line} (DK)`);
    console.log(`    ML:     ${g.openAwayML?.line}/${g.openHomeML?.line} (open) | ${g.dkAwayML?.line}/${g.dkHomeML?.line} (DK)`);
  } else {
    nhlFailed++;
    console.log(`  ✗ NO_MATCH: "${combined}" (${g.awayName} @ ${g.homeName})`);
  }
}
console.log(`\nNHL: ${nhlMatched} matched, ${nhlFailed} failed`);

/**
 * MLB Teams + Players Seed Script
 *
 * Seeds:
 *   1. mlb_teams — all 30 MLB teams with complete cross-source IDs and brand colors
 *   2. mlb_players — 55 notable active/recent players with MLBAM IDs and BR IDs
 *
 * Run: node server/seed-mlb.mjs
 */

import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

const db = await createConnection(process.env.DATABASE_URL);
console.log("[seed-mlb] Connected to database");

// ─── 1. Seed MLB Teams ────────────────────────────────────────────────────────

const teams = [
  // AL East
  { mlbId: 110, mlbCode: "bal", abbrev: "BAL", brAbbrev: "BAL", league: "AL", division: "East", city: "Baltimore", nickname: "Orioles", name: "Baltimore Orioles", vsinSlug: "orioles", dbSlug: "orioles", anSlug: "baltimore-orioles", anLogoSlug: "bal", logoUrl: "https://www.mlbstatic.com/team-logos/110.svg", primaryColor: "#DF4601", secondaryColor: "#000000", tertiaryColor: null },
  { mlbId: 111, mlbCode: "bos", abbrev: "BOS", brAbbrev: "BOS", league: "AL", division: "East", city: "Boston", nickname: "Red Sox", name: "Boston Red Sox", vsinSlug: "redsox", dbSlug: "redsox", anSlug: "boston-red-sox", anLogoSlug: "bos", logoUrl: "https://www.mlbstatic.com/team-logos/111.svg", primaryColor: "#BD3039", secondaryColor: "#0C2340", tertiaryColor: null },
  { mlbId: 147, mlbCode: "nya", abbrev: "NYY", brAbbrev: "NYY", league: "AL", division: "East", city: "New York", nickname: "Yankees", name: "New York Yankees", vsinSlug: "yankees", dbSlug: "yankees", anSlug: "new-york-yankees", anLogoSlug: "nyyd", logoUrl: "https://www.mlbstatic.com/team-logos/147.svg", primaryColor: "#003087", secondaryColor: "#FFFFFF", tertiaryColor: null },
  { mlbId: 139, mlbCode: "tba", abbrev: "TB", brAbbrev: "TBD", league: "AL", division: "East", city: "Tampa Bay", nickname: "Rays", name: "Tampa Bay Rays", vsinSlug: "rays", dbSlug: "rays", anSlug: "tampa-bay-rays", anLogoSlug: "tb", logoUrl: "https://www.mlbstatic.com/team-logos/139.svg", primaryColor: "#092C5C", secondaryColor: "#8FBCE6", tertiaryColor: "#F5D130" },
  { mlbId: 141, mlbCode: "tor", abbrev: "TOR", brAbbrev: "TOR", league: "AL", division: "East", city: "Toronto", nickname: "Blue Jays", name: "Toronto Blue Jays", vsinSlug: "bluejays", dbSlug: "bluejays", anSlug: "toronto-blue-jays", anLogoSlug: "tor", logoUrl: "https://www.mlbstatic.com/team-logos/141.svg", primaryColor: "#134A8E", secondaryColor: "#1D2D5C", tertiaryColor: "#E8291C" },
  // AL Central
  { mlbId: 145, mlbCode: "cha", abbrev: "CWS", brAbbrev: "CHW", league: "AL", division: "Central", city: "Chicago", nickname: "White Sox", name: "Chicago White Sox", vsinSlug: "whitesox", dbSlug: "whitesox", anSlug: "chicago-white-sox", anLogoSlug: "cws", logoUrl: "https://www.mlbstatic.com/team-logos/145.svg", primaryColor: "#27251F", secondaryColor: "#C4CED4", tertiaryColor: null },
  { mlbId: 114, mlbCode: "cle", abbrev: "CLE", brAbbrev: "CLE", league: "AL", division: "Central", city: "Cleveland", nickname: "Guardians", name: "Cleveland Guardians", vsinSlug: "guardians", dbSlug: "guardians", anSlug: "cleveland-guardians", anLogoSlug: "cle", logoUrl: "https://www.mlbstatic.com/team-logos/114.svg", primaryColor: "#00385D", secondaryColor: "#E31937", tertiaryColor: null },
  { mlbId: 116, mlbCode: "det", abbrev: "DET", brAbbrev: "DET", league: "AL", division: "Central", city: "Detroit", nickname: "Tigers", name: "Detroit Tigers", vsinSlug: "tigers", dbSlug: "tigers", anSlug: "detroit-tigers", anLogoSlug: "det", logoUrl: "https://www.mlbstatic.com/team-logos/116.svg", primaryColor: "#0C2340", secondaryColor: "#FA4616", tertiaryColor: null },
  { mlbId: 118, mlbCode: "kca", abbrev: "KC", brAbbrev: "KCR", league: "AL", division: "Central", city: "Kansas City", nickname: "Royals", name: "Kansas City Royals", vsinSlug: "royals", dbSlug: "royals", anSlug: "kansas-city-royals", anLogoSlug: "kcd", logoUrl: "https://www.mlbstatic.com/team-logos/118.svg", primaryColor: "#004687", secondaryColor: "#BD9B60", tertiaryColor: null },
  { mlbId: 142, mlbCode: "min", abbrev: "MIN", brAbbrev: "MIN", league: "AL", division: "Central", city: "Minnesota", nickname: "Twins", name: "Minnesota Twins", vsinSlug: "twins", dbSlug: "twins", anSlug: "minnesota-twins", anLogoSlug: "mind", logoUrl: "https://www.mlbstatic.com/team-logos/142.svg", primaryColor: "#002B5C", secondaryColor: "#D31145", tertiaryColor: "#B9975B" },
  // AL West
  { mlbId: 133, mlbCode: "ath", abbrev: "ATH", brAbbrev: "OAK", league: "AL", division: "West", city: "Sacramento", nickname: "Athletics", name: "Athletics", vsinSlug: "athletics", dbSlug: "athletics", anSlug: "oakland-athletics", anLogoSlug: "oakd", logoUrl: "https://www.mlbstatic.com/team-logos/133.svg", primaryColor: "#003831", secondaryColor: "#EFB21E", tertiaryColor: null },
  { mlbId: 117, mlbCode: "hou", abbrev: "HOU", brAbbrev: "HOU", league: "AL", division: "West", city: "Houston", nickname: "Astros", name: "Houston Astros", vsinSlug: "astros", dbSlug: "astros", anSlug: "houston-astros", anLogoSlug: "hou", logoUrl: "https://www.mlbstatic.com/team-logos/117.svg", primaryColor: "#002D62", secondaryColor: "#EB6E1F", tertiaryColor: "#F4911E" },
  { mlbId: 108, mlbCode: "ana", abbrev: "LAA", brAbbrev: "ANA", league: "AL", division: "West", city: "Los Angeles", nickname: "Angels", name: "Los Angeles Angels", vsinSlug: "angels", dbSlug: "angels", anSlug: "los-angeles-angels", anLogoSlug: "laa", logoUrl: "https://www.mlbstatic.com/team-logos/108.svg", primaryColor: "#BA0021", secondaryColor: "#003263", tertiaryColor: "#C4CED4" },
  { mlbId: 136, mlbCode: "sea", abbrev: "SEA", brAbbrev: "SEA", league: "AL", division: "West", city: "Seattle", nickname: "Mariners", name: "Seattle Mariners", vsinSlug: "mariners", dbSlug: "mariners", anSlug: "seattle-mariners", anLogoSlug: "sea", logoUrl: "https://www.mlbstatic.com/team-logos/136.svg", primaryColor: "#0C2C56", secondaryColor: "#005C5C", tertiaryColor: "#C4CED4" },
  { mlbId: 140, mlbCode: "tex", abbrev: "TEX", brAbbrev: "TEX", league: "AL", division: "West", city: "Texas", nickname: "Rangers", name: "Texas Rangers", vsinSlug: "rangers", dbSlug: "rangers", anSlug: "texas-rangers", anLogoSlug: "tex", logoUrl: "https://www.mlbstatic.com/team-logos/140.svg", primaryColor: "#003278", secondaryColor: "#C0111F", tertiaryColor: null },
  // NL East
  { mlbId: 144, mlbCode: "atl", abbrev: "ATL", brAbbrev: "ATL", league: "NL", division: "East", city: "Atlanta", nickname: "Braves", name: "Atlanta Braves", vsinSlug: "braves", dbSlug: "braves", anSlug: "atlanta-braves", anLogoSlug: "atl", logoUrl: "https://www.mlbstatic.com/team-logos/144.svg", primaryColor: "#CE1141", secondaryColor: "#13274F", tertiaryColor: "#EAAA00" },
  { mlbId: 146, mlbCode: "mia", abbrev: "MIA", brAbbrev: "FLA", league: "NL", division: "East", city: "Miami", nickname: "Marlins", name: "Miami Marlins", vsinSlug: "marlins", dbSlug: "marlins", anSlug: "miami-marlins", anLogoSlug: "mia_n", logoUrl: "https://www.mlbstatic.com/team-logos/146.svg", primaryColor: "#00A3E0", secondaryColor: "#EF3340", tertiaryColor: "#000000" },
  { mlbId: 121, mlbCode: "nyn", abbrev: "NYM", brAbbrev: "NYM", league: "NL", division: "East", city: "New York", nickname: "Mets", name: "New York Mets", vsinSlug: "mets", dbSlug: "mets", anSlug: "new-york-mets", anLogoSlug: "nym", logoUrl: "https://www.mlbstatic.com/team-logos/121.svg", primaryColor: "#002D72", secondaryColor: "#FF5910", tertiaryColor: null },
  { mlbId: 143, mlbCode: "phi", abbrev: "PHI", brAbbrev: "PHI", league: "NL", division: "East", city: "Philadelphia", nickname: "Phillies", name: "Philadelphia Phillies", vsinSlug: "phillies", dbSlug: "phillies", anSlug: "philadelphia-phillies", anLogoSlug: "phi", logoUrl: "https://www.mlbstatic.com/team-logos/143.svg", primaryColor: "#E81828", secondaryColor: "#002D72", tertiaryColor: null },
  { mlbId: 120, mlbCode: "was", abbrev: "WSH", brAbbrev: "WSN", league: "NL", division: "East", city: "Washington", nickname: "Nationals", name: "Washington Nationals", vsinSlug: "nationals", dbSlug: "nationals", anSlug: "washington-nationals", anLogoSlug: "wsh", logoUrl: "https://www.mlbstatic.com/team-logos/120.svg", primaryColor: "#AB0003", secondaryColor: "#14225A", tertiaryColor: "#FFFFFF" },
  // NL Central
  { mlbId: 112, mlbCode: "chn", abbrev: "CHC", brAbbrev: "CHC", league: "NL", division: "Central", city: "Chicago", nickname: "Cubs", name: "Chicago Cubs", vsinSlug: "cubs", dbSlug: "cubs", anSlug: "chicago-cubs", anLogoSlug: "chc", logoUrl: "https://www.mlbstatic.com/team-logos/112.svg", primaryColor: "#0E3386", secondaryColor: "#CC3433", tertiaryColor: null },
  { mlbId: 113, mlbCode: "cin", abbrev: "CIN", brAbbrev: "CIN", league: "NL", division: "Central", city: "Cincinnati", nickname: "Reds", name: "Cincinnati Reds", vsinSlug: "reds", dbSlug: "reds", anSlug: "cincinnati-reds", anLogoSlug: "cin", logoUrl: "https://www.mlbstatic.com/team-logos/113.svg", primaryColor: "#C6011F", secondaryColor: "#000000", tertiaryColor: null },
  { mlbId: 158, mlbCode: "mil", abbrev: "MIL", brAbbrev: "MIL", league: "NL", division: "Central", city: "Milwaukee", nickname: "Brewers", name: "Milwaukee Brewers", vsinSlug: "brewers", dbSlug: "brewers", anSlug: "milwaukee-brewers", anLogoSlug: "mil", logoUrl: "https://www.mlbstatic.com/team-logos/158.svg", primaryColor: "#12284B", secondaryColor: "#FFC52F", tertiaryColor: null },
  { mlbId: 134, mlbCode: "pit", abbrev: "PIT", brAbbrev: "PIT", league: "NL", division: "Central", city: "Pittsburgh", nickname: "Pirates", name: "Pittsburgh Pirates", vsinSlug: "pirates", dbSlug: "pirates", anSlug: "pittsburgh-pirates", anLogoSlug: "pit", logoUrl: "https://www.mlbstatic.com/team-logos/134.svg", primaryColor: "#27251F", secondaryColor: "#FDB827", tertiaryColor: null },
  { mlbId: 138, mlbCode: "sln", abbrev: "STL", brAbbrev: "STL", league: "NL", division: "Central", city: "St. Louis", nickname: "Cardinals", name: "St. Louis Cardinals", vsinSlug: "cardinals", dbSlug: "cardinals", anSlug: "st-louis-cardinals", anLogoSlug: "stl", logoUrl: "https://www.mlbstatic.com/team-logos/138.svg", primaryColor: "#C41E3A", secondaryColor: "#0C2340", tertiaryColor: null },
  // NL West
  { mlbId: 109, mlbCode: "ari", abbrev: "ARI", brAbbrev: "ARI", league: "NL", division: "West", city: "Arizona", nickname: "D-backs", name: "Arizona Diamondbacks", vsinSlug: "dbacks", dbSlug: "dbacks", anSlug: "arizona-diamondbacks", anLogoSlug: "ari", logoUrl: "https://www.mlbstatic.com/team-logos/109.svg", primaryColor: "#A71930", secondaryColor: "#E3D4AD", tertiaryColor: "#000000" },
  { mlbId: 115, mlbCode: "col", abbrev: "COL", brAbbrev: "COL", league: "NL", division: "West", city: "Colorado", nickname: "Rockies", name: "Colorado Rockies", vsinSlug: "rockies", dbSlug: "rockies", anSlug: "colorado-rockies", anLogoSlug: "col", logoUrl: "https://www.mlbstatic.com/team-logos/115.svg", primaryColor: "#33006F", secondaryColor: "#C4CED4", tertiaryColor: null },
  { mlbId: 119, mlbCode: "lan", abbrev: "LAD", brAbbrev: "LAD", league: "NL", division: "West", city: "Los Angeles", nickname: "Dodgers", name: "Los Angeles Dodgers", vsinSlug: "dodgers", dbSlug: "dodgers", anSlug: "los-angeles-dodgers", anLogoSlug: "ladd", logoUrl: "https://www.mlbstatic.com/team-logos/119.svg", primaryColor: "#005A9C", secondaryColor: "#EF3E42", tertiaryColor: null },
  { mlbId: 135, mlbCode: "sdn", abbrev: "SD", brAbbrev: "SDP", league: "NL", division: "West", city: "San Diego", nickname: "Padres", name: "San Diego Padres", vsinSlug: "padres", dbSlug: "padres", anSlug: "san-diego-padres", anLogoSlug: "sd", logoUrl: "https://www.mlbstatic.com/team-logos/135.svg", primaryColor: "#2F241D", secondaryColor: "#FFC425", tertiaryColor: null },
  { mlbId: 137, mlbCode: "sfn", abbrev: "SF", brAbbrev: "SFG", league: "NL", division: "West", city: "San Francisco", nickname: "Giants", name: "San Francisco Giants", vsinSlug: "giants", dbSlug: "giants", anSlug: "san-francisco-giants", anLogoSlug: "sf", logoUrl: "https://www.mlbstatic.com/team-logos/137.svg", primaryColor: "#FD5A1E", secondaryColor: "#27251F", tertiaryColor: "#EFD19F" },
];

console.log(`[seed-mlb] Seeding ${teams.length} MLB teams...`);
let teamsInserted = 0, teamsUpdated = 0;

for (const t of teams) {
  const [existing] = await db.execute("SELECT id FROM mlb_teams WHERE dbSlug = ?", [t.dbSlug]);
  if (existing.length > 0) {
    await db.execute(
      `UPDATE mlb_teams SET mlbId=?, mlbCode=?, abbrev=?, brAbbrev=?, league=?, division=?,
       city=?, nickname=?, name=?, vsinSlug=?, anSlug=?, anLogoSlug=?, logoUrl=?,
       primaryColor=?, secondaryColor=?, tertiaryColor=?
       WHERE dbSlug=?`,
      [t.mlbId, t.mlbCode, t.abbrev, t.brAbbrev, t.league, t.division,
       t.city, t.nickname, t.name, t.vsinSlug, t.anSlug, t.anLogoSlug, t.logoUrl,
       t.primaryColor, t.secondaryColor, t.tertiaryColor ?? null, t.dbSlug]
    );
    teamsUpdated++;
  } else {
    await db.execute(
      `INSERT INTO mlb_teams (mlbId, mlbCode, abbrev, brAbbrev, league, division,
       city, nickname, name, vsinSlug, dbSlug, anSlug, anLogoSlug, logoUrl,
       primaryColor, secondaryColor, tertiaryColor)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.mlbId, t.mlbCode, t.abbrev, t.brAbbrev, t.league, t.division,
       t.city, t.nickname, t.name, t.vsinSlug, t.dbSlug, t.anSlug, t.anLogoSlug, t.logoUrl,
       t.primaryColor, t.secondaryColor, t.tertiaryColor ?? null]
    );
    teamsInserted++;
  }
}
console.log(`[seed-mlb] Teams: ${teamsInserted} inserted, ${teamsUpdated} updated`);

// ─── 2. Seed MLB Players ──────────────────────────────────────────────────────

/**
 * Players sourced from:
 *   - Baseball Reference active player list (brId)
 *   - MLB Stats API 2026/2025 season (mlbamId, position, bats, throws, currentTeam)
 *
 * isActive=true: confirmed in 2026 MLB Stats API active roster
 * isActive=false: found only in 2025 data — may be on IL, MiLB assignment, or retired
 *
 * currentTeamBrAbbrev uses BR team codes (KCR, TBD, FLA, OAK, etc.)
 */
const players = [
  // Active in 2026 (confirmed via MLB Stats API)
  { brId: "judgeaa01",  mlbamId: 592450, name: "Aaron Judge",          position: "Outfielder",        bats: "R", throws: "R", currentTeamBrAbbrev: "NYY", isActive: true },
  { brId: "nolaaa01",   mlbamId: 605400, name: "Aaron Nola",           position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "PHI", isActive: true },
  { brId: "nimmobr01",  mlbamId: 607043, name: "Brandon Nimmo",        position: "Outfielder",        bats: "L", throws: "R", currentTeamBrAbbrev: "TEX", isActive: true },
  { brId: "harpebr03",  mlbamId: 547180, name: "Bryce Harper",         position: "First Base",        bats: "L", throws: "R", currentTeamBrAbbrev: "PHI", isActive: true },
  { brId: "estevca01",  mlbamId: 608032, name: "Carlos Estévez",       position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "KCR", isActive: true },
  { brId: "salech01",   mlbamId: 519242, name: "Chris Sale",           position: "Pitcher",           bats: "L", throws: "L", currentTeamBrAbbrev: "ATL", isActive: true },
  { brId: "yelicch01",  mlbamId: 592885, name: "Christian Yelich",     position: "Outfielder",        bats: "L", throws: "R", currentTeamBrAbbrev: "MIL", isActive: true },
  { brId: "valdefr01",  mlbamId: 664285, name: "Framber Valdez",       position: "Pitcher",           bats: "R", throws: "L", currentTeamBrAbbrev: "DET", isActive: true },
  { brId: "lindofr01",  mlbamId: 596019, name: "Francisco Lindor",     position: "Shortstop",         bats: "S", throws: "R", currentTeamBrAbbrev: "NYM", isActive: true },
  { brId: "freemfr01",  mlbamId: 518692, name: "Freddie Freeman",      position: "First Base",        bats: "L", throws: "R", currentTeamBrAbbrev: "LAD", isActive: true },
  { brId: "colege01",   mlbamId: 543037, name: "Gerrit Cole",          position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "NYY", isActive: true },
  { brId: "degroja01",  mlbamId: 594798, name: "Jacob deGrom",         position: "Pitcher",           bats: "L", throws: "R", currentTeamBrAbbrev: "TEX", isActive: true },
  { brId: "irvinja01",  mlbamId: 663623, name: "Jake Irvin",           position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "WSN", isActive: true },
  { brId: "altuvjo01",  mlbamId: 514888, name: "Jose Altuve",          position: "Outfielder",        bats: "R", throws: "R", currentTeamBrAbbrev: "HOU", isActive: true },
  { brId: "quintjo01",  mlbamId: 500779, name: "Jose Quintana",        position: "Pitcher",           bats: "R", throws: "L", currentTeamBrAbbrev: "COL", isActive: true },
  { brId: "urquijo01",  mlbamId: 664353, name: "José Urquidy",         position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "PIT", isActive: true },
  { brId: "verlaju01",  mlbamId: 434378, name: "Justin Verlander",     position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "DET", isActive: true },
  { brId: "janseke01",  mlbamId: 445276, name: "Kenley Jansen",        position: "Pitcher",           bats: "S", throws: "R", currentTeamBrAbbrev: "DET", isActive: true },
  { brId: "yateski01",  mlbamId: 489446, name: "Kirby Yates",          position: "Pitcher",           bats: "L", throws: "R", currentTeamBrAbbrev: "ANA", isActive: true },
  { brId: "isbelky01",  mlbamId: 664728, name: "Kyle Isbel",           position: "Outfielder",        bats: "L", throws: "R", currentTeamBrAbbrev: "KCR", isActive: true },
  { brId: "machama01",  mlbamId: 592518, name: "Manny Machado",        position: "Third Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "SDP", isActive: true },
  { brId: "ozunama01",  mlbamId: 542303, name: "Marcell Ozuna",        position: "Designated Hitter", bats: "R", throws: "R", currentTeamBrAbbrev: "PIT", isActive: true },
  { brId: "olsonma02",  mlbamId: 621566, name: "Matt Olson",           position: "First Base",        bats: "L", throws: "R", currentTeamBrAbbrev: "ATL", isActive: true },
  { brId: "scherma01",  mlbamId: 453286, name: "Max Scherzer",         position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "TOR", isActive: true },
  { brId: "wachami01",  mlbamId: 608379, name: "Michael Wacha",        position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "KCR", isActive: true },
  { brId: "troutmi01",  mlbamId: 545361, name: "Mike Trout",           position: "Outfielder",        bats: "R", throws: "R", currentTeamBrAbbrev: "ANA", isActive: true },
  { brId: "yastrmi01",  mlbamId: 573262, name: "Mike Yastrzemski",     position: "Outfielder",        bats: "L", throws: "L", currentTeamBrAbbrev: "ATL", isActive: true },
  { brId: "bettsmo01",  mlbamId: 605141, name: "Mookie Betts",         position: "Shortstop",         bats: "R", throws: "R", currentTeamBrAbbrev: "LAD", isActive: true },
  { brId: "eovalna01",  mlbamId: 543135, name: "Nathan Eovaldi",       position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "TEX", isActive: true },
  { brId: "casteni01",  mlbamId: 592206, name: "Nick Castellanos",     position: "Outfielder",        bats: "R", throws: "R", currentTeamBrAbbrev: "SDP", isActive: true },
  { brId: "arenano01",  mlbamId: 571448, name: "Nolan Arenado",        position: "Third Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "ARI", isActive: true },
  { brId: "goldspa01",  mlbamId: 502671, name: "Paul Goldschmidt",     position: "First Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "NYY", isActive: true },
  { brId: "alonspe01",  mlbamId: 624413, name: "Pete Alonso",          position: "First Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "BAL", isActive: true },
  { brId: "iglesra01",  mlbamId: 628452, name: "Raisel Iglesias",      position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "ATL", isActive: true },
  { brId: "perezsa02",  mlbamId: 521692, name: "Salvador Perez",       position: "Catcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "KCR", isActive: true },
  { brId: "ohtansh01",  mlbamId: 660271, name: "Shohei Ohtani",        position: "Two-Way Player",    bats: "L", throws: "R", currentTeamBrAbbrev: "LAD", isActive: true },
  { brId: "turnetr01",  mlbamId: 607208, name: "Trea Turner",          position: "Shortstop",         bats: "R", throws: "R", currentTeamBrAbbrev: "PHI", isActive: true },
  { brId: "darviyu01",  mlbamId: 506433, name: "Yu Darvish",           position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "SDP", isActive: true },
  { brId: "eflinza01",  mlbamId: 621107, name: "Zach Eflin",           position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "BAL", isActive: true },
  { brId: "wheelza01",  mlbamId: 554430, name: "Zack Wheeler",         position: "Pitcher",           bats: "L", throws: "R", currentTeamBrAbbrev: "PHI", isActive: true },

  // Found in 2025 season data only — may be on IL, MiLB, or spring training
  { brId: "ottavad01",  mlbamId: 493603, name: "Adam Ottavino",        position: "Pitcher",           bats: "S", throws: "R", currentTeamBrAbbrev: "NYY", isActive: false },
  { brId: "mccutan01",  mlbamId: 457705, name: "Andrew McCutchen",     position: "Outfielder",        bats: "R", throws: "R", currentTeamBrAbbrev: "PIT", isActive: false },
  { brId: "quantca01",  mlbamId: 615698, name: "Cal Quantrill",        position: "Pitcher",           bats: "L", throws: "R", currentTeamBrAbbrev: "ATL", isActive: false },
  { brId: "vazquch01",  mlbamId: 543877, name: "Christian Vázquez",    position: "Catcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "MIN", isActive: false },
  { brId: "kimbrcr01",  mlbamId: 518886, name: "Craig Kimbrel",        position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "HOU", isActive: false },
  { brId: "lemahdj01",  mlbamId: 518934, name: "DJ LeMahieu",          position: "Second Base",       bats: "R", throws: "R", currentTeamBrAbbrev: "NYY", isActive: false },
  { brId: "urshegi01",  mlbamId: 570482, name: "Gio Urshela",          position: "Third Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "OAK", isActive: false },
  { brId: "nerishe01",  mlbamId: 593576, name: "Héctor Neris",         position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "HOU", isActive: false },
  { brId: "iglesjo01",  mlbamId: 600303, name: "Jose Iglesias",        position: "Shortstop",         bats: "R", throws: "R", currentTeamBrAbbrev: "NYM", isActive: false },
  { brId: "quijajo01",  mlbamId: 650671, name: "José Quijada",         position: "Pitcher",           bats: "L", throws: "L", currentTeamBrAbbrev: "ANA", isActive: false },
  { brId: "urenajo01",  mlbamId: 608566, name: "José Ureña",           position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "MIL", isActive: false },
  { brId: "turneju01",  mlbamId: 457759, name: "Justin Turner",        position: "First Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "CHC", isActive: false },
  { brId: "newmake01",  mlbamId: 621028, name: "Kevin Newman",         position: "Third Base",        bats: "R", throws: "R", currentTeamBrAbbrev: "ANA", isActive: false },
  { brId: "hendrky01",  mlbamId: 543294, name: "Kyle Hendricks",       position: "Pitcher",           bats: "R", throws: "R", currentTeamBrAbbrev: "ANA", isActive: false },
  { brId: "uriaslu01",  mlbamId: 666971, name: "Luis Urías",           position: "Second Base",       bats: "R", throws: "R", currentTeamBrAbbrev: "MIL", isActive: false },
];

console.log(`[seed-mlb] Seeding ${players.length} MLB players...`);
let playersInserted = 0, playersUpdated = 0;

for (const p of players) {
  const [existing] = await db.execute("SELECT id FROM mlb_players WHERE brId = ?", [p.brId]);
  if (existing.length > 0) {
    await db.execute(
      `UPDATE mlb_players SET mlbamId=?, name=?, position=?, bats=?, throws=?,
       currentTeamBrAbbrev=?, isActive=?, lastSyncedAt=?
       WHERE brId=?`,
      [p.mlbamId, p.name, p.position, p.bats, p.throws,
       p.currentTeamBrAbbrev, p.isActive ? 1 : 0, Date.now(), p.brId]
    );
    playersUpdated++;
  } else {
    await db.execute(
      `INSERT INTO mlb_players (brId, mlbamId, name, position, bats, throws,
       currentTeamBrAbbrev, isActive, lastSyncedAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [p.brId, p.mlbamId, p.name, p.position, p.bats, p.throws,
       p.currentTeamBrAbbrev, p.isActive ? 1 : 0, Date.now()]
    );
    playersInserted++;
  }
}
console.log(`[seed-mlb] Players: ${playersInserted} inserted, ${playersUpdated} updated`);

await db.end();
console.log("[seed-mlb] Done ✓");

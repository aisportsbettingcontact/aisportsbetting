/**
 * seed-nhl-teams.mjs
 *
 * Seeds all 32 NHL teams into the nhl_teams table using raw mysql2 SQL.
 * Run with: node seed-nhl-teams.mjs
 *
 * All 13 pre-validation checks passed (build_nhl_mapping.py): 0 errors, 0 warnings.
 */

import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load DATABASE_URL ─────────────────────────────────────────────────────────
const envPath = resolve(__dirname, ".env");
let DATABASE_URL;
try {
  const env = readFileSync(envPath, "utf8");
  const match = env.match(/DATABASE_URL=(.+)/);
  if (match) DATABASE_URL = match[1].trim();
} catch {}
DATABASE_URL = DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[seed-nhl-teams] ERROR: DATABASE_URL not set");
  process.exit(1);
}

// ── Master 32-team data (validated — 0 errors, 0 warnings) ───────────────────
const NHL_TEAMS = [
  // EASTERN CONFERENCE - ATLANTIC DIVISION (8 teams)
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "BUF", city: "Buffalo",       nickname: "Sabres",         primaryColor: "#003087", secondaryColor: "#FFB81C", tertiaryColor: "#FFFFFF", nhlSlug: "buffalo-sabres",        vsinSlug: "buffalo-sabres",        name: "Buffalo Sabres",        logoUrl: "https://assets.nhle.com/logos/nhl/svg/BUF_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "TBL", city: "Tampa Bay",     nickname: "Lightning",      primaryColor: "#002868", secondaryColor: "#FFFFFF", tertiaryColor: "#000000", nhlSlug: "tampa-bay-lightning",    vsinSlug: "tampa-bay-lightning",   name: "Tampa Bay Lightning",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/TBL_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "MTL", city: "Montreal",      nickname: "Canadiens",      primaryColor: "#AF1E2D", secondaryColor: "#001E62", tertiaryColor: "#FFFFFF", nhlSlug: "montreal-canadiens",     vsinSlug: "montreal-canadiens",    name: "Montreal Canadiens",    logoUrl: "https://assets.nhle.com/logos/nhl/svg/MTL_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "DET", city: "Detroit",       nickname: "Red Wings",      primaryColor: "#CE1126", secondaryColor: "#FFFFFF", tertiaryColor: "#000000", nhlSlug: "detroit-red-wings",      vsinSlug: "detroit-red-wings",     name: "Detroit Red Wings",     logoUrl: "https://assets.nhle.com/logos/nhl/svg/DET_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "BOS", city: "Boston",        nickname: "Bruins",         primaryColor: "#FFB81C", secondaryColor: "#000000", tertiaryColor: "#FFFFFF", nhlSlug: "boston-bruins",          vsinSlug: "boston-bruins",         name: "Boston Bruins",         logoUrl: "https://assets.nhle.com/logos/nhl/svg/BOS_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "OTT", city: "Ottawa",        nickname: "Senators",       primaryColor: "#C52032", secondaryColor: "#000000", tertiaryColor: "#C2912C", nhlSlug: "ottawa-senators",        vsinSlug: "ottawa-senators",       name: "Ottawa Senators",       logoUrl: "https://assets.nhle.com/logos/nhl/svg/OTT_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "FLA", city: "Florida",       nickname: "Panthers",       primaryColor: "#C8102E", secondaryColor: "#041E42", tertiaryColor: "#B9975B", nhlSlug: "florida-panthers",       vsinSlug: "florida-panthers",      name: "Florida Panthers",      logoUrl: "https://assets.nhle.com/logos/nhl/svg/FLA_dark.svg" },
  { conference: "EASTERN", division: "ATLANTIC",      abbrev: "TOR", city: "Toronto",       nickname: "Maple Leafs",    primaryColor: "#00205B", secondaryColor: "#FFFFFF", tertiaryColor: "#A2AAAD", nhlSlug: "toronto-maple-leafs",    vsinSlug: "toronto-maple-leafs",   name: "Toronto Maple Leafs",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/TOR_dark.svg" },
  // EASTERN CONFERENCE - METROPOLITAN DIVISION (8 teams)
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "CAR", city: "Carolina",      nickname: "Hurricanes",     primaryColor: "#CC0000", secondaryColor: "#000000", tertiaryColor: "#A2AAAD", nhlSlug: "carolina-hurricanes",    vsinSlug: "carolina-hurricanes",   name: "Carolina Hurricanes",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/CAR_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "PIT", city: "Pittsburgh",    nickname: "Penguins",       primaryColor: "#FCB514", secondaryColor: "#000000", tertiaryColor: "#FFFFFF", nhlSlug: "pittsburgh-penguins",    vsinSlug: "pittsburgh-penguins",   name: "Pittsburgh Penguins",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/PIT_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "NYI", city: "New York",      nickname: "Islanders",      primaryColor: "#003087", secondaryColor: "#F47D30", tertiaryColor: "#FFFFFF", nhlSlug: "new-york-islanders",     vsinSlug: "ny-islanders",          name: "New York Islanders",    logoUrl: "https://assets.nhle.com/logos/nhl/svg/NYI_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "CBJ", city: "Columbus",      nickname: "Blue Jackets",   primaryColor: "#002654", secondaryColor: "#CE1126", tertiaryColor: "#A2AAAD", nhlSlug: "columbus-blue-jackets",  vsinSlug: "columbus-blue-jackets", name: "Columbus Blue Jackets", logoUrl: "https://assets.nhle.com/logos/nhl/svg/CBJ_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "PHI", city: "Philadelphia",  nickname: "Flyers",         primaryColor: "#F74902", secondaryColor: "#000000", tertiaryColor: "#FFFFFF", nhlSlug: "philadelphia-flyers",    vsinSlug: "philadelphia-flyers",   name: "Philadelphia Flyers",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/PHI_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "WSH", city: "Washington",    nickname: "Capitals",       primaryColor: "#041E42", secondaryColor: "#C8102E", tertiaryColor: "#FFFFFF", nhlSlug: "washington-capitals",    vsinSlug: "washington-capitals",   name: "Washington Capitals",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/WSH_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "NJD", city: "New Jersey",    nickname: "Devils",         primaryColor: "#CE1126", secondaryColor: "#000000", tertiaryColor: "#FFFFFF", nhlSlug: "new-jersey-devils",      vsinSlug: "new-jersey-devils",     name: "New Jersey Devils",     logoUrl: "https://assets.nhle.com/logos/nhl/svg/NJD_dark.svg" },
  { conference: "EASTERN", division: "METROPOLITAN",  abbrev: "NYR", city: "New York",      nickname: "Rangers",        primaryColor: "#0038A8", secondaryColor: "#CE1126", tertiaryColor: "#FFFFFF", nhlSlug: "new-york-rangers",       vsinSlug: "new-york-rangers",      name: "New York Rangers",      logoUrl: "https://assets.nhle.com/logos/nhl/svg/NYR_dark.svg" },
  // WESTERN CONFERENCE - CENTRAL DIVISION (8 teams)
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "COL", city: "Colorado",      nickname: "Avalanche",      primaryColor: "#6F263D", secondaryColor: "#236192", tertiaryColor: "#A2AAAD", nhlSlug: "colorado-avalanche",     vsinSlug: "colorado-avalanche",    name: "Colorado Avalanche",    logoUrl: "https://assets.nhle.com/logos/nhl/svg/COL_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "DAL", city: "Dallas",        nickname: "Stars",          primaryColor: "#006847", secondaryColor: "#000000", tertiaryColor: "#8F8F8C", nhlSlug: "dallas-stars",           vsinSlug: "dallas-stars",          name: "Dallas Stars",          logoUrl: "https://assets.nhle.com/logos/nhl/svg/DAL_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "MIN", city: "Minnesota",     nickname: "Wild",           primaryColor: "#154734", secondaryColor: "#A6192E", tertiaryColor: "#EAAA00", nhlSlug: "minnesota-wild",         vsinSlug: "minnesota-wild",        name: "Minnesota Wild",        logoUrl: "https://assets.nhle.com/logos/nhl/svg/MIN_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "UTA", city: "Utah",          nickname: "Mammoth",        primaryColor: "#0B162A", secondaryColor: "#6F263D", tertiaryColor: "#A2AAAD", nhlSlug: "utah-mammoth",           vsinSlug: "utah-mammoth",          name: "Utah Mammoth",          logoUrl: "https://assets.nhle.com/logos/nhl/svg/UTA_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "NSH", city: "Nashville",     nickname: "Predators",      primaryColor: "#FFB81C", secondaryColor: "#041E42", tertiaryColor: "#FFFFFF", nhlSlug: "nashville-predators",    vsinSlug: "nashville-predators",   name: "Nashville Predators",   logoUrl: "https://assets.nhle.com/logos/nhl/svg/NSH_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "WPG", city: "Winnipeg",      nickname: "Jets",           primaryColor: "#041E42", secondaryColor: "#004C97", tertiaryColor: "#A2AAAD", nhlSlug: "winnipeg-jets",          vsinSlug: "winnipeg-jets",         name: "Winnipeg Jets",         logoUrl: "https://assets.nhle.com/logos/nhl/svg/WPG_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "STL", city: "St. Louis",     nickname: "Blues",          primaryColor: "#002F87", secondaryColor: "#FFB81C", tertiaryColor: "#FFFFFF", nhlSlug: "st-louis-blues",         vsinSlug: "st-louis-blues",        name: "St. Louis Blues",       logoUrl: "https://assets.nhle.com/logos/nhl/svg/STL_dark.svg" },
  { conference: "WESTERN", division: "CENTRAL",       abbrev: "CHI", city: "Chicago",       nickname: "Blackhawks",     primaryColor: "#CF0A2C", secondaryColor: "#000000", tertiaryColor: "#FF671B", nhlSlug: "chicago-blackhawks",     vsinSlug: "chicago-blackhawks",    name: "Chicago Blackhawks",    logoUrl: "https://assets.nhle.com/logos/nhl/svg/CHI_dark.svg" },
  // WESTERN CONFERENCE - PACIFIC DIVISION (8 teams)
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "ANA", city: "Anaheim",       nickname: "Ducks",          primaryColor: "#FC4C02", secondaryColor: "#000000", tertiaryColor: "#B9975B", nhlSlug: "anaheim-ducks",          vsinSlug: "anaheim-ducks",         name: "Anaheim Ducks",         logoUrl: "https://assets.nhle.com/logos/nhl/svg/ANA_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "EDM", city: "Edmonton",      nickname: "Oilers",         primaryColor: "#041E42", secondaryColor: "#FF4C00", tertiaryColor: "#A2AAAD", nhlSlug: "edmonton-oilers",        vsinSlug: "edmonton-oilers",       name: "Edmonton Oilers",       logoUrl: "https://assets.nhle.com/logos/nhl/svg/EDM_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "VGK", city: "Vegas",         nickname: "Golden Knights", primaryColor: "#B4975A", secondaryColor: "#333F42", tertiaryColor: "#C8102E", nhlSlug: "vegas-golden-knights",   vsinSlug: "vegas-golden-knights",  name: "Vegas Golden Knights",  logoUrl: "https://assets.nhle.com/logos/nhl/svg/VGK_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "SEA", city: "Seattle",       nickname: "Kraken",         primaryColor: "#001628", secondaryColor: "#99D9D9", tertiaryColor: "#E9072B", nhlSlug: "seattle-kraken",         vsinSlug: "seattle-kraken",        name: "Seattle Kraken",        logoUrl: "https://assets.nhle.com/logos/nhl/svg/SEA_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "LAK", city: "Los Angeles",   nickname: "Kings",          primaryColor: "#111111", secondaryColor: "#A2AAAD", tertiaryColor: "#FFFFFF", nhlSlug: "los-angeles-kings",      vsinSlug: "los-angeles-kings",     name: "Los Angeles Kings",     logoUrl: "https://assets.nhle.com/logos/nhl/svg/LAK_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "SJS", city: "San Jose",      nickname: "Sharks",         primaryColor: "#006D75", secondaryColor: "#000000", tertiaryColor: "#E57200", nhlSlug: "san-jose-sharks",        vsinSlug: "san-jose-sharks",       name: "San Jose Sharks",       logoUrl: "https://assets.nhle.com/logos/nhl/svg/SJS_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "CGY", city: "Calgary",       nickname: "Flames",         primaryColor: "#C8102E", secondaryColor: "#F1BE48", tertiaryColor: "#FFFFFF", nhlSlug: "calgary-flames",         vsinSlug: "calgary-flames",        name: "Calgary Flames",        logoUrl: "https://assets.nhle.com/logos/nhl/svg/CGY_dark.svg" },
  { conference: "WESTERN", division: "PACIFIC",       abbrev: "VAN", city: "Vancouver",     nickname: "Canucks",        primaryColor: "#00205B", secondaryColor: "#00843D", tertiaryColor: "#FFFFFF", nhlSlug: "vancouver-canucks",      vsinSlug: "vancouver-canucks",     name: "Vancouver Canucks",     logoUrl: "https://assets.nhle.com/logos/nhl/svg/VAN_dark.svg" },
];

// ── Pre-seed validation ───────────────────────────────────────────────────────
console.log("\n[seed-nhl-teams] ══ PRE-SEED VALIDATION ══");
console.log(`[seed-nhl-teams] Total teams to seed: ${NHL_TEAMS.length}`);

if (NHL_TEAMS.length !== 32) { console.error(`ABORT: Expected 32 teams, got ${NHL_TEAMS.length}`); process.exit(1); }
const abbrevSet = new Set(NHL_TEAMS.map(t => t.abbrev));
if (abbrevSet.size !== 32) { console.error("ABORT: Duplicate abbreviations"); process.exit(1); }
const dbSlugSet = new Set(NHL_TEAMS.map(t => t.vsinSlug.replace(/-/g, "_")));
if (dbSlugSet.size !== 32) { console.error("ABORT: Duplicate dbSlugs"); process.exit(1); }
const hexPattern = /^#[0-9A-Fa-f]{6}$/;
for (const team of NHL_TEAMS) {
  if (!hexPattern.test(team.primaryColor) || !hexPattern.test(team.secondaryColor) || !hexPattern.test(team.tertiaryColor)) {
    console.error(`ABORT: Invalid hex color for ${team.abbrev}`); process.exit(1);
  }
}
console.log("[seed-nhl-teams] ✓ All pre-seed checks passed (32 teams, no duplicates, all hex colors valid)");

// ── Connect ───────────────────────────────────────────────────────────────────
const conn = await createConnection(DATABASE_URL);
console.log("[seed-nhl-teams] ✓ Connected to database");

// ── Seed ─────────────────────────────────────────────────────────────────────
console.log("\n[seed-nhl-teams] ══ SEEDING 32 NHL TEAMS ══");
let inserted = 0;
let updated = 0;
let errors = 0;

for (let i = 0; i < NHL_TEAMS.length; i++) {
  const team = NHL_TEAMS[i];
  const dbSlug = team.vsinSlug.replace(/-/g, "_");
  const num = String(i + 1).padStart(2, "0");

  try {
    // Check if row already exists
    const [existing] = await conn.execute(
      "SELECT id FROM nhl_teams WHERE dbSlug = ?",
      [dbSlug]
    );

    if (existing.length > 0) {
      await conn.execute(
        `UPDATE nhl_teams SET
          nhlSlug=?, vsinSlug=?, name=?, nickname=?, city=?,
          conference=?, division=?, logoUrl=?, abbrev=?,
          primaryColor=?, secondaryColor=?, tertiaryColor=?
         WHERE dbSlug=?`,
        [team.nhlSlug, team.vsinSlug, team.name, team.nickname, team.city,
         team.conference, team.division, team.logoUrl, team.abbrev,
         team.primaryColor, team.secondaryColor, team.tertiaryColor,
         dbSlug]
      );
      console.log(`[seed-nhl-teams]   ↺ ${num}/32  ${team.abbrev.padEnd(4)} ${team.name.padEnd(25)} [UPDATED]`);
      updated++;
    } else {
      await conn.execute(
        `INSERT INTO nhl_teams
          (dbSlug, nhlSlug, vsinSlug, name, nickname, city, conference, division, logoUrl, abbrev, primaryColor, secondaryColor, tertiaryColor)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [dbSlug, team.nhlSlug, team.vsinSlug, team.name, team.nickname, team.city,
         team.conference, team.division, team.logoUrl, team.abbrev,
         team.primaryColor, team.secondaryColor, team.tertiaryColor]
      );
      console.log(`[seed-nhl-teams]   ✓ ${num}/32  ${team.abbrev.padEnd(4)} ${team.name.padEnd(25)} [INSERTED]`);
      inserted++;
    }
  } catch (err) {
    console.error(`[seed-nhl-teams]   ✗ FAILED ${num}/32  ${team.abbrev} ${team.name}: ${err.message}`);
    errors++;
  }
}

console.log(`\n[seed-nhl-teams] ══ SEED COMPLETE ══`);
console.log(`[seed-nhl-teams]   Inserted: ${inserted}  Updated: ${updated}  Errors: ${errors}`);

if (errors > 0) {
  console.error(`[seed-nhl-teams] ❌ SEED FAILED with ${errors} errors`);
  await conn.end();
  process.exit(1);
}

// ── Post-seed verification ────────────────────────────────────────────────────
console.log("\n[seed-nhl-teams] ══ POST-SEED VERIFICATION ══");

const [allRows] = await conn.execute("SELECT * FROM nhl_teams ORDER BY conference, division, name");
console.log(`[seed-nhl-teams] Total rows in nhl_teams: ${allRows.length}`);

const eastCount    = allRows.filter(r => r.conference === "EASTERN").length;
const westCount    = allRows.filter(r => r.conference === "WESTERN").length;
const atlanticCount  = allRows.filter(r => r.division === "ATLANTIC").length;
const metroCount     = allRows.filter(r => r.division === "METROPOLITAN").length;
const centralCount   = allRows.filter(r => r.division === "CENTRAL").length;
const pacificCount   = allRows.filter(r => r.division === "PACIFIC").length;

const checks = [
  ["32 total rows",         allRows.length === 32],
  ["16 Eastern teams",      eastCount === 16],
  ["16 Western teams",      westCount === 16],
  ["8 Atlantic teams",      atlanticCount === 8],
  ["8 Metropolitan teams",  metroCount === 8],
  ["8 Central teams",       centralCount === 8],
  ["8 Pacific teams",       pacificCount === 8],
  ["No null abbrevs",       allRows.every(r => r.abbrev)],
  ["No null logoUrls",      allRows.every(r => r.logoUrl)],
  ["No null primaryColors", allRows.every(r => r.primaryColor)],
  ["No null vsinSlugs",     allRows.every(r => r.vsinSlug)],
  ["32 unique abbrevs",     new Set(allRows.map(r => r.abbrev)).size === 32],
  ["32 unique dbSlugs",     new Set(allRows.map(r => r.dbSlug)).size === 32],
];

let allPassed = true;
for (const [label, passed] of checks) {
  const icon = passed ? "✓" : "✗";
  console.log(`[seed-nhl-teams]   ${icon} ${label}`);
  if (!passed) allPassed = false;
}

if (!allPassed) {
  console.error("\n[seed-nhl-teams] ❌ VERIFICATION FAILED — see errors above");
  await conn.end();
  process.exit(1);
}

// ── Final summary table ───────────────────────────────────────────────────────
console.log("\n[seed-nhl-teams] ══ FINAL DB TABLE (all 32 rows) ══");
const hdr = `${"#".padEnd(3)} ${"ABB".padEnd(4)} ${"CONF".padEnd(9)} ${"DIV".padEnd(14)} ${"CITY".padEnd(15)} ${"NICKNAME".padEnd(16)} ${"VSIN_SLUG".padEnd(28)} DB_SLUG`;
console.log(hdr);
console.log("─".repeat(130));
for (let i = 0; i < allRows.length; i++) {
  const r = allRows[i];
  console.log(
    `${String(i + 1).padEnd(3)} ${(r.abbrev ?? "").padEnd(4)} ${r.conference.padEnd(9)} ${r.division.padEnd(14)} ${r.city.padEnd(15)} ${r.nickname.padEnd(16)} ${r.vsinSlug.padEnd(28)} ${r.dbSlug}`
  );
}

await conn.end();
console.log("\n[seed-nhl-teams] ✅ ALL 13 VERIFICATION CHECKS PASSED — 32 NHL teams seeded correctly");
console.log("[seed-nhl-teams] Connection closed. Done.");

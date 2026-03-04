/**
 * fixTeamSlugs.mjs
 * 
 * Fetches all NCAAM teams from ESPN API, matches the WagerTalk display names
 * to ESPN slugs, then updates the games table for 2026-03-04 with proper slugs.
 * Also outputs a list of ESPN IDs to add to the static map.
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

// ── WagerTalk name → ESPN slug manual overrides ──────────────────────────────
// These handle cases where the WagerTalk name doesn't match ESPN's displayName
const MANUAL_MAP = {
  // Regular season
  "Creighton": "creighton",
  "Butler": "butler",
  "Minnesota": "minnesota",
  "Indiana": "indiana",
  "Fordham": "fordham",
  "La Salle": "la_salle",
  "Texas": "texas",
  "Arkansas": "arkansas",
  "Marquette": "marquette",
  "Providence": "providence",
  "Duquesne": "duquesne",
  "Rhode Island": "rhode_island",
  "California": "california",
  "Georgia Tech": "georgia_tech",
  "UAB": "uab",
  "Charlotte": "charlotte",
  "St. Joseph's": "st_josephs",
  "Davidson": "davidson",
  "Miami Florida": "miami_fl",
  "SMU": "smu",
  "St. Bonaventure": "st_bonaventure",
  "George Washington": "george_washington",
  "Ohio State": "ohio_state",
  "Penn State": "penn_state",
  "Villanova": "villanova",
  "DePaul": "depaul",
  "Maryland": "maryland",
  "Wisconsin": "wisconsin",
  "Rice": "rice",
  "North Texas": "north_texas",
  "Loyola Chicago": "loyola_chicago",
  "Saint Louis": "saint_louis",
  "Purdue": "purdue",
  "Northwestern": "northwestern",
  "Stanford": "stanford",
  "Notre Dame": "notre_dame",
  "Baylor": "baylor",
  "Houston": "houston",
  "Florida State": "florida_state",
  "Pittsburgh": "pittsburgh",
  "Colorado State": "colorado_state",
  "New Mexico": "new_mexico",
  "USC": "usc",
  "Washington": "washington",
  // Conference tournaments
  "UL Lafayette": "louisiana",
  "James Madison": "james_madison",
  "Georgia Southern": "georgia_southern",
  "Eastern Illinois": "eastern_illinois",
  "SIU Edwardsville": "siu_edwardsville",
  "Little Rock": "little_rock",
  "Lindenwood": "lindenwood",
  "UMKC": "umkc",
  "Oral Roberts": "oral_roberts",
  "Northern Kentucky": "northern_kentucky",
  "Oakland": "oakland",
  "Milwaukee": "milwaukee",
  "Detroit Mercy": "detroit_mercy",
  "Youngstown State": "youngstown_state",
  "Robert Morris": "robert_morris",
  "Cleveland State": "cleveland_state",
  "Wright State": "wright_state",
  "Jacksonville": "jacksonville",
  "Bellarmine": "bellarmine",
  "North Alabama": "north_alabama",
  "Florida Gulf Coast": "florida_gulf_coast",
  "Stetson": "stetson",
  "Eastern Kentucky": "eastern_kentucky",
  "North Florida": "north_florida",
  "West Georgia": "west_georgia",
  "Gardner Webb": "gardner_webb",
  "South Carolina Upstate": "south_carolina_upstate",
  "Stonehill": "stonehill",
  "Le Moyne": "le_moyne",
  "Fairleigh Dickinson": "fairleigh_dickinson",
  "Mercyhurst": "mercyhurst",
  "Wagner": "wagner",
  "Central Connecticut": "central_connecticut",
  "Chicago State": "chicago_state",
  "Long Island": "liu",
  "TBD": null,
};

// ── Fetch ESPN teams ──────────────────────────────────────────────────────────
async function fetchEspnTeams() {
  const url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=600";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`ESPN API ${res.status}`);
  const data = await res.json();
  const league = data.sports?.[0]?.leagues?.[0];
  return (league?.teams ?? []).map(t => ({
    displayName: t.team.displayName,
    shortName: t.team.shortDisplayName,
    espnId: t.team.id,
    abbreviation: t.team.abbreviation,
  }));
}

// ── Normalize for fuzzy matching ──────────────────────────────────────────────
function normalize(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
const espnTeams = await fetchEspnTeams();
console.log(`Fetched ${espnTeams.length} ESPN teams`);

// Build lookup maps
const byDisplayName = {};
const byNormalized = {};
for (const t of espnTeams) {
  byDisplayName[t.displayName] = t;
  byNormalized[normalize(t.displayName)] = t;
  byNormalized[normalize(t.shortName)] = t;
}

// Map each WagerTalk name to an ESPN team
const slugToEspnId = {};
const missing = [];

for (const [wtName, slug] of Object.entries(MANUAL_MAP)) {
  if (!slug) continue;
  
  // Try to find the ESPN team for this slug to get the ESPN ID
  // We'll search by normalized display name matching the slug
  let found = null;
  
  // Try direct display name match first
  for (const t of espnTeams) {
    const normalized = normalize(t.displayName);
    // Convert slug back to words for matching
    const slugWords = slug.replace(/_/g, ' ');
    if (normalized.includes(slugWords) || slugWords.includes(normalized.split(' ')[0])) {
      // Check if the WagerTalk name matches this ESPN team
      const wtNorm = normalize(wtName);
      if (normalized.includes(wtNorm) || wtNorm.includes(normalize(t.shortName))) {
        found = t;
        break;
      }
    }
  }
  
  // Fallback: direct normalized match on WagerTalk name
  if (!found) {
    const wtNorm = normalize(wtName);
    found = byNormalized[wtNorm];
  }
  
  // Another fallback: partial match
  if (!found) {
    const wtNorm = normalize(wtName);
    for (const t of espnTeams) {
      if (normalize(t.displayName).startsWith(wtNorm) || normalize(t.shortName) === wtNorm) {
        found = t;
        break;
      }
    }
  }
  
  if (found) {
    slugToEspnId[slug] = found.espnId;
    console.log(`  ✓ ${wtName} → ${slug} (ESPN ID: ${found.espnId}, "${found.displayName}")`);
  } else {
    missing.push({ wtName, slug });
    console.log(`  ✗ ${wtName} → ${slug} (NOT FOUND in ESPN)`);
  }
}

if (missing.length > 0) {
  console.log(`\nMissing ${missing.length} teams from ESPN:`);
  missing.forEach(m => console.log(`  - ${m.wtName} (${m.slug})`));
}

// ── Update games table ────────────────────────────────────────────────────────
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all March 4 games
const [games] = await conn.execute(
  "SELECT id, awayTeam, homeTeam FROM games WHERE gameDate = '2026-03-04'"
);

let updated = 0;
for (const game of games) {
  const awaySlug = MANUAL_MAP[game.awayTeam];
  const homeSlug = MANUAL_MAP[game.homeTeam];
  
  if (awaySlug !== undefined || homeSlug !== undefined) {
    const newAway = awaySlug !== undefined ? (awaySlug ?? game.awayTeam) : game.awayTeam;
    const newHome = homeSlug !== undefined ? (homeSlug ?? game.homeTeam) : game.homeTeam;
    
    if (newAway !== game.awayTeam || newHome !== game.homeTeam) {
      await conn.execute(
        "UPDATE games SET awayTeam = ?, homeTeam = ? WHERE id = ?",
        [newAway, newHome, game.id]
      );
      updated++;
      console.log(`  Updated: ${game.awayTeam} → ${newAway}, ${game.homeTeam} → ${newHome}`);
    }
  }
}

console.log(`\nUpdated ${updated} game records with ESPN slugs.`);

// ── Output missing ESPN IDs for the static map ────────────────────────────────
console.log('\n=== ESPN IDs to add to espnTeamIds.ts ===');
const existingSlugs = new Set([
  'baylor','butler','cleveland_state','colorado_state','davidson','depaul',
  'la_salle','marquette','oral_roberts','purdue','stanford','usc','villanova',
  // already in map - add more as needed
]);

for (const [slug, espnId] of Object.entries(slugToEspnId)) {
  if (!existingSlugs.has(slug)) {
    console.log(`  ${slug}: "${espnId}",`);
  }
}

await conn.end();

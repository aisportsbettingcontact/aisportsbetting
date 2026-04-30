/**
 * audit-abbrevs.mjs
 * Fetches MLB Stats API abbreviations for a range of dates and compares
 * them against the AN abbreviations stored in the DB to find all mismatches.
 */
import 'dotenv/config';

const dates = [
  '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28',
  '2026-04-01', '2026-04-05', '2026-04-10', '2026-04-15',
  '2026-04-20', '2026-04-22', '2026-04-25', '2026-04-26', '2026-04-27',
];

const apiAbbrevs = new Map(); // fullName → apiAbbrev

for (const date of dates) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team`;
  const res = await fetch(url);
  if (!res.ok) { console.log(`[WARN] ${date}: HTTP ${res.status}`); continue; }
  const json = await res.json();
  const games = json.dates?.[0]?.games ?? [];
  for (const g of games) {
    const awayAbbr = g.teams.away.team.abbreviation;
    const homeAbbr = g.teams.home.team.abbreviation;
    const awayName = g.teams.away.team.name;
    const homeName = g.teams.home.team.name;
    if (awayAbbr && awayName) apiAbbrevs.set(awayName, awayAbbr);
    if (homeAbbr && homeName) apiAbbrevs.set(homeName, homeAbbr);
  }
}

console.log('\n[OUTPUT] MLB Stats API abbreviations:');
const sorted = [...apiAbbrevs.entries()].sort((a, b) => a[1].localeCompare(b[1]));
for (const [name, abbr] of sorted) {
  console.log(`  ${abbr.padEnd(5)} = ${name}`);
}

// Known AN abbreviations (from mlbTeams.ts)
const AN_ABBREVS = [
  'ARI','ATL','BAL','BOS','CHC','CWS','CIN','CLE','COL','DET',
  'HOU','KC','LAA','LAD','MIA','MIL','MIN','NYM','NYY','ATH',
  'PHI','PIT','SD','SF','SEA','STL','TB','TEX','TOR','WSH'
];

console.log('\n[AUDIT] Checking for mismatches between AN and MLB Stats API:');
let mismatches = 0;
for (const [name, apiAbbr] of sorted) {
  // Find the AN abbrev for this team by matching partial name
  const anMatch = AN_ABBREVS.find(a => {
    // Simple heuristic: check if the API abbrev matches the AN abbrev
    return a === apiAbbr;
  });
  if (!anMatch) {
    console.log(`  [MISMATCH] API="${apiAbbr}" (${name}) — not found in AN list`);
    mismatches++;
  }
}
if (mismatches === 0) {
  console.log('  All API abbreviations match AN abbreviations — no mismatches found');
} else {
  console.log(`\n  Total mismatches: ${mismatches}`);
}

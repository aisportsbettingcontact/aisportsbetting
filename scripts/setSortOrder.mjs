/**
 * setSortOrder.mjs
 * Sets sortOrder on all 41 March 4 games to match the WagerTalk website display order.
 * Order is derived from the WagerTalk odds page (sport=L4) for 03/04.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// WagerTalk order: [awayTeam_slug, homeTeam_slug, sortOrder]
// Slugs must match the awayTeam / homeTeam values stored in the DB.
const ORDER = [
  // 3:00p
  ['creighton',          'butler',              1],
  // 3:30p
  ['minnesota',          'indiana',             2],
  ['fordham',            'la_salle',            3],
  // 4:00p
  ['texas',              'arkansas',            4],
  ['marquette',          'providence',          5],
  ['duquesne',           'rhode_island',        6],
  ['california',         'georgia_tech',        7],
  ['uab',                'charlotte',           8],
  ['st_josephs',         'davidson',            9],
  ['miami_florida',      'smu',                 10],
  ['st_bonaventure',     'george_washington',   11],
  // 4:30p
  ['ohio_state',         'penn_state',          12],
  // 5:00p
  ['villanova',          'depaul',              13],
  ['maryland',           'wisconsin',           14],
  ['rice',               'north_texas',         15],
  ['loyola_chicago',     'saint_louis',         16],
  // 5:30p
  ['purdue',             'northwestern',        17],
  // 6:00p
  ['stanford',           'notre_dame',          18],
  ['baylor',             'houston',             19],
  ['florida_state',      'pittsburgh',          20],
  // 7:00p
  ['colorado_state',     'new_mexico',          21],
  // 7:30p
  ['usc',                'washington',          22],
  // 3:00p (Sun Belt)
  ['ul_lafayette',       'james_madison',       23],
  // 5:30p (Sun Belt)
  ['georgia_southern',   'georgia_southern',    24], // bye/placeholder — will match by home only
  // 4:00p (OVC)
  ['eastern_illinois',   'siu_edwardsville',    25],
  // 6:30p
  ['little_rock',        'lindenwood',          26],
  // 5:00p (Summit)
  ['umkc',               'oral_roberts',        27],
  // 4:00p (Horizon)
  ['northern_kentucky',  'oakland',             28],
  ['milwaukee',          'detroit_mercy',       29],
  // 4:00p (Horizon)
  ['youngstown_state',   'robert_morris',       30],
  ['cleveland_state',    'wright_state',        31],
  // 9:00a (ASUN)
  ['jacksonville',       'bellarmine',          32],
  // 11:30a
  ['north_alabama',      'florida_gulf_coast',  33],
  // 2:00p
  ['stetson',            'eastern_kentucky',    34],
  // 4:30p
  ['north_florida',      'west_georgia',        35],
  ['gardner_webb',       'south_carolina_upstate', 36],
  // 4:00p (NEC)
  ['stonehill',          'le_moyne',            37],
  ['fairleigh_dickinson','mercyhurst',          38],
  ['wagner',             'central_connecticut', 39],
  // 4:00p
  ['chicago_state',      'long_island',         40],
];

// First, show what's in the DB so we can match slugs
const [rows] = await conn.execute(
  "SELECT id, awayTeam, homeTeam, startTimeEst FROM games WHERE gameDate = '2026-03-04' ORDER BY id"
);
console.log(`Found ${rows.length} games for 2026-03-04`);

let updated = 0;
let unmatched = [];

for (const [awaySlug, homeSlug, order] of ORDER) {
  // Try exact match first
  const match = rows.find(r =>
    r.awayTeam === awaySlug && r.homeTeam === homeSlug
  );
  if (match) {
    await conn.execute('UPDATE games SET sortOrder = ? WHERE id = ?', [order, match.id]);
    updated++;
  } else {
    // Try matching by just home team (for cases like georgia_southern with no away)
    const homeOnly = rows.find(r => r.homeTeam === homeSlug);
    if (homeOnly) {
      await conn.execute('UPDATE games SET sortOrder = ? WHERE id = ?', [order, homeOnly.id]);
      updated++;
    } else {
      // Try partial slug match (e.g. smu vs miami_florida)
      const partial = rows.find(r =>
        (r.awayTeam.includes(awaySlug) || awaySlug.includes(r.awayTeam)) &&
        (r.homeTeam.includes(homeSlug) || homeSlug.includes(r.homeTeam))
      );
      if (partial) {
        await conn.execute('UPDATE games SET sortOrder = ? WHERE id = ?', [order, partial.id]);
        updated++;
      } else {
        unmatched.push({ awaySlug, homeSlug, order });
      }
    }
  }
}

console.log(`\nUpdated: ${updated} / ${ORDER.length}`);
if (unmatched.length > 0) {
  console.log('\nUnmatched (will need manual review):');
  console.table(unmatched);
  
  // Show all DB slugs to help debug
  console.log('\nAll DB team slugs:');
  rows.forEach(r => console.log(`  id=${r.id} away="${r.awayTeam}" home="${r.homeTeam}" time=${r.startTimeEst}`));
}

await conn.end();

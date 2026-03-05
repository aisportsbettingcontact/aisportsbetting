/**
 * backfill_start_times.mjs
 * Backfills startTimeEst for TBD games by matching NCAA seonames to DB slugs.
 * Handles both _st and _state slug forms since VSiN uses both.
 * 
 * Run: node scripts/backfill_start_times.mjs
 */

import { readFileSync } from 'fs';
import mysql from 'mysql2/promise';

// Load env
try {
  const envContent = readFileSync('/home/ubuntu/ai-sports-betting/.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const NCAA_API = 'https://sdataprod.ncaa.com/';
const GET_CONTESTS_SHA = '7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c';

// NCAA seoname (after hyphen->underscore) -> DB slug
// Only entries that differ from the default conversion are listed.
const NCAA_ALIAS = {
  // _st -> _state (VSiN uses _state for these)
  michigan_st:         'michigan_state',
  ohio_st:             'ohio_state',
  penn_st:             'penn_state',
  iowa_st:             'iowa_state',
  florida_st:          'florida_state',
  colorado_st:         'colorado_state',
  kansas_st:           'kansas_state',
  oklahoma_st:         'oklahoma_state',
  oregon_st:           'oregon_state',
  washington_st:       'washington_state',
  utah_st:             'utah_state',
  arizona_st:          'arizona_state',
  boise_st:            'boise_state',
  fresno_st:           'fresno_state',
  san_diego_st:        'san_diego_state',
  san_jose_st:         'san_jose_state',
  wichita_st:          'wichita_state',
  illinois_st:         'illinois_state',
  indiana_st:          'indiana_state',
  idaho_st:            'idaho_state',
  montana_st:          'montana_state',
  north_dakota_st:     'n_dakota_st',
  south_dakota_st:     's_dakota_st',
  south_carolina_st:   's_carolina_st',
  tennessee_st:        'tennessee_state',
  mississippi_st:      'mississippi_state',
  missouri_st:         'missouri_state',
  murray_st:           'murray_state',
  morehead_st:         'morehead_state',
  jackson_st:          'jackson_state',
  norfolk_st:          'norfolk_state',
  morgan_st:           'morgan_state',
  savannah_st:         'savannah_state',
  kennesaw_st:         'kennesaw_state',
  jacksonville_st:     'jacksonville_state',
  sam_houston_st:      'sam_houston_state',
  tarleton_st:         'tarleton_state',
  texas_st:            'texas_state',
  new_mexico_st:       'new_mexico_state',
  portland_st:         'portland_state',
  sacramento_st:       'sacramento_state',
  weber_st:            'weber_state',
  youngstown_st:       'youngstown_state',
  wright_st:           'wright_state',
  cleveland_st:        'cleveland_state',
  chicago_st:          'chicago_state',
  georgia_st:          'georgia_state',
  long_beach_st:       'long_beach_state',
  kent_st:             'kent_state',
  pittsburg_st:        'pittsburg_state',
  fort_hays_st:        'fort_hays_state',
  nicholls_st:         'nicholls_state',
  north_carolina_st:   'nc_state',
  southeast_mo_st:     'se_missouri_st',
  northwest_mo_st:     'northwest_missouri_state',
  northwestern_st:     'northwestern_state',
  west_virginia_st:    'west_virginia_state',
  wayne_st_mi:         'wayne_state',
  // Institutional abbreviations
  ualr:                'little_rock',
  fgcu:                'florida_gulf_coast',
  fdu:                 'fairleigh_dickinson',
  usc_upstate:         'south_carolina_upstate',
  long_island:         'liu',
  lindenwood_mo:       'lindenwood',
  central_conn_st:     'central_connecticut',
  // Geographic abbreviations
  north_ala:           'north_alabama',
  southern_ill:        's_illinois',
  southern_california: 'usc',
  south_fla:           'south_florida',
  ga_southern:         'georgia_southern',
  // Display name differences
  detroit:             'detroit_mercy',
  saint_josephs:       'st_josephs',
  humboldt_st:         'cal_poly_humboldt',
  // NCAA full seoname -> DB abbreviated slug
  middle_tenn:         'middle_tenn_st',
  ut_martin:           'tennessee_martin',
  md_east_shore:       'md_e_shore',
  mississippi_val:     'miss_valley_st',
  western_ky:          'w_kentucky',
  prairie_view:        'prairie_view_a_and_m',
  grambling:           'grambling_st',
  uni:                 'n_iowa',
  alcorn:              'alcorn_st',
  cal_st_northridge:   'csu_northridge',
  bakersfield:         'csu_bakersfield',
  cal_st_fullerton:    'csu_fullerton',
  arkansas_st:         'arkansas_state',
  alabama_am:          'alabama_a_and_m',
  alabama_st:          'alabama_state',
  south_utah:          'southern_utah',
  coppin_st:           'coppin_state',
  delaware_st:         'delaware_state',
  florida_am:          'florida_a_and_m',
};

function seonameToSlug(s) {
  return s.replace(/-/g, '_').toLowerCase();
}

function ncaaSlugToDb(seoname) {
  const slug = seonameToSlug(seoname);
  return NCAA_ALIAS[slug] ?? slug;
}

/**
 * Check if two team slugs refer to the same team.
 * Handles both _st and _state variants since VSiN uses both.
 */
function slugsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Normalize: _state <-> _st
  const norm = s => s.replace(/_state$/, '_st');
  if (norm(a) === norm(b)) return true;
  // Also check _st -> full form
  const expand = s => {
    const m = s.match(/^(.+)_st$/);
    if (m) return m[1] + '_state';
    return s;
  };
  if (expand(a) === b || a === expand(b)) return true;
  return false;
}

function epochToEst(epochSec) {
  const d = new Date(epochSec * 1000);
  const estH = ((d.getUTCHours() - 5) + 24) % 24;
  const ampm = estH >= 12 ? 'PM' : 'AM';
  const h12 = estH % 12 || 12;
  const min = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h12}:${min} ${ampm} ET`;
}

async function fetchNcaaGames(yyyymmdd) {
  const mm = yyyymmdd.slice(4, 6);
  const dd = yyyymmdd.slice(6, 8);
  const yyyy = yyyymmdd.slice(0, 4);
  const contestDate = `${mm}/${dd}/${yyyy}`;
  const seasonYear = parseInt(yyyy) - 1;
  
  const variables = { sportCode: 'MBB', divisionId: 1, contestDate, seasonYear };
  const extensions = { persistedQuery: { version: 1, sha256Hash: GET_CONTESTS_SHA } };
  const url = NCAA_API + '?variables=' + encodeURIComponent(JSON.stringify(variables)) + '&extensions=' + encodeURIComponent(JSON.stringify(extensions));
  
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Origin: 'https://www.ncaa.com',
      Referer: 'https://www.ncaa.com/',
      Accept: 'application/json',
    }
  });
  
  const data = await resp.json();
  return data?.data?.contests ?? [];
}

function dateRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    dates.push(`${y}${m}${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Process the next 7 days
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDay = new Date(today);
  endDay.setDate(endDay.getDate() + 7);
  const endDate = endDay.toISOString().slice(0, 10);
  
  const dates = dateRange(startDate.replace(/-/g, ''), endDate.replace(/-/g, ''));
  let totalUpdated = 0;
  
  for (const yyyymmdd of dates) {
    const dateStr = `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
    
    const contests = await fetchNcaaGames(yyyymmdd);
    if (contests.length === 0) continue;
    
    // Get TBD games from DB for this date
    const [tbdGames] = await conn.query(
      "SELECT id, awayTeam, homeTeam, startTimeEst, ncaaContestId FROM games WHERE gameDate = ? AND (startTimeEst = 'TBD' OR startTimeEst IS NULL OR startTimeEst = '')",
      [dateStr]
    );
    
    if (tbdGames.length === 0) continue;
    console.log(`\n${dateStr}: ${tbdGames.length} TBD games, ${contests.length} NCAA contests`);
    
    for (const game of tbdGames) {
      let match = null;
      
      // First try by contestId
      if (game.ncaaContestId) {
        match = contests.find(c => c.contestId === game.ncaaContestId);
      }
      
      // Then try by slug matching (with _st/_state normalization)
      if (!match) {
        match = contests.find(c => {
          const away = c.teams?.find(t => t.isHome === false);
          const home = c.teams?.find(t => t.isHome === true);
          if (!away || !home) return false;
          const ncaaAway = ncaaSlugToDb(away.seoname ?? '');
          const ncaaHome = ncaaSlugToDb(home.seoname ?? '');
          return slugsMatch(ncaaAway, game.awayTeam) && slugsMatch(ncaaHome, game.homeTeam);
        });
      }
      
      if (match && match.startTimeEpoch && match.hasStartTime) {
        const startTimeEst = epochToEst(match.startTimeEpoch);
        await conn.query(
          'UPDATE games SET startTimeEst = ?, ncaaContestId = ? WHERE id = ?',
          [startTimeEst, match.contestId, game.id]
        );
        console.log(`  ✓ ${game.awayTeam} @ ${game.homeTeam}: ${startTimeEst}`);
        totalUpdated++;
      } else {
        console.log(`  ✗ No match: ${game.awayTeam} @ ${game.homeTeam}`);
      }
    }
  }
  
  console.log(`\nTotal updated: ${totalUpdated}`);
  await conn.end();
}

main().catch(console.error);

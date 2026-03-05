import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

try {
  const envContent = readFileSync('/home/ubuntu/ai-sports-betting/.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const NCAA_ALIAS = {
  michigan_st: 'michigan_state', ohio_st: 'ohio_state', penn_st: 'penn_state',
  iowa_st: 'iowa_state', florida_st: 'florida_state', colorado_st: 'colorado_state',
  kansas_st: 'kansas_state', oklahoma_st: 'oklahoma_state', oregon_st: 'oregon_state',
  washington_st: 'washington_state', utah_st: 'utah_state', arizona_st: 'arizona_state',
  boise_st: 'boise_state', fresno_st: 'fresno_state', san_diego_st: 'san_diego_state',
  san_jose_st: 'san_jose_state', wichita_st: 'wichita_state', illinois_st: 'illinois_state',
  indiana_st: 'indiana_state', idaho_st: 'idaho_state', montana_st: 'montana_state',
  north_dakota_st: 'n_dakota_st', south_dakota_st: 's_dakota_st', south_carolina_st: 's_carolina_st',
  tennessee_st: 'tennessee_state', mississippi_st: 'mississippi_state', missouri_st: 'missouri_state',
  murray_st: 'murray_state', morehead_st: 'morehead_state', jackson_st: 'jackson_state',
  norfolk_st: 'norfolk_state', morgan_st: 'morgan_state', savannah_st: 'savannah_state',
  kennesaw_st: 'kennesaw_state', jacksonville_st: 'jacksonville_state', sam_houston_st: 'sam_houston_state',
  tarleton_st: 'tarleton_state', texas_st: 'texas_state', new_mexico_st: 'new_mexico_state',
  portland_st: 'portland_state', sacramento_st: 'sacramento_state', weber_st: 'weber_state',
  youngstown_st: 'youngstown_state', wright_st: 'wright_state', cleveland_st: 'cleveland_state',
  chicago_st: 'chicago_state', georgia_st: 'georgia_state', long_beach_st: 'long_beach_state',
  kent_st: 'kent_state', pittsburg_st: 'pittsburg_state', fort_hays_st: 'fort_hays_state',
  nicholls_st: 'nicholls_state', north_carolina_st: 'nc_state', southeast_mo_st: 'se_missouri_st',
  northwest_mo_st: 'northwest_missouri_state', northwestern_st: 'northwestern_state',
  west_virginia_st: 'west_virginia_state', wayne_st_mi: 'wayne_state',
  ualr: 'little_rock', fgcu: 'florida_gulf_coast', fdu: 'fairleigh_dickinson',
  usc_upstate: 'south_carolina_upstate', long_island: 'liu', lindenwood_mo: 'lindenwood',
  central_conn_st: 'central_connecticut', north_ala: 'north_alabama', southern_ill: 's_illinois',
  southern_california: 'usc', south_fla: 'south_florida', ga_southern: 'georgia_southern',
  detroit: 'detroit_mercy', saint_josephs: 'st_josephs', humboldt_st: 'cal_poly_humboldt',
  middle_tenn: 'middle_tenn_st', ut_martin: 'tennessee_martin', md_east_shore: 'md_e_shore',
  mississippi_val: 'miss_valley_st', western_ky: 'w_kentucky', prairie_view: 'prairie_view_a_and_m',
  grambling: 'grambling_st', uni: 'n_iowa', alcorn: 'alcorn_st',
  cal_st_northridge: 'csu_northridge', bakersfield: 'csu_bakersfield', cal_st_fullerton: 'csu_fullerton',
  arkansas_st: 'arkansas_state', alabama_am: 'alabama_a_and_m', alabama_st: 'alabama_state',
  south_utah: 'southern_utah', coppin_st: 'coppin_state', delaware_st: 'delaware_state',
  florida_am: 'florida_a_and_m',
  // Additional DB slug aliases
  fiu: 'florida_intl',
  southern_utah: 's_utah',
  utep: 'texas_el_paso',
  st_thomas_mn: 'st_thomas_mn_',
  abilene_christian: 'abilene_chr',
  nc_at: 'n_carolina_a_and_t',
  eastern_mich: 'e_michigan',
  central_ark: 'c_arkansas',
  north_dakota: 'n_dakota',
  charleston_so: 'charleston_southern',
  ill_chicago: 'illinois_chicago',
  citadel: 'the_citadel',
  northern_ill: 'n_illinois',
  vcu: 'va_commonwealth',
  central_mich: 'c_michigan',
  western_mich: 'w_michigan',
  neb_omaha: 'nebraska_omaha',
  south_dakota: 's_dakota',
  ucf: 'c_florida',
  st_johns_ny: 'st_johns',
  penn: 'pennsylvania',
  hawaii: 'hawaii',
};

function seonameToSlug(s) { return s.replace(/-/g, '_').toLowerCase(); }
function ncaaSlugToDb(s) { const slug = seonameToSlug(s); return NCAA_ALIAS[slug] ?? slug; }
function slugsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const norm = s => s.replace(/_state$/, '_st');
  if (norm(a) === norm(b)) return true;
  const expand = s => { const m = s.match(/^(.+)_st$/); return m ? m[1] + '_state' : s; };
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

const NCAA_API = 'https://sdataprod.ncaa.com/';
const SHA = '7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c';

async function fetchNcaaGames(contestDate, seasonYear) {
  const variables = { sportCode: 'MBB', divisionId: 1, contestDate, seasonYear };
  const extensions = { persistedQuery: { version: 1, sha256Hash: SHA } };
  const url = NCAA_API + '?variables=' + encodeURIComponent(JSON.stringify(variables)) + '&extensions=' + encodeURIComponent(JSON.stringify(extensions));
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.ncaa.com', Referer: 'https://www.ncaa.com/', Accept: 'application/json' }
  });
  const data = await resp.json();
  return data?.data?.contests ?? [];
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  let totalUpdated = 0;

  for (const [contestDate, seasonYear, dateStr] of [
    ['03/05/2026', 2025, '2026-03-05'],
    ['03/06/2026', 2025, '2026-03-06'],
  ]) {
    const contests = await fetchNcaaGames(contestDate, seasonYear);
    console.log(`\n${dateStr}: ${contests.length} NCAA contests`);

    const [tbdGames] = await conn.query(
      "SELECT id, awayTeam, homeTeam FROM games WHERE gameDate = ? AND (startTimeEst = 'TBD' OR startTimeEst IS NULL OR startTimeEst = '')",
      [dateStr]
    );
    console.log(`${tbdGames.length} TBD games in DB`);

    for (const game of tbdGames) {
      const match = contests.find(c => {
        const away = c.teams?.find(t => t.isHome === false);
        const home = c.teams?.find(t => t.isHome === true);
        if (!away?.seoname || !home?.seoname) return false;
        const ncaaAway = ncaaSlugToDb(away.seoname);
        const ncaaHome = ncaaSlugToDb(home.seoname);
        return slugsMatch(ncaaAway, game.awayTeam) && slugsMatch(ncaaHome, game.homeTeam);
      });

      if (match && match.startTimeEpoch && match.hasStartTime) {
        const startTimeEst = epochToEst(match.startTimeEpoch);
        await conn.query(
          'UPDATE games SET startTimeEst = ?, ncaaContestId = ? WHERE id = ?',
          [startTimeEst, match.contestId, game.id]
        );
        console.log(`  UPDATED: ${game.awayTeam} @ ${game.homeTeam} -> ${startTimeEst}`);
        totalUpdated++;
      } else {
        // Show what NCAA has for this away team
        const ncaaAway = contests.find(c => {
          const away = c.teams?.find(t => t.isHome === false);
          return away?.seoname && slugsMatch(ncaaSlugToDb(away.seoname), game.awayTeam);
        });
        if (ncaaAway) {
          const away = ncaaAway.teams?.find(t => t.isHome === false);
          const home = ncaaAway.teams?.find(t => t.isHome === true);
          console.log(`  PARTIAL: ${game.awayTeam} @ ${game.homeTeam} | NCAA away found: ${away?.seoname}->${ncaaSlugToDb(away?.seoname)} @ ${home?.seoname}->${ncaaSlugToDb(home?.seoname)} hasTime=${ncaaAway.hasStartTime}`);
        } else {
          console.log(`  MISS: ${game.awayTeam} @ ${game.homeTeam}`);
        }
      }
    }
  }

  console.log(`\nTotal updated: ${totalUpdated}`);
  await conn.end();
}

main().catch(console.error);

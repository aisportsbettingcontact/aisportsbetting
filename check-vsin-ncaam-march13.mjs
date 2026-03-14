/**
 * Check VSiN NCAAM betting splits for March 13 games
 * to see if spread/total data is available for the 16 missing games
 */
import dotenv from 'dotenv';
dotenv.config();
import { scrapeVsinOdds } from './server/vsinScraper.ts';

console.log('Fetching VSiN NCAAM odds...');
const games = await scrapeVsinOdds('ALL');
console.log(`VSiN returned ${games.length} NCAAM games`);

// The 16 games missing spread/total in DB
const MISSING_SPREAD = [
  'seton_hall@st_johns',
  'iowa_st@arizona',
  'purdue@nebraska',
  'miami_fl@virginia',
  'mississippi@alabama',
  'clemson@duke',
  'nevada@utah_st',
  'kent@akron',
  'georgetown@connecticut',
  'southern_u@florida_a_and_m',
  'kansas@houston',
  'utah_tech@california_baptist',
  'davidson@st_josephs',
  'delaware_st@nc_central',
  'ucla@michigan_st',
  'oklahoma@arkansas',
];

console.log('\nChecking VSiN data for 16 missing-spread games:');
for (const key of MISSING_SPREAD) {
  const [away, home] = key.split('@');
  const match = games.find(g => g.awaySlug === away && g.homeSlug === home);
  if (match) {
    console.log(`  ✅ ${away} @ ${home}: spread=${match.awaySpread} total=${match.total} spreadOdds=${match.awaySpreadOdds}/${match.homeSpreadOdds} overOdds=${match.overOdds}/${match.underOdds}`);
  } else {
    console.log(`  ❌ ${away} @ ${home}: NOT in VSiN`);
  }
}

console.log('\nAll VSiN games:');
games.forEach(g => {
  console.log(`  ${g.awaySlug} @ ${g.homeSlug}: spread=${g.awaySpread}(${g.awaySpreadOdds}/${g.homeSpreadOdds}) total=${g.total}(o:${g.overOdds}/u:${g.underOdds}) ml=${g.awayML}/${g.homeML}`);
});

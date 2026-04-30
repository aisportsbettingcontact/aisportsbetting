import 'dotenv/config';
import { scrapeRotowireLineupsToday } from './rotowireLineupScraper.ts';
import { writeFileSync } from 'fs';

async function main() {
  console.log('[STEP] Re-scraping Rotowire with fixed ERA selector...');
  const result = await scrapeRotowireLineupsToday();
  writeFileSync('/tmp/roto_raw_v2.json', JSON.stringify(result, null, 2));
  console.log(`[OUTPUT] ${result.games.length} games scraped`);
  for (const g of result.games) {
    const ap = g.awayPitcher;
    const hp = g.homePitcher;
    console.log(`  ${g.awayAbbrev} @ ${g.homeAbbrev}: Away=${ap?.name}(${ap?.era}) Home=${hp?.name}(${hp?.era})`);
  }
}
main().catch(e => { console.error('[CRASH]', e); process.exit(1); });

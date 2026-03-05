import { createRequire } from 'module';
import { readFileSync } from 'fs';

// Load env
const envPath = '/home/ubuntu/ai-sports-betting/.env';
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

const NCAA_API = 'https://sdataprod.ncaa.com/';
const GET_CONTESTS_SHA = '7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c';

async function fetchNcaaGames(contestDate, seasonYear) {
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

function epochToEst(epochSec) {
  const d = new Date(epochSec * 1000);
  const estH = ((d.getUTCHours() - 5) + 24) % 24;
  return estH.toString().padStart(2,'0') + ':' + d.getUTCMinutes().toString().padStart(2,'0');
}

const contests = await fetchNcaaGames('03/05/2026', 2025);
console.log('Total contests:', contests.length);
console.log('');

for (const c of contests) {
  const away = c.teams?.find(t => t.isHome === false);
  const home = c.teams?.find(t => t.isHome === true);
  if (!away || !home) continue;
  const estTime = c.startTimeEpoch ? epochToEst(c.startTimeEpoch) : 'NO_EPOCH';
  const awaySlug = away.seoname?.replace(/-/g, '_') ?? 'UNKNOWN';
  const homeSlug = home.seoname?.replace(/-/g, '_') ?? 'UNKNOWN';
  console.log(`${awaySlug} @ ${homeSlug} | ${estTime} ET | hasStartTime=${c.hasStartTime} | contestId=${c.contestId}`);
}

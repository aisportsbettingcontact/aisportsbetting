/**
 * compute-uniform-font.mjs
 *
 * Measures every NCAAM school name (ncaaName) and NBA city name (city)
 * plus all nicknames (ncaaNickname / nickname) to find the single largest
 * UNIFORM font size where ALL names fit the mobile frozen panel and desktop
 * score panel without truncation.
 *
 * Character width estimators (conservative, for Inter/system-ui uppercase bold):
 *   Uppercase bold:  avg char ≈ 0.64 × fontSize
 *   Mixed regular:   avg char ≈ 0.54 × fontSize
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const ncaamRaw = readFileSync(join(root, 'shared/ncaamTeams.ts'), 'utf8');
const nbaRaw   = readFileSync(join(root, 'shared/nbaTeams.ts'), 'utf8');

function extractField(raw, fieldName) {
  const re = new RegExp(`${fieldName}:\\s*["']([^"']+)["']`, 'g');
  const results = [];
  let m;
  while ((m = re.exec(raw)) !== null) results.push(m[1]);
  return results;
}

// NCAAM top line: ncaaName (displayed as uppercase)
const ncaamNames     = extractField(ncaamRaw, 'ncaaName').map(n => n.toUpperCase());
const ncaamNicknames = extractField(ncaamRaw, 'ncaaNickname');

// NBA top line: city (displayed as uppercase)
const nbaCities    = extractField(nbaRaw, 'city').map(c => c.toUpperCase());
const nbaNicknames = extractField(nbaRaw, 'nickname');

const allTopNames  = [...ncaamNames, ...nbaCities];
const allNicknames = [...ncaamNicknames, ...nbaNicknames];

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  UNIFORM FONT SIZE COMPUTATION');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log(`NCAAM teams: ${ncaamNames.length}  |  NBA teams: ${nbaCities.length}`);
console.log(`Total top-line names: ${allTopNames.length}  |  Total nicknames: ${allNicknames.length}\n`);

const top10Names = [...allTopNames].sort((a,b) => b.length - a.length).slice(0, 15);
const top10Nicks = [...allNicknames].sort((a,b) => b.length - a.length).slice(0, 10);

console.log('Top 15 longest school/city names (uppercase):');
top10Names.forEach((n, i) => console.log(`  ${String(i+1).padStart(2)}. "${n}" (${n.length} chars)`));
console.log('\nTop 10 longest nicknames:');
top10Nicks.forEach((n, i) => console.log(`  ${String(i+1).padStart(2)}. "${n}" (${n.length} chars)`));

// ── Measurement functions ─────────────────────────────────────────────────────
function measureUpperBold(text, fontSize) {
  return text.length * 0.64 * fontSize;
}
function measureMixedRegular(text, fontSize) {
  return text.length * 0.54 * fontSize;
}

function findUniformSize(texts, measureFn, maxFont, minFont, availableWidth) {
  const longest = texts.reduce((a, b) => (b.length > a.length ? b : a), '');
  for (let fs = maxFont; fs >= minFont; fs -= 0.5) {
    const w = measureFn(longest, fs);
    if (w <= availableWidth) {
      return { fontSize: fs, longest, measuredWidth: +w.toFixed(1), availableWidth, fits: true };
    }
  }
  const w = measureFn(longest, minFont);
  return { fontSize: minFont, longest, measuredWidth: +w.toFixed(1), availableWidth, fits: w <= availableWidth };
}

// ── Mobile Panel Analysis ─────────────────────────────────────────────────────
console.log('\n─── Mobile Panel Analysis ───────────────────────────────────────\n');
console.log('Panel geometry: totalWidth - (6px lpad + 6px rpad + 22px logo + 8px gap) = available');
console.log('Score column is a SIBLING div, so name column gets full (panel - fixed)\n');

const MOBILE_PANELS = [140, 150, 155, 160, 165, 170];
const MOBILE_FIXED  = 42; // 6+6+22+8

for (const panelWidth of MOBILE_PANELS) {
  const available = panelWidth - MOBILE_FIXED;
  const nameRes = findUniformSize(allTopNames, measureUpperBold, 14, 6, available);
  const maxNick = Math.min(nameRes.fontSize - 1, 12);
  const nickRes = findUniformSize(allNicknames, measureMixedRegular, maxNick, 5, available);

  const nameStatus = nameRes.fits ? '✓' : '✗ OVERFLOW';
  const nickStatus = nickRes.fits ? '✓' : '✗ OVERFLOW';

  console.log(`Panel ${panelWidth}px → available ${available}px`);
  console.log(`  School/City: ${nameRes.fontSize}px ${nameStatus}  (longest: "${nameRes.longest}", ${nameRes.measuredWidth}px / ${available}px)`);
  console.log(`  Nickname:    ${nickRes.fontSize}px ${nickStatus}  (longest: "${nickRes.longest}", ${nickRes.measuredWidth}px / ${available}px)`);
  console.log(`  Ratio:       ${(nameRes.fontSize / nickRes.fontSize).toFixed(2)}x  (name > nick: ${nameRes.fontSize > nickRes.fontSize})`);
  console.log('');
}

// ── Desktop ScorePanel Analysis ───────────────────────────────────────────────
console.log('─── Desktop ScorePanel Analysis ─────────────────────────────────\n');
console.log('Panel geometry: totalWidth - (12px pad + 22px logo + 8px gap) = available\n');

const DESKTOP_PANELS = [220, 240, 260, 280, 300];
const DESKTOP_FIXED  = 42;

for (const panelWidth of DESKTOP_PANELS) {
  const available = panelWidth - DESKTOP_FIXED;
  const nameRes = findUniformSize(allTopNames, measureUpperBold, 18, 8, available);
  const maxNick = Math.min(nameRes.fontSize - 2, 14);
  const nickRes = findUniformSize(allNicknames, measureMixedRegular, maxNick, 6, available);

  const nameStatus = nameRes.fits ? '✓' : '✗ OVERFLOW';
  const nickStatus = nickRes.fits ? '✓' : '✗ OVERFLOW';

  console.log(`Desktop panel ${panelWidth}px → available ${available}px`);
  console.log(`  School/City: ${nameRes.fontSize}px ${nameStatus}  (longest: "${nameRes.longest}", ${nameRes.measuredWidth}px / ${available}px)`);
  console.log(`  Nickname:    ${nickRes.fontSize}px ${nickStatus}  (longest: "${nickRes.longest}", ${nickRes.measuredWidth}px / ${available}px)`);
  console.log('');
}

// ── Recommended clamp values ──────────────────────────────────────────────────
console.log('─── Recommended clamp() values ──────────────────────────────────\n');
// Mobile: panel 140px → name 9.5px, nick 8.5px
// Tablet (panel ~180px): name 14px, nick 12px
// Desktop (panel 220-260px): name 18px, nick 14px
// clamp(min, preferred-vw, max)
// At 375px (mobile): 9.5px → 9.5/375 = 2.53vw
// At 768px (tablet): 14px  → 14/768  = 1.82vw
// At 1280px (desktop): 18px → 18/1280 = 1.41vw
// Best single clamp: clamp(9.5px, 2.5vw, 18px) for name
//                    clamp(8px,   2.1vw, 14px) for nick

console.log('RECOMMENDATION:');
console.log('  School/City name: clamp(9.5px, 2.5vw, 18px)');
console.log('  Nickname:         clamp(8px,   2.1vw, 14px)');
console.log('  Ratio at mobile:  9.5 / 8.0 = 1.19x  (name > nick ✓)');
console.log('  Ratio at desktop: 18  / 14  = 1.29x  (name > nick ✓)');
console.log('');
console.log('NOTE: Remove useAutoFontSize from MobileTeamNameBlock and ScorePanel.');
console.log('      Use whiteSpace:nowrap + overflow:visible on name spans.');
console.log('      The panel must be wide enough — at 140px mobile panel,');
console.log('      9.5px × 0.64 × 13 chars (OKLAHOMA CITY) = 79px < 98px ✓');
console.log('');

// Verify the recommendation against all names
const mobileAvail = 140 - MOBILE_FIXED; // 98px
const nameCheck = allTopNames.filter(n => measureUpperBold(n, 9.5) > mobileAvail);
const nickCheck = allNicknames.filter(n => measureMixedRegular(n, 8) > mobileAvail);
console.log(`Verification at 9.5px name / 8px nick on 140px panel (${mobileAvail}px available):`);
console.log(`  Names that overflow: ${nameCheck.length} ${nameCheck.length === 0 ? '✓ NONE' : nameCheck.join(', ')}`);
console.log(`  Nicks that overflow: ${nickCheck.length} ${nickCheck.length === 0 ? '✓ NONE' : nickCheck.join(', ')}`);
console.log('');
console.log('═══════════════════════════════════════════════════════════════\n');

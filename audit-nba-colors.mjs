/**
 * NBA Team Color Audit
 * Checks all NBA teams against the same color rules used in BettingSplitsPanel:
 *   - isUnusableBarColor: luminance < 4% (near-black) OR > 90% (near-white)
 *   - areColorsTooSimilar: Euclidean sRGB distance < 60
 *   - pickBarColor: primary → secondary → tertiary → fallback
 *
 * Reports any team whose primary color is blocked AND which fallback is used.
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const FALLBACK_AWAY = "#1a4a8a";
const FALLBACK_HOME = "#c84b0c";

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function perceivedLuminance(hex) {
  if (!hex) return null;
  try {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  } catch { return null; }
}

function isUnusableBarColor(hex) {
  if (!hex) return false;
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6 && clean.length !== 3) return false;
  const lum = perceivedLuminance(hex);
  return lum < 0.04 || lum > 0.90;
}

function areColorsTooSimilar(hexA, hexB, threshold = 60) {
  try {
    const [r1, g1, b1] = hexToRgb(hexA);
    const [r2, g2, b2] = hexToRgb(hexB);
    const dist = Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
    return dist < threshold;
  } catch { return false; }
}

function pickBarColor(primary, secondary, tertiary, fallback) {
  for (const c of [primary, secondary, tertiary]) {
    if (c && !isUnusableBarColor(c)) return c;
  }
  return fallback;
}

// Simulate what BettingSplitsPanel does for an away vs home matchup
function simulateMatchup(away, home) {
  const homeColor = pickBarColor(home.primaryColor, home.secondaryColor, home.tertiaryColor, FALLBACK_HOME);
  
  // Away: cycle through colors, skipping unusable AND too-similar-to-home
  let awayColor = FALLBACK_AWAY;
  for (const c of [away.primaryColor, away.secondaryColor, away.tertiaryColor]) {
    if (c && !isUnusableBarColor(c) && !areColorsTooSimilar(c, homeColor)) {
      awayColor = c;
      break;
    }
  }
  
  return { awayColor, homeColor };
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [rows] = await conn.execute(
    'SELECT name, primaryColor, secondaryColor, tertiaryColor FROM nba_teams ORDER BY name'
  );
  
  await conn.end();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('NBA TEAM COLOR AUDIT');
  console.log(`${'='.repeat(80)}\n`);
  
  // ── Part 1: Per-team color analysis ──────────────────────────────────────────
  console.log('PART 1: PER-TEAM COLOR ANALYSIS');
  console.log(`${'-'.repeat(80)}`);
  
  const issues = [];
  
  for (const team of rows) {
    const { name, primaryColor, secondaryColor, tertiaryColor } = team;
    const lum = perceivedLuminance(primaryColor);
    const primaryBlocked = isUnusableBarColor(primaryColor);
    const secondaryBlocked = isUnusableBarColor(secondaryColor);
    const tertiaryBlocked = isUnusableBarColor(tertiaryColor);
    
    const pickedAsHome = pickBarColor(primaryColor, secondaryColor, tertiaryColor, FALLBACK_HOME);
    const usedFallback = pickedAsHome === FALLBACK_HOME;
    
    const lumStr = lum != null ? `${(lum * 100).toFixed(1)}%` : 'N/A';
    const status = usedFallback ? '🚨 FALLBACK' : primaryBlocked ? '⚠️  PRIMARY BLOCKED (uses secondary/tertiary)' : '✅ OK';
    
    console.log(`${name.padEnd(30)} primary=${primaryColor || 'NULL'} (lum ${lumStr}) | 2nd=${secondaryColor || 'NULL'} | 3rd=${tertiaryColor || 'NULL'} | ${status}`);
    
    if (usedFallback || primaryBlocked) {
      issues.push({ team: name, primaryColor, secondaryColor, tertiaryColor, pickedAsHome, usedFallback, primaryBlocked });
    }
  }
  
  // ── Part 2: Matchup simulation (all 30 × 29 away/home pairs) ─────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log('PART 2: MATCHUP SIMULATION — pairs where similarity fallback triggers');
  console.log(`${'-'.repeat(80)}`);
  
  const similarityFallbacks = [];
  
  for (const away of rows) {
    for (const home of rows) {
      if (away.name === home.name) continue;
      
      const homeColor = pickBarColor(home.primaryColor, home.secondaryColor, home.tertiaryColor, FALLBACK_HOME);
      
      // Check if away primary would be blocked by similarity
      const awayPrimary = away.primaryColor;
      if (awayPrimary && !isUnusableBarColor(awayPrimary) && areColorsTooSimilar(awayPrimary, homeColor)) {
        // Check if secondary saves it
        const awaySecondary = away.secondaryColor;
        const awayTertiary = away.tertiaryColor;
        
        let resolvedAway = FALLBACK_AWAY;
        for (const c of [awayPrimary, awaySecondary, awayTertiary]) {
          if (c && !isUnusableBarColor(c) && !areColorsTooSimilar(c, homeColor)) {
            resolvedAway = c;
            break;
          }
        }
        
        const hitsFallback = resolvedAway === FALLBACK_AWAY;
        similarityFallbacks.push({
          away: away.name,
          home: home.name,
          awayPrimary,
          homeColor,
          resolvedAway,
          hitsFallback,
          dist: Math.sqrt(
            ...(() => {
              const [r1,g1,b1] = hexToRgb(awayPrimary);
              const [r2,g2,b2] = hexToRgb(homeColor);
              return [(r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2];
            })()
          ).toFixed(1),
        });
      }
    }
  }
  
  if (similarityFallbacks.length === 0) {
    console.log('No similarity-triggered fallbacks found. ✅');
  } else {
    const fallbackOnly = similarityFallbacks.filter(x => x.hitsFallback);
    const resolvedBySec = similarityFallbacks.filter(x => !x.hitsFallback);
    
    if (fallbackOnly.length > 0) {
      console.log(`\n🚨 ${fallbackOnly.length} matchup(s) where away team hits FALLBACK_AWAY due to similarity:`);
      for (const m of fallbackOnly) {
        console.log(`  ${m.away.padEnd(25)} @ ${m.home.padEnd(25)} | away primary ${m.awayPrimary} ≈ home ${m.homeColor} (dist ${m.dist})`);
      }
    }
    
    if (resolvedBySec.length > 0) {
      console.log(`\n⚠️  ${resolvedBySec.length} matchup(s) where primary is similar but secondary/tertiary resolves it:`);
      for (const m of resolvedBySec.slice(0, 20)) {
        console.log(`  ${m.away.padEnd(25)} @ ${m.home.padEnd(25)} | primary ${m.awayPrimary} ≈ home ${m.homeColor} → uses ${m.resolvedAway}`);
      }
      if (resolvedBySec.length > 20) console.log(`  ... and ${resolvedBySec.length - 20} more`);
    }
  }
  
  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log(`${'-'.repeat(80)}`);
  
  const fallbackTeams = issues.filter(i => i.usedFallback);
  const primaryBlockedTeams = issues.filter(i => i.primaryBlocked && !i.usedFallback);
  
  if (fallbackTeams.length === 0 && primaryBlockedTeams.length === 0) {
    console.log('✅ All 30 NBA teams have usable colors. No fallbacks will appear.');
  } else {
    if (fallbackTeams.length > 0) {
      console.log(`\n🚨 ${fallbackTeams.length} team(s) will show FALLBACK color (all 3 colors unusable):`);
      for (const t of fallbackTeams) {
        console.log(`  ${t.team}: primary=${t.primaryColor}, secondary=${t.secondaryColor}, tertiary=${t.tertiaryColor}`);
      }
    }
    if (primaryBlockedTeams.length > 0) {
      console.log(`\n⚠️  ${primaryBlockedTeams.length} team(s) have blocked primary but secondary/tertiary saves them:`);
      for (const t of primaryBlockedTeams) {
        console.log(`  ${t.team}: primary=${t.primaryColor} BLOCKED → uses ${t.pickedAsHome}`);
      }
    }
  }
  
  const fallbackMatchups = similarityFallbacks.filter(x => x.hitsFallback);
  if (fallbackMatchups.length > 0) {
    console.log(`\n🚨 ${fallbackMatchups.length} matchup(s) will show FALLBACK_AWAY due to color similarity with no resolution.`);
  } else {
    console.log('\n✅ No matchups will show FALLBACK_AWAY due to color similarity.');
  }
  
  console.log(`\n${'='.repeat(80)}\n`);
}

main().catch(console.error);

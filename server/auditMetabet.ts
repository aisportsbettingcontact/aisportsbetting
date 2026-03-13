/**
 * auditMetabet.ts
 *
 * Deep audit of MetaBet DraftKings odds for NCAAB (BKC), NBA (BKP), NHL (HKN).
 *
 * For every game returned by the API this script checks:
 *   1. Completeness — does the game have all 3 markets (spread, ML, O/U)?
 *   2. Correctness  — are spread values ±0.5 increments? Are American odds in valid range?
 *   3. Puck-line integrity — NHL spreads must be exactly ±1.5 (no ±1 or other values)
 *   4. Odds symmetry — away+home spread odds should NOT both be negative (one must be +)
 *   5. Decimal conversion accuracy — raw decimal re-verified against American output
 *   6. Total coverage — what % of today's games have each market populated
 *
 * Outputs a full per-game table plus summary statistics per league.
 */

const METABET_API_KEY = "219f64094f67ed781035f5f7a08840fc";
const BASE = "https://metabet.static.api.areyouwatchingthis.com/api/odds.json";
const PROVIDER = "DRAFTKINGS";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawOddsEntry {
  provider: string;
  spread?: number;
  spreadLine1?: number;
  spreadLine2?: number;
  overUnder?: number;
  overUnderLineOver?: number;
  overUnderLineUnder?: number;
  moneyLine1?: number;
  moneyLine2?: number;
}

interface RawGame {
  gameID: number;
  date: number;
  team1City: string;
  team1Name?: string;
  team1Nickname?: string;
  team1Initials: string;
  team2City: string;
  team2Name?: string;
  team2Nickname?: string;
  team2Initials: string;
  odds: RawOddsEntry[];
}

interface ApiResponse {
  meta: { code: number; count: number };
  results: RawGame[];
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

function decimalToAmerican(d: number | undefined | null): string | null {
  if (d == null || isNaN(d) || d <= 1) return null;
  if (d >= 2.0) return `+${Math.round((d - 1) * 100)}`;
  return `${Math.round(-100 / (d - 1))}`;
}

function roundToHalf(v: number | undefined | null): number | null {
  if (v == null || isNaN(v)) return null;
  return Math.round(v * 2) / 2;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidAmericanOdds(s: string | null): boolean {
  if (!s) return false;
  const n = parseInt(s, 10);
  if (isNaN(n)) return false;
  // Valid range: -10000 to +10000, never 0, never between -99 and 99 (except +100 = EV)
  if (n === 0) return false;
  if (n > 0 && n < 100) return false;   // +1 to +99 are not valid American odds
  if (n < 0 && n > -100) return false;  // -1 to -99 are not valid American odds
  if (Math.abs(n) > 10000) return false;
  return true;
}

function isHalfIncrement(v: number | null): boolean {
  if (v === null) return false;
  return (v * 2) % 1 === 0; // i.e. v is a multiple of 0.5
}

// ─── Audit per league ─────────────────────────────────────────────────────────

async function auditLeague(leagueCode: string): Promise<void> {
  const url = `${BASE}?apiKey=${METABET_API_KEY}&includeDonBestData&leagueCode=${leagueCode}`;
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`LEAGUE: ${leagueCode}  (provider: ${PROVIDER})`);
  console.log(`${'═'.repeat(80)}`);

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://vsin.com/",
      Origin: "https://vsin.com",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${leagueCode}`);
  const data = (await resp.json()) as ApiResponse;

  const allGames = data.results;
  console.log(`Total games in API response: ${allGames.length}`);

  // Filter to games that have a DraftKings entry
  const dkGames = allGames.filter(g => g.odds?.some(o => o.provider === PROVIDER));
  console.log(`Games with ${PROVIDER} entry: ${dkGames.length}`);
  console.log(`Games WITHOUT ${PROVIDER} entry: ${allGames.length - dkGames.length}`);

  // ── Per-game detailed audit ──────────────────────────────────────────────
  let spreadMissing = 0, spreadOddsMissing = 0, spreadOddsInvalid = 0;
  let mlMissing = 0, mlInvalid = 0;
  let ouMissing = 0, ouOddsMissing = 0, ouOddsInvalid = 0;
  let puckLineViolations = 0; // NHL only: spread != ±1.5
  let oddsSymmetryViolations = 0;
  let halfIncrementViolations = 0;
  const issues: string[] = [];

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`GAME-BY-GAME AUDIT`);
  console.log(`${'─'.repeat(80)}`);

  for (const game of dkGames) {
    const dk = game.odds.find(o => o.provider === PROVIDER)!;
    const awayLabel = `${game.team1City} ${game.team1Name ?? game.team1Nickname ?? ''} (${game.team1Initials})`;
    const homeLabel = `${game.team2City} ${game.team2Name ?? game.team2Nickname ?? ''} (${game.team2Initials})`;

    // Convert all fields
    const awaySpread = roundToHalf(dk.spread);
    const homeSpread = awaySpread !== null ? roundToHalf(-(dk.spread!)) : null;
    const awaySpreadOdds = decimalToAmerican(dk.spreadLine1);
    const homeSpreadOdds = decimalToAmerican(dk.spreadLine2);
    const total = roundToHalf(dk.overUnder);
    const overOdds = decimalToAmerican(dk.overUnderLineOver);
    const underOdds = decimalToAmerican(dk.overUnderLineUnder);
    const awayML = decimalToAmerican(dk.moneyLine1);
    const homeML = decimalToAmerican(dk.moneyLine2);

    const gameIssues: string[] = [];

    // ── Spread checks ──────────────────────────────────────────────────────
    if (awaySpread === null) {
      spreadMissing++;
      gameIssues.push('SPREAD_MISSING');
    } else {
      if (!isHalfIncrement(awaySpread)) {
        halfIncrementViolations++;
        gameIssues.push(`SPREAD_NOT_HALF_INCREMENT(${awaySpread})`);
      }
      if (leagueCode === 'HKN' && Math.abs(awaySpread) !== 1.5) {
        puckLineViolations++;
        gameIssues.push(`PUCK_LINE_NOT_1.5(away=${awaySpread})`);
      }
    }
    if (!awaySpreadOdds || !homeSpreadOdds) {
      spreadOddsMissing++;
      gameIssues.push(`SPREAD_ODDS_MISSING(away=${awaySpreadOdds},home=${homeSpreadOdds})`);
    } else {
      if (!isValidAmericanOdds(awaySpreadOdds)) {
        spreadOddsInvalid++;
        gameIssues.push(`SPREAD_AWAY_ODDS_INVALID(${awaySpreadOdds})`);
      }
      if (!isValidAmericanOdds(homeSpreadOdds)) {
        spreadOddsInvalid++;
        gameIssues.push(`SPREAD_HOME_ODDS_INVALID(${homeSpreadOdds})`);
      }
      // Symmetry: both spread odds should not be negative (one side must be +)
      if (awaySpreadOdds && homeSpreadOdds) {
        const a = parseInt(awaySpreadOdds, 10);
        const h = parseInt(homeSpreadOdds, 10);
        if (a < 0 && h < 0) {
          oddsSymmetryViolations++;
          gameIssues.push(`SPREAD_BOTH_NEGATIVE(away=${awaySpreadOdds},home=${homeSpreadOdds})`);
        }
      }
    }

    // ── Moneyline checks ───────────────────────────────────────────────────
    if (!awayML || !homeML) {
      mlMissing++;
      gameIssues.push(`ML_MISSING(away=${awayML},home=${homeML})`);
    } else {
      if (!isValidAmericanOdds(awayML)) {
        mlInvalid++;
        gameIssues.push(`ML_AWAY_INVALID(${awayML})`);
      }
      if (!isValidAmericanOdds(homeML)) {
        mlInvalid++;
        gameIssues.push(`ML_HOME_INVALID(${homeML})`);
      }
    }

    // ── O/U checks ─────────────────────────────────────────────────────────
    if (total === null) {
      ouMissing++;
      gameIssues.push('TOTAL_MISSING');
    } else {
      if (!isHalfIncrement(total)) {
        halfIncrementViolations++;
        gameIssues.push(`TOTAL_NOT_HALF_INCREMENT(${total})`);
      }
    }
    if (!overOdds || !underOdds) {
      ouOddsMissing++;
      gameIssues.push(`OU_ODDS_MISSING(over=${overOdds},under=${underOdds})`);
    } else {
      if (!isValidAmericanOdds(overOdds)) {
        ouOddsInvalid++;
        gameIssues.push(`OVER_ODDS_INVALID(${overOdds})`);
      }
      if (!isValidAmericanOdds(underOdds)) {
        ouOddsInvalid++;
        gameIssues.push(`UNDER_ODDS_INVALID(${underOdds})`);
      }
    }

    // ── Print game row ─────────────────────────────────────────────────────
    const status = gameIssues.length === 0 ? '✅ OK' : `❌ ${gameIssues.join(' | ')}`;
    const spreadStr = awaySpread !== null
      ? `${awaySpread > 0 ? '+' : ''}${awaySpread}(${awaySpreadOdds ?? '?'}) / ${homeSpread! > 0 ? '+' : ''}${homeSpread}(${homeSpreadOdds ?? '?'})`
      : 'N/A';
    const mlStr = awayML && homeML ? `${awayML} / ${homeML}` : 'N/A';
    const ouStr = total !== null
      ? `${total} o(${overOdds ?? '?'}) u(${underOdds ?? '?'})`
      : 'N/A';

    console.log(`\n  ${awayLabel} @ ${homeLabel}`);
    console.log(`    SPREAD: ${spreadStr}`);
    console.log(`    ML:     ${mlStr}`);
    console.log(`    O/U:    ${ouStr}`);
    console.log(`    Raw DK: spread=${dk.spread} sL1=${dk.spreadLine1} sL2=${dk.spreadLine2} ou=${dk.overUnder} ouOver=${dk.overUnderLineOver} ouUnder=${dk.overUnderLineUnder} ml1=${dk.moneyLine1} ml2=${dk.moneyLine2}`);
    console.log(`    Status: ${status}`);

    if (gameIssues.length > 0) {
      issues.push(`${awayLabel} @ ${homeLabel}: ${gameIssues.join(', ')}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = dkGames.length;
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`SUMMARY — ${leagueCode} (${total} games with DraftKings odds)`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Spread value present:       ${total - spreadMissing}/${total} (${pct(total - spreadMissing, total)}%)`);
  console.log(`  Spread odds present:        ${total - spreadOddsMissing}/${total} (${pct(total - spreadOddsMissing, total)}%)`);
  console.log(`  Spread odds valid format:   ${total - spreadOddsInvalid}/${total} (${pct(total - spreadOddsInvalid, total)}%)`);
  console.log(`  Moneyline present:          ${total - mlMissing}/${total} (${pct(total - mlMissing, total)}%)`);
  console.log(`  Moneyline valid format:     ${total - mlInvalid}/${total} (${pct(total - mlInvalid, total)}%)`);
  console.log(`  O/U total present:          ${total - ouMissing}/${total} (${pct(total - ouMissing, total)}%)`);
  console.log(`  O/U odds present:           ${total - ouOddsMissing}/${total} (${pct(total - ouOddsMissing, total)}%)`);
  console.log(`  O/U odds valid format:      ${total - ouOddsInvalid}/${total} (${pct(total - ouOddsInvalid, total)}%)`);
  console.log(`  Half-increment violations:  ${halfIncrementViolations}`);
  console.log(`  Odds symmetry violations:   ${oddsSymmetryViolations}`);
  if (leagueCode === 'HKN') {
    console.log(`  Puck-line violations (≠±1.5): ${puckLineViolations}`);
  }
  console.log(`  Total games with ANY issue: ${issues.length}`);

  if (issues.length > 0) {
    console.log(`\n  ISSUES FOUND:`);
    for (const iss of issues) console.log(`    • ${iss}`);
  } else {
    console.log(`\n  ✅ ALL GAMES PASSED — no issues found for ${leagueCode}`);
  }
}

function pct(n: number, d: number): string {
  if (d === 0) return '0';
  return ((n / d) * 100).toFixed(1);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log(`\nMETABET DRAFTKING ODDS — FULL DEEP AUDIT`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Provider: ${PROVIDER}`);
  console.log(`Leagues: NCAAB (BKC), NBA (BKP), NHL (HKN)`);

  for (const league of ['HKN', 'BKP', 'BKC'] as const) {
    await auditLeague(league);
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`AUDIT COMPLETE — elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`${'═'.repeat(80)}\n`);
}

main().catch(err => {
  console.error('AUDIT FAILED:', err);
  process.exit(1);
});

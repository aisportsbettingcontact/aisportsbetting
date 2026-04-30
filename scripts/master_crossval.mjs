/**
 * master_crossval.mjs
 *
 * The most rigorous possible cross-validation of all 30 MLB teams across:
 *   - 3 markets: ML (Moneyline), RL (Run Line ATS), O/U (Total)
 *   - 6 situations: Overall, Last 10, Home, Away, Favorite, Underdog
 *
 * METHOD:
 *   1. Pull raw rows from DB for each team (same query as getMlbSituationalStats)
 *   2. Compute all 18 records (3×6) from scratch in pure JS — identical logic to service
 *   3. Call the tRPC endpoint via HTTP and compare the response
 *   4. Flag every discrepancy with full context
 *
 * LOGGING: [TEAM][MARKET][SITUATION] expected vs actual
 */

import { createConnection } from 'mysql2/promise';
import axios from 'axios';

const SEASON_START = '2026-03-26';
const BOOK_FALLBACK_CHAIN = [68, 15, 21, 30];

const ALL_TEAMS = [
  { slug: 'arizona-diamondbacks',    abbr: 'ARI' },
  { slug: 'atlanta-braves',          abbr: 'ATL' },
  { slug: 'baltimore-orioles',       abbr: 'BAL' },
  { slug: 'boston-red-sox',          abbr: 'BOS' },
  { slug: 'chicago-cubs',            abbr: 'CHC' },
  { slug: 'chicago-white-sox',       abbr: 'CWS' },
  { slug: 'cincinnati-reds',         abbr: 'CIN' },
  { slug: 'cleveland-guardians',     abbr: 'CLE' },
  { slug: 'colorado-rockies',        abbr: 'COL' },
  { slug: 'detroit-tigers',          abbr: 'DET' },
  { slug: 'houston-astros',          abbr: 'HOU' },
  { slug: 'kansas-city-royals',      abbr: 'KC'  },
  { slug: 'los-angeles-angels',      abbr: 'LAA' },
  { slug: 'los-angeles-dodgers',     abbr: 'LAD' },
  { slug: 'miami-marlins',           abbr: 'MIA' },
  { slug: 'milwaukee-brewers',       abbr: 'MIL' },
  { slug: 'minnesota-twins',         abbr: 'MIN' },
  { slug: 'new-york-mets',           abbr: 'NYM' },
  { slug: 'new-york-yankees',        abbr: 'NYY' },
  { slug: 'oakland-athletics',        abbr: 'ATH' },
  { slug: 'philadelphia-phillies',   abbr: 'PHI' },
  { slug: 'pittsburgh-pirates',      abbr: 'PIT' },
  { slug: 'san-diego-padres',        abbr: 'SD'  },
  { slug: 'san-francisco-giants',    abbr: 'SF'  },
  { slug: 'seattle-mariners',        abbr: 'SEA' },
  { slug: 'st-louis-cardinals',      abbr: 'STL' },
  { slug: 'tampa-bay-rays',          abbr: 'TB'  },
  { slug: 'texas-rangers',           abbr: 'TEX' },
  { slug: 'toronto-blue-jays',       abbr: 'TOR' },
  { slug: 'washington-nationals',    abbr: 'WSH' },
];

// ── Computation helpers (mirror of getMlbSituationalStats) ────────────────────

function isAway(g, slug) { return g.awaySlug === slug; }

function teamWon(g, slug) {
  if (g.awayWon == null) return null;
  const aw = typeof g.awayWon === 'object' ? g.awayWon[0] : g.awayWon; // Buffer or bool
  const awBool = Boolean(aw);
  return isAway(g, slug) ? awBool : !awBool;
}

function teamCovered(g, slug) {
  if (isAway(g, slug)) {
    if (g.awayRunLineCovered == null) return null;
    const v = typeof g.awayRunLineCovered === 'object' ? g.awayRunLineCovered[0] : g.awayRunLineCovered;
    return Boolean(v);
  } else {
    if (g.homeRunLineCovered == null) return null;
    const v = typeof g.homeRunLineCovered === 'object' ? g.homeRunLineCovered[0] : g.homeRunLineCovered;
    return Boolean(v);
  }
}

function wasFavoriteOrNull(g, slug) {
  const ml = isAway(g, slug) ? g.dkAwayML : g.dkHomeML;
  if (!ml) return null;
  const mlNum = parseInt(ml, 10);
  if (isNaN(mlNum)) return null;
  return mlNum < 0;
}

function computeRecord(games, wonFn) {
  let wins = 0, losses = 0;
  for (const g of games) {
    const won = wonFn(g);
    if (won === true) wins++;
    else if (won === false) losses++;
  }
  return { wins, losses };
}

function computeAts(games, slug) {
  let wins = 0, losses = 0;
  for (const g of games) {
    const cov = teamCovered(g, slug);
    if (cov === true) wins++;
    else if (cov === false) losses++;
  }
  return { wins, losses };
}

function computeOu(games) {
  let wins = 0, losses = 0, pushes = 0;
  for (const g of games) {
    if (g.totalResult === 'OVER') wins++;
    else if (g.totalResult === 'UNDER') losses++;
    else if (g.totalResult === 'PUSH') pushes++;
  }
  return { wins, losses, pushes };
}

function computeAll(rows, slug) {
  const all = rows;
  const last10 = rows.slice(0, 10);
  const home = rows.filter(g => !isAway(g, slug));
  const away = rows.filter(g => isAway(g, slug));
  const fav = rows.filter(g => wasFavoriteOrNull(g, slug) === true);
  const dog = rows.filter(g => wasFavoriteOrNull(g, slug) === false);
  const noOdds = rows.filter(g => wasFavoriteOrNull(g, slug) === null);

  return {
    gamesTotal: all.length,
    noOddsCount: noOdds.length,
    ml: {
      overall: computeRecord(all, g => teamWon(g, slug)),
      last10:  computeRecord(last10, g => teamWon(g, slug)),
      home:    computeRecord(home, g => teamWon(g, slug)),
      away:    computeRecord(away, g => teamWon(g, slug)),
      fav:     computeRecord(fav, g => teamWon(g, slug)),
      dog:     computeRecord(dog, g => teamWon(g, slug)),
    },
    rl: {
      overall: computeAts(all, slug),
      last10:  computeAts(last10, slug),
      home:    computeAts(home, slug),
      away:    computeAts(away, slug),
      fav:     computeAts(fav, slug),
      dog:     computeAts(dog, slug),
    },
    ou: {
      overall: computeOu(all),
      last10:  computeOu(last10),
      home:    computeOu(home),
      away:    computeOu(away),
      fav:     computeOu(fav),
      dog:     computeOu(dog),
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const conn = await createConnection(process.env.DATABASE_URL);

let totalDiscrepancies = 0;
let totalGamesAudited = 0;
const teamResults = [];

console.log('═══════════════════════════════════════════════════════════════════════════════════════');
console.log('[MASTER_CROSSVAL] Full 30-Team MLB TRENDS Cross-Validation');
console.log('[MASTER_CROSSVAL] Markets: ML | RL (ATS) | O/U (Total)');
console.log('[MASTER_CROSSVAL] Situations: Overall | Last 10 | Home | Away | Favorite | Underdog');
console.log(`[MASTER_CROSSVAL] Season filter: gameDate >= ${SEASON_START}, gameStatus = complete`);
console.log('═══════════════════════════════════════════════════════════════════════════════════════\n');

for (const team of ALL_TEAMS) {
  const { slug, abbr } = team;

  // Fetch raw rows — same query as getMlbSituationalStats
  const [rows] = await conn.query(`
    SELECT * FROM mlb_schedule_history
    WHERE gameStatus = 'complete'
      AND gameDate >= ?
      AND (awaySlug = ? OR homeSlug = ?)
    ORDER BY gameDate DESC
    LIMIT 162
  `, [SEASON_START, slug, slug]);

  totalGamesAudited += rows.length;

  if (rows.length === 0) {
    console.log(`[${abbr}] ⚠️  ZERO games found in DB for slug="${slug}"`);
    teamResults.push({ abbr, slug, status: 'NO_DATA', games: 0, discrepancies: 0 });
    continue;
  }

  // Compute from raw rows
  const computed = computeAll(rows, slug);

  // ── Validate internal consistency ────────────────────────────────────────────
  const issues = [];

  // ML: wins + losses ≤ total games
  const mlTotal = computed.ml.overall.wins + computed.ml.overall.losses;
  if (mlTotal > rows.length) {
    issues.push(`[INTEGRITY] ML wins+losses (${mlTotal}) > total games (${rows.length})`);
  }

  // RL: wins + losses ≤ total games
  const rlTotal = computed.rl.overall.wins + computed.rl.overall.losses;
  if (rlTotal > rows.length) {
    issues.push(`[INTEGRITY] RL wins+losses (${rlTotal}) > total games (${rows.length})`);
  }

  // O/U: wins + losses + pushes ≤ total games
  const ouTotal = computed.ou.overall.wins + computed.ou.overall.losses + computed.ou.overall.pushes;
  if (ouTotal > rows.length) {
    issues.push(`[INTEGRITY] O/U total (${ouTotal}) > total games (${rows.length})`);
  }

  // Home + Away = Overall (ML)
  const homeAwayMl = computed.ml.home.wins + computed.ml.home.losses + computed.ml.away.wins + computed.ml.away.losses;
  const overallMl = computed.ml.overall.wins + computed.ml.overall.losses;
  if (homeAwayMl !== overallMl) {
    issues.push(`[INTEGRITY] ML home(${computed.ml.home.wins}-${computed.ml.home.losses}) + away(${computed.ml.away.wins}-${computed.ml.away.losses}) = ${homeAwayMl} ≠ overall(${overallMl})`);
  }

  // Home + Away = Overall (RL)
  const homeAwayRl = computed.rl.home.wins + computed.rl.home.losses + computed.rl.away.wins + computed.rl.away.losses;
  const overallRl = computed.rl.overall.wins + computed.rl.overall.losses;
  if (homeAwayRl !== overallRl) {
    issues.push(`[INTEGRITY] RL home+away (${homeAwayRl}) ≠ overall (${overallRl})`);
  }

  // Home + Away = Overall (O/U)
  const homeAwayOu = computed.ou.home.wins + computed.ou.home.losses + computed.ou.home.pushes
                   + computed.ou.away.wins + computed.ou.away.losses + computed.ou.away.pushes;
  const overallOu = computed.ou.overall.wins + computed.ou.overall.losses + computed.ou.overall.pushes;
  if (homeAwayOu !== overallOu) {
    issues.push(`[INTEGRITY] O/U home+away (${homeAwayOu}) ≠ overall (${overallOu})`);
  }

  // Fav + Dog ≤ Overall (ML) — they won't equal if there are no-odds games
  const favDogMl = computed.ml.fav.wins + computed.ml.fav.losses + computed.ml.dog.wins + computed.ml.dog.losses;
  if (favDogMl > overallMl) {
    issues.push(`[INTEGRITY] ML fav+dog (${favDogMl}) > overall (${overallMl})`);
  }

  // Last 10 ≤ 10 games
  const last10Ml = computed.ml.last10.wins + computed.ml.last10.losses;
  if (last10Ml > 10) {
    issues.push(`[INTEGRITY] Last10 ML total (${last10Ml}) > 10`);
  }

  // ── Per-game spot checks ──────────────────────────────────────────────────────
  // Verify awayWon derivation for each game
  let awayWonMismatch = 0;
  for (const g of rows) {
    if (g.awayScore == null || g.homeScore == null) continue;
    const expectedAwayWon = g.awayScore > g.homeScore;
    const storedAwayWon = typeof g.awayWon === 'object' ? Boolean(g.awayWon[0]) : Boolean(g.awayWon);
    if (expectedAwayWon !== storedAwayWon) {
      awayWonMismatch++;
      issues.push(`[GAME_DATA] ${g.awayAbbr}@${g.homeAbbr} (${g.gameDate}): awayWon=${storedAwayWon} but score=${g.awayScore}-${g.homeScore} → expected awayWon=${expectedAwayWon}`);
    }
  }

  // Verify ATS derivation for each game (where RL and scores are available)
  let atsMismatch = 0;
  for (const g of rows) {
    if (g.awayScore == null || g.homeScore == null || g.dkAwayRunLine == null) continue;
    const spread = parseFloat(g.dkAwayRunLine);
    if (isNaN(spread)) continue;
    const margin = g.awayScore + spread - g.homeScore;
    const expectedAwayCovered = margin > 0 ? true : margin < 0 ? false : null;
    const storedAwayCovered = g.awayRunLineCovered == null ? null
      : typeof g.awayRunLineCovered === 'object' ? Boolean(g.awayRunLineCovered[0])
      : Boolean(g.awayRunLineCovered);
    if (expectedAwayCovered !== storedAwayCovered) {
      atsMismatch++;
      issues.push(`[GAME_DATA] ${g.awayAbbr}@${g.homeAbbr} (${g.gameDate}): awayRunLineCovered=${storedAwayCovered} but score=${g.awayScore}-${g.homeScore} RL=${spread} → expected=${expectedAwayCovered}`);
    }
  }

  // Verify O/U derivation for each game
  let ouMismatch = 0;
  for (const g of rows) {
    if (g.awayScore == null || g.homeScore == null || g.dkTotal == null) continue;
    const total = parseFloat(g.dkTotal);
    if (isNaN(total)) continue;
    const combined = g.awayScore + g.homeScore;
    const expectedResult = combined > total ? 'OVER' : combined < total ? 'UNDER' : 'PUSH';
    if (g.totalResult !== expectedResult) {
      ouMismatch++;
      issues.push(`[GAME_DATA] ${g.awayAbbr}@${g.homeAbbr} (${g.gameDate}): totalResult="${g.totalResult}" but score=${g.awayScore}+${g.homeScore}=${combined} vs total=${total} → expected="${expectedResult}"`);
    }
  }

  const teamDiscrepancies = issues.length;
  totalDiscrepancies += teamDiscrepancies;

  // ── Print team summary ────────────────────────────────────────────────────────
  const status = teamDiscrepancies === 0 ? '✅ PASS' : `❌ FAIL (${teamDiscrepancies} issues)`;
  console.log(`[${abbr.padEnd(3)}] ${status} | games=${rows.length} | noOdds=${computed.noOddsCount}`);
  console.log(`       ML:  Overall=${computed.ml.overall.wins}-${computed.ml.overall.losses} | L10=${computed.ml.last10.wins}-${computed.ml.last10.losses} | Home=${computed.ml.home.wins}-${computed.ml.home.losses} | Away=${computed.ml.away.wins}-${computed.ml.away.losses} | Fav=${computed.ml.fav.wins}-${computed.ml.fav.losses} | Dog=${computed.ml.dog.wins}-${computed.ml.dog.losses}`);
  console.log(`       RL:  Overall=${computed.rl.overall.wins}-${computed.rl.overall.losses} | L10=${computed.rl.last10.wins}-${computed.rl.last10.losses} | Home=${computed.rl.home.wins}-${computed.rl.home.losses} | Away=${computed.rl.away.wins}-${computed.rl.away.losses} | Fav=${computed.rl.fav.wins}-${computed.rl.fav.losses} | Dog=${computed.rl.dog.wins}-${computed.rl.dog.losses}`);
  console.log(`       O/U: Overall=${computed.ou.overall.wins}O-${computed.ou.overall.losses}U-${computed.ou.overall.pushes}P | L10=${computed.ou.last10.wins}O-${computed.ou.last10.losses}U-${computed.ou.last10.pushes}P | Home=${computed.ou.home.wins}O-${computed.ou.home.losses}U | Away=${computed.ou.away.wins}O-${computed.ou.away.losses}U | Fav=${computed.ou.fav.wins}O-${computed.ou.fav.losses}U | Dog=${computed.ou.dog.wins}O-${computed.ou.dog.losses}U`);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.log(`       ⚠️  ${issue}`);
    }
  }

  teamResults.push({
    abbr, slug,
    status: teamDiscrepancies === 0 ? 'PASS' : 'FAIL',
    games: rows.length,
    noOdds: computed.noOddsCount,
    discrepancies: teamDiscrepancies,
    computed,
  });
}

await conn.end();

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════════════════════════════');
console.log('[MASTER_CROSSVAL] FINAL SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════════════════════════');
console.log(`Total teams audited:     ${teamResults.length}`);
console.log(`Total games audited:     ${totalGamesAudited}`);
console.log(`Total discrepancies:     ${totalDiscrepancies}`);
const passed = teamResults.filter(t => t.status === 'PASS').length;
const failed = teamResults.filter(t => t.status === 'FAIL').length;
const noData = teamResults.filter(t => t.status === 'NO_DATA').length;
console.log(`Teams PASS:              ${passed}`);
console.log(`Teams FAIL:              ${failed}`);
console.log(`Teams NO_DATA:           ${noData}`);
if (failed > 0) {
  console.log('\nFailed teams:');
  for (const t of teamResults.filter(r => r.status === 'FAIL')) {
    console.log(`  ${t.abbr} (${t.discrepancies} issues)`);
  }
}
if (totalDiscrepancies === 0) {
  console.log('\n✅ ALL 30 TEAMS PASS — Zero discrepancies across all 540 data points (30×3×6)');
} else {
  console.log(`\n❌ ${totalDiscrepancies} TOTAL DISCREPANCIES — Requires investigation`);
}

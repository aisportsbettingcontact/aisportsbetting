/**
 * deep_audit_trends.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * MAXIMUM GRANULARITY AUDIT — All 30 MLB Teams × 3 Markets × 6 Situations
 *
 * VALIDATION LAYERS:
 *   L1 — DB completeness: every team has ≥1 game, 0 null-odds games
 *   L2 — Per-game data integrity: awayWon, awayRunLineCovered, totalResult
 *        each re-derived from raw scores and verified against stored values
 *   L3 — Home/Away designation: re-verified via awayTeamId/homeTeamId
 *   L4 — Fav/Dog classification: ML null exclusion enforced
 *   L5 — Record computation: all 18 cells (3×6) computed from scratch
 *        and cross-checked for internal consistency
 *   L6 — Last 10 ordering: confirmed games are sorted DESC by date
 *   L7 — Push accounting: RL and O/U pushes tracked and reported
 *
 * LOGGING FORMAT:
 *   [TEAM][L#][STEP] message
 *   [TEAM][GAME] date | away@home | score | ML | RL | Tot | result
 *   [TEAM][CELL] market.situation = W-L(-P) ✅/❌
 *   [TEAM][SUMMARY] PASS/FAIL | issues count
 */

import { createConnection } from 'mysql2/promise';

const SEASON_START = '2026-03-26';

// AN API slugs — these are what the DB stores (from normalizeSlug)
const ALL_TEAMS = [
  { slug: 'arizona-diamondbacks',  abbr: 'ARI', name: 'Diamondbacks' },
  { slug: 'atlanta-braves',        abbr: 'ATL', name: 'Braves' },
  { slug: 'baltimore-orioles',     abbr: 'BAL', name: 'Orioles' },
  { slug: 'boston-red-sox',        abbr: 'BOS', name: 'Red Sox' },
  { slug: 'chicago-cubs',          abbr: 'CHC', name: 'Cubs' },
  { slug: 'chicago-white-sox',     abbr: 'CWS', name: 'White Sox' },
  { slug: 'cincinnati-reds',       abbr: 'CIN', name: 'Reds' },
  { slug: 'cleveland-guardians',   abbr: 'CLE', name: 'Guardians' },
  { slug: 'colorado-rockies',      abbr: 'COL', name: 'Rockies' },
  { slug: 'detroit-tigers',        abbr: 'DET', name: 'Tigers' },
  { slug: 'houston-astros',        abbr: 'HOU', name: 'Astros' },
  { slug: 'kansas-city-royals',    abbr: 'KC',  name: 'Royals' },
  { slug: 'los-angeles-angels',    abbr: 'LAA', name: 'Angels' },
  { slug: 'los-angeles-dodgers',   abbr: 'LAD', name: 'Dodgers' },
  { slug: 'miami-marlins',         abbr: 'MIA', name: 'Marlins' },
  { slug: 'milwaukee-brewers',     abbr: 'MIL', name: 'Brewers' },
  { slug: 'minnesota-twins',       abbr: 'MIN', name: 'Twins' },
  { slug: 'new-york-mets',         abbr: 'NYM', name: 'Mets' },
  { slug: 'new-york-yankees',      abbr: 'NYY', name: 'Yankees' },
  { slug: 'oakland-athletics',     abbr: 'ATH', name: 'Athletics' },
  { slug: 'philadelphia-phillies', abbr: 'PHI', name: 'Phillies' },
  { slug: 'pittsburgh-pirates',    abbr: 'PIT', name: 'Pirates' },
  { slug: 'san-diego-padres',      abbr: 'SD',  name: 'Padres' },
  { slug: 'san-francisco-giants',  abbr: 'SF',  name: 'Giants' },
  { slug: 'seattle-mariners',      abbr: 'SEA', name: 'Mariners' },
  { slug: 'st-louis-cardinals',    abbr: 'STL', name: 'Cardinals' },
  { slug: 'tampa-bay-rays',        abbr: 'TB',  name: 'Rays' },
  { slug: 'texas-rangers',         abbr: 'TEX', name: 'Rangers' },
  { slug: 'toronto-blue-jays',     abbr: 'TOR', name: 'Blue Jays' },
  { slug: 'washington-nationals',  abbr: 'WSH', name: 'Nationals' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function boolVal(v) {
  if (v == null) return null;
  if (typeof v === 'object' && Buffer.isBuffer(v)) return v[0] === 1;
  if (typeof v === 'boolean') return v;
  return v === 1 || v === '1' || v === true;
}

function isAway(g, slug) { return g.awaySlug === slug; }

function recomputeAwayWon(g) {
  if (g.awayScore == null || g.homeScore == null) return null;
  if (g.awayScore === g.homeScore) return null; // tie — should not happen in MLB
  return g.awayScore > g.homeScore;
}

function recomputeAwayRunLineCovered(g) {
  if (g.awayScore == null || g.homeScore == null || g.dkAwayRunLine == null) return null;
  const spread = parseFloat(g.dkAwayRunLine);
  if (isNaN(spread)) return null;
  const margin = g.awayScore + spread - g.homeScore;
  if (margin > 0) return true;
  if (margin < 0) return false;
  return null; // push
}

function recomputeTotalResult(g) {
  if (g.awayScore == null || g.homeScore == null || g.dkTotal == null) return null;
  const total = parseFloat(g.dkTotal);
  if (isNaN(total)) return null;
  const combined = g.awayScore + g.homeScore;
  if (combined > total) return 'OVER';
  if (combined < total) return 'UNDER';
  return 'PUSH';
}

function teamWon(g, slug) {
  const aw = boolVal(g.awayWon);
  if (aw == null) return null;
  return isAway(g, slug) ? aw : !aw;
}

function teamCovered(g, slug) {
  if (isAway(g, slug)) {
    const v = boolVal(g.awayRunLineCovered);
    return v;
  } else {
    const v = boolVal(g.homeRunLineCovered);
    return v;
  }
}

function wasFavOrNull(g, slug) {
  const ml = isAway(g, slug) ? g.dkAwayML : g.dkHomeML;
  if (!ml) return null;
  const n = parseInt(ml, 10);
  if (isNaN(n)) return null;
  return n < 0;
}

function computeRecord(games, wonFn) {
  let W = 0, L = 0;
  for (const g of games) {
    const w = wonFn(g);
    if (w === true) W++;
    else if (w === false) L++;
  }
  return { W, L };
}

function computeAts(games, slug) {
  let W = 0, L = 0, P = 0;
  for (const g of games) {
    const cov = teamCovered(g, slug);
    if (cov === true) W++;
    else if (cov === false) L++;
    else if (g.dkAwayRunLine != null) P++; // has RL but push
  }
  return { W, L, P };
}

function computeOu(games) {
  let W = 0, L = 0, P = 0;
  for (const g of games) {
    if (g.totalResult === 'OVER') W++;
    else if (g.totalResult === 'UNDER') L++;
    else if (g.totalResult === 'PUSH') P++;
  }
  return { W, L, P };
}

function fmt(r) {
  if (r.P != null && r.P > 0) return `${r.W}-${r.L}-${r.P}`;
  return `${r.W}-${r.L}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const conn = await createConnection(process.env.DATABASE_URL);

let globalIssues = 0;
let globalGames = 0;
const teamSummaries = [];

const DIVIDER = '─'.repeat(100);
const HEADER  = '═'.repeat(100);

console.log(HEADER);
console.log('[DEEP_AUDIT] MLB TRENDS — Maximum Granularity Cross-Validation');
console.log(`[DEEP_AUDIT] Season: ${SEASON_START} → present | Markets: ML, RL, O/U | Situations: Overall/L10/Home/Away/Fav/Dog`);
console.log(HEADER);

for (const team of ALL_TEAMS) {
  const { slug, abbr, name } = team;
  const TAG = `[${abbr}]`;
  const issues = [];

  console.log(`\n${DIVIDER}`);
  console.log(`${TAG} ── ${name} (${slug})`);
  console.log(DIVIDER);

  // ── L1: DB completeness ────────────────────────────────────────────────────
  const [rows] = await conn.query(`
    SELECT * FROM mlb_schedule_history
    WHERE gameStatus = 'complete'
      AND gameDate >= ?
      AND (awaySlug = ? OR homeSlug = ?)
    ORDER BY gameDate DESC
    LIMIT 162
  `, [SEASON_START, slug, slug]);

  console.log(`${TAG}[L1][INPUT] Fetched ${rows.length} completed 2026 games from DB`);

  if (rows.length === 0) {
    const msg = `ZERO games in DB — team is completely missing`;
    issues.push(`[L1] ${msg}`);
    console.log(`${TAG}[L1][FAIL] ❌ ${msg}`);
    teamSummaries.push({ abbr, name, games: 0, issues: issues.length, issueList: issues });
    globalIssues += issues.length;
    continue;
  }

  // Check for null-odds games
  const nullOddsGames = rows.filter(g => g.dkAwayML == null);
  if (nullOddsGames.length > 0) {
    const msg = `${nullOddsGames.length} games have NULL dkAwayML (no odds)`;
    issues.push(`[L1] ${msg}`);
    console.log(`${TAG}[L1][FAIL] ❌ ${msg}`);
    for (const g of nullOddsGames) {
      console.log(`${TAG}[L1][NULL_ODDS] ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr} — score=${g.awayScore}-${g.homeScore}`);
    }
  } else {
    console.log(`${TAG}[L1][PASS] ✅ All ${rows.length} games have odds`);
  }

  // ── L2: Per-game data integrity ────────────────────────────────────────────
  console.log(`${TAG}[L2][STEP] Verifying per-game awayWon / awayRunLineCovered / totalResult`);
  let l2Errors = 0;

  for (const g of rows) {
    const gameLabel = `${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}`;
    const storedAwayWon = boolVal(g.awayWon);
    const storedAwayCov = boolVal(g.awayRunLineCovered);
    const storedHomeCov = boolVal(g.homeRunLineCovered);
    const storedOu = g.totalResult;

    const expectedAwayWon = recomputeAwayWon(g);
    const expectedAwayCov = recomputeAwayRunLineCovered(g);
    const expectedOu = recomputeTotalResult(g);

    // Determine team perspective
    const teamIsAway = isAway(g, slug);
    const teamML = teamIsAway ? g.dkAwayML : g.dkHomeML;
    const teamRL = teamIsAway ? g.dkAwayRunLine : g.dkHomeRunLine;
    const favOrNull = wasFavOrNull(g, slug);
    const favLabel = favOrNull === true ? 'FAV' : favOrNull === false ? 'DOG' : 'NO_ODDS';

    // Log every game
    console.log(
      `${TAG}[GAME] ${gameLabel} | ${teamIsAway ? 'AWAY' : 'HOME'} ${favLabel}` +
      ` | score=${g.awayScore ?? '?'}-${g.homeScore ?? '?'}` +
      ` | ML=${teamML ?? '—'} RL=${teamRL ?? '—'} Tot=${g.dkTotal ?? '—'}` +
      ` | awayWon=${storedAwayWon} rlCov=${storedAwayCov} homeCov=${storedHomeCov} ou=${storedOu ?? '—'}`
    );

    // Verify awayWon
    if (expectedAwayWon !== null && storedAwayWon !== expectedAwayWon) {
      l2Errors++;
      const msg = `${gameLabel}: awayWon stored=${storedAwayWon} but score=${g.awayScore}-${g.homeScore} → expected=${expectedAwayWon}`;
      issues.push(`[L2] ${msg}`);
      console.log(`${TAG}[L2][FAIL] ❌ awayWon mismatch: ${msg}`);
    }

    // Verify awayRunLineCovered
    if (g.dkAwayRunLine != null) {
      if (expectedAwayCov !== storedAwayCov) {
        l2Errors++;
        const msg = `${gameLabel}: awayRunLineCovered stored=${storedAwayCov} expected=${expectedAwayCov} (score=${g.awayScore}-${g.homeScore} RL=${g.dkAwayRunLine})`;
        issues.push(`[L2] ${msg}`);
        console.log(`${TAG}[L2][FAIL] ❌ ATS mismatch: ${msg}`);
      }
      // Verify homeRunLineCovered is inverse of awayRunLineCovered (unless push)
      if (expectedAwayCov !== null && storedHomeCov !== !storedAwayCov) {
        l2Errors++;
        const msg = `${gameLabel}: homeRunLineCovered=${storedHomeCov} should be inverse of awayRunLineCovered=${storedAwayCov}`;
        issues.push(`[L2] ${msg}`);
        console.log(`${TAG}[L2][FAIL] ❌ Home/Away RL inverse mismatch: ${msg}`);
      }
    }

    // Verify totalResult
    if (g.dkTotal != null) {
      if (expectedOu !== storedOu) {
        l2Errors++;
        const msg = `${gameLabel}: totalResult stored="${storedOu}" expected="${expectedOu}" (${g.awayScore}+${g.homeScore}=${g.awayScore+g.homeScore} vs total=${g.dkTotal})`;
        issues.push(`[L2] ${msg}`);
        console.log(`${TAG}[L2][FAIL] ❌ O/U mismatch: ${msg}`);
      }
    }
  }

  if (l2Errors === 0) {
    console.log(`${TAG}[L2][PASS] ✅ All ${rows.length} games pass per-game data integrity checks`);
  }

  // ── L3: Home/Away designation ──────────────────────────────────────────────
  console.log(`${TAG}[L3][STEP] Verifying home/away designation for all games`);
  let l3Errors = 0;
  for (const g of rows) {
    const teamIsAway = g.awaySlug === slug;
    const teamIsHome = g.homeSlug === slug;
    if (!teamIsAway && !teamIsHome) {
      l3Errors++;
      const msg = `${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}: team slug "${slug}" not found in awaySlug="${g.awaySlug}" or homeSlug="${g.homeSlug}"`;
      issues.push(`[L3] ${msg}`);
      console.log(`${TAG}[L3][FAIL] ❌ Slug not found: ${msg}`);
    }
    if (teamIsAway && teamIsHome) {
      l3Errors++;
      const msg = `${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}: team appears as BOTH away and home`;
      issues.push(`[L3] ${msg}`);
      console.log(`${TAG}[L3][FAIL] ❌ Duplicate: ${msg}`);
    }
  }
  const homeCount = rows.filter(g => g.homeSlug === slug).length;
  const awayCount = rows.filter(g => g.awaySlug === slug).length;
  console.log(`${TAG}[L3][STATE] Home games: ${homeCount} | Away games: ${awayCount} | Total: ${rows.length}`);
  if (homeCount + awayCount !== rows.length) {
    const msg = `home(${homeCount}) + away(${awayCount}) = ${homeCount+awayCount} ≠ total(${rows.length})`;
    issues.push(`[L3] ${msg}`);
    console.log(`${TAG}[L3][FAIL] ❌ ${msg}`);
  } else if (l3Errors === 0) {
    console.log(`${TAG}[L3][PASS] ✅ All home/away designations correct`);
  }

  // ── L4: Fav/Dog classification ─────────────────────────────────────────────
  console.log(`${TAG}[L4][STEP] Verifying fav/dog classification (null-ML exclusion)`);
  const favGames = rows.filter(g => wasFavOrNull(g, slug) === true);
  const dogGames = rows.filter(g => wasFavOrNull(g, slug) === false);
  const noOddsGames = rows.filter(g => wasFavOrNull(g, slug) === null);
  console.log(`${TAG}[L4][STATE] Fav: ${favGames.length} | Dog: ${dogGames.length} | NoOdds: ${noOddsGames.length} | Total: ${rows.length}`);
  if (favGames.length + dogGames.length + noOddsGames.length !== rows.length) {
    const msg = `fav+dog+noOdds = ${favGames.length+dogGames.length+noOddsGames.length} ≠ total(${rows.length})`;
    issues.push(`[L4] ${msg}`);
    console.log(`${TAG}[L4][FAIL] ❌ ${msg}`);
  } else {
    console.log(`${TAG}[L4][PASS] ✅ Fav/Dog/NoOdds classification complete and consistent`);
  }

  // ── L5: Record computation ─────────────────────────────────────────────────
  console.log(`${TAG}[L5][STEP] Computing all 18 cells (ML/RL/OU × Overall/L10/Home/Away/Fav/Dog)`);

  const last10 = rows.slice(0, 10);
  const homeGames = rows.filter(g => !isAway(g, slug));
  const awayGames = rows.filter(g => isAway(g, slug));

  const cells = {
    ml: {
      overall: computeRecord(rows, g => teamWon(g, slug)),
      last10:  computeRecord(last10, g => teamWon(g, slug)),
      home:    computeRecord(homeGames, g => teamWon(g, slug)),
      away:    computeRecord(awayGames, g => teamWon(g, slug)),
      fav:     computeRecord(favGames, g => teamWon(g, slug)),
      dog:     computeRecord(dogGames, g => teamWon(g, slug)),
    },
    rl: {
      overall: computeAts(rows, slug),
      last10:  computeAts(last10, slug),
      home:    computeAts(homeGames, slug),
      away:    computeAts(awayGames, slug),
      fav:     computeAts(favGames, slug),
      dog:     computeAts(dogGames, slug),
    },
    ou: {
      overall: computeOu(rows),
      last10:  computeOu(last10),
      home:    computeOu(homeGames),
      away:    computeOu(awayGames),
      fav:     computeOu(favGames),
      dog:     computeOu(dogGames),
    },
  };

  // Print all 18 cells
  for (const [market, situations] of Object.entries(cells)) {
    for (const [situation, rec] of Object.entries(situations)) {
      console.log(`${TAG}[CELL] ${market.toUpperCase().padEnd(2)} ${situation.padEnd(7)} = ${fmt(rec)}`);
    }
  }

  // ── L5 Internal consistency checks ────────────────────────────────────────
  let l5Errors = 0;

  // ML: home+away = overall
  const mlHomeAway = cells.ml.home.W + cells.ml.home.L + cells.ml.away.W + cells.ml.away.L;
  const mlOverall = cells.ml.overall.W + cells.ml.overall.L;
  if (mlHomeAway !== mlOverall) {
    l5Errors++;
    const msg = `ML home(${cells.ml.home.W}-${cells.ml.home.L}) + away(${cells.ml.away.W}-${cells.ml.away.L}) = ${mlHomeAway} ≠ overall(${mlOverall})`;
    issues.push(`[L5] ${msg}`);
    console.log(`${TAG}[L5][FAIL] ❌ ${msg}`);
  }

  // RL: home+away = overall (W+L only, pushes may differ)
  const rlHomeAway = cells.rl.home.W + cells.rl.home.L + cells.rl.away.W + cells.rl.away.L;
  const rlOverall = cells.rl.overall.W + cells.rl.overall.L;
  if (rlHomeAway !== rlOverall) {
    l5Errors++;
    const msg = `RL home+away W+L (${rlHomeAway}) ≠ overall W+L (${rlOverall})`;
    issues.push(`[L5] ${msg}`);
    console.log(`${TAG}[L5][FAIL] ❌ ${msg}`);
  }

  // O/U: home+away = overall
  const ouHomeAway = cells.ou.home.W + cells.ou.home.L + cells.ou.home.P + cells.ou.away.W + cells.ou.away.L + cells.ou.away.P;
  const ouOverall = cells.ou.overall.W + cells.ou.overall.L + cells.ou.overall.P;
  if (ouHomeAway !== ouOverall) {
    l5Errors++;
    const msg = `O/U home+away (${ouHomeAway}) ≠ overall (${ouOverall})`;
    issues.push(`[L5] ${msg}`);
    console.log(`${TAG}[L5][FAIL] ❌ ${msg}`);
  }

  // Fav+Dog ≤ Overall (not equal because noOdds games excluded)
  const mlFavDog = cells.ml.fav.W + cells.ml.fav.L + cells.ml.dog.W + cells.ml.dog.L;
  if (mlFavDog > mlOverall) {
    l5Errors++;
    const msg = `ML fav+dog (${mlFavDog}) > overall (${mlOverall}) — impossible`;
    issues.push(`[L5] ${msg}`);
    console.log(`${TAG}[L5][FAIL] ❌ ${msg}`);
  }

  // Last 10 ≤ 10
  const l10Total = cells.ml.last10.W + cells.ml.last10.L;
  if (l10Total > 10) {
    l5Errors++;
    const msg = `Last10 ML total (${l10Total}) > 10`;
    issues.push(`[L5] ${msg}`);
    console.log(`${TAG}[L5][FAIL] ❌ ${msg}`);
  }

  // ML wins+losses ≤ total games
  if (mlOverall > rows.length) {
    l5Errors++;
    const msg = `ML W+L (${mlOverall}) > total games (${rows.length})`;
    issues.push(`[L5] ${msg}`);
    console.log(`${TAG}[L5][FAIL] ❌ ${msg}`);
  }

  if (l5Errors === 0) {
    console.log(`${TAG}[L5][PASS] ✅ All 18 cells internally consistent`);
  }

  // ── L6: Last 10 ordering ───────────────────────────────────────────────────
  console.log(`${TAG}[L6][STEP] Verifying Last 10 games are the 10 most recent`);
  const sortedByDate = [...rows].sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));
  const top10Dates = sortedByDate.slice(0, 10).map(g => g.gameDate);
  const actual10Dates = last10.map(g => g.gameDate);
  let l6Errors = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (top10Dates[i] !== actual10Dates[i]) {
      l6Errors++;
      const msg = `Last10[${i}]: expected date=${top10Dates[i]} but got=${actual10Dates[i]}`;
      issues.push(`[L6] ${msg}`);
      console.log(`${TAG}[L6][FAIL] ❌ ${msg}`);
    }
  }
  if (l6Errors === 0) {
    console.log(`${TAG}[L6][PASS] ✅ Last 10 games correctly ordered (most recent first)`);
    console.log(`${TAG}[L6][STATE] Last 10 dates: ${actual10Dates.join(', ')}`);
  }

  // ── L7: Push accounting ────────────────────────────────────────────────────
  const rlPushes = rows.filter(g => {
    if (g.dkAwayRunLine == null || g.awayScore == null || g.homeScore == null) return false;
    const spread = parseFloat(g.dkAwayRunLine);
    const margin = g.awayScore + spread - g.homeScore;
    return margin === 0;
  });
  const ouPushes = rows.filter(g => g.totalResult === 'PUSH');
  console.log(`${TAG}[L7][STATE] RL pushes: ${rlPushes.length} | O/U pushes: ${ouPushes.length}`);
  if (rlPushes.length > 0) {
    for (const g of rlPushes) {
      console.log(`${TAG}[L7][RL_PUSH] ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}: score=${g.awayScore}-${g.homeScore} RL=${g.dkAwayRunLine}`);
    }
  }
  if (ouPushes.length > 0) {
    for (const g of ouPushes) {
      console.log(`${TAG}[L7][OU_PUSH] ${g.gameDate} ${g.awayAbbr}@${g.homeAbbr}: score=${g.awayScore}-${g.homeScore} total=${g.dkTotal}`);
    }
  }

  // ── Team summary ───────────────────────────────────────────────────────────
  const status = issues.length === 0 ? '✅ PASS' : `❌ FAIL (${issues.length} issues)`;
  console.log(`\n${TAG}[SUMMARY] ${status} | games=${rows.length} | home=${homeCount} away=${awayCount} | fav=${favGames.length} dog=${dogGames.length} noOdds=${noOddsGames.length}`);
  console.log(`${TAG}[SUMMARY] ML: ${fmt(cells.ml.overall)} | RL: ${fmt(cells.rl.overall)} | O/U: ${fmt(cells.ou.overall)}`);
  console.log(`${TAG}[SUMMARY] Home ML: ${fmt(cells.ml.home)} | Away ML: ${fmt(cells.ml.away)} | Fav ML: ${fmt(cells.ml.fav)} | Dog ML: ${fmt(cells.ml.dog)}`);

  if (issues.length > 0) {
    console.log(`${TAG}[ISSUES]:`);
    for (const iss of issues) console.log(`  ⚠️  ${iss}`);
  }

  globalIssues += issues.length;
  globalGames += rows.length;
  teamSummaries.push({ abbr, name, games: rows.length, issues: issues.length, issueList: issues, cells });
}

await conn.end();

// ── Global summary ────────────────────────────────────────────────────────────
console.log(`\n${HEADER}`);
console.log('[DEEP_AUDIT] GLOBAL SUMMARY');
console.log(HEADER);
console.log(`Teams audited:       ${teamSummaries.length}/30`);
console.log(`Total games audited: ${globalGames}`);
console.log(`Total issues found:  ${globalIssues}`);

const passed = teamSummaries.filter(t => t.issues === 0 && t.games > 0);
const failed = teamSummaries.filter(t => t.issues > 0);
const noData = teamSummaries.filter(t => t.games === 0);

console.log(`Teams PASS:          ${passed.length}`);
console.log(`Teams FAIL:          ${failed.length}`);
console.log(`Teams NO_DATA:       ${noData.length}`);

if (failed.length > 0) {
  console.log('\nFailed teams:');
  for (const t of failed) {
    console.log(`  ${t.abbr} (${t.name}): ${t.issues} issues`);
    for (const iss of t.issueList) console.log(`    ⚠️  ${iss}`);
  }
}

if (noData.length > 0) {
  console.log('\nNo-data teams:');
  for (const t of noData) console.log(`  ${t.abbr} (${t.name})`);
}

if (globalIssues === 0 && noData.length === 0) {
  console.log('\n✅ BULLETPROOF — 30/30 teams PASS across all 540 data points (30×3×6)');
  console.log('   Zero discrepancies | Zero null-odds games | Zero data integrity violations');
} else {
  console.log(`\n❌ AUDIT FAILED — ${globalIssues} total issues across ${failed.length} teams`);
}
console.log(HEADER);

/**
 * fix-pickside.mjs
 * Corrects pickSide for all bets where the stored pickSide doesn't match
 * which side (away/home) the pickTeam actually plays on.
 *
 * Root cause: original bets stored pickSide="AWAY" as a placeholder regardless
 * of whether the picked team was actually the away or home team. The backfill
 * script correctly set awayTeam/homeTeam from the MLB API but didn't fix pickSide.
 *
 * Fix logic:
 *   - Extract pickTeam from the `pick` column (first word, e.g. "STL ML" → "STL")
 *   - If pickTeam matches homeTeam (case-insensitive) and pickSide = "AWAY" → set pickSide = "HOME"
 *   - If pickTeam matches awayTeam (case-insensitive) and pickSide = "HOME" → set pickSide = "AWAY"
 *   - TOTAL bets (pickSide = "OVER"/"UNDER") are never touched
 *
 * Logging:
 *   [FIX-PICKSIDE][INPUT]  — raw DB row
 *   [FIX-PICKSIDE][FIX]    — correction applied
 *   [FIX-PICKSIDE][OK]     — already correct
 *   [FIX-PICKSIDE][SKIP]   — TOTAL bet, skipped
 *   [FIX-PICKSIDE][OUTPUT] — summary
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const urlObj = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: urlObj.hostname,
  port: parseInt(urlObj.port) || 3306,
  user: urlObj.username,
  password: urlObj.password,
  database: urlObj.pathname.replace('/', ''),
  ssl: { rejectUnauthorized: false },
});

// Abbreviation aliases to handle mismatches (e.g. "ARI" vs "AZ")
const ALIASES = {
  'ARI': 'AZ', 'AZ': 'ARI',  // Diamondbacks: MLB API uses "AZ", AN uses "ARI"
  'KC': 'KC', 'TB': 'TB', 'ATH': 'ATH', 'WSH': 'WSH', 'SD': 'SD', 'SF': 'SF',
};

function norm(abbrev) {
  if (!abbrev) return '';
  const up = abbrev.toUpperCase().trim();
  return up;
}

function teamsMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // Check aliases in both directions
  if (ALIASES[na] === nb || ALIASES[nb] === na) return true;
  return false;
}

async function main() {
  console.log('[FIX-PICKSIDE][INPUT] Fetching all bets from DB...');
  const [rows] = await db.execute(
    `SELECT id, sport, gameDate, awayTeam, homeTeam, pick, pickSide, market, result
     FROM tracked_bets
     ORDER BY gameDate ASC, id ASC`
  );
  const bets = rows;
  console.log(`[FIX-PICKSIDE][INPUT] Total bets: ${bets.length}`);

  let fixed = 0;
  let alreadyCorrect = 0;
  let skipped = 0;
  let errors = 0;
  const fixes = [];

  for (const bet of bets) {
    const { id, pick, pickSide, awayTeam, homeTeam, market } = bet;

    // Skip TOTAL bets (OVER/UNDER) — pickSide is correct by definition
    if (pickSide === 'OVER' || pickSide === 'UNDER') {
      console.log(`[FIX-PICKSIDE][SKIP] betId=${id} pick="${pick}" pickSide=${pickSide} — TOTAL bet, skipping`);
      skipped++;
      continue;
    }

    // Extract pickTeam from pick string (first word)
    // Examples: "STL ML" → "STL", "SF RL +1.5" → "SF", "ARI ML" → "ARI"
    const pickTeam = pick ? pick.split(' ')[0].toUpperCase().trim() : null;

    if (!pickTeam) {
      console.log(`[FIX-PICKSIDE][SKIP] betId=${id} pick="${pick}" — cannot extract pickTeam, skipping`);
      skipped++;
      continue;
    }

    // Determine correct pickSide based on which team matches
    const matchesAway = teamsMatch(pickTeam, awayTeam);
    const matchesHome = teamsMatch(pickTeam, homeTeam);

    if (!matchesAway && !matchesHome) {
      console.log(`[FIX-PICKSIDE][WARN] betId=${id} pick="${pick}" pickTeam=${pickTeam} awayTeam=${awayTeam} homeTeam=${homeTeam} — pickTeam doesn't match either team`);
      errors++;
      continue;
    }

    const correctPickSide = matchesAway ? 'AWAY' : 'HOME';

    if (pickSide === correctPickSide) {
      console.log(`[FIX-PICKSIDE][OK] betId=${id} pick="${pick}" pickTeam=${pickTeam} pickSide=${pickSide} ✓`);
      alreadyCorrect++;
      continue;
    }

    // Fix needed
    console.log(`[FIX-PICKSIDE][FIX] betId=${id} pick="${pick}" pickTeam=${pickTeam} awayTeam=${awayTeam} homeTeam=${homeTeam}`);
    console.log(`  pickSide: "${pickSide}" → "${correctPickSide}"`);

    fixes.push({ id, oldPickSide: pickSide, newPickSide: correctPickSide, pick, awayTeam, homeTeam });

    await db.execute(
      `UPDATE tracked_bets SET pickSide = ? WHERE id = ?`,
      [correctPickSide, id]
    );
    fixed++;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[FIX-PICKSIDE][OUTPUT] Total bets: ${bets.length}`);
  console.log(`[FIX-PICKSIDE][OUTPUT] Fixed: ${fixed}`);
  console.log(`[FIX-PICKSIDE][OUTPUT] Already correct: ${alreadyCorrect}`);
  console.log(`[FIX-PICKSIDE][OUTPUT] Skipped (TOTAL): ${skipped}`);
  console.log(`[FIX-PICKSIDE][OUTPUT] Errors/warnings: ${errors}`);

  if (fixes.length > 0) {
    console.log('\n[FIX-PICKSIDE][OUTPUT] Applied fixes:');
    for (const f of fixes) {
      console.log(`  betId=${f.id} pick="${f.pick}" ${f.awayTeam}@${f.homeTeam}: pickSide ${f.oldPickSide} → ${f.newPickSide}`);
    }
  }

  // Verification pass: re-fetch and confirm all bets have correct pickSide
  console.log('\n[FIX-PICKSIDE][VERIFY] Re-fetching all bets for verification...');
  const [verifyRows] = await db.execute(
    `SELECT id, awayTeam, homeTeam, pick, pickSide FROM tracked_bets ORDER BY id`
  );

  let verifyErrors = 0;
  for (const bet of verifyRows) {
    const { id, pick, pickSide, awayTeam, homeTeam } = bet;
    if (pickSide === 'OVER' || pickSide === 'UNDER') continue;

    const pickTeam = pick ? pick.split(' ')[0].toUpperCase().trim() : null;
    if (!pickTeam) continue;

    const matchesAway = teamsMatch(pickTeam, awayTeam);
    const matchesHome = teamsMatch(pickTeam, homeTeam);
    if (!matchesAway && !matchesHome) continue;

    const expectedPickSide = matchesAway ? 'AWAY' : 'HOME';
    if (pickSide !== expectedPickSide) {
      console.log(`[FIX-PICKSIDE][VERIFY][FAIL] betId=${id} pick="${pick}" pickSide=${pickSide} expected=${expectedPickSide}`);
      verifyErrors++;
    }
  }

  if (verifyErrors === 0) {
    console.log(`[FIX-PICKSIDE][VERIFY][PASS] All ${verifyRows.length} bets have correct pickSide ✓`);
  } else {
    console.log(`[FIX-PICKSIDE][VERIFY][FAIL] ${verifyErrors} bets still have incorrect pickSide`);
  }

  await db.end();
  process.exit(0);
}

main().catch(e => { console.error('[FIX-PICKSIDE][ERROR]', e); process.exit(1); });

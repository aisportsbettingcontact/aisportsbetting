/**
 * April 24, 2026 — Model runner for 8 unmodeled MLB + 3 NHL games
 * Step 1: Refresh AN API odds for NHL April 24 (NHL games have no odds yet)
 * Step 2: Run production MLB model for April 24 (8 unmodeled games)
 * Step 3: Run production NHL model for April 24 (3 games)
 */
import { fetchActionNetworkOdds, type AnGameOdds } from "./actionNetworkScraper.js";
import { getDb } from "./db.js";
import { runMlbModelForDate } from "./mlbModelRunner.js";
import { syncNhlModelForToday } from "./nhlModelSync.js";

const DATE = "2026-04-24";

async function refreshNhlOdds(): Promise<number> {
  console.log(`\n[Apr24Runner] ── STEP 1: Refreshing AN API odds for NHL ${DATE} ──`);
  const db = await getDb();

  let nhlGames: AnGameOdds[] = [];
  try {
    nhlGames = await fetchActionNetworkOdds("nhl", DATE);
    console.log(`[Apr24Runner] AN API returned ${nhlGames.length} NHL games for ${DATE}`);
  } catch (err: any) {
    console.error(`[Apr24Runner] AN API fetch error: ${err.message}`);
    return 0;
  }

  // Get DB NHL games for April 24 using raw mysql2 pool
  require('dotenv').config();
  const mysql = require('mysql2/promise');
  const dbUrl = new URL(process.env.DATABASE_URL!.replace('mysql://', 'http://'));
  const pool = mysql.createPool({ host: dbUrl.hostname, port: parseInt(dbUrl.port)||4000, user: dbUrl.username, password: dbUrl.password, database: dbUrl.pathname.slice(1), ssl: { rejectUnauthorized: false }, connectTimeout: 6000, connectionLimit: 2 });

  const [dbGamesRaw] = await pool.query(`SELECT id, awayTeam, homeTeam FROM games WHERE gameDate='${DATE}' AND sport='NHL'`);
  const dbGames = dbGamesRaw as Array<{ id: number; awayTeam: string; homeTeam: string }>;
  console.log(`[Apr24Runner] DB has ${dbGames.length} NHL games for ${DATE}`);

  let updated = 0;
  for (const g of nhlGames) {
    // Use DK NJ lines (primary source per system design)
    const total     = g.dkTotal;
    const overOdds  = g.dkOverOdds  ? parseInt(g.dkOverOdds,  10) : -110;
    const underOdds = g.dkUnderOdds ? parseInt(g.dkUnderOdds, 10) : -110;
    const awayML    = g.dkAwayML    ? parseInt(g.dkAwayML,    10) : null;
    const homeML    = g.dkHomeML    ? parseInt(g.dkHomeML,    10) : null;
    const awayPL    = g.dkAwaySpread;
    const awayPLOdds = g.dkAwaySpreadOdds ? parseInt(g.dkAwaySpreadOdds, 10) : -110;
    const homePL    = g.dkHomeSpread;
    const homePLOdds = g.dkHomeSpreadOdds ? parseInt(g.dkHomeSpreadOdds, 10) : -110;

    console.log(`[Apr24Runner]   ${g.awayFullName}@${g.homeFullName} | total=${total} | awayML=${awayML} | homeML=${homeML} | awayPL=${awayPL}(${awayPLOdds})`);

    if (!total || !awayML || !homeML) {
      console.warn(`[Apr24Runner]   ⚠ Missing DK odds — trying open line fallback`);
      // Try open line
      const oTotal   = g.openTotal;
      const oAwayML  = g.openAwayML  ? parseInt(g.openAwayML,  10) : null;
      const oHomeML  = g.openHomeML  ? parseInt(g.openHomeML,  10) : null;
      if (!oTotal || !oAwayML || !oHomeML) {
        console.warn(`[Apr24Runner]   ✗ No odds available for ${g.awayFullName}@${g.homeFullName} — skipping`);
        continue;
      }
    }

    // Match DB game by team name keywords
    const awayKeyword = g.awayFullName.toLowerCase().split(' ').pop() ?? '';
    const homeKeyword = g.homeFullName.toLowerCase().split(' ').pop() ?? '';
    const match = dbGames.find(r => {
      const dbAway = r.awayTeam.toLowerCase().replace(/_/g, ' ');
      const dbHome = r.homeTeam.toLowerCase().replace(/_/g, ' ');
      return (dbAway.includes(awayKeyword) || awayKeyword.includes(dbAway.split(' ').pop() ?? '')) &&
             (dbHome.includes(homeKeyword) || homeKeyword.includes(dbHome.split(' ').pop() ?? ''));
    });

    if (!match) {
      console.warn(`[Apr24Runner]   ⚠ No DB match for ${g.awayFullName}@${g.homeFullName} (keywords: ${awayKeyword}@${homeKeyword})`);
      // Log all DB games to help debug
      dbGames.forEach(r => console.log(`[Apr24Runner]     DB: id=${r.id} ${r.awayTeam}@${r.homeTeam}`));
      continue;
    }

    const finalTotal    = total ?? g.openTotal!;
    const finalAwayML   = awayML ?? parseInt(g.openAwayML ?? '0', 10);
    const finalHomeML   = homeML ?? parseInt(g.openHomeML ?? '0', 10);
    const finalAwayPL   = awayPL ?? -1.5;
    const finalHomePL   = homePL ?? 1.5;
    const finalAwayPLO  = awayPLOdds;
    const finalHomePLO  = homePLOdds;

    await pool.query(
      `UPDATE games SET
        bookTotal      = ${finalTotal},
        overOdds       = ${overOdds},
        underOdds      = ${underOdds},
        modelTotal     = ${finalTotal},
        awayML         = ${finalAwayML},
        homeML         = ${finalHomeML},
        awayRunLine    = ${finalAwayPL},
        awayRunLineOdds = ${finalAwayPLO},
        homeRunLine    = ${finalHomePL},
        homeRunLineOdds = ${finalHomePLO}
      WHERE id = ${match.id}`
    );
    console.log(`[Apr24Runner]   ✅ id=${match.id} ${match.awayTeam}@${match.homeTeam} | total=${finalTotal} awayML=${finalAwayML} homeML=${finalHomeML} awayPL=${finalAwayPL}(${finalAwayPLO})`);
    updated++;
  }

  console.log(`[Apr24Runner] NHL odds refresh complete: ${updated}/${nhlGames.length} games updated`);
  return updated;
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Apr24Runner] April 24, 2026 — Production Model Pipeline`);
  console.log(`[Apr24Runner] Target: 8 unmodeled MLB + 3 NHL games`);
  console.log(`${'='.repeat(70)}\n`);

  // Step 1: Refresh NHL odds from AN API
  const nhlOddsUpdated = await refreshNhlOdds();

  // Step 2: Run MLB model for April 24 (stale-model fix ensures only unmodeled games run)
  console.log(`\n[Apr24Runner] ── STEP 2: Running MLB model for ${DATE} ──`);
  const mlbResult = await runMlbModelForDate(DATE);
  console.log(`[Apr24Runner] MLB: written=${mlbResult.written}, skipped=${mlbResult.skipped}, errors=${mlbResult.errors}`);
  if (!mlbResult.validation.passed) {
    for (const issue of mlbResult.validation.issues) console.error(`  ✗ ${issue}`);
  }
  for (const w of mlbResult.validation.warnings) console.warn(`  ⚠ ${w}`);

  // Step 3: Run NHL model for April 24
  console.log(`\n[Apr24Runner] ── STEP 3: Running NHL model for ${DATE} ──`);
  const nhlResult = await syncNhlModelForToday("manual", true, false, DATE);
  console.log(`[Apr24Runner] NHL: synced=${nhlResult.synced}, skipped=${nhlResult.skipped}, errors=${nhlResult.errors.length}`);
  for (const e of nhlResult.errors) console.error(`  ✗ ${e}`);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Apr24Runner] ✅ PIPELINE COMPLETE`);
  console.log(`  NHL odds refreshed: ${nhlOddsUpdated} games`);
  console.log(`  MLB modeled:        ${mlbResult.written} written, ${mlbResult.skipped} skipped, ${mlbResult.errors} errors`);
  console.log(`  NHL modeled:        ${nhlResult.synced} synced, ${nhlResult.skipped} skipped, ${nhlResult.errors.length} errors`);
  console.log(`${'='.repeat(70)}\n`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

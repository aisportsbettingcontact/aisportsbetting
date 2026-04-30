/**
 * auditLines.ts — per-game book vs model line alignment audit
 * Validates:
 *   Bug 1: modelTotal must equal bookTotal (all sports)
 *   Bug 2: model spread direction must match book spread direction (MLB RL, NHL PL)
 *
 * Sport-aware column selection:
 *   MLB: awayRunLine (book RL) vs awayModelSpread (model RL)
 *   NHL: awayBookSpread (book PL) vs modelAwayPuckLine (model PL — book-anchored)
 *   NBA: awayBookSpread (book spread) vs awayModelSpread (model spread)
 *
 * Run: pnpm tsx server/auditLines.ts [YYYY-MM-DD]
 */
import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { like } from "drizzle-orm";

async function main() {
  const dateArg = process.argv[2] ?? "2026-04-14";
  const db = await getDb();

  const rows = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    sport: games.sport,
    // MLB run line (book)
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    // Book spread (all sports)
    awayBookSpread: games.awayBookSpread,
    homeBookSpread: games.homeBookSpread,
    // Model spread (MLB/NBA: awayModelSpread; NHL: modelAwayPuckLine)
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    modelAwayPuckLine: games.modelAwayPuckLine,
    modelHomePuckLine: games.modelHomePuckLine,
    // Totals
    bookTotal: games.bookTotal,
    modelTotal: games.modelTotal,
    overOdds: games.overOdds,
    underOdds: games.underOdds,
    modelOverOdds: games.modelOverOdds,
    modelUnderOdds: games.modelUnderOdds,
    // Model run status
    modelRunAt: games.modelRunAt,
  }).from(games)
    .where(like(games.gameDate, `${dateArg}%`));

  let totalBugs = 0;
  let modeled = 0;
  let unmodeled = 0;

  console.log(`\n[AUDIT] ${rows.length} games on ${dateArg}\n`);

  for (const r of rows) {
    const label = `${r.awayTeam}@${r.homeTeam} [${r.sport}]`;
    const isNhl = r.sport === 'NHL';
    const isMlb = r.sport === 'MLB';
    const issues: string[] = [];

    // Skip unmodeled games
    if (!r.modelRunAt) {
      unmodeled++;
      console.log(`[SKIP] ${label} — not yet modeled`);
      continue;
    }
    modeled++;

    // ── Bug 1: modelTotal must equal bookTotal ──────────────────────────────
    const bkTotal = parseFloat(String(r.bookTotal ?? "0"));
    const mdlTotal = parseFloat(String(r.modelTotal ?? "0"));
    if (!isNaN(bkTotal) && !isNaN(mdlTotal) && bkTotal > 0 && mdlTotal > 0) {
      if (Math.abs(bkTotal - mdlTotal) > 0.01) {
        issues.push(`[BUG1-TOTAL] bookTotal=${bkTotal} ≠ modelTotal=${mdlTotal} (delta=${(mdlTotal - bkTotal).toFixed(1)})`);
      }
    }

    // ── Bug 2: model spread direction must match book spread direction ───────
    // For MLB: compare awayRunLine (book RL) vs awayModelSpread (model RL)
    // For NHL: compare awayBookSpread (book PL) vs modelAwayPuckLine (model PL)
    // For NBA: compare awayBookSpread (book spread) vs awayModelSpread (model spread)
    let awayBook: number;
    let awayModelVal: number;
    let spreadColName: string;

    if (isMlb) {
      awayBook = parseFloat(String(r.awayRunLine ?? "0"));
      awayModelVal = parseFloat(String(r.awayModelSpread ?? "0"));
      spreadColName = "awayRunLine vs awayModelSpread";
    } else if (isNhl) {
      awayBook = parseFloat(String(r.awayBookSpread ?? "0"));
      awayModelVal = parseFloat(String(r.modelAwayPuckLine ?? r.awayModelSpread ?? "0"));
      spreadColName = "awayBookSpread vs modelAwayPuckLine";
    } else {
      // NBA
      awayBook = parseFloat(String(r.awayBookSpread ?? "0"));
      awayModelVal = parseFloat(String(r.awayModelSpread ?? "0"));
      spreadColName = "awayBookSpread vs awayModelSpread";
    }

    if (!isNaN(awayBook) && !isNaN(awayModelVal) && awayBook !== 0 && awayModelVal !== 0) {
      const bookSign = awayBook > 0 ? '+' : '-';
      const modelSign = awayModelVal > 0 ? '+' : '-';
      if (bookSign !== modelSign) {
        issues.push(`[BUG2-SPREAD] ${spreadColName}: book=${awayBook} vs model=${awayModelVal} — INVERTED`);
      }
    }

    // ── Report ──────────────────────────────────────────────────────────────
    if (issues.length > 0) {
      totalBugs += issues.length;
      console.log(`[FAIL] ${label}`);
      for (const issue of issues) {
        console.log(`  ${issue}`);
      }
      if (isMlb) {
        console.log(`  BOOK:  RL=${r.awayRunLine}/${r.homeRunLine} | total=${r.bookTotal}(${r.overOdds}/${r.underOdds})`);
        console.log(`  MODEL: RL=${r.awayModelSpread}/${r.homeModelSpread} | total=${r.modelTotal}(${r.modelOverOdds}/${r.modelUnderOdds})`);
      } else if (isNhl) {
        console.log(`  BOOK:  PL=${r.awayBookSpread}/${r.homeBookSpread} | total=${r.bookTotal}(${r.overOdds}/${r.underOdds})`);
        console.log(`  MODEL: PL=${r.modelAwayPuckLine}/${r.modelHomePuckLine} | total=${r.modelTotal}(${r.modelOverOdds}/${r.modelUnderOdds})`);
      } else {
        console.log(`  BOOK:  spread=${r.awayBookSpread}/${r.homeBookSpread} | total=${r.bookTotal}(${r.overOdds}/${r.underOdds})`);
        console.log(`  MODEL: spread=${r.awayModelSpread}/${r.homeModelSpread} | total=${r.modelTotal}(${r.modelOverOdds}/${r.modelUnderOdds})`);
      }
    } else {
      const spreadDisplay = isMlb
        ? `RL=${r.awayRunLine}/${r.homeRunLine}`
        : isNhl
          ? `PL=${r.modelAwayPuckLine}/${r.modelHomePuckLine}`
          : `spread=${r.awayBookSpread}/${r.homeBookSpread}`;
      console.log(`[PASS] ${label} | ${spreadDisplay} | total=${r.bookTotal}==${r.modelTotal}`);
    }
  }

  console.log(`\n[SUMMARY] ${rows.length} games | ${modeled} modeled | ${unmodeled} unmodeled | ${totalBugs} bugs found`);

  if (totalBugs === 0 && modeled > 0) {
    console.log(`[RESULT] ✅ ALL LINES VALIDATED — book-model alignment is correct`);
  } else if (totalBugs > 0) {
    console.log(`[RESULT] ❌ ${totalBugs} ALIGNMENT BUGS DETECTED — review above`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

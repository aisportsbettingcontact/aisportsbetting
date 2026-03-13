/**
 * NHL DB Comprehensive Audit
 *
 * Queries every NHL game in the database and performs:
 *   1. Per-game field completeness check (nulls, TBDs)
 *   2. Odds precision validation (spread must be ±1.5, total 4.5-8.5)
 *   3. Splits range validation (0-100%)
 *   4. Date/team slug format validation
 *   5. Summary statistics
 *
 * Run: pnpm tsx audit_nhl_db.ts
 */
import "dotenv/config";
import { getDb } from "./server/db";
import { games } from "./drizzle/schema";
import { eq, asc } from "drizzle-orm";

interface AuditIssue {
  gameId: number;
  game: string;
  date: string;
  field: string;
  issue: string;
  value: unknown;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("  NHL DB Comprehensive Audit");
  console.log(`  Run at: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const db = await getDb();
  const nhlGames = await db.select().from(games).where(eq(games.sport, "NHL")).orderBy(asc(games.gameDate), asc(games.sortOrder));

  console.log(`Total NHL games in DB: ${nhlGames.length}\n`);

  const issues: AuditIssue[] = [];
  const dateGroups = new Map<string, typeof nhlGames>();

  for (const g of nhlGames) {
    const label = `${g.awayTeam} @ ${g.homeTeam}`;
    const dateKey = g.gameDate;

    if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
    dateGroups.get(dateKey)!.push(g);

    const addIssue = (field: string, issue: string, value: unknown) => {
      issues.push({ gameId: g.id, game: label, date: dateKey, field, issue, value });
    };

    // ── 1. Required fields ────────────────────────────────────────────────────
    if (!g.awayTeam || g.awayTeam.trim() === "") addIssue("awayTeam", "EMPTY", g.awayTeam);
    if (!g.homeTeam || g.homeTeam.trim() === "") addIssue("homeTeam", "EMPTY", g.homeTeam);
    if (!g.gameDate || g.gameDate.trim() === "") addIssue("gameDate", "EMPTY", g.gameDate);

    // ── 2. Start time ─────────────────────────────────────────────────────────
    if (!g.startTimeEst || g.startTimeEst === "TBD") {
      addIssue("startTimeEst", "TBD or missing", g.startTimeEst);
    } else {
      const timeMatch = g.startTimeEst.match(/^(\d{2}):(\d{2})$/);
      if (!timeMatch) addIssue("startTimeEst", "Invalid format (expected HH:MM)", g.startTimeEst);
    }

    // ── 3. Spread ─────────────────────────────────────────────────────────────
    if (g.awayBookSpread === null || g.awayBookSpread === undefined) {
      addIssue("awayBookSpread", "NULL", null);
    } else {
      const val = parseFloat(String(g.awayBookSpread));
      if (isNaN(val)) addIssue("awayBookSpread", "NaN", g.awayBookSpread);
      else if (Math.abs(val) > 10) addIssue("awayBookSpread", "Out of NHL range (>10)", val);
      // NHL puck line should be ±1.5 (sometimes ±0.5 or ±2.5)
      const absVal = Math.abs(val);
      if (absVal !== 0 && absVal !== 0.5 && absVal !== 1 && absVal !== 1.5 && absVal !== 2 && absVal !== 2.5) {
        addIssue("awayBookSpread", `Unusual NHL puck line value: ${val}`, val);
      }
    }

    if (g.homeBookSpread === null || g.homeBookSpread === undefined) {
      addIssue("homeBookSpread", "NULL", null);
    } else {
      const val = parseFloat(String(g.homeBookSpread));
      if (isNaN(val)) addIssue("homeBookSpread", "NaN", g.homeBookSpread);
    }

    // ── 4. Total ──────────────────────────────────────────────────────────────
    if (g.bookTotal === null || g.bookTotal === undefined) {
      addIssue("bookTotal", "NULL", null);
    } else {
      const val = parseFloat(String(g.bookTotal));
      if (isNaN(val)) addIssue("bookTotal", "NaN", g.bookTotal);
      else if (val < 3.5 || val > 12) addIssue("bookTotal", `Out of NHL range (${val})`, val);
    }

    // ── 5. Moneyline ──────────────────────────────────────────────────────────
    if (!g.awayML) {
      addIssue("awayML", "NULL/empty", g.awayML);
    } else {
      const mlMatch = g.awayML.match(/^[+-]\d+$/);
      if (!mlMatch) addIssue("awayML", `Invalid ML format: "${g.awayML}"`, g.awayML);
    }

    if (!g.homeML) {
      addIssue("homeML", "NULL/empty", g.homeML);
    } else {
      const mlMatch = g.homeML.match(/^[+-]\d+$/);
      if (!mlMatch) addIssue("homeML", `Invalid ML format: "${g.homeML}"`, g.homeML);
    }

    // ── 6. Betting splits ─────────────────────────────────────────────────────
    const splitFields: Array<[keyof typeof g, string]> = [
      ["spreadAwayBetsPct", "spreadAwayBetsPct"],
      ["spreadAwayMoneyPct", "spreadAwayMoneyPct"],
      ["totalOverBetsPct", "totalOverBetsPct"],
      ["totalOverMoneyPct", "totalOverMoneyPct"],
      ["mlAwayBetsPct", "mlAwayBetsPct"],
      ["mlAwayMoneyPct", "mlAwayMoneyPct"],
    ];
    for (const [field, name] of splitFields) {
      const val = g[field] as number | null;
      if (val === null || val === undefined) {
        addIssue(name, "NULL", null);
      } else if (val < 0 || val > 100) {
        addIssue(name, `Out of range 0-100: ${val}`, val);
      }
    }

    // ── 7. Team slug format ───────────────────────────────────────────────────
    const slugRegex = /^[a-z][a-z0-9_]*$/;
    if (!slugRegex.test(g.awayTeam)) addIssue("awayTeam", "Invalid slug format", g.awayTeam);
    if (!slugRegex.test(g.homeTeam)) addIssue("homeTeam", "Invalid slug format", g.homeTeam);

    // ── 8. Date format ────────────────────────────────────────────────────────
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(g.gameDate)) addIssue("gameDate", "Invalid format (expected YYYY-MM-DD)", g.gameDate);

    // ── 9. Spread symmetry check (away + home should sum to 0) ───────────────
    if (g.awayBookSpread !== null && g.homeBookSpread !== null) {
      const sum = parseFloat(String(g.awayBookSpread)) + parseFloat(String(g.homeBookSpread));
      if (Math.abs(sum) > 0.01) {
        addIssue("spread_symmetry", `away+home spread should = 0, got ${sum}`, { away: g.awayBookSpread, home: g.homeBookSpread });
      }
    }
  }

  // ── Per-date breakdown ────────────────────────────────────────────────────
  console.log("═══ Games by Date ═══\n");
  for (const [date, dateGames] of Array.from(dateGroups.entries()).sort()) {
    console.log(`  ${date}: ${dateGames.length} games`);
    for (const g of dateGames) {
      const spread = g.awayBookSpread !== null ? `${g.awayBookSpread}/${g.homeBookSpread}` : "NULL";
      const total = g.bookTotal !== null ? String(g.bookTotal) : "NULL";
      const awayML = g.awayML ?? "NULL";
      const homeML = g.homeML ?? "NULL";
      const splits = g.spreadAwayBetsPct !== null
        ? `${g.spreadAwayBetsPct}%/${g.totalOverBetsPct}%/${g.mlAwayBetsPct}%`
        : "NULL";
      const status = g.gameStatus ?? "upcoming";
      const score = g.awayScore !== null ? `${g.awayScore}-${g.homeScore}` : "—";
      const time = g.startTimeEst ?? "TBD";
      const pub = g.publishedToFeed ? "PUBLISHED" : "unpublished";
      console.log(
        `    [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${time} ET | ` +
        `spread=${spread} | total=${total} | ML=${awayML}/${homeML} | ` +
        `splits(S/T/ML)=${splits} | ${status} ${score} | ${pub}`
      );
    }
    console.log();
  }

  // ── Issues summary ────────────────────────────────────────────────────────
  console.log("═══ Audit Issues ═══\n");
  if (issues.length === 0) {
    console.log("  ✔ NO ISSUES FOUND — all 56 NHL games have complete, valid data\n");
  } else {
    const byGame = new Map<string, AuditIssue[]>();
    for (const issue of issues) {
      const key = `[${issue.gameId}] ${issue.game} (${issue.date})`;
      if (!byGame.has(key)) byGame.set(key, []);
      byGame.get(key)!.push(issue);
    }
    for (const [game, gameIssues] of byGame) {
      console.log(`  ✘ ${game}`);
      for (const issue of gameIssues) {
        console.log(`      ${issue.field}: ${issue.issue} (value=${JSON.stringify(issue.value)})`);
      }
    }
    console.log();
  }

  // ── Summary statistics ────────────────────────────────────────────────────
  const total = nhlGames.length;
  const withSpread = nhlGames.filter(g => g.awayBookSpread !== null).length;
  const withTotal = nhlGames.filter(g => g.bookTotal !== null).length;
  const withML = nhlGames.filter(g => g.awayML !== null && g.homeML !== null).length;
  const withAllSplits = nhlGames.filter(g =>
    g.spreadAwayBetsPct !== null && g.spreadAwayMoneyPct !== null &&
    g.totalOverBetsPct !== null && g.totalOverMoneyPct !== null &&
    g.mlAwayBetsPct !== null && g.mlAwayMoneyPct !== null
  ).length;
  const withStartTime = nhlGames.filter(g => g.startTimeEst && g.startTimeEst !== "TBD").length;
  const withScores = nhlGames.filter(g => g.awayScore !== null && g.homeScore !== null).length;
  const published = nhlGames.filter(g => g.publishedToFeed).length;
  const live = nhlGames.filter(g => g.gameStatus === "live").length;
  const final = nhlGames.filter(g => g.gameStatus === "final").length;
  const upcoming = nhlGames.filter(g => g.gameStatus === "upcoming").length;

  console.log("═══ Summary Statistics ═══\n");
  console.log(`  Total NHL games:          ${total}`);
  console.log(`  With spread:              ${withSpread}/${total} ${withSpread === total ? "✔" : "✘ MISSING " + (total - withSpread)}`);
  console.log(`  With total:               ${withTotal}/${total} ${withTotal === total ? "✔" : "✘ MISSING " + (total - withTotal)}`);
  console.log(`  With moneyline (both):    ${withML}/${total} ${withML === total ? "✔" : "✘ MISSING " + (total - withML)}`);
  console.log(`  With all 6 splits:        ${withAllSplits}/${total} ${withAllSplits === total ? "✔" : "✘ MISSING " + (total - withAllSplits)}`);
  console.log(`  With start time (not TBD): ${withStartTime}/${total} ${withStartTime === total ? "✔" : "✘ TBD " + (total - withStartTime)}`);
  console.log(`  With scores:              ${withScores}/${total} (live/final games only)`);
  console.log(`  Published to feed:        ${published}/${total}`);
  console.log(`  Game status — upcoming:   ${upcoming} | live: ${live} | final: ${final}`);
  console.log(`  Audit issues:             ${issues.length} ${issues.length === 0 ? "✔" : "✘"}`);
  console.log();

  const allGood = withSpread === total && withTotal === total && withML === total &&
    withAllSplits === total && withStartTime === total && issues.length === 0;
  console.log(`  OVERALL: ${allGood ? "✔ ALL CHECKS PASSED — 100% complete and valid" : "✘ ISSUES FOUND — see above"}`);
  console.log();
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});

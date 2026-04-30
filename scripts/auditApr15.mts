/**
 * auditApr15.mts
 * Pre-flight audit for April 15, 2026 games
 * Checks DB state: MLB (15) + NHL (6) — modeled, odds, published
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const DATE = "2026-04-15";

console.log(`\n[INPUT] Auditing games table for date=${DATE}`);

const db = await getDb();
const allGames = await db.select({
  id: games.id,
  sport: games.sport,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  startTimeEst: games.startTimeEst,
  modelRunAt: games.modelRunAt,
  publishedToFeed: games.publishedToFeed,
  bookTotal: games.bookTotal,
  awayBookSpread: games.awayBookSpread,
  awayMoneyLine: games.awayMoneyLine,
  modelOverRate: games.modelOverRate,
  modelHomeWinPct: games.modelHomeWinPct,
  modelF5PushPct: games.modelF5PushPct,
  modelPNrfi: games.modelPNrfi,
  f5Total: games.f5Total,
  modelF5OverRate: games.modelF5OverRate,
}).from(games).where(eq(games.gameDate, DATE));

const mlb = allGames.filter(g => g.sport === "MLB");
const nhl = allGames.filter(g => g.sport === "NHL");
const other = allGames.filter(g => g.sport !== "MLB" && g.sport !== "NHL");

console.log(`[STATE] Total games in DB: ${allGames.length} (MLB: ${mlb.length}, NHL: ${nhl.length}, Other: ${other.length})`);

console.log(`\n[STATE] MLB GAMES (${mlb.length}):`);
for (const g of mlb.sort((a, b) => (a.startTimeEst ?? "").localeCompare(b.startTimeEst ?? ""))) {
  const modeled   = g.modelRunAt       ? "✓ MODELED"   : "✗ UNMODELED";
  const published = g.publishedToFeed  ? "✓ PUBLISHED" : "✗ UNPUBLISHED";
  const hasOdds   = g.bookTotal && g.awayBookSpread && g.awayMoneyLine ? "✓ HAS_ODDS" : "✗ NO_ODDS";
  const f5        = g.f5Total          ? `F5=${g.f5Total}` : "F5=null";
  const nrfi      = g.modelPNrfi != null ? `NRFI=${(Number(g.modelPNrfi)*100).toFixed(1)}%` : "NRFI=null";
  console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst ?? "TBD"} | ${hasOdds} | ${modeled} | ${published} | ${f5} | ${nrfi}`);
}

console.log(`\n[STATE] NHL GAMES (${nhl.length}):`);
for (const g of nhl.sort((a, b) => (a.startTimeEst ?? "").localeCompare(b.startTimeEst ?? ""))) {
  const modeled   = g.modelRunAt       ? "✓ MODELED"   : "✗ UNMODELED";
  const published = g.publishedToFeed  ? "✓ PUBLISHED" : "✗ UNPUBLISHED";
  const hasOdds   = g.bookTotal && g.awayMoneyLine ? "✓ HAS_ODDS" : "✗ NO_ODDS";
  console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst ?? "TBD"} | ${hasOdds} | ${modeled} | ${published}`);
}

console.log(`\n[OUTPUT] SUMMARY:`);
console.log(`  MLB: ${mlb.filter(g => g.modelRunAt).length}/${mlb.length} modeled | ${mlb.filter(g => g.publishedToFeed).length}/${mlb.length} published`);
console.log(`  NHL: ${nhl.filter(g => g.modelRunAt).length}/${nhl.length} modeled | ${nhl.filter(g => g.publishedToFeed).length}/${nhl.length} published`);

const mlbNeedModel = mlb.filter(g => !g.modelRunAt);
const nhlNeedModel = nhl.filter(g => !g.modelRunAt);
console.log(`\n[VERIFY] MLB games needing model run: ${mlbNeedModel.length}`);
console.log(`[VERIFY] NHL games needing model run: ${nhlNeedModel.length}`);

if (mlbNeedModel.length > 0) {
  console.log(`[STEP] MLB IDs to model: ${mlbNeedModel.map(g => g.id).join(", ")}`);
}
if (nhlNeedModel.length > 0) {
  console.log(`[STEP] NHL IDs to model: ${nhlNeedModel.map(g => g.id).join(", ")}`);
}

process.exit(0);

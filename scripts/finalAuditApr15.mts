/**
 * finalAuditApr15.mts
 * Full final audit of all April 15, 2026 games — MLB + NHL
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and, like, isNotNull } from "drizzle-orm";

const db = await getDb();

const allGames = await db.select({
  id: games.id,
  sport: games.sport,
  awayTeam: games.awayTeam,
  homeTeam: games.homeTeam,
  awayStartingPitcher: games.awayStartingPitcher,
  homeStartingPitcher: games.homeStartingPitcher,
  bookTotal: games.bookTotal,
  awayML: games.awayML,
  awayRunLine: games.awayRunLine,
  modelRunAt: games.modelRunAt,
  publishedToFeed: games.publishedToFeed,
  modelTotal: games.modelTotal,
  modelOverRate: games.modelOverRate,
  modelHomeWinPct: games.modelHomeWinPct,
  modelAwayWinPct: games.modelAwayWinPct,
  modelPNrfi: games.modelPNrfi,
  modelF5PushPct: games.modelF5PushPct,
  modelF5OverRate: games.modelF5OverRate,
  modelF5HomeWinPct: games.modelF5HomeWinPct,
  nrfiFilterPass: games.nrfiFilterPass,
}).from(games).where(like(games.gameDate, "2026-04-15%"));

const mlb = allGames.filter(g => g.sport === "MLB");
const nhl = allGames.filter(g => g.sport === "NHL");

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  APRIL 15, 2026 — FINAL AUDIT");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  MLB: ${mlb.length} games | NHL: ${nhl.length} games`);
console.log("══════════════════════════════════════════════════════════════════\n");

console.log("── MLB GAMES ──────────────────────────────────────────────────────");
for (const g of mlb) {
  const modeled = !!g.modelRunAt;
  const pub = !!g.publishedToFeed;
  const nrfi = g.modelPNrfi != null ? `${(Number(g.modelPNrfi)*100).toFixed(0)}%` : "null";
  const f5Push = g.modelF5PushPct != null ? `${(Number(g.modelF5PushPct)*100).toFixed(2)}%` : "null";
  const over = g.modelOverRate != null ? `${Number(g.modelOverRate).toFixed(1)}%` : "null";
  const homeWin = g.modelHomeWinPct != null ? `${Number(g.modelHomeWinPct).toFixed(1)}%` : "null";
  const awayWin = g.modelAwayWinPct != null ? `${Number(g.modelAwayWinPct).toFixed(1)}%` : "null";
  const f5Over = g.modelF5OverRate != null ? `${Number(g.modelF5OverRate).toFixed(2)}%` : "null";
  const f5HomeWin = g.modelF5HomeWinPct != null ? `${Number(g.modelF5HomeWinPct).toFixed(1)}%` : "null";
  const nrfiPass = g.nrfiFilterPass ? "✅ PASS" : "❌ FAIL";
  const status = modeled && pub ? "✓PUB" : modeled ? "✓MOD ✗UNPUB" : "✗UNMODELED";

  console.log(`  [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${status}`);
  console.log(`    Starters: ${g.awayStartingPitcher ?? "?"} vs ${g.homeStartingPitcher ?? "?"}`);
  console.log(`    Book: Total=${g.bookTotal} | ML=${g.awayML} | RL=${g.awayRunLine}`);
  console.log(`    Model: Total=${g.modelTotal} Over=${over} | Away=${awayWin} Home=${homeWin}`);
  console.log(`    F5: Over=${f5Over} | HomeWin=${f5HomeWin} | Push=${f5Push}`);
  console.log(`    NRFI: p=${nrfi} | Filter=${nrfiPass}`);
  console.log();
}

console.log("── NHL GAMES ──────────────────────────────────────────────────────");
for (const g of nhl) {
  const pub = !!g.publishedToFeed;
  const modeled = !!g.modelRunAt;
  const status = pub ? "✓PUB" : modeled ? "✓MOD ✗UNPUB" : "✗UNMODELED";
  console.log(`  [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${status} | Total=${g.bookTotal} ML=${g.awayML}`);
}

const mlbModeled = mlb.filter(g => !!g.modelRunAt).length;
const mlbPublished = mlb.filter(g => !!g.publishedToFeed).length;
const nhlPublished = nhl.filter(g => !!g.publishedToFeed).length;

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  FINAL VERIFICATION");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  MLB modeled:   ${mlbModeled}/${mlb.length} ${mlbModeled === mlb.length ? "✅ PASS" : "✗ FAIL"}`);
console.log(`  MLB published: ${mlbPublished}/${mlb.length} ${mlbPublished === mlb.length ? "✅ PASS" : "✗ FAIL"}`);
console.log(`  NHL published: ${nhlPublished}/${nhl.length} ${nhlPublished === nhl.length ? "✅ PASS" : "✗ FAIL"}`);
console.log("══════════════════════════════════════════════════════════════════\n");

process.exit(0);

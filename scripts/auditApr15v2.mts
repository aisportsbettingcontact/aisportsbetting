import { listGames } from "../server/db";

const DATE = "2026-04-15";
console.log(`\n[INPUT] Auditing games for date=${DATE}`);

const allGames = await listGames({ gameDate: DATE });
const mlb = allGames.filter(g => g.sport === "MLB");
const nhl = allGames.filter(g => g.sport === "NHL");

console.log(`[STATE] Total: ${allGames.length} (MLB: ${mlb.length}, NHL: ${nhl.length})`);

console.log(`\n[STATE] MLB GAMES (${mlb.length}):`);
for (const g of mlb.sort((a,b) => (a.startTimeEst ?? "").localeCompare(b.startTimeEst ?? ""))) {
  const modeled   = g.modelRunAt      ? "✓ MODELED"   : "✗ UNMODELED";
  const published = g.publishedToFeed ? "✓ PUBLISHED" : "✗ UNPUBLISHED";
  const hasOdds   = g.bookTotal && g.awayBookSpread && g.awayMoneyLine ? "✓ ODDS" : "✗ NO_ODDS";
  const f5        = g.f5Total         ? `F5=${g.f5Total}` : "F5=null";
  const nrfi      = g.modelPNrfi != null ? `NRFI=${(Number(g.modelPNrfi)*100).toFixed(1)}%` : "NRFI=null";
  console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst ?? "TBD"} | ${hasOdds} | ${modeled} | ${published} | ${f5} | ${nrfi}`);
}

console.log(`\n[STATE] NHL GAMES (${nhl.length}):`);
for (const g of nhl.sort((a,b) => (a.startTimeEst ?? "").localeCompare(b.startTimeEst ?? ""))) {
  const modeled   = g.modelRunAt      ? "✓ MODELED"   : "✗ UNMODELED";
  const published = g.publishedToFeed ? "✓ PUBLISHED" : "✗ UNPUBLISHED";
  const hasOdds   = g.bookTotal && g.awayMoneyLine ? "✓ ODDS" : "✗ NO_ODDS";
  console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst ?? "TBD"} | ${hasOdds} | ${modeled} | ${published}`);
}

console.log(`\n[OUTPUT] SUMMARY:`);
console.log(`  MLB: ${mlb.filter(g => g.modelRunAt).length}/${mlb.length} modeled | ${mlb.filter(g => g.publishedToFeed).length}/${mlb.length} published`);
console.log(`  NHL: ${nhl.filter(g => g.modelRunAt).length}/${nhl.length} modeled | ${nhl.filter(g => g.publishedToFeed).length}/${nhl.length} published`);

const mlbNeedModel = mlb.filter(g => !g.modelRunAt);
const nhlNeedModel = nhl.filter(g => !g.modelRunAt);
console.log(`\n[VERIFY] MLB needing model: ${mlbNeedModel.length} | NHL needing model: ${nhlNeedModel.length}`);
if (mlbNeedModel.length) console.log(`  MLB IDs: ${mlbNeedModel.map(g=>g.id).join(", ")}`);
if (nhlNeedModel.length) console.log(`  NHL IDs: ${nhlNeedModel.map(g=>g.id).join(", ")}`);

process.exit(0);

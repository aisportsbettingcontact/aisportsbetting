import { listGamesByDate } from "../server/db.ts";

const mlb = await listGamesByDate("2026-04-09", "MLB");
const nhl = await listGamesByDate("2026-04-09", "NHL");
const nba = await listGamesByDate("2026-04-09", "NBA");

console.log(`[DB_AUDIT] MLB games for 2026-04-09: ${mlb.length}`);
for (const g of mlb) {
  console.log(`  MLB: ${g.awayTeam} @ ${g.homeTeam} | id=${g.id} | spread=${g.awayBookSpread}/${g.homeBookSpread} | total=${g.bookTotal} | spreadBets=${g.spreadAwayBetsPct} | mlBets=${g.mlAwayBetsPct} | modeled=${g.awayModelSpread != null} | published=${g.publishedToFeed}`);
}

console.log(`[DB_AUDIT] NHL games for 2026-04-09: ${nhl.length}`);
for (const g of nhl) {
  console.log(`  NHL: ${g.awayTeam} @ ${g.homeTeam} | id=${g.id} | spread=${g.awayBookSpread}/${g.homeBookSpread} | total=${g.bookTotal} | spreadBets=${g.spreadAwayBetsPct} | mlBets=${g.mlAwayBetsPct} | modeled=${g.awayModelSpread != null} | published=${g.publishedToFeed}`);
}

console.log(`[DB_AUDIT] NBA games for 2026-04-09: ${nba.length}`);
for (const g of nba) {
  console.log(`  NBA: ${g.awayTeam} @ ${g.homeTeam} | id=${g.id} | spread=${g.awayBookSpread}/${g.homeBookSpread} | total=${g.bookTotal} | spreadBets=${g.spreadAwayBetsPct} | mlBets=${g.mlAwayBetsPct} | modeled=${g.awayModelSpread != null} | published=${g.publishedToFeed}`);
}

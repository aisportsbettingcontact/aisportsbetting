/**
 * fetchMlbSlateApr15.mts
 * Fetches the live AN MLB slate for 2026-04-15 and compares to DB
 * to identify the missing 15th game
 */
import { fetchActionNetworkOdds } from "../server/actionNetworkScraper";
import { listGames } from "../server/db";

const DATE = "2026-04-15";
console.log(`\n[INPUT] Fetching AN MLB slate for date=${DATE}`);

const anGames = await fetchActionNetworkOdds("mlb", DATE);
console.log(`[STATE] AN returned ${anGames.length} MLB games`);

const dbGames = (await listGames({ gameDate: DATE })).filter(g => g.sport === "MLB");
console.log(`[STATE] DB has ${dbGames.length} MLB games`);

console.log(`\n[STATE] AN SLATE (${anGames.length} games):`);
for (const g of anGames) {
  console.log(`  ${g.awayUrlSlug} @ ${g.homeUrlSlug} | RL=${g.dkAwaySpread}/${g.dkHomeSpread} | Total=${g.dkTotal} | ML=${g.dkAwayML}/${g.dkHomeML} | anId=${g.gameId}`);
}

console.log(`\n[STATE] DB GAMES (${dbGames.length} games):`);
for (const g of dbGames) {
  console.log(`  [${g.id}] ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst}`);
}

process.exit(0);

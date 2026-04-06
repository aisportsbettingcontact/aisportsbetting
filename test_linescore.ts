import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // Get a known April 5 game from DB to test with
  const mysql2 = await import("mysql2/promise");
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.execute<mysql2.RowDataPacket[]>(
    "SELECT mlbGamePk, awayTeam, homeTeam FROM games WHERE gameDate = '2026-04-05' AND mlbGamePk IS NOT NULL LIMIT 3"
  );
  await conn.end();

  for (const game of rows) {
    console.log(`\n[TEST] Game: ${game.awayTeam}@${game.homeTeam} gamePk=${game.mlbGamePk}`);
    
    // Linescore (inning-by-inning)
    const lsResp = await fetch(`https://statsapi.mlb.com/api/v1/game/${game.mlbGamePk}/linescore`);
    const ls = await lsResp.json() as any;
    console.log(`  Innings: ${ls.innings?.length}`);
    if (ls.innings?.[0]) {
      console.log(`  Inning 1: away=${ls.innings[0].away?.runs} home=${ls.innings[0].home?.runs}`);
    }
    if (ls.innings?.[4]) {
      const f5Away = ls.innings.slice(0, 5).reduce((s: number, i: any) => s + (i.away?.runs ?? 0), 0);
      const f5Home = ls.innings.slice(0, 5).reduce((s: number, i: any) => s + (i.home?.runs ?? 0), 0);
      console.log(`  F5 score: away=${f5Away} home=${f5Home}`);
    }
    
    // Box score for pitcher Ks and batter HRs
    const bsResp = await fetch(`https://statsapi.mlb.com/api/v1/game/${game.mlbGamePk}/boxscore`);
    const bs = await bsResp.json() as any;
    
    // Pitcher Ks
    const awayPitchers = bs.teams?.away?.pitchers ?? [];
    const homePitchers = bs.teams?.home?.pitchers ?? [];
    const awayPlayers = bs.teams?.away?.players ?? {};
    const homePlayers = bs.teams?.home?.players ?? {};
    
    console.log(`  Away pitchers (${awayPitchers.length}):`);
    for (const pid of awayPitchers.slice(0, 2)) {
      const p = awayPlayers[`ID${pid}`];
      if (p) {
        const ks = p.stats?.pitching?.strikeOuts ?? 0;
        const name = p.person?.fullName;
        console.log(`    ${name}: ${ks} Ks`);
      }
    }
    
    // Batter HRs
    const awayBatters = bs.teams?.away?.batters ?? [];
    let hrCount = 0;
    for (const pid of awayBatters) {
      const p = awayPlayers[`ID${pid}`];
      if (p) {
        const hr = p.stats?.batting?.homeRuns ?? 0;
        if (hr > 0) {
          console.log(`  HR: ${p.person?.fullName} (away) = ${hr}`);
          hrCount++;
        }
      }
    }
    const homeBatters = bs.teams?.home?.batters ?? [];
    for (const pid of homeBatters) {
      const p = homePlayers[`ID${pid}`];
      if (p) {
        const hr = p.stats?.batting?.homeRuns ?? 0;
        if (hr > 0) {
          console.log(`  HR: ${p.person?.fullName} (home) = ${hr}`);
          hrCount++;
        }
      }
    }
    console.log(`  Total HRs in game: ${hrCount}`);
  }
  
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

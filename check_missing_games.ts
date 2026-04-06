import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);

  // Check what games we have in DB per date
  const [dbGames] = await conn.execute<mysql2.RowDataPacket[]>(`
    SELECT gameDate, COUNT(*) as cnt, GROUP_CONCAT(CONCAT(awayTeam,'@',homeTeam) ORDER BY awayTeam SEPARATOR ', ') as matchups
    FROM games
    WHERE sport = 'MLB' AND gameDate BETWEEN '2026-03-25' AND '2026-04-05'
    GROUP BY gameDate
    ORDER BY gameDate
  `);

  console.log("\n[DB GAMES PER DATE]");
  for (const row of dbGames) {
    console.log(`  ${row.gameDate}: ${row.cnt} games — ${row.matchups}`);
  }

  // Check MLB Stats API for actual games played
  const dates = [
    "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29",
    "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03",
    "2026-04-04", "2026-04-05"
  ];

  console.log("\n[MLB STATS API GAMES PER DATE]");
  for (const date of dates) {
    const resp = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&gameType=R&fields=dates,date,games,gamePk,teams,away,home,team,abbreviation,status,detailedState`);
    const data = await resp.json() as any;
    const dateData = data.dates?.[0];
    if (!dateData || !dateData.games || dateData.games.length === 0) {
      console.log(`  ${date}: 0 regular season games (MLB API)`);
      continue;
    }
    const games = dateData.games.filter((g: any) => g.status?.detailedState !== 'Postponed');
    const matchups = games.map((g: any) => `${g.teams?.away?.team?.abbreviation}@${g.teams?.home?.team?.abbreviation}`).join(', ');
    console.log(`  ${date}: ${games.length} games — ${matchups}`);
    await new Promise(r => setTimeout(r, 100));
  }

  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

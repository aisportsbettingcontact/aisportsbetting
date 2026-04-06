import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const date = "20260328";
  const url = `https://api.actionnetwork.com/web/v2/scoreboard/mlb/markets?bookIds=15&customPickTypes=core_bet_type_38_home_runs&date=${date}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      Accept: "application/json",
      Origin: "https://www.actionnetwork.com",
      Referer: "https://www.actionnetwork.com/mlb/props/batting",
    }
  });
  const data = await resp.json() as any;
  
  console.log("Games from AN API:");
  for (const g of (data.games ?? [])) {
    const away = g.away_team;
    const home = g.home_team;
    console.log(`  Game ${g.id}: ${away?.abbr} (id=${away?.id}) @ ${home?.abbr} (id=${home?.id}) — ${g.start_time?.slice(0,10)}`);
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

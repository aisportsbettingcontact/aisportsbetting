import { fetchAnSlate } from './actionNetwork';

async function main() {
  const games = await fetchAnSlate('MLB', '2026-04-26');
  console.log(`[AN] April 26 MLB games: ${games.length}`);
  games.forEach(g => {
    const total = g.odds?.over?.value ?? 'N/A';
    const overOdds = g.odds?.over?.odds ?? 'N/A';
    const underOdds = g.odds?.under?.odds ?? 'N/A';
    const awayML = g.odds?.awayMl?.odds ?? 'N/A';
    const homeML = g.odds?.homeMl?.odds ?? 'N/A';
    const awayRL = g.odds?.awayRl?.value ?? 'N/A';
    console.log(`${g.awayTeam} @ ${g.homeTeam} | total=${total} o${overOdds}/u${underOdds} | ML=${awayML}/${homeML} | RL=${awayRL}`);
  });

  const nhlGames = await fetchAnSlate('NHL', '2026-04-26');
  console.log(`\n[AN] April 26 NHL games: ${nhlGames.length}`);
  nhlGames.forEach(g => {
    const total = g.odds?.over?.value ?? 'N/A';
    const overOdds = g.odds?.over?.odds ?? 'N/A';
    const underOdds = g.odds?.under?.odds ?? 'N/A';
    const awayML = g.odds?.awayMl?.odds ?? 'N/A';
    const homeML = g.odds?.homeMl?.odds ?? 'N/A';
    console.log(`${g.awayTeam} @ ${g.homeTeam} | total=${total} o${overOdds}/u${underOdds} | ML=${awayML}/${homeML}`);
  });
}

main().catch(console.error);

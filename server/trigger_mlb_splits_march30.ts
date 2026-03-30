/**
 * trigger_mlb_splits_march30.ts
 * 
 * Manually triggers the MLB betting splits refresh for March 30, 2026.
 * Writes VSiN run-line, total, and ML splits to all 15 March 30 MLB games in DB.
 * 
 * Run: npx tsx server/trigger_mlb_splits_march30.ts
 */

import "dotenv/config";
import { scrapeVsinMlbBettingSplits } from "./vsinBettingSplitsScraper";
import { listGamesByDate, updateBookOdds } from "./db";

// MLB team VSiN slug → DB abbreviation mapping
const VSIN_MLB_SLUG_TO_ABBREV: Record<string, string> = {
  // AL East
  "new-york-yankees": "NYY",
  "boston-red-sox": "BOS",
  "toronto-blue-jays": "TOR",
  "tampa-bay-rays": "TB",
  "baltimore-orioles": "BAL",
  // AL Central
  "chicago-white-sox": "CWS",
  "cleveland-guardians": "CLE",
  "detroit-tigers": "DET",
  "kansas-city-royals": "KC",
  "minnesota-twins": "MIN",
  // AL West
  "houston-astros": "HOU",
  "los-angeles-angels": "LAA",
  "oakland-athletics": "ATH",
  "athletics": "ATH",
  "oakland-athletics-las-vegas": "ATH",
  "seattle-mariners": "SEA",
  "texas-rangers": "TEX",
  // NL East
  "atlanta-braves": "ATL",
  "miami-marlins": "MIA",
  "new-york-mets": "NYM",
  "philadelphia-phillies": "PHI",
  "washington-nationals": "WSH",
  // NL Central
  "chicago-cubs": "CHC",
  "cincinnati-reds": "CIN",
  "milwaukee-brewers": "MIL",
  "pittsburgh-pirates": "PIT",
  "st-louis-cardinals": "STL",
  "st.-louis-cardinals": "STL",
  // NL West
  "arizona-diamondbacks": "ARI",
  "colorado-rockies": "COL",
  "los-angeles-dodgers": "LAD",
  "san-diego-padres": "SD",
  "san-francisco-giants": "SF",
};

function getMlbAbbrev(slug: string): string | null {
  return VSIN_MLB_SLUG_TO_ABBREV[slug.toLowerCase()] ?? null;
}

async function main() {
  const TAG = "[MLBSplitsTrigger][2026-03-30]";
  const todayStr = "2026-03-30";

  console.log(`${TAG} Starting MLB betting splits refresh for ${todayStr}`);
  console.log("=".repeat(70));

  // ── Step 1: Scrape VSiN MLB splits ─────────────────────────────────────
  console.log(`\n${TAG} [STEP 1] Scraping VSiN MLB splits...`);
  let vsinGames;
  try {
    vsinGames = await scrapeVsinMlbBettingSplits();
    console.log(`${TAG} ✅ Scraped ${vsinGames.length} MLB games from VSiN`);
  } catch (err) {
    console.error(`${TAG} ❌ Scrape failed:`, err);
    process.exit(1);
  }

  if (vsinGames.length === 0) {
    console.error(`${TAG} ❌ No MLB games returned from VSiN — aborting`);
    process.exit(1);
  }

  // ── Step 2: Build slug → abbrev lookup map ──────────────────────────────
  console.log(`\n${TAG} [STEP 2] Building VSiN slug → DB abbrev map...`);
  const vsinMap = new Map<string, { game: typeof vsinGames[0]; swapped: boolean }>();

  for (const g of vsinGames) {
    const awayAbbrev = getMlbAbbrev(g.awayVsinSlug);
    const homeAbbrev = getMlbAbbrev(g.homeVsinSlug);

    if (awayAbbrev && homeAbbrev) {
      vsinMap.set(`${awayAbbrev}@${homeAbbrev}`, { game: g, swapped: false });
      vsinMap.set(`${homeAbbrev}@${awayAbbrev}`, { game: g, swapped: true });
      console.log(`${TAG}   Mapped: ${awayAbbrev} @ ${homeAbbrev} (slugs: ${g.awayVsinSlug} @ ${g.homeVsinSlug})`);
    } else {
      console.warn(`${TAG}   ⚠️  UNRESOLVED: "${g.awayVsinSlug}" → ${awayAbbrev ?? "NULL"} | "${g.homeVsinSlug}" → ${homeAbbrev ?? "NULL"}`);
    }
  }

  console.log(`${TAG} Map has ${vsinMap.size / 2} matchups (${vsinMap.size} keys with both orderings)`);

  // ── Step 3: Fetch today's DB games ─────────────────────────────────────
  console.log(`\n${TAG} [STEP 3] Fetching March 30 MLB games from DB...`);
  const dbGames = await listGamesByDate(todayStr, "MLB");
  console.log(`${TAG} Found ${dbGames.length} MLB games in DB for ${todayStr}`);

  // ── Step 4: Apply splits to each DB game ────────────────────────────────
  console.log(`\n${TAG} [STEP 4] Writing splits to DB...`);
  let updated = 0;
  let noMatch = 0;

  for (const dbGame of dbGames) {
    const key = `${dbGame.awayTeam}@${dbGame.homeTeam}`;
    const entry = vsinMap.get(key);

    if (!entry) {
      console.warn(`${TAG}   ⚠️  NO_MATCH: ${dbGame.awayTeam} @ ${dbGame.homeTeam} (gameId=${dbGame.id}) — not in VSiN splits`);
      noMatch++;
      continue;
    }

    const { game: splits, swapped } = entry;

    // Flip away/home percentages when VSiN and DB have teams in opposite order
    const spreadAwayBetsPct = swapped && splits.spreadAwayBetsPct != null
      ? 100 - splits.spreadAwayBetsPct : splits.spreadAwayBetsPct;
    const spreadAwayMoneyPct = swapped && splits.spreadAwayMoneyPct != null
      ? 100 - splits.spreadAwayMoneyPct : splits.spreadAwayMoneyPct;
    const mlAwayBetsPct = swapped && splits.mlAwayBetsPct != null
      ? 100 - splits.mlAwayBetsPct : splits.mlAwayBetsPct;
    const mlAwayMoneyPct = swapped && splits.mlAwayMoneyPct != null
      ? 100 - splits.mlAwayMoneyPct : splits.mlAwayMoneyPct;

    await updateBookOdds(dbGame.id, {
      spreadAwayBetsPct,
      spreadAwayMoneyPct,
      totalOverBetsPct: splits.totalOverBetsPct,
      totalOverMoneyPct: splits.totalOverMoneyPct,
      mlAwayBetsPct,
      mlAwayMoneyPct,
    });

    updated++;
    const swapNote = swapped ? " [SWAPPED]" : "";
    console.log(
      `${TAG}   ✅ ${dbGame.awayTeam} @ ${dbGame.homeTeam} (id=${dbGame.id})${swapNote}` +
      ` | RL: ${spreadAwayMoneyPct}%H/${spreadAwayBetsPct}%B` +
      ` | Tot: ${splits.totalOverMoneyPct}%H/${splits.totalOverBetsPct}%B` +
      ` | ML: ${mlAwayMoneyPct}%H/${mlAwayBetsPct}%B`
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log(`${TAG} DONE`);
  console.log(`  DB games:   ${dbGames.length}`);
  console.log(`  Updated:    ${updated}`);
  console.log(`  No match:   ${noMatch}`);
  console.log(`  VSiN games: ${vsinGames.length}`);
  
  if (updated === dbGames.length) {
    console.log(`  Status:     ✅ ALL ${updated} GAMES UPDATED`);
  } else {
    console.log(`  Status:     ⚠️  ${noMatch} GAMES MISSING SPLITS`);
  }
  console.log("=".repeat(70));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

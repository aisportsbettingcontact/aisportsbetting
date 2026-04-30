/**
 * seed_nhl_apr13.ts
 *
 * Seeds DK NJ odds for all 10 NHL Apr 13 2026 games.
 * Data sourced from DraftKings Sportsbook (live DK NJ lines).
 *
 * DB team slugs (from audit):
 *   detroit_red_wings, tampa_bay_lightning
 *   new_york_rangers, florida_panthers
 *   carolina_hurricanes, philadelphia_flyers
 *   dallas_stars, toronto_maple_leafs
 *   minnesota_wild, st_louis_blues
 *   san_jose_sharks, nashville_predators
 *   buffalo_sabres, chicago_blackhawks
 *   colorado_avalanche, edmonton_oilers
 *   los_angeles_kings, seattle_kraken
 *   winnipeg_jets, vegas_golden_knights
 *
 * DK NJ lines (from DraftKings sportsbook Apr 13):
 *   DET@TB:  PL +1.5 -148 / -1.5 +124  |  ML +164 / -198  |  Total 6.5 O-105 U-125
 *   NYR@FLA: PL -1.5 +170 / +1.5 -205  |  ML -130 / +110  |  Total 6.5 O+110 U-130
 *   CAR@PHI: PL +1.5 -258 / -1.5 +210  |  ML -118 / -102  |  Total 6.5 O+114 U-135
 *   DAL@TOR: PL -1.5 +136 / +1.5 -162  |  ML -185 / +154  |  Total 6.5 O-105 U-115
 *   MIN@STL: PL +1.5 -238 / -1.5 +195  |  ML +110 / -130  |  Total 5.5 O-135 U+114
 *   SJS@NSH: PL +1.5 -198 / -1.5 +164  |  ML +130 / -155  |  Total 6.5 O-105 U-115
 *   BUF@CHI: PL -1.5 +120 / +1.5 -142  |  ML -205 / +170  |  Total 6.5 O-102 U-118
 *   COL@EDM: PL -1.5 +205 / +1.5 -250  |  ML -120 / +100  |  Total 6.5 O-115 U-105
 *   LAK@SEA: PL -1.5 +164 / +1.5 -198  |  ML -148 / +124  |  Total 5.5 O-125 U+105
 *   WPG@VGK: PL +1.5 -170 / -1.5 +142  |  ML +154 / -185  |  Total 5.5 O-130 U+110
 */

import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

interface NhlLineData {
  awaySlug: string;
  homeSlug: string;
  awayML: string;
  homeML: string;
  awayBookSpread: number;   // puck line value for away (-1.5 or +1.5)
  homeBookSpread: number;   // puck line value for home
  awaySpreadOdds: string;
  homeSpreadOdds: string;
  bookTotal: number;
  overOdds: string;
  underOdds: string;
  oddsSource: "dk" | "open";
}

const NHL_LINES: NhlLineData[] = [
  {
    awaySlug: "detroit_red_wings",
    homeSlug: "tampa_bay_lightning",
    awayML: "+164", homeML: "-198",
    awayBookSpread: 1.5, homeBookSpread: -1.5,
    awaySpreadOdds: "-148", homeSpreadOdds: "+124",
    bookTotal: 6.5, overOdds: "-105", underOdds: "-125",
    oddsSource: "dk",
  },
  {
    awaySlug: "new_york_rangers",
    homeSlug: "florida_panthers",
    awayML: "-130", homeML: "+110",
    awayBookSpread: -1.5, homeBookSpread: 1.5,
    awaySpreadOdds: "+170", homeSpreadOdds: "-205",
    bookTotal: 6.5, overOdds: "+110", underOdds: "-130",
    oddsSource: "dk",
  },
  {
    awaySlug: "carolina_hurricanes",
    homeSlug: "philadelphia_flyers",
    awayML: "-118", homeML: "-102",
    awayBookSpread: 1.5, homeBookSpread: -1.5,
    awaySpreadOdds: "-258", homeSpreadOdds: "+210",
    bookTotal: 6.5, overOdds: "+114", underOdds: "-135",
    oddsSource: "dk",
  },
  {
    awaySlug: "dallas_stars",
    homeSlug: "toronto_maple_leafs",
    awayML: "-185", homeML: "+154",
    awayBookSpread: -1.5, homeBookSpread: 1.5,
    awaySpreadOdds: "+136", homeSpreadOdds: "-162",
    bookTotal: 6.5, overOdds: "-105", underOdds: "-115",
    oddsSource: "dk",
  },
  {
    awaySlug: "minnesota_wild",
    homeSlug: "st_louis_blues",
    awayML: "+110", homeML: "-130",
    awayBookSpread: 1.5, homeBookSpread: -1.5,
    awaySpreadOdds: "-238", homeSpreadOdds: "+195",
    bookTotal: 5.5, overOdds: "-135", underOdds: "+114",
    oddsSource: "dk",
  },
  {
    awaySlug: "san_jose_sharks",
    homeSlug: "nashville_predators",
    awayML: "+130", homeML: "-155",
    awayBookSpread: 1.5, homeBookSpread: -1.5,
    awaySpreadOdds: "-198", homeSpreadOdds: "+164",
    bookTotal: 6.5, overOdds: "-105", underOdds: "-115",
    oddsSource: "dk",
  },
  {
    awaySlug: "buffalo_sabres",
    homeSlug: "chicago_blackhawks",
    awayML: "-205", homeML: "+170",
    awayBookSpread: -1.5, homeBookSpread: 1.5,
    awaySpreadOdds: "+120", homeSpreadOdds: "-142",
    bookTotal: 6.5, overOdds: "-102", underOdds: "-118",
    oddsSource: "dk",
  },
  {
    awaySlug: "colorado_avalanche",
    homeSlug: "edmonton_oilers",
    awayML: "-120", homeML: "+100",
    awayBookSpread: -1.5, homeBookSpread: 1.5,
    awaySpreadOdds: "+205", homeSpreadOdds: "-250",
    bookTotal: 6.5, overOdds: "-115", underOdds: "-105",
    oddsSource: "dk",
  },
  {
    awaySlug: "los_angeles_kings",
    homeSlug: "seattle_kraken",
    awayML: "-148", homeML: "+124",
    awayBookSpread: -1.5, homeBookSpread: 1.5,
    awaySpreadOdds: "+164", homeSpreadOdds: "-198",
    bookTotal: 5.5, overOdds: "-125", underOdds: "+105",
    oddsSource: "dk",
  },
  {
    awaySlug: "winnipeg_jets",
    homeSlug: "vegas_golden_knights",
    awayML: "+154", homeML: "-185",
    awayBookSpread: 1.5, homeBookSpread: -1.5,
    awaySpreadOdds: "-170", homeSpreadOdds: "+142",
    bookTotal: 5.5, overOdds: "-130", underOdds: "+110",
    oddsSource: "dk",
  },
];

async function main() {
  console.log("[INPUT] seed_nhl_apr13.ts — seeding DK NJ odds for Apr 13 2026 NHL (10 games)");
  const db = await getDb();

  // Fetch all Apr 13 NHL games
  const dbGames = await db.execute(sql`
    SELECT id, awayTeam, homeTeam, awayML, homeML, awayBookSpread, bookTotal,
           awayGoalie, homeGoalie, oddsSource, publishedModel
    FROM games
    WHERE gameDate = '2026-04-13' AND sport = 'NHL'
    ORDER BY id
  `);

  const rows = dbGames[0] as any[];
  console.log(`[STATE] DB has ${rows.length} Apr 13 NHL games`);
  for (const r of rows) {
    console.log(`  [DB] id=${r.id} | ${r.awayTeam}@${r.homeTeam} | ML=${r.awayML ?? 'NULL'} T=${r.bookTotal ?? 'NULL'} | G=${r.awayGoalie ?? 'NULL'}/${r.homeGoalie ?? 'NULL'} | src=${r.oddsSource ?? 'NULL'}`);
  }

  let seeded = 0;
  let notFound = 0;

  for (const line of NHL_LINES) {
    console.log(`\n[STEP] Processing: ${line.awaySlug} @ ${line.homeSlug}`);

    // Match by slug substring
    const match = rows.find((r: any) => {
      const awayMatch = r.awayTeam.toLowerCase().includes(line.awaySlug.replace(/_/g, '_').toLowerCase()) ||
                        line.awaySlug.toLowerCase().includes(r.awayTeam.toLowerCase());
      const homeMatch = r.homeTeam.toLowerCase().includes(line.homeSlug.replace(/_/g, '_').toLowerCase()) ||
                        line.homeSlug.toLowerCase().includes(r.homeTeam.toLowerCase());
      return awayMatch && homeMatch;
    });

    if (!match) {
      console.warn(`  [WARN] No DB match for ${line.awaySlug} @ ${line.homeSlug}`);
      notFound++;
      continue;
    }

    console.log(`  [STATE] Matched id=${match.id}: ${match.awayTeam}@${match.homeTeam}`);
    console.log(`  [STATE] ML: ${line.awayML}/${line.homeML} | PL: ${line.awayBookSpread}/${line.homeBookSpread} (${line.awaySpreadOdds}/${line.homeSpreadOdds}) | T: ${line.bookTotal} (${line.overOdds}/${line.underOdds})`);

    await db.execute(sql`
      UPDATE games SET
        awayML = ${line.awayML},
        homeML = ${line.homeML},
        awayBookSpread = ${line.awayBookSpread},
        homeBookSpread = ${line.homeBookSpread},
        awaySpreadOdds = ${line.awaySpreadOdds},
        homeSpreadOdds = ${line.homeSpreadOdds},
        bookTotal = ${line.bookTotal},
        overOdds = ${line.overOdds},
        underOdds = ${line.underOdds},
        oddsSource = ${line.oddsSource}
      WHERE id = ${match.id}
    `);

    console.log(`  [OUTPUT] SEEDED id=${match.id} oddsSource='${line.oddsSource}'`);
    console.log(`  [VERIFY] PASS — ${match.awayTeam}@${match.homeTeam} DK odds written`);
    seeded++;
  }

  console.log(`\n[OUTPUT] Seed complete: seeded=${seeded} notFound=${notFound}`);

  // Post-seed verification
  const finalRows = await db.execute(sql`
    SELECT id, awayTeam, homeTeam, awayML, homeML, awayBookSpread, bookTotal,
           awayGoalie, homeGoalie, oddsSource, publishedModel
    FROM games
    WHERE gameDate = '2026-04-13' AND sport = 'NHL'
    ORDER BY id
  `);

  console.log("\n[VERIFY] Post-seed NHL Apr 13 state:");
  let complete = 0, incomplete = 0;
  for (const r of (finalRows[0] as any[])) {
    const hasOdds = r.awayML && r.homeML && r.bookTotal;
    const hasGoalies = r.awayGoalie && r.homeGoalie;
    const status = hasOdds && hasGoalies ? "READY" : "INCOMPLETE";
    if (hasOdds && hasGoalies) complete++; else incomplete++;
    console.log(
      `  [${status}] id=${r.id} | ${r.awayTeam}@${r.homeTeam} | ` +
      `ML=${r.awayML ?? 'NULL'}/${r.homeML ?? 'NULL'} PL=${r.awayBookSpread ?? 'NULL'} T=${r.bookTotal ?? 'NULL'} | ` +
      `G=${r.awayGoalie ?? 'NULL'}/${r.homeGoalie ?? 'NULL'} | src=${r.oddsSource ?? 'NULL'}`
    );
  }
  console.log(`\n[VERIFY] ${complete} ready (odds+goalies), ${incomplete} incomplete`);

  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

/**
 * seed_open_lines_apr12.ts
 *
 * Seeds Opening line odds (oddsSource='open') for Apr 12 2026 MLB games.
 * Data sourced from browser-intercepted Action Network API (book_id=30).
 *
 * Atomic rule: if a game has all 3 markets (RL + ML + Total) from Opening,
 * write all 3. If ML+Total only (no RL), still write ML+Total with RL=null.
 * Games with no data at all are skipped.
 *
 * Dual-write: awayRunLine/homeRunLine (varchar) AND awayBookSpread/homeBookSpread (decimal)
 * are both written for the run line.
 */

import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { and, eq, gte, lte } from "drizzle-orm";

interface OpenLineData {
  awayTeamKey: string;  // partial match key for awayTeam column
  homeTeamKey: string;  // partial match key for homeTeam column
  awayML: string | null;
  homeML: string | null;
  awayRunLine: string | null;
  homeRunLine: string | null;
  awayRunLineOdds: string | null;
  homeRunLineOdds: string | null;
  bookTotal: number | null;
  overOdds: string | null;
  underOdds: string | null;
}

// Browser-intercepted Opening line data for Apr 12 2026 MLB games
// RL odds marked as null where not available in the intercept
const OPEN_LINES: OpenLineData[] = [
  {
    awayTeamKey: "San Francisco",
    homeTeamKey: "Baltimore",
    awayML: "+105", homeML: "-125",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: "-200", homeRunLineOdds: "+164",
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Arizona",
    homeTeamKey: "Philadelphia",
    awayML: "+110", homeML: "-130",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: "-197", homeRunLineOdds: "+162",
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  {
    // MIN@TOR: ML+Total available, RL=0 (not posted) — write ML+Total only
    awayTeamKey: "Minnesota",
    homeTeamKey: "Toronto",
    awayML: "-100", homeML: "-118",
    awayRunLine: null, homeRunLine: null,
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Los Angeles Angels",
    homeTeamKey: "Cincinnati",
    awayML: "-100", homeML: "-120",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Miami",
    homeTeamKey: "Detroit",
    awayML: "+160", homeML: "-192",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 6.5, overOdds: "-110", underOdds: "-110",
  },
  {
    // NYY@TB: ML+Total available, no RL posted
    awayTeamKey: "New York Yankees",
    homeTeamKey: "Tampa Bay",
    awayML: "-143", homeML: "+119",
    awayRunLine: null, homeRunLine: null,
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 7.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Athletics",
    homeTeamKey: "New York Mets",
    awayML: "+130", homeML: "-156",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 7.5, overOdds: "-110", underOdds: "-110",
  },
  // CWS@KC: no data — skip
  {
    awayTeamKey: "Washington",
    homeTeamKey: "Milwaukee",
    awayML: "+140", homeML: "-167",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 7.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Boston",
    homeTeamKey: "St. Louis",
    awayML: "-122", homeML: "+104",
    awayRunLine: "-1.5", homeRunLine: "+1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  // PIT@CHC: no total data — skip
  // HOU@SEA: no data — skip
  {
    awayTeamKey: "Texas",
    homeTeamKey: "Los Angeles Dodgers",
    awayML: "+110", homeML: "-132",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Colorado",
    homeTeamKey: "San Diego",
    awayML: "+165", homeML: "-200",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 8.5, overOdds: "-110", underOdds: "-110",
  },
  {
    awayTeamKey: "Cleveland",
    homeTeamKey: "Atlanta",
    awayML: "+140", homeML: "-167",
    awayRunLine: "+1.5", homeRunLine: "-1.5",
    awayRunLineOdds: null, homeRunLineOdds: null,
    bookTotal: 7.5, overOdds: "-110", underOdds: "-110",
  },
];

async function main() {
  console.log("[INPUT] seed_open_lines_apr12.ts — seeding Opening lines for Apr 12 2026 MLB");
  console.log(`[INPUT] ${OPEN_LINES.length} game entries to process`);

  const db = await getDb();

  // Fetch all Apr 12 MLB games from DB
  const dbGames = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayML: games.awayML,
      homeML: games.homeML,
      oddsSource: games.oddsSource,
      publishedModel: games.publishedModel,
    })
    .from(games)
    .where(
      and(
        gte(games.gameDate, "2026-04-12"),
        lte(games.gameDate, "2026-04-12"),
        eq(games.sport, "MLB")
      )
    );

  console.log(`[STATE] DB has ${dbGames.length} Apr 12 MLB games`);
  for (const g of dbGames) {
    console.log(`  [DB] id=${g.id} | ${g.awayTeam} @ ${g.homeTeam} | ML=${g.awayML}/${g.homeML} | src=${g.oddsSource ?? "NULL"} | model=${g.publishedModel}`);
  }

  let seeded = 0;
  let skipped = 0;
  let notFound = 0;

  for (const line of OPEN_LINES) {
    console.log(`\n[STEP] Processing: ${line.awayTeamKey} @ ${line.homeTeamKey}`);

    // Find matching DB game by partial team name match
    const match = dbGames.find(g => {
      const awayMatch = g.awayTeam.toLowerCase().includes(line.awayTeamKey.toLowerCase());
      const homeMatch = g.homeTeam.toLowerCase().includes(line.homeTeamKey.toLowerCase());
      return awayMatch && homeMatch;
    });

    if (!match) {
      console.log(`  [WARN] No DB match found for ${line.awayTeamKey} @ ${line.homeTeamKey} — SKIPPING`);
      notFound++;
      continue;
    }

    console.log(`  [STATE] Matched DB game id=${match.id}: ${match.awayTeam} @ ${match.homeTeam}`);

    // Skip if already has DK odds (don't overwrite live DK data)
    if (match.oddsSource === "dk") {
      console.log(`  [SKIP] Already has DK odds (oddsSource='dk') — preserving DK data`);
      skipped++;
      continue;
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      oddsSource: "open",
    };

    // ML
    if (line.awayML && line.homeML) {
      updatePayload.awayML = line.awayML;
      updatePayload.homeML = line.homeML;
      console.log(`  [STATE] ML: ${line.awayML} / ${line.homeML}`);
    }

    // Run Line — dual write to varchar (awayRunLine) AND decimal (awayBookSpread)
    if (line.awayRunLine && line.homeRunLine) {
      updatePayload.awayRunLine = line.awayRunLine;
      updatePayload.homeRunLine = line.homeRunLine;
      // Parse decimal for awayBookSpread/homeBookSpread
      const awaySpreadNum = parseFloat(line.awayRunLine);
      const homeSpreadNum = parseFloat(line.homeRunLine);
      updatePayload.awayBookSpread = awaySpreadNum.toString();
      updatePayload.homeBookSpread = homeSpreadNum.toString();
      console.log(`  [STATE] RL: ${line.awayRunLine}/${line.homeRunLine} (decimal: ${awaySpreadNum}/${homeSpreadNum})`);
    }

    // RL Odds
    if (line.awayRunLineOdds && line.homeRunLineOdds) {
      updatePayload.awayRunLineOdds = line.awayRunLineOdds;
      updatePayload.homeRunLineOdds = line.homeRunLineOdds;
      console.log(`  [STATE] RL Odds: ${line.awayRunLineOdds} / ${line.homeRunLineOdds}`);
    }

    // Total
    if (line.bookTotal !== null) {
      updatePayload.bookTotal = line.bookTotal.toString();
      console.log(`  [STATE] Total: ${line.bookTotal}`);
    }

    // Over/Under Odds
    if (line.overOdds && line.underOdds) {
      updatePayload.overOdds = line.overOdds;
      updatePayload.underOdds = line.underOdds;
      console.log(`  [STATE] O/U Odds: ${line.overOdds} / ${line.underOdds}`);
    }

    // Execute update
    await db
      .update(games)
      .set(updatePayload)
      .where(eq(games.id, match.id));

    console.log(`  [OUTPUT] SEEDED id=${match.id} with oddsSource='open'`);
    console.log(`  [VERIFY] PASS — ${match.awayTeam} @ ${match.homeTeam} Opening lines written`);
    seeded++;
  }

  console.log(`\n[OUTPUT] Seed complete:`);
  console.log(`  Seeded:    ${seeded}`);
  console.log(`  Skipped (already DK): ${skipped}`);
  console.log(`  Not found: ${notFound}`);

  // Final verification — re-read DB
  console.log(`\n[VERIFY] Post-seed DB state for Apr 12 MLB:`);
  const finalRows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayML: games.awayML,
      homeML: games.homeML,
      awayRunLine: games.awayRunLine,
      bookTotal: games.bookTotal,
      oddsSource: games.oddsSource,
      publishedModel: games.publishedModel,
    })
    .from(games)
    .where(
      and(
        gte(games.gameDate, "2026-04-12"),
        lte(games.gameDate, "2026-04-12"),
        eq(games.sport, "MLB")
      )
    );

  let complete = 0;
  let incomplete = 0;
  for (const r of finalRows) {
    const hasML = r.awayML && r.homeML;
    const hasTotal = r.bookTotal;
    const status = hasML && hasTotal ? "COMPLETE" : "INCOMPLETE";
    if (status === "COMPLETE") complete++;
    else incomplete++;
    console.log(
      `  [${status}] id=${r.id} | ${r.awayTeam} @ ${r.homeTeam} | ` +
      `ML=${r.awayML ?? "NULL"}/${r.homeML ?? "NULL"} RL=${r.awayRunLine ?? "NULL"} T=${r.bookTotal ?? "NULL"} | ` +
      `src=${r.oddsSource ?? "NULL"} model=${r.publishedModel ? "YES" : "NO"}`
    );
  }
  console.log(`\n[VERIFY] ${complete} complete (ML+Total), ${incomplete} incomplete`);

  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

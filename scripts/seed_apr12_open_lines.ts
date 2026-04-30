/**
 * seed_apr12_open_lines.ts
 *
 * Seeds Apr 12 MLB games with Opening line data extracted from the AN API
 * via browser intercept (since the sandbox TLS connection to AN API is blocked).
 *
 * Uses the atomic DK-vs-Open switch:
 * - Since DK has no run lines for any game, ALL games use Opening line (oddsSource='open')
 * - Games with all 3 Open markets (RL + ML + Total) get fully seeded and model runs
 * - Games missing any Open market are seeded with whatever is available
 *
 * Data source: AN API v2 browser intercept at 2026-04-11T18:46:58Z
 */

import { db } from "../server/db";
import { games, oddsHistory } from "../drizzle/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { runMlbModelForDate } from "../server/mlbModelRunner";
import { insertOddsHistory } from "../server/db";

// ── AN API Opening line data (extracted from browser intercept) ──────────────
// DK has no run lines for any game → all games use Opening line (oddsSource='open')
const APR12_OPEN_LINES = [
  {
    matchup: "SF@BAL",
    awayAbbr: "SF",
    homeAbbr: "BAL",
    open: { ml_away: 105, ml_home: -125, spread_away: 1.5, spread_away_odds: -200, spread_home: -1.5, spread_home_odds: 164, total: 8.5, over_odds: -110, under_odds: -110 },
    dk:   { ml_away: 109, ml_home: -131, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 8.5, over_odds: -105, under_odds: -115 },
  },
  {
    matchup: "ARI@PHI",
    awayAbbr: "ARI",
    homeAbbr: "PHI",
    open: { ml_away: 110, ml_home: -130, spread_away: 1.5, spread_away_odds: -197, spread_home: -1.5, spread_home_odds: 162, total: 8.5, over_odds: -105, under_odds: -115 },
    dk:   { ml_away: 123, ml_home: -149, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 8.5, over_odds: -108, under_odds: -112 },
  },
  {
    matchup: "MIN@TOR",
    awayAbbr: "MIN",
    homeAbbr: "TOR",
    open: { ml_away: -100, ml_home: -118, spread_away: 0, spread_away_odds: -108, spread_home: 0, spread_home_odds: -108, total: 8.5, over_odds: -105, under_odds: -122 },
    dk:   { ml_away: null, ml_home: null, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
  },
  {
    matchup: "LAA@CIN",
    awayAbbr: "LAA",
    homeAbbr: "CIN",
    open: { ml_away: -100, ml_home: -120, spread_away: 1.5, spread_away_odds: -200, spread_home: -1.5, spread_home_odds: 165, total: 8.5, over_odds: -100, under_odds: -120 },
    dk:   { ml_away: -108, ml_home: -112, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 8, over_odds: -120, under_odds: 100 },
  },
  {
    matchup: "MIA@DET",
    awayAbbr: "MIA",
    homeAbbr: "DET",
    open: { ml_away: 160, ml_home: -192, spread_away: 1.5, spread_away_odds: -152, spread_home: -1.5, spread_home_odds: 126, total: 6.5, over_odds: -100, under_odds: -135 },
    dk:   { ml_away: 169, ml_home: -207, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 6.5, over_odds: -115, under_odds: -105 },
  },
  {
    matchup: "NYY@TB",
    awayAbbr: "NYY",
    homeAbbr: "TB",
    open: { ml_away: -143, ml_home: 119, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 7.5, over_odds: -112, under_odds: -108 },
    dk:   { ml_away: -143, ml_home: 119, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 7.5, over_odds: -110, under_odds: -110 },
  },
  {
    matchup: "ATH@NYM",
    awayAbbr: "ATH",
    homeAbbr: "NYM",
    open: { ml_away: 130, ml_home: -156, spread_away: 1.5, spread_away_odds: -156, spread_home: -1.5, spread_home_odds: 130, total: 7.5, over_odds: -125, under_odds: -105 },
    dk:   { ml_away: 144, ml_home: -175, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 8, over_odds: -110, under_odds: -110 },
  },
  {
    matchup: "CWS@KC",
    awayAbbr: "CWS",
    homeAbbr: "KC",
    open: { ml_away: null, ml_home: null, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
    dk:   { ml_away: null, ml_home: null, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
  },
  {
    matchup: "WSH@MIL",
    awayAbbr: "WSH",
    homeAbbr: "MIL",
    open: { ml_away: 140, ml_home: -167, spread_away: 1.5, spread_away_odds: -152, spread_home: -1.5, spread_home_odds: 126, total: 7.5, over_odds: -116, under_odds: -105 },
    dk:   { ml_away: 159, ml_home: -194, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 7.5, over_odds: -102, under_odds: -118 },
  },
  {
    matchup: "BOS@STL",
    awayAbbr: "BOS",
    homeAbbr: "STL",
    open: { ml_away: -122, ml_home: 104, spread_away: -1.5, spread_away_odds: 132, spread_home: 1.5, spread_home_odds: -158, total: 8.5, over_odds: -122, under_odds: -100 },
    dk:   { ml_away: -126, ml_home: 104, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 9, over_odds: 100, under_odds: -120 },
  },
  {
    matchup: "PIT@CHC",
    awayAbbr: "PIT",
    homeAbbr: "CHC",
    open: { ml_away: 108, ml_home: -126, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
    dk:   { ml_away: 113, ml_home: -136, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
  },
  {
    matchup: "HOU@SEA",
    awayAbbr: "HOU",
    homeAbbr: "SEA",
    open: { ml_away: null, ml_home: null, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
    dk:   { ml_away: null, ml_home: null, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: null, over_odds: null, under_odds: null },
  },
  {
    matchup: "TEX@LAD",
    awayAbbr: "TEX",
    homeAbbr: "LAD",
    open: { ml_away: 110, ml_home: -132, spread_away: 1.5, spread_away_odds: -192, spread_home: -1.5, spread_home_odds: 158, total: 8.5, over_odds: -116, under_odds: -105 },
    dk:   { ml_away: 109, ml_home: -131, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 8.5, over_odds: -115, under_odds: -105 },
  },
  {
    matchup: "COL@SD",
    awayAbbr: "COL",
    homeAbbr: "SD",
    open: { ml_away: 165, ml_home: -200, spread_away: 1.5, spread_away_odds: -125, spread_home: -1.5, spread_home_odds: 105, total: 8.5, over_odds: -100, under_odds: -135 },
    dk:   { ml_away: 189, ml_home: -232, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 8, over_odds: -102, under_odds: -118 },
  },
  {
    matchup: "CLE@ATL",
    awayAbbr: "CLE",
    homeAbbr: "ATL",
    open: { ml_away: 140, ml_home: -167, spread_away: 1.5, spread_away_odds: -152, spread_home: -1.5, spread_home_odds: 126, total: 7.5, over_odds: -116, under_odds: -105 },
    dk:   { ml_away: 153, ml_home: -186, spread_away: null, spread_away_odds: null, spread_home: null, spread_home_odds: null, total: 7.5, over_odds: -115, under_odds: -105 },
  },
];

function fmtOdds(v: number | null): string | null {
  if (v == null) return null;
  return v > 0 ? `+${v}` : `${v}`;
}

async function seedOpenLines() {
  console.log("\n[SEED][INPUT] Seeding Apr 12 MLB games with Opening line data");
  console.log("[SEED][INPUT] Source: AN API v2 browser intercept @ 2026-04-11T18:46:58Z");
  console.log("[SEED][INPUT] Total games to process:", APR12_OPEN_LINES.length);
  console.log("[SEED][INPUT] Logic: DK has no run lines → ALL games use Opening line (oddsSource='open')");

  // Get all Apr 12 MLB games from DB
  const apr12Games = await db.select().from(games).where(
    and(
      gte(games.gameDate, "2026-04-12"),
      lte(games.gameDate, "2026-04-12"),
      eq(games.sport, "MLB")
    )
  );

  console.log(`[SEED][STEP] Found ${apr12Games.length} Apr 12 MLB games in DB`);

  let updated = 0;
  let skipped = 0;
  let noOdds = 0;
  const modelsToRun: number[] = [];

  for (const seedGame of APR12_OPEN_LINES) {
    const { awayAbbr, homeAbbr, open, dk } = seedGame;

    // Find matching DB game by team abbreviation
    const dbGame = apr12Games.find(g => {
      const awayMatch = g.awayTeam?.toUpperCase().includes(awayAbbr.toUpperCase()) ||
                        g.awayTeamAbbr?.toUpperCase() === awayAbbr.toUpperCase();
      const homeMatch = g.homeTeam?.toUpperCase().includes(homeAbbr.toUpperCase()) ||
                        g.homeTeamAbbr?.toUpperCase() === homeAbbr.toUpperCase();
      return awayMatch && homeMatch;
    });

    if (!dbGame) {
      console.warn(`[SEED][WARN] No DB match for ${seedGame.matchup} — skipping`);
      skipped++;
      continue;
    }

    // Atomic DK-vs-Open switch:
    // DK has all 3 markets (spread+odds, total+odds, ML) → use DK
    // Otherwise → use Opening line for ALL fields
    const dkHasAll = dk.spread_away != null && dk.spread_away_odds != null &&
                     dk.total != null && dk.over_odds != null &&
                     dk.ml_away != null;

    const src = dkHasAll ? dk : open;
    const oddsSource: "dk" | "open" = dkHasAll ? "dk" : "open";

    console.log(
      `[SEED][STEP] ${seedGame.matchup} (gameId=${dbGame.id}) | ` +
      `DK_COMPLETE=${dkHasAll} → source=${oddsSource} | ` +
      `RL=${src.spread_away}(${src.spread_away_odds}) T=${src.total}(${src.over_odds}/${src.under_odds}) ML=${src.ml_away}/${src.ml_home}`
    );

    // Check if any odds are available
    const hasAnyOdds = src.ml_away != null || src.total != null || src.spread_away != null;
    if (!hasAnyOdds) {
      console.warn(`[SEED][WARN] ${seedGame.matchup}: No odds available from Open or DK — skipping DB write`);
      noOdds++;
      continue;
    }

    // Build the update payload
    const updatePayload: Record<string, unknown> = {
      oddsSource,
    };

    // ML
    if (src.ml_away != null) {
      updatePayload.awayML = fmtOdds(src.ml_away);
      updatePayload.homeML = fmtOdds(src.ml_home);
    }

    // Total
    if (src.total != null) {
      updatePayload.bookTotal = src.total;
      updatePayload.overOdds = fmtOdds(src.over_odds);
      updatePayload.underOdds = fmtOdds(src.under_odds);
    }

    // Run line (spread) — write to BOTH awayRunLine (varchar) AND awayBookSpread (decimal)
    if (src.spread_away != null) {
      const awaySpreadStr = src.spread_away > 0 ? `+${src.spread_away}` : `${src.spread_away}`;
      const homeSpreadStr = src.spread_home != null
        ? (src.spread_home > 0 ? `+${src.spread_home}` : `${src.spread_home}`)
        : null;

      updatePayload.awayRunLine = awaySpreadStr;
      updatePayload.homeRunLine = homeSpreadStr;
      updatePayload.awayRunLineOdds = fmtOdds(src.spread_away_odds);
      updatePayload.homeRunLineOdds = fmtOdds(src.spread_home_odds);
      updatePayload.awayBookSpread = src.spread_away;
      updatePayload.homeBookSpread = src.spread_home;
      updatePayload.awaySpreadOdds = fmtOdds(src.spread_away_odds);
      updatePayload.homeSpreadOdds = fmtOdds(src.spread_home_odds);
    }

    // Write to DB
    await db.update(games).set(updatePayload).where(eq(games.id, dbGame.id));

    // Insert odds history snapshot
    const now = Date.now();
    await db.insert(oddsHistory).values({
      gameId: dbGame.id,
      sport: "MLB",
      timestamp: now,
      awayML: updatePayload.awayML as string | null ?? null,
      homeML: updatePayload.homeML as string | null ?? null,
      awaySpread: updatePayload.awayRunLine as string | null ?? null,
      homeSpread: updatePayload.homeRunLine as string | null ?? null,
      awaySpreadOdds: updatePayload.awaySpreadOdds as string | null ?? null,
      homeSpreadOdds: updatePayload.homeSpreadOdds as string | null ?? null,
      total: updatePayload.bookTotal as number | null ?? null,
      overOdds: updatePayload.overOdds as string | null ?? null,
      underOdds: updatePayload.underOdds as string | null ?? null,
      lineSource: oddsSource,
    });

    console.log(`[SEED][STATE] ${seedGame.matchup}: DB updated | oddsSource=${oddsSource} | awayML=${updatePayload.awayML} homeML=${updatePayload.homeML} RL=${updatePayload.awayRunLine}(${updatePayload.awayRunLineOdds}) T=${updatePayload.bookTotal}(${updatePayload.overOdds}/${updatePayload.underOdds})`);

    updated++;

    // Check if this game has enough data to run the model
    const hasML = src.ml_away != null;
    const hasTotal = src.total != null;
    const hasRL = src.spread_away != null;
    if (hasML && hasTotal && hasRL) {
      modelsToRun.push(dbGame.id);
    } else {
      console.log(`[SEED][STATE] ${seedGame.matchup}: Skipping model — missing: ${!hasML ? 'ML ' : ''}${!hasTotal ? 'Total ' : ''}${!hasRL ? 'RL' : ''}`);
    }
  }

  console.log(`\n[SEED][OUTPUT] DB writes: ${updated} updated, ${skipped} skipped (no DB match), ${noOdds} skipped (no odds)`);
  console.log(`[SEED][OUTPUT] Games ready for model: ${modelsToRun.length} | IDs: ${modelsToRun.join(', ')}`);

  // Run the MLB model for Apr 12
  if (modelsToRun.length > 0) {
    console.log("\n[SEED][STEP] Running MLB model for Apr 12 ...");
    try {
      const modelResult = await runMlbModelForDate("2026-04-12");
      console.log(`[SEED][OUTPUT] Model run complete: ${JSON.stringify(modelResult)}`);
    } catch (err) {
      console.error("[SEED][ERROR] Model run failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // Final completeness check
  console.log("\n[SEED][VERIFY] Final DB state for Apr 12 MLB games:");
  const finalGames = await db.select().from(games).where(
    and(
      gte(games.gameDate, "2026-04-12"),
      lte(games.gameDate, "2026-04-12"),
      eq(games.sport, "MLB")
    )
  );

  let complete = 0;
  let incomplete = 0;
  for (const g of finalGames) {
    const hasML = g.awayML != null && g.homeML != null;
    const hasTotal = g.bookTotal != null;
    const hasRL = g.awayRunLine != null;
    const hasModel = g.publishedModel === "YES";
    const status = hasML && hasTotal && hasRL ? "COMPLETE" : "INCOMPLETE";
    if (status === "COMPLETE") complete++; else incomplete++;
    console.log(
      `[SEED][VERIFY] ${g.awayTeamAbbr ?? g.awayTeam}@${g.homeTeamAbbr ?? g.homeTeam} | ` +
      `${status} | ML=${g.awayML}/${g.homeML} RL=${g.awayRunLine}(${g.awayRunLineOdds}) T=${g.bookTotal}(${g.overOdds}/${g.underOdds}) | ` +
      `oddsSource=${g.oddsSource ?? 'NULL'} | model=${hasModel ? 'YES' : 'NO'}`
    );
  }

  console.log(`\n[SEED][VERIFY] COMPLETE: ${complete}/15 | INCOMPLETE: ${incomplete}/15`);
  console.log("[SEED][DONE] Apr 12 MLB seed complete");
  process.exit(0);
}

seedOpenLines().catch(err => {
  console.error("[SEED][FATAL]", err);
  process.exit(1);
});

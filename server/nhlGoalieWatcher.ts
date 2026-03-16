/**
 * nhlGoalieWatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated goalie change detection cron.
 *
 * Execution flow (every 10 minutes, 9AM–9PM PST):
 *   1. Fetch ALL upcoming NHL games from the DB for today AND tomorrow
 *   2. Scrape RotoWire starting goalies
 *   3. For EVERY game, log the full goalie status snapshot (who is in net, confirmed vs projected)
 *   4. Cross-reference current scrape vs BOTH:
 *        a. The in-memory snapshot from the PREVIOUS watcher run (detects live changes)
 *        b. The DB values (detects changes since first population)
 *   5. Trigger re-model for ANY change — expected (projected) OR confirmed:
 *        - Goalie name changed (scratch detected)
 *        - Confirmation status changed in EITHER direction (projected→confirmed or confirmed→projected)
 *        - New goalie populated where none existed before
 *   6. Update DB with new goalie data, clear modelRunAt, and call syncNhlModelForToday
 *      with the correct date for each affected game
 *   7. Log all changes with full before/after details and timestamps
 *
 * Schedule: every 10 minutes, 9AM–9PM PST
 * Extended window: also runs outside normal hours if tomorrow's slate is populated
 */

import { and, eq, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { games } from "../drizzle/schema.js";
import type { Game } from "../drizzle/schema.js";
import { scrapeNhlStartingGoalies } from "./nhlRotoWireScraper.js";
import type { NhlLineupGame } from "./nhlRotoWireScraper.js";
import { syncNhlModelForToday } from "./nhlModelSync.js";
import { NHL_BY_DB_SLUG } from "../shared/nhlTeams.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoalieChange {
  gameId:       number;
  gameDate:     string;
  gameLabel:    string;
  side:         "away" | "home";
  oldGoalie:    string | null;
  newGoalie:    string | null;
  oldConfirmed: boolean;
  newConfirmed: boolean;
  changeType:   "scratch" | "confirmation" | "deconfirmation" | "new";
  detectedBy:   "memory_snapshot" | "db_comparison" | "both";
}

export interface GoalieSnapshot {
  gameId:             number;
  gameDate:           string;
  gameLabel:          string;
  awayGoalie:         string | null;
  awayGoalieConfirmed: boolean;
  homeGoalie:         string | null;
  homeGoalieConfirmed: boolean;
  capturedAt:         string;
}

export interface GoalieWatchResult {
  checkedAt:    string;
  gamesChecked: number;
  dates:        string[];
  snapshots:    GoalieSnapshot[];
  changes:      GoalieChange[];
  modelRerun:   boolean;
  rerunDates:   string[];
  errors:       string[];
}

let lastWatchResult: GoalieWatchResult | null = null;

// In-memory snapshot from the PREVIOUS watcher run, keyed by gameId
// This is the primary change-detection mechanism — more granular than DB comparison
// because DB values are updated immediately after each change
const previousRunSnapshot = new Map<number, GoalieSnapshot>();

export function getLastGoalieWatchResult(): GoalieWatchResult | null {
  return lastWatchResult;
}

/** Expose the previous run snapshot for debugging */
export function getPreviousGoalieSnapshot(): Map<number, GoalieSnapshot> {
  return previousRunSnapshot;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDateET(offsetDays = 0): string {
  const now = new Date();
  if (offsetDays !== 0) {
    now.setDate(now.getDate() + offsetDays);
  }
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

function getPSTHour(): number {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(pstStr, 10);
}

function isWithinWatchWindow(): boolean {
  const h = getPSTHour();
  return h >= 9 && h < 21;
}

/**
 * Normalize a goalie name for comparison.
 * Compares last names to handle "J. Swayman" vs "Jeremy Swayman".
 */
function normalizeGoalieName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Check if two goalie names refer to the same player (last-name comparison).
 */
function isSameGoalie(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return normalizeGoalieName(a) === normalizeGoalieName(b);
}

/**
 * Match a scraped RotoWire game to a DB game by team abbreviations.
 * RotoWire returns 3-letter abbrevs (e.g. "BOS"), DB stores dbSlugs (e.g. "boston_bruins").
 */
function matchGameToDb(rotoGame: NhlLineupGame, dbGames: Game[]): Game | null {
  const rotoAway = rotoGame.awayTeam.toUpperCase();
  const rotoHome = rotoGame.homeTeam.toUpperCase();

  // Primary match: convert dbSlug → abbrev via NHL_BY_DB_SLUG
  const abbrevMatch = dbGames.find(g => {
    const dbAwayAbbrev = NHL_BY_DB_SLUG.get(g.awayTeam ?? "")?.abbrev?.toUpperCase() ?? "";
    const dbHomeAbbrev = NHL_BY_DB_SLUG.get(g.homeTeam ?? "")?.abbrev?.toUpperCase() ?? "";
    return dbAwayAbbrev === rotoAway && dbHomeAbbrev === rotoHome;
  });
  if (abbrevMatch) return abbrevMatch;

  // Fallback: direct string match (in case DB stores abbrevs directly)
  const directMatch = dbGames.find(
    g => (g.awayTeam ?? "").toUpperCase() === rotoAway &&
         (g.homeTeam ?? "").toUpperCase() === rotoHome
  );
  return directMatch ?? null;
}

// ─── Core Watch Function ──────────────────────────────────────────────────────

export async function checkGoalieChanges(source: "auto" | "manual" = "auto"): Promise<GoalieWatchResult> {
  const tag = source === "manual" ? "[MANUAL]" : "[AUTO]";
  const checkedAt = new Date().toISOString();
  const todayDate = getDateET(0);
  const tomorrowDate = getDateET(1);

  console.log(`\n${"─".repeat(70)}`);
  console.log(`[GoalieWatcher]${tag} ► RUN START — ${checkedAt}`);
  console.log(`[GoalieWatcher]${tag}   Watching dates: today=${todayDate}, tomorrow=${tomorrowDate}`);
  console.log(`[GoalieWatcher]${tag}   Previous snapshot size: ${previousRunSnapshot.size} game(s)`);
  console.log(`${"─".repeat(70)}`);

  const result: GoalieWatchResult = {
    checkedAt,
    gamesChecked: 0,
    dates: [todayDate, tomorrowDate],
    snapshots: [],
    changes: [],
    modelRerun: false,
    rerunDates: [],
    errors: [],
  };

  // ── Step 1: Fetch ALL upcoming NHL games for today AND tomorrow ──────────────
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
    if (!db) {
      result.errors.push("Database not available");
      lastWatchResult = result;
      return result;
    }
  } catch (err) {
    result.errors.push(`DB connection error: ${err}`);
    lastWatchResult = result;
    return result;
  }

  const allGames = await db
    .select()
    .from(games)
    .where(
      and(
        or(
          eq(games.gameDate, todayDate),
          eq(games.gameDate, tomorrowDate)
        ),
        eq(games.sport, "NHL")
        // NOTE: Watch ALL statuses per GoalieWatcher Game Inclusion rule
        // (upcoming, live, final — goalie data tracked for every game)
      )
    );

  const todayGames    = allGames.filter(g => g.gameDate === todayDate);
  const tomorrowGames = allGames.filter(g => g.gameDate === tomorrowDate);

  result.gamesChecked = allGames.length;

  console.log(`[GoalieWatcher]${tag} Step 1: DB query complete`);
  console.log(`[GoalieWatcher]${tag}   Today (${todayDate}):    ${todayGames.length} NHL game(s)`);
  console.log(`[GoalieWatcher]${tag}   Tomorrow (${tomorrowDate}): ${tomorrowGames.length} NHL game(s)`);

  if (allGames.length === 0) {
    console.log(`[GoalieWatcher]${tag} No NHL games for today or tomorrow — nothing to watch`);
    lastWatchResult = result;
    return result;
  }

  // Log current DB state for all games (full snapshot before scrape)
  console.log(`\n[GoalieWatcher]${tag} ── DB State Snapshot (before scrape) ──`);
  for (const g of allGames) {
    const awayStatus = g.awayGoalie
      ? `${g.awayGoalie} (${g.awayGoalieConfirmed ? "CONFIRMED" : "PROJECTED"})`
      : "TBD";
    const homeStatus = g.homeGoalie
      ? `${g.homeGoalie} (${g.homeGoalieConfirmed ? "CONFIRMED" : "PROJECTED"})`
      : "TBD";
    console.log(
      `[GoalieWatcher]${tag}   [${g.gameDate}] ${g.awayTeam} @ ${g.homeTeam} | ` +
      `status=${g.gameStatus} | modelRunAt=${g.modelRunAt ? "SET" : "NULL"} | ` +
      `AWAY: ${awayStatus} | HOME: ${homeStatus}`
    );
  }

  // ── Step 2: Scrape RotoWire starting goalies ─────────────────────────────────
  console.log(`\n[GoalieWatcher]${tag} Step 2: Scraping RotoWire starting goalies...`);

  let rotoGames: NhlLineupGame[] = [];
  try {
    rotoGames = await scrapeNhlStartingGoalies();
    console.log(`[GoalieWatcher]${tag}   RotoWire returned ${rotoGames.length} game(s)`);

    // Log every scraped game
    for (const rg of rotoGames) {
      const awayGoalie = rg.awayGoalie
        ? `${rg.awayGoalie.name} (${rg.awayGoalie.confirmed ? "CONFIRMED" : "PROJECTED"})`
        : "TBD";
      const homeGoalie = rg.homeGoalie
        ? `${rg.homeGoalie.name} (${rg.homeGoalie.confirmed ? "CONFIRMED" : "PROJECTED"})`
        : "TBD";
      console.log(
        `[GoalieWatcher]${tag}   RotoWire: ${rg.awayTeam} @ ${rg.homeTeam} | ` +
        `AWAY: ${awayGoalie} | HOME: ${homeGoalie}`
      );
    }
  } catch (err) {
    const msg = `RotoWire scrape failed: ${err}`;
    console.error(`[GoalieWatcher]${tag} ⚠ ${msg}`);
    result.errors.push(msg);
    lastWatchResult = result;
    return result;
  }

  if (rotoGames.length === 0) {
    console.warn(`[GoalieWatcher]${tag} ⚠ RotoWire returned 0 games — page may not have lineups yet`);
    lastWatchResult = result;
    return result;
  }

  // ── Step 3: Compare scraped goalies vs DB + previous run snapshot ─────────────
  console.log(`\n[GoalieWatcher]${tag} Step 3: Cross-referencing goalies (DB + memory snapshot)...`);

  // Map: gameDate → list of game IDs that need model re-run
  const rerunByDate = new Map<string, number[]>();

  // Build current run snapshot (will replace previousRunSnapshot at end)
  const currentRunSnapshot = new Map<number, GoalieSnapshot>();

  for (const rotoGame of rotoGames) {
    const dbGame = matchGameToDb(rotoGame, allGames);
    if (!dbGame) {
      console.log(`[GoalieWatcher]${tag}   ⚠ No DB match for: ${rotoGame.awayTeam} @ ${rotoGame.homeTeam}`);
      continue;
    }

    const gameLabel = `${dbGame.awayTeam} @ ${dbGame.homeTeam}`;
    const gameDate  = dbGame.gameDate ?? todayDate;
    const prevSnap  = previousRunSnapshot.get(dbGame.id);

    // Build current snapshot for this game
    const currentSnap: GoalieSnapshot = {
      gameId:              dbGame.id,
      gameDate,
      gameLabel,
      awayGoalie:          rotoGame.awayGoalie?.name ?? null,
      awayGoalieConfirmed: rotoGame.awayGoalie?.confirmed ?? false,
      homeGoalie:          rotoGame.homeGoalie?.name ?? null,
      homeGoalieConfirmed: rotoGame.homeGoalie?.confirmed ?? false,
      capturedAt:          checkedAt,
    };
    currentRunSnapshot.set(dbGame.id, currentSnap);
    result.snapshots.push(currentSnap);

    const gameChanges: GoalieChange[] = [];

    // ── Check AWAY goalie ───────────────────────────────────────────────────────
    if (rotoGame.awayGoalie) {
      const rotoName      = rotoGame.awayGoalie.name;
      const rotoConfirmed = rotoGame.awayGoalie.confirmed;

      // Compare vs DB
      const dbName        = dbGame.awayGoalie;
      const dbConfirmed   = dbGame.awayGoalieConfirmed ?? false;
      const dbNameChanged = !isSameGoalie(dbName, rotoName);
      const dbConfChanged = dbConfirmed !== rotoConfirmed;

      // Compare vs previous run snapshot
      const prevName        = prevSnap?.awayGoalie ?? null;
      const prevConfirmed   = prevSnap?.awayGoalieConfirmed ?? false;
      const memNameChanged  = prevSnap ? !isSameGoalie(prevName, rotoName) : false;
      const memConfChanged  = prevSnap ? prevConfirmed !== rotoConfirmed : false;

      const anyChange = dbNameChanged || dbConfChanged || memNameChanged || memConfChanged;

      if (anyChange) {
        let changeType: GoalieChange["changeType"];
        if (!dbName && !prevName) {
          changeType = "new";
        } else if (dbNameChanged || memNameChanged) {
          changeType = "scratch";
        } else if (rotoConfirmed && (!dbConfirmed || !prevConfirmed)) {
          changeType = "confirmation";
        } else {
          changeType = "deconfirmation";
        }

        const detectedBy: GoalieChange["detectedBy"] =
          (dbNameChanged || dbConfChanged) && (memNameChanged || memConfChanged) ? "both"
          : (memNameChanged || memConfChanged) ? "memory_snapshot"
          : "db_comparison";

        const change: GoalieChange = {
          gameId: dbGame.id, gameDate, gameLabel, side: "away",
          oldGoalie: prevSnap ? prevName : dbName ?? null,
          newGoalie: rotoName,
          oldConfirmed: prevSnap ? prevConfirmed : dbConfirmed,
          newConfirmed: rotoConfirmed,
          changeType,
          detectedBy,
        };
        gameChanges.push(change);

        console.log(
          `[GoalieWatcher]${tag}   🔄 AWAY [${changeType.toUpperCase()}] [${gameDate}] ${gameLabel}\n` +
          `[GoalieWatcher]${tag}      DB:   "${dbName ?? "TBD"}" (${dbConfirmed ? "confirmed" : "projected"})\n` +
          `[GoalieWatcher]${tag}      PREV: "${prevName ?? "TBD"}" (${prevConfirmed ? "confirmed" : "projected"})\n` +
          `[GoalieWatcher]${tag}      NOW:  "${rotoName}" (${rotoConfirmed ? "confirmed" : "projected"})\n` +
          `[GoalieWatcher]${tag}      Detected by: ${detectedBy}`
        );
      }
    }

    // ── Check HOME goalie ───────────────────────────────────────────────────────
    if (rotoGame.homeGoalie) {
      const rotoName      = rotoGame.homeGoalie.name;
      const rotoConfirmed = rotoGame.homeGoalie.confirmed;

      // Compare vs DB
      const dbName        = dbGame.homeGoalie;
      const dbConfirmed   = dbGame.homeGoalieConfirmed ?? false;
      const dbNameChanged = !isSameGoalie(dbName, rotoName);
      const dbConfChanged = dbConfirmed !== rotoConfirmed;

      // Compare vs previous run snapshot
      const prevName        = prevSnap?.homeGoalie ?? null;
      const prevConfirmed   = prevSnap?.homeGoalieConfirmed ?? false;
      const memNameChanged  = prevSnap ? !isSameGoalie(prevName, rotoName) : false;
      const memConfChanged  = prevSnap ? prevConfirmed !== rotoConfirmed : false;

      const anyChange = dbNameChanged || dbConfChanged || memNameChanged || memConfChanged;

      if (anyChange) {
        let changeType: GoalieChange["changeType"];
        if (!dbName && !prevName) {
          changeType = "new";
        } else if (dbNameChanged || memNameChanged) {
          changeType = "scratch";
        } else if (rotoConfirmed && (!dbConfirmed || !prevConfirmed)) {
          changeType = "confirmation";
        } else {
          changeType = "deconfirmation";
        }

        const detectedBy: GoalieChange["detectedBy"] =
          (dbNameChanged || dbConfChanged) && (memNameChanged || memConfChanged) ? "both"
          : (memNameChanged || memConfChanged) ? "memory_snapshot"
          : "db_comparison";

        const change: GoalieChange = {
          gameId: dbGame.id, gameDate, gameLabel, side: "home",
          oldGoalie: prevSnap ? prevName : dbName ?? null,
          newGoalie: rotoName,
          oldConfirmed: prevSnap ? prevConfirmed : dbConfirmed,
          newConfirmed: rotoConfirmed,
          changeType,
          detectedBy,
        };
        gameChanges.push(change);

        console.log(
          `[GoalieWatcher]${tag}   🔄 HOME [${changeType.toUpperCase()}] [${gameDate}] ${gameLabel}\n` +
          `[GoalieWatcher]${tag}      DB:   "${dbName ?? "TBD"}" (${dbConfirmed ? "confirmed" : "projected"})\n` +
          `[GoalieWatcher]${tag}      PREV: "${prevName ?? "TBD"}" (${prevConfirmed ? "confirmed" : "projected"})\n` +
          `[GoalieWatcher]${tag}      NOW:  "${rotoName}" (${rotoConfirmed ? "confirmed" : "projected"})\n` +
          `[GoalieWatcher]${tag}      Detected by: ${detectedBy}`
        );
      }
    }

    // ── Apply changes ───────────────────────────────────────────────────────────
    if (gameChanges.length > 0) {
      result.changes.push(...gameChanges);

      // Build DB update payload
      const updatePayload: Record<string, unknown> = {};
      for (const change of gameChanges) {
        if (change.side === "away") {
          updatePayload.awayGoalie          = change.newGoalie;
          updatePayload.awayGoalieConfirmed = change.newConfirmed;
        } else {
          updatePayload.homeGoalie          = change.newGoalie;
          updatePayload.homeGoalieConfirmed = change.newConfirmed;
        }
      }

      // Queue model re-run for upcoming games (live/final already started)
      if (dbGame.gameStatus === "upcoming") {
        updatePayload.modelRunAt = null;
        const dateList = rerunByDate.get(gameDate) ?? [];
        dateList.push(dbGame.id);
        rerunByDate.set(gameDate, dateList);
        console.log(
          `[GoalieWatcher]${tag}   ✅ Queued model re-run for [${gameDate}] ${gameLabel} ` +
          `(${gameChanges.length} goalie change(s))`
        );
      } else {
        console.log(
          `[GoalieWatcher]${tag}   ℹ Goalie updated for [${gameDate}] ${gameLabel} ` +
          `(${dbGame.gameStatus}) — no model re-run needed`
        );
      }

      try {
        await db.update(games).set(updatePayload).where(eq(games.id, dbGame.id));
        console.log(`[GoalieWatcher]${tag}   💾 DB updated for [${gameDate}] ${gameLabel}`);
      } catch (err) {
        const msg = `DB update failed for ${gameLabel}: ${err}`;
        console.error(`[GoalieWatcher]${tag} ⚠ ${msg}`);
        result.errors.push(msg);
      }
    } else {
      // Always silently populate missing goalie data (first time goalies appear)
      const awayMissing = !dbGame.awayGoalie && rotoGame.awayGoalie;
      const homeMissing = !dbGame.homeGoalie && rotoGame.homeGoalie;

      if (awayMissing || homeMissing) {
        const silentUpdate: Record<string, unknown> = {};
        if (awayMissing && rotoGame.awayGoalie) {
          silentUpdate.awayGoalie          = rotoGame.awayGoalie.name;
          silentUpdate.awayGoalieConfirmed = rotoGame.awayGoalie.confirmed;
        }
        if (homeMissing && rotoGame.homeGoalie) {
          silentUpdate.homeGoalie          = rotoGame.homeGoalie.name;
          silentUpdate.homeGoalieConfirmed = rotoGame.homeGoalie.confirmed;
        }

        // If BOTH goalies are now available and model hasn't run yet → queue model run
        const awayGoalieAfter = (awayMissing && rotoGame.awayGoalie) ? rotoGame.awayGoalie.name : dbGame.awayGoalie;
        const homeGoalieAfter = (homeMissing && rotoGame.homeGoalie) ? rotoGame.homeGoalie.name : dbGame.homeGoalie;
        const bothGoaliesNowAvailable = !!awayGoalieAfter && !!homeGoalieAfter;
        const modelNotYetRun = !dbGame.modelRunAt;
        const isUpcoming = dbGame.gameStatus === "upcoming";

        if (bothGoaliesNowAvailable && modelNotYetRun && isUpcoming) {
          silentUpdate.modelRunAt = null;
          const dateList = rerunByDate.get(gameDate) ?? [];
          dateList.push(dbGame.id);
          rerunByDate.set(gameDate, dateList);
          console.log(
            `[GoalieWatcher]${tag}   🆕 BOTH goalies now available for [${gameDate}] ${gameLabel} — queuing model run`
          );
        }

        try {
          await db.update(games).set(silentUpdate).where(eq(games.id, dbGame.id));
          console.log(
            `[GoalieWatcher]${tag}   📝 Populated goalies for [${gameDate}] ${gameLabel}: ` +
            `away=${awayGoalieAfter ?? "TBD"} home=${homeGoalieAfter ?? "TBD"}`
          );
        } catch (err) {
          console.warn(`[GoalieWatcher]${tag} Silent goalie update failed for ${gameLabel}: ${err}`);
        }
      } else {
        // No changes — log the stable state
        const awayStatus = rotoGame.awayGoalie
          ? `${rotoGame.awayGoalie.name} (${rotoGame.awayGoalie.confirmed ? "✓ confirmed" : "~ projected"})`
          : "TBD";
        const homeStatus = rotoGame.homeGoalie
          ? `${rotoGame.homeGoalie.name} (${rotoGame.homeGoalie.confirmed ? "✓ confirmed" : "~ projected"})`
          : "TBD";
        console.log(
          `[GoalieWatcher]${tag}   ✓ No change [${gameDate}] ${gameLabel} | ` +
          `AWAY: ${awayStatus} | HOME: ${homeStatus}`
        );
      }
    }
  }

  // ── Step 4: Re-run model for each date that had changes ───────────────────────
  console.log(`\n[GoalieWatcher]${tag} Step 4: Model re-run check...`);

  if (rerunByDate.size === 0) {
    console.log(`[GoalieWatcher]${tag}   No goalie changes requiring model re-run`);
  } else {
    for (const [date, gameIds] of Array.from(rerunByDate.entries())) {
      console.log(
        `[GoalieWatcher]${tag}   🚀 Triggering NHL model for ${date} ` +
        `(${gameIds.length} game(s) affected: ids=[${gameIds.join(", ")}])...`
      );
      try {
        const syncResult = await syncNhlModelForToday("auto", false, false, date);
        result.modelRerun = true;
        result.rerunDates.push(date);
        console.log(
          `[GoalieWatcher]${tag}   ✅ Model re-run complete for ${date}: ` +
          `synced=${syncResult.synced} skipped=${syncResult.skipped} errors=${syncResult.errors.length}`
        );
        if (syncResult.errors.length > 0) {
          console.warn(
            `[GoalieWatcher]${tag}   ⚠ Model errors for ${date}: ${syncResult.errors.join("; ")}`
          );
        }
      } catch (err) {
        const msg = `Model run failed for ${date}: ${err}`;
        console.error(`[GoalieWatcher]${tag} ⚠ ${msg}`);
        result.errors.push(msg);
      }
    }
  }

  // ── Step 5: Update in-memory snapshot for next run ────────────────────────────
  // Replace the previous snapshot with the current run's data
  previousRunSnapshot.clear();
  for (const [id, snap] of Array.from(currentRunSnapshot.entries())) {
    previousRunSnapshot.set(id, snap);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n[GoalieWatcher]${tag} ── RUN SUMMARY ──`);
  console.log(`[GoalieWatcher]${tag}   Games checked:  ${result.gamesChecked} (today: ${todayGames.length}, tomorrow: ${tomorrowGames.length})`);
  console.log(`[GoalieWatcher]${tag}   Goalie changes: ${result.changes.length}`);
  console.log(`[GoalieWatcher]${tag}   Model re-runs:  ${result.rerunDates.length > 0 ? result.rerunDates.join(", ") : "none"}`);
  console.log(`[GoalieWatcher]${tag}   Errors:         ${result.errors.length}`);
  console.log(`[GoalieWatcher]${tag}   Snapshot saved: ${currentRunSnapshot.size} game(s) for next run`);

  if (result.changes.length > 0) {
    console.log(`[GoalieWatcher]${tag}   Change details:`);
    for (const c of result.changes) {
      console.log(
        `[GoalieWatcher]${tag}     [${c.changeType.toUpperCase()}] [${c.gameDate}] ${c.gameLabel} ` +
        `${c.side.toUpperCase()}: "${c.oldGoalie ?? "TBD"}" (${c.oldConfirmed ? "confirmed" : "projected"}) → ` +
        `"${c.newGoalie ?? "TBD"}" (${c.newConfirmed ? "confirmed" : "projected"}) [${c.detectedBy}]`
      );
    }
  }

  console.log(`${"─".repeat(70)}\n`);

  lastWatchResult = result;
  return result;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let watcherIntervalId: ReturnType<typeof setInterval> | null = null;

export function startNhlGoalieWatcher(): void {
  if (watcherIntervalId) {
    console.log("[GoalieWatcher] Already running — skipping duplicate start");
    return;
  }

  console.log("[GoalieWatcher] ► Starting NHL goalie change watcher (every 10 min, 9AM–9PM PST)");
  console.log("[GoalieWatcher]   Watches: today + tomorrow | Triggers: name change OR confirmation change");

  // Run immediately on startup if within window
  if (isWithinWatchWindow()) {
    console.log("[GoalieWatcher]   Running initial check now (within window)...");
    checkGoalieChanges("auto").catch(err => {
      console.error("[GoalieWatcher] Initial run error:", err);
    });
  } else {
    console.log(`[GoalieWatcher]   Outside window (PST hour: ${getPSTHour()}) — first check at 9AM PST`);
  }

  // Then every 10 minutes
  watcherIntervalId = setInterval(() => {
    if (!isWithinWatchWindow()) {
      console.log(`[GoalieWatcher] Outside sync window (9AM–9PM PST, current PST hour: ${getPSTHour()}) — skipping`);
      return;
    }
    checkGoalieChanges("auto").catch(err => {
      console.error("[GoalieWatcher] Interval run error:", err);
    });
  }, 10 * 60 * 1000);

  console.log("[GoalieWatcher] ✅ Watcher started — runs every 10 minutes (9AM–9PM PST)");
}

export function stopNhlGoalieWatcher(): void {
  if (watcherIntervalId) {
    clearInterval(watcherIntervalId);
    watcherIntervalId = null;
    console.log("[GoalieWatcher] Stopped");
  }
}

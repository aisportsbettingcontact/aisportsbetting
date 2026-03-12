/**
 * ncaamModelWatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated background watcher for the v9 model origination engine.
 *
 * EXECUTION MODEL — fully independent of all other pipelines:
 *   • Slate population  (vsinAutoRefresh.ts)  ← untouched
 *   • Odds refresh      (vsinAutoRefresh.ts)  ← untouched
 *   • Score refresh     (scoreRefresh.ts)     ← untouched
 *   • THIS watcher      (ncaamModelWatcher.ts) ← runs independently
 *
 * HOW IT WORKS:
 *   1. Polls the DB every POLL_INTERVAL_MS (60 seconds by default).
 *   2. Finds all NCAAM games for today that have book lines (awayBookSpread +
 *      bookTotal populated) but NO model projections (awayModelSpread IS NULL).
 *   3. For each such game, immediately dispatches a v9 engine run.
 *   4. Writes all 13 projection fields to the DB on success.
 *   5. Logs every step with structured [ModelWatcher] prefix for easy grepping.
 *
 * CONCURRENCY:
 *   Max 2 games run in parallel at any time (KenPom rate-limit safe).
 *   A game is "locked" in memory while it is being processed so a second poll
 *   cycle cannot double-dispatch the same game.
 *
 * MANUAL TRIGGER:
 *   Call `triggerModelWatcherNow()` to force an immediate poll cycle outside
 *   the regular interval. Used by the tRPC model.runForDate procedure.
 */

import { listGamesByDate, updateGameProjections } from "./db";
import { runModelForGame, type ModelGameInput } from "./ncaamModelEngine";
import { BY_DB_SLUG } from "../shared/ncaamTeams";
import { ENV } from "./_core/env";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS    = 60_000;  // poll every 60 seconds
const MAX_CONCURRENCY     = 1;       // strictly sequential — one game at a time to respect KenPom rate limits
const DISPATCH_STAGGER_MS = 30_000;  // 30s minimum between consecutive KenPom logins
const LOG_PREFIX        = "[ModelWatcher]";

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY LOCK — prevents double-dispatching the same game
// ─────────────────────────────────────────────────────────────────────────────

const inFlight = new Set<number>(); // game DB IDs currently being processed

// Rate-limit backoff: games that hit KenPom 429 are cooled down for 5 minutes
const rateLimitCooldown = new Map<number, number>(); // gameId → timestamp when cooldown expires
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000; // 5 minutes

function isRateLimitError(error: string): boolean {
  return (
    error.includes("429") ||
    error.includes("NoneType") ||
    error.includes("list index out of range") ||
    error.includes("Failed to retrieve")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function todayEst(): string {
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const y   = est.getFullYear();
  const m   = String(est.getMonth() + 1).padStart(2, "0");
  const d   = String(est.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Round a spread/total value to the nearest 0.5.
 * Examples: -0.51 → -1.0, -0.24 → 0.0, -1.26 → -1.5, -1.76 → -2.0
 */
function roundHalf(val: number): number {
  return Math.round(val * 2) / 2;
}

function formatML(val: number): string {
  if (!isFinite(val) || val === 0) return "-";
  const rounded = Math.round(val); // whole integer — no decimal
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function formatSpreadEdge(orig: number, mkt: number, overRate: number): string | null {
  const delta = Math.abs(orig - mkt);
  if (delta < 1.5) return null;
  const coverPct = orig < mkt ? overRate : 100 - overRate;
  if (coverPct < 55) return null;
  const conf = coverPct >= 65 ? "HIGH" : coverPct >= 60 ? "MOD" : "LOW";
  return conf;
}

function formatTotalEdge(origTotal: number, mktTotal: number, overRate: number): string | null {
  const delta = origTotal - mktTotal;
  if (Math.abs(delta) < 2.5) return null;
  const hitPct = delta > 0 ? overRate : 100 - overRate;
  if (hitPct < 55) return null;
  const conf = hitPct >= 65 ? "HIGH" : hitPct >= 60 ? "MOD" : "LOW";
  return conf;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE GAME PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────

async function processGame(game: Awaited<ReturnType<typeof listGamesByDate>>[number]): Promise<void> {
  const awayInfo = BY_DB_SLUG.get(game.awayTeam);
  const homeInfo = BY_DB_SLUG.get(game.homeTeam);

  if (!awayInfo || !homeInfo) {
    const missing = !awayInfo ? game.awayTeam : game.homeTeam;
    console.warn(`${LOG_PREFIX} [SKIP] ${game.awayTeam} @ ${game.homeTeam} — team not in registry: ${missing}`);
    return;
  }

  const mktSp  = parseFloat(String(game.awayBookSpread ?? "0"));
  const mktTo  = parseFloat(String(game.bookTotal ?? "0"));
  const mktMlA = game.awayML ? parseInt(game.awayML, 10) : null;
  const mktMlH = game.homeML ? parseInt(game.homeML, 10) : null;

  const input: ModelGameInput = {
    away_team:    awayInfo.kenpomSlug,
    home_team:    homeInfo.kenpomSlug,
    conf_a:       awayInfo.conference,
    conf_h:       homeInfo.conference,
    mkt_sp:       mktSp,
    mkt_to:       mktTo,
    mkt_ml_a:     mktMlA,
    mkt_ml_h:     mktMlH,
    kenpom_email: ENV.kenpomEmail,
    kenpom_pass:  ENV.kenpomPassword,
  };

  const emailOk = !!ENV.kenpomEmail && ENV.kenpomEmail.length > 3;
  const passOk  = !!ENV.kenpomPassword && ENV.kenpomPassword.length > 3;
  console.log(
    `${LOG_PREFIX} [DISPATCH] ${awayInfo.kenpomSlug} @ ${homeInfo.kenpomSlug}` +
    ` | conf: ${awayInfo.conference} vs ${homeInfo.conference}` +
    ` | mkt_sp: ${mktSp > 0 ? "+" : ""}${mktSp} | mkt_to: ${mktTo}` +
    ` | mkt_ml: ${mktMlA ?? "N/A"} / ${mktMlH ?? "N/A"}` +
    ` | kenpom_creds: email=${emailOk ? "OK" : "MISSING"} pass=${passOk ? "OK" : "MISSING"}`
  );

  const t0     = Date.now();
  const result = await runModelForGame(input);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!result.ok) {
    const errMsg = result.error ?? "unknown error";
    if (isRateLimitError(errMsg)) {
      // KenPom rate-limited — back off for 5 minutes, watcher will retry automatically
      rateLimitCooldown.set(game.id, Date.now() + RATE_LIMIT_COOLDOWN_MS);
      console.warn(
        `${LOG_PREFIX} [RATE_LIMIT] ${game.awayTeam} @ ${game.homeTeam}` +
        ` — KenPom rate-limited, cooling down for ${RATE_LIMIT_COOLDOWN_MS / 60000}min (${elapsed}s)`
      );
    } else {
      console.error(
        `${LOG_PREFIX} [FAIL] ${game.awayTeam} @ ${game.homeTeam}` +
        ` — ${errMsg.slice(0, 200)} (${elapsed}s)`
      );
    }
    return;
  }

  // ─── Spread sign fix ───────────────────────────────────────────────────────
  // The Python engine computes `originated_spread` as median(home_score - away_score).
  // A positive value means home is projected to win.
  // Betting convention: the FAVORITE gets a NEGATIVE spread, the UNDERDOG gets POSITIVE.
  // orig_home_sp = +orig_sp (positive when home wins) → must become NEGATIVE for home favorite
  // orig_away_sp = -orig_sp (negative when home wins) → must become POSITIVE for away underdog
  // Fix: flip both signs so the projected favorite always shows negative.
  const awayModelSpreadRaw = -result.orig_away_sp;  // flip: away underdog → positive
  const homeModelSpreadRaw = -result.orig_home_sp;  // flip: home favorite → negative

  // Round to nearest 0.5 (standard spread convention)
  const awayModelSpread = roundHalf(awayModelSpreadRaw);
  const homeModelSpread = roundHalf(homeModelSpreadRaw);
  const modelTotal      = roundHalf(result.orig_total);

  // Build edge labels (use the corrected away spread vs book away spread)
  const spreadEdge = formatSpreadEdge(awayModelSpread, mktSp, result.over_rate);
  const totalEdge  = formatTotalEdge(modelTotal, mktTo, result.over_rate);
  const spreadDiff = spreadEdge
    ? String(Math.abs(awayModelSpread - mktSp).toFixed(1))
    : null;
  const totalDiff  = totalEdge
    ? String(Math.abs(modelTotal - mktTo).toFixed(1))
    : null;

  try {
    await updateGameProjections(game.id, {
      awayModelSpread:     String(awayModelSpread),
      homeModelSpread:     String(homeModelSpread),
      modelTotal:          String(modelTotal),
      modelAwayML:         formatML(result.away_ml_fair),
      modelHomeML:         formatML(result.home_ml_fair),
      modelAwayScore:      String(result.orig_away_score),
      modelHomeScore:      String(result.orig_home_score),
      modelOverRate:       String(result.over_rate),
      modelUnderRate:      String(result.under_rate),
      modelAwayWinPct:     String(result.ml_away_pct),
      modelHomeWinPct:     String(result.ml_home_pct),
      modelSpreadClamped:  result.spread_clamped,
      modelTotalClamped:   result.total_clamped,
      modelCoverDirection: result.cover_direction,
      modelRunAt:          Date.now(),
      spreadEdge,
      spreadDiff,
      totalEdge,
      totalDiff,
    });

    console.log(
      `${LOG_PREFIX} [OK] ${awayInfo.kenpomSlug} @ ${homeInfo.kenpomSlug}` +
      ` | scores: ${result.orig_away_score.toFixed(2)}–${result.orig_home_score.toFixed(2)}` +
      ` | spread: ${awayModelSpread > 0 ? "+" : ""}${awayModelSpread} / ${homeModelSpread > 0 ? "+" : ""}${homeModelSpread} (raw: ${result.orig_away_sp.toFixed(2)} / ${result.orig_home_sp.toFixed(2)})` +
      ` | total: ${modelTotal} (raw: ${result.orig_total.toFixed(2)})` +
      ` | ML: ${formatML(result.away_ml_fair)} / ${formatML(result.home_ml_fair)}` +
      ` | over: ${result.over_rate.toFixed(1)}% under: ${result.under_rate.toFixed(1)}%` +
      ` | cover_dir: ${result.cover_direction}` +
      ` | def_supp: ${result.def_suppression.toFixed(4)}` +
      ` | clamped: sp=${result.spread_clamped} to=${result.total_clamped}` +
      ` | edges: ${result.edges.length}` +
      ` | elapsed: ${elapsed}s`
    );
  } catch (dbErr) {
    console.error(
      `${LOG_PREFIX} [DB_FAIL] ${game.awayTeam} @ ${game.homeTeam}` +
      ` — DB write error: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POLL CYCLE
// ─────────────────────────────────────────────────────────────────────────────

async function pollCycle(forceDate?: string): Promise<void> {
  const date = forceDate ?? todayEst();

  let allGames: Awaited<ReturnType<typeof listGamesByDate>>;
  try {
    allGames = await listGamesByDate(date, "NCAAM");
  } catch (err) {
    console.error(`${LOG_PREFIX} [POLL_ERROR] DB fetch failed for ${date}:`, err);
    return;
  }

  const now = Date.now();
  // Find games that have book lines but no model projections, not in-flight, and not in rate-limit cooldown
  const pending = allGames.filter((g) => {
    if (g.awayBookSpread === null || g.bookTotal === null) return false;
    if (g.awayModelSpread !== null) return false;
    if (inFlight.has(g.id)) return false;
    const cooldownExpiry = rateLimitCooldown.get(g.id);
    if (cooldownExpiry && now < cooldownExpiry) return false; // still cooling down
    if (cooldownExpiry && now >= cooldownExpiry) rateLimitCooldown.delete(g.id); // cooldown expired
    return true;
  });

  if (pending.length === 0) {
    // Only log this occasionally to avoid log spam
    return;
  }

  console.log(
    `${LOG_PREFIX} [POLL] date=${date} total=${allGames.length}` +
    ` pending=${pending.length} in_flight=${inFlight.size}`
  );

  // Process games strictly sequentially — one at a time — to respect KenPom rate limits.
  // Each game takes ~40s (2 KenPom fetches + simulation). With 30s stagger between games,
  // the account never sees concurrent logins.
  const batch = pending.slice(0, 1); // always take exactly 1 per poll cycle
  if (batch.length === 0) return;

  for (const game of batch) {
    inFlight.add(game.id);
  }

  for (let idx = 0; idx < batch.length; idx++) {
    const game = batch[idx];
    if (idx > 0) {
      // Wait between consecutive games in the same batch (future-proofing)
      await new Promise<void>((r) => setTimeout(r, DISPATCH_STAGGER_MS));
    }
    try {
      await processGame(game);
    } finally {
      inFlight.delete(game.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL TRIGGER (called by tRPC model.runForDate and model.runFullSlate)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Force an immediate poll cycle for a specific date.
 * Clears the in-flight lock for all games on that date first so a full re-run
 * is possible even if some games already have projections.
 */
export async function triggerModelWatcherForDate(
  date: string,
  opts: { forceRerun?: boolean } = {}
): Promise<{ triggered: number; skipped: number }> {
  let allGames: Awaited<ReturnType<typeof listGamesByDate>>;
  try {
    allGames = await listGamesByDate(date, "NCAAM");
  } catch (err) {
    console.error(`${LOG_PREFIX} [TRIGGER_ERROR] DB fetch failed for ${date}:`, err);
    return { triggered: 0, skipped: 0 };
  }

  const eligible = allGames.filter((g) => {
    if (g.awayBookSpread === null || g.bookTotal === null) return false;
    if (!opts.forceRerun && g.awayModelSpread !== null) return false;
    if (inFlight.has(g.id)) return false;
    return true;
  });

  if (eligible.length === 0) {
    console.log(`${LOG_PREFIX} [TRIGGER] date=${date} — no eligible games (all projected or no lines)`);
    return { triggered: 0, skipped: allGames.length - eligible.length };
  }

  console.log(
    `${LOG_PREFIX} [TRIGGER] date=${date} eligible=${eligible.length}` +
    ` forceRerun=${opts.forceRerun ?? false}`
  );

  // Lock all eligible games
  for (const g of eligible) inFlight.add(g.id);

  // Run with MAX_CONCURRENCY
  const results = { triggered: 0, skipped: allGames.length - eligible.length };

  // Process strictly sequentially with stagger to respect KenPom rate limits
  for (let i = 0; i < eligible.length; i++) {
    if (i > 0) {
      console.log(`${LOG_PREFIX} [TRIGGER] Waiting ${DISPATCH_STAGGER_MS / 1000}s before next game...`);
      await new Promise<void>((r) => setTimeout(r, DISPATCH_STAGGER_MS));
    }
    const game = eligible[i];
    try {
      await processGame(game);
      results.triggered++;
    } finally {
      inFlight.delete(game.id);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHER STARTUP
// ─────────────────────────────────────────────────────────────────────────────

let watcherInterval: ReturnType<typeof setInterval> | null = null;

export function startModelWatcher(): void {
  if (watcherInterval) {
    console.warn(`${LOG_PREFIX} Watcher already running — skipping duplicate start`);
    return;
  }

  console.log(
    `${LOG_PREFIX} Starting — poll interval: ${POLL_INTERVAL_MS / 1000}s` +
    ` | max concurrency: ${MAX_CONCURRENCY}` +
    ` | python: python3.11`
  );

  // Run immediately on startup, then on interval
  void pollCycle();
  watcherInterval = setInterval(() => void pollCycle(), POLL_INTERVAL_MS);
}

export function stopModelWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    console.log(`${LOG_PREFIX} Stopped`);
  }
}

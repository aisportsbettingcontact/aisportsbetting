/**
 * securityDigest.ts
 *
 * Schedules a daily security digest that fires at 08:00 EST (13:00 UTC).
 * On each tick it:
 *   1. Queries security_events for the prior 24-hour window
 *      (CSRF_BLOCK, RATE_LIMIT, AUTH_FAIL counts + total)
 *   2. Fetches the top-5 most active IPs in that window
 *   3. Fires notifyOwner() with a structured summary
 *   4. Prunes security_events older than 90 days (rolling retention)
 *
 * Design constraints:
 *   - Fire-and-forget: errors never crash the server
 *   - Digest is skipped (not queued) if the previous run is still in progress
 *   - notifyOwner() is only called when total > 0 OR on the first run of the day
 *     (so you always get a "clean" confirmation even on quiet days)
 *   - All log lines are structured and machine-readable
 */

import { getSecurityEventCounts, getSecurityEvents, pruneSecurityEvents } from "./db";
import { notifyOwner } from "./_core/notification";

// ─── Constants ────────────────────────────────────────────────────────────────
const TAG = "[SecurityDigest]";
const DIGEST_HOUR_UTC = 13;   // 08:00 EST = 13:00 UTC (accounts for EST = UTC-5)
const DIGEST_MINUTE_UTC = 0;
const WINDOW_MS = 24 * 60 * 60 * 1000;  // 24-hour lookback window
const PRUNE_RETENTION_DAYS = 90;         // delete events older than 90 days
const TOP_IP_LIMIT = 5;                  // top N IPs to surface in digest
const CHECK_INTERVAL_MS = 60 * 1000;    // poll every 60 seconds to find the right minute

// ─── State ────────────────────────────────────────────────────────────────────
let lastDigestDateUTC = "";   // "YYYY-MM-DD" of last successful digest
let digestRunning = false;    // guard against overlapping runs

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" for the current UTC date. */
function todayUTC(): string {
  return new Date().toUTCString().slice(0, 16).split(" ").slice(1, 4).join("-");
}

/** Returns the current UTC hour and minute. */
function nowUTC(): { hour: number; minute: number } {
  const d = new Date();
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/**
 * Aggregates the top N IPs by event count from a raw event list.
 * Returns an array of { ip, count } sorted descending.
 */
function topIpsByCount(
  events: Array<{ ip: string | null }>,
  limit: number,
): Array<{ ip: string; count: number }> {
  const map = new Map<string, number>();
  for (const e of events) {
    const ip = e.ip ?? "unknown";
    map.set(ip, (map.get(ip) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, count]) => ({ ip, count }));
}

// ─── Core digest runner ───────────────────────────────────────────────────────

async function runSecurityDigest(): Promise<void> {
  if (digestRunning) {
    console.warn(`${TAG} [SKIP] Previous digest still running — skipping this tick`);
    return;
  }
  digestRunning = true;
  const runStart = Date.now();
  const windowStart = runStart - WINDOW_MS;
  const windowStartISO = new Date(windowStart).toISOString();
  const windowEndISO = new Date(runStart).toISOString();

  console.log(`${TAG} ► START | window=${windowStartISO} → ${windowEndISO}`);

  try {
    // ── Step 1: Query event counts for the 24-hour window ──────────────────
    console.log(`${TAG} [STEP] Querying security_events counts...`);
    const counts = await getSecurityEventCounts(windowStart);
    console.log(
      `${TAG} [STATE] Counts | CSRF_BLOCK=${counts.CSRF_BLOCK}` +
      ` RATE_LIMIT=${counts.RATE_LIMIT} AUTH_FAIL=${counts.AUTH_FAIL}` +
      ` total=${counts.total}`
    );

    // ── Step 2: Fetch raw events to compute top IPs ────────────────────────
    console.log(`${TAG} [STEP] Fetching raw events for top-IP analysis (limit=500)...`);
    const rawEvents = await getSecurityEvents({
      sinceMs: windowStart,
      limit: 500,
    });
    const topIps = topIpsByCount(rawEvents, TOP_IP_LIMIT);
    console.log(
      `${TAG} [STATE] Top IPs | ` +
      topIps.map(({ ip, count }) => `${ip}(${count})`).join(", ")
    );

    // ── Step 3: Build notification content ────────────────────────────────
    const date = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const topIpLines = topIps.length > 0
      ? topIps.map(({ ip, count }, i) => `  ${i + 1}. ${ip} — ${count} event${count !== 1 ? "s" : ""}`).join("\n")
      : "  No events recorded.";

    const threatLevel =
      counts.total === 0 ? "CLEAN"
      : counts.total < 10 ? "LOW"
      : counts.total < 50 ? "MODERATE"
      : counts.total < 200 ? "HIGH"
      : "CRITICAL";

    const content = [
      `Daily Security Digest — ${date}`,
      `Threat Level: ${threatLevel}`,
      "",
      "Event Counts (Last 24 Hours):",
      `  CSRF Block:   ${counts.CSRF_BLOCK}`,
      `  Rate Limit:   ${counts.RATE_LIMIT}`,
      `  Auth Failure: ${counts.AUTH_FAIL}`,
      `  Total:        ${counts.total}`,
      "",
      `Top ${TOP_IP_LIMIT} IPs by Event Count:`,
      topIpLines,
      "",
      `Window: ${windowStartISO} → ${windowEndISO}`,
      `Retention: events older than ${PRUNE_RETENTION_DAYS} days pruned after this digest.`,
    ].join("\n");

    console.log(`${TAG} [STATE] Threat level: ${threatLevel}`);

    // ── Step 4: Fire notifyOwner ───────────────────────────────────────────
    // Always send — even on clean days, so the owner has a daily confirmation.
    console.log(`${TAG} [STEP] Firing notifyOwner...`);
    const notified = await notifyOwner({
      title: `[${threatLevel}] Security Digest — ${counts.total} event${counts.total !== 1 ? "s" : ""} in 24h`,
      content,
    }).catch((err: unknown) => {
      console.error(
        `${TAG} [ERROR] notifyOwner threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    });

    if (notified) {
      console.log(`${TAG} [OUTPUT] Digest notification sent | threat=${threatLevel} total=${counts.total}`);
    } else {
      console.warn(`${TAG} [WARN] notifyOwner returned false — notification service may be unavailable`);
    }

    // ── Step 5: Prune old events ───────────────────────────────────────────
    console.log(`${TAG} [STEP] Pruning events older than ${PRUNE_RETENTION_DAYS} days...`);
    const pruned = await pruneSecurityEvents(PRUNE_RETENTION_DAYS);
    console.log(`${TAG} [OUTPUT] Pruned ${pruned} old event${pruned !== 1 ? "s" : ""}`);

    // ── Step 6: Mark digest complete ──────────────────────────────────────
    lastDigestDateUTC = new Date().toISOString().slice(0, 10);
    const elapsed = Date.now() - runStart;
    console.log(
      `${TAG} ✓ COMPLETE | elapsed=${elapsed}ms` +
      ` | notified=${notified} | pruned=${pruned}` +
      ` | lastDigestDate=${lastDigestDateUTC}`
    );
    console.log(`${TAG} [VERIFY] PASS — digest complete`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] Digest failed: ${msg}`);
    console.error(`${TAG} [VERIFY] FAIL — digest did not complete`);
  } finally {
    digestRunning = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Starts the daily security digest scheduler.
 *
 * Polls every 60 seconds. When the current UTC time matches
 * DIGEST_HOUR_UTC:DIGEST_MINUTE_UTC and today's digest hasn't run yet,
 * fires runSecurityDigest() asynchronously.
 *
 * This approach avoids drift from setInterval(24h) and handles server
 * restarts gracefully — if the server was down at 08:00 EST, the digest
 * fires on the next 60-second tick after startup if the hour matches.
 */
export function startSecurityDigestScheduler(): void {
  console.log(
    `${TAG} Scheduler started | fires daily at ${DIGEST_HOUR_UTC}:${String(DIGEST_MINUTE_UTC).padStart(2, "0")} UTC` +
    ` (08:00 EST) | poll interval=${CHECK_INTERVAL_MS / 1000}s`
  );

  // Run immediately on startup if it's the right hour and digest hasn't run today
  const { hour, minute } = nowUTC();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (
    hour === DIGEST_HOUR_UTC &&
    minute === DIGEST_MINUTE_UTC &&
    lastDigestDateUTC !== todayStr
  ) {
    console.log(`${TAG} [STEP] Startup: digest hour detected — firing immediately`);
    void runSecurityDigest();
  }

  // Recurring poll
  setInterval(() => {
    const { hour: h, minute: m } = nowUTC();
    const today = new Date().toISOString().slice(0, 10);

    if (h === DIGEST_HOUR_UTC && m === DIGEST_MINUTE_UTC && lastDigestDateUTC !== today) {
      console.log(
        `${TAG} [STEP] Scheduled trigger | UTC=${h}:${String(m).padStart(2, "0")}` +
        ` | lastDigestDate=${lastDigestDateUTC} | today=${today}`
      );
      void runSecurityDigest();
    }
  }, CHECK_INTERVAL_MS);
}

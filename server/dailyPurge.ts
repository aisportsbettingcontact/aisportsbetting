/**
 * dailyPurge.ts
 *
 * Schedules a daily cleanup job that deletes all games whose gameDate is
 * strictly before today's date in Eastern Time.
 *
 * Schedule: runs at 6:00 AM EST every day.
 * Example: March 2nd games are purged at 6:00 AM EST on March 3rd.
 *
 * Implementation: uses a simple setInterval-based scheduler (no external
 * cron library required). On startup, it calculates the milliseconds until
 * the next 6am EST occurrence and sets a one-shot timeout; after that first
 * run it repeats every 24 hours.
 */

import { deleteOldGames } from "./db";

const EST_PURGE_HOUR = 6; // 6:00 AM Eastern Time

/**
 * Returns the number of milliseconds until the next 6:00:00 AM EST.
 */
function msUntilNext6amEst(): number {
  const now = new Date();

  // Build a Date representing today at 06:00:00 EST
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = estFormatter.formatToParts(now);
  const estYear = Number(parts.find((p) => p.type === "year")!.value);
  const estMonth = Number(parts.find((p) => p.type === "month")!.value) - 1; // 0-indexed
  const estDay = Number(parts.find((p) => p.type === "day")!.value);

  // Create a UTC Date that represents today 06:00:00 in EST
  // EST = UTC-5, EDT = UTC-4; use the Date constructor with a timezone-aware string
  const target = new Date(
    `${estYear}-${String(estMonth + 1).padStart(2, "0")}-${String(estDay).padStart(2, "0")}T${String(EST_PURGE_HOUR).padStart(2, "0")}:00:00-05:00`
  );

  let ms = target.getTime() - now.getTime();

  // If 6am today has already passed, schedule for 6am tomorrow
  if (ms <= 0) {
    ms += 24 * 60 * 60 * 1000;
  }

  return ms;
}

async function runPurge() {
  try {
    console.log("[DailyPurge] Running scheduled game purge…");
    const deleted = await deleteOldGames();
    console.log(`[DailyPurge] Purge complete — ${deleted} stale game rows removed.`);
  } catch (err) {
    console.error("[DailyPurge] Purge failed:", err);
  }
}

/**
 * Start the daily purge scheduler.
 * First run fires at the next 6:00 AM EST; subsequent runs every 24 hours.
 */
export function startDailyPurgeSchedule() {
  const msToFirst = msUntilNext6amEst();
  const nextRun = new Date(Date.now() + msToFirst);

  console.log(
    `[DailyPurge] Scheduled — next purge at ${nextRun.toLocaleString("en-US", {
      timeZone: "America/New_York",
    })} EST (in ${Math.round(msToFirst / 1000 / 60)} minutes)`
  );

  setTimeout(() => {
    void runPurge();
    // After the first run, repeat every 24 hours
    setInterval(() => {
      void runPurge();
    }, 24 * 60 * 60 * 1000);
  }, msToFirst);
}

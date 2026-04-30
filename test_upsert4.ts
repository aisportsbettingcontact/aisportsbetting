import { config } from "dotenv";
config();
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { mlbScheduleHistory } from "./drizzle/schema";
import { eq, gte, lte, and } from "drizzle-orm";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  // Check what rows exist for 4/14
  const rows = await db.select({
    anGameId: mlbScheduleHistory.anGameId,
    gameDate: mlbScheduleHistory.gameDate,
    gameStatus: mlbScheduleHistory.gameStatus,
    awayScore: mlbScheduleHistory.awayScore,
    homeScore: mlbScheduleHistory.homeScore,
    awayAbbr: mlbScheduleHistory.awayAbbr,
    homeAbbr: mlbScheduleHistory.homeAbbr,
  }).from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.gameDate, "2026-04-14"));

  console.log(`[TEST] Rows for 2026-04-14: ${rows.length}`);
  rows.forEach(r => console.log(`  anGameId=${r.anGameId} ${r.awayAbbr}@${r.homeAbbr} status=${r.gameStatus} score=${r.awayScore}-${r.homeScore}`));

  // Try to insert a single test row
  try {
    await db.insert(mlbScheduleHistory).values({
      anGameId: 999999,
      gameDate: "2026-04-14",
      startTimeUtc: "2026-04-14T22:35:00.000Z",
      gameStatus: "complete",
      awaySlug: "test-away",
      homeSlug: "test-home",
      awayAbbr: "TST",
      homeAbbr: "TST",
      awayName: "Test Away",
      homeName: "Test Home",
      awayTeamId: 1,
      homeTeamId: 2,
      awayScore: 4,
      homeScore: 3,
      dkAwayRunLine: "+1.5" as any,
      dkHomeRunLine: "-1.5" as any,
      dkAwayRunLineOdds: "-161",
      dkHomeRunLineOdds: "+129",
      dkTotal: "8.5" as any,
      dkOverOdds: "-115",
      dkUnderOdds: "-105",
      dkAwayML: "+138",
      dkHomeML: "-165",
      awayRunLineCovered: true,
      homeRunLineCovered: false,
      totalResult: "UNDER",
      awayWon: true,
      lastRefreshedAt: Date.now(),
    });
    console.log("[TEST] INSERT SUCCESS");
    // Clean up
    await db.delete(mlbScheduleHistory).where(eq(mlbScheduleHistory.anGameId, 999999));
    console.log("[TEST] Cleanup done");
  } catch (err: any) {
    console.error("[TEST] INSERT FAILED:");
    const msg = err?.message ?? '';
    console.error("  message (last 300):", msg.substring(Math.max(0, msg.length - 300)));
    console.error("  errno:", err?.errno);
    console.error("  code:", err?.code);
    console.error("  sqlMessage:", err?.sqlMessage);
  }

  await conn.end();
}
main().catch(console.error);

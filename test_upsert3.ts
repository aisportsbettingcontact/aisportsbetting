import { config } from "dotenv";
config();
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { mlbScheduleHistory } from "./drizzle/schema";
import { sql, eq } from "drizzle-orm";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  // Check what's stored in dkAwayRunLine for existing rows
  const rows = await db.select({
    anGameId: mlbScheduleHistory.anGameId,
    gameDate: mlbScheduleHistory.gameDate,
    gameStatus: mlbScheduleHistory.gameStatus,
    awayScore: mlbScheduleHistory.awayScore,
    homeScore: mlbScheduleHistory.homeScore,
    dkAwayRunLine: mlbScheduleHistory.dkAwayRunLine,
    awayWon: mlbScheduleHistory.awayWon,
  }).from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.anGameId, 286834))
    .limit(1);

  console.log("[TEST] Existing row for anGameId=286834 (NYM@LAD 4/14):");
  console.log(JSON.stringify(rows[0], null, 2));

  // Try a raw update to see if the column accepts the value
  try {
    await conn.execute(
      "UPDATE mlb_schedule_history SET game_status=?, away_score=?, home_score=?, away_won=? WHERE an_game_id=?",
      ["complete", 1, 2, true, 286834]
    );
    console.log("[TEST] Raw UPDATE success");
    
    // Verify
    const [updated] = await conn.execute(
      "SELECT game_status, away_score, home_score, away_won FROM mlb_schedule_history WHERE an_game_id=?",
      [286834]
    );
    console.log("[TEST] After raw UPDATE:", JSON.stringify((updated as any[])[0]));
  } catch (err: any) {
    console.error("[TEST] Raw UPDATE FAILED:", err.message?.substring(0, 200));
  }

  await conn.end();
}
main().catch(console.error);

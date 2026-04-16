import { config } from "dotenv";
config();
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { mlbScheduleHistory } from "./drizzle/schema";
import { sql } from "drizzle-orm";
import { fetchMlbScheduleForDate } from "./server/mlbScheduleHistoryService";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  console.log("[TEST] Fetching 20260414...");
  const records = await fetchMlbScheduleForDate("20260414");
  console.log(`[TEST] Fetched ${records.length} records`);

  if (records.length === 0) {
    console.log("[TEST] No records to upsert");
    await conn.end();
    return;
  }

  console.log("[TEST] Attempting upsert of first record:", JSON.stringify(records[0], null, 2));

  try {
    await db
      .insert(mlbScheduleHistory)
      .values([records[0]])
      .onDuplicateKeyUpdate({
        set: {
          gameStatus: sql`VALUES(game_status)`,
          awayScore: sql`VALUES(away_score)`,
          homeScore: sql`VALUES(home_score)`,
          awayWon: sql`VALUES(away_won)`,
          dkAwayRunLine: sql`VALUES(dk_away_run_line)`,
          dkHomeRunLine: sql`VALUES(dk_home_run_line)`,
          dkAwayRunLineOdds: sql`VALUES(dk_away_run_line_odds)`,
          dkHomeRunLineOdds: sql`VALUES(dk_home_run_line_odds)`,
          awayRunLineCovered: sql`VALUES(away_run_line_covered)`,
          homeRunLineCovered: sql`VALUES(home_run_line_covered)`,
          dkAwayML: sql`VALUES(dk_away_ml)`,
          dkHomeML: sql`VALUES(dk_home_ml)`,
          dkTotal: sql`VALUES(dk_total)`,
          dkOverOdds: sql`VALUES(dk_over_odds)`,
          dkUnderOdds: sql`VALUES(dk_under_odds)`,
          totalResult: sql`VALUES(total_result)`,
        },
      });
    console.log("[TEST] Upsert SUCCESS");
  } catch (err: any) {
    console.error("[TEST] Upsert FAILED:");
    // Print last 500 chars of message to get the actual MySQL error at the end
  const msg = err?.message ?? '';
  console.error("  message (last 500):", msg.substring(Math.max(0, msg.length - 500)));
    console.error("  errno:", err?.errno);
    console.error("  code:", err?.code);
    console.error("  sqlMessage:", err?.sqlMessage);
    console.error("  sqlState:", err?.sqlState);
  }

  await conn.end();
}
main().catch(console.error);

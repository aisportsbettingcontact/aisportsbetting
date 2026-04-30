import { config } from "dotenv";
config();
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { mlbScheduleHistory } from "./drizzle/schema";
import { eq, desc, and, gte } from "drizzle-orm";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  // Check recent games for NYM (anSlug = 'new-york-mets')
  const rows = await db.select({
    id: mlbScheduleHistory.id,
    gameDate: mlbScheduleHistory.gameDate,
    awaySlug: mlbScheduleHistory.awaySlug,
    homeSlug: mlbScheduleHistory.homeSlug,
    awayScore: mlbScheduleHistory.awayScore,
    homeScore: mlbScheduleHistory.homeScore,
    gameStatus: mlbScheduleHistory.gameStatus,
  }).from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.awaySlug, 'new-york-mets'))
    .orderBy(desc(mlbScheduleHistory.gameDate))
    .limit(10);

  console.log('[NYM away games (last 10)]:');
  for (const r of rows) {
    console.log(`  ${r.gameDate} ${r.awaySlug}@${r.homeSlug} score=${r.awayScore}-${r.homeScore} status=${r.gameStatus}`);
  }

  // Also check home games
  const homeRows = await db.select({
    gameDate: mlbScheduleHistory.gameDate,
    awaySlug: mlbScheduleHistory.awaySlug,
    homeSlug: mlbScheduleHistory.homeSlug,
    awayScore: mlbScheduleHistory.awayScore,
    homeScore: mlbScheduleHistory.homeScore,
    gameStatus: mlbScheduleHistory.gameStatus,
  }).from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.homeSlug, 'new-york-mets'))
    .orderBy(desc(mlbScheduleHistory.gameDate))
    .limit(10);

  console.log('[NYM home games (last 10)]:');
  for (const r of homeRows) {
    console.log(`  ${r.gameDate} ${r.awaySlug}@${r.homeSlug} score=${r.awayScore}-${r.homeScore} status=${r.gameStatus}`);
  }

  // Check what the latest complete game date is
  const latestComplete = await db.select({
    gameDate: mlbScheduleHistory.gameDate,
    gameStatus: mlbScheduleHistory.gameStatus,
  }).from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.gameStatus, 'complete'))
    .orderBy(desc(mlbScheduleHistory.gameDate))
    .limit(5);
  console.log('[Latest complete games]:');
  for (const r of latestComplete) {
    console.log(`  ${r.gameDate} status=${r.gameStatus}`);
  }

  await conn.end();
}
main().catch(console.error);

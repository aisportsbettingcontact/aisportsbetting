import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { games } from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

const rotNumMap = [
  { awayTeam: "Creighton", rotNums: "689/690" },
  { awayTeam: "Minnesota", rotNums: "691/692" },
  { awayTeam: "Fordham", rotNums: "693/694" },
  { awayTeam: "Texas", rotNums: "695/696" },
  { awayTeam: "Marquette", rotNums: "697/698" },
  { awayTeam: "Duquesne", rotNums: "699/700" },
  { awayTeam: "California", rotNums: "701/702" },
  { awayTeam: "UAB", rotNums: "703/704" },
  { awayTeam: "St. Joseph's", rotNums: "705/706" },
  { awayTeam: "Miami Florida", rotNums: "707/708" },
  { awayTeam: "St. Bonaventure", rotNums: "709/710" },
  { awayTeam: "Ohio State", rotNums: "711/712" },
  { awayTeam: "Villanova", rotNums: "713/714" },
  { awayTeam: "Maryland", rotNums: "715/716" },
  { awayTeam: "Rice", rotNums: "717/718" },
  { awayTeam: "Loyola Chicago", rotNums: "719/720" },
  { awayTeam: "Purdue", rotNums: "721/722" },
  { awayTeam: "Stanford", rotNums: "723/724" },
  { awayTeam: "Baylor", rotNums: "725/726" },
  { awayTeam: "Florida State", rotNums: "727/728" },
  { awayTeam: "Colorado State", rotNums: "729/730" },
  { awayTeam: "USC", rotNums: "731/732" },
  { awayTeam: "UL Lafayette", rotNums: "733/734" },
  { awayTeam: "Georgia Southern", rotNums: "735/736" },
  { awayTeam: "Eastern Illinois", rotNums: "737/738" },
  { awayTeam: "Little Rock", rotNums: "739/740" },
  { awayTeam: "UMKC", rotNums: "741/742" },
  { awayTeam: "Northern Kentucky", rotNums: "743/744" },
  { awayTeam: "Milwaukee", rotNums: "745/746" },
  { awayTeam: "Youngstown State", rotNums: "747/748" },
  { awayTeam: "Cleveland State", rotNums: "749/750" },
  { awayTeam: "Jacksonville", rotNums: "306549/306550" },
  { awayTeam: "North Alabama", rotNums: "306551/306552" },
  { awayTeam: "Stetson", rotNums: "306553/306554" },
  { awayTeam: "North Florida", rotNums: "306555/306556" },
  { awayTeam: "Gardner Webb", rotNums: "306557/306558" },
  { awayTeam: "Stonehill", rotNums: "306559/306560" },
  { awayTeam: "Fairleigh Dickinson", rotNums: "306561/306562" },
  { awayTeam: "Wagner", rotNums: "306563/306564" },
  { awayTeam: "Chicago State", rotNums: "306565/306566" },
];

let updated = 0;
for (const { awayTeam, rotNums } of rotNumMap) {
  await db.update(games)
    .set({ rotNums })
    .where(and(eq(games.gameDate, "2026-03-04"), eq(games.awayTeam, awayTeam)));
  updated++;
}
console.log(`✅ Updated rotNums for ${updated} games`);
await connection.end();

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { games } from "../drizzle/schema.ts";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

// All 40 March 4, 2026 NCAAM games
// Times are in EST (p = PM, a = AM) — converted to 24h for storage
// bookSpread: negative = away team favored, positive = home team favored
// Model projections are blank (null) — to be filled in by @prez

const march4Games = [
  // ─── REGULAR SEASON (22 games) ────────────────────────────────────────────
  { rotNums: "689/690", time: "15:00", awayTeam: "Creighton",        homeTeam: "Butler",            bookSpread: -2.5,  bookTotal: 155.5, gameType: "regular_season",       conference: null },
  { rotNums: "691/692", time: "15:30", awayTeam: "Minnesota",        homeTeam: "Indiana",           bookSpread: -6.5,  bookTotal: 138.0, gameType: "regular_season",       conference: null },
  { rotNums: "693/694", time: "15:30", awayTeam: "Fordham",          homeTeam: "La Salle",          bookSpread: -2.5,  bookTotal: 133.5, gameType: "regular_season",       conference: null },
  { rotNums: "695/696", time: "16:00", awayTeam: "Texas",            homeTeam: "Arkansas",          bookSpread: -7.0,  bookTotal: 165.5, gameType: "regular_season",       conference: null },
  { rotNums: "697/698", time: "16:00", awayTeam: "Marquette",        homeTeam: "Providence",        bookSpread: -4.0,  bookTotal: 162.0, gameType: "regular_season",       conference: null },
  { rotNums: "699/700", time: "16:00", awayTeam: "Duquesne",         homeTeam: "Rhode Island",      bookSpread: -1.0,  bookTotal: 143.5, gameType: "regular_season",       conference: null },
  { rotNums: "701/702", time: "16:00", awayTeam: "California",       homeTeam: "Georgia Tech",      bookSpread: -3.5,  bookTotal: 154.0, gameType: "regular_season",       conference: null },
  { rotNums: "703/704", time: "16:00", awayTeam: "UAB",              homeTeam: "Charlotte",         bookSpread: -1.5,  bookTotal: 144.5, gameType: "regular_season",       conference: null },
  { rotNums: "705/706", time: "16:00", awayTeam: "St. Joseph's",     homeTeam: "Davidson",          bookSpread: -4.0,  bookTotal: 138.0, gameType: "regular_season",       conference: null },
  { rotNums: "707/708", time: "16:00", awayTeam: "Miami Florida",    homeTeam: "SMU",               bookSpread: -1.0,  bookTotal: 161.0, gameType: "regular_season",       conference: null },
  { rotNums: "709/710", time: "16:00", awayTeam: "St. Bonaventure",  homeTeam: "George Washington", bookSpread: -8.0,  bookTotal: 160.0, gameType: "regular_season",       conference: null },
  { rotNums: "711/712", time: "16:30", awayTeam: "Ohio State",       homeTeam: "Penn State",        bookSpread: -7.0,  bookTotal: 154.0, gameType: "regular_season",       conference: null },
  { rotNums: "713/714", time: "17:00", awayTeam: "Villanova",        homeTeam: "DePaul",            bookSpread: -3.0,  bookTotal: 135.5, gameType: "regular_season",       conference: null },
  { rotNums: "715/716", time: "17:00", awayTeam: "Maryland",         homeTeam: "Wisconsin",         bookSpread: -14.0, bookTotal: 153.5, gameType: "regular_season",       conference: null },
  { rotNums: "717/718", time: "17:00", awayTeam: "Rice",             homeTeam: "North Texas",       bookSpread: -8.0,  bookTotal: 140.5, gameType: "regular_season",       conference: null },
  { rotNums: "719/720", time: "17:00", awayTeam: "Loyola Chicago",   homeTeam: "Saint Louis",       bookSpread: -24.5, bookTotal: 155.0, gameType: "regular_season",       conference: null },
  { rotNums: "721/722", time: "17:30", awayTeam: "Purdue",           homeTeam: "Northwestern",      bookSpread: -9.5,  bookTotal: 147.0, gameType: "regular_season",       conference: null },
  { rotNums: "723/724", time: "18:00", awayTeam: "Stanford",         homeTeam: "Notre Dame",        bookSpread: -1.5,  bookTotal: 145.5, gameType: "regular_season",       conference: null },
  { rotNums: "725/726", time: "18:00", awayTeam: "Baylor",           homeTeam: "Houston",           bookSpread: -15.0, bookTotal: 143.0, gameType: "regular_season",       conference: null },
  { rotNums: "727/728", time: "18:00", awayTeam: "Florida State",    homeTeam: "Pittsburgh",        bookSpread: -1.5,  bookTotal: 146.0, gameType: "regular_season",       conference: null },
  { rotNums: "729/730", time: "19:00", awayTeam: "Colorado State",   homeTeam: "New Mexico",        bookSpread: -8.0,  bookTotal: 150.0, gameType: "regular_season",       conference: null },
  { rotNums: "731/732", time: "19:30", awayTeam: "USC",              homeTeam: "Washington",        bookSpread: -6.0,  bookTotal: 151.5, gameType: "regular_season",       conference: null },

  // ─── CONFERENCE TOURNAMENT (18 games) ─────────────────────────────────────
  // SUN BELT CONFERENCE - SECOND ROUND
  { rotNums: "733/734", time: "15:00", awayTeam: "UL Lafayette",     homeTeam: "James Madison",     bookSpread: null,  bookTotal: null,  gameType: "conference_tournament", conference: "Sun Belt" },
  { rotNums: "735/736", time: "17:30", awayTeam: "Georgia Southern", homeTeam: "TBD",               bookSpread: null,  bookTotal: null,  gameType: "conference_tournament", conference: "Sun Belt" },

  // OHIO VALLEY CONFERENCE - FIRST ROUND
  { rotNums: "737/738", time: "16:00", awayTeam: "Eastern Illinois", homeTeam: "SIU Edwardsville",  bookSpread: -5.5,  bookTotal: 127.5, gameType: "conference_tournament", conference: "Ohio Valley" },
  { rotNums: "739/740", time: "18:30", awayTeam: "Little Rock",      homeTeam: "Lindenwood",        bookSpread: -4.0,  bookTotal: 149.0, gameType: "conference_tournament", conference: "Ohio Valley" },

  // SUMMIT LEAGUE - FIRST ROUND
  { rotNums: "741/742", time: "17:00", awayTeam: "UMKC",             homeTeam: "Oral Roberts",      bookSpread: -8.0,  bookTotal: 147.5, gameType: "conference_tournament", conference: "Summit League" },

  // HORIZON LEAGUE - FIRST ROUND
  { rotNums: "743/744", time: "16:00", awayTeam: "Northern Kentucky","homeTeam": "Oakland",         bookSpread: -2.5,  bookTotal: 159.0, gameType: "conference_tournament", conference: "Horizon League" },
  { rotNums: "745/746", time: "16:00", awayTeam: "Milwaukee",        homeTeam: "Detroit Mercy",     bookSpread: -3.0,  bookTotal: 153.0, gameType: "conference_tournament", conference: "Horizon League" },
  { rotNums: "747/748", time: "16:00", awayTeam: "Youngstown State", homeTeam: "Robert Morris",     bookSpread: -5.0,  bookTotal: 143.0, gameType: "conference_tournament", conference: "Horizon League" },
  { rotNums: "749/750", time: "16:00", awayTeam: "Cleveland State",  homeTeam: "Wright State",      bookSpread: -13.5, bookTotal: 161.5, gameType: "conference_tournament", conference: "Horizon League" },

  // ATLANTIC SUN CONFERENCE - FIRST ROUND
  { rotNums: "306549/306550", time: "09:00", awayTeam: "Jacksonville",    homeTeam: "Bellarmine",        bookSpread: -1.0,  bookTotal: 147.5, gameType: "conference_tournament", conference: "Atlantic Sun" },
  { rotNums: "306551/306552", time: "11:30", awayTeam: "North Alabama",   homeTeam: "Florida Gulf Coast",bookSpread: -7.0,  bookTotal: 144.0, gameType: "conference_tournament", conference: "Atlantic Sun" },
  { rotNums: "306553/306554", time: "14:00", awayTeam: "Stetson",         homeTeam: "Eastern Kentucky",  bookSpread: -4.5,  bookTotal: 156.0, gameType: "conference_tournament", conference: "Atlantic Sun" },
  { rotNums: "306555/306556", time: "16:30", awayTeam: "North Florida",   homeTeam: "West Georgia",      bookSpread: -3.5,  bookTotal: 158.0, gameType: "conference_tournament", conference: "Atlantic Sun" },

  // BIG SOUTH CONFERENCE - FIRST ROUND
  { rotNums: "306557/306558", time: "16:30", awayTeam: "Gardner Webb",    homeTeam: "SC Upstate",        bookSpread: -10.0, bookTotal: 148.0, gameType: "conference_tournament", conference: "Big South" },

  // NORTHEAST CONFERENCE - FIRST ROUND
  { rotNums: "306559/306560", time: "16:00", awayTeam: "Stonehill",       homeTeam: "Le Moyne",          bookSpread: -6.5,  bookTotal: 133.0, gameType: "conference_tournament", conference: "Northeast" },
  { rotNums: "306561/306562", time: "16:00", awayTeam: "Fairleigh Dickinson","homeTeam": "Mercyhurst",   bookSpread: -4.5,  bookTotal: 134.0, gameType: "conference_tournament", conference: "Northeast" },
  { rotNums: "306563/306564", time: "16:00", awayTeam: "Wagner",          homeTeam: "Central Connecticut",bookSpread: -4.0, bookTotal: 140.0, gameType: "conference_tournament", conference: "Northeast" },
  { rotNums: "306565/306566", time: "16:00", awayTeam: "Chicago State",   homeTeam: "Long Island",       bookSpread: -11.5, bookTotal: 137.0, gameType: "conference_tournament", conference: "Northeast" },
];

// Convert HH:MM 24h time to EST display string like "4:00 PM EST"
function formatTimeEst(time24) {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period} EST`;
}

const rows = march4Games.map((g) => ({
  fileId: 0, // 0 = manually imported (not from a model file upload)
  gameDate: "2026-03-04",
  startTimeEst: formatTimeEst(g.time),
  awayTeam: g.awayTeam,
  homeTeam: g.homeTeam,
  // Book odds (from WagerTalk) — stored as away spread convention
  awayBookSpread: g.bookSpread !== null ? g.bookSpread : 0,
  homeBookSpread: g.bookSpread !== null ? -g.bookSpread : 0,
  bookTotal: g.bookTotal !== null ? g.bookTotal : 0,
  // Model projections — blank (0 = not yet entered)
  awayModelSpread: 0,
  homeModelSpread: 0,
  modelTotal: 0,
  spreadEdge: "",
  spreadDiff: 0,
  totalEdge: "",
  totalDiff: 0,
  sport: "NCAAM",
  gameType: g.gameType,
  conference: g.conference,
  publishedToFeed: false,
}));

// Delete any existing March 4 manually-imported games first
const { eq, and } = await import("drizzle-orm");
await db.delete(games).where(
  and(eq(games.gameDate, "2026-03-04"), eq(games.fileId, 0))
);

// Insert all 40 games
await db.insert(games).values(rows);
console.log(`✅ Inserted ${rows.length} March 4 games (fileId=0, unpublished)`);

await connection.end();

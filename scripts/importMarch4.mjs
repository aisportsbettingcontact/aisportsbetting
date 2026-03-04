/**
 * Import March 4, 2026 NCAAM games from WagerTalk Consensus odds into the database.
 *
 * Spread convention (WagerTalk HTML):
 *   r1 = away team row, r2 = home team row
 *   Whichever row has the negative spread = that team is favored
 *   The other team gets the positive inverse
 *
 * All games imported with publishedToFeed = false (unpublished staging).
 * Model projections left as NULL until @prez fills them in.
 *
 * Source: pasted_content_3.txt (Consensus column = b14)
 * Total: 41 games on 03/04 (excluding 03/03 IPFW/Green Bay)
 */

import mysql from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// awaySpread / homeSpread = each team's spread (negative = favored)
// null = no line posted or TBD opponent
const GAMES = [
  // ── Regular Season ──────────────────────────────────────────────────────────
  { time: "15:00", away: "Creighton",             home: "Butler",                 awaySpread:  2.5,  homeSpread: -2.5,  total: 155.5 },
  { time: "15:30", away: "Minnesota",             home: "Indiana",                awaySpread:  6.5,  homeSpread: -6.5,  total: 138.0 },
  { time: "15:30", away: "Fordham",               home: "La Salle",               awaySpread: -2.5,  homeSpread:  2.5,  total: 133.5 },
  { time: "16:00", away: "Texas",                 home: "Arkansas",               awaySpread:  7.0,  homeSpread: -7.0,  total: 165.5 },
  { time: "16:00", away: "Marquette",             home: "Providence",             awaySpread:  4.0,  homeSpread: -4.0,  total: 162.0 },
  { time: "16:00", away: "Duquesne",              home: "Rhode Island",           awaySpread:  1.0,  homeSpread: -1.0,  total: 143.5 },
  { time: "16:00", away: "California",            home: "Georgia Tech",           awaySpread: -3.5,  homeSpread:  3.5,  total: 154.0 },
  { time: "16:00", away: "UAB",                   home: "Charlotte",              awaySpread: -1.5,  homeSpread:  1.5,  total: 144.5 },
  { time: "16:00", away: "St. Joseph's",          home: "Davidson",               awaySpread:  4.0,  homeSpread: -4.0,  total: 138.0 },
  { time: "16:00", away: "Miami Florida",         home: "SMU",                    awaySpread:  1.0,  homeSpread: -1.0,  total: 161.0 },
  { time: "16:00", away: "St. Bonaventure",       home: "George Washington",      awaySpread:  8.0,  homeSpread: -8.0,  total: 160.0 },
  { time: "16:30", away: "Ohio State",            home: "Penn State",             awaySpread: -7.0,  homeSpread:  7.0,  total: 154.0 },
  { time: "17:00", away: "Villanova",             home: "DePaul",                 awaySpread: -3.0,  homeSpread:  3.0,  total: 135.5 },
  { time: "17:00", away: "Maryland",              home: "Wisconsin",              awaySpread: 14.0,  homeSpread: -14.0, total: 153.5 },
  { time: "17:00", away: "Rice",                  home: "North Texas",            awaySpread:  8.0,  homeSpread: -8.0,  total: 140.5 },
  { time: "17:00", away: "Loyola Chicago",        home: "Saint Louis",            awaySpread: 24.5,  homeSpread: -24.5, total: 155.0 },
  { time: "17:30", away: "Purdue",                home: "Northwestern",           awaySpread: -9.5,  homeSpread:  9.5,  total: 147.0 },
  { time: "18:00", away: "Stanford",              home: "Notre Dame",             awaySpread:  1.5,  homeSpread: -1.5,  total: 145.5 },
  { time: "18:00", away: "Baylor",                home: "Houston",                awaySpread: 15.0,  homeSpread: -15.0, total: 143.0 },
  { time: "18:00", away: "Florida State",         home: "Pittsburgh",             awaySpread: -1.5,  homeSpread:  1.5,  total: 146.0 },
  { time: "19:00", away: "Colorado State",        home: "New Mexico",             awaySpread:  8.0,  homeSpread: -8.0,  total: 150.0 },
  { time: "19:30", away: "USC",                   home: "Washington",             awaySpread:  6.0,  homeSpread: -6.0,  total: 151.5 },

  // ── Conference Tournaments ──────────────────────────────────────────────────
  // Sun Belt (no odds posted; game 2 has TBD away team — bracket pending)
  { time: "15:00", away: "UL Lafayette",          home: "James Madison",          awaySpread: null,  homeSpread: null,  total: null,  conf: "Sun Belt" },
  { time: "17:30", away: "TBD",                   home: "Georgia Southern",       awaySpread: null,  homeSpread: null,  total: null,  conf: "Sun Belt" },

  // Ohio Valley
  { time: "16:00", away: "Eastern Illinois",      home: "SIU Edwardsville",       awaySpread:  5.5,  homeSpread: -5.5,  total: 127.5, conf: "Ohio Valley" },
  { time: "18:30", away: "Little Rock",           home: "Lindenwood",             awaySpread:  4.0,  homeSpread: -4.0,  total: 149.0, conf: "Ohio Valley" },

  // Summit League
  { time: "17:00", away: "UMKC",                 home: "Oral Roberts",           awaySpread:  8.0,  homeSpread: -8.0,  total: 147.5, conf: "Summit League" },

  // Horizon League
  { time: "16:00", away: "Northern Kentucky",     home: "Oakland",                awaySpread:  2.5,  homeSpread: -2.5,  total: 159.0, conf: "Horizon League" },
  { time: "16:00", away: "Milwaukee",             home: "Detroit Mercy",          awaySpread:  3.0,  homeSpread: -3.0,  total: 153.0, conf: "Horizon League" },
  { time: "16:00", away: "Youngstown State",      home: "Robert Morris",          awaySpread:  5.0,  homeSpread: -5.0,  total: 143.0, conf: "Horizon League" },
  { time: "16:00", away: "Cleveland State",       home: "Wright State",           awaySpread: 13.5,  homeSpread: -13.5, total: 161.5, conf: "Horizon League" },

  // Atlantic Sun
  { time: "09:00", away: "Jacksonville",          home: "Bellarmine",             awaySpread:  1.0,  homeSpread: -1.0,  total: 147.5, conf: "Atlantic Sun" },
  { time: "11:30", away: "North Alabama",         home: "Florida Gulf Coast",     awaySpread:  7.0,  homeSpread: -7.0,  total: 144.0, conf: "Atlantic Sun" },
  { time: "14:00", away: "Stetson",               home: "Eastern Kentucky",       awaySpread:  4.5,  homeSpread: -4.5,  total: 156.0, conf: "Atlantic Sun" },
  { time: "16:30", away: "North Florida",         home: "West Georgia",           awaySpread:  3.5,  homeSpread: -3.5,  total: 158.0, conf: "Atlantic Sun" },

  // Big South
  { time: "16:30", away: "Gardner Webb",          home: "South Carolina Upstate", awaySpread: 10.0,  homeSpread: -10.0, total: 148.0, conf: "Big South" },

  // Northeast Conference
  { time: "16:00", away: "Stonehill",             home: "Le Moyne",               awaySpread:  6.5,  homeSpread: -6.5,  total: 133.0, conf: "Northeast" },
  { time: "16:00", away: "Fairleigh Dickinson",   home: "Mercyhurst",             awaySpread:  4.5,  homeSpread: -4.5,  total: 134.0, conf: "Northeast" },
  { time: "16:00", away: "Wagner",                home: "Central Connecticut",    awaySpread:  4.0,  homeSpread: -4.0,  total: 140.0, conf: "Northeast" },
  { time: "16:00", away: "Chicago State",         home: "Long Island",            awaySpread: 11.5,  homeSpread: -11.5, total: 137.0, conf: "Northeast" },

];

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);

  try {
    // Clear any existing March 4 staging games (fileId = 0)
    const [del] = await conn.execute("DELETE FROM games WHERE gameDate = '2026-03-04' AND fileId = 0");
    console.log(`Cleared ${del.affectedRows} existing 2026-03-04 staging games.`);

    let inserted = 0;
    for (const g of GAMES) {
      const gameType = g.conf ? "conference_tournament" : "regular_season";
      const conference = g.conf ?? null;

      const gameDate = g.date ?? '2026-03-04';
      await conn.execute(
        `INSERT INTO games
          (fileId, gameDate, startTimeEst, awayTeam, awayBookSpread, homeTeam, homeBookSpread,
           bookTotal, sport, gameType, conference, publishedToFeed, createdAt)
         VALUES (0, ?, ?, ?, ?, ?, ?, ?, 'NCAAM', ?, ?, false, NOW())`,
        [
          gameDate,
          g.time,
          g.away,
          g.awaySpread ?? null,
          g.home,
          g.homeSpread ?? null,
          g.total ?? null,
          gameType,
          conference,
        ]
      );
      inserted++;

      const awayLabel = g.awaySpread != null ? (g.awaySpread > 0 ? `+${g.awaySpread}` : `${g.awaySpread}`) : "N/A";
      const homeLabel = g.homeSpread != null ? (g.homeSpread > 0 ? `+${g.homeSpread}` : `${g.homeSpread}`) : "N/A";
      const confLabel = conference ? ` [${conference}]` : "";
      console.log(`  ✓ ${g.away} (${awayLabel}) @ ${g.home} (${homeLabel}) | O/U ${g.total ?? "N/A"}${confLabel}`);
    }

    console.log(`\nDone. Inserted ${inserted} games for 2026-03-04.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

import mysql from "/home/ubuntu/ai-sports-betting/node_modules/mysql2/promise.js";
import dotenv from "/home/ubuntu/ai-sports-betting/node_modules/dotenv/lib/main.js";
dotenv.config({ path: "/home/ubuntu/ai-sports-betting/.env" });

// Games where away/home spreads are inverted in the DB
// Format: [homeTeam slug in DB, correct awaySpread, correct homeSpread]
const SPREAD_FIXES = [
  // Marquette @ Providence: Marquette is -4 (away favored), Providence +4
  { homeTeam: "providence",         awaySpread: -4,    homeSpread: 4    },
  // California @ Georgia Tech: Georgia Tech is -3.5 (home favored), California +3.5
  { homeTeam: "georgia_tech",       awaySpread: 3.5,   homeSpread: -3.5 },
  // St. Bonaventure @ George Washington: St. Bonaventure is -8 (away favored), GW +8
  { homeTeam: "george_washington",  awaySpread: -8,    homeSpread: 8    },
  // USC @ Washington: USC is -6 (away favored), Washington +6
  { homeTeam: "washington",         awaySpread: -6,    homeSpread: 6    },
  // Eastern Illinois @ SIU Edwardsville: Eastern Illinois is -5.5 (away favored)
  { homeTeam: "siu_edwardsville",   awaySpread: -5.5,  homeSpread: 5.5  },
  // Little Rock @ Lindenwood: Little Rock is -4 (away favored)
  { homeTeam: "lindenwood",         awaySpread: -4,    homeSpread: 4    },
  // Northern Kentucky @ Oakland: Northern Kentucky is -2.5 (away favored)
  { homeTeam: "oakland",            awaySpread: -2.5,  homeSpread: 2.5  },
  // Milwaukee @ Detroit Mercy: Milwaukee is -3 (away favored)
  { homeTeam: "detroit_mercy",      awaySpread: -3,    homeSpread: 3    },
  // Youngstown State @ Robert Morris: Youngstown State is -5 (away favored)
  { homeTeam: "robert_morris",      awaySpread: -5,    homeSpread: 5    },
  // Jacksonville @ Bellarmine: Jacksonville is -1 (away favored)
  { homeTeam: "bellarmine",         awaySpread: -1,    homeSpread: 1    },
  // Stetson @ Eastern Kentucky: Stetson is -4.5 (away favored)
  { homeTeam: "eastern_kentucky",   awaySpread: -4.5,  homeSpread: 4.5  },
  // North Florida @ West Georgia: North Florida is -3.5 (away favored)
  { homeTeam: "west_georgia",       awaySpread: -3.5,  homeSpread: 3.5  },
  // Gardner Webb @ South Carolina Upstate: Gardner Webb is -10 (away favored)
  { homeTeam: "south_carolina_upstate", awaySpread: -10, homeSpread: 10 },
  // Fairleigh Dickinson @ Mercyhurst: FDU is -4.5 (away favored)
  { homeTeam: "mercyhurst",         awaySpread: -4.5,  homeSpread: 4.5  },
  // Wagner @ Central Connecticut: Wagner is -4 (away favored)
  { homeTeam: "central_connecticut", awaySpread: -4,   homeSpread: 4    },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log("=== FIXING SPREAD INVERSIONS ===");
  for (const fix of SPREAD_FIXES) {
    const [result] = await conn.execute(
      `UPDATE games SET awayBookSpread = ?, homeBookSpread = ?
       WHERE homeTeam = ? AND gameDate = '2026-03-04'`,
      [fix.awaySpread.toString(), fix.homeSpread.toString(), fix.homeTeam]
    );
    console.log(`✓ Fixed ${fix.homeTeam}: away=${fix.awaySpread} home=${fix.homeSpread} (${result.affectedRows} row)`);
  }
  
  // Fix UL Lafayette slug: DB has 'louisiana' but should be 'ul_lafayette'
  console.log("\n=== FIXING TEAM SLUGS ===");
  const [slugResult] = await conn.execute(
    `UPDATE games SET awayTeam = 'ul_lafayette'
     WHERE awayTeam = 'louisiana' AND gameDate = '2026-03-04'`
  );
  console.log(`✓ Fixed UL Lafayette slug: louisiana → ul_lafayette (${slugResult.affectedRows} row)`);
  
  // Add missing Chicago State @ Long Island game
  console.log("\n=== ADDING MISSING GAME ===");
  const [insertResult] = await conn.execute(
    `INSERT INTO games 
     (fileId, awayTeam, homeTeam, gameDate, startTimeEst, gameType, conference,
      awayBookSpread, homeBookSpread, bookTotal, publishedToFeed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE awayTeam = awayTeam`,
    [
      0, "chicago_state", "liu", "2026-03-04", "4:00p",
      "conference_tournament", "Northeast Conference",
      "11.5", "-11.5", "137",
      false
    ]
  );
  console.log(`✓ Added Chicago State @ Long Island (${insertResult.affectedRows} row)`);
  
  await conn.end();
  
  console.log("\n=== ALL FIXES APPLIED ===");
  console.log("Run the audit again to verify.");
}

main().catch(console.error);

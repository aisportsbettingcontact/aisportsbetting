/**
 * End-to-end test of the VSiN scraper.
 * Runs scrapeVsinOdds for March 4, 2026 and reports how many games matched.
 */
import { createRequire } from "module";
import { register } from "tsx/esm/api";

register();

const { scrapeVsinOdds, matchTeam } = await import("../server/vsinScraper.ts");

// Load all March 4 games from DB
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(
  "SELECT id, awayTeam, homeTeam FROM games WHERE gameDate = '2026-03-04' ORDER BY sortOrder"
);
await conn.end();

console.log(`\n📋 DB games for March 4: ${rows.length}`);
console.log("🌐 Scraping VSiN betting splits...\n");

const scraped = await scrapeVsinOdds("Mar 4");

console.log(`\n📊 VSiN games found: ${scraped.length}`);
console.log("\n── Match Results ─────────────────────────────────────────────");

let matched = 0;
let noMatch = 0;

for (const game of rows) {
  const hit = scraped.find(
    (s) => matchTeam(s.awayTeam, game.awayTeam) && matchTeam(s.homeTeam, game.homeTeam)
  );
  if (hit) {
    matched++;
    const spread = hit.awaySpread !== null ? (hit.awaySpread > 0 ? `+${hit.awaySpread}` : `${hit.awaySpread}`) : "—";
    console.log(`  ✅ ${game.awayTeam} vs ${game.homeTeam}  →  spread: ${spread}  total: ${hit.total ?? "—"}`);
  } else {
    noMatch++;
    console.log(`  ❌ ${game.awayTeam} vs ${game.homeTeam}  →  no match`);
  }
}

console.log("\n── Summary ───────────────────────────────────────────────────");
console.log(`  Matched:   ${matched}/${rows.length}`);
console.log(`  No match:  ${noMatch}/${rows.length}`);
console.log("");

process.exit(noMatch > 5 ? 1 : 0);

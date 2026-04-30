/**
 * check_team_keys.ts
 * Audits the actual team key format stored in the games table for MLB, NBA, NHL.
 * This confirms whether awayTeam/homeTeam uses abbrev, dbSlug, or another format.
 * Run: npx tsx scripts/check_team_keys.ts
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { MLB_BY_ABBREV, MLB_BY_DB_SLUG } from "../shared/mlbTeams";
import { NHL_BY_DB_SLUG } from "../shared/nhlTeams";
import { getNbaTeamByDbSlug } from "../shared/nbaTeams";

async function main() {
  const db = await getDb();
  if (!db) { console.error("[ERROR] DB not available"); process.exit(1); }

  // ── MLB ────────────────────────────────────────────────────────────────────
  console.log("\n[STEP] Auditing MLB team key format...");
  const mlbRows = await db.select({ awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games).where(eq(games.sport, "MLB")).limit(15);

  let mlbAbbrHits = 0, mlbDbSlugHits = 0, mlbMisses = 0;
  for (const r of mlbRows) {
    for (const key of [r.awayTeam, r.homeTeam]) {
      const byAbbrev = MLB_BY_ABBREV.get(key);
      const byDbSlug = MLB_BY_DB_SLUG.get(key);
      if (byAbbrev) mlbAbbrHits++;
      else if (byDbSlug) mlbDbSlugHits++;
      else mlbMisses++;
      if (!byAbbrev && !byDbSlug) {
        console.log(`  [MISS] MLB key="${key}" — not found in MLB_BY_ABBREV or MLB_BY_DB_SLUG`);
      }
    }
  }
  console.log(`[STATE] MLB: abbrev_hits=${mlbAbbrHits} dbSlug_hits=${mlbDbSlugHits} misses=${mlbMisses}`);
  console.log(`[VERIFY] MLB logo lookup uses: ${mlbAbbrHits > mlbDbSlugHits ? 'MLB_BY_ABBREV (CORRECT)' : mlbDbSlugHits > mlbAbbrHits ? 'MLB_BY_DB_SLUG (NEEDS FIX: GameCard uses MLB_BY_ABBREV)' : 'UNKNOWN'}`);

  // ── NHL ────────────────────────────────────────────────────────────────────
  console.log("\n[STEP] Auditing NHL team key format...");
  const nhlRows = await db.select({ awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games).where(eq(games.sport, "NHL")).limit(15);

  let nhlHits = 0, nhlMisses = 0;
  for (const r of nhlRows) {
    for (const key of [r.awayTeam, r.homeTeam]) {
      const entry = NHL_BY_DB_SLUG.get(key);
      if (entry) nhlHits++;
      else { nhlMisses++; console.log(`  [MISS] NHL key="${key}" — not found in NHL_BY_DB_SLUG`); }
    }
  }
  console.log(`[STATE] NHL: hits=${nhlHits} misses=${nhlMisses}`);

  // ── NBA ────────────────────────────────────────────────────────────────────
  console.log("\n[STEP] Auditing NBA team key format...");
  const nbaRows = await db.select({ awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games).where(eq(games.sport, "NBA")).limit(15);

  let nbaHits = 0, nbaMisses = 0;
  for (const r of nbaRows) {
    for (const key of [r.awayTeam, r.homeTeam]) {
      const entry = getNbaTeamByDbSlug(key);
      if (entry) nbaHits++;
      else { nbaMisses++; console.log(`  [MISS] NBA key="${key}" — not found in getNbaTeamByDbSlug`); }
    }
  }
  console.log(`[STATE] NBA: hits=${nbaHits} misses=${nbaMisses}`);

  console.log("\n[OUTPUT] Audit complete");
  process.exit(0);
}

main().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

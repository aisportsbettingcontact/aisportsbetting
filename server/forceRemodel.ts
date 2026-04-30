import { getDb } from "./db.js";
import { games } from "../drizzle/schema.js";
import { and, eq, isNotNull } from "drizzle-orm";

const TAG = "[ForceRemodel]";

async function main() {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  console.log(`${TAG} Clearing modelRunAt for ${today} MLB + NHL games with confirmed lines...`);

  // Clear MLB games that have awayRunLine (confirmed DK lines) but may have stale model data
  const mlbResult = await db.update(games)
    .set({ modelRunAt: null })
    .where(and(
      eq(games.gameDate, today),
      eq(games.sport, "MLB"),
      isNotNull(games.awayRunLine),
      isNotNull(games.bookTotal),
    ));
  console.log(`${TAG} MLB games cleared for re-model`);

  // Clear NHL games that have awayBookSpread (confirmed DK lines)
  const nhlResult = await db.update(games)
    .set({ modelRunAt: null })
    .where(and(
      eq(games.gameDate, today),
      eq(games.sport, "NHL"),
      isNotNull(games.awayBookSpread),
      isNotNull(games.bookTotal),
    ));
  console.log(`${TAG} NHL games cleared for re-model`);

  console.log(`${TAG} Done. Trigger a model refresh to re-run with corrected line anchoring.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

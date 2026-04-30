import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  // Test: write "-1.5" string to awayModelSpread decimal column and read it back
  const testId = 2250232; // KC@DET
  
  // Write -1.5 as string
  await db.update(games).set({ awayModelSpread: "-1.5", homeModelSpread: "+1.5" }).where(eq(games.id, testId));
  
  // Read it back
  const [row] = await db.select({ awayModelSpread: games.awayModelSpread, homeModelSpread: games.homeModelSpread }).from(games).where(eq(games.id, testId));
  console.log(`After writing "-1.5": awayModelSpread=${JSON.stringify(row.awayModelSpread)} homeModelSpread=${JSON.stringify(row.homeModelSpread)}`);
  
  // Write -1.5 as number
  await db.update(games).set({ awayModelSpread: -1.5 as any, homeModelSpread: 1.5 as any }).where(eq(games.id, testId));
  const [row2] = await db.select({ awayModelSpread: games.awayModelSpread, homeModelSpread: games.homeModelSpread }).from(games).where(eq(games.id, testId));
  console.log(`After writing -1.5 (number): awayModelSpread=${JSON.stringify(row2.awayModelSpread)} homeModelSpread=${JSON.stringify(row2.homeModelSpread)}`);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

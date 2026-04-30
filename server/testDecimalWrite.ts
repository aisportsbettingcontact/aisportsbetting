import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { eq, like } from "drizzle-orm";

async function main() {
  const db = await getDb();
  // Find KC@DET game
  const rows = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayBookSpread: games.awayBookSpread,
    homeBookSpread: games.homeBookSpread,
    awayRunLine: games.awayRunLine,
    homeRunLine: games.homeRunLine,
    bookTotal: games.bookTotal,
    modelTotal: games.modelTotal,
  }).from(games)
    .where(like(games.gameDate, "2026-04-14%"));

  for (const r of rows) {
    if (!r.awayModelSpread && !r.modelTotal) continue;
    const awayBook = parseFloat(String(r.awayBookSpread ?? "0"));
    const awayModel = parseFloat(String(r.awayModelSpread ?? "0"));
    const bkTotal = parseFloat(String(r.bookTotal ?? "0"));
    const mdlTotal = parseFloat(String(r.modelTotal ?? "0"));
    const rlOk = Math.sign(awayBook) === Math.sign(awayModel);
    const totalOk = Math.abs(bkTotal - mdlTotal) < 0.01;
    const status = (rlOk ? '✓RL' : '✗RL') + ' ' + (totalOk ? '✓TOT' : '✗TOT');
    console.log(`[${status}] ${r.awayTeam}@${r.homeTeam}: bookSpread=${r.awayBookSpread}/${r.homeBookSpread} modelSpread=${r.awayModelSpread}/${r.homeModelSpread} | bookRL=${r.awayRunLine}/${r.homeRunLine} | bookTotal=${r.bookTotal} modelTotal=${r.modelTotal}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

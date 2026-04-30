/**
 * auditMlbRerun.ts
 * Post-fix audit: verify all MLB games for today have correct book-anchored totals and RL sign alignment
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TODAY = "2026-04-14";

async function main() {
  const db = await getDb();
  
  const rows = await db
    .select({
      id: games.id,
      away: games.awayTeam,
      home: games.homeTeam,
      modelTotal: games.modelTotal,
      bookTotal: games.bookTotal,
      awayModelSpread: games.awayModelSpread,
      awayBookSpread: games.awayBookSpread,
      awayRunLineOdds: games.awayRunLineOdds,
      homeRunLineOdds: games.homeRunLineOdds,
      nrfiCombinedSignal: games.nrfiCombinedSignal,
      nrfiFilterPass: games.nrfiFilterPass,
      publishedModel: games.publishedModel,
    })
    .from(games)
    .where(and(eq(games.sport, "MLB"), eq(games.gameDate, TODAY)));

  console.log(`\n[AUDIT] MLB Games for ${TODAY}: ${rows.length} found\n`);
  
  let issues = 0;
  let modeled = 0;
  
  for (const g of rows) {
    const label = `[${g.id}] ${g.away} @ ${g.home}`;
    const bookT = parseFloat(String(g.bookTotal ?? "0"));
    const modelT = parseFloat(String(g.modelTotal ?? "0"));
    const awayRLRaw = String(g.awayModelSpread ?? "");
    const awayRLNum = parseFloat(awayRLRaw);
    const awayBookSpreadNum = parseFloat(String(g.awayBookSpread ?? "0"));
    const awayModelSpreadNum = parseFloat(awayRLRaw);
    
    const isModeled = g.publishedModel;
    if (isModeled) modeled++;
    
    // Check 1: total match
    const totalOk = Math.abs(bookT - modelT) < 0.01;
    
    // Check 2: RL is ±1.5
    const rlOk = !isNaN(awayRLNum) && Math.abs(Math.abs(awayRLNum) - 1.5) < 0.01;
    
    // Check 3: RL sign alignment
    let signOk = true;
    if (!isNaN(awayBookSpreadNum) && !isNaN(awayModelSpreadNum) && awayBookSpreadNum !== 0) {
      const bookSign = awayBookSpreadNum < 0 ? -1 : 1;
      const modelSign = awayModelSpreadNum < 0 ? -1 : 1;
      signOk = bookSign === modelSign;
    }
    
    // Check 4: RL odds populated
    const oddsOk = !!(g.awayRunLineOdds && g.awayRunLineOdds !== "NULL" && 
                   g.homeRunLineOdds && g.homeRunLineOdds !== "NULL");
    
    const allOk = totalOk && rlOk && signOk && oddsOk;
    const status = allOk ? "OK" : "FAIL";
    
    console.log(`[${status}] ${label}`);
    console.log(`       bookTotal=${bookT} | modelTotal=${modelT} | totalMatch=${totalOk}`);
    console.log(`       awayBookSpread=${awayBookSpreadNum} | awayModelSpread=${awayRLRaw} | rl_1.5=${rlOk} | signMatch=${signOk}`);
    console.log(`       awayRLOdds=${g.awayRunLineOdds} | homeRLOdds=${g.homeRunLineOdds} | oddsOk=${oddsOk}`);
    console.log(`       nrfiSignal=${g.nrfiCombinedSignal} | nrfiPass=${g.nrfiFilterPass} | modeled=${isModeled}`);
    
    if (!allOk) {
      issues++;
    }
  }
  
  console.log(`\n[SUMMARY] ${rows.length} games | ${modeled} modeled | ${issues} issues`);
  
  if (issues === 0) {
    console.log("[VALIDATION] ALL GATES PASS - MLB model re-run complete and correct");
  } else {
    console.log(`[VALIDATION] ${issues} ISSUES FOUND - see details above`);
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

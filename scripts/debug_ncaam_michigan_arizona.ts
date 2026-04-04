/**
 * debug_ncaam_michigan_arizona.ts
 * Deep diagnostic: run NCAAM model for Michigan @ Arizona with full verbose output
 */
import { BY_DB_SLUG } from "../shared/ncaamTeams.js";
import { runModelForGame } from "../server/ncaamModelEngine.js";
import { updateGameProjections } from "../server/db.js";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const TAG = "[DEBUG-NCAAM-Michigan-Arizona]";

async function main() {
  console.log(`${TAG} Starting diagnostic...`);
  
  // Step 1: Verify team registry lookup
  const awayInfo = BY_DB_SLUG.get("michigan");
  const homeInfo = BY_DB_SLUG.get("arizona");
  
  console.log(`${TAG} [INPUT] awayTeam=michigan → found=${!!awayInfo} kenpomSlug=${awayInfo?.kenpomSlug} conf=${awayInfo?.conference}`);
  console.log(`${TAG} [INPUT] homeTeam=arizona → found=${!!homeInfo} kenpomSlug=${homeInfo?.kenpomSlug} conf=${homeInfo?.conference}`);
  
  if (!awayInfo || !homeInfo) {
    console.error(`${TAG} [FAIL] Team not found in registry. STOP.`);
    process.exit(1);
  }
  
  // Step 2: Verify game record in DB
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<any[]>(
    "SELECT id, awayTeam, homeTeam, awayBookSpread, bookTotal, awayML, homeML FROM games WHERE id=1890053"
  );
  const game = rows[0];
  console.log(`${TAG} [INPUT] DB game: id=${game.id} ${game.awayTeam}@${game.homeTeam} spread=${game.awayBookSpread} total=${game.bookTotal} awayML=${game.awayML} homeML=${game.homeML}`);
  
  // Step 3: Build model input
  const mktSp  = parseFloat(String(game.awayBookSpread ?? "0"));
  const mktTo  = parseFloat(String(game.bookTotal ?? "0"));
  const mktMlA = game.awayML ? parseInt(game.awayML, 10) : null;
  const mktMlH = game.homeML ? parseInt(game.homeML, 10) : null;
  
  const KENPOM_EMAIL = process.env.KENPOM_EMAIL || 'taileredsportsbetting@gmail.com';
  const KENPOM_PASS  = '3$mHnYuV8iLcYau';
  
  const input = {
    away_team:    awayInfo.kenpomSlug,
    home_team:    homeInfo.kenpomSlug,
    conf_a:       awayInfo.conference,
    conf_h:       homeInfo.conference,
    mkt_sp:       mktSp,
    mkt_to:       mktTo,
    mkt_ml_a:     mktMlA,
    mkt_ml_h:     mktMlH,
    kenpom_email: KENPOM_EMAIL,
    kenpom_pass:  KENPOM_PASS,
  };
  
  console.log(`${TAG} [STEP] Running model with input:`, JSON.stringify(input, null, 2));
  
  const t0 = Date.now();
  const result = await runModelForGame(input);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  
  console.log(`${TAG} [OUTPUT] elapsed=${elapsed}s ok=${result.ok}`);
  
  if (!result.ok) {
    console.error(`${TAG} [FAIL] Model error: ${result.error}`);
    await conn.end();
    process.exit(1);
  }
  
  console.log(`${TAG} [OUTPUT] Model result:`, JSON.stringify(result, null, 2));
  
  // Step 4: Write projections to DB
  await updateGameProjections(1890053, {
    awayModelSpread:     String(result.orig_away_sp),
    homeModelSpread:     String(result.orig_home_sp),
    modelTotal:          String(result.orig_total),
    modelAwayML:         result.away_ml_fair ? (result.away_ml_fair > 0 ? `+${result.away_ml_fair}` : String(result.away_ml_fair)) : null,
    modelHomeML:         result.home_ml_fair ? (result.home_ml_fair > 0 ? `+${result.home_ml_fair}` : String(result.home_ml_fair)) : null,
    modelAwayScore:      String(result.orig_away_score),
    modelHomeScore:      String(result.orig_home_score),
    modelOverRate:       String(result.over_rate),
    modelUnderRate:      String(result.under_rate),
    modelAwayWinPct:     String(result.ml_away_pct),
    modelHomeWinPct:     String(result.ml_home_pct),
    modelSpreadClamped:  result.spread_clamped,
    modelTotalClamped:   result.total_clamped,
    modelCoverDirection: result.cover_direction,
  });
  
  console.log(`${TAG} [VERIFY] Projections written to DB for id=1890053`);
  
  // Verify
  const [verify] = await conn.query<any[]>(
    "SELECT id, awayTeam, homeTeam, awayModelSpread, modelTotal, modelAwayWinPct, modelHomeWinPct FROM games WHERE id=1890053"
  );
  console.log(`${TAG} [VERIFY] DB state: spread=${verify[0].awayModelSpread} total=${verify[0].modelTotal} win=${verify[0].modelAwayWinPct}%/${verify[0].modelHomeWinPct}%`);
  
  await conn.end();
  console.log(`${TAG} [DONE] Michigan @ Arizona model complete.`);
}

main().catch(e => {
  console.error(`${TAG} [FATAL]`, e.message, e.stack);
  process.exit(1);
});

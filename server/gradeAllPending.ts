/**
 * gradeAllPending.ts — One-shot script to grade all PENDING tracked bets.
 * Uses gradeTrackedBet from scoreGrader.ts.
 * BetGradeOutput: { result: GradeResult, awayScore: number|null, homeScore: number|null, gameState: string, reason: string }
 * GradeResult: "WIN" | "LOSS" | "PUSH" | "PENDING" | "NO_RESULT"
 */
import { getDb } from "./db";
import { trackedBets } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  gradeTrackedBet,
  fetchScores,
  type Sport as GraderSport,
  type Timeframe as GraderTimeframe,
  type Market as GraderMarket,
  type PickSide as GraderPickSide,
} from "./scoreGrader";

async function main() {
  const db = await getDb();

  // Fetch all PENDING bets
  const pending = await db.select().from(trackedBets).where(eq(trackedBets.result, "PENDING"));
  console.log(`[GradeAllPending][INPUT] Found ${pending.length} PENDING bets`);

  if (pending.length === 0) {
    console.log("[GradeAllPending][OUTPUT] No pending bets to grade.");
    process.exit(0);
  }

  // Group by date + sport for pre-fetch
  const dateMap = new Map<string, Set<string>>();
  for (const bet of pending) {
    if (!dateMap.has(bet.gameDate)) dateMap.set(bet.gameDate, new Set());
    dateMap.get(bet.gameDate)!.add(bet.sport);
  }

  // Pre-fetch scores for all needed dates/sports
  const scoresByKey = new Map<string, Awaited<ReturnType<typeof fetchScores>>>();
  for (const [date, sports] of Array.from(dateMap.entries())) {
    for (const sport of Array.from(sports)) {
      const key = `${sport}:${date}`;
      console.log(`[GradeAllPending][STEP] Pre-fetching scores: sport=${sport} date=${date}`);
      try {
        const scores = await fetchScores(sport as GraderSport, date);
        scoresByKey.set(key, scores);
        console.log(`[GradeAllPending][STATE] Fetched ${scores.length} games for ${sport} on ${date}`);
        // Log each game found
        for (const g of scores) {
          const fg = g.scores?.FULL_GAME;
          console.log(`  [GAME] ${g.awayAbbrev}@${g.homeAbbrev} state=${g.gameState} score=${fg?.awayScore ?? '?'}-${fg?.homeScore ?? '?'}`);
        }
      } catch (e) {
        console.error(`[GradeAllPending][ERROR] fetchScores failed for ${sport} ${date}:`, e);
        scoresByKey.set(key, []);
      }
    }
  }

  let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0, errors = 0;

  for (const bet of pending) {
    const key = `${bet.sport}:${bet.gameDate}`;
    const scores = scoresByKey.get(key) ?? [];

    console.log(`[GradeAllPending][STEP] Grading id=${bet.id} ${bet.pick} ${bet.sport} ${bet.gameDate} ${bet.awayTeam}@${bet.homeTeam} market=${bet.market} pickSide=${bet.pickSide} odds=${bet.odds} line=${bet.line}`);

    try {
      const gradeOut = await gradeTrackedBet({
        sport:      bet.sport as GraderSport,
        gameDate:   bet.gameDate,
        awayTeam:   bet.awayTeam ?? "",
        homeTeam:   bet.homeTeam ?? "",
        timeframe:  (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
        market:     (bet.market ?? "ML") as GraderMarket,
        pickSide:   (bet.pickSide ?? "AWAY") as GraderPickSide,
        odds:       bet.odds,
        line:       bet.line !== null && bet.line !== undefined ? parseFloat(String(bet.line)) : undefined,
        anGameId:   bet.anGameId ?? null,
      });

      const { result, awayScore, homeScore, gameState, reason } = gradeOut;
      console.log(`[GradeAllPending][STATE] id=${bet.id} → result=${result} score=${awayScore}-${homeScore} state=${gameState} reason=${reason}`);

      if (result === "WIN" || result === "LOSS" || result === "PUSH") {
        await db.update(trackedBets)
          .set({
            result:     result as "WIN" | "LOSS" | "PUSH",
            awayScore:  awayScore !== null ? String(awayScore) : null,
            homeScore:  homeScore !== null ? String(homeScore) : null,
            updatedAt:  new Date(),
          })
          .where(eq(trackedBets.id, bet.id));

        graded++;
        if (result === "WIN") wins++;
        else if (result === "LOSS") losses++;
        else if (result === "PUSH") pushes++;

        console.log(`[GradeAllPending][OUTPUT] id=${bet.id} ${bet.pick} → ${result} (${awayScore}-${homeScore})`);
      } else {
        // PENDING or NO_RESULT — game not final yet
        stillPending++;
        console.log(`[GradeAllPending][STATE] id=${bet.id} ${bet.pick} → ${result} (${reason}) — leaving as PENDING`);
      }
    } catch (e) {
      errors++;
      console.error(`[GradeAllPending][ERROR] id=${bet.id} ${bet.pick}:`, e);
    }
  }

  console.log(`\n[GradeAllPending][OUTPUT] COMPLETE: total=${pending.length} graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending} errors=${errors}`);
  console.log(`[GradeAllPending][VERIFY] ${errors === 0 ? "PASS" : "WARN"} — ${errors} errors`);
  process.exit(0);
}

main().catch(e => { console.error("[GradeAllPending][ERROR] Fatal:", e); process.exit(1); });

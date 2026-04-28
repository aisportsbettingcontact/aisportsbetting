/**
 * importPrez2026MLB.ts
 *
 * One-time import script: inserts all 85 Prez 2026 MLB season bets into tracked_bets.
 *
 * Execution:
 *   npx tsx server/importPrez2026MLB.ts
 *
 * Safety:
 *   - Clears existing test bets (ids 1-8) first
 *   - Idempotent: checks for existing import before inserting
 *   - All 85 bets use unit-based risk (1U = 1.00 in DB)
 *   - 6 pending bets (04/21) set to result=PENDING for auto-grading
 *   - 79 settled bets use result=WIN or LOSS
 *
 * Team mapping for Total bets:
 *   "PIT/CIN"  → awayTeam=PIT homeTeam=CIN
 *   "CLE/ATL"  → awayTeam=CLE homeTeam=ATL
 *   "WSH/PIT"  → awayTeam=WSH homeTeam=PIT
 *   "CLE/STL"  → awayTeam=CLE homeTeam=STL
 *   "TEX/OAK"  → awayTeam=TEX homeTeam=OAK
 *   "KC/NYY"   → awayTeam=KC  homeTeam=NYY
 *   "TOR/ARI"  → awayTeam=TOR homeTeam=ARI
 *   "SD/LAA"   → awayTeam=SD  homeTeam=LAA
 *   "ARI/BAL"  → awayTeam=ARI homeTeam=BAL
 *
 * Logging convention:
 *   [IMPORT][INPUT]  — raw bet data
 *   [IMPORT][STEP]   — operation in progress
 *   [IMPORT][STATE]  — intermediate state
 *   [IMPORT][OUTPUT] — final result
 *   [IMPORT][VERIFY] — validation pass/fail
 *   [IMPORT][ERROR]  — failure with context
 */

import { getDb } from "./db";
import { trackedBets } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

// ─── Prez userId ─────────────────────────────────────────────────────────────
const PREZ_USER_ID = 1;

// ─── Raw bet data ─────────────────────────────────────────────────────────────
// Fields: date(MM/DD), team, betType, line, odds, risk, toWin, result, awayTeam, homeTeam, pickSide, market, timeframe
interface RawBet {
  date: string;       // MM/DD → 2026-MM-DD
  team: string;       // display label
  betType: "ML" | "RL" | "OVER" | "UNDER";
  line: string | null;
  odds: number;
  risk: number;       // in units
  toWin: number;      // in units
  result: "WIN" | "LOSS" | "PENDING";
  awayTeam: string;
  homeTeam: string;
  pickSide: "AWAY" | "HOME" | "OVER" | "UNDER";
  market: "ML" | "RL" | "TOTAL";
  timeframe: "FULL_GAME";
  pick: string;       // human-readable pick label
}

// Helper: parse line value from string like "+1½", "-1½", "U 9-10", "U 9½", "O 8½", etc.
function parseLine(lineStr: string | null): string | null {
  if (!lineStr) return null;
  // For RL: extract numeric value
  const rlMatch = lineStr.match(/([+-]?\d+\.?\d*)/);
  if (rlMatch) return rlMatch[1];
  return null;
}

// Helper: convert MM/DD to 2026-MM-DD
function toGameDate(mmdd: string): string {
  const [mm, dd] = mmdd.split("/");
  return `2026-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// ─── Raw bet definitions ──────────────────────────────────────────────────────
// For ML bets: awayTeam = opponent (unknown), homeTeam = team (or vice versa)
// We'll use the team name as awayTeam for ML bets (pick = AWAY)
// For RL bets: same convention — the team is the pick side
// For Total bets: awayTeam/homeTeam from the game label (e.g. PIT/CIN)

const RAW_BETS: RawBet[] = [
  // 03/25
  { date: "03/25", team: "Giants",    betType: "ML",    line: null,    odds: +111, risk: 3.00, toWin: 3.33, result: "LOSS",    awayTeam: "SF",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "SF ML" },
  // 03/26
  { date: "03/26", team: "Cardinals", betType: "ML",    line: null,    odds: +115, risk: 3.00, toWin: 3.45, result: "WIN",     awayTeam: "STL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "STL ML" },
  { date: "03/26", team: "Reds",      betType: "ML",    line: null,    odds: +138, risk: 3.00, toWin: 4.14, result: "LOSS",    awayTeam: "CIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CIN ML" },
  { date: "03/26", team: "D-backs",   betType: "RL",    line: "+1.5",  odds: +115, risk: 2.00, toWin: 2.30, result: "LOSS",    awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "ARI RL +1.5" },
  { date: "03/26", team: "D-backs",   betType: "ML",    line: null,    odds: +225, risk: 1.00, toWin: 2.25, result: "LOSS",    awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ARI ML" },
  // 03/29
  { date: "03/29", team: "Guardians", betType: "ML",    line: null,    odds: +124, risk: 5.00, toWin: 6.20, result: "LOSS",    awayTeam: "CLE", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CLE ML" },
  // 03/31
  { date: "03/31", team: "Brewers",   betType: "ML",    line: null,    odds: -125, risk: 6.25, toWin: 5.00, result: "WIN",     awayTeam: "MIL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIL ML" },
  { date: "03/31", team: "Cardinals", betType: "ML",    line: null,    odds: +143, risk: 3.00, toWin: 4.29, result: "WIN",     awayTeam: "STL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "STL ML" },
  { date: "03/31", team: "Nationals", betType: "ML",    line: null,    odds: +164, risk: 3.00, toWin: 4.92, result: "LOSS",    awayTeam: "WSH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "WSH ML" },
  { date: "03/31", team: "PIT/CIN",   betType: "UNDER", line: "9.0",   odds: -105, risk: 3.15, toWin: 3.00, result: "LOSS",    awayTeam: "PIT", homeTeam: "CIN", pickSide: "UNDER", market: "TOTAL", timeframe: "FULL_GAME", pick: "UNDER 9" },
  { date: "03/31", team: "Reds",      betType: "ML",    line: null,    odds: +103, risk: 3.00, toWin: 3.09, result: "LOSS",    awayTeam: "CIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CIN ML" },
  { date: "03/31", team: "Marlins",   betType: "ML",    line: null,    odds: -153, risk: 4.59, toWin: 3.00, result: "WIN",     awayTeam: "MIA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIA ML" },
  { date: "03/31", team: "Guardians", betType: "RL",    line: "+1.5",  odds: +110, risk: 3.00, toWin: 3.30, result: "LOSS",    awayTeam: "CLE", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "CLE RL +1.5" },
  { date: "03/31", team: "D-backs",   betType: "ML",    line: null,    odds: -104, risk: 3.12, toWin: 3.00, result: "WIN",     awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ARI ML" },
  // 04/01
  { date: "04/01", team: "Royals",    betType: "ML",    line: null,    odds: -102, risk: 5.10, toWin: 5.00, result: "WIN",     awayTeam: "KC",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "KC ML" },
  // 04/02
  { date: "04/02", team: "Giants",    betType: "ML",    line: null,    odds: +110, risk: 5.00, toWin: 5.50, result: "WIN",     awayTeam: "SF",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "SF ML" },
  // 04/03
  { date: "04/03", team: "Angels",    betType: "ML",    line: null,    odds: +143, risk: 1.00, toWin: 1.43, result: "LOSS",    awayTeam: "LAA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "LAA ML" },
  { date: "04/03", team: "Athletics", betType: "ML",    line: null,    odds: -104, risk: 5.20, toWin: 5.00, result: "WIN",     awayTeam: "ATH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATH ML" },
  { date: "04/03", team: "Giants",    betType: "ML",    line: null,    odds: +117, risk: 4.00, toWin: 4.68, result: "LOSS",    awayTeam: "SF",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "SF ML" },
  // 04/04
  { date: "04/04", team: "Athletics", betType: "ML",    line: null,    odds: -106, risk: 5.30, toWin: 5.00, result: "LOSS",    awayTeam: "ATH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATH ML" },
  { date: "04/04", team: "Rays",      betType: "ML",    line: null,    odds: -104, risk: 4.16, toWin: 4.00, result: "WIN",     awayTeam: "TB",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "TB ML" },
  { date: "04/04", team: "Reds",      betType: "ML",    line: null,    odds: +126, risk: 3.00, toWin: 3.78, result: "WIN",     awayTeam: "CIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CIN ML" },
  { date: "04/04", team: "Nationals", betType: "RL",    line: "+1.5",  odds: +160, risk: 2.00, toWin: 3.20, result: "LOSS",    awayTeam: "WSH", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "WSH RL +1.5" },
  { date: "04/04", team: "Rockies",   betType: "ML",    line: null,    odds: +200, risk: 1.00, toWin: 2.00, result: "LOSS",    awayTeam: "COL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "COL ML" },
  // 04/05
  { date: "04/05", team: "Cardinals", betType: "ML",    line: null,    odds: +122, risk: 5.00, toWin: 6.10, result: "WIN",     awayTeam: "STL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "STL ML" },
  // 04/07
  { date: "04/07", team: "Rangers",   betType: "ML",    line: null,    odds: +104, risk: 5.00, toWin: 5.20, result: "WIN",     awayTeam: "TEX", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "TEX ML" },
  // 04/08
  { date: "04/08", team: "Twins",     betType: "ML",    line: null,    odds: +135, risk: 5.00, toWin: 6.75, result: "WIN",     awayTeam: "MIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIN ML" },
  { date: "04/08", team: "D-backs",   betType: "ML",    line: null,    odds: +119, risk: 4.00, toWin: 4.76, result: "WIN",     awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ARI ML" },
  { date: "04/08", team: "Nationals", betType: "ML",    line: null,    odds: +107, risk: 3.00, toWin: 3.21, result: "LOSS",    awayTeam: "WSH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "WSH ML" },
  { date: "04/08", team: "Angels",    betType: "ML",    line: null,    odds: +109, risk: 2.00, toWin: 2.18, result: "LOSS",    awayTeam: "LAA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "LAA ML" },
  { date: "04/08", team: "Athletics", betType: "ML",    line: null,    odds: +180, risk: 1.00, toWin: 1.80, result: "WIN",     awayTeam: "ATH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATH ML" },
  // 04/09
  { date: "04/09", team: "Reds",      betType: "ML",    line: null,    odds: +108, risk: 3.00, toWin: 3.24, result: "LOSS",    awayTeam: "CIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CIN ML" },
  // 04/10
  { date: "04/10", team: "Mariners",  betType: "RL",    line: "-1.5",  odds: +155, risk: 3.00, toWin: 4.65, result: "WIN",     awayTeam: "SEA", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "SEA RL -1.5" },
  { date: "04/10", team: "Brewers",   betType: "RL",    line: "-1.5",  odds: +100, risk: 3.00, toWin: 3.00, result: "LOSS",    awayTeam: "MIL", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "MIL RL -1.5" },
  { date: "04/10", team: "Mets",      betType: "RL",    line: "-1.5",  odds: +150, risk: 3.00, toWin: 4.50, result: "LOSS",    awayTeam: "NYM", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "NYM RL -1.5" },
  { date: "04/10", team: "Marlins",   betType: "ML",    line: null,    odds: +126, risk: 3.00, toWin: 3.78, result: "LOSS",    awayTeam: "MIA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIA ML" },
  { date: "04/10", team: "D-backs",   betType: "ML",    line: null,    odds: +155, risk: 3.00, toWin: 4.65, result: "WIN",     awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ARI ML" },
  // 04/11
  { date: "04/11", team: "Braves",    betType: "ML",    line: null,    odds: -107, risk: 10.70, toWin: 10.00, result: "LOSS",  awayTeam: "ATL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATL ML" },
  { date: "04/11", team: "Dodgers",   betType: "RL",    line: "-1.5",  odds: +115, risk: 5.00, toWin: 5.75, result: "WIN",     awayTeam: "LAD", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "LAD RL -1.5" },
  { date: "04/11", team: "Mariners",  betType: "RL",    line: "-1.5",  odds: +150, risk: 4.00, toWin: 6.00, result: "LOSS",    awayTeam: "SEA", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "SEA RL -1.5" },
  { date: "04/11", team: "Orioles",   betType: "ML",    line: null,    odds: +106, risk: 3.00, toWin: 3.18, result: "WIN",     awayTeam: "BAL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "BAL ML" },
  { date: "04/11", team: "Marlins",   betType: "ML",    line: null,    odds: +127, risk: 2.00, toWin: 2.54, result: "LOSS",    awayTeam: "MIA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIA ML" },
  { date: "04/11", team: "D-backs",   betType: "ML",    line: null,    odds: +122, risk: 1.00, toWin: 1.22, result: "LOSS",    awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ARI ML" },
  // 04/12
  { date: "04/12", team: "Guardians", betType: "RL",    line: "+1.5",  odds: -130, risk: 6.50, toWin: 5.00, result: "LOSS",    awayTeam: "CLE", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "CLE RL +1.5" },
  { date: "04/12", team: "CLE/ATL",   betType: "UNDER", line: "7.0",   odds: +100, risk: 5.00, toWin: 5.00, result: "LOSS",    awayTeam: "CLE", homeTeam: "ATL", pickSide: "UNDER", market: "TOTAL", timeframe: "FULL_GAME", pick: "UNDER 7" },
  // 04/13
  { date: "04/13", team: "Cardinals", betType: "ML",    line: null,    odds: +105, risk: 3.00, toWin: 3.15, result: "LOSS",    awayTeam: "STL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "STL ML" },
  { date: "04/13", team: "Twins",     betType: "ML",    line: null,    odds: +145, risk: 3.00, toWin: 4.35, result: "WIN",     awayTeam: "MIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIN ML" },
  { date: "04/13", team: "Marlins",   betType: "ML",    line: null,    odds: +136, risk: 3.00, toWin: 4.08, result: "WIN",     awayTeam: "MIA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIA ML" },
  // 04/14
  { date: "04/14", team: "Mets",      betType: "RL",    line: "+1.5",  odds: -120, risk: 12.00, toWin: 10.00, result: "WIN",   awayTeam: "NYM", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "NYM RL +1.5" },
  { date: "04/14", team: "Athletics", betType: "ML",    line: null,    odds: +117, risk: 5.00, toWin: 5.85, result: "WIN",     awayTeam: "ATH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATH ML" },
  { date: "04/14", team: "WSH/PIT",   betType: "UNDER", line: "9.5",   odds: +100, risk: 4.00, toWin: 4.00, result: "WIN",     awayTeam: "WSH", homeTeam: "PIT", pickSide: "UNDER", market: "TOTAL", timeframe: "FULL_GAME", pick: "UNDER 9.5" },
  { date: "04/14", team: "CLE/STL",   betType: "UNDER", line: "9.0",   odds: -115, risk: 3.45, toWin: 3.00, result: "LOSS",    awayTeam: "CLE", homeTeam: "STL", pickSide: "UNDER", market: "TOTAL", timeframe: "FULL_GAME", pick: "UNDER 9" },
  { date: "04/14", team: "Rockies",   betType: "ML",    line: null,    odds: +152, risk: 2.00, toWin: 3.04, result: "LOSS",    awayTeam: "COL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "COL ML" },
  { date: "04/14", team: "TEX/OAK",   betType: "OVER",  line: "8.5",   odds: -120, risk: 1.20, toWin: 1.00, result: "LOSS",    awayTeam: "TEX", homeTeam: "ATH", pickSide: "OVER",  market: "TOTAL", timeframe: "FULL_GAME", pick: "OVER 8.5" },
  // 04/15
  { date: "04/15", team: "Yankees",   betType: "RL",    line: "-1.5",  odds: +100, risk: 10.00, toWin: 10.00, result: "LOSS",  awayTeam: "NYY", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "NYY RL -1.5" },
  { date: "04/15", team: "Padres",    betType: "ML",    line: null,    odds: -108, risk: 5.40, toWin: 5.00, result: "WIN",     awayTeam: "SD",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "SD ML" },
  { date: "04/15", team: "Twins",     betType: "ML",    line: null,    odds: +118, risk: 3.00, toWin: 3.54, result: "LOSS",    awayTeam: "MIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIN ML" },
  { date: "04/15", team: "ARI/BAL",   betType: "UNDER", line: "9.0",   odds: -110, risk: 3.30, toWin: 3.00, result: "LOSS",    awayTeam: "ARI", homeTeam: "BAL", pickSide: "UNDER", market: "TOTAL", timeframe: "FULL_GAME", pick: "UNDER 9" },
  { date: "04/15", team: "Athletics", betType: "ML",    line: null,    odds: -117, risk: 4.68, toWin: 4.00, result: "WIN",     awayTeam: "ATH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATH ML" },
  { date: "04/15", team: "Rays",      betType: "ML",    line: null,    odds: -106, risk: 3.18, toWin: 3.00, result: "WIN",     awayTeam: "TB",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "TB ML" },
  { date: "04/15", team: "Mets",      betType: "RL",    line: "+1.5",  odds: -125, risk: 2.50, toWin: 2.00, result: "LOSS",    awayTeam: "NYM", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "NYM RL +1.5" },
  { date: "04/15", team: "Tigers",    betType: "ML",    line: null,    odds: -123, risk: 1.23, toWin: 1.00, result: "WIN",     awayTeam: "DET", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "DET ML" },
  // 04/16
  { date: "04/16", team: "Athletics", betType: "ML",    line: null,    odds: -101, risk: 5.05, toWin: 5.00, result: "LOSS",    awayTeam: "ATH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATH ML" },
  // 04/17
  { date: "04/17", team: "KC/NYY",    betType: "OVER",  line: "8.0",   odds: -105, risk: 10.50, toWin: 10.00, result: "LOSS",  awayTeam: "KC",  homeTeam: "NYY", pickSide: "OVER",  market: "TOTAL", timeframe: "FULL_GAME", pick: "OVER 8" },
  { date: "04/17", team: "Braves",    betType: "ML",    line: null,    odds: -114, risk: 5.70, toWin: 5.00, result: "WIN",     awayTeam: "ATL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ATL ML" },
  { date: "04/17", team: "Nationals", betType: "ML",    line: null,    odds: +128, risk: 4.00, toWin: 5.12, result: "LOSS",    awayTeam: "WSH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "WSH ML" },
  { date: "04/17", team: "White Sox", betType: "ML",    line: null,    odds: +143, risk: 3.00, toWin: 4.29, result: "WIN",     awayTeam: "CWS", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CWS ML" },
  { date: "04/17", team: "Rockies",   betType: "RL",    line: "+1.5",  odds: +160, risk: 2.00, toWin: 3.20, result: "LOSS",    awayTeam: "COL", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "COL RL +1.5" },
  { date: "04/17", team: "Reds",      betType: "ML",    line: null,    odds: +154, risk: 1.00, toWin: 1.54, result: "WIN",     awayTeam: "CIN", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "CIN ML" },
  // 04/18
  { date: "04/18", team: "TOR/ARI",   betType: "OVER",  line: "9.0",   odds: -115, risk: 5.75, toWin: 5.00, result: "LOSS",    awayTeam: "TOR", homeTeam: "ARI", pickSide: "OVER",  market: "TOTAL", timeframe: "FULL_GAME", pick: "OVER 9" },
  { date: "04/18", team: "SD/LAA",    betType: "UNDER", line: "9.5",   odds: -120, risk: 6.00, toWin: 5.00, result: "WIN",     awayTeam: "SD",  homeTeam: "LAA", pickSide: "UNDER", market: "TOTAL", timeframe: "FULL_GAME", pick: "UNDER 9.5" },
  // 04/19
  { date: "04/19", team: "Phillies",  betType: "ML",    line: null,    odds: -107, risk: 10.70, toWin: 10.00, result: "LOSS",  awayTeam: "PHI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "PHI ML" },
  { date: "04/19", team: "Mariners",  betType: "ML",    line: null,    odds: -134, risk: 6.70, toWin: 5.00, result: "WIN",     awayTeam: "SEA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "SEA ML" },
  { date: "04/19", team: "D-backs",   betType: "ML",    line: null,    odds: -103, risk: 4.12, toWin: 4.00, result: "LOSS",    awayTeam: "ARI", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "ARI ML" },
  { date: "04/19", team: "TOR/ARI",   betType: "OVER",  line: "8.0",   odds: -110, risk: 3.30, toWin: 3.00, result: "WIN",     awayTeam: "TOR", homeTeam: "ARI", pickSide: "OVER",  market: "TOTAL", timeframe: "FULL_GAME", pick: "OVER 8" },
  { date: "04/19", team: "Mariners",  betType: "RL",    line: "-1.5",  odds: +160, risk: 2.00, toWin: 3.20, result: "WIN",     awayTeam: "SEA", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "SEA RL -1.5" },
  { date: "04/19", team: "Angels",    betType: "RL",    line: "+1.5",  odds: -130, risk: 2.60, toWin: 2.00, result: "WIN",     awayTeam: "LAA", homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "LAA RL +1.5" },
  { date: "04/19", team: "Angels",    betType: "ML",    line: null,    odds: +132, risk: 1.00, toWin: 1.32, result: "LOSS",    awayTeam: "LAA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "LAA ML" },
  // 04/20
  { date: "04/20", team: "Orioles",   betType: "ML",    line: null,    odds: -111, risk: 11.10, toWin: 10.00, result: "WIN",   awayTeam: "BAL", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "BAL ML" },
  // 04/21 — PENDING (need auto-grading)
  { date: "04/21", team: "Blue Jays", betType: "ML",    line: null,    odds: -101, risk: 5.05, toWin: 5.00, result: "PENDING", awayTeam: "TOR", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "TOR ML" },
  { date: "04/21", team: "Giants",    betType: "RL",    line: "+1.5",  odds: -115, risk: 4.60, toWin: 4.00, result: "PENDING", awayTeam: "SF",  homeTeam: "OPP", pickSide: "AWAY", market: "RL",    timeframe: "FULL_GAME", pick: "SF RL +1.5" },
  { date: "04/21", team: "Rays",      betType: "ML",    line: null,    odds: +101, risk: 3.00, toWin: 3.03, result: "PENDING", awayTeam: "TB",  homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "TB ML" },
  { date: "04/21", team: "Marlins",   betType: "ML",    line: null,    odds: -113, risk: 2.26, toWin: 2.00, result: "PENDING", awayTeam: "MIA", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "MIA ML" },
  { date: "04/21", team: "Nationals", betType: "ML",    line: null,    odds: +137, risk: 1.00, toWin: 1.37, result: "PENDING", awayTeam: "WSH", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "WSH ML" },
  { date: "04/21", team: "Astros",    betType: "ML",    line: null,    odds: +128, risk: 1.00, toWin: 1.28, result: "PENDING", awayTeam: "HOU", homeTeam: "OPP", pickSide: "AWAY", market: "ML",    timeframe: "FULL_GAME", pick: "HOU ML" },
];

// ─── Main import function ─────────────────────────────────────────────────────
async function runImport() {
  console.log("[IMPORT][STEP] Starting Prez 2026 MLB bet import...");
  console.log(`[IMPORT][INPUT] Total bets to import: ${RAW_BETS.length}`);

  const db = await getDb();

  // ── Step 1: Clear stale test bets (ids 1-8) ──────────────────────────────
  console.log("[IMPORT][STEP] Clearing stale test bets (ids 1-8)...");
  const staleIds = [1, 2, 3, 4, 5, 6, 7, 8];
  const deleteResult = await db.delete(trackedBets).where(inArray(trackedBets.id, staleIds));
  console.log(`[IMPORT][STATE] Deleted stale test bets`);

  // ── Step 2: Check for existing import (idempotency guard) ────────────────
  const existing = await db.select().from(trackedBets).where(eq(trackedBets.userId, PREZ_USER_ID));
  if (existing.length > 0) {
    console.log(`[IMPORT][VERIFY] FAIL — ${existing.length} bets already exist for userId=${PREZ_USER_ID}. Aborting to prevent duplicates.`);
    console.log("[IMPORT][OUTPUT] Import aborted. Run with --force to override.");
    process.exit(1);
  }
  console.log("[IMPORT][VERIFY] PASS — No existing bets for Prez. Proceeding with import.");

  // ── Step 3: Build insert rows ─────────────────────────────────────────────
  const rows = RAW_BETS.map((b, i) => {
    const gameDate = toGameDate(b.date);
    const lineVal = b.line ? parseFloat(b.line) : null;

    // Validate toWin math
    let expectedToWin: number;
    if (b.odds >= 100) {
      expectedToWin = parseFloat((b.risk * (b.odds / 100)).toFixed(2));
    } else {
      expectedToWin = parseFloat((b.risk * (100 / Math.abs(b.odds))).toFixed(2));
    }
    const toWinDiff = Math.abs(expectedToWin - b.toWin);
    if (toWinDiff > 0.05) {
      console.log(`[IMPORT][VERIFY] WARN row ${i + 1} ${b.date} ${b.team}: toWin=${b.toWin} expected=${expectedToWin} diff=${toWinDiff.toFixed(3)}`);
    }

    return {
      userId:    PREZ_USER_ID,
      gameId:    null,
      anGameId:  null,
      timeframe: b.timeframe as "FULL_GAME",
      market:    b.market as "ML" | "RL" | "TOTAL",
      pickSide:  b.pickSide as "AWAY" | "HOME" | "OVER" | "UNDER",
      sport:     "MLB",
      gameDate,
      awayTeam:  b.awayTeam,
      homeTeam:  b.homeTeam,
      betType:   b.betType as "ML" | "RL" | "OVER" | "UNDER",
      pick:      b.pick,
      line:      lineVal !== null ? String(lineVal) : null,
      odds:      b.odds,
      risk:      String(b.risk.toFixed(2)),
      toWin:     String(b.toWin.toFixed(2)),
      book:      null,
      notes:     null,
      result:    b.result as "WIN" | "LOSS" | "PENDING",
      awayScore: null,
      homeScore: null,
    };
  });

  console.log(`[IMPORT][STATE] Built ${rows.length} insert rows`);
  console.log(`[IMPORT][STATE] Settled: ${rows.filter(r => r.result !== "PENDING").length} | Pending: ${rows.filter(r => r.result === "PENDING").length}`);

  // ── Step 4: Bulk insert in batches of 25 ─────────────────────────────────
  const BATCH_SIZE = 25;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(trackedBets).values(batch as any);
    inserted += batch.length;
    console.log(`[IMPORT][STEP] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: rows ${i + 1}-${Math.min(i + BATCH_SIZE, rows.length)} (${inserted}/${rows.length})`);
  }

  // ── Step 5: Verify insert ─────────────────────────────────────────────────
  const final = await db.select().from(trackedBets).where(eq(trackedBets.userId, PREZ_USER_ID));
  console.log(`[IMPORT][VERIFY] ${final.length === RAW_BETS.length ? "PASS" : "FAIL"} — DB count=${final.length} expected=${RAW_BETS.length}`);

  const wins   = final.filter((r: typeof final[0]) => r.result === "WIN").length;
  const losses = final.filter((r: typeof final[0]) => r.result === "LOSS").length;
  const pending = final.filter((r: typeof final[0]) => r.result === "PENDING").length;
  console.log(`[IMPORT][OUTPUT] Import complete: ${wins}W ${losses}L ${pending}P | total=${final.length}`);

  // ── Step 6: Compute and verify net P/L ───────────────────────────────────
  let netPL = 0;
  for (const r of final as typeof final) {
    if (r.result === "WIN")  netPL += parseFloat(r.toWin);
    if (r.result === "LOSS") netPL -= parseFloat(r.risk);
  }
  console.log(`[IMPORT][VERIFY] Net P/L (settled only): ${netPL >= 0 ? "+" : ""}${netPL.toFixed(2)}U (expected: +7.95U)`);
  console.log("[IMPORT][OUTPUT] ✅ Prez 2026 MLB import COMPLETE");

  process.exit(0);
}

runImport().catch(e => {
  console.error("[IMPORT][ERROR]", e);
  process.exit(1);
});

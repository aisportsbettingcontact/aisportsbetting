/**
 * mlbHrPropsModelService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves mlbamId for all HR prop players and computes per-player HR
 * probability, model odds, edge, EV, and verdict.
 *
 * COMPUTATION MODEL (v2 — Statcast-enhanced):
 * ─────────────────────────────────────────────────────────────────────────────
 *   Step 1: Base team HR rate per PA
 *     base_rate = (team_hr9 / 27) * woba_scale * pitcher_adj * park_adj
 *
 *   Step 2: Statcast individual power adjustment (if player has Statcast data)
 *     iso_adj      = iso / LEAGUE_ISO          (isolated power signal)
 *     barrel_adj   = barrelPct / LEAGUE_BARREL (barrel rate signal)
 *     hardhit_adj  = hardHitPct / LEAGUE_HARDHIT (hard-hit rate signal)
 *     statcast_adj = 0.40 * iso_adj + 0.40 * barrel_adj + 0.20 * hardhit_adj
 *     [clamped to 0.30–3.00 to prevent extreme outliers]
 *
 *   Step 3: Poisson P(≥1 HR)
 *     lambda = base_rate * statcast_adj * PA_PER_GAME
 *     p_hr   = 1 - exp(-lambda)
 *     [clamped to 4%–45%]
 *
 *   If player has no Statcast data (pitchers, rookies < 50 PA):
 *     Falls back to base_rate only (statcast_adj = 1.0)
 *
 * Book source: Consensus (Action Network book_id=15)
 *   anNoVigOverPct = consensus no-vig implied probability for OVER
 *
 * Edge    = modelPHr - anNoVigOverPct
 * EV      = (edge / (1 - modelPHr)) * 100
 * Verdict = "OVER" if edge >= EDGE_THRESHOLD, else "PASS"
 *
 * [INPUT]  gameDate: string (YYYY-MM-DD)
 * [OUTPUT] HrPropsModelResult
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "./db";
import {
  mlbHrProps,
  mlbTeamBattingSplits,
  mlbPitcherStats,
  mlbParkFactors,
  mlbLineups,
  mlbPlayers,
  games,
} from "../drizzle/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";

const TAG = "[HrPropsModel]";

// ─── League-average Statcast constants (2025 MLB) ─────────────────────────────
const LEAGUE_WOBA     = 0.318;    // League wOBA
const LEAGUE_HR9      = 1.28;    // League HR/9 for pitchers
const LEAGUE_ISO      = 0.168;   // League ISO (SLG - AVG)
const LEAGUE_BARREL   = 8.3;     // League barrel rate (%)
const LEAGUE_HARDHIT  = 37.5;    // League hard-hit rate (%)
const PLAYER_PA_PER_GAME = 4.22; // Average PA per batter per game
// EDGE_THRESHOLD raised from 0.030 → 0.060 (empirical: 0.030 produced 8.6% win rate,
// well below the ~9.1% breakeven at +1000 odds; 0.060 targets the sharper edge tier)
const EDGE_THRESHOLD  = 0.060;   // Minimum edge to emit OVER verdict
// MIN_ABSOLUTE_P_HR: absolute probability floor for OVER bets.
// Data shows zero wins at modelPHr ≤ 0.11 and <5% at 0.12–0.24.
// Set to 0.25 to require the model to assign at least 25% HR probability before betting.
const MIN_ABSOLUTE_P_HR = 0.25;  // Absolute probability gate — must exceed this to bet OVER
const MIN_P_HR        = 0.04;
const MAX_P_HR        = 0.45;
const MIN_STATCAST_ADJ = 0.30;
const MAX_STATCAST_ADJ = 3.00;
// ─── Empirical calibration (derived from 510-game backtest, 2026 season) ──────
// Root cause: woba_scale double-counts HR rate (wOBA already incorporates HR).
// Empirical: model avg_pHr=0.286 for WIN+LOSS bets; actual win rate=9.3%.
// Calibration factor = actual_rate / model_avg_pHr = 0.093 / 0.286 = 0.325
// Applied as a final multiplier on lambda before P(HR) computation.
const HR_CALIBRATION_FACTOR = 0.325;  // empirical actual/model ratio

// ─── Types ────────────────────────────────────────────────────────────────────
export interface HrPropsModelResult {
  date: string;
  resolved: number;
  alreadyHad: number;
  unresolved: number;
  modeled: number;
  edges: number;
  errors: number;
}

interface TeamBattingContext {
  hr9: number;
  woba: number;
}

interface PitcherContext {
  hr9: number;
}

interface ParkContext {
  hrFactor: number;
}

interface StatcastContext {
  iso: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;
}

// ─── MLB Stats API name normalization ─────────────────────────────────────────
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+ii$|\s+iii$|\s+iv$/i, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

// ─── Fetch all active MLB player IDs from MLB Stats API ───────────────────────
async function fetchMlbamIdMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=2025&gameType=R`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { people?: Array<{ id: number; fullName: string }> };
    for (const p of data.people ?? []) {
      map.set(normalizeName(p.fullName), p.id);
    }
    console.log(`${TAG} [STATE] MLB Stats API: loaded ${map.size} players`);
  } catch (err) {
    console.error(`${TAG} [ERROR] MLB Stats API fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return map;
}

// ─── Statcast-enhanced Poisson P(≥1 HR) computation ──────────────────────────
function computePlayerPHr(
  teamBatting: TeamBattingContext,
  pitcher: PitcherContext,
  park: ParkContext,
  statcast: StatcastContext | null
): number {
  // Step 1: Base team HR rate per PA
  const hr_rate_per_pa = teamBatting.hr9 / 27.0;
  const woba_scale = teamBatting.woba / LEAGUE_WOBA;
  const pitcher_adj = Math.sqrt(pitcher.hr9 / LEAGUE_HR9);  // dampened
  const park_adj = park.hrFactor;
  const base_rate = hr_rate_per_pa * woba_scale * pitcher_adj * park_adj;

  // Step 2: Statcast individual power adjustment
  let statcast_adj = 1.0;  // fallback: use team average
  if (statcast && (statcast.iso != null || statcast.barrelPct != null || statcast.hardHitPct != null)) {
    const iso_adj     = statcast.iso      != null ? statcast.iso      / LEAGUE_ISO      : 1.0;
    const barrel_adj  = statcast.barrelPct  != null ? statcast.barrelPct  / LEAGUE_BARREL  : 1.0;
    const hardhit_adj = statcast.hardHitPct != null ? statcast.hardHitPct / LEAGUE_HARDHIT : 1.0;

    // Weighted composite: ISO and barrel are stronger HR signals than hard-hit
    const raw_adj = 0.40 * iso_adj + 0.40 * barrel_adj + 0.20 * hardhit_adj;
    statcast_adj = Math.max(MIN_STATCAST_ADJ, Math.min(MAX_STATCAST_ADJ, raw_adj));
  }

  // Step 3: Poisson P(≥1 HR)
  // Apply HR_CALIBRATION_FACTOR to correct the woba_scale double-counting bias.
  // Without calibration, model outputs pHr=0.25-0.41 for players with actual ~9% HR rate.
  const lambdaRaw = base_rate * statcast_adj * PLAYER_PA_PER_GAME;
  const lambda = lambdaRaw * HR_CALIBRATION_FACTOR;
  const p_hr = 1 - Math.exp(-lambda);

  return Math.max(MIN_P_HR, Math.min(MAX_P_HR, p_hr));
}

// ─── American odds from probability ──────────────────────────────────────────
function probToAmericanOdds(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function resolveAndModelHrProps(gameDate: string): Promise<HrPropsModelResult> {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] date=${gameDate} model=v2-statcast`);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let resolved = 0, alreadyHad = 0, unresolved = 0, modeled = 0, edges = 0, errors = 0;

  // ── Step 1: Load games for the date ────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Loading games for ${gameDate}`);
  const gameRows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
    })
    .from(games)
    .where(and(eq(games.gameDate, gameDate), eq(games.sport, "MLB")));

  const gameIds = gameRows.map((g: { id: number }) => g.id);
  console.log(`${TAG} [STATE] Found ${gameRows.length} MLB games, ids=[${gameIds.join(",")}]`);

  if (gameIds.length === 0) {
    console.log(`${TAG} [OUTPUT] No games found for ${gameDate}`);
    return { date: gameDate, resolved, alreadyHad, unresolved, modeled, edges, errors };
  }

  // ── Step 2: Load HR prop rows ───────────────────────────────────────────────
  console.log(`${TAG} [STEP 2] Loading HR props`);
  const hrRows = await db
    .select()
    .from(mlbHrProps)
    .where(gameIds.length === 1 ? eq(mlbHrProps.gameId, gameIds[0]) : inArray(mlbHrProps.gameId, gameIds));

  console.log(`${TAG} [STATE] HR prop rows: ${hrRows.length}`);
  if (hrRows.length === 0) {
    console.log(`${TAG} [OUTPUT] No HR props found for ${gameDate}`);
    return { date: gameDate, resolved, alreadyHad, unresolved, modeled, edges, errors };
  }

  type HrRow = typeof hrRows[0] & { id: number; playerName: string; mlbamId: number | null; gameId: number; side: string; teamAbbrev: string; anNoVigOverPct: number | null };

  // ── Step 3: Resolve mlbamId for unresolved rows ────────────────────────────
  console.log(`${TAG} [STEP 3] Resolving mlbamId`);
  const needsResolution = (hrRows as HrRow[]).filter(r => r.mlbamId == null);
  const alreadyResolved = (hrRows as HrRow[]).filter(r => r.mlbamId != null);
  alreadyHad = alreadyResolved.length;
  console.log(`${TAG} [STATE] Already resolved: ${alreadyHad}, needs resolution: ${needsResolution.length}`);

  if (needsResolution.length > 0) {
    const apiMap = await fetchMlbamIdMap();
    for (const row of needsResolution) {
      const key = normalizeName(row.playerName);
      const mlbamId = apiMap.get(key) ?? null;
      if (mlbamId != null) {
        try {
          await db.update(mlbHrProps).set({ mlbamId }).where(eq(mlbHrProps.id, row.id));
          row.mlbamId = mlbamId;
          resolved++;
        } catch (err) {
          console.error(`${TAG} [ERROR] mlbamId update failed for ${row.playerName}: ${err instanceof Error ? err.message : String(err)}`);
          errors++;
        }
      } else {
        console.warn(`${TAG} [WARN] Could not resolve mlbamId for "${row.playerName}"`);
        unresolved++;
      }
    }
  }
  console.log(`${TAG} [STATE] Resolution: resolved=${resolved} alreadyHad=${alreadyHad} unresolved=${unresolved}`);

  // ── Step 4: Load context data ───────────────────────────────────────────────
  console.log(`${TAG} [STEP 4] Loading batting splits, pitcher stats, park factors, lineups, Statcast`);

  // 4a: Team batting splits
  const battingSplits = await db.select().from(mlbTeamBattingSplits);
  type SplitRow = { teamAbbrev: string; hand: string; hr9: number | null; woba: number | null };
  const splitMap = new Map<string, TeamBattingContext>();
  const teamAvgMap = new Map<string, TeamBattingContext>();
  for (const s of battingSplits as SplitRow[]) {
    if (s.hr9 != null && s.woba != null) {
      splitMap.set(`${s.teamAbbrev}:${s.hand}`, { hr9: Number(s.hr9), woba: Number(s.woba) });
    }
  }
  const teamKeys = Array.from(new Set((battingSplits as SplitRow[]).map(s => s.teamAbbrev)));
  for (const team of teamKeys) {
    const lSplit = splitMap.get(`${team}:L`);
    const rSplit = splitMap.get(`${team}:R`);
    if (lSplit && rSplit) {
      teamAvgMap.set(team, { hr9: (lSplit.hr9 + rSplit.hr9) / 2, woba: (lSplit.woba + rSplit.woba) / 2 });
    } else if (lSplit) teamAvgMap.set(team, lSplit);
    else if (rSplit) teamAvgMap.set(team, rSplit);
  }
  console.log(`${TAG} [STATE] Batting splits: ${splitMap.size} entries, ${teamAvgMap.size} teams`);

  // 4b: Pitcher stats
  const pitcherStats = await db.select({ fullName: mlbPitcherStats.fullName, hr9: mlbPitcherStats.hr9 }).from(mlbPitcherStats);
  const pitcherMap = new Map<string, PitcherContext>();
  for (const p of pitcherStats as Array<{ fullName: string; hr9: number | null }>) {
    if (p.hr9 != null) pitcherMap.set(p.fullName.toLowerCase(), { hr9: Number(p.hr9) });
  }
  console.log(`${TAG} [STATE] Pitcher stats: ${pitcherMap.size} pitchers`);

  // 4c: Park factors
  const parkFactors = await db.select({ teamAbbrev: mlbParkFactors.teamAbbrev, parkFactor3yr: mlbParkFactors.parkFactor3yr }).from(mlbParkFactors);
  const parkMap = new Map<string, ParkContext>();
  for (const p of parkFactors as Array<{ teamAbbrev: string; parkFactor3yr: number | null }>) {
    if (p.parkFactor3yr != null) parkMap.set(p.teamAbbrev, { hrFactor: Number(p.parkFactor3yr) });
  }
  console.log(`${TAG} [STATE] Park factors: ${parkMap.size} parks`);

  // 4d: Lineups
  const lineupRows = await db.select().from(mlbLineups).where(inArray(mlbLineups.gameId, gameIds));
  type LineupRow = { gameId: number; awayPitcherName: string | null; awayPitcherHand: string | null; homePitcherName: string | null; homePitcherHand: string | null };
  const lineupMap = new Map<number, LineupRow>();
  for (const l of lineupRows as LineupRow[]) lineupMap.set(l.gameId, l);
  console.log(`${TAG} [STATE] Lineups: ${lineupMap.size} games`);

  // 4e: Statcast data from mlb_players (keyed by mlbamId)
  const statcastRows = await db
    .select({
      mlbamId: mlbPlayers.mlbamId,
      iso: mlbPlayers.iso,
      barrelPct: mlbPlayers.barrelPct,
      hardHitPct: mlbPlayers.hardHitPct,
    })
    .from(mlbPlayers)
    .where(isNotNull(mlbPlayers.mlbamId));

  const statcastMap = new Map<number, StatcastContext>();
  for (const s of statcastRows) {
    if (s.mlbamId != null) {
      statcastMap.set(s.mlbamId, {
        iso: s.iso != null ? Number(s.iso) : null,
        barrelPct: s.barrelPct != null ? Number(s.barrelPct) : null,
        hardHitPct: s.hardHitPct != null ? Number(s.hardHitPct) : null,
      });
    }
  }
  const statcastCoverage = Array.from(statcastMap.values()).filter(s => s.iso != null || s.barrelPct != null).length;
  console.log(`${TAG} [STATE] Statcast data: ${statcastMap.size} players loaded, ${statcastCoverage} with iso/barrel data`);

  // Build game context map
  type GameCtx = { awayTeam: string; homeTeam: string; awayPitcherName: string | null; homePitcherName: string | null; awayPitcherHand: string | null; homePitcherHand: string | null };
  const gameCtxMap = new Map<number, GameCtx>();
  for (const g of gameRows as Array<{ id: number; awayTeam: string; homeTeam: string; awayStartingPitcher: string | null; homeStartingPitcher: string | null }>) {
    const lineup = lineupMap.get(g.id);
    gameCtxMap.set(g.id, {
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,
      awayPitcherName: lineup?.awayPitcherName ?? g.awayStartingPitcher ?? null,
      homePitcherName: lineup?.homePitcherName ?? g.homeStartingPitcher ?? null,
      awayPitcherHand: lineup?.awayPitcherHand ?? null,
      homePitcherHand: lineup?.homePitcherHand ?? null,
    });
  }

  // ── Step 5: Reload all HR rows (with fresh mlbamId) and compute model values ─
  console.log(`${TAG} [STEP 5] Computing modelPHr (v2-statcast), modelOverOdds, edgeOver, evOver, verdict`);

  const allRows = await db
    .select()
    .from(mlbHrProps)
    .where(gameIds.length === 1 ? eq(mlbHrProps.gameId, gameIds[0]) : inArray(mlbHrProps.gameId, gameIds));

  let statcastHits = 0, statcastMisses = 0;

  for (const row of allRows as HrRow[]) {
    try {
      const ctx = gameCtxMap.get(row.gameId);
      if (!ctx) {
        console.warn(`${TAG} [WARN] No game context for gameId=${row.gameId}`);
        continue;
      }

      const isAway = row.side === "away";
      const battingTeam = isAway ? ctx.awayTeam : ctx.homeTeam;
      const opposingPitcherName = isAway ? ctx.homePitcherName : ctx.awayPitcherName;
      const opposingPitcherHand = isAway ? ctx.homePitcherHand : ctx.awayPitcherHand;
      const homeTeam = ctx.homeTeam;

      // Batting context
      let batting: TeamBattingContext | undefined;
      if (opposingPitcherHand) batting = splitMap.get(`${battingTeam}:${opposingPitcherHand}`);
      if (!batting) batting = teamAvgMap.get(battingTeam);
      if (!batting) batting = { hr9: 1.0, woba: LEAGUE_WOBA };

      // Pitcher context
      let pitcher: PitcherContext = { hr9: LEAGUE_HR9 };
      if (opposingPitcherName) {
        pitcher = pitcherMap.get(opposingPitcherName.toLowerCase()) ?? { hr9: LEAGUE_HR9 };
      }

      // Park context
      const park: ParkContext = parkMap.get(homeTeam) ?? { hrFactor: 1.0 };

      // Statcast context (by mlbamId)
      let statcast: StatcastContext | null = null;
      if (row.mlbamId != null) {
        const sc = statcastMap.get(row.mlbamId);
        if (sc && (sc.iso != null || sc.barrelPct != null)) {
          statcast = sc;
          statcastHits++;
        } else {
          statcastMisses++;
        }
      } else {
        statcastMisses++;
      }

      // Compute P(HR) with Statcast enhancement
      const modelPHr = computePlayerPHr(batting, pitcher, park, statcast);
      const modelOverOdds = probToAmericanOdds(modelPHr);

      // Edge and EV
      const anNoVig = row.anNoVigOverPct != null ? Number(row.anNoVigOverPct) : null;
      let edgeOver: number | null = null;
      let evOver: number | null = null;
      let verdict = "PASS";

      if (anNoVig != null && anNoVig > 0) {
        edgeOver = parseFloat((modelPHr - anNoVig).toFixed(4));
        evOver = parseFloat(((edgeOver / (1 - modelPHr)) * 100).toFixed(2));
        // Dual gate: edge must exceed EDGE_THRESHOLD AND modelPHr must exceed MIN_ABSOLUTE_P_HR.
        // Rationale: edge alone is insufficient when base probability is very low (< 0.25).
        // A 3% edge on a 0.10 probability is noise; a 6% edge on a 0.25+ probability is signal.
        if (edgeOver >= EDGE_THRESHOLD && modelPHr >= MIN_ABSOLUTE_P_HR) {
          verdict = "OVER";
          edges++;
        } else if (edgeOver >= EDGE_THRESHOLD && modelPHr < MIN_ABSOLUTE_P_HR) {
          // Log suppressed bets for monitoring
          console.log(`${TAG} [FILTER] ${(row as HrRow).playerName}: edge=${edgeOver.toFixed(4)} ≥ threshold but modelPHr=${modelPHr.toFixed(4)} < MIN_ABSOLUTE_P_HR=${MIN_ABSOLUTE_P_HR} → PASS (suppressed)`);
        }
      }

      // Write to DB
      await db.update(mlbHrProps)
        .set({ modelPHr: parseFloat(modelPHr.toFixed(4)), modelOverOdds, edgeOver, evOver, verdict })
        .where(eq(mlbHrProps.id, row.id));

      modeled++;

      const statcastTag = statcast ? "[SC✓]" : "[SC-]";
      const edgeStr = edgeOver != null ? (edgeOver >= 0 ? `+${edgeOver.toFixed(4)}` : edgeOver.toFixed(4)) : "N/A";
      const evStr = evOver != null ? (evOver >= 0 ? `+${evOver.toFixed(2)}` : evOver.toFixed(2)) : "N/A";
      const noVigStr = anNoVig != null ? anNoVig.toFixed(4) : "N/A";
      console.log(`${TAG} [STATE] ${statcastTag} ${row.playerName} (${battingTeam}): pHr=${modelPHr.toFixed(4)} odds=${modelOverOdds > 0 ? "+" : ""}${modelOverOdds} anNoVig=${noVigStr} edge=${edgeStr} ev=${evStr} verdict=${verdict}`);

    } catch (err) {
      errors++;
      console.error(`${TAG} [ERROR] Failed to model ${(row as HrRow).playerName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${TAG} [OUTPUT] Modeling complete (v2-statcast):`);
  console.log(`${TAG}   resolved=${resolved} alreadyHad=${alreadyHad} unresolved=${unresolved}`);
  console.log(`${TAG}   modeled=${modeled} edges=${edges} errors=${errors}`);
  console.log(`${TAG}   statcastHits=${statcastHits} statcastMisses=${statcastMisses}`);
  console.log(`${TAG} [VERIFY] ${errors === 0 ? "PASS" : "FAIL"} — ${errors} total errors`);

  return { date: gameDate, resolved, alreadyHad, unresolved, modeled, edges, errors };
}

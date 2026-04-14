/**
 * MlbCheatSheetCard — CHEAT SHEETS tab
 *
 * Layout per game:
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  MATCHUP HEADER: away logo + name @ home logo + name + time │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  F5 · ACTION NETWORK                                        │
 *  │    [I1][I2][I3][I4][I5]  ← square score boxes per inning   │
 *  │    ML:  AN away | model % + model odds | AN home            │
 *  │    RL:  AN away ±0.5 | model % + model odds | AN home       │
 *  │    TOT: AN O line | model scores + model odds | AN U line   │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  NRFI / YRFI · ACTION NETWORK                               │
 *  │    [I1 box: away EXP + P(≥1)] [P(NRFI)] [I1 box: home]     │
 *  │    NRFI: AN odds | model NRFI% + model odds | edge/EV       │
 *  │    YRFI: AN odds | model YRFI% + model odds | edge/EV       │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * Data sources:
 *   F5 book odds / NRFI book odds → Action Network (FanDuel NJ)
 *   Model projections             → MLBAIModel.py 400K Monte Carlo + 3yr Bayesian priors
 *   Inning distributions          → MLBAIModel.py inning_home_exp / inning_away_exp (I1–I9)
 *
 * CRITICAL BUG FIX (2026-04-14):
 *   modelPNrfi is stored as raw decimal (0.48 = 48%) in DB.
 *   Must multiply by 100 before display: modelPNrfi * 100 → 48.0%
 *   Previous code passed 0.48 directly → displayed as "0.5%" (WRONG)
 */

import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CheatSheetGame {
  id: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
  sport: string;
  // F5 book odds (Action Network / FanDuel NJ)
  f5AwayML: string | null;
  f5HomeML: string | null;
  f5AwayRunLine: string | null;
  f5HomeRunLine: string | null;
  f5AwayRunLineOdds: string | null;
  f5HomeRunLineOdds: string | null;
  f5Total: string | null;
  f5OverOdds: string | null;
  f5UnderOdds: string | null;
  // F5 model projections (from MLBAIModel.py)
  modelF5AwayScore: string | null;
  modelF5HomeScore: string | null;
  modelF5Total: string | null;
  modelF5OverRate: string | null;
  modelF5UnderRate: string | null;
  modelF5AwayWinPct: string | null;
  modelF5HomeWinPct: string | null;
  modelF5AwayRLCoverPct: string | null;
  modelF5HomeRLCoverPct: string | null;
  modelF5AwayML: string | null;
  modelF5HomeML: string | null;
  modelF5AwayRlOdds: string | null;
  modelF5HomeRlOdds: string | null;
  modelF5OverOdds: string | null;
  modelF5UnderOdds: string | null;
  // NRFI/YRFI book odds (Action Network / FanDuel NJ)
  nrfiOverOdds: string | null;
  yrfiUnderOdds: string | null;
  // NRFI/YRFI model (from MLBAIModel.py) — stored as raw decimal 0–1
  modelPNrfi: string | null;
  modelNrfiOdds: string | null;
  modelYrfiOdds: string | null;
  // Inning distributions (JSON arrays from MLBAIModel.py, I1..I9)
  modelInningHomeExp: string | null;
  modelInningAwayExp: string | null;
  modelInningPNeitherScores: string | null;
  modelInningPHomeScores: string | null;
  modelInningPAwayScores: string | null;
  // NRFI filter signals
  nrfiCombinedSignal: number | null;
  nrfiFilterPass: number | null;
}

interface MlbCheatSheetCardProps {
  game: CheatSheetGame;
}

// ─── Parse helpers ─────────────────────────────────────────────────────────────

function parseJsonArr(val: string | null | undefined): number[] | null {
  if (!val) return null;
  try {
    const arr = JSON.parse(val);
    if (Array.isArray(arr) && arr.length >= 5) return arr.map(Number);
    return null;
  } catch { return null; }
}

function parseNum(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? null : n;
}

// ─── Display helpers ───────────────────────────────────────────────────────────

function fmtOdds(val: string | number | null | undefined): string {
  if (val == null || val === '') return "—";
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(n)) return String(val);
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

/** val is already on 0–100 scale */
function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return `${val.toFixed(decimals)}%`;
}

function fmtLine(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${n}` : `${n}`;
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return t;
  let h = parseInt(m[1]!, 10);
  const min = m[2]!;
  const suffix = m[3] ?? (h >= 12 ? 'PM' : 'AM');
  if (!m[3]) {
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
  }
  return `${h}:${min} ${suffix.toUpperCase()} ET`;
}

// ─── Edge/EV computation ───────────────────────────────────────────────────────
// modelPct is on 0–100 scale (e.g., 48.0 for 48%)

function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 - 100 / odds;
}

function computeEdgeEV(
  modelPct: number | null,   // 0–100 scale
  bookOddsStr: string | null | undefined
): { edge: number; ev: number; isEdge: boolean } | null {
  if (modelPct == null || !bookOddsStr) return null;
  const bookOdds = parseFloat(bookOddsStr);
  if (isNaN(bookOdds)) return null;
  const impliedProb = bookOdds > 0 ? 100 / (bookOdds + 100) : -bookOdds / (-bookOdds + 100);
  const modelProb = modelPct / 100;  // convert back to 0–1 for math
  const edge = modelProb - impliedProb;
  const decimalOdds = americanToDecimal(bookOdds);
  const ev = modelProb * (decimalOdds - 1) - (1 - modelProb);
  return { edge, ev, isEdge: Math.abs(edge) >= 0.03 };
}

function edgeColor(edge: number): string {
  return edge >= 0.03 ? "#39FF14" : "#FF4444";
}

function fmtEdge(edge: number): string {
  return `${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`;
}

function fmtEV(ev: number): string {
  const dollars = ev * 100;
  return `${dollars >= 0 ? '+' : ''}$${Math.abs(dollars).toFixed(1)}`;
}

// ─── Square Inning Box Grid (F5: I1–I5) ────────────────────────────────────────

interface InningBoxGridProps {
  awayAbbrev: string;
  homeAbbrev: string;
  awayExp: number[];
  homeExp: number[];
  count: 5 | 9;
  awayColor: string;
  homeColor: string;
}

function InningBoxGrid({
  awayAbbrev, homeAbbrev,
  awayExp, homeExp,
  count,
  awayColor, homeColor,
}: InningBoxGridProps) {
  const innings = Array.from({ length: count }, (_, i) => i);

  return (
    <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Team legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 6, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: awayColor }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 700, letterSpacing: "0.07em" }}>
            {awayAbbrev}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: homeColor }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 700, letterSpacing: "0.07em" }}>
            {homeAbbrev}
          </span>
        </div>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginLeft: "auto", letterSpacing: "0.05em" }}>
          EXP RUNS / INNING
        </span>
      </div>

      {/* Square boxes */}
      <div style={{ display: "flex", gap: 4 }}>
        {innings.map((i) => {
          const aVal = awayExp[i] ?? 0;
          const hVal = homeExp[i] ?? 0;
          return (
            <div key={i} style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 5,
              padding: "5px 2px 4px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              minWidth: 0,
            }}>
              {/* Inning label */}
              <span style={{
                fontSize: 8, fontWeight: 800, letterSpacing: "0.08em",
                color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
              }}>
                I{i + 1}
              </span>
              {/* Away expected runs */}
              <span style={{
                fontSize: 12, fontWeight: 800,
                color: awayColor,
                fontFamily: "'Barlow Condensed', sans-serif",
                lineHeight: 1,
              }}>
                {aVal.toFixed(2)}
              </span>
              {/* Divider */}
              <div style={{ width: "60%", height: 1, background: "rgba(255,255,255,0.08)" }} />
              {/* Home expected runs */}
              <span style={{
                fontSize: 12, fontWeight: 800,
                color: homeColor,
                fontFamily: "'Barlow Condensed', sans-serif",
                lineHeight: 1,
              }}>
                {hVal.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Market Row (3-column: AWAY | MODEL | HOME) ────────────────────────────────

interface MarketRowProps {
  label: string;
  awayTop: string;
  awayBot?: string;
  modelTop: string;
  modelBot?: string;
  homeTop: string;
  homeBot?: string;
  awayEdge?: { edge: number; ev: number; isEdge: boolean } | null;
  homeEdge?: { edge: number; ev: number; isEdge: boolean } | null;
}

function MarketRow({
  label, awayTop, awayBot, modelTop, modelBot, homeTop, homeBot,
  awayEdge, homeEdge,
}: MarketRowProps) {
  const awayHasEdge = awayEdge?.isEdge ?? false;
  const homeHasEdge = homeEdge?.isEdge ?? false;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr 96px 1fr",
      alignItems: "center",
      padding: "7px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
        color: "rgba(255,255,255,0.35)", textTransform: "uppercase",
      }}>
        {label}
      </span>

      {/* Away */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: awayHasEdge ? edgeColor(awayEdge!.edge) : "rgba(255,255,255,0.85)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {awayTop}
        </span>
        {awayBot && (
          <span style={{ fontSize: 10, color: awayHasEdge ? edgeColor(awayEdge!.edge) : "rgba(255,255,255,0.4)", display: "block", marginTop: 1 }}>
            {awayBot}
          </span>
        )}
        {awayHasEdge && awayEdge && (
          <span style={{ fontSize: 9, color: edgeColor(awayEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(awayEdge.edge)} · {fmtEV(awayEdge.ev)}
          </span>
        )}
      </div>

      {/* Model center */}
      <div style={{
        textAlign: "center",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 5,
        padding: "5px 4px",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <span style={{
          fontSize: 13, fontWeight: 800,
          color: "#39FF14",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
          lineHeight: 1.1,
        }}>
          {modelTop}
        </span>
        {modelBot && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginTop: 2 }}>
            {modelBot}
          </span>
        )}
      </div>

      {/* Home */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: homeHasEdge ? edgeColor(homeEdge!.edge) : "rgba(255,255,255,0.85)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {homeTop}
        </span>
        {homeBot && (
          <span style={{ fontSize: 10, color: homeHasEdge ? edgeColor(homeEdge!.edge) : "rgba(255,255,255,0.4)", display: "block", marginTop: 1 }}>
            {homeBot}
          </span>
        )}
        {homeHasEdge && homeEdge && (
          <span style={{ fontSize: 9, color: edgeColor(homeEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(homeEdge.edge)} · {fmtEV(homeEdge.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Total Row ─────────────────────────────────────────────────────────────────

interface TotalRowProps {
  bookLine: string | null;
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  modelExpAway: number | null;
  modelExpHome: number | null;
  modelExpTotal: number | null;
  modelOverOdds: string | null;
  modelUnderOdds: string | null;
  modelOverRate: number | null;   // 0–100 scale
  modelUnderRate: number | null;  // 0–100 scale
}

function TotalRow({
  bookLine, bookOverOdds, bookUnderOdds,
  modelExpAway, modelExpHome, modelExpTotal,
  modelOverOdds, modelUnderOdds,
  modelOverRate, modelUnderRate,
}: TotalRowProps) {
  const overEdge = computeEdgeEV(modelOverRate, bookOverOdds);
  const underEdge = computeEdgeEV(modelUnderRate, bookUnderOdds);
  const overHasEdge = overEdge?.isEdge ?? false;
  const underHasEdge = underEdge?.isEdge ?? false;

  const modelScoreStr = (modelExpAway != null && modelExpHome != null)
    ? `${modelExpAway.toFixed(2)} – ${modelExpHome.toFixed(2)}`
    : "—";
  const modelTotStr = modelExpTotal != null ? `TOT ${modelExpTotal.toFixed(1)}` : "—";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr 96px 1fr",
      alignItems: "center",
      padding: "7px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
        color: "rgba(255,255,255,0.35)", textTransform: "uppercase",
      }}>
        TOT
      </span>

      {/* Over (away side) */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 1 }}>
          O {bookLine ?? "—"}
        </span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: overHasEdge ? edgeColor(overEdge!.edge) : "rgba(255,255,255,0.85)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {fmtOdds(bookOverOdds)}
        </span>
        {overHasEdge && overEdge && (
          <span style={{ fontSize: 9, color: edgeColor(overEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(overEdge.edge)} · {fmtEV(overEdge.ev)}
          </span>
        )}
      </div>

      {/* Model center */}
      <div style={{
        textAlign: "center",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 5,
        padding: "5px 4px",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: "#39FF14",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
          lineHeight: 1.2,
        }}>
          {modelScoreStr}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 800,
          color: "#39FF14",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
          lineHeight: 1.2,
        }}>
          {modelTotStr}
        </span>
        {(modelOverOdds || modelUnderOdds) && (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", display: "block", marginTop: 2 }}>
            O {fmtOdds(modelOverOdds)} / U {fmtOdds(modelUnderOdds)}
          </span>
        )}
      </div>

      {/* Under (home side) */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 1 }}>
          U {bookLine ?? "—"}
        </span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: underHasEdge ? edgeColor(underEdge!.edge) : "rgba(255,255,255,0.85)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {fmtOdds(bookUnderOdds)}
        </span>
        {underHasEdge && underEdge && (
          <span style={{ fontSize: 9, color: edgeColor(underEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(underEdge.edge)} · {fmtEV(underEdge.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── I1 Distribution Boxes (NRFI section) ─────────────────────────────────────

interface I1BoxRowProps {
  awayAbbrev: string;
  homeAbbrev: string;
  awayI1Exp: number | null;
  homeI1Exp: number | null;
  awayI1PScores: number | null;   // raw 0–1 probability
  homeI1PScores: number | null;   // raw 0–1 probability
  pNeitherI1: number | null;      // raw 0–1 probability
  awayColor: string;
  homeColor: string;
}

function I1BoxRow({
  awayAbbrev, homeAbbrev,
  awayI1Exp, homeI1Exp,
  awayI1PScores, homeI1PScores,
  pNeitherI1,
  awayColor, homeColor,
}: I1BoxRowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 80px 1fr",
      gap: 6,
      padding: "8px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      alignItems: "stretch",
    }}>
      {/* Away I1 box */}
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 5,
        padding: "6px 6px",
        textAlign: "center",
      }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: awayColor, display: "block", marginBottom: 4 }}>
          {awayAbbrev} · I1
        </span>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <div>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>EXP</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: awayColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {awayI1Exp != null ? awayI1Exp.toFixed(3) : "—"}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>P(≥1)</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: awayColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {awayI1PScores != null ? fmtPct(awayI1PScores * 100) : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Center: P(NRFI) */}
      <div style={{
        background: "rgba(57,255,20,0.07)",
        border: "1px solid rgba(57,255,20,0.2)",
        borderRadius: 5,
        padding: "6px 4px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 2 }}>P(NRFI)</span>
        <span style={{ fontSize: 16, fontWeight: 900, color: "#39FF14", fontFamily: "'Barlow Condensed', sans-serif" }}>
          {pNeitherI1 != null ? fmtPct(pNeitherI1 * 100) : "—"}
        </span>
      </div>

      {/* Home I1 box */}
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 5,
        padding: "6px 6px",
        textAlign: "center",
      }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: homeColor, display: "block", marginBottom: 4 }}>
          {homeAbbrev} · I1
        </span>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <div>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>EXP</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: homeColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {homeI1Exp != null ? homeI1Exp.toFixed(3) : "—"}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>P(≥1)</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: homeColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {homeI1PScores != null ? fmtPct(homeI1PScores * 100) : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NRFI / YRFI Row ───────────────────────────────────────────────────────────

interface NrfiYrfiRowProps {
  label: "NRFI" | "YRFI";
  bookOdds: string | null;
  modelPct: number | null;   // 0–100 scale (e.g., 48.0 for 48%)
  modelOdds: string | null;
}

function NrfiYrfiRow({ label, bookOdds, modelPct, modelOdds }: NrfiYrfiRowProps) {
  // computeEdgeEV expects 0–100 scale — correct
  const edgeEV = computeEdgeEV(modelPct, bookOdds);
  const hasEdge = edgeEV?.isEdge ?? false;
  const isNrfi = label === "NRFI";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr 1fr 1fr",
      alignItems: "center",
      padding: "8px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 900, letterSpacing: "0.06em",
        color: isNrfi ? "#39FF14" : "#FF6B35",
        textTransform: "uppercase",
      }}>
        {label}
      </span>

      {/* AN Odds */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", display: "block", marginBottom: 2 }}>AN ODDS</span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: "rgba(255,255,255,0.85)",
          fontFamily: "'Barlow Condensed', sans-serif",
        }}>
          {fmtOdds(bookOdds)}
        </span>
      </div>

      {/* Model % + Model Odds */}
      <div style={{
        textAlign: "center",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 5,
        padding: "5px 4px",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", display: "block", marginBottom: 1 }}>MODEL %</span>
        <span style={{
          fontSize: 15, fontWeight: 900,
          color: isNrfi ? "#39FF14" : "#FF6B35",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
          lineHeight: 1.1,
        }}>
          {/* modelPct is on 0–100 scale — display directly */}
          {modelPct != null ? fmtPct(modelPct) : "—"}
        </span>
        {modelOdds && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", display: "block", marginTop: 2 }}>
            {fmtOdds(modelOdds)}
          </span>
        )}
      </div>

      {/* Edge / EV */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", display: "block", marginBottom: 2 }}>EDGE · EV</span>
        {edgeEV ? (
          <>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: hasEdge ? edgeColor(edgeEV.edge) : "rgba(255,255,255,0.45)",
              fontFamily: "'Barlow Condensed', sans-serif",
              display: "block",
            }}>
              {fmtEdge(edgeEV.edge)}
            </span>
            <span style={{
              fontSize: 10,
              color: hasEdge ? edgeColor(edgeEV.edge) : "rgba(255,255,255,0.3)",
              display: "block", marginTop: 1,
            }}>
              {fmtEV(edgeEV.ev)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>—</span>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function MlbCheatSheetCard({ game }: MlbCheatSheetCardProps) {
  const awayInfo = MLB_BY_ABBREV.get(game.awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(game.homeTeam);
  const awayName = awayInfo?.city ?? game.awayTeam;
  const homeName = homeInfo?.city ?? game.homeTeam;
  const awayLogo = awayInfo?.logoUrl ?? null;
  const homeLogo = homeInfo?.logoUrl ?? null;
  const awayColor = awayInfo?.primaryColor ?? '#4A90D9';
  const homeColor = homeInfo?.primaryColor ?? '#E8A838';

  // Parse inning distributions
  const awayInnExp = useMemo(() => parseJsonArr(game.modelInningAwayExp), [game.modelInningAwayExp]);
  const homeInnExp = useMemo(() => parseJsonArr(game.modelInningHomeExp), [game.modelInningHomeExp]);
  const pNeitherArr = useMemo(() => parseJsonArr(game.modelInningPNeitherScores), [game.modelInningPNeitherScores]);
  const pHomeScoresArr = useMemo(() => parseJsonArr(game.modelInningPHomeScores), [game.modelInningPHomeScores]);
  const pAwayScoresArr = useMemo(() => parseJsonArr(game.modelInningPAwayScores), [game.modelInningPAwayScores]);

  // Parse model values — F5 win/RL pcts are stored as 0–100 scale already
  const modelF5AwayScore = parseNum(game.modelF5AwayScore);
  const modelF5HomeScore = parseNum(game.modelF5HomeScore);
  const modelF5Total = parseNum(game.modelF5Total);
  const modelF5OverRate = parseNum(game.modelF5OverRate);     // 0–100 scale
  const modelF5UnderRate = parseNum(game.modelF5UnderRate);   // 0–100 scale
  const modelF5AwayWinPct = parseNum(game.modelF5AwayWinPct); // 0–100 scale
  const modelF5HomeWinPct = parseNum(game.modelF5HomeWinPct); // 0–100 scale
  const modelF5AwayRLCoverPct = parseNum(game.modelF5AwayRLCoverPct); // 0–100 scale
  const modelF5HomeRLCoverPct = parseNum(game.modelF5HomeRLCoverPct); // 0–100 scale

  // CRITICAL: modelPNrfi is stored as raw decimal (0.48 = 48%) — multiply by 100
  const modelPNrfiRaw = parseNum(game.modelPNrfi);
  const modelPNrfi = modelPNrfiRaw != null ? modelPNrfiRaw * 100 : null;  // now 0–100 scale
  const modelPYrfi = modelPNrfi != null ? 100 - modelPNrfi : null;

  // I1 values from inning arrays
  const awayI1Exp = awayInnExp ? awayInnExp[0] ?? null : null;
  const homeI1Exp = homeInnExp ? homeInnExp[0] ?? null : null;
  const pNeitherI1 = pNeitherArr ? pNeitherArr[0] ?? null : null;
  const awayI1PScores = pAwayScoresArr ? pAwayScoresArr[0] ?? null : null;
  const homeI1PScores = pHomeScoresArr ? pHomeScoresArr[0] ?? null : null;

  // Edge/EV for F5 ML and RL
  const awayF5MlEdge = computeEdgeEV(modelF5AwayWinPct, game.f5AwayML);
  const homeF5MlEdge = computeEdgeEV(modelF5HomeWinPct, game.f5HomeML);
  const awayF5RlEdge = computeEdgeEV(modelF5AwayRLCoverPct, game.f5AwayRunLineOdds);
  const homeF5RlEdge = computeEdgeEV(modelF5HomeRLCoverPct, game.f5HomeRunLineOdds);

  // Data availability gates
  const hasF5Data = !!(game.f5AwayML || game.f5Total || game.f5OverOdds);
  const hasNrfiData = !!(game.nrfiOverOdds || game.yrfiUnderOdds || game.modelPNrfi);
  const hasInnDist = !!(awayInnExp && homeInnExp && awayInnExp.length >= 5 && homeInnExp.length >= 5);

  // NRFI filter signal badge
  const nrfiPass = game.nrfiFilterPass === 1;
  const nrfiSignal = game.nrfiCombinedSignal;

  // Gradient bar
  const gradientStyle = {
    background: `linear-gradient(90deg, ${awayColor}66 0%, transparent 45%, transparent 55%, ${homeColor}66 100%)`,
    height: 3,
    width: "100%",
  };

  return (
    <div style={{
      background: "#0f0f0f",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 10,
      marginBottom: 10,
      overflow: "hidden",
      fontFamily: "'Barlow', 'Barlow Condensed', sans-serif",
    }}>
      {/* Gradient bar */}
      <div style={gradientStyle} />

      {/* ── HEADER ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 10px 7px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {awayLogo && <img src={awayLogo} alt={game.awayTeam} style={{ width: 24, height: 24, objectFit: "contain" }} />}
          <span style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.92)", letterSpacing: "0.03em" }}>
            {awayName}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: "0 2px" }}>@</span>
          {homeLogo && <img src={homeLogo} alt={game.homeTeam} style={{ width: 24, height: 24, objectFit: "contain" }} />}
          <span style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.92)", letterSpacing: "0.03em" }}>
            {homeName}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {nrfiPass && (
            <span style={{
              fontSize: 8, fontWeight: 900, letterSpacing: "0.08em",
              background: "rgba(57,255,20,0.12)", color: "#39FF14",
              border: "1px solid rgba(57,255,20,0.3)",
              borderRadius: 3, padding: "2px 5px",
            }}>
              NRFI {nrfiSignal != null ? `${(nrfiSignal * 100).toFixed(1)}%` : "✓"}
            </span>
          )}
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
            {formatTime(game.startTimeEst)}
          </span>
        </div>
      </div>

      {/* ── F5 SECTION HEADER ── */}
      <div style={{
        padding: "5px 10px 4px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(57,255,20,0.03)",
      }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", color: "#39FF14", textTransform: "uppercase" }}>
          F5 · ACTION NETWORK
        </span>
      </div>

      {/* F5 Inning Distribution: square boxes I1–I5 */}
      {hasInnDist ? (
        <InningBoxGrid
          awayAbbrev={game.awayTeam}
          homeAbbrev={game.homeTeam}
          awayExp={awayInnExp!.slice(0, 5)}
          homeExp={homeInnExp!.slice(0, 5)}
          count={5}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      ) : (
        <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", fontStyle: "italic" }}>
            Inning distribution pending model run
          </span>
        </div>
      )}

      {/* F5 ML / RL / Total */}
      {hasF5Data ? (
        <>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 96px 1fr",
            padding: "3px 10px 2px",
            gap: 4,
          }}>
            <span />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {game.awayTeam}
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              MODEL
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {game.homeTeam}
            </span>
          </div>

          <MarketRow
            label="ML"
            awayTop={fmtOdds(game.f5AwayML)}
            modelTop={modelF5AwayWinPct != null ? fmtPct(modelF5AwayWinPct) : "—"}
            modelBot={game.modelF5AwayML ? fmtOdds(game.modelF5AwayML) : undefined}
            homeTop={fmtOdds(game.f5HomeML)}
            awayEdge={awayF5MlEdge}
            homeEdge={homeF5MlEdge}
          />

          <MarketRow
            label="RL"
            awayTop={fmtLine(game.f5AwayRunLine)}
            awayBot={fmtOdds(game.f5AwayRunLineOdds)}
            modelTop={modelF5AwayRLCoverPct != null ? fmtPct(modelF5AwayRLCoverPct) : "—"}
            modelBot={game.modelF5AwayRlOdds ? fmtOdds(game.modelF5AwayRlOdds) : undefined}
            homeTop={fmtLine(game.f5HomeRunLine)}
            homeBot={fmtOdds(game.f5HomeRunLineOdds)}
            awayEdge={awayF5RlEdge}
            homeEdge={homeF5RlEdge}
          />

          <TotalRow
            bookLine={game.f5Total}
            bookOverOdds={game.f5OverOdds}
            bookUnderOdds={game.f5UnderOdds}
            modelExpAway={modelF5AwayScore}
            modelExpHome={modelF5HomeScore}
            modelExpTotal={modelF5Total}
            modelOverOdds={game.modelF5OverOdds}
            modelUnderOdds={game.modelF5UnderOdds}
            modelOverRate={modelF5OverRate}
            modelUnderRate={modelF5UnderRate}
          />
        </>
      ) : (
        <div style={{ padding: "10px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)" }}>F5 odds not yet posted</span>
        </div>
      )}

      {/* ── NRFI / YRFI SECTION HEADER ── */}
      <div style={{
        padding: "5px 10px 4px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,107,53,0.03)",
      }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", color: "#FF6B35", textTransform: "uppercase" }}>
          NRFI / YRFI · ACTION NETWORK
        </span>
      </div>

      {/* I1 Distribution boxes */}
      {(awayI1Exp != null || homeI1Exp != null) && (
        <I1BoxRow
          awayAbbrev={game.awayTeam}
          homeAbbrev={game.homeTeam}
          awayI1Exp={awayI1Exp}
          homeI1Exp={homeI1Exp}
          awayI1PScores={awayI1PScores}
          homeI1PScores={homeI1PScores}
          pNeitherI1={pNeitherI1}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      )}

      {/* NRFI/YRFI rows */}
      {hasNrfiData ? (
        <>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 1fr 1fr",
            padding: "3px 10px 2px",
            gap: 4,
          }}>
            <span />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              AN ODDS
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              MODEL
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              EDGE · EV
            </span>
          </div>

          <NrfiYrfiRow
            label="NRFI"
            bookOdds={game.nrfiOverOdds}
            modelPct={modelPNrfi}
            modelOdds={game.modelNrfiOdds}
          />
          <NrfiYrfiRow
            label="YRFI"
            bookOdds={game.yrfiUnderOdds}
            modelPct={modelPYrfi}
            modelOdds={game.modelYrfiOdds}
          />
        </>
      ) : (
        <div style={{ padding: "10px", textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)" }}>NRFI/YRFI odds not yet posted</span>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.16)", letterSpacing: "0.04em" }}>
          F5 + NRFI/YRFI: Action Network · Model: 400K Monte Carlo + 3yr Bayesian priors · Edge ≥±3%
        </span>
      </div>
    </div>
  );
}

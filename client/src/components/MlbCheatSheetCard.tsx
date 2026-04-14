/**
 * MlbCheatSheetCard — CHEAT SHEETS tab
 *
 * Displays two sections per game:
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  MATCHUP HEADER: away @ home + start time                   │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  F5 SECTION                                                 │
 *  │    Inning distribution: I1–I5 per team (bar chart)          │
 *  │    ML:  AN book away | model pct+odds | AN book home        │
 *  │    RL:  AN book away±0.5 odds | model pct+odds | home       │
 *  │    TOT: AN book over | model exp+odds | AN book under       │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  NRFI / YRFI SECTION                                        │
 *  │    I1 distribution: away | model | home                     │
 *  │    NRFI: AN odds | model NRFI% + model odds | edge/EV       │
 *  │    YRFI: AN odds | model YRFI% + model odds | edge/EV       │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * Data sources:
 *   F5 ML / RL / Total book odds → Action Network (FanDuel NJ, book_id=69)
 *   NRFI / YRFI book odds        → Action Network (FanDuel NJ, book_id=69)
 *   Model projections            → MLBAIModel.py (400K Monte Carlo + 3yr Bayesian priors)
 *   Inning distributions         → MLBAIModel.py inning_home_exp / inning_away_exp (I1-I9)
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
  // NRFI/YRFI model (from MLBAIModel.py)
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

function fmtOdds(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return `${val.toFixed(decimals)}%`;
}

function fmtScore(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(2);
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

function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 - 100 / odds;
}

function computeEdgeEV(
  modelPct: number | null,
  bookOddsStr: string | null | undefined
): { edge: number; ev: number; isEdge: boolean } | null {
  if (modelPct == null || !bookOddsStr) return null;
  const bookOdds = parseFloat(bookOddsStr);
  if (isNaN(bookOdds)) return null;
  const impliedProb = bookOdds > 0 ? 100 / (bookOdds + 100) : -bookOdds / (-bookOdds + 100);
  const modelProb = modelPct / 100;
  const edge = modelProb - impliedProb;
  const decimalOdds = americanToDecimal(bookOdds);
  const ev = modelProb * (decimalOdds - 1) - (1 - modelProb);
  return { edge, ev, isEdge: Math.abs(edge) >= 0.03 };
}

function edgeColor(edge: number, isEdge: boolean): string {
  if (!isEdge) return "rgba(255,255,255,0.85)";
  return edge >= 0.03 ? "#39FF14" : "#FF4444";
}

function fmtEdge(edge: number): string {
  return `${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`;
}

function fmtEV(ev: number): string {
  const dollars = ev * 100;
  return `${dollars >= 0 ? '+' : ''}$${Math.abs(dollars).toFixed(1)}`;
}

// ─── Inning Bar Chart ──────────────────────────────────────────────────────────

interface InningBarChartProps {
  awayAbbrev: string;
  homeAbbrev: string;
  awayExp: number[];   // I1..I5 (or I1..I9)
  homeExp: number[];
  maxInnings: 5 | 9;
  awayColor: string;
  homeColor: string;
}

function InningBarChart({
  awayAbbrev, homeAbbrev,
  awayExp, homeExp,
  maxInnings,
  awayColor, homeColor,
}: InningBarChartProps) {
  const innings = Array.from({ length: maxInnings }, (_, i) => i);
  const allVals = [...awayExp.slice(0, maxInnings), ...homeExp.slice(0, maxInnings)];
  const maxVal = Math.max(...allVals, 0.01);

  return (
    <div style={{ padding: "8px 10px 6px" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 6, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: awayColor }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 700, letterSpacing: "0.06em" }}>
            {awayAbbrev}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: homeColor }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 700, letterSpacing: "0.06em" }}>
            {homeAbbrev}
          </span>
        </div>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginLeft: "auto" }}>
          EXP RUNS / INNING
        </span>
      </div>
      {/* Bars */}
      <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 44 }}>
        {innings.map((i) => {
          const aVal = awayExp[i] ?? 0;
          const hVal = homeExp[i] ?? 0;
          const aH = Math.round((aVal / maxVal) * 40);
          const hH = Math.round((hVal / maxVal) * 40);
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              {/* Away bar */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: 40 }}>
                <span style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", marginBottom: 1 }}>
                  {aVal.toFixed(2)}
                </span>
                <div style={{
                  width: "42%", height: aH, background: awayColor,
                  borderRadius: "2px 2px 0 0", minHeight: 2,
                }} />
              </div>
              {/* Home bar (same column, right side) */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: 40, marginTop: -40, paddingLeft: "52%" }}>
                <span style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", marginBottom: 1 }}>
                  {hVal.toFixed(2)}
                </span>
                <div style={{
                  width: "42%", height: hH, background: homeColor,
                  borderRadius: "2px 2px 0 0", minHeight: 2,
                }} />
              </div>
              {/* Inning label */}
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 2, fontWeight: 700 }}>
                I{i + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Market Row (3-column: away | model | home) ────────────────────────────────

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
  modelIsEdge?: boolean;
}

function MarketRow({
  label, awayTop, awayBot, modelTop, modelBot, homeTop, homeBot,
  awayEdge, homeEdge, modelIsEdge,
}: MarketRowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "40px 1fr 88px 1fr",
      alignItems: "center",
      padding: "5px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
      }}>
        {label}
      </span>
      {/* Away */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: awayEdge?.isEdge ? edgeColor(awayEdge.edge, true) : "rgba(255,255,255,0.9)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {awayTop}
        </span>
        {awayBot && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", display: "block", marginTop: 1 }}>
            {awayBot}
          </span>
        )}
        {awayEdge?.isEdge && (
          <span style={{ fontSize: 9, color: edgeColor(awayEdge.edge, true), display: "block", marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(awayEdge.edge)} · {fmtEV(awayEdge.ev)}
          </span>
        )}
      </div>
      {/* Model center */}
      <div style={{
        textAlign: "center",
        background: modelIsEdge ? "rgba(57,255,20,0.08)" : "rgba(255,255,255,0.04)",
        borderRadius: 4, padding: "3px 4px",
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: modelIsEdge ? "#39FF14" : "#39FF14",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {modelTop}
        </span>
        {modelBot && (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", display: "block", marginTop: 1 }}>
            {modelBot}
          </span>
        )}
      </div>
      {/* Home */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: homeEdge?.isEdge ? edgeColor(homeEdge.edge, true) : "rgba(255,255,255,0.9)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {homeTop}
        </span>
        {homeBot && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", display: "block", marginTop: 1 }}>
            {homeBot}
          </span>
        )}
        {homeEdge?.isEdge && (
          <span style={{ fontSize: 9, color: edgeColor(homeEdge.edge, true), display: "block", marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(homeEdge.edge)} · {fmtEV(homeEdge.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Total Row (special layout: O {line} U with model exp total) ───────────────

interface TotalRowProps {
  label: string;
  bookLine: string | null;
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  modelExpAway: number | null;
  modelExpHome: number | null;
  modelExpTotal: number | null;
  modelOverOdds: string | null;
  modelUnderOdds: string | null;
  modelOverRate: number | null;
  modelUnderRate: number | null;
}

function TotalRow({
  label, bookLine, bookOverOdds, bookUnderOdds,
  modelExpAway, modelExpHome, modelExpTotal,
  modelOverOdds, modelUnderOdds,
  modelOverRate, modelUnderRate,
}: TotalRowProps) {
  const overEdge = computeEdgeEV(modelOverRate != null ? modelOverRate * 100 : null, bookOverOdds);
  const underEdge = computeEdgeEV(modelUnderRate != null ? modelUnderRate * 100 : null, bookUnderOdds);
  const line = bookLine ? parseFloat(bookLine) : null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "40px 1fr 88px 1fr",
      alignItems: "center",
      padding: "5px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
      }}>
        {label}
      </span>
      {/* Over (away side) */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 1 }}>
          O {line != null ? line : "—"}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: overEdge?.isEdge ? edgeColor(overEdge.edge, true) : "rgba(255,255,255,0.9)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {fmtOdds(bookOverOdds)}
        </span>
        {overEdge?.isEdge && (
          <span style={{ fontSize: 9, color: edgeColor(overEdge.edge, true), display: "block", marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(overEdge.edge)} · {fmtEV(overEdge.ev)}
          </span>
        )}
      </div>
      {/* Model center */}
      <div style={{
        textAlign: "center",
        background: "rgba(255,255,255,0.04)",
        borderRadius: 4, padding: "3px 4px",
      }}>
        {modelExpAway != null && modelExpHome != null ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#39FF14", fontFamily: "'Barlow Condensed', sans-serif", display: "block" }}>
            {fmtScore(modelExpAway)} – {fmtScore(modelExpHome)}
          </span>
        ) : null}
        <span style={{ fontSize: 11, fontWeight: 700, color: "#39FF14", fontFamily: "'Barlow Condensed', sans-serif", display: "block" }}>
          {modelExpTotal != null ? `TOT ${modelExpTotal.toFixed(1)}` : "—"}
        </span>
        {modelOverOdds && (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", display: "block", marginTop: 1 }}>
            O {fmtOdds(modelOverOdds)} / U {fmtOdds(modelUnderOdds)}
          </span>
        )}
      </div>
      {/* Under (home side) */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 1 }}>
          U {line != null ? line : "—"}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: underEdge?.isEdge ? edgeColor(underEdge.edge, true) : "rgba(255,255,255,0.9)",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {fmtOdds(bookUnderOdds)}
        </span>
        {underEdge?.isEdge && (
          <span style={{ fontSize: 9, color: edgeColor(underEdge.edge, true), display: "block", marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(underEdge.edge)} · {fmtEV(underEdge.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── NRFI/YRFI Row ─────────────────────────────────────────────────────────────

interface NrfiYrfiRowProps {
  label: "NRFI" | "YRFI";
  bookOdds: string | null | undefined;
  modelPct: number | null;
  modelOdds: string | null | undefined;
}

function NrfiYrfiRow({ label, bookOdds, modelPct, modelOdds }: NrfiYrfiRowProps) {
  const isNrfi = label === "NRFI";
  const edgeEV = computeEdgeEV(modelPct, bookOdds);
  const hasEdge = edgeEV?.isEdge ?? false;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "60px 1fr 1fr 1fr",
      alignItems: "center",
      padding: "6px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
        color: isNrfi ? "#39FF14" : "#FF6B35",
        textTransform: "uppercase",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}>
        {label}
      </span>
      {/* Book odds */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 1 }}>AN ODDS</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)", fontFamily: "'Barlow Condensed', sans-serif" }}>
          {fmtOdds(bookOdds)}
        </span>
      </div>
      {/* Model probability + model odds */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 1 }}>MODEL %</span>
        <span style={{
          fontSize: 14, fontWeight: 800,
          color: "#39FF14",
          fontFamily: "'Barlow Condensed', sans-serif",
          display: "block",
        }}>
          {modelPct != null ? fmtPct(modelPct) : "—"}
        </span>
        {modelOdds && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginTop: 1 }}>
            {fmtOdds(modelOdds)}
          </span>
        )}
      </div>
      {/* Edge / EV */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 1 }}>EDGE · EV</span>
        {edgeEV ? (
          <>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: hasEdge ? edgeColor(edgeEV.edge, true) : "rgba(255,255,255,0.45)",
              fontFamily: "'Barlow Condensed', sans-serif",
              display: "block",
            }}>
              {fmtEdge(edgeEV.edge)}
            </span>
            <span style={{
              fontSize: 10,
              color: hasEdge ? edgeColor(edgeEV.edge, true) : "rgba(255,255,255,0.35)",
              display: "block", marginTop: 1,
            }}>
              {fmtEV(edgeEV.ev)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>—</span>
        )}
      </div>
    </div>
  );
}

// ─── I1 Distribution Row (for NRFI section) ────────────────────────────────────

interface I1DistRowProps {
  awayAbbrev: string;
  homeAbbrev: string;
  awayI1Exp: number | null;
  homeI1Exp: number | null;
  awayI1PScores: number | null;
  homeI1PScores: number | null;
  pNeitherI1: number | null;
  awayColor: string;
  homeColor: string;
}

function I1DistRow({
  awayAbbrev, homeAbbrev,
  awayI1Exp, homeI1Exp,
  awayI1PScores, homeI1PScores,
  pNeitherI1,
  awayColor, homeColor,
}: I1DistRowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 80px 1fr",
      alignItems: "center",
      padding: "6px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      gap: 4,
    }}>
      {/* Away I1 */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 2, letterSpacing: "0.06em" }}>
          {awayAbbrev} · I1
        </span>
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>EXP</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: awayColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {awayI1Exp != null ? awayI1Exp.toFixed(3) : "—"}
            </span>
          </div>
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>P(≥1)</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: awayColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {awayI1PScores != null ? fmtPct(awayI1PScores * 100) : "—"}
            </span>
          </div>
        </div>
      </div>
      {/* Center: P(NRFI from sim) */}
      <div style={{
        textAlign: "center",
        background: "rgba(255,255,255,0.04)",
        borderRadius: 4, padding: "4px 2px",
      }}>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 1 }}>P(NRFI)</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#39FF14", fontFamily: "'Barlow Condensed', sans-serif" }}>
          {pNeitherI1 != null ? fmtPct(pNeitherI1 * 100) : "—"}
        </span>
      </div>
      {/* Home I1 */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 2, letterSpacing: "0.06em" }}>
          {homeAbbrev} · I1
        </span>
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>EXP</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: homeColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {homeI1Exp != null ? homeI1Exp.toFixed(3) : "—"}
            </span>
          </div>
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", display: "block" }}>P(≥1)</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: homeColor, fontFamily: "'Barlow Condensed', sans-serif" }}>
              {homeI1PScores != null ? fmtPct(homeI1PScores * 100) : "—"}
            </span>
          </div>
        </div>
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

  // Parse model values
  const modelF5AwayScore = parseNum(game.modelF5AwayScore);
  const modelF5HomeScore = parseNum(game.modelF5HomeScore);
  const modelF5Total = parseNum(game.modelF5Total);
  const modelF5OverRate = parseNum(game.modelF5OverRate);
  const modelF5UnderRate = parseNum(game.modelF5UnderRate);
  const modelF5AwayWinPct = parseNum(game.modelF5AwayWinPct);
  const modelF5HomeWinPct = parseNum(game.modelF5HomeWinPct);
  const modelF5AwayRLCoverPct = parseNum(game.modelF5AwayRLCoverPct);
  const modelF5HomeRLCoverPct = parseNum(game.modelF5HomeRLCoverPct);
  const modelPNrfi = parseNum(game.modelPNrfi);
  const modelPYrfi = modelPNrfi != null ? 100 - modelPNrfi : null;

  // I1 values from inning arrays
  const awayI1Exp = awayInnExp ? awayInnExp[0] ?? null : null;
  const homeI1Exp = homeInnExp ? homeInnExp[0] ?? null : null;
  const pNeitherI1 = pNeitherArr ? pNeitherArr[0] ?? null : null;
  const awayI1PScores = pAwayScoresArr ? pAwayScoresArr[0] ?? null : null;
  const homeI1PScores = pHomeScoresArr ? pHomeScoresArr[0] ?? null : null;

  // Edge/EV computations for F5
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
    background: `linear-gradient(90deg, ${awayColor}55 0%, transparent 40%, transparent 60%, ${homeColor}55 100%)`,
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

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 10px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {awayLogo && <img src={awayLogo} alt={game.awayTeam} style={{ width: 22, height: 22, objectFit: "contain" }} />}
          <span style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.9)", letterSpacing: "0.04em" }}>
            {awayName}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 2px" }}>@</span>
          {homeLogo && <img src={homeLogo} alt={game.homeTeam} style={{ width: 22, height: 22, objectFit: "contain" }} />}
          <span style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.9)", letterSpacing: "0.04em" }}>
            {homeName}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {nrfiPass && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: "0.08em",
              background: "rgba(57,255,20,0.15)", color: "#39FF14",
              border: "1px solid rgba(57,255,20,0.35)",
              borderRadius: 3, padding: "1px 5px",
            }}>
              NRFI {nrfiSignal != null ? `${(nrfiSignal * 100).toFixed(1)}%` : "✓"}
            </span>
          )}
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
            {formatTime(game.startTimeEst)}
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "40px 1fr 88px 1fr",
        padding: "3px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        gap: 4,
      }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }} />
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", textAlign: "center" }}>
          {game.awayTeam}
        </span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", textAlign: "center" }}>
          MODEL
        </span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", textAlign: "center" }}>
          {game.homeTeam}
        </span>
      </div>

      {/* ── F5 SECTION ── */}
      <div style={{ padding: "4px 10px 2px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#39FF14", textTransform: "uppercase" }}>
          F5 · ACTION NETWORK
        </span>
      </div>

      {/* F5 Inning Distribution (I1–I5) */}
      {hasInnDist ? (
        <InningBarChart
          awayAbbrev={game.awayTeam}
          homeAbbrev={game.homeTeam}
          awayExp={awayInnExp!.slice(0, 5)}
          homeExp={homeInnExp!.slice(0, 5)}
          maxInnings={5}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      ) : (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>
            Inning distribution pending model run
          </span>
        </div>
      )}

      {/* F5 ML */}
      {hasF5Data ? (
        <>
          <MarketRow
            label="ML"
            awayTop={fmtOdds(game.f5AwayML)}
            modelTop={modelF5AwayWinPct != null ? fmtPct(modelF5AwayWinPct) : "—"}
            modelBot={game.modelF5AwayML ? fmtOdds(game.modelF5AwayML) : undefined}
            homeTop={fmtOdds(game.f5HomeML)}
            awayEdge={awayF5MlEdge}
            homeEdge={homeF5MlEdge}
          />
          {/* F5 RL */}
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
          {/* F5 Total */}
          <TotalRow
            label="TOT"
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
        <div style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>F5 odds not yet available</span>
        </div>
      )}

      {/* ── NRFI / YRFI SECTION ── */}
      <div style={{ padding: "4px 10px 2px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#FF6B35", textTransform: "uppercase" }}>
          NRFI / YRFI · ACTION NETWORK
        </span>
      </div>

      {/* I1 Distribution */}
      {(awayI1Exp != null || homeI1Exp != null) && (
        <I1DistRow
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

      {/* NRFI row */}
      {hasNrfiData ? (
        <>
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
        <div style={{ padding: "10px 10px", textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>NRFI/YRFI odds not yet available</span>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", letterSpacing: "0.04em" }}>
          F5 + NRFI/YRFI: Action Network · Model: 400K Monte Carlo + 3yr Bayesian priors · Edge ≥±3%
        </span>
      </div>
    </div>
  );
}

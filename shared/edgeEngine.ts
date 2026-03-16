/**
 * edgeEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GLOBAL EDGE / ROI ENGINE FOR SPORTS BETTING MODEL
 * Markets: MONEYLINE • SPREAD / PUCK LINE • TOTAL
 *
 * Implements the full spec:
 *   Section 2  — American odds conversion
 *   Section 3  — Break-even probability
 *   Section 4  — Model probability (from simulation, never from odds)
 *   Section 5  — Probability edge
 *   Section 6  — Expected value / ROI
 *   Section 7  — Fair model price
 *   Section 8  — Price edge
 *   Section 9  — Edge classification (ROI-based)
 *   Section 10 — Edge scoring (probability-based points)
 *   Section 12 — Structured logging
 *   Section 13 — Validation rules
 *
 * This module is the single source of truth for all edge calculations.
 * No heuristic scoring is allowed. Every output is mathematically reproducible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketType = "MONEYLINE" | "SPREAD" | "PUCK_LINE" | "TOTAL_OVER" | "TOTAL_UNDER";

export type EdgeVerdict =
  | "ELITE EDGE"
  | "STRONG EDGE"
  | "PLAYABLE EDGE"
  | "SMALL EDGE"
  | "PASS";

/** All inputs required to run the edge engine for one market side. */
export interface EdgeEngineInput {
  league: string;
  gameId: string;
  marketType: MarketType;
  bookLine: number | null;
  bookOdds: number;
  modelLine: number | null;
  modelOdds: number;
  /** Model probability (0–1) derived from simulation distribution. NEVER from odds. */
  modelProbability: number;
}

/** Full output from the edge engine for one market side. */
export interface EdgeEngineResult {
  // Inputs (echoed for logging)
  league: string;
  gameId: string;
  marketType: MarketType;
  bookLine: number | null;
  bookOdds: number;
  modelLine: number | null;
  modelOdds: number;
  modelProbability: number;

  // Derived values
  breakEvenProbability: number;   // = american_to_probability(bookOdds)
  probabilityEdge: number;        // = modelProbability - breakEvenProbability
  edgePoints: number;             // = probabilityEdge * 100
  payout: number;                 // = payout_from_odds(bookOdds)
  expectedValue: number;          // = (modelProbability * payout) - (1 - modelProbability)
  roiPercent: number;             // = EV * 100
  fairModelOdds: number;          // = probability_to_american(modelProbability)
  priceEdge: number;              // = bookOdds - fairModelOdds
  verdict: EdgeVerdict;
}

// ─── Section 2: American Odds Conversion ─────────────────────────────────────

/**
 * Convert American odds to implied probability (0–1).
 * Includes the vig — this is the break-even probability at the book price.
 */
export function americanToProbability(odds: number): number {
  if (!isFinite(odds)) throw new Error(`[EdgeEngine] Invalid odds: ${odds}`);
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  } else {
    return 100 / (odds + 100);
  }
}

/**
 * Payout per $1 wagered at the given American odds.
 * e.g. -150 → 0.6667, +130 → 1.30
 */
export function payoutFromOdds(odds: number): number {
  if (!isFinite(odds)) throw new Error(`[EdgeEngine] Invalid odds for payout: ${odds}`);
  if (odds < 0) {
    return 100 / Math.abs(odds);
  } else {
    return odds / 100;
  }
}

/**
 * Convert probability (0–1) to fair American odds.
 * p > 0.5 → negative (favorite), p < 0.5 → positive (underdog), p = 0.5 → +100
 */
export function probabilityToAmerican(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`[EdgeEngine] Probability out of range: ${p}`);
  if (p > 0.5) {
    return -100 * (p / (1 - p));
  } else if (p < 0.5) {
    return 100 * ((1 - p) / p);
  } else {
    return 100; // exactly even money
  }
}

// ─── Section 9: Edge Classification (ROI-based) ───────────────────────────────

/**
 * Classify edge using ROI percent per the spec.
 * Thresholds: PASS < 1, SMALL 1–3, PLAYABLE 3–6, STRONG 6–10, ELITE ≥ 10
 */
export function classifyEdge(roiPercent: number): EdgeVerdict {
  if (roiPercent < 1)   return "PASS";
  if (roiPercent < 3)   return "SMALL EDGE";
  if (roiPercent < 6)   return "PLAYABLE EDGE";
  if (roiPercent < 10)  return "STRONG EDGE";
  return "ELITE EDGE";
}

// ─── Section 13: Validation ───────────────────────────────────────────────────

function validateInput(input: EdgeEngineInput): void {
  const { modelProbability, bookOdds, modelOdds, gameId, marketType } = input;
  const ctx = `[EdgeEngine][${gameId}][${marketType}]`;

  if (modelProbability < 0 || modelProbability > 1) {
    throw new Error(`${ctx} model_probability out of range: ${modelProbability}`);
  }
  if (!isFinite(bookOdds)) {
    throw new Error(`${ctx} book_odds is not finite: ${bookOdds}`);
  }
  if (!isFinite(modelOdds)) {
    throw new Error(`${ctx} model_odds is not finite: ${modelOdds}`);
  }
}

function validateResult(result: EdgeEngineResult): void {
  const ctx = `[EdgeEngine][${result.gameId}][${result.marketType}]`;

  if (!isFinite(result.roiPercent)) {
    throw new Error(`${ctx} ROI_percent is not finite: ${result.roiPercent}`);
  }
  if (result.payout <= 0) {
    throw new Error(`${ctx} payout must be > 0, got: ${result.payout}`);
  }
  if (!isFinite(result.edgePoints)) {
    throw new Error(`${ctx} edge_points is not numeric: ${result.edgePoints}`);
  }
  if (result.modelProbability < 0 || result.modelProbability > 1) {
    throw new Error(`${ctx} model_probability out of range: ${result.modelProbability}`);
  }
}

// ─── Section 12: Structured Logging ──────────────────────────────────────────

export function logEdgeResult(result: EdgeEngineResult, gameName?: string): void {
  const name = gameName ?? result.gameId;
  const priceEdgeStr = result.priceEdge >= 0
    ? `+${result.priceEdge.toFixed(0)}¢`
    : `${result.priceEdge.toFixed(0)}¢`;

  console.log(
    `[EDGE_ENGINE_LOG]\n` +
    `  league            = ${result.league}\n` +
    `  game              = ${name}\n` +
    `  market            = ${result.marketType}\n` +
    `  book_line         = ${result.bookLine ?? '—'}\n` +
    `  book_odds         = ${result.bookOdds >= 0 ? '+' : ''}${result.bookOdds}\n` +
    `  model_line        = ${result.modelLine ?? '—'}\n` +
    `  model_odds        = ${result.modelOdds >= 0 ? '+' : ''}${result.modelOdds}\n` +
    `  model_probability = ${(result.modelProbability * 100).toFixed(2)}%\n` +
    `  break_even        = ${(result.breakEvenProbability * 100).toFixed(2)}%\n` +
    `  probability_edge  = ${result.probabilityEdge >= 0 ? '+' : ''}${(result.probabilityEdge * 100).toFixed(2)}%\n` +
    `  edge_points       = ${result.edgePoints >= 0 ? '+' : ''}${result.edgePoints.toFixed(2)} pts\n` +
    `  EV                = ${result.expectedValue >= 0 ? '+' : ''}${result.expectedValue.toFixed(4)}\n` +
    `  ROI               = ${result.roiPercent >= 0 ? '+' : ''}${result.roiPercent.toFixed(2)}%\n` +
    `  fair_model_price  = ${result.fairModelOdds >= 0 ? '+' : ''}${result.fairModelOdds.toFixed(0)}\n` +
    `  price_edge        = ${priceEdgeStr}\n` +
    `  verdict           = ${result.verdict}`
  );
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Run the full edge engine for one market side.
 *
 * @param input - Market inputs including model_probability from simulation
 * @param enableLogging - If true, logs the full structured output
 * @returns Full EdgeEngineResult with all derived values
 * @throws If any validation check fails
 */
export function calculateEdgeResult(
  input: EdgeEngineInput,
  enableLogging = false
): EdgeEngineResult {
  // Section 13: validate inputs
  validateInput(input);

  const {
    league, gameId, marketType,
    bookLine, bookOdds, modelLine, modelOdds,
    modelProbability,
  } = input;

  // Section 3: break-even probability
  const breakEvenProbability = americanToProbability(bookOdds);

  // Section 5: probability edge
  const probabilityEdge = modelProbability - breakEvenProbability;

  // Section 10: edge points
  const edgePoints = probabilityEdge * 100;

  // Section 6: EV and ROI
  const payout = payoutFromOdds(bookOdds);
  const expectedValue = (modelProbability * payout) - (1 - modelProbability);
  const roiPercent = expectedValue * 100;

  // Section 7: fair model price
  const fairModelOdds = probabilityToAmerican(modelProbability);

  // Section 8: price edge (positive = book is offering more than fair value)
  const priceEdge = bookOdds - fairModelOdds;

  // Section 9: verdict from ROI
  const verdict = classifyEdge(roiPercent);

  const result: EdgeEngineResult = {
    league, gameId, marketType,
    bookLine, bookOdds, modelLine, modelOdds,
    modelProbability,
    breakEvenProbability,
    probabilityEdge,
    edgePoints,
    payout,
    expectedValue,
    roiPercent,
    fairModelOdds,
    priceEdge,
    verdict,
  };

  // Section 13: validate result
  validateResult(result);

  // Section 12: structured logging
  if (enableLogging) {
    logEdgeResult(result);
  }

  return result;
}

// ─── Batch Runner (Section 11: Global Market Execution) ──────────────────────

/**
 * Run the edge engine for every market in a batch.
 * Logs each result and collects any validation errors without crashing the batch.
 */
export function runEdgeEngineForGame(
  markets: EdgeEngineInput[],
  gameName?: string,
  enableLogging = false
): { results: EdgeEngineResult[]; errors: string[] } {
  const results: EdgeEngineResult[] = [];
  const errors: string[] = [];

  for (const market of markets) {
    try {
      const result = calculateEdgeResult(market, enableLogging);
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      console.error(`[EdgeEngine] Calculation error: ${msg}`);
    }
  }

  if (errors.length > 0) {
    console.error(`[EdgeEngine][${gameName ?? 'unknown'}] ${errors.length} market(s) failed validation`);
  }

  return { results, errors };
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

/**
 * Short display label for a verdict (for EdgeBadge rows).
 * Matches the existing UI labels.
 */
export function verdictLabel(verdict: EdgeVerdict): string {
  switch (verdict) {
    case "ELITE EDGE":    return "ELITE";
    case "STRONG EDGE":   return "STRONG";
    case "PLAYABLE EDGE": return "PLAYABLE";
    case "SMALL EDGE":    return "SMALL";
    case "PASS":          return "PASS";
  }
}

/**
 * Neon green color scale based on ROI tier.
 * ELITE/STRONG → full neon, PLAYABLE → yellow-green, SMALL → white/60, PASS → white/30
 */
export function verdictColor(verdict: EdgeVerdict): string {
  switch (verdict) {
    case "ELITE EDGE":    return "#39FF14";
    case "STRONG EDGE":   return "#7FFF00";
    case "PLAYABLE EDGE": return "#ADFF2F";
    case "SMALL EDGE":    return "rgba(255,255,255,0.60)";
    case "PASS":          return "rgba(255,255,255,0.30)";
  }
}

/**
 * Convenience: run edge engine from raw American odds + model probability.
 * Returns null if any input is NaN/invalid (graceful degradation for UI).
 */
export function edgeFromOddsAndProb(
  bookOdds: number,
  modelProbability: number,
  opts: { league?: string; gameId?: string; marketType?: MarketType } = {}
): EdgeEngineResult | null {
  if (!isFinite(bookOdds) || !isFinite(modelProbability)) return null;
  if (modelProbability <= 0 || modelProbability >= 1) return null;

  try {
    return calculateEdgeResult({
      league: opts.league ?? "UNKNOWN",
      gameId: opts.gameId ?? "UNKNOWN",
      marketType: opts.marketType ?? "MONEYLINE",
      bookLine: null,
      bookOdds,
      modelLine: null,
      modelOdds: probabilityToAmerican(modelProbability),
      modelProbability,
    });
  } catch {
    return null;
  }
}

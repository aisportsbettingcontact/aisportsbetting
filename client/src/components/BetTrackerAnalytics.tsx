/**
 * BetTrackerAnalytics.tsx — Analytics components for the Bet Tracker page.
 *
 * Components:
 *   EquityChart     — Canvas-based cumulative P/L curve with hover tooltip
 *   BreakdownPanel  — Single breakdown dimension (Type/Size/Month/Sport/Timeframe)
 *   BreakdownGrid   — All breakdown panels in a responsive grid
 *   HandicapperSelector — Owner/Admin dropdown to switch between handicappers
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { BarChart2, Activity, Users, ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquityPoint = {
  date: string;
  cumPL: number;
  betId: number;
  pick: string;
  result: string;
  pl: number;
};

export type BreakdownEntry = {
  key: string;
  wins: number;
  losses: number;
  pushes: number;
  totalRisk: number;
  netProfit: number;
  roi: number;
};

export type StatsData = {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  voids?: number;
  gradedBets?: number;
  totalRisk: number;
  totalWon?: number;
  totalLost?: number;
  netProfit: number;
  roi: number;
  bestWin: number;
  worstLoss: number;
  byType: BreakdownEntry[];
  bySize: BreakdownEntry[];
  byMonth: BreakdownEntry[];
  bySport: BreakdownEntry[];
  byResult?: BreakdownEntry[];
  byTimeframe: BreakdownEntry[];
  equityCurve: EquityPoint[];
};

// ─── EquityChart ──────────────────────────────────────────────────────────────

export function EquityChart({ points }: { points: EquityPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [tooltip, setTooltip] = useState<{
    x: number;       // pixel X of the data-point dot (relative to canvas)
    dotY: number;    // pixel Y of the data-point dot (relative to canvas)
    point: EquityPoint;
    flipLeft: boolean;
  } | null>(null);

  // ── Responsive resize observer ──────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      // Dynamic height: 28% of width, clamped [160, 340]
      const h = Math.round(Math.min(340, Math.max(160, w * 0.28)));
      console.log(`[EquityChart][STATE] ResizeObserver: w=${w} h=${h}`);
      setDims({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0 || dims.w === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = dims.w;
    const H = dims.h;

    // Set physical pixel size
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);

    // Padding: left wide enough for Y labels, bottom for X labels
    const PAD = {
      top: 20,
      right: 16,
      bottom: 34,
      left: 58,
    };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    const values = points.map((p) => p.cumPL);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values);
    const range = maxV - minV || 1;

    const toX = (i: number) =>
      PAD.left + (i / Math.max(points.length - 1, 1)) * chartW;
    const toY = (v: number) =>
      PAD.top + chartH - ((v - minV) / range) * chartH;
    const zeroY = toY(0);

    // Background
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, W, H);

    // Grid lines + Y labels
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const v = minV + (range * i) / gridCount;
      const y = toY(v);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.font = `${Math.max(9, Math.round(W / 80))}px JetBrains Mono, monospace`;
      ctx.textAlign = "right";
      ctx.fillText(
        `${v >= 0 ? "+" : ""}${v.toFixed(1)}u`,
        PAD.left - 6,
        y + 4
      );
    }

    // Zero line (dashed)
    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, zeroY);
    ctx.lineTo(W - PAD.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill gradient under curve
    const lastPL = points[points.length - 1]?.cumPL ?? 0;
    const grad = ctx.createLinearGradient(0, PAD.top, 0, H - PAD.bottom);
    if (lastPL >= 0) {
      grad.addColorStop(0, "rgba(52,211,153,0.28)");
      grad.addColorStop(0.7, "rgba(52,211,153,0.04)");
      grad.addColorStop(1, "rgba(52,211,153,0)");
    } else {
      grad.addColorStop(0, "rgba(239,68,68,0)");
      grad.addColorStop(0.3, "rgba(239,68,68,0.04)");
      grad.addColorStop(1, "rgba(239,68,68,0.28)");
    }
    ctx.beginPath();
    ctx.moveTo(toX(0), zeroY);
    points.forEach((p, i) => ctx.lineTo(toX(i), toY(p.cumPL)));
    ctx.lineTo(toX(points.length - 1), zeroY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Main line
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = lastPL >= 0 ? "#34d399" : "#ef4444";
    ctx.lineJoin = "round";
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(i), toY(p.cumPL));
      else ctx.lineTo(toX(i), toY(p.cumPL));
    });
    ctx.stroke();

    // Dots
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(toX(i), toY(p.cumPL), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = p.result === "WIN" ? "#34d399" : "#ef4444";
      ctx.fill();
    });

    // X-axis date labels — compute step from available width
    // Minimum 52px per label to avoid clamping
    const minLabelPx = 52;
    const maxLabels = Math.max(2, Math.floor(chartW / minLabelPx));
    const step = Math.max(1, Math.ceil((points.length - 1) / maxLabels));
    const labelFontSize = Math.max(8, Math.min(10, Math.round(W / 90)));
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `${labelFontSize}px monospace`;
    ctx.textAlign = "center";
    points.forEach((p, i) => {
      if (i % step === 0 || i === points.length - 1) {
        const d = p.date.substring(5); // MM-DD
        const xPos = toX(i);
        // Clamp label within canvas bounds
        const clampedX = Math.max(PAD.left + 12, Math.min(W - PAD.right - 12, xPos));
        ctx.fillText(d, clampedX, H - PAD.bottom + 16);
      }
    });

    console.log(`[EquityChart][OUTPUT] Rendered: W=${W} H=${H} points=${points.length} step=${step} maxLabels=${maxLabels}`);
  }, [points, dims]);

  // ── Mouse interaction ───────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (points.length === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;

      const W = dims.w;
      const H = dims.h;
      const PAD_LEFT = 58;
      const PAD_RIGHT = 16;
      const PAD_TOP = 20;
      const PAD_BOTTOM = 34;
      const chartW = W - PAD_LEFT - PAD_RIGHT;
      const chartH = H - PAD_TOP - PAD_BOTTOM;

      const idx = Math.round(
        ((mx - PAD_LEFT) / chartW) * (points.length - 1)
      );
      const clamped = Math.max(0, Math.min(points.length - 1, idx));
      const point = points[clamped];

      const values = points.map((p) => p.cumPL);
      const minV = Math.min(0, ...values);
      const maxV = Math.max(0, ...values);
      const range = maxV - minV || 1;

      const toX = (i: number) =>
        PAD_LEFT + (i / Math.max(points.length - 1, 1)) * chartW;
      const toY = (v: number) =>
        PAD_TOP + chartH - ((v - minV) / range) * chartH;

      const dotX = toX(clamped);
      const dotY = toY(point.cumPL);

      // Flip tooltip to left side when near right edge (tooltip width ~180px)
      const flipLeft = dotX + 14 + 180 > W;

      setTooltip({ x: dotX, dotY, point, flipLeft });
    },
    [points, dims]
  );

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-600 text-xs">
        No settled bets yet — equity curve will appear after first graded bet
      </div>
    );
  }

  const finalPL = points[points.length - 1]?.cumPL ?? 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: dims.h || 200, display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        className="rounded-lg cursor-crosshair"
      />
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl min-w-[160px]"
          style={{
            // Position tooltip above the dot, anchored to dot X
            left: tooltip.flipLeft
              ? Math.max(0, tooltip.x - 174)
              : Math.min(tooltip.x + 14, dims.w - 180),
            // Place above the dot with 8px gap; clamp to top of chart
            top: Math.max(4, tooltip.dotY - 82),
          }}
        >
          <div className="font-bold text-white truncate">{tooltip.point.pick}</div>
          <div
            className={
              tooltip.point.result === "WIN"
                ? "text-green-400 font-mono"
                : "text-red-400 font-mono"
            }
          >
            {tooltip.point.result}{" "}
            {tooltip.point.pl >= 0 ? "+" : ""}
            {tooltip.point.pl.toFixed(2)}u
          </div>
          <div className="text-zinc-500 font-mono">
            Cumulative:{" "}
            <span className={finalPL >= 0 ? "text-green-400" : "text-red-400"}>
              {tooltip.point.cumPL >= 0 ? "+" : ""}
              {tooltip.point.cumPL.toFixed(2)}u
            </span>
          </div>
          <div className="text-zinc-600">{tooltip.point.date}</div>
        </div>
      )}
    </div>
  );
}

// ─── BreakdownPanel ───────────────────────────────────────────────────────────

export function BreakdownPanel({
  title,
  icon,
  entries,
}: {
  title: string;
  icon: React.ReactNode;
  entries: BreakdownEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
      {/* Panel header */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-zinc-400">{icon}</span>
        <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
          {title}
        </span>
      </div>

      {/* Rows */}
      <div className="space-y-2.5">
        {entries.map((e) => {
          const settled = e.wins + e.losses;
          const winPct = settled > 0 ? (e.wins / settled) * 100 : 0;
          const isPos = e.netProfit >= 0;

          return (
            <div key={e.key}>
              {/* Row 1: label + stats inline */}
              <div className="flex items-baseline justify-between gap-1 flex-wrap">
                {/* Label */}
                <span className="text-white text-[11px] font-bold leading-tight shrink-0 mr-1">
                  {e.key}
                </span>

                {/* Stats cluster — right-aligned, wraps on very narrow */}
                <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
                  {/* W-L (WP%) */}
                  <span className="text-[10px] text-zinc-400 font-mono whitespace-nowrap">
                    {e.wins}W–{e.losses}L
                    {e.pushes > 0 ? `–${e.pushes}P` : ""}{" "}
                    <span className="text-zinc-500">
                      ({winPct.toFixed(0)}%)
                    </span>
                  </span>

                  {/* Net P/L */}
                  <span
                    className={`text-[10px] font-bold font-mono whitespace-nowrap ${
                      isPos ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {e.netProfit >= 0 ? "+" : ""}
                    {e.netProfit.toFixed(2)}u
                  </span>

                  {/* ROI */}
                  <span
                    className={`text-[10px] font-mono whitespace-nowrap ${
                      isPos ? "text-green-400/75" : "text-red-400/75"
                    }`}
                  >
                    {e.roi >= 0 ? "+" : ""}
                    {e.roi.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Win% bar */}
              <div className="mt-1 h-[3px] bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isPos ? "bg-green-500" : "bg-red-500"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, winPct))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BreakdownGrid ────────────────────────────────────────────────────────────

/** Remap raw server keys to human-readable display labels */
function remapKey(
  dimension: "type" | "size" | "month" | "sport" | "timeframe",
  key: string
): string {
  if (dimension === "type") {
    if (key === "ML") return "MONEY LINE";
    if (key === "RL") return "RUN LINE";
    if (key === "TOTAL") return "OVER/UNDER";
    return key;
  }
  if (dimension === "month") {
    const MONTHS = [
      "",
      "JANUARY",
      "FEBRUARY",
      "MARCH",
      "APRIL",
      "MAY",
      "JUNE",
      "JULY",
      "AUGUST",
      "SEPTEMBER",
      "OCTOBER",
      "NOVEMBER",
      "DECEMBER",
    ];
    const m = key.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const month = parseInt(m[2], 10);
      return `${MONTHS[month] ?? key} ${m[1]}`;
    }
    return key;
  }
  if (dimension === "timeframe") {
    if (key === "FULL_GAME") return "Full Game";
    if (key === "FIRST_5") return "First 5";
    if (key === "FIRST_HALF") return "First Half";
    if (key === "FIRST_PERIOD") return "First Period";
    if (key === "FIRST_QUARTER") return "First Quarter";
    return key;
  }
  return key;
}

function remapEntries(
  dimension: "type" | "size" | "month" | "sport" | "timeframe",
  entries: BreakdownEntry[]
): BreakdownEntry[] {
  return entries.map((e) => ({ ...e, key: remapKey(dimension, e.key) }));
}

export function BreakdownGrid({ stats }: { stats: StatsData }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
      <BreakdownPanel
        title="By Bet Type"
        icon={<BarChart2 size={12} />}
        entries={remapEntries("type", stats.byType)}
      />
      <BreakdownPanel
        title="By Unit Size"
        icon={<Activity size={12} />}
        entries={remapEntries("size", stats.bySize)}
      />
      <BreakdownPanel
        title="By Month"
        icon={<Activity size={12} />}
        entries={remapEntries("month", stats.byMonth)}
      />
      <BreakdownPanel
        title="By Sport"
        icon={<Activity size={12} />}
        entries={remapEntries("sport", stats.bySport)}
      />
      <BreakdownPanel
        title="By Timeframe"
        icon={<Activity size={12} />}
        entries={remapEntries("timeframe", stats.byTimeframe)}
      />
    </div>
  );
}

// ─── HandicapperSelector ──────────────────────────────────────────────────────

export function HandicapperSelector({
  handicappers,
  selectedId,
  onSelect,
  currentUserId,
}: {
  handicappers: Array<{ id: number; username: string; role: string }>;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  currentUserId: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const selected = handicappers.find((h) => h.id === selectedId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700 text-xs text-white hover:bg-zinc-700/60 transition-all"
      >
        <Users size={12} className="text-zinc-400" />
        <span className="font-mono">
          {selected?.username ?? "Select Handicapper"}
        </span>
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl min-w-[180px] py-1">
          {handicappers.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                onSelect(h.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 transition-colors ${
                h.id === selectedId ? "text-emerald-400 font-bold" : "text-white"
              }`}
            >
              {h.username}
              {h.id === currentUserId && (
                <span className="text-zinc-500 ml-1">(you)</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

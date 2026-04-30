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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    point: EquityPoint;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const PAD = { top: 20, right: 20, bottom: 36, left: 56 };
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
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = `10px JetBrains Mono, monospace`;
      ctx.textAlign = "right";
      ctx.fillText(
        `${v >= 0 ? "+" : ""}${v.toFixed(1)}u`,
        PAD.left - 6,
        y + 4
      );
    }

    // Zero line (dashed)
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
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
      grad.addColorStop(0, "rgba(52,211,153,0.30)");
      grad.addColorStop(0.7, "rgba(52,211,153,0.04)");
      grad.addColorStop(1, "rgba(52,211,153,0)");
    } else {
      grad.addColorStop(0, "rgba(239,68,68,0)");
      grad.addColorStop(0.3, "rgba(239,68,68,0.04)");
      grad.addColorStop(1, "rgba(239,68,68,0.30)");
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

    // X-axis date labels
    const step = Math.max(1, Math.floor(points.length / 10));
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `9px monospace`;
    ctx.textAlign = "center";
    points.forEach((p, i) => {
      if (i % step === 0 || i === points.length - 1) {
        const d = p.date.substring(5); // MM-DD
        ctx.fillText(d, toX(i), H - PAD.bottom + 18);
      }
    });
  }, [points]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (points.length === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const W = canvas.offsetWidth;
      const PAD_LEFT = 56;
      const PAD_RIGHT = 20;
      const chartW = W - PAD_LEFT - PAD_RIGHT;
      const idx = Math.round(
        ((mx - PAD_LEFT) / chartW) * (points.length - 1)
      );
      const clamped = Math.max(0, Math.min(points.length - 1, idx));
      const point = points[clamped];
      const toX = (i: number) =>
        PAD_LEFT + (i / Math.max(points.length - 1, 1)) * chartW;
      setTooltip({ x: toX(clamped), y: e.clientY - rect.top, point });
    },
    [points]
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
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: 200 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        className="rounded-lg cursor-crosshair block"
      />
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl min-w-[160px]"
          style={{
            left: Math.min(tooltip.x + 14, 240),
            top: Math.max(4, tooltip.y - 50),
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
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-zinc-400">{icon}</span>
        <span className="text-[11px] font-bold tracking-widest text-zinc-400 uppercase">
          {title}
        </span>
      </div>
      <div className="space-y-3">
        {entries.map((e) => {
          const settled = e.wins + e.losses;
          const winPct = settled > 0 ? (e.wins / settled) * 100 : 0;
          const isPos = e.netProfit >= 0;
          return (
            <div key={e.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white text-xs font-bold truncate flex-1">
                  {e.key}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {e.wins}W-{e.losses}L
                    {e.pushes > 0 ? `-${e.pushes}P` : ""}
                  </span>
                  <span
                    className={`text-[10px] font-bold font-mono w-16 text-right ${
                      isPos ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {e.netProfit >= 0 ? "+" : ""}
                    {e.netProfit.toFixed(2)}u
                  </span>
                  <span
                    className={`text-[10px] font-mono w-14 text-right ${
                      isPos ? "text-green-400/70" : "text-red-400/70"
                    }`}
                  >
                    {e.roi >= 0 ? "+" : ""}
                    {e.roi.toFixed(1)}%
                  </span>
                </div>
              </div>
              {/* Win% bar */}
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isPos ? "bg-green-500" : "bg-red-500"
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, winPct))}%`,
                  }}
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
function remapKey(dimension: "type" | "size" | "month" | "sport" | "timeframe", key: string): string {
  if (dimension === "type") {
    if (key === "ML") return "MONEY LINE";
    if (key === "RL") return "RUN LINE";
    if (key === "TOTAL") return "OVER/UNDER";
    return key;
  }
  if (dimension === "month") {
    // Format: "2026-03" → "MARCH 2026"
    const MONTHS = ["","JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
      "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
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

function remapEntries(dimension: "type" | "size" | "month" | "sport" | "timeframe", entries: BreakdownEntry[]): BreakdownEntry[] {
  return entries.map(e => ({ ...e, key: remapKey(dimension, e.key) }));
}

export function BreakdownGrid({ stats }: { stats: StatsData }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <BreakdownPanel
        title="By Bet Type"
        icon={<BarChart2 size={13} />}
        entries={remapEntries("type", stats.byType)}
      />
      <BreakdownPanel
        title="By Unit Size"
        icon={<Activity size={13} />}
        entries={remapEntries("size", stats.bySize)}
      />
      <BreakdownPanel
        title="By Month"
        icon={<Activity size={13} />}
        entries={remapEntries("month", stats.byMonth)}
      />
      <BreakdownPanel
        title="By Sport"
        icon={<Activity size={13} />}
        entries={remapEntries("sport", stats.bySport)}
      />
      <BreakdownPanel
        title="By Timeframe"
        icon={<Activity size={13} />}
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
  onSelect: (id: number | undefined) => void;
  currentUserId: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = selectedId
    ? handicappers.find((h) => h.id === selectedId)
    : null;
  const label = selected ? `@${selected.username}` : "All Handicappers";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
      >
        <Users size={13} className="text-zinc-400 shrink-0" />
        <span className="font-medium">{label}</span>
        <ChevronDown
          size={12}
          className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden min-w-[180px]">
          <button
            type="button"
            onClick={() => {
              onSelect(undefined);
              setOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left text-sm ${
              !selectedId ? "text-emerald-400 font-bold" : "text-zinc-300"
            }`}
          >
            All Handicappers
          </button>
          {handicappers.map((h) => (
            <button
              type="button"
              key={h.id}
              onClick={() => {
                onSelect(h.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left text-sm ${
                selectedId === h.id
                  ? "text-emerald-400 font-bold"
                  : "text-zinc-300"
              }`}
            >
              <span>@{h.username}</span>
              <span
                className={`ml-auto text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  h.role === "owner"
                    ? "bg-yellow-500/10 text-yellow-400"
                    : h.role === "admin"
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-emerald-500/10 text-emerald-400"
                }`}
              >
                {h.role}
              </span>
              {h.id === currentUserId && (
                <span className="text-[9px] text-zinc-600 ml-1">(you)</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

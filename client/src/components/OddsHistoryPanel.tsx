/**
 * OddsHistoryPanel
 *
 * Collapsible panel shown at the bottom of each EditableGameCard in Publish Projections.
 * Displays a chronological table of every DK NJ odds snapshot for the game,
 * with EST timestamps, spread, total, and moneyline columns.
 *
 * Timestamps are stored as UTC epoch ms in the DB and converted to EST for display.
 * "Manual" rows (triggered by the Refresh Now button) are highlighted with an amber badge.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface OddsHistoryPanelProps {
  gameId: number;
  awayTeam: string;
  homeTeam: string;
}

/** Format a UTC epoch ms timestamp as Eastern time string: "Mar 15, 1:59 PM EST" or "Mar 15, 2:59 PM EDT" */
function fmtEst(epochMs: number): string {
  const d = new Date(epochMs);
  // Format date + time parts separately so we can append the timezone abbreviation
  const datePart = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Determine EST vs EDT based on whether DST is active in New York
  const tzAbbr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(d).find(p => p.type === "timeZoneName")?.value ?? "ET";
  return `${datePart}, ${timePart} ${tzAbbr}`;
}

/** Format a spread value with its juice: "+3.5 (-118)" */
function fmtSpread(value: string | null | undefined, odds: string | null | undefined): string {
  if (!value) return "—";
  const v = parseFloat(value);
  const sign = v > 0 ? "+" : "";
  const line = `${sign}${v}`;
  if (!odds) return line;
  return `${line} (${odds})`;
}

/** Format a total: "o139.5 (-108) / u (-112)" */
function fmtTotal(
  total: string | null | undefined,
  over: string | null | undefined,
  under: string | null | undefined
): string {
  if (!total) return "—";
  const t = parseFloat(total);
  const overStr = over ? `o${t} (${over})` : `o${t}`;
  const underStr = under ? `u (${under})` : "u";
  return `${overStr} / ${underStr}`;
}

/** Format a moneyline pair: "-145 / +125" */
function fmtML(away: string | null | undefined, home: string | null | undefined): string {
  if (!away && !home) return "—";
  const a = away ?? "—";
  const h = home ?? "—";
  return `${a} / ${h}`;
}

export function OddsHistoryPanel({ gameId, awayTeam, homeTeam }: OddsHistoryPanelProps) {
  const [open, setOpen] = useState(false);

  // Only fetch when the panel is expanded — avoids unnecessary queries on page load
  const { data, isLoading, error } = trpc.oddsHistory.listForGame.useQuery(
    { gameId },
    { enabled: open, staleTime: 30_000 }
  );

  const rows = data?.history ?? [];

  return (
    <div
      className="border-t"
      style={{ borderColor: "rgba(57,255,20,0.15)" }}
    >
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Clock size={13} style={{ color: "#39FF14" }} />
          <span
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: "#39FF14" }}
          >
            Odds History
          </span>
          {rows.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(57,255,20,0.15)", color: "#39FF14" }}
            >
              {rows.length}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp size={14} style={{ color: "#39FF14" }} />
          : <ChevronDown size={14} style={{ color: "rgba(57,255,20,0.6)" }} />
        }
      </button>

      {/* Expanded table */}
      {open && (
        <div className="px-2 pb-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              <RefreshCw size={13} className="animate-spin" />
              <span className="text-xs">Loading history…</span>
            </div>
          ) : error ? (
            <p className="text-xs text-center py-4" style={{ color: "#ff4444" }}>
              Failed to load odds history.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.35)" }}>
              No snapshots yet — odds history will populate after the next AN refresh.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md" style={{ border: "1px solid rgba(57,255,20,0.12)" }}>
              <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "rgba(57,255,20,0.08)" }}>
                    <th className="text-left px-3 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}>
                      Time (EST)
                    </th>
                    <th className="text-center px-2 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}>
                      Source
                    </th>
                    <th className="text-center px-2 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}>
                      Away Spread
                    </th>
                    <th className="text-center px-2 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}>
                      Home Spread
                    </th>
                    <th className="text-center px-2 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}>
                      Total (O/U)
                    </th>
                    <th className="text-center px-2 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}>
                      ML (Away / Home)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const isManual = row.source === "manual";
                    const isEven = idx % 2 === 0;
                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: isEven
                            ? "rgba(255,255,255,0.02)"
                            : "transparent",
                          borderBottom: idx < rows.length - 1
                            ? "1px solid rgba(255,255,255,0.04)"
                            : "none",
                        }}
                      >
                        {/* EST timestamp */}
                        <td className="px-3 py-2 whitespace-nowrap font-mono" style={{ color: "rgba(255,255,255,0.75)" }}>
                          {fmtEst(row.scrapedAt)}
                        </td>

                        {/* Source badge */}
                        <td className="px-2 py-2 text-center">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                            style={isManual
                              ? { background: "rgba(251,191,36,0.18)", color: "#FBB924", border: "1px solid rgba(251,191,36,0.35)" }
                              : { background: "rgba(57,255,20,0.1)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.25)" }
                            }
                          >
                            {isManual ? "Manual" : "Auto"}
                          </span>
                        </td>

                        {/* Away spread */}
                        <td className="px-2 py-2 text-center font-mono" style={{ color: "rgba(255,255,255,0.85)" }}>
                          {fmtSpread(row.awaySpread, row.awaySpreadOdds)}
                        </td>

                        {/* Home spread */}
                        <td className="px-2 py-2 text-center font-mono" style={{ color: "rgba(255,255,255,0.85)" }}>
                          {fmtSpread(row.homeSpread, row.homeSpreadOdds)}
                        </td>

                        {/* Total */}
                        <td className="px-2 py-2 text-center font-mono whitespace-nowrap" style={{ color: "rgba(255,255,255,0.85)" }}>
                          {fmtTotal(row.total, row.overOdds, row.underOdds)}
                        </td>

                        {/* Moneyline */}
                        <td className="px-2 py-2 text-center font-mono whitespace-nowrap" style={{ color: "rgba(255,255,255,0.85)" }}>
                          {fmtML(row.awayML, row.homeML)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

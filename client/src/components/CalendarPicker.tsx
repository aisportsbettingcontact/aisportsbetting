/**
 * CalendarPicker
 *
 * A compact date-picker button that opens a month-view calendar dropdown.
 * - Shows the selected date as "Mon DD" (e.g. "Mar 8") on the button
 * - Today's UTC date is circled/highlighted by default
 * - Dates that have games are shown with a small dot indicator
 * - Clicking a date selects it; clicking the same date again deselects (shows all)
 */

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date as a YYYY-MM-DD string in UTC */
export function todayUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatButtonLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  } catch {
    return dateStr;
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CalendarPickerProps {
  /** Currently selected date as YYYY-MM-DD, or null for "all dates" */
  selectedDate: string | null;
  /** Called when user picks a date */
  onSelect: (date: string) => void;
  /** Set of YYYY-MM-DD strings that have games (shown with dot) */
  availableDates?: Set<string>;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function CalendarPicker({ selectedDate, onSelect, availableDates }: CalendarPickerProps) {
  const today = todayUTC();
  const [todayYear, todayMonth] = today.split("-").map(Number) as [number, number, number];

  // Calendar view state — default to the month of the selected date (or today)
  const displayBase = selectedDate ?? today;
  const [viewYear, setViewYear] = useState(() => parseInt(displayBase.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => parseInt(displayBase.slice(5, 7)) - 1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // When selectedDate changes externally, sync the calendar view to that month
  useEffect(() => {
    if (selectedDate) {
      setViewYear(parseInt(selectedDate.slice(0, 4)));
      setViewMonth(parseInt(selectedDate.slice(5, 7)) - 1);
    }
  }, [selectedDate]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(day: number) {
    const dateStr = toDateStr(viewYear, viewMonth, day);
    onSelect(dateStr);
    setOpen(false);
  }

  const buttonLabel = selectedDate ? formatButtonLabel(selectedDate) : formatButtonLabel(today);

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold tracking-wide transition-all flex-shrink-0"
        style={{
          background: "hsl(var(--card))",
          color: "#ffffff",
          border: "1px solid rgba(255,255,255,0.35)",
        }}
      >
        <CalendarDays className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(255,255,255,0.6)" }} />
        <span>{buttonLabel}</span>
      </button>

      {/* Dropdown calendar */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-50 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
          style={{ background: "#0f0f0f", width: 220 }}
        >
          {/* Month navigation header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <button
              onClick={prevMonth}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-bold text-white tracking-widest uppercase">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 px-2 pt-2 pb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[9px] font-bold tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
            {/* Empty cells before first day */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = toDateStr(viewYear, viewMonth, day);
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const hasGames = availableDates?.has(dateStr) ?? false;

              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className="relative flex flex-col items-center justify-center w-full aspect-square rounded-full text-[11px] font-bold transition-all"
                  style={
                    isSelected
                      ? { background: "#ffffff", color: "#000000" }
                      : isToday
                      ? { background: "rgba(255,255,255,0.15)", color: "#ffffff", outline: "1.5px solid rgba(255,255,255,0.6)", outlineOffset: "-1px" }
                      : hasGames
                      ? { color: "#ffffff" }
                      : { color: "rgba(255,255,255,0.3)" }
                  }
                >
                  {day}
                  {/* Game dot indicator */}
                  {hasGames && !isSelected && (
                    <span
                      className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded-full"
                      style={{ width: 3, height: 3, background: isToday ? "#ffffff" : "rgba(57,255,20,0.8)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

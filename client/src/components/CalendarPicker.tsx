/**
 * CalendarPicker
 *
 * A compact date-picker button that opens a month-view calendar dropdown.
 * - Today's UTC date is selected by default and highlighted with a neon green ring
 * - Past dates are locked (dimmed, unclickable) for standard users
 * - Admin users (isAdmin=true) can select any date including past ones
 * - Only today and future dates show green game-dot indicators
 * - Month name is always displayed in ALL CAPS
 */

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the "effective" game date as a YYYY-MM-DD string.
 * Games are considered to belong to the previous calendar day until 11:00 UTC
 * (equivalent to 3:00 AM PST / 6:00 AM EST), so the default date stays on
 * the previous day until the morning slate is well underway.
 */
export function todayUTC(): string {
  const now = new Date();
  // If before 11:00 UTC, treat it as the previous calendar day
  const CUTOFF_HOUR_UTC = 11;
  const effectiveMs = now.getUTCHours() < CUTOFF_HOUR_UTC
    ? now.getTime() - 24 * 60 * 60 * 1000  // subtract one day
    : now.getTime();
  const d = new Date(effectiveMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatButtonLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00Z");
    const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
    const day = d.getUTCDate();
    return `${month} ${day}`;
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

/** Compare two YYYY-MM-DD strings. Returns negative if a < b, 0 if equal, positive if a > b */
function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CalendarPickerProps {
  /** Currently selected date as YYYY-MM-DD */
  selectedDate: string;
  /** Called when user picks a date */
  onSelect: (date: string) => void;
  /** Set of YYYY-MM-DD strings that have games (shown with dot) */
  availableDates?: Set<string>;
  /** If true, past dates are also selectable (admin/owner bypass) */
  isAdmin?: boolean;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function CalendarPicker({ selectedDate, onSelect, availableDates, isAdmin = false }: CalendarPickerProps) {
  const today = todayUTC();

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

  // Prevent navigating to months entirely in the past for standard users
  const isViewingPastMonth =
    !isAdmin &&
    (viewYear < parseInt(today.slice(0, 4)) ||
      (viewYear === parseInt(today.slice(0, 4)) &&
        viewMonth < parseInt(today.slice(5, 7)) - 1));

  function prevMonth() {
    // Standard users: don't go before current month
    if (!isAdmin) {
      const todayYear = parseInt(today.slice(0, 4));
      const todayMon = parseInt(today.slice(5, 7)) - 1;
      if (viewYear === todayYear && viewMonth === todayMon) return;
      if (viewYear < todayYear) return;
    }
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(day: number) {
    const dateStr = toDateStr(viewYear, viewMonth, day);
    const isPast = compareDates(dateStr, today) < 0;
    // Block past dates for standard users
    if (isPast && !isAdmin) return;
    onSelect(dateStr);
    setOpen(false);
  }

  const buttonLabel = formatButtonLabel(selectedDate ?? today);

  // Is the prev-month arrow disabled for standard users?
  const prevDisabled = !isAdmin && (() => {
    const todayYear = parseInt(today.slice(0, 4));
    const todayMon = parseInt(today.slice(5, 7)) - 1;
    return viewYear === todayYear && viewMonth === todayMon;
  })();

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
              disabled={prevDisabled}
              className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
              style={{
                color: prevDisabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)",
                cursor: prevDisabled ? "not-allowed" : "pointer",
              }}
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
              const isPast = compareDates(dateStr, today) < 0;
              // Past dates are locked for standard users
              const isLocked = isPast && !isAdmin;
              // Only show game dots on today and future dates (or admin viewing past)
              const hasGames = (availableDates?.has(dateStr) ?? false) && (!isPast || isAdmin);

              // Style priority:
              // 1. locked (past, standard user) → very dim, no interaction
              // 2. selected + today             → white fill, black text, neon green ring
              // 3. selected only                → white fill, black text
              // 4. today only                   → neon green ring, green text, subtle bg
              // 5. has games (future)            → white text
              // 6. future no games              → dim white
              const dayStyle: React.CSSProperties = (() => {
                if (isLocked)                  return { color: "rgba(255,255,255,0.12)", cursor: "not-allowed" };
                if (isSelected && isToday)     return { background: "#ffffff", color: "#000000", outline: "2px solid #39FF14", outlineOffset: "1px" };
                if (isSelected)                return { background: "#ffffff", color: "#000000" };
                if (isToday)                   return { background: "rgba(57,255,20,0.12)", color: "#39FF14", outline: "1.5px solid #39FF14", outlineOffset: "-1px" };
                if (hasGames)                  return { color: "#ffffff" };
                return { color: "rgba(255,255,255,0.3)" };
              })();

              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  disabled={isLocked}
                  className="relative flex flex-col items-center justify-center w-full aspect-square rounded-full text-[11px] font-bold transition-all"
                  style={dayStyle}
                >
                  {day}
                  {/* Game dot indicator — only on today/future, hide when selected */}
                  {hasGames && !isSelected && (
                    <span
                      className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded-full"
                      style={{ width: 3, height: 3, background: isToday ? "#39FF14" : "rgba(57,255,20,0.8)" }}
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

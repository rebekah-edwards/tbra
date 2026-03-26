"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Precision = "exact" | "month" | "year";

interface CompletionDatePickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    date: string | null,
    precision: "exact" | "month" | "year" | null
  ) => void;
  label?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function buildYears(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current; y >= 1950; y--) {
    years.push(y);
  }
  return years;
}

/** Check if a selected date is in the future */
function isFutureDate(month: number, day: number, year: number, precision: Precision): boolean {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentDay = now.getDate();

  if (year > currentYear) return true;
  if (precision === "year") return false; // current year is fine
  if (year === currentYear && month > currentMonth) return true;
  if (precision === "month") return false; // current month is fine
  if (year === currentYear && month === currentMonth && day + 1 > currentDay) return true;
  return false;
}

// ─── Scroll Wheel ───

function ScrollWheel({
  items,
  selectedIndex,
  onSelect,
  renderItem,
}: {
  items: readonly (string | number)[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem?: (item: string | number, isSelected: boolean) => React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeight = 40;
  const visibleItems = 5;
  const containerHeight = itemHeight * visibleItems;
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isUserScrolling = useRef(false);

  // Scroll to selected on mount and when selectedIndex changes externally
  useEffect(() => {
    if (!containerRef.current || isUserScrolling.current) return;
    const targetScroll = selectedIndex * itemHeight;
    containerRef.current.scrollTop = targetScroll;
  }, [selectedIndex, itemHeight]);

  const handleScroll = useCallback(() => {
    isUserScrolling.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (!containerRef.current) return;
      const scrollTop = containerRef.current.scrollTop;
      const index = Math.round(scrollTop / itemHeight);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
      if (clampedIndex !== selectedIndex) {
        onSelect(clampedIndex);
      }
      // Snap to position
      containerRef.current.scrollTop = clampedIndex * itemHeight;
      isUserScrolling.current = false;
    }, 80);
  }, [items.length, selectedIndex, onSelect, itemHeight]);

  return (
    <div className="relative" style={{ height: containerHeight }}>
      {/* Selection highlight */}
      <div
        className="pointer-events-none absolute left-0 right-0 rounded-lg bg-primary/15 border-y border-primary/20"
        style={{ top: itemHeight * 2, height: itemHeight }}
      />
      {/* Fade top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-surface to-transparent" />
      {/* Fade bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-surface to-transparent" />

      <div
        ref={containerRef}
        className="h-full overflow-y-auto no-scrollbar"
        onScroll={handleScroll}
        style={{
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Top padding — 2 blank items so first real item can be centered */}
        <div style={{ height: itemHeight * 2 }} />
        {items.map((item, i) => {
          const isSelected = i === selectedIndex;
          return (
            <div
              key={`${item}-${i}`}
              className="flex items-center justify-center transition-all duration-150"
              style={{
                height: itemHeight,
                scrollSnapAlign: "center",
              }}
              onClick={() => {
                onSelect(i);
                if (containerRef.current) {
                  containerRef.current.scrollTo({
                    top: i * itemHeight,
                    behavior: "smooth",
                  });
                }
              }}
            >
              {renderItem ? (
                renderItem(item, isSelected)
              ) : (
                <span
                  className={
                    isSelected
                      ? "text-lg font-bold text-foreground"
                      : "text-sm text-muted/60 cursor-pointer"
                  }
                >
                  {item}
                </span>
              )}
            </div>
          );
        })}
        {/* Bottom padding — 2 blank items so last real item can be centered */}
        <div style={{ height: itemHeight * 2 }} />
      </div>
    </div>
  );
}

// ─── Main Component ───

export function CompletionDatePicker({
  open,
  onClose,
  onConfirm,
  label = "When did you finish?",
}: CompletionDatePickerProps) {
  const now = new Date();
  const [precision, setPrecision] = useState<Precision>("month");
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [day, setDay] = useState(now.getDate() - 1); // 0-indexed for array
  const [yearIndex, setYearIndex] = useState(0); // 0 = current year

  const years = buildYears();
  const selectedYear = years[yearIndex];
  const maxDays = getDaysInMonth(month + 1, selectedYear);
  const days = Array.from({ length: maxDays }, (_, i) => i + 1);

  // Clamp day if month/year changed
  useEffect(() => {
    if (day >= maxDays) {
      setDay(maxDays - 1);
    }
  }, [maxDays, day]);

  if (!open) return null;

  const isFuture = isFutureDate(month, day, selectedYear, precision);

  function handleConfirm() {
    if (isFuture) return; // Block future dates
    const y = years[yearIndex];
    const m = String(month + 1).padStart(2, "0");
    const d = String((day < maxDays ? day : maxDays - 1) + 1).padStart(2, "0");

    let dateStr: string;
    if (precision === "exact") {
      dateStr = `${y}-${m}-${d}`;
    } else if (precision === "month") {
      dateStr = `${y}-${m}-01`;
    } else {
      dateStr = `${y}-01-01`;
    }
    onConfirm(dateStr, precision);
  }

  function handleSkip() {
    onConfirm(null, null);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm mb-16 sm:mb-0 rounded-t-2xl sm:rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-2">
          <div>
            <h2 className="text-lg font-bold text-foreground">{label}</h2>
            <p className="text-xs text-muted mt-0.5">
              All selections are optional
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Precision tabs */}
        <div className="flex gap-2 px-5 pb-4">
          {(["exact", "month", "year"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPrecision(p)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                precision === p
                  ? "bg-foreground text-background"
                  : "bg-surface-alt text-muted hover:text-foreground border border-border/50"
              }`}
            >
              {p === "exact"
                ? "Month / Day / Year"
                : p === "month"
                  ? "Month / Year"
                  : "Year"}
            </button>
          ))}
        </div>

        {/* Scroll wheels */}
        <div className="flex justify-center gap-1 px-5 pb-4">
          {(precision === "exact" || precision === "month") && (
            <div className="flex-1 max-w-[140px]">
              <ScrollWheel
                items={MONTHS}
                selectedIndex={month}
                onSelect={setMonth}
              />
            </div>
          )}
          {precision === "exact" && (
            <div className="w-[60px]">
              <ScrollWheel
                items={days}
                selectedIndex={day}
                onSelect={setDay}
              />
            </div>
          )}
          <div className="w-[80px]">
            <ScrollWheel
              items={years}
              selectedIndex={yearIndex}
              onSelect={setYearIndex}
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="px-5 pb-5 space-y-2.5">
          <button
            onClick={handleConfirm}
            disabled={isFuture}
            className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors ${
              isFuture
                ? "bg-foreground/30 text-background/50 cursor-not-allowed"
                : "bg-foreground text-background hover:bg-foreground/90"
            }`}
          >
            {isFuture ? "Date can't be in the future" : "Continue"}
          </button>
          <button
            onClick={handleSkip}
            className="w-full rounded-xl bg-surface-alt border border-border/50 text-muted py-3 text-sm font-medium hover:text-foreground transition-colors"
          >
            I don&apos;t remember
          </button>
        </div>
      </div>
    </div>
  );
}

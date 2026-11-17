"use client";

/**
 * The comfort-level selector, shared by the onboarding wizard and Settings so
 * the two can never drift again (onboarding offered None / Mild / Moderate /
 * Any while Settings also had Significant — Rebekah, 2026-11-16).
 *
 * Levels match the book content-rating intensities 1:1, so a reader can allow
 * Significant without accepting Extreme. "Any" is the no-cap case.
 * Keep the labels and hints in sync with iOS SettingsCatalog.
 */
export const TOLERANCE_LABELS = [
  { value: 0, label: "None" },
  { value: 1, label: "Mild" },
  { value: 2, label: "Moderate" },
  { value: 3, label: "Significant" },
  { value: 4, label: "Any" },
] as const;

export const TOLERANCE_HINTS = [
  "Strictest — flags even a passing mention.",
  "Brief or non-graphic content is okay; more gets flagged.",
  "Recurring but non-graphic content is okay.",
  "Graphic or frequent content is okay — only extremes get flagged.",
  "No limit — this category is never flagged for you.",
];

// The selected segment takes the colour that level has on a book's What's
// Inside bars (Mild blue, Moderate yellow, Significant orange); None is the
// strict red and Any the neutral "nothing filtered".
const SELECTED = [
  "bg-destructive/20 text-destructive",
  "bg-intensity-1/20 text-intensity-1",
  "bg-intensity-2/20 text-intensity-2",
  "bg-intensity-3/20 text-intensity-3",
  "bg-foreground/12 text-foreground",
];

export function ToleranceSelector({
  name,
  value,
  onChange,
}: {
  /** Category name, for the buttons' accessible labels. */
  name: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      {/* Segments are sized by their label (flex-auto), not equally: five
          equal slots cannot hold "Significant" on a phone at the Large text
          size, but the five labels together fit with room to spare. */}
      <div role="radiogroup" aria-label={`${name} comfort level`} className="flex gap-0.5 rounded-full border border-foreground/10 bg-background/40 p-0.5">
        {TOLERANCE_LABELS.map((tl) => (
          <button
            key={tl.value}
            type="button"
            role="radio"
            aria-checked={value === tl.value}
            title={TOLERANCE_HINTS[tl.value]}
            onClick={() => onChange(tl.value)}
            // Font size follows the text-size setting but is capped by the
            // screen width, so "Significant" still fits a 360px phone on Large.
            className={`flex-auto whitespace-nowrap rounded-full px-1 py-1.5 text-center [font-size:clamp(11px,3.3vw,0.75rem)] transition-colors ${
              value === tl.value ? `${SELECTED[tl.value]} font-semibold` : "font-medium text-muted hover:text-foreground"
            }`}
          >
            {tl.label}
          </button>
        ))}
      </div>
      {/* Live hint for the selected level (overshoot guard). */}
      <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted">{TOLERANCE_HINTS[value] ?? TOLERANCE_HINTS[4]}</p>
    </div>
  );
}

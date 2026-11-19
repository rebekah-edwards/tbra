// The shelf plank under a row of covers. It floats NOTICEABLY above the
// bottom of its card, with a soft shadow beneath, so the card reads as a real
// bookshelf (Rebekah, 2026-11-19: "the thick bottom line is supposed to be
// noticeably higher than the bottom of the card"). Never put it flush against
// the card edge — that reads as a dark border, not a shelf.
//
// Rendered inside a card with horizontal padding `px`, it bleeds to the card
// edges with a negative margin. `background` is any CSS background (the
// wordmark gradient for Top Shelf, the shelf's own colour for custom shelves).

export const WORDMARK_LEDGE =
  "linear-gradient(90deg, rgba(163,230,53,0.85), rgba(56,189,248,0.7), rgba(192,132,252,0.75))";

export function ShelfLedge({
  background,
  bleed = "-mx-4",
}: {
  background: string;
  /** Negative margin matching the card's horizontal padding. */
  bleed?: string;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className={`shelf-ledge ${bleed} h-[6px]`}
        style={{ background }}
      />
      <div aria-hidden="true" className="h-3.5" />
    </>
  );
}

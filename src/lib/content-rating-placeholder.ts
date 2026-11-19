/**
 * A content-rating row that says nothing: intensity 0 and either no note or
 * the enrichment pipeline's "No evidence found…" / "No information found…"
 * filler. About 460K of the ~1.1M rows look like this.
 *
 * Book pages hide these rows for everyone except admins (who need them to
 * edit). Hidden on the SERVER, before the props reach the client component,
 * so the filler text is in neither the HTML nor the RSC payload — Google
 * scored pages full of it as thin (2026-11-19).
 *
 * Rows with the filler note but intensity > 0 (~1.4K) stay visible: the bar
 * still carries a real signal.
 *
 * Keep in step with REAL_RATING_SQL in src/lib/seo/core-set.ts.
 */
export function isPlaceholderRating(r: { intensity: number; notes: string | null }): boolean {
  if (r.intensity > 0) return false;
  const note = r.notes?.trim() ?? "";
  return note === "" || note.startsWith("No evidence found") || note.startsWith("No information found");
}

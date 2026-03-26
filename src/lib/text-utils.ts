/**
 * Strip HTML tags from a string, returning plain text.
 * Spoiler-tagged content is replaced with [spoiler] to avoid leaking hidden text.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<span[^>]*data-spoiler="true"[^>]*>[\s\S]*?<\/span>/gi, "[spoiler]")
    .replace(/<span[^>]*class="spoiler-tag"[^>]*>[\s\S]*?<\/span>/gi, "[spoiler]")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format a rating for display.
 * Uses 2 decimal places for quarter-star ratings (.25, .75),
 * 1 decimal place for half-star (.5, .0).
 */
export function formatRating(rating: number): string {
  const frac = rating % 1;
  if (Math.abs(frac - 0.25) < 0.01 || Math.abs(frac - 0.75) < 0.01) {
    return rating.toFixed(2);
  }
  return rating.toFixed(1);
}

/**
 * Truncate text to a max length, breaking at word boundaries.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength).replace(/\s+\S*$/, "");
  return truncated + "\u2026";
}

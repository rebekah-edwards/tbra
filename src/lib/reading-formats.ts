/**
 * Safe parser for the JSON-array format columns
 * (`user_book_state.owned_formats` / `active_formats`,
 *  `reading_sessions.active_formats`).
 *
 * These columns are *supposed* to hold a JSON array like `["paperback"]`, but
 * legacy/imported rows have been observed storing a bare format string
 * (e.g. `paperback`) which is NOT valid JSON. A raw `JSON.parse("paperback")`
 * throws a SyntaxError, and because these columns are read during the book
 * page's server render (`getBookSessionData` → `parseSession`), a single bad
 * row took down the entire page with "Something went wrong".
 *
 * This helper never throws. It returns a clean `string[]` for every input:
 *   null / undefined / ""        → []
 *   '["paperback","ebook"]'      → ["paperback","ebook"]
 *   '"paperback"' (JSON scalar)  → ["paperback"]
 *   'paperback'   (bare string)  → ["paperback"]   ← recovered, not dropped
 *   anything else                → []
 */
export function parseFormats(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((f): f is string => typeof f === "string");
    }
    if (typeof parsed === "string" && parsed.length > 0) {
      return [parsed];
    }
    return [];
  } catch {
    // Not valid JSON — most commonly a bare format string written by an older
    // code path (e.g. "paperback"). Recover it as a single-element array so the
    // user's format record isn't silently lost.
    const trimmed = raw.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
}

/**
 * Book title validation — filters junk entries before they enter the database.
 * Called during import, enrichment, and manual book creation.
 */

// Titles matching these patterns should be rejected or auto-hidden
const JUNK_TITLE_PATTERNS = [
  // Audiobook splits
  /,?\s*Part \d+ of \d+/i,
  /\bUnabridged \d/i,

  // Individual study guide sessions
  /,\s*Session \d+$/i,

  // Untitled placeholders
  /^Untitled\s+\w+\s+\d+\s+Of\s+\d+/i,

  // Print edition metadata in title
  /\b(?:First|Second|Third)\s+Printing\b/i,

  // Empty/placeholder titles
  /^(?:books?|unknown|untitled|test)$/i,
];

// Titles matching these should be cleaned (parenthetical stripped) not rejected
const CLEAN_TITLE_PATTERNS = [
  // Series info in parentheses: "Golden Son (Red Rising Saga, #2)"
  /\s*\([^)]*#\d+[^)]*\)\s*$/,
  // "Book N" suffix in parens: "Title (Series Name Book 3)"
  /\s*\([^)]*Book \d+[^)]*\)\s*$/,
];

/**
 * Check if a title should be rejected entirely (not imported).
 * Returns the rejection reason, or null if the title is acceptable.
 */
export function shouldRejectTitle(title: string): string | null {
  if (!title || title.trim().length < 2) return "empty title";

  for (const pattern of JUNK_TITLE_PATTERNS) {
    if (pattern.test(title)) return `matches junk pattern: ${pattern.source}`;
  }

  return null;
}

/**
 * Clean a title by stripping series parentheticals.
 * Returns the cleaned title, or the original if no cleaning needed.
 */
export function cleanTitle(title: string): string {
  let cleaned = title;
  for (const pattern of CLEAN_TITLE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }
  return cleaned || title;
}

/**
 * Validate and optionally clean a book title before insertion.
 * Returns { ok: true, title } for acceptable titles (possibly cleaned),
 * or { ok: false, reason } for rejected titles.
 */
export function validateBookTitle(title: string): { ok: true; title: string } | { ok: false; reason: string } {
  const rejection = shouldRejectTitle(title);
  if (rejection) return { ok: false, reason: rejection };

  const cleaned = cleanTitle(title);
  return { ok: true, title: cleaned };
}

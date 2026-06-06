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

// Titles matching these should be cleaned (suffix stripped) not rejected.
// Order matters — more specific patterns first, broader catch-alls last.
const CLEAN_TITLE_PATTERNS: { pattern: RegExp; replacement?: string }[] = [
  // Author + ISBN catalog scrape: "Title: Author, Name: 9781234567890"
  { pattern: /:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:,\s+[A-Z]\.?[A-Z]?\.?)?:\s+978\d{10}\s*$/ },

  // Series info in parentheses: "Golden Son (Red Rising Saga, #2)"
  { pattern: /\s*\([^)]*#\d+(?:\.\d+)?[^)]*\)\s*$/ },

  // "Book N" suffix in parens: "A Reaper at the Gates (An Ember in the Ashes Book 3)"
  { pattern: /\s*\([^)]*\bBook\s+\d+[^)]*\)\s*$/i },

  // "(Volume N)" in parens: "Eidolon (Wraith Kings) (Volume 2)"
  { pattern: /\s*\(Volume\s+\d+(?:\s+of\s+\d+)?\)\s*$/i },

  // Genre descriptor in parens: "(a Virgil Flowers Novel)", "(A Graphic Novel)"
  { pattern: /\s*\([Aa]n?\s+[A-Z][A-Za-z\s']+\bNovel\)\s*$/ },

  // Edition/format in parens (from sanitize.ts — keep in sync)
  { pattern: /\s*\((?:Paperback|Hardcover|Kindle Edition|Mass Market Paperback|Library Binding|Board Book|Audio CD|MP3 CD|Graphic Novel)\)\s*$/i },
  { pattern: /\s*\((?:Collector'?s? Edition|Deluxe Edition|Anniversary Edition|Movie Tie-[Ii]n|Special Edition|Illustrated Edition|International Edition|Signed Edition|Limited Edition|Expanded Edition|Revised Edition|Updated Edition|Unabridged|Abridged|Large Print|New Edition)\)\s*$/i },

  // Trailing ": A Novel" only (not Memoir — often part of the real title)
  { pattern: /\s*[:–—-]\s*A\s+Novel\s*$/i },

  // Trailing ", Book N" without parens: "Arctic Drift: Dirk Pitt Adventures, Book 20"
  { pattern: /,\s+Book\s+(?:\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\s*$/i },

  // Trailing ": (a Graphic Novel)" colon-paren combo
  { pattern: /\s*:\s*\([Aa]n?\s+Graphic Novel\)\s*$/ },

  // "12-Copy Solid Floor Display" and similar retail suffixes
  { pattern: /\s+\d+-Copy\s+.*$/i },
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
  for (const { pattern, replacement } of CLEAN_TITLE_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement ?? "").trim();
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

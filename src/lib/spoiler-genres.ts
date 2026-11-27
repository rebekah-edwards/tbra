/**
 * Spoiler-sensitive genre tags.
 *
 * For some novels the tag itself gives the book away — knowing up front that
 * the narrator is unreliable is the twist. These tags stay in the catalog
 * (`genres` / `book_genres` are untouched; there is no schema flag), but they
 * are never shown or emitted alongside a book by default:
 *
 *   - the book page hides them behind a tap-to-reveal pill in the genre row;
 *   - every other surface that lists a book's genres — library/shelf rows,
 *     recommendation reasons, stats, and the /api/v1 payloads the native app
 *     reads — leaves them out entirely;
 *   - the v1 book-detail payload carries them separately as `spoilerGenres`
 *     so a client can build its own reveal.
 *
 * This file is the ONLY list. To make another tag spoiler-sensitive, add its
 * name here; matching is case- and whitespace-insensitive.
 */
export const SPOILER_GENRE_NAMES: readonly string[] = [
  "Unreliable Narrator",
  // Spellings of the same tag that enrichment could mint as separate rows.
  "Unreliable Narrators",
  "Unreliable Narration",
];

function normalizeGenreName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Lower-cased names, for SQL `LOWER(g.name) NOT IN (...)` filters. */
export const SPOILER_GENRE_NAMES_LOWER: readonly string[] =
  SPOILER_GENRE_NAMES.map(normalizeGenreName);

const SPOILER_GENRE_SET = new Set(SPOILER_GENRE_NAMES_LOWER);

export function isSpoilerGenre(name: string | null | undefined): boolean {
  return !!name && SPOILER_GENRE_SET.has(normalizeGenreName(name));
}

/**
 * Split a book's genre names into the ones safe to show and the
 * spoiler-sensitive ones. Order is preserved within each list.
 */
export function splitSpoilerGenres(names: readonly string[]): {
  visible: string[];
  spoiler: string[];
} {
  const visible: string[] = [];
  const spoiler: string[] = [];
  for (const name of names) {
    (isSpoilerGenre(name) ? spoiler : visible).push(name);
  }
  return { visible, spoiler };
}

/** Convenience: just the names that are safe to show. */
export function withoutSpoilerGenres(names: readonly string[]): string[] {
  return names.filter((name) => !isSpoilerGenre(name));
}

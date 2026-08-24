/**
 * Where a book title stops being the title and starts being a subtitle,
 * edition marker, or series decoration.
 *
 * THE HYPHEN RULE: a hyphen only separates when it is SPACED (" - ").
 * The original pattern put a bare `-` in the character class, which truncated
 * at the first hyphen anywhere in the title — so "New X-Men Modern Era Epic
 * Collection: E Is for Extinction" normalized to "newx", and every same-author
 * "New X-…" title collapsed onto the same key. Measured against the live
 * catalog on 2026-08-24 (scripts/dryrun-dedup-hyphen-regex.ts, 125,306 books),
 * that was merging 391 groups of genuinely different books, the worst being
 * FOURTEEN distinct Ultimate Spider-Man volumes treated as one. Users adding
 * volume 2 of a series were silently shelved with volume 1.
 *
 * Intra-word hyphens are extremely common in real titles — Spider-Man, X-Men,
 * Tell-Tale, Kool-Aid, Small-Town, Cul-de-Sac — and they are part of the name,
 * never a subtitle boundary.
 *
 * KNOWN REMAINING LIMITATION: volume numbers and distinct subtitles under a
 * shared stem still collapse ("Collection: E Is for Extinction" and
 * "Collection: Riot at Xavier's" both reduce to "collection"). That is a
 * separate unsolved problem — see docs/handoff-app-bug-backlog.md §6.
 */
export const SUBTITLE_SEPARATOR = /\s*(?:[:–—([\/{]|\s-\s)\s*.*$/;

/** Strip a subtitle / edition suffix from a title. */
export function stripSubtitle(title: string): string {
  return title.replace(SUBTITLE_SEPARATOR, "");
}

/**
 * Separators that introduce a DISTINGUISHING subtitle — a different volume or
 * entry, not a different printing of the same book.
 *
 * Deliberately excludes `(`, `[`, `/` and `{`: parenthetical suffixes almost
 * always carry edition or series annotation — "(TruTone, Blush Rose, Floral
 * Bloom Design)", "(Grovehill Giants Book 3)", "(Charlotte Bronte Classics
 * Collection)" — and treating those as distinguishing splits genuine editions
 * of one book into duplicates. Measured 2026-08-24: including parentheses
 * split 672 same-author groups with visible false splits (three bindings of
 * the ESV Women's Study Bible); restricting to colon/dash gives 409, and the
 * sampled groups are all genuinely different products.
 */
const DISTINGUISHING_SEPARATOR = /\s*(?:[:–—]|\s-\s)\s*/;

/** Words that carry no distinguishing information in a subtitle. */
const SUFFIX_NOISE =
  /\b(a novel|the novel|a memoir|a story|a mystery|a thriller|novel|memoir|paperback|hardcover|kindle|edition|large print|spanish|special|unabridged|abridged|annotated|illustrated|classic|classics|global|dyslexia[- ]friendly|book|vol|volume)\b/gi;

/** The meaningful remainder after a distinguishing separator, or "". */
export function titleSuffix(title: string): string {
  const parts = title.split(DISTINGUISHING_SEPARATOR);
  if (parts.length < 2) return "";
  return parts.slice(1).join(" ")
    .replace(SUFFIX_NOISE, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * True when two titles sharing a normalized stem are nonetheless DIFFERENT
 * books, because each carries its own distinct subtitle.
 *
 * This is what stops "…Modern Era Epic Collection: E Is for Extinction" from
 * matching "…Modern Era Epic Collection: New Worlds" — both truncate to the
 * same stem, and before this a user adding volume 2 was silently shelved with
 * volume 1 (reported 2026-08-22).
 *
 * If either side has no meaningful suffix the titles still match, so
 * "Jane Eyre" ←→ "Jane Eyre : (Charlotte Bronte Classics Collection)" keeps
 * collapsing as it always has.
 */
export function suffixesConflict(a: string, b: string): boolean {
  const sa = titleSuffix(a);
  const sb = titleSuffix(b);
  return sa !== "" && sb !== "" && sa !== sb;
}

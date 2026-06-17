/**
 * Shared "is this book worth enriching?" classifier.
 *
 * One source of truth used by BOTH:
 *   - the hide-cleanup (scripts/hide-junk-discovery.ts) — removes the OpenLibrary
 *     discovery flood (no-metadata skeletons, non-English works, box sets) from
 *     the public catalog, and
 *   - the enrichment gate — so we never spend Brave calls on a book that is junk,
 *     a box set, or non-English.
 *
 * The classifier is PURE (no DB/network). Duplicate detection needs catalog
 * context and is done by the caller; this module exposes everything else.
 *
 * Policy note: a "skeleton" (no ISBN + no description + no year) is a reason to
 * HIDE a zero-demand discovery import, but NOT a reason to refuse to enrich a
 * book a user put on their shelf — there, Brave is exactly what fills the blanks.
 * So callers combine these flags with demand/visibility signals themselves.
 */

import { isJunkTitle } from "../openlibrary";

export interface ClassifyInput {
  title: string;
  isbn13?: string | null;
  isbn10?: string | null;
  asin?: string | null;
  description?: string | null;
  summary?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  isBoxSet?: boolean | null;
}

export interface Classification {
  /** Title matches a box-set / study-guide / non-book-edition pattern. */
  junkOrBoxSet: boolean;
  /** Title is very likely non-English. */
  nonEnglish: boolean;
  /** No ISBN-13/10/ASIN at all. */
  noIsbn: boolean;
  /** No usable description or summary. */
  noDescription: boolean;
  /** No ISBN AND no description AND no publication year — a bare stub. */
  skeleton: boolean;
  /**
   * True when the book is something we never want in the public catalog and
   * should never spend Brave on regardless of demand (junk/box-set/non-English).
   */
  clearlyUnwanted: boolean;
  /** Has at least one piece of real metadata (ISBN, description, or year). */
  hasUsableMetadata: boolean;
  /** Human-readable reason for the dominant classification (for logging). */
  reason: string;
}

/**
 * Heuristic non-English detection from the title alone (we usually have no
 * reliable `language` field on discovery imports).
 *
 * 1. An explicit non-English `language` value is authoritative.
 * 2. Otherwise, count letters: if a meaningful share of the title's letters are
 *    non-ASCII (Hebrew, Japanese, Cyrillic, Arabic, or Latin-with-heavy-
 *    diacritics like transliterated Arabic/Hebrew), treat it as non-English.
 *
 * This deliberately does NOT try to catch clean Latin-script foreign titles
 * (French/German/Spanish without diacritics) — that needs real language ID and
 * would risk false positives on English titles. The skeleton + no-demand rules
 * catch most of those anyway.
 */
export function isLikelyNonEnglish(title: string, language?: string | null): boolean {
  if (language) {
    const lang = language.trim().toLowerCase();
    const englishMarkers = ["en", "eng", "english"];
    if (lang && !englishMarkers.includes(lang)) return true;
  }

  const letters = title.replace(/[^\p{L}]/gu, "");
  if (letters.length === 0) return false;
  const ascii = title.replace(/[^a-zA-Z]/g, "");
  const nonAsciiLetters = letters.length - ascii.length;
  // Any CJK / Hebrew / Cyrillic / Arabic block present → clearly non-English.
  if (/[\p{Script=Han}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}]/u.test(title)) {
    return true;
  }
  // Heavy diacritics (transliteration) — >25% of letters are non-ASCII.
  return nonAsciiLetters / letters.length > 0.25;
}

function hasText(v?: string | null, min = 1): boolean {
  return !!v && v.trim().length >= min;
}

export function classifyBook(book: ClassifyInput): Classification {
  const junkOrBoxSet = !!book.isBoxSet || isJunkTitle(book.title);
  const nonEnglish = isLikelyNonEnglish(book.title, book.language);

  const noIsbn = !hasText(book.isbn13) && !hasText(book.isbn10) && !hasText(book.asin);
  const noDescription = !hasText(book.description, 30) && !hasText(book.summary, 30);
  const skeleton = noIsbn && noDescription && book.publicationYear == null;

  const hasUsableMetadata = !noIsbn || !noDescription || book.publicationYear != null;
  const clearlyUnwanted = junkOrBoxSet || nonEnglish;

  let reason = "ok";
  if (nonEnglish) reason = "non-english";
  else if (junkOrBoxSet) reason = "junk/box-set";
  else if (skeleton) reason = "skeleton (no isbn/desc/year)";
  else if (noDescription && noIsbn) reason = "no isbn + no description";

  return {
    junkOrBoxSet,
    nonEnglish,
    noIsbn,
    noDescription,
    skeleton,
    clearlyUnwanted,
    hasUsableMetadata,
    reason,
  };
}

/**
 * Gate for the enrichment path: may we spend Brave calls enriching this book?
 * We refuse only for things that are never worth it (junk/box-set/non-English).
 * A bare skeleton on a user's shelf IS enrichable — that's the whole point.
 */
export function isEnrichable(book: ClassifyInput): boolean {
  return !classifyBook(book).clearlyUnwanted;
}

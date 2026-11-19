/**
 * "Search within my own library" — a pure in-memory filter over books the
 * page has already loaded. No network, no catalog search, no ISBNdb.
 *
 * Matching rule (mirrored line-for-line by native-ios/LibraryView.swift —
 * keep the two in step):
 *   1. Fold both sides: lowercase, strip diacritics, drop apostrophes and
 *      periods, turn every other run of punctuation into a single space.
 *   2. Split the query on spaces. A book matches when EVERY word appears
 *      somewhere in its title + authors + series names, so "sanderson
 *      mistborn" finds the book even though no single field holds both.
 *   3. Author initials match however they are typed or stored: the catalog
 *      has both "A.A. Fairview" and "A. A. Milne", and readers type "aa
 *      milne", "a a milne" and "a.a. milne" interchangeably.
 */

/** Letters NFKD leaves intact but a reader would still type as plain ASCII
 *  ("Jo Nesbo" must find "Jo Nesbø"). Final sigma is here because lowercasing
 *  "ΟΔΥΣΣΕΥΣ" yields "ς" where a typed "σ" would not match. */
const SPECIAL_FOLDS: Record<string, string> = {
  "ø": "o",
  "đ": "d",
  "ð": "d",
  "ł": "l",
  "ı": "i",
  "ß": "ss",
  "æ": "ae",
  "œ": "oe",
  "þ": "th",
  "ς": "σ",
};

export function foldForSearch(input: string): string {
  return input
    // NFKD first: it can itself produce capitals ("№" → "No", "𝒜" → "A").
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[øđðłıßæœþς]/g, (c) => SPECIAL_FOLDS[c] ?? c)
    .replace(/['’‘`.]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface LibrarySearchable {
  title: string;
  authors: string[];
  seriesNames?: string[];
}

/** The folded text a query is matched against. Build once per book and
 *  cache — it only changes when the book list does, not per keystroke. */
export function librarySearchText(book: LibrarySearchable): string {
  const folded = foldForSearch(
    [book.title, ...book.authors, ...(book.seriesNames ?? [])].join(" ")
  );
  // "a a milne" also gets "aa" appended, so the run-together spelling hits.
  // (The spaced spelling of "aa milne" already matches word by word.)
  const initials: string[] = [];
  let run = "";
  for (const word of folded.split(" ")) {
    if (word.length === 1) {
      run += word;
    } else {
      if (run.length > 1) initials.push(run);
      run = "";
    }
  }
  if (run.length > 1) initials.push(run);
  return initials.length > 0 ? `${folded} ${initials.join(" ")}` : folded;
}

/** Folded query words; empty when the query is blank or punctuation-only. */
export function librarySearchTokens(query: string): string[] {
  const folded = foldForSearch(query);
  return folded ? folded.split(" ") : [];
}

export function matchesLibrarySearch(searchText: string, tokens: string[]): boolean {
  for (const token of tokens) {
    if (!searchText.includes(token)) return false;
  }
  return true;
}

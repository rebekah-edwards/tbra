/**
 * Exact-release-date recovery for forthcoming titles.
 *
 * WHY: Google Books frequently returns only YEAR precision for a not-yet-published
 * volume ("publishedDate": "2027"). `normalizePubDate` correctly refuses to
 * fabricate a day for that, so the book lands with `publication_date = NULL` and
 * only a year. That is fine for a FUTURE year — `isBookPrePublication()` falls
 * back to `publicationYear > currentYear` — but it breaks in two places:
 *   1. a year-only volume in the CURRENT year is not flagged as a preorder at
 *      all (2026 is not > 2026), so a title releasing in three months looks
 *      already-published;
 *   2. nothing can sort or count down to a release with no date.
 * Retailer/publisher listing pages carry the exact date, so one web search
 * recovers it. Observed live on 2026-08-14: "True Happiness" (Crossway,
 * 9781433558658) came back year-only from Google and the first Brave result
 * gave "Release Date: 30 March 2027".
 *
 * CORROBORATION IS MANDATORY. A bare `q=<title> release date` will happily
 * return a *different* book with the same name (there are at least six
 * unrelated "True Happiness" titles in the wild). A result is only trusted when
 * it quotes the ISBN, or when BOTH the title and the author's surname appear in
 * it. The recovered year must also match the year we already have, so a search
 * that drifts to another edition can't move the book off its release window.
 *
 * BUDGET: one Brave call per book, and callers are expected to cap how many
 * books per run get this treatment (see UPCOMING_DATE_LOOKUP_MAX). Brave's own
 * budget guard still applies underneath — an exhausted cap throws API_EXHAUSTED,
 * which callers should treat as "stop asking for the rest of this run" rather
 * than as a per-book failure.
 */

import { braveSearch } from "./search";
import { normalizePubDate } from "../publication-date";

// Full names plus the abbreviations retailers actually print ("Sept. 1, 2026",
// "4 Nov 2026"). Longest-first so the alternation can't match "jun" out of "june".
const MONTHS =
  "january|february|march|april|june|july|august|september|october|november|december|" +
  "jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec";

/** Label that must precede a date for it to count as a *release* date. */
const LABEL = /(?:release|publication|published|pub(?:lish)?)\s*(?:date)?\s*[:\-–]?\s*/i;

/**
 * Pull candidate release dates out of one blob of result text. Returns ISO
 * `YYYY-MM-DD` strings in the order found.
 *
 * Three shapes cover essentially every retailer listing:
 *   "Release Date: 30 March 2027"      (day month year)
 *   "Publication date: March 30, 2027" (month day year)
 *   "Published: 2027-03-30"            (ISO)
 * The label prefix is what keeps us off unrelated dates in the same snippet
 * (review dates, "as of", copyright years).
 */
export function extractReleaseDates(text: string): string[] {
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const out: string[] = [];

  const patterns = [
    new RegExp(LABEL.source + `(\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4})`, "gi"),
    new RegExp(LABEL.source + `((?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4})`, "gi"),
    new RegExp(LABEL.source + `(\\d{4}-\\d{2}-\\d{2})`, "gi"),
  ];

  for (const re of patterns) {
    for (const m of clean.matchAll(re)) {
      const norm = normalizePubDate(m[1]);
      // Only day precision is useful here — recovering "March 2027" would just
      // reintroduce the fabricated-day problem this function exists to avoid.
      if (norm.precision === "day" && norm.date) out.push(norm.date);
    }
  }
  return out;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Longest word in the author's name — a usable surname proxy for "Nicole Whitacre" / "Dr. Nicole LePera". */
function surname(author: string): string | null {
  const parts = norm(author).split(" ").filter((w) => w.length > 2);
  if (!parts.length) return null;
  return parts.reduce((a, b) => (b.length >= a.length ? b : a));
}

/**
 * Does this result plausibly describe OUR book? Either it quotes the ISBN, or
 * it names both the title and the author.
 */
function corroborates(
  hay: string,
  title: string,
  author: string | null,
  isbn13: string | null,
  isbn10: string | null,
): boolean {
  const raw = hay.replace(/[^0-9a-zA-Z]/g, "");
  if (isbn13 && raw.includes(isbn13)) return true;
  if (isbn10 && raw.includes(isbn10)) return true;

  const n = norm(hay);
  const t = norm(title);
  if (!t || !n.includes(t)) return false;

  const sn = author ? surname(author) : null;
  return sn ? n.includes(sn) : false;
}

/**
 * Recover an exact release date for a forthcoming book via one web search.
 *
 * @param expectYear the year we already believe the book releases in; a
 *   recovered date from a different year is discarded as a wrong-edition match.
 * @returns ISO `YYYY-MM-DD`, or null when nothing corroborated.
 * @throws whatever `braveSearch` throws (API_EXHAUSTED / API_KEY_INVALID) —
 *   deliberately NOT swallowed, so a caller can stop the whole run's lookups.
 */
export async function findReleaseDateViaBrave(
  title: string,
  author: string | null,
  isbn13: string | null,
  isbn10: string | null,
  expectYear: number,
): Promise<string | null> {
  const parts = [`"${title}"`];
  if (author) parts.push(author);
  if (isbn13) parts.push(isbn13);
  parts.push("release date");

  const results = await braveSearch(parts.join(" "), 10);

  for (const r of results) {
    const hay = `${r.title} ${r.description}`;
    if (!corroborates(hay, title, author, isbn13, isbn10)) continue;
    for (const date of extractReleaseDates(hay)) {
      if (Number(date.slice(0, 4)) === expectYear) return date;
    }
  }
  return null;
}

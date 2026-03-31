/**
 * Shared sanitization utilities for book data quality.
 * Used by both the healing pass (existing data) and the import pipeline (new data).
 */

// ── Description Sanitization ──

/** Strip HTML tags, markdown links, and bare URLs from a description. Preserves full text length. */
export function sanitizeDescription(raw: string): string {
  let text = raw;

  // Strip HTML tags (e.g., <b>bold</b> → bold, <a href="...">link</a> → link)
  text = text.replace(/<[^>]+>/g, "");

  // Strip markdown links: [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip bare URLs
  text = text.replace(/https?:\/\/[^\s)<]+/g, "");

  // Collapse multiple spaces/newlines
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return text;
}

// ── Title Normalization ──

const JUNK_TITLE_SUFFIXES = [
  /\s*\((?:Paperback|Hardcover|Kindle Edition|Mass Market Paperback|Library Binding|Board Book|Audio CD|MP3 CD)\)\s*$/i,
  /\s*\((?:Collector'?s? Edition|Deluxe Edition|Anniversary Edition|Movie Tie-[Ii]n|Special Edition|Illustrated Edition|International Edition|Signed Edition|B&N Exclusive Edition|Limited Edition|Expanded Edition|Revised Edition|Updated Edition|Unabridged|Abridged|Large Print|Large Type|New Edition|(?:\d+(?:st|nd|rd|th)\s+Anniversary\s+)?Edition)\)\s*$/i,
  /\s*[-–—]\s*(?:A Novel|A Memoir|A Thriller|A Mystery|A Romance)\s*$/i,
  // Strip series name in parentheses at end of title, e.g. "Defy Me (Shatter Me)" → "Defy Me"
  // Matches: (Series Name), (Series Name, #5), (The Series Name Book 3)
  /\s*\([A-Z][A-Za-z\s']+(?:,?\s*(?:#|Book |Vol\.? )?\d+)?\)\s*$/,
];

const JUNK_TITLE_PATTERNS = [
  /^(?:SparkNotes|CliffsNotes|Barron'?s|Shmoop)\s/i,
  /\bStudy Guide\b/i,
  /\bColoring Book\b/i,
  /\bWorkbook\b/i,
  /\bTeacher'?s? (?:Guide|Edition|Manual)\b/i,
];

// Words that should stay lowercase in title case (unless first word)
const TITLE_SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
  "at", "by", "in", "of", "on", "to", "up", "as", "is", "if", "it",
  "vs", "vs.", "via", "from", "into", "with", "than",
  "de", "del", "la", "el", "le", "les", "du", "des", "un", "une", "et", "ou",
  "y", "e", "o", "al", "las", "los", "das", "dos", "van", "von",
]);

// Words/acronyms that should keep specific casing
const PRESERVE_CASE: Record<string, string> = {
  "ii": "II", "iii": "III", "iv": "IV", "vi": "VI", "vii": "VII",
  "viii": "VIII", "ix": "IX", "xi": "XI", "xii": "XII", "xiii": "XIII",
  "xiv": "XIV", "xv": "XV", "xvi": "XVI", "xx": "XX", "xxi": "XXI",
  "usa": "USA", "uk": "UK", "fbi": "FBI", "cia": "CIA", "dna": "DNA",
  "nyc": "NYC", "tv": "TV", "dj": "DJ", "ai": "AI", "diy": "DIY",
  "pb": "PB", "hc": "HC", "wwjd": "WWJD", "adhd": "ADHD", "ptsd": "PTSD",
  "s.h.i.e.l.d.": "S.H.I.E.L.D.", "d.c.": "D.C.", "a.d.": "A.D.", "b.c.": "B.C.",
  "phd": "PhD", "jr.": "Jr.", "sr.": "Sr.", "dr.": "Dr.", "ok": "OK",
};

function titleCaseWord(word: string, isFirst: boolean): string {
  const lower = word.toLowerCase();

  // Check preserved casing
  if (PRESERVE_CASE[lower]) return PRESERVE_CASE[lower];

  // Roman numerals (standalone, up to 6 chars)
  if (/^[ivxlc]+$/i.test(word) && word.length <= 6 && word.length > 1) {
    return word.toUpperCase();
  }

  // Small words stay lowercase (unless first word)
  if (!isFirst && TITLE_SMALL_WORDS.has(lower)) return lower;

  // Handle hyphenated words (e.g., "Tie-In")
  if (word.includes("-")) {
    return word.split("-").map((p, i) => titleCaseWord(p, i === 0 && isFirst)).join("-");
  }

  // Handle apostrophes (O'Malley, don't)
  if (word.includes("'") && word.length > 2) {
    const idx = word.indexOf("'");
    if (idx === 1) return word[0].toUpperCase() + "'" + word.slice(idx + 1, idx + 2).toUpperCase() + word.slice(idx + 2).toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  return word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

function needsTitleCasing(title: string): boolean {
  // Get ASCII alpha characters only
  const asciiAlpha = title.replace(/[^a-zA-Z]/g, "");
  if (asciiAlpha.length <= 3) return false;

  // All caps
  if (asciiAlpha === asciiAlpha.toUpperCase()) return true;

  // All lowercase
  if (asciiAlpha === asciiAlpha.toLowerCase()) return true;

  return false;
}

function smartTitleCase(title: string): string {
  const parts = title.split(/(\s+)/);
  let wordIdx = 0;

  return parts.map((part) => {
    if (/^\s+$/.test(part)) return " "; // normalize whitespace
    const result = titleCaseWord(part, wordIdx === 0);
    wordIdx++;
    return result;
  }).join("");
}

/** Normalize a book title: strip edition markers, fix capitalization. */
export function normalizeTitle(title: string): string {
  let cleaned = title.trim();

  // Strip junk suffixes
  for (const pattern of JUNK_TITLE_SUFFIXES) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Apply smart title casing if the title is ALL CAPS or all lowercase
  if (needsTitleCasing(cleaned)) {
    // Skip non-Latin titles
    const nonLatin = cleaned.replace(/[\x00-\x7F]/g, "").replace(/[^\p{L}]/gu, "").length;
    const latin = cleaned.replace(/[^a-zA-Z]/g, "").length;
    if (latin >= nonLatin) {
      cleaned = smartTitleCase(cleaned);
    }
  }

  return cleaned.trim();
}

/** Check if a title is a junk entry that should be deleted entirely. */
export function isJunkEntry(title: string): boolean {
  return JUNK_TITLE_PATTERNS.some((p) => p.test(title));
}

// ── Genre Normalization ──

const MINOR_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "for", "nor",
  "on", "at", "to", "from", "by", "of", "in", "vs",
]);

/** Genres with non-standard capitalization that must be preserved. */
const GENRE_CAPS: Record<string, string> = {
  litrpg: "LitRPG",
  lgbtq: "LGBTQ",
  "lgbtq+": "LGBTQ+",
  ya: "YA",
};

/** Title-case a genre name. First word always capitalized; minor words stay lowercase. */
export function titleCaseGenre(name: string): string {
  // Check for exact override first
  const override = GENRE_CAPS[name.toLowerCase()];
  if (override) return override;

  return name
    .split(/([- ])/)
    .map((word, i) => {
      if (word === " " || word === "-") return word;
      // Check per-word overrides
      const wordOverride = GENRE_CAPS[word.toLowerCase()];
      if (wordOverride) return wordOverride;
      if (i === 0 || !MINOR_WORDS.has(word.toLowerCase())) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word.toLowerCase();
    })
    .join("");
}

// ── Language Detection (simple heuristic) ──

// Common non-English character patterns
const NON_ENGLISH_PATTERNS = [
  /[\u00C0-\u00FF]{3,}/, // clusters of accented Latin chars (French, Spanish, German)
  /[\u0400-\u04FF]/, // Cyrillic
  /[\u4E00-\u9FFF]/, // CJK
  /[\u3040-\u30FF]/, // Japanese
  /[\uAC00-\uD7AF]/, // Korean
  /[\u0600-\u06FF]/, // Arabic
  /[\u0900-\u097F]/, // Hindi/Devanagari
];

/** Simple heuristic: check if text looks non-English based on character patterns. */
export function looksNonEnglish(text: string): boolean {
  // Check first 300 chars
  const sample = text.slice(0, 300);
  return NON_ENGLISH_PATTERNS.some((p) => p.test(sample));
}

// ── Summary Validation ──

/** Truncate a summary to fit within maxChars at a clean sentence boundary. */
export function truncateSummary(summary: string, maxChars = 190): string {
  if (summary.length <= maxChars) return summary;

  // Strategy 1: Find the last complete sentence that fits.
  // Walk through all sentence-ending positions in the full text.
  const sentenceEndRegex = /[.!?](?:\s|$)/g;
  let bestEnd = -1;
  let match;
  while ((match = sentenceEndRegex.exec(summary)) !== null) {
    const endPos = match.index + 1; // include the punctuation
    if (endPos <= maxChars && endPos > 60) {
      bestEnd = endPos;
    }
    if (match.index > maxChars) break; // no point searching further
  }

  if (bestEnd > 60) {
    return summary.slice(0, bestEnd).trimEnd();
  }

  // Strategy 2: Keep only the first sentence from the full text
  const firstSentenceMatch = summary.match(/^[^.!?]+[.!?]/);
  if (firstSentenceMatch && firstSentenceMatch[0].length <= maxChars) {
    return firstSentenceMatch[0];
  }

  // Strategy 3: Find the last comma/semicolon boundary (better than mid-word)
  const sliced = summary.slice(0, maxChars);
  const lastComma = Math.max(sliced.lastIndexOf(", "), sliced.lastIndexOf("; "));
  if (lastComma > 60) {
    return sliced.slice(0, lastComma + 1).trimEnd();
  }

  // Absolute fallback: truncate at last word boundary, add ellipsis
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > 60) {
    return sliced.slice(0, lastSpace).replace(/[,;:\-–—]$/, "").trimEnd() + "…";
  }
  return sliced.slice(0, maxChars - 1).trimEnd() + "…";
}

// ── Publication Date Normalization ──

const MONTHS_MAP: Record<string, string> = {
  january: '01', jan: '01', february: '02', feb: '02',
  march: '03', mar: '03', april: '04', apr: '04',
  may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09',
  october: '10', oct: '10', november: '11', nov: '11',
  december: '12', dec: '12',
};

/** Normalize OL/publisher date strings to ISO-ish format */
export function normalizePublicationDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = dateStr.trim();

  // "January 15, 2020" or "January 15 2020"
  const fullUS = d.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullUS) {
    const m = MONTHS_MAP[fullUS[1].toLowerCase()];
    if (m) return `${fullUS[3]}-${m}-${fullUS[2].padStart(2, '0')}`;
  }

  // "15 January 2020" (UK format)
  const fullUK = d.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (fullUK) {
    const m = MONTHS_MAP[fullUK[2].toLowerCase()];
    if (m) return `${fullUK[3]}-${m}-${fullUK[1].padStart(2, '0')}`;
  }

  // "Mar 2020" or "March 2020"
  const monthYear = d.match(/^(\w+)\s+(\d{4})$/);
  if (monthYear) {
    const m = MONTHS_MAP[monthYear[1].toLowerCase()];
    if (m) return `${monthYear[2]}-${m}`;
  }

  // "2020" (year only)
  const yearOnly = d.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1];

  // "2020-01-15" already ISO
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(d)) return d;

  return null;
}

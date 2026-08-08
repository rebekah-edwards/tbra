/**
 * Shared sanitization utilities for book data quality.
 * Used by both the healing pass (existing data) and the import pipeline (new data).
 */

// ── Blurb Stripping ──

/**
 * Strip blurb-attribution patterns ("quote"—Source) from a description while
 * preserving non-blurb prose. Returns the stripped text and the count of
 * blurbs removed.
 *
 * Pattern matched:
 *   "<text ≥15 chars>" <opt ws> <em-dash variant> <opt ws> <Capitalized source>
 *
 * Source ends at the earliest of:
 *   - next opening quote (start of next blurb)
 *   - paragraph break
 *   - sentence boundary (period + space + capitalized word ≥3 chars)
 *   - 250 chars (safety cap)
 *
 * If stripping leaves the description empty or below the usable threshold,
 * sanitizeDescription's existing length check (60 chars) returns null and the
 * caller treats it as a clear.
 */
export function stripBlurbs(text: string): { stripped: string; removed: number } {
  let result = text;
  let removed = 0;

  // Common English sentence-starter words. When source-name parsing hits
  // one of these as a free-standing capitalized token, treat it as the
  // start of a new sentence (i.e. end of source) — this catches sources
  // like "—MuggleNet It's time to take back Earth..." where there's no
  // period between source and prose.
  const SENTENCE_STARTERS = new RegExp(
    "\\s+(?:It['']s|It|If|But|When|The|This|These|Those|Now|As|While|Although|However|After|Before|With|Without|For|From|Because|Since|Though|Until|Where|Who|What|Why|How|Set|Welcome|In|On|At|Their|Her|His|My|Your|We|They|You|He|She)\\s+[a-z]"
  );

  while (removed < 50) {
    // Find next blurb start: opening quote, content ≥15 chars, closing quote,
    // optional whitespace, em-dash variant, optional whitespace, capital letter
    const m = result.match(/"[^"]{15,}"\s*[―—–]\s*[A-Z]/);
    if (!m || m.index === undefined) break;

    const blurbStart = m.index;
    const sourceStartIdx = blurbStart + m[0].length;

    // Find where the source ends. Pick the earliest boundary.
    const tail = result.slice(sourceStartIdx);
    const boundaryCandidates: number[] = [];
    const patterns = [
      /\s*"[^"]/,              // next opening quote (start of next blurb)
      /\n\s*\n/,               // paragraph break
      /\.\s+[A-Z][a-z]{3,}\s/, // sentence boundary (period + space + capitalized word)
      SENTENCE_STARTERS,       // sentence-starter heuristic
    ];
    for (const p of patterns) {
      const bm = tail.match(p);
      if (bm && bm.index !== undefined) boundaryCandidates.push(bm.index);
    }
    boundaryCandidates.push(150); // tighter cap (was 250) — typical sources fit
    boundaryCandidates.push(tail.length); // end of string

    let sourceLen = Math.min(...boundaryCandidates);

    // Snap the cut to the next whitespace AFTER sourceLen to avoid splitting
    // mid-word. Without this, the 150-char cap can land in the middle of a
    // word and leave fragments like "pera about" or "d return".
    if (sourceLen > 0 && sourceLen < tail.length) {
      const nextSpace = tail.slice(sourceLen).search(/\s/);
      if (nextSpace >= 0 && nextSpace < 50) sourceLen += nextSpace;
    }

    const blurbEnd = sourceStartIdx + sourceLen;

    // Excise [blurbStart, blurbEnd)
    result = result.slice(0, blurbStart) + result.slice(blurbEnd);
    removed++;
  }

  // Clean up: collapse runs of whitespace, strip orphan punctuation that
  // sometimes precedes a removed blurb (", —", "; —", etc.)
  result = result.replace(/\s{2,}/g, " ").trim();
  result = result.replace(/^[,;:.\s]+/, "").trim();

  return { stripped: result, removed };
}

// ── Description Sanitization ──

/**
 * Strip HTML, markdown, URLs, and common junk patterns from a description.
 * Returns null if the result isn't a usable book description (e.g., pure author bio,
 * Amazon product page, SparkNotes boilerplate, table of contents, etc).
 */
export function sanitizeDescription(raw: string): string | null {
  let text = raw;

  // Strip HTML tags (e.g., <b>bold</b> → bold, <a href="...">link</a> → link)
  text = text.replace(/<[^>]+>/g, "");

  // Strip markdown links: [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip bare URLs
  text = text.replace(/https?:\/\/[^\s)<]+/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Strip "Product Description" prefix (Amazon leftover, with optional colon/period)
  text = text.replace(/^Product Description\s*[:.]?\s*/i, "");

  // Strip leading wiki nav: "Preceded by X", "BOOK TWO of Y"
  const lines = text.split(/\n+/);
  while (lines.length > 0) {
    const line = lines[0].trim();
    if (
      /^(?:Preceeded|Preceded) by\s/i.test(line) ||
      /^Sequel to\s/i.test(line) ||
      /^Prequel to\s/i.test(line) ||
      /^BOOK (?:ONE|TWO|THREE|FOUR|FIVE|SIX|\d+) of/i.test(line)
    ) {
      lines.shift();
    } else {
      break;
    }
  }
  text = lines.join("\n");

  // Cut at TOC start if there's real content before it
  const tocIdx = text.search(/\bContents\s*[:\n]/i);
  if (tocIdx > 80) text = text.slice(0, tocIdx);
  else if (tocIdx >= 0) return null; // TOC-only, unsalvageable

  // Cut at "Kindle edition by..." — Amazon listing text
  const kindleIdx = text.search(/\s*[-–—]?\s*Kindle edition by\b/i);
  if (kindleIdx >= 0) text = text.slice(0, kindleIdx);

  // Strip trailing Goodreads sidebar: "GenresFantasyRomance..." and "Published ... by..."
  text = text.replace(/\s*\.?\s*Genres(?:[A-Z][a-z]+){3,}.*$/s, "");
  text = text.replace(/\s*(?:First )?[Pp]ublished\s+[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}.*$/s, "");

  // Strip trailing author bio ("X is the bestselling author of Y")
  const bioMatch = text.match(/\.\s+[A-Z][\w\s.]{2,40} is the (?:[\w\s#]+?)?(?:bestselling|award-winning) author of/);
  if (bioMatch && bioMatch.index !== undefined && bioMatch.index > 100) {
    text = text.slice(0, bioMatch.index + 1);
  }

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // ── Strip blurb-attribution patterns ("quote"—Source) ──
  // Removes review-quote walls while keeping any surrounding prose. If a
  // description was mostly blurbs, the result will be too short and the
  // length check below returns null (the caller treats it as a clear).
  // Added 2026-05-04.
  text = stripBlurbs(text).stripped;

  // Reject if too short
  if (text.length < 60) return null;

  // Reject if it STARTS as a pure author bio
  if (/^[A-Z][\w\s.]{2,40} is the (?:[\w\s#]+?)?(?:bestselling|award-winning) author of\b/.test(text)) return null;
  if (/^[A-Z][\w\s.]{2,40} is the author of\b/.test(text)) return null;
  if (/^[A-Z][\w\s.]{1,30} is (?:a|an) [\w\s.,]{2,100} and (?:the|a|an)?\s*(?:author|writer) of\b/.test(text.slice(0, 200))) return null;
  if (/^[A-Z][\w.\s]{2,50} is the (?:Executive |Managing |Senior |Assistant )?(?:Production )?(?:Editor|Director|Producer|Publisher|Founder|CEO|President|Creator|Illustrator|Translator) (?:at|of|for)/i.test(text.slice(0, 200))) return null;
  if (/^[A-Z][\w\s.]{2,40} has (?:written|authored|published)\b/.test(text.slice(0, 200))) return null;
  if (/^(?:[A-Z][\w\s.]+ )?was born in\b/.test(text.slice(0, 100))) return null;

  // Reject if it's a user review
  if (/^In the (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) (?:book|installment|entry|novel) (?:of|in)/i.test(text)) return null;
  if (/^I (?:loved|hated|couldn['’]?t put|was (?:blown|hooked))/i.test(text)) return null;
  // Reviewer voice: opens in first person AND talks about the book-as-object
  // ("I was never a big sci-fi fan but..."). Requires both signals so a
  // legitimate first-person blurb ("I never asked for this life.") survives.
  if (/^I\b[^.!?]{0,150}\b(?:this book|the book|this story|this series|this author|this one|sci-?fi fan|fantasy fan|fan of)\b/i.test(text)) return null;

  // Reject if it's a series listing dump
  if (/^Also (?:available |in )(?:the |from )?(?:series )?[A-Z]/i.test(text.slice(0, 200))) return null;
  const hashCount = (text.slice(0, 300).match(/#\d+\b/g) ?? []).length;
  if (hashCount >= 3) return null;

  // Reject digitization / SparkNotes / excerpt boilerplate
  if (/^This work has been selected by scholars as being culturally important/i.test(text)) return null;
  if (/Created by Harvard students for students everywhere, SparkNotes/i.test(text)) return null;
  if (/^Excerpt from\b/i.test(text)) return null;

  // Reject if it contains concatenated CamelCase genre dumps
  if (/(?:[A-Z][a-z]{2,}){4,}/.test(text)) return null;

  // ── Goodreads UI / scrape artifacts (added 2026-05-04) ──
  // These are signs the description was scraped from a Goodreads page rather
  // than written as actual book copy. Each pattern is narrow enough to avoid
  // false positives on real prose.
  // The review count sits inside the sentence ("Read 22 reviews from the
  // world's largest community for readers"), so the number must be optional —
  // without it this rule only caught the count-less variant.
  if (/Read\s+(?:\d[\d,]*\s+)?reviews?\s+from the world['’]?s largest community for readers/i.test(text)) return null;
  // Goodreads AUTHOR-page scrape: "Michael Cheney has 15 books on Goodreads with 18666 ratings"
  if (/\bbooks? on Goodreads\b/i.test(text)) return null;
  if (/Let us know what['’]?s wrong with this preview/i.test(text)) return null;
  if (/(?:Want to Read|Currently Reading|Did Not Finish)\s*[·•]/i.test(text)) return null;
  if (/Return to Book Page/i.test(text)) return null;
  if (/^Reviews from the book:/i.test(text)) return null;
  // Goodreads metadata scrape: "by Author · 3.86 · 193 Ratings · 25 Reviews · published 2020 · 3 editions"
  if (/published\s+\d{4}\s*·\s*\d+\s+editions?/i.test(text)) return null;
  if (/\d+\s+Ratings?\s*·\s*\d+\s+Reviews?/i.test(text)) return null;

  // ── Star-rating / promo bullet scrapes (added 2026-05-04) ──
  // Two or more stars in a row is a strong signal the description was scraped
  // from a star-rating widget or is promotional bullet copy ("★★★ Try this!").
  if (/★{2,}/.test(text)) return null;

  // ── Review-quote walls (added 2026-05-04) ──
  // Detects descriptions that are ENTIRELY blurb-attribution quotes. Pattern:
  // a quoted string of ≥15 chars, followed by an em-dash variant (—, ―, –)
  // and a Capitalized source name. Three or more such patterns means the
  // description has no editorial prose — just stacked review snippets.
  // Fewer than 3 doesn't trigger, so prose with one or two embedded quotes
  // (legitimate marketing copy) stays.
  const blurbAttribCount = (text.match(/"[^"]{15,}"\s*[―—–]\s*[A-Z][\w\s.,&]+/g) ?? []).length;
  if (blurbAttribCount >= 3) return null;

  // ── Marketplace listing scrapes (added 2026-07-30) ──
  // These are Amazon/retailer PAGE TITLES and storefront chrome, not book copy —
  // e.g. "Amazon.com: The Never Heir (Otherworlds Book 1) eBook : Millecam,
  // Courtney: Kindle Store" or "Scion [Islington, James] on Amazon.com. *FREE*
  // shipping on qualifying offers." They slip past the length check because they
  // run 80-110 chars, and past JUNK_DESC_PATTERNS because that regex only guards
  // the Brave path — ISBNdb and OpenLibrary write descriptions without it.
  // Checked here so every source is covered by one filter.
  if (/^Amazon\.com\s*:/i.test(text)) return null;
  if (/\bon Amazon\.com\b/i.test(text) && text.length < 400) return null;
  if (/:\s*(?:Kindle Store|Books|Kindle eBooks)\s*$/i.test(text)) return null;
  if (/\bFREE\W{0,3}shipping on qualifying offers/i.test(text)) return null;
  if (/^\s*\S[^[\]]{0,120}\[[^\]]+\]\s+on\s+\w/i.test(text)) return null; // "Title [Last, First] on <retailer>"
  if (/\b(?:Kindle Store|Kindle eBooks|Books)\s*›/i.test(text)) return null; // breadcrumb trail

  // A bare title-and-byline with no sentence punctuation is a listing headline,
  // not a blurb — e.g. "Fantastic Beasts and Where to Find Them: The Original
  // Screenplay By J.K. Rowling". Requires no internal sentence break, so real
  // prose (which always has one by this length) is unaffected.
  // Requires no trailing sentence punctuation: a listing headline runs
  // "Title ... By Author" with nothing after it, while real prose that happens
  // to end in "by <Capitalized word>" closes with a period. Without this the
  // rule rejected legitimate one-line descriptions — "A retelling of the story
  // about a miser whose life is changed by Christmas." and "The novel based on
  // the The Four Loves radio talks by C. S. Lewis." both matched, so books were
  // left blank when a perfectly good description was available (found
  // 2026-08-08 while auditing junk descriptions).
  if (/^[^.!?]{20,150}\s+[Bb]y\s+[A-Z][\w.'’\-\s]{2,40}$/.test(text) && !/[.!?]$/.test(text)) return null;

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

/**
 * scan-description-junk.ts — READ-ONLY analysis pass.
 *
 * Scopes junk patterns in `books.description` that the existing cleanup
 * script (`find-junk-descriptions.ts`) doesn't catch. Focus patterns:
 *   - empty / null
 *   - under 100 chars
 *   - lowercase-start review-style ("it it so good i love it...")
 *   - academic thesis / first-person OCR ("My Thesis", "entitled:", "reseach", "Univeristy")
 *   - issue-list dumps (`Witchblade #70-75 + Witchblade Bearers`)
 *   - mid-word / mid-sentence truncation ("Author Robert E.")
 *   - known footer junk ("Books with Buzz", "About the Author:", "Discover the latest")
 *
 * Usage: npx tsx scripts/scan-description-junk.ts
 *
 * Never modifies data. Reports counts + 20 samples per pattern + overlap matrix.
 */
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath, { readonly: true });

type PatternKey =
  | "empty_or_null"
  | "under_100_chars"
  | "lowercase_review"
  | "academic_thesis"
  | "issue_list"
  | "mid_word_truncation"
  | "footer_junk";

const PATTERN_LABELS: Record<PatternKey, string> = {
  empty_or_null: "Empty or null description",
  under_100_chars: "Under 100 chars (non-empty)",
  lowercase_review: "Lowercase-start, review-style prose",
  academic_thesis: "Academic thesis / first-person OCR text",
  issue_list: "Issue list (#N-N / multi-# dump)",
  mid_word_truncation: "Mid-word / mid-sentence truncation",
  footer_junk: "Amazon/site footer contamination",
};

interface Row {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  description_stale: number;
}

const matches: Record<PatternKey, Row[]> = {
  empty_or_null: [],
  under_100_chars: [],
  lowercase_review: [],
  academic_thesis: [],
  issue_list: [],
  mid_word_truncation: [],
  footer_junk: [],
};

const ALREADY_STALE: Record<PatternKey, number> = {
  empty_or_null: 0,
  under_100_chars: 0,
  lowercase_review: 0,
  academic_thesis: 0,
  issue_list: 0,
  mid_word_truncation: 0,
  footer_junk: 0,
};

// ─── Detectors ───

function isEmpty(d: string | null): boolean {
  return !d || d.trim().length === 0;
}

function isUnder100(d: string): boolean {
  return d.trim().length > 0 && d.trim().length < 100;
}

/**
 * Review-style prose: starts with a lowercase letter, has no terminal
 * punctuation, and reads like a user review (contains personal-voice
 * markers OR is just short + lowercase).
 */
function isLowercaseReview(d: string): boolean {
  const t = d.trim();
  if (t.length === 0) return false;
  const first = t[0];
  // Must start with lowercase ASCII letter
  if (!/[a-z]/.test(first)) return false;
  // Short + lowercase + contains personal-voice markers (i / my / me / loved / hated / good / bad / over and over)
  const hasPersonalVoice =
    /\b(i|my|me|loved|hated|good|bad|awesome|amazing|terrible|over and over|couldn'?t put|could not put|5 stars|five stars)\b/i.test(
      t,
    );
  // No terminal punctuation at end (reviews often trail off)
  const noTerminal = !/[.!?"'\)\]]$/.test(t);
  // Limit to <400 chars to avoid catching legit lowercase prose openings (rare)
  return t.length < 400 && (hasPersonalVoice || noTerminal);
}

/** Academic thesis / first-person scholar OCR text */
function isAcademicThesis(d: string): boolean {
  if (/\bMy Thesis\b/i.test(d)) return true;
  if (/\bentitled:\s*[A-Z]/.test(d)) return true;
  // First-person scholarly markers in first 300 chars
  const head = d.slice(0, 300);
  if (/\b(my (?:thesis|dissertation|paper|research|study|book))\b/i.test(head) &&
      /\b(I (?:wrote|completed|submitted|began|argued|explore|examined))\b/i.test(head)) {
    return true;
  }
  // Common OCR typos that signal scanned academic text
  const ocrTypos = /\b(reseach|Univeristy|thier|recieved|seperate|managment|occured)\b/;
  if (ocrTypos.test(d) && /\b(thesis|dissertation|university|research|chapter)\b/i.test(d)) {
    return true;
  }
  return false;
}

/**
 * Issue list: majority of content is `#N` or `#N-N` entries — looks like
 * "Witchblade #70-75 + Witchblade Bearers" or a comic issue dump.
 */
function isIssueList(d: string): boolean {
  const t = d.trim();
  if (t.length > 400) return false; // legit descriptions that happen to mention issue #s are longer
  // Match `#N` or `#N-N`
  const hashMatches = t.match(/#\d+(?:-\d+)?/g) ?? [];
  if (hashMatches.length === 0) return false;
  // Total chars covered by hash tokens
  const hashChars = hashMatches.reduce((sum, m) => sum + m.length, 0);
  // If hash tokens are ≥10% of content OR there are 3+ of them, flag
  if (hashMatches.length >= 3) return true;
  if (hashChars / t.length >= 0.1 && hashMatches.length >= 1 && t.length < 200) return true;
  return false;
}

/**
 * Mid-word / mid-sentence truncation — ends abruptly on a non-punctuation
 * word boundary that looks like it was cut off.
 */
function isMidWordTruncation(d: string): boolean {
  const t = d.trim();
  if (t.length < 80) return false; // short descriptions are captured by `under_100_chars`
  const last = t.slice(-50);
  // Already has terminal punctuation → not truncated
  if (/[.!?…"'\)\]]\s*$/.test(t)) return false;
  // Ends in abbreviation like "Robert E." or "St." — this is the signal
  if (/\b[A-Z]\.\s*$/.test(t)) return true;
  // Ends in a bare lowercase word with no terminal — very suspicious if long
  if (/\b[a-z]{2,}$/.test(t) && !/[,;:)]\s*$/.test(t)) return true;
  // Ends in `,` or `;` or `:` — trailing connector
  if (/[,;:]\s*$/.test(t)) return true;
  // Ends with "and", "or", "but", "the", "a", "of", "to", "with"
  if (/\b(and|or|but|the|a|of|to|with|for|in|on|by|from)\s*$/i.test(last)) return true;
  return false;
}

/**
 * Amazon / scraped-site footer contamination.
 * These strings shouldn't appear in publisher descriptions.
 */
const FOOTER_MARKERS: RegExp[] = [
  /\bBooks with Buzz\b/i,
  /\bDiscover the latest buzz[- ]worthy\b/i,
  /\bAbout the Author\s*:/i,
  /\bProduct Details\b/i,
  /\bCustomer Reviews\b/i,
  /\bEditorial Reviews\b/i,
  /\bFrom the Publisher\b/i,
  /\bFrom the Back Cover\b/i,
  /\bFrom the Inside Flap\b/i,
  /\bFrom School Library Journal\b/i,
  /\bFrom Booklist\b/i,
  /\bRead more\s*›/i,
  /\bClick to open expanded view\b/i,
  /\bSee all [\d,]+ customer reviews\b/i,
  /\bPublication date\s*:/i,
  /\bLanguage\s*:\s*English\b/i,
  /\bISBN-1[03]\s*:/i,
  /\bItem Weight\s*:/i,
  /\bDimensions\s*:/i,
  /\bBest Sellers Rank\s*:/i,
  /\bPaperback\s*:\s*\d+ pages\b/i,
  /\bHardcover\s*:\s*\d+ pages\b/i,
  /\bReport an issue with this product\b/i,
  /\bBrief content visible\b/i,
  /\bTo calculate the overall star rating\b/i,
];

function hasFooterJunk(d: string): string | null {
  for (const rx of FOOTER_MARKERS) {
    const m = d.match(rx);
    if (m) return m[0];
  }
  return null;
}

// ─── Main scan ───

console.log("=== scan-description-junk.ts (read-only) ===\n");

const rows = db
  .prepare(
    `SELECT id, slug, title, description, description_stale
     FROM books
     WHERE visibility = 'public'`,
  )
  .all() as Row[];

console.log(`Scanning ${rows.length.toLocaleString()} public books...\n`);

const footerHits: Record<string, number> = {};

for (const r of rows) {
  if (isEmpty(r.description)) {
    matches.empty_or_null.push(r);
    if (r.description_stale === 1) ALREADY_STALE.empty_or_null++;
    continue;
  }
  const desc = r.description!;

  let flagged = false;

  if (isUnder100(desc)) {
    matches.under_100_chars.push(r);
    if (r.description_stale === 1) ALREADY_STALE.under_100_chars++;
    flagged = true;
  }
  if (isLowercaseReview(desc)) {
    matches.lowercase_review.push(r);
    if (r.description_stale === 1) ALREADY_STALE.lowercase_review++;
    flagged = true;
  }
  if (isAcademicThesis(desc)) {
    matches.academic_thesis.push(r);
    if (r.description_stale === 1) ALREADY_STALE.academic_thesis++;
    flagged = true;
  }
  if (isIssueList(desc)) {
    matches.issue_list.push(r);
    if (r.description_stale === 1) ALREADY_STALE.issue_list++;
    flagged = true;
  }
  if (isMidWordTruncation(desc)) {
    matches.mid_word_truncation.push(r);
    if (r.description_stale === 1) ALREADY_STALE.mid_word_truncation++;
    flagged = true;
  }
  const footer = hasFooterJunk(desc);
  if (footer) {
    matches.footer_junk.push(r);
    if (r.description_stale === 1) ALREADY_STALE.footer_junk++;
    footerHits[footer.toLowerCase()] = (footerHits[footer.toLowerCase()] ?? 0) + 1;
    flagged = true;
  }

  void flagged; // a row can be flagged by multiple patterns — we count each
}

// ─── Report ───

console.log("=== PATTERN COUNTS ===");
console.log("Pattern                                               Count   StaleFlagged");
console.log("─".repeat(78));
for (const key of Object.keys(matches) as PatternKey[]) {
  const count = matches[key].length;
  const stale = ALREADY_STALE[key];
  const label = PATTERN_LABELS[key];
  console.log(
    `${label.padEnd(54)} ${count.toLocaleString().padStart(6)}   ${stale.toLocaleString().padStart(6)}`,
  );
}
console.log();

// Overlap — unique books matching at least one pattern
const uniqueIds = new Set<string>();
for (const key of Object.keys(matches) as PatternKey[]) {
  for (const r of matches[key]) uniqueIds.add(r.id);
}
console.log(`UNIQUE books matching ≥1 pattern: ${uniqueIds.size.toLocaleString()}`);
console.log(
  `   (${(
    (uniqueIds.size / rows.length) *
    100
  ).toFixed(1)}% of all ${rows.length.toLocaleString()} public books)`,
);
console.log();

// Top footer-junk phrases
if (matches.footer_junk.length > 0) {
  console.log("=== TOP FOOTER JUNK PHRASES ===");
  const sorted = Object.entries(footerHits).sort((a, b) => b[1] - a[1]);
  for (const [phrase, count] of sorted.slice(0, 15)) {
    console.log(`  ${count.toString().padStart(5)}  "${phrase}"`);
  }
  console.log();
}

// ─── Samples ───

const SAMPLE_SIZE = 20;

for (const key of Object.keys(matches) as PatternKey[]) {
  const items = matches[key];
  if (items.length === 0) continue;

  console.log(`\n=== SAMPLES: ${PATTERN_LABELS[key]} (showing ${Math.min(SAMPLE_SIZE, items.length)} of ${items.length.toLocaleString()}) ===`);
  // Deterministic seed: pick evenly spaced samples
  const step = Math.max(1, Math.floor(items.length / SAMPLE_SIZE));
  for (let i = 0; i < items.length && i / step < SAMPLE_SIZE; i += step) {
    const r = items[i];
    const d = r.description ?? "(null)";
    const snippet = d.replace(/\s+/g, " ").slice(0, 180);
    const tail = d.length > 180 ? d.slice(-80).replace(/\s+/g, " ") : "";
    console.log(`  ── ${r.title}`);
    console.log(`     slug: ${r.slug ?? "(no slug)"}   len: ${d.length}   stale: ${r.description_stale}`);
    console.log(`     head: ${snippet}`);
    if (tail) console.log(`     tail: …${tail}`);
  }
}

// ─── Re-enrichment cost estimate ───

console.log("\n\n=== RE-ENRICHMENT COST ESTIMATE ===");
console.log(`Quotas: ISBNdb 15,000/day, Google Books 1,000/day, OpenLibrary unlimited.`);
console.log(`nightly-description-refresh runs 200 books/night at 300ms delay.`);
console.log();
const unique = uniqueIds.size;
const nights = Math.ceil(unique / 200);
console.log(`  ${unique.toLocaleString()} unique flagged books`);
console.log(`  → ${nights} nights at current 200/night rate`);
console.log(
  `  → ~${Math.ceil(unique / 500)} nights if raised to 500/night`,
);
console.log(
  `  → ~${Math.ceil(unique / 1000)} nights if raised to 1000/night (still under ISBNdb quota of 15k)`,
);

db.close();

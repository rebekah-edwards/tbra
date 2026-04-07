/**
 * Find junk book descriptions in the local DB.
 *
 * Detects descriptions that are scraped review text, Amazon product page boilerplate,
 * TOC dumps, author bios, wiki navigation, genre concatenation dumps, and other garbage
 * that shouldn't be shown as a book description.
 *
 * Usage:
 *   npx tsx scripts/find-junk-descriptions.ts            # report only (default)
 *   npx tsx scripts/find-junk-descriptions.ts --clear    # clear matched descriptions (null out)
 *   npx tsx scripts/find-junk-descriptions.ts --fix      # try to salvage where possible, clear otherwise
 *   npx tsx scripts/find-junk-descriptions.ts --limit=50 # stop after N matches
 *   npx tsx scripts/find-junk-descriptions.ts --pattern=toc  # only a specific pattern
 *
 * Never calls external APIs (no Brave, no ISBNdb, no OpenLibrary). Pure local analysis.
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ─── CLI args ───
const args = process.argv.slice(2);
const CLEAR = args.includes("--clear");
const FIX = args.includes("--fix");
const LIMIT_ARG = args.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;
const PATTERN_FILTER = args.find((a) => a.startsWith("--pattern="))?.split("=")[1];

type PatternType =
  | "amazon_product_page"
  | "kindle_edition_boilerplate"
  | "sparknotes_boilerplate"
  | "digitization_boilerplate"
  | "excerpt_from"
  | "genre_concat_dump"
  | "wiki_navigation"
  | "toc_dump"
  | "author_bio"
  | "user_review"
  | "series_listing"
  | "broken_layout"
  | "empty_or_tiny";

interface JunkMatch {
  id: string;
  title: string;
  descLen: number;
  pattern: PatternType;
  reason: string;
  snippet: string;
  /** Cleaned version if salvageable, otherwise null */
  cleaned: string | null;
}

// ─── Detection patterns ───

/** Detect "GenresFantasyRomanceMythology..." — scraped Goodreads sidebar dump */
function detectGenreConcatDump(desc: string): boolean {
  // "Genres" followed by 3+ capitalized words with no spaces between them
  return /\bGenres(?:[A-Z][a-z]+){3,}/.test(desc);
}

/** Detect any CamelCaseCluster of 4+ capitalized words glued together (without the "Genres" prefix) */
function detectCamelCaseCluster(desc: string): boolean {
  // Match sequences like "FantasyRomanceMythologyFiction" — 4+ capital-prefix words in a row
  return /(?:[A-Z][a-z]{2,}){4,}/.test(desc);
}

/** Detect Amazon product page text */
function detectAmazonProductPage(desc: string): boolean {
  if (/^Product Description\b/i.test(desc)) return true;
  if (/^Amazon\.com:/i.test(desc)) return true;
  if (/Kindle edition by\b/i.test(desc) && /Download it once/i.test(desc)) return true;
  if (/Use features like bookmarks, note taking/i.test(desc)) return true;
  return false;
}

/** Detect "Kindle edition by..." — Amazon listing format */
function detectKindleEdition(desc: string): boolean {
  return /Kindle edition by\b/i.test(desc);
}

/** Detect SparkNotes boilerplate */
function detectSparkNotesBoilerplate(desc: string): boolean {
  return /Created by Harvard students for students everywhere, SparkNotes/i.test(desc) ||
         /^SparkNotes books contain/i.test(desc);
}

/** Detect public-domain digitization boilerplate */
function detectDigitizationBoilerplate(desc: string): boolean {
  if (/^This work has been selected by scholars as being culturally important/i.test(desc)) return true;
  if (/reproduced from the original artifact/i.test(desc)) return true;
  if (/This is an EXACT reproduction of a book published before/i.test(desc)) return true;
  if (/part of the knowledge base of civilization/i.test(desc)) return true;
  return false;
}

/** Detect "Excerpt from..." — scanned facsimile text */
function detectExcerptFrom(desc: string): boolean {
  return /^Excerpt from\b/i.test(desc);
}

/** Detect OL wiki navigation like "Preceded by [Book]" or "BOOK TWO of the..." */
function detectWikiNavigation(desc: string): boolean {
  const leading = desc.slice(0, 200);
  if (/^(?:Preceeded|Preceded) by\s/i.test(leading)) return true;
  if (/^Sequel to\s/i.test(leading)) return true;
  if (/^Prequel to\s/i.test(leading)) return true;
  if (/^BOOK (?:ONE|TWO|THREE|FOUR|FIVE|SIX|\d+) of/i.test(leading)) return true;
  return false;
}

/** Detect table of contents dump — "Contents:" followed by a list */
function detectTocDump(desc: string): boolean {
  // "Contents:" or "Contents\n" followed by list-like structure
  if (/\bContents\s*[:\n]/i.test(desc)) {
    // And has list markers (--, •, numbered entries, or line breaks with short items)
    if (/\s--\s/.test(desc) || /\n\s*[•\-\*]\s/.test(desc)) return true;
    // Or starts with Contents and has multiple short lines
    if (/^Contents/i.test(desc)) return true;
  }
  return false;
}

/** Detect author bio posing as description */
function detectAuthorBio(desc: string): boolean {
  const first200 = desc.slice(0, 200);
  // "X is the New York Times bestselling author of..."
  if (/\bis the (?:[\w\s#]+?)?(?:bestselling|award-winning) author of\b/i.test(first200)) return true;
  // "X is the author of..."
  if (/^[A-Z][\w\s.]{2,40} is the author of\b/i.test(first200)) return true;
  // "X is a [profession] and the author of..." — "Clair is a citizen of the Muscogee Nation and the author of..."
  if (/^[A-Z][\w\s.]{1,30} is (?:a|an) [\w\s.,]{2,100} and (?:the|a|an)?\s*(?:author|writer) of\b/i.test(first200)) return true;
  // "X [NAME] is the Executive Production Editor / Managing Editor / Editor at..." — staff bio
  if (/^[A-Z][\w.\s]{2,50} is the (?:Executive |Managing |Senior |Assistant )?(?:Production )?(?:Editor|Director|Producer|Publisher|Founder|CEO|President|Creator|Illustrator|Translator) (?:at|of|for)/i.test(first200)) return true;
  // "X was born in..."
  if (/^(?:[A-Z][\w\s.]+ )?was born in\b/i.test(first200)) return true;
  // "X lives in..."
  if (/^[A-Z][\w\s.]{2,40} lives in\b/i.test(first200)) return true;
  // "X has written N books"
  if (/^[A-Z][\w\s.]{2,40} has (?:written|authored|published)\b/i.test(first200)) return true;
  return false;
}

/** Detect a series listing dump ("Also in the X series: #1 Y #2 Z") */
function detectSeriesListing(desc: string): boolean {
  const first200 = desc.slice(0, 200);
  // "Also in the X series #1 Y #2 Z..."
  if (/^Also (?:available |in )(?:the |from )?(?:series )?[A-Z]/i.test(first200)) return true;
  // Contains multiple "#N" entries in quick succession — listing of series entries
  const hashCount = (first200.match(/#\d+\b/g) ?? []).length;
  if (hashCount >= 3) return true;
  return false;
}

/** Detect user review posing as description */
function detectUserReview(desc: string): boolean {
  const first100 = desc.slice(0, 100);
  // "In the Nth installment of X, ..."
  if (/^In the (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) (?:book|installment|entry|novel) (?:of|in)/i.test(first100)) return true;
  // First-person review openings
  if (/^I (?:loved|hated|couldn'?t put|was (?:blown|hooked)|found this)/i.test(first100)) return true;
  // "Once again, [Author] ..."
  if (/^Once again,\s+[A-Z]/i.test(first100)) return true;
  // "Blew me away" / "knocked it out" phrases near the start
  if (/\b(?:blew me away|knocked it out|5 stars|five stars|absolutely loved)\b/i.test(first100)) return true;
  return false;
}

/** Empty or trivially short */
function detectEmpty(desc: string | null): boolean {
  if (!desc) return true;
  const trimmed = desc.trim();
  if (trimmed.length < 30) return true;
  return false;
}

// ─── Salvage logic ───

/** Try to salvage a description by stripping junk prefixes/suffixes. Takes the book title so we can detect title-only noise. */
function trySalvage(desc: string, title: string): string | null {
  let cleaned = desc.trim();

  // 0a. Strip HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 0b. Strip markdown links: [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 0c. Strip bare URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s)<]+/g, "");

  // 0d. Decode HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 1. Strip leading "Product Description" prefix (with optional colon/period)
  cleaned = cleaned.replace(/^Product Description\s*[:.]?\s*/i, "");

  // 2. Strip leading wiki navigation lines ("Preceded by...", "BOOK TWO of...").
  // Also skip blank lines between nav entries.
  const lines = cleaned.split(/\n+/);
  while (lines.length > 0) {
    const line = lines[0].trim();
    if (line === "") {
      lines.shift();
      continue;
    }
    if (
      /^(?:Preceeded|Preceded) by\s/i.test(line) ||
      /^Sequel to\s/i.test(line) ||
      /^Prequel to\s/i.test(line) ||
      /^BOOK (?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|\d+) of/i.test(line)
    ) {
      lines.shift();
    } else {
      break;
    }
  }
  cleaned = lines.join("\n").trim();

  // 3. Cut at "Contents:" if present — TOC dump usually follows a real intro
  const tocIdx = cleaned.search(/\bContents\s*[:\n]/i);
  if (tocIdx > 80) {
    // There's real text before the TOC — keep that
    cleaned = cleaned.slice(0, tocIdx).trim();
  } else if (tocIdx >= 0) {
    // Nothing substantive before TOC — unsalvageable
    return null;
  }

  // 4. Strip trailing author bio ("{Author} is the bestselling author of...")
  const bioMatch = cleaned.match(/\.\s+[A-Z][\w\s.]{2,40} is the (?:[\w\s#]+?)?(?:bestselling|award-winning) author of/);
  if (bioMatch && bioMatch.index !== undefined && bioMatch.index > 100) {
    cleaned = cleaned.slice(0, bioMatch.index + 1).trim();
  }

  // 5. Strip trailing "Kindle edition by..." block (no position requirement — often near the start)
  const kindleIdx = cleaned.search(/\s*[-–—]?\s*Kindle edition by\b/i);
  if (kindleIdx >= 0) {
    cleaned = cleaned.slice(0, kindleIdx).trim();
  }

  // 6. Strip trailing concatenated Genres block
  cleaned = cleaned.replace(/\s*\.?\s*Genres(?:[A-Z][a-z]+){3,}.*$/, "").trim();

  // 7. Strip trailing "Published {date} by..." / "Paperback, X pages" Goodreads metadata
  cleaned = cleaned
    .replace(/\s*(?:First )?[Pp]ublished\s+[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}.*$/s, "")
    .replace(/\s*(?:Paperback|Hardcover|Mass Market Paperback|ebook|Kindle Edition),?\s+\d+\s+pages\s*$/i, "")
    .trim();

  // 8. Strip trailing HTML fragments like "<strong>136 pages</strong>"
  cleaned = cleaned.replace(/<[^>]+>.*$/s, "").trim();

  // 9. If result is too short, give up
  if (cleaned.length < 120) return null;

  // 10. Can't salvage CamelCaseCluster junk
  if (detectCamelCaseCluster(cleaned)) return null;

  // 11. Must not still start with a junk pattern
  if (detectAuthorBio(cleaned)) return null;
  if (detectUserReview(cleaned)) return null;
  if (detectExcerptFrom(cleaned)) return null;
  if (detectDigitizationBoilerplate(cleaned)) return null;
  if (detectSparkNotesBoilerplate(cleaned)) return null;

  // 12. Reject "Amazon.com: ... : Books" listing format (pure metadata, no description)
  if (/^Amazon\.com:/i.test(cleaned)) return null;
  if (/:\s*Books\s*$/i.test(cleaned)) return null;
  // ISBN-heavy listings: contains an ISBN-10/13 early on and is short
  if (cleaned.length < 300 && /\b\d{10,13}\b/.test(cleaned.slice(0, 200))) return null;

  // 13. Reject if the cleaned text is mostly just the book title repeated
  // (common with Kindle edition stripping where the content before "Kindle edition by" is just "{Title}: {Subtitle}")
  const titleNorm = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanedNorm = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (titleNorm.length > 0 && cleanedNorm.startsWith(titleNorm)) {
    const remaining = cleanedNorm.slice(titleNorm.length);
    // If less than 80 alphanumeric chars remain after the title, it's junk
    if (remaining.length < 80) return null;
  }

  return cleaned;
}

// ─── Main detection ───

function detectJunk(desc: string | null, title: string): Omit<JunkMatch, "id" | "title" | "descLen"> | null {
  if (detectEmpty(desc)) {
    return {
      pattern: "empty_or_tiny",
      reason: "Description is empty or under 30 chars",
      snippet: desc ?? "(null)",
      cleaned: null,
    };
  }
  const description = desc!; // safe after detectEmpty check

  if (detectAmazonProductPage(description)) {
    const salvaged = trySalvage(description, title);
    return {
      pattern: "amazon_product_page",
      reason: "Starts with 'Product Description' or Amazon boilerplate",
      snippet: description.slice(0, 180),
      cleaned: salvaged,
    };
  }

  if (detectKindleEdition(description)) {
    const salvaged = trySalvage(description, title);
    return {
      pattern: "kindle_edition_boilerplate",
      reason: "Contains 'Kindle edition by...' Amazon listing text",
      snippet: description.slice(0, 180),
      cleaned: salvaged,
    };
  }

  if (detectSparkNotesBoilerplate(description)) {
    return {
      pattern: "sparknotes_boilerplate",
      reason: "SparkNotes study guide boilerplate",
      snippet: description.slice(0, 180),
      cleaned: null,
    };
  }

  if (detectDigitizationBoilerplate(description)) {
    return {
      pattern: "digitization_boilerplate",
      reason: "Public-domain digitization boilerplate",
      snippet: description.slice(0, 180),
      cleaned: null,
    };
  }

  if (detectExcerptFrom(description)) {
    return {
      pattern: "excerpt_from",
      reason: "Starts with 'Excerpt from' — scanned facsimile text",
      snippet: description.slice(0, 180),
      cleaned: null,
    };
  }

  if (detectGenreConcatDump(description) || detectCamelCaseCluster(description)) {
    const salvaged = trySalvage(description, title);
    return {
      pattern: "genre_concat_dump",
      reason: "Contains scraped Goodreads sidebar (concatenated genre names)",
      snippet: description.slice(0, 180),
      cleaned: salvaged,
    };
  }

  if (detectWikiNavigation(description)) {
    const salvaged = trySalvage(description, title);
    return {
      pattern: "wiki_navigation",
      reason: "Starts with OL wiki navigation ('Preceded by', 'BOOK X of', etc.)",
      snippet: description.slice(0, 180),
      cleaned: salvaged,
    };
  }

  if (detectTocDump(description)) {
    const salvaged = trySalvage(description, title);
    return {
      pattern: "toc_dump",
      reason: "Contains a table of contents dump",
      snippet: description.slice(0, 180),
      cleaned: salvaged,
    };
  }

  if (detectAuthorBio(description)) {
    return {
      pattern: "author_bio",
      reason: "Starts with author biography instead of book description",
      snippet: description.slice(0, 180),
      cleaned: null,
    };
  }

  if (detectUserReview(description)) {
    return {
      pattern: "user_review",
      reason: "Starts with a user review ('In the Nth installment of...', etc.)",
      snippet: description.slice(0, 180),
      cleaned: null,
    };
  }

  if (detectSeriesListing(description)) {
    return {
      pattern: "series_listing",
      reason: "Description is a listing of other books in the series",
      snippet: description.slice(0, 180),
      cleaned: null,
    };
  }

  return null;
}

// ─── Main ───

function main() {
  console.log("=== Junk description scanner ===\n");
  if (CLEAR) console.log("Mode: --clear (will NULL out matched descriptions)");
  else if (FIX) console.log("Mode: --fix (will salvage where possible, clear otherwise)");
  else console.log("Mode: dry-run (report only)");
  if (PATTERN_FILTER) console.log(`Pattern filter: ${PATTERN_FILTER}`);
  if (LIMIT !== Infinity) console.log(`Limit: ${LIMIT}`);
  console.log();

  // Scan only public books that have a description — empty descriptions are reported separately
  const rows = db
    .prepare(
      `SELECT id, title, description FROM books WHERE visibility = 'public' ORDER BY title`,
    )
    .all() as { id: string; title: string; description: string | null }[];

  console.log(`Scanning ${rows.length.toLocaleString()} public books...\n`);

  const matches: JunkMatch[] = [];
  const byPattern: Record<string, number> = {};

  for (const row of rows) {
    const result = detectJunk(row.description, row.title);
    if (!result) continue;
    if (PATTERN_FILTER && result.pattern !== PATTERN_FILTER) continue;

    matches.push({
      id: row.id,
      title: row.title,
      descLen: row.description?.length ?? 0,
      ...result,
    });
    byPattern[result.pattern] = (byPattern[result.pattern] ?? 0) + 1;

    if (matches.length >= LIMIT) break;
  }

  // ── Summary ──
  console.log("=== SUMMARY ===");
  console.log(`Total junk matches: ${matches.length.toLocaleString()}`);
  console.log();
  const sortedPatterns = Object.entries(byPattern).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${pattern.padEnd(28)} ${count.toLocaleString().padStart(6)}`);
  }
  console.log();

  // ── Sample output ──
  console.log("=== SAMPLE (first 5 per pattern) ===");
  const samplesByPattern: Record<string, JunkMatch[]> = {};
  for (const m of matches) {
    samplesByPattern[m.pattern] = samplesByPattern[m.pattern] ?? [];
    if (samplesByPattern[m.pattern].length < 5) samplesByPattern[m.pattern].push(m);
  }
  for (const [pattern, items] of Object.entries(samplesByPattern)) {
    console.log(`\n── ${pattern} ──`);
    for (const m of items) {
      console.log(`  ${m.title} [${m.id.slice(0, 8)}] (${m.descLen} chars)`);
      console.log(`    ${m.snippet.replace(/\n/g, " ").slice(0, 160)}`);
      if (m.cleaned) {
        console.log(`    SALVAGEABLE → ${m.cleaned.slice(0, 120).replace(/\n/g, " ")}...`);
      }
    }
  }

  // ── Actions ──
  if (CLEAR || FIX) {
    console.log("\n=== APPLYING CHANGES ===");
    let cleared = 0;
    let fixed = 0;
    const updateStmt = db.prepare(
      `UPDATE books SET description = ?, updated_at = datetime('now') WHERE id = ?`,
    );

    for (const m of matches) {
      if (m.pattern === "empty_or_tiny") continue; // don't touch empty ones
      if (FIX && m.cleaned) {
        updateStmt.run(m.cleaned, m.id);
        fixed++;
      } else if (CLEAR || (FIX && !m.cleaned)) {
        updateStmt.run(null, m.id);
        cleared++;
      }
    }

    console.log(`  Cleared: ${cleared.toLocaleString()}`);
    console.log(`  Salvaged: ${fixed.toLocaleString()}`);
  } else {
    console.log("\n(Dry run — no DB changes made. Re-run with --clear or --fix to apply.)");
  }

  db.close();
}

main();

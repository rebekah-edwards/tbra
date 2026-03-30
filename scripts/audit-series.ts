/**
 * audit-series.ts — Audit all series for missing books, position gaps, and bad data.
 *
 * Checks:
 * 1. Series missing book 1 (position_in_series = 1)
 * 2. Series with position gaps (e.g., 1, 2, 4 — missing 3)
 * 3. Books in series missing publication_year
 *
 * For missing books: searches OpenLibrary to find and add them.
 * For missing years: looks up correct year from OpenLibrary.
 *
 * Usage:
 *   npx tsx scripts/audit-series.ts              # Dry run (report only)
 *   npx tsx scripts/audit-series.ts --fix        # Fix issues
 *   npx tsx scripts/audit-series.ts --fix --limit=50  # Fix first 50 series with issues
 *   npx tsx scripts/audit-series.ts --years-only # Only fix missing years (no book additions)
 */

import { createClient } from "@libsql/client";
import { config } from "dotenv";
import { randomUUID } from "crypto";

config({ path: ".env.local" });

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

// Use Turso if available, otherwise local
const db = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: "file:data/tbra.db" });

const FIX_MODE = process.argv.includes("--fix");
const YEARS_ONLY = process.argv.includes("--years-only");
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? parseInt(arg.split("=")[1]) : Infinity;
})();

// ─── Guardrails ────────────────────────────────────────────────────
const MAX_GAPS_TO_FILL = 3; // Don't try to fill more than 3 missing positions
const MAX_SERIES_POSITION = 20; // Skip series with positions > 20 (likely comics/manga)
const MIN_VALID_YEAR = 1800;
const MAX_VALID_YEAR = new Date().getFullYear() + 2;
const OL_REQUESTS_CAP = 800; // Stop making OL requests after this many
let olRequestCount = 0;

// Rate limit OpenLibrary: max 1 req/sec
let lastOLRequest = 0;
async function olFetch(url: string): Promise<any> {
  if (olRequestCount >= OL_REQUESTS_CAP) {
    return null; // Stop making requests
  }

  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastOLRequest));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOLRequest = Date.now();
  olRequestCount++;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "tbra-audit/1.0 (thebasedreader.app)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function isValidYear(year: number | null): boolean {
  if (!year) return false;
  return year >= MIN_VALID_YEAR && year <= MAX_VALID_YEAR;
}

interface SeriesBook {
  id: string;
  title: string;
  position: number | null;
  publicationYear: number | null;
  pages: number | null;
  authorName: string | null;
  authorId: string | null;
  visibility: string;
}

interface SeriesInfo {
  id: string;
  name: string;
  slug: string | null;
  books: SeriesBook[];
}

// Stats
let totalSeries = 0;
let seriesAudited = 0;
let seriesMissingBook1 = 0;
let seriesWithGaps = 0;
let booksMissingYear = 0;
let booksAdded = 0;
let yearsFixed = 0;
let skippedComicManga = 0;

async function getAllSeries(): Promise<SeriesInfo[]> {
  const rows = await db.execute(`
    SELECT
      s.id, s.name, s.slug,
      b.id as book_id, b.title, bs.position_in_series,
      b.publication_year, b.pages, b.visibility,
      a.name as author_name, a.id as author_id
    FROM series s
    JOIN book_series bs ON s.id = bs.series_id
    JOIN books b ON bs.book_id = b.id
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
    WHERE b.visibility = 'public'
      AND b.is_box_set = 0
    ORDER BY s.name, bs.position_in_series
  `);

  const seriesMap = new Map<string, SeriesInfo>();
  const seenBookInSeries = new Set<string>();

  for (const row of rows.rows) {
    const sid = row.id as string;
    if (!seriesMap.has(sid)) {
      seriesMap.set(sid, {
        id: sid,
        name: row.name as string,
        slug: row.slug as string | null,
        books: [],
      });
    }

    // Avoid duplicate books (from multiple authors)
    const key = `${sid}::${row.book_id}`;
    if (seenBookInSeries.has(key)) continue;
    seenBookInSeries.add(key);

    seriesMap.get(sid)!.books.push({
      id: row.book_id as string,
      title: row.title as string,
      position: row.position_in_series as number | null,
      publicationYear: row.publication_year as number | null,
      pages: row.pages as number | null,
      authorName: row.author_name as string | null,
      authorId: row.author_id as string | null,
      visibility: row.visibility as string,
    });
  }

  return Array.from(seriesMap.values());
}

function slugify(text: string, author?: string): string {
  const base = `${text} ${author || ""}`.trim();
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Detect comic/manga/graphic novel series that shouldn't be gap-filled
function isComicOrMangaSeries(series: SeriesInfo): boolean {
  const nameLower = series.name.toLowerCase();
  const comicKeywords = [
    "comic", "manga", "graphic novel", "vol.", "volume",
    "action comics", "batman", "spider-man", "x-men", "superman",
    "marvel", "dc comics", "image comics", "dark horse",
    "one piece", "naruto", "dragon ball", "bleach", "attack on titan",
    "my hero academia", "demon slayer", "jujutsu", "chainsaw",
  ];
  if (comicKeywords.some((kw) => nameLower.includes(kw))) return true;

  // Check if max position is very high (likely comic/manga volumes)
  const positions = series.books
    .filter((b) => b.position !== null)
    .map((b) => b.position!);
  if (positions.length > 0 && Math.max(...positions) > MAX_SERIES_POSITION) {
    return true;
  }

  // Check if titles suggest comic volumes (e.g., "Vol. 5", "Issue #12")
  const volumePattern = /\bvol\.?\s*\d+|\bissue\s*#?\d+|\b#\d{2,}/i;
  const volumeBooks = series.books.filter((b) => volumePattern.test(b.title));
  if (volumeBooks.length > series.books.length * 0.5) return true;

  return false;
}

async function searchOpenLibrary(
  title: string,
  author: string | null
): Promise<{
  title: string;
  year: number | null;
  pages: number | null;
  olKey: string | null;
  coverUrl: string | null;
} | null> {
  const query = author ? `${title} ${author}` : title;
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i&limit=5`;

  const data = await olFetch(url);
  if (!data?.docs?.length) return null;

  // Find best match by title similarity
  const titleLower = title.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  for (const doc of data.docs) {
    const docTitle = (doc.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");

    // Require a reasonable title match
    if (
      docTitle === titleLower ||
      docTitle.includes(titleLower) ||
      titleLower.includes(docTitle)
    ) {
      const year = doc.first_publish_year || null;
      return {
        title: doc.title,
        year: isValidYear(year) ? year : null,
        pages: doc.number_of_pages_median || null,
        olKey: doc.key || null,
        coverUrl: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
          : null,
      };
    }
  }

  return null; // No good match — do NOT fallback to first result
}

async function fixMissingYear(book: SeriesBook): Promise<boolean> {
  const result = await searchOpenLibrary(book.title, book.authorName);
  if (!result?.year || !isValidYear(result.year)) return false;

  if (FIX_MODE) {
    await db.execute({
      sql: "UPDATE books SET publication_year = ? WHERE id = ? AND publication_year IS NULL",
      args: [result.year, book.id],
    });

    // Also fix pages if missing
    if (result.pages && result.pages > 10) {
      await db.execute({
        sql: "UPDATE books SET pages = ? WHERE id = ? AND pages IS NULL",
        args: [result.pages, book.id],
      });
    }
  }

  console.log(
    `    ${FIX_MODE ? "FIXED" : "WOULD FIX"}: "${book.title}" year → ${result.year}${result.pages && !book.pages ? `, pages → ${result.pages}` : ""}`
  );
  yearsFixed++;
  return true;
}

async function addMissingBook(
  series: SeriesInfo,
  position: number,
  authorName: string | null,
  authorId: string | null
): Promise<boolean> {
  // Track titles we've already tried adding to this series (avoid duplicates within one audit)
  const existingTitles = new Set(
    series.books.map((b) => b.title.toLowerCase().replace(/[^a-z0-9\s]/g, ""))
  );

  // Search OL for the specific book
  const queries = [
    `"${series.name}" ${authorName || ""} book ${position}`,
    `${series.name} #${position} ${authorName || ""}`,
  ];

  for (const query of queries) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i&limit=10`;

    const data = await olFetch(url);
    if (!data?.docs?.length) continue;

    for (const doc of data.docs) {
      const docTitle = (doc.title || "").toLowerCase();
      const docTitleNorm = docTitle.replace(/[^a-z0-9\s]/g, "");

      // Skip if title already in series
      if (existingTitles.has(docTitleNorm)) continue;

      // Skip compilations/box sets
      if (
        docTitle.includes("collection") ||
        docTitle.includes("omnibus") ||
        docTitle.includes("box set") ||
        docTitle.includes("complete") ||
        docTitle.includes("trilogy") ||
        docTitle.includes("series") ||
        docTitle.includes("books 1") ||
        docTitle.includes("books 2")
      ) {
        continue;
      }

      // Check author match (required if we know the author)
      if (authorName) {
        const docAuthors = (doc.author_name || []).map((a: string) =>
          a.toLowerCase()
        );
        const authorLower = authorName.toLowerCase();
        const authorParts = authorLower.split(" ");
        const lastName = authorParts[authorParts.length - 1];

        // At minimum, last name must match
        if (!docAuthors.some((a: string) => a.includes(lastName))) {
          continue;
        }
      }

      // Validate year
      const year = doc.first_publish_year || null;
      if (year && !isValidYear(year)) continue;

      // Found a candidate — check if it already exists in DB
      const slug = slugify(doc.title, authorName || "");

      const existing = await db.execute({
        sql: "SELECT id FROM books WHERE slug = ? AND visibility = 'public'",
        args: [slug],
      });

      if (existing.rows.length > 0) {
        // Book exists but isn't linked to series — link it
        const existingId = existing.rows[0].id as string;

        // Verify it's not already in this series
        const alreadyLinked = await db.execute({
          sql: "SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?",
          args: [existingId, series.id],
        });
        if (alreadyLinked.rows.length > 0) continue;

        if (FIX_MODE) {
          await db.execute({
            sql: "INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
            args: [existingId, series.id, position],
          });
        }
        console.log(
          `    ${FIX_MODE ? "LINKED" : "WOULD LINK"}: "${doc.title}" as #${position} (already in DB)`
        );
        // Add to existing titles so we don't re-add for another gap
        existingTitles.add(docTitleNorm);
        booksAdded++;
        return true;
      }

      // Create new book
      if (FIX_MODE) {
        const bookId = randomUUID();
        // Check if OL key already exists (UNIQUE constraint)
        const olKey = doc.key || null;
        if (olKey) {
          const olKeyExists = await db.execute({
            sql: "SELECT id FROM books WHERE open_library_key = ?",
            args: [olKey],
          });
          if (olKeyExists.rows.length > 0) {
            // OL key collision — link existing book instead
            const existingId = olKeyExists.rows[0].id as string;
            const alreadyLinked = await db.execute({
              sql: "SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?",
              args: [existingId, series.id],
            });
            if (alreadyLinked.rows.length === 0) {
              await db.execute({
                sql: "INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
                args: [existingId, series.id, position],
              });
              console.log(
                `    LINKED: "${doc.title}" as #${position} (OL key match)`
              );
              existingTitles.add(docTitleNorm);
              booksAdded++;
              return true;
            }
            continue; // Already linked, try next result
          }
        }

        try {
        await db.execute({
          sql: `INSERT INTO books (id, title, slug, publication_year, pages, open_library_key, cover_image_url, is_fiction, visibility)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'public')`,
          args: [
            bookId,
            doc.title,
            slug,
            year,
            doc.number_of_pages_median || null,
            olKey,
            doc.cover_i
              ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
              : null,
          ],
        });

        await db.execute({
          sql: "INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
          args: [bookId, series.id, position],
        });

        if (authorId) {
          await db.execute({
            sql: "INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)",
            args: [bookId, authorId],
          });
        }
        } catch (e: any) {
          if (e?.code?.includes("CONSTRAINT")) {
            continue; // Skip this result, try next
          }
          throw e;
        }
      }

      console.log(
        `    ${FIX_MODE ? "ADDED" : "WOULD ADD"}: "${doc.title}" as #${position} (year: ${year || "?"})`
      );
      existingTitles.add(docTitleNorm);
      booksAdded++;
      return true;
    }
  }

  console.log(`    ❓ Could not find book for position #${position}`);
  return false;
}

async function auditSeries(series: SeriesInfo): Promise<boolean> {
  const positioned = series.books
    .filter((b) => b.position !== null && b.position > 0)
    .sort((a, b) => a.position! - b.position!);

  if (positioned.length === 0) return false;

  // Get primary author from first positioned book
  const primaryAuthor = positioned[0]?.authorName || null;
  const primaryAuthorId = positioned[0]?.authorId || null;

  // ─── Detect comic/manga and skip gap-filling ───
  const isComic = isComicOrMangaSeries(series);

  const issues: string[] = [];
  let hasStructuralIssues = false;

  if (!isComic && !YEARS_ONLY) {
    // Check 1: Missing book 1
    const hasBook1 = positioned.some(
      (b) => b.position === 1 || b.position === 0.5
    );
    if (!hasBook1) {
      const lowestPos = Math.min(...positioned.map((b) => b.position!));
      if (lowestPos >= 2 && lowestPos <= MAX_SERIES_POSITION) {
        issues.push(`Missing book 1 (starts at #${lowestPos})`);
        seriesMissingBook1++;
        hasStructuralIssues = true;
      }
    }

    // Check 2: Position gaps (only for integer positions)
    const intPositions = positioned
      .filter((b) => Number.isInteger(b.position))
      .map((b) => b.position!);

    if (intPositions.length >= 2) {
      const maxPos = Math.max(...intPositions);
      const minPos = Math.min(...intPositions);

      // Skip if range is too large
      if (maxPos - minPos <= MAX_SERIES_POSITION) {
        const missing: number[] = [];
        for (let i = minPos; i <= maxPos; i++) {
          if (!intPositions.includes(i)) {
            missing.push(i);
          }
        }

        if (missing.length > 0 && missing.length <= MAX_GAPS_TO_FILL) {
          issues.push(`Missing positions: ${missing.join(", ")}`);
          seriesWithGaps++;
          hasStructuralIssues = true;
        }
      }
    }
  } else if (isComic) {
    skippedComicManga++;
  }

  // Check 3: Books missing publication year (always check, even for comics)
  const missingYears = series.books.filter(
    (b) => !b.publicationYear && b.visibility === "public"
  );
  if (missingYears.length > 0) {
    booksMissingYear += missingYears.length;
  }

  // Nothing to report?
  if (issues.length === 0 && missingYears.length === 0) return false;

  // Report
  console.log(`\n📚 ${series.name} (${positioned.length} positioned books)`);
  if (positioned.length <= 10) {
    console.log(
      `   Books: ${positioned.map((b) => `#${b.position} ${b.title}`).join(", ")}`
    );
  } else {
    console.log(
      `   Books: ${positioned.slice(0, 5).map((b) => `#${b.position} ${b.title}`).join(", ")} ... and ${positioned.length - 5} more`
    );
  }

  for (const issue of issues) {
    console.log(`   ⚠️  ${issue}`);
  }

  // Fix structural issues
  if (hasStructuralIssues && !YEARS_ONLY) {
    // Fix missing book 1
    const hasBook1 = positioned.some(
      (b) => b.position === 1 || b.position === 0.5
    );
    if (!hasBook1) {
      const lowestPos = Math.min(...positioned.map((b) => b.position!));
      if (lowestPos >= 2 && lowestPos <= MAX_SERIES_POSITION) {
        await addMissingBook(series, 1, primaryAuthor, primaryAuthorId);
      }
    }

    // Fix position gaps
    const intPositions = positioned
      .filter((b) => Number.isInteger(b.position))
      .map((b) => b.position!);
    if (intPositions.length >= 2) {
      const maxPos = Math.max(...intPositions);
      const minPos = Math.min(...intPositions);
      if (maxPos - minPos <= MAX_SERIES_POSITION) {
        const missing: number[] = [];
        for (let i = minPos; i <= maxPos; i++) {
          if (!intPositions.includes(i)) missing.push(i);
        }
        if (missing.length <= MAX_GAPS_TO_FILL) {
          for (const pos of missing) {
            await addMissingBook(series, pos, primaryAuthor, primaryAuthorId);
          }
        }
      }
    }
  }

  // Fix missing years
  for (const book of missingYears) {
    console.log(`   📅 "${book.title}" missing publication year`);
    await fixMissingYear(book);
  }

  return true;
}

async function main() {
  console.log(
    `\n🔍 Series Audit${FIX_MODE ? " (FIX MODE)" : " (DRY RUN)"}${YEARS_ONLY ? " [years only]" : ""}`
  );
  console.log(`${"=".repeat(60)}`);
  console.log(`   Max gaps to fill per series: ${MAX_GAPS_TO_FILL}`);
  console.log(`   Max series position: ${MAX_SERIES_POSITION}`);
  console.log(`   Valid year range: ${MIN_VALID_YEAR}-${MAX_VALID_YEAR}`);
  console.log(`   OL request cap: ${OL_REQUESTS_CAP}`);
  console.log(`${"=".repeat(60)}\n`);

  const allSeries = await getAllSeries();
  totalSeries = allSeries.length;
  console.log(`Found ${totalSeries} series to audit\n`);

  let issuesFound = 0;
  for (const series of allSeries) {
    if (issuesFound >= LIMIT) {
      console.log(`\n⏹️  Reached limit of ${LIMIT} series with issues.`);
      break;
    }
    if (olRequestCount >= OL_REQUESTS_CAP) {
      console.log(`\n⏹️  Reached OL request cap of ${OL_REQUESTS_CAP}.`);
      break;
    }
    const hadIssues = await auditSeries(series);
    if (hadIssues) issuesFound++;
    seriesAudited++;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`\n📊 Summary:`);
  console.log(`   Total series: ${totalSeries}`);
  console.log(`   Series audited: ${seriesAudited}`);
  console.log(`   Comic/manga skipped (gap-fill): ${skippedComicManga}`);
  console.log(`   Series missing book 1: ${seriesMissingBook1}`);
  console.log(`   Series with position gaps: ${seriesWithGaps}`);
  console.log(`   Books missing publication year: ${booksMissingYear}`);
  console.log(`   Books added/linked: ${booksAdded}`);
  console.log(`   Years fixed: ${yearsFixed}`);
  console.log(`   OL requests made: ${olRequestCount}`);
  console.log(
    `\n${FIX_MODE ? "✅ Fixes applied." : "ℹ️  Run with --fix to apply changes."}`
  );
}

main().catch(console.error);

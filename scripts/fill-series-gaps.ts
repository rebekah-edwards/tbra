/**
 * fill-series-gaps.ts — Overnight script to find and add missing books in series
 *
 * Uses Brave Search to identify missing books, then OpenLibrary to import them.
 * Enrichment runs via the standard pipeline (no Brave for enrichment itself).
 *
 * Usage: npx tsx scripts/fill-series-gaps.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY!;
const BRAVE_DELAY_MS = 1200; // stay well under rate limit
const OL_DELAY_MS = 500;

interface GapEntry {
  seriesId: string;
  seriesName: string;
  position: number;
  author: string;
  userCount: number;
}

interface OLWork {
  key: string;
  title: string;
  cover_i?: number;
  first_publish_year?: number;
  number_of_pages_median?: number;
  author_name?: string[];
  isbn?: string[];
}

// ─── Load gaps from database ───
function loadGaps(): GapEntry[] {
  const rows = db.prepare(`
    SELECT s.id as series_id, s.name as series_name,
           GROUP_CONCAT(DISTINCT CAST(bs.position_in_series AS INTEGER)) as positions,
           MAX(CAST(bs.position_in_series AS INTEGER)) as max_pos,
           AVG(b.pages) as avg_pages,
           COUNT(DISTINCT bs.book_id) as book_count,
           COUNT(DISTINCT ubs.user_id) as user_count
    FROM series s
    JOIN book_series bs ON bs.series_id = s.id
    JOIN books b ON b.id = bs.book_id
    LEFT JOIN user_book_state ubs ON ubs.book_id = bs.book_id
    WHERE bs.position_in_series IS NOT NULL
      AND CAST(bs.position_in_series AS INTEGER) = bs.position_in_series
      AND bs.position_in_series > 0
      AND b.is_box_set = 0
    GROUP BY s.id
    HAVING book_count >= 2 AND max_pos <= 20
    ORDER BY user_count DESC, book_count DESC
  `).all() as any[];

  const gaps: GapEntry[] = [];

  for (const row of rows) {
    const positions = new Set(row.positions.split(",").map(Number));
    const maxPos = row.max_pos;
    if (row.avg_pages && row.avg_pages < 100) continue; // skip comics

    // Get author
    const authorRow = db.prepare(`
      SELECT DISTINCT a.name FROM authors a
      JOIN book_authors ba ON ba.author_id = a.id
      JOIN book_series bs ON bs.book_id = ba.book_id
      WHERE bs.series_id = ? LIMIT 1
    `).get(row.series_id) as any;
    const author = authorRow?.name || "unknown";

    for (let pos = 1; pos <= maxPos; pos++) {
      if (!positions.has(pos)) {
        gaps.push({
          seriesId: row.series_id,
          seriesName: row.series_name,
          position: pos,
          author,
          userCount: row.user_count,
        });
      }
    }

    // Max 5 gaps per series
    const seriesGaps = gaps.filter(g => g.seriesId === row.series_id);
    if (seriesGaps.length > 5) {
      // Remove excess
      const excess = seriesGaps.slice(5);
      for (const e of excess) {
        const idx = gaps.indexOf(e);
        if (idx >= 0) gaps.splice(idx, 1);
      }
    }
  }

  return gaps;
}

// ─── Brave Search ───
async function braveSearch(seriesName: string, position: number, author: string): Promise<string | null> {
  // Multiple search strategies, from most to least specific
  const queries = [
    `"${seriesName}" "book ${position}" ${author} title`,
    `${seriesName} #${position} ${author} novel goodreads`,
    `${seriesName} series book ${position} ${author}`,
  ];

  for (const query of queries) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`;
      const res = await fetch(url, {
        headers: { "X-Subscription-Token": BRAVE_API_KEY },
      });
      if (!res.ok) {
        console.error(`  Brave error: ${res.status}`);
        await sleep(BRAVE_DELAY_MS);
        continue;
      }
      const data = await res.json();
      const results = data.web?.results || [];

      // Look through results for a specific book title (not the series name itself)
      for (const r of results) {
        const title = r.title || "";
        const desc = r.description || "";
        const combined = `${title} ${desc}`.toLowerCase();

        // Skip results that are just about the series, not a specific book
        if (title.toLowerCase().trim() === seriesName.toLowerCase().trim()) continue;
        if (title.toLowerCase().includes("series") && !title.toLowerCase().includes("book")) continue;

        // Look for Goodreads or Amazon links which tend to have clean book titles
        if (r.url?.includes("goodreads.com/book/") || r.url?.includes("amazon.com")) {
          // Check if it mentions the right position
          if (combined.includes(`#${position}`) || combined.includes(`book ${position}`) ||
              combined.includes(`vol. ${position}`) || combined.includes(`volume ${position}`)) {
            // Extract title: "Book Title (Series, #N)" → "Book Title"
            let cleanTitle = title
              .replace(/\s*\(.*\)\s*$/, "")
              .replace(/\s*\|.*$/, "")
              .replace(/\s*:\s*Amazon.*$/i, "")
              .replace(/\s*by\s+.*$/i, "")
              .replace(/\s*-\s*Kindle.*$/i, "")
              .trim();
            if (cleanTitle.length > 3 && cleanTitle.length < 200) {
              return cleanTitle;
            }
          }
        }
      }

      await sleep(BRAVE_DELAY_MS);
    } catch (err) {
      console.error(`  Brave search error:`, err);
    }
  }

  return null;
}

// ─── OpenLibrary Search ───
async function searchOpenLibrary(title: string, author: string): Promise<OLWork | null> {
  try {
    const query = `${title} ${author}`.trim();
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5&fields=key,title,cover_i,first_publish_year,number_of_pages_median,author_name,isbn`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (!data.docs || data.docs.length === 0) return null;

    // Find best match — prefer one with cover and matching author
    const authorLower = author.toLowerCase();
    const titleLower = title.toLowerCase();

    for (const doc of data.docs) {
      const docTitle = (doc.title || "").toLowerCase();
      const docAuthors = (doc.author_name || []).map((a: string) => a.toLowerCase());

      // Title should be similar
      if (!docTitle.includes(titleLower.slice(0, 10)) && !titleLower.includes(docTitle.slice(0, 10))) continue;

      // Author should match
      if (docAuthors.some((a: string) => a.includes(authorLower.split(" ").pop()!))) {
        return doc;
      }
    }

    // Fallback: first result if title matches reasonably
    const first = data.docs[0];
    if (first && (first.title || "").toLowerCase().includes(titleLower.slice(0, 8))) {
      return first;
    }

    return null;
  } catch (err) {
    console.error(`  OL search error:`, err);
    return null;
  }
}

// ─── Check if book already exists ───
function bookExists(olKey: string | null, title: string, author: string): boolean {
  if (olKey) {
    const existing = db.prepare("SELECT id FROM books WHERE open_library_key = ?").get(olKey);
    if (existing) return true;
  }

  // Fuzzy title+author check
  const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const existing = db.prepare(`
    SELECT b.id FROM books b
    JOIN book_authors ba ON ba.book_id = b.id
    JOIN authors a ON a.id = ba.author_id
    WHERE LOWER(REPLACE(REPLACE(REPLACE(b.title, ' ', ''), '-', ''), '''', '')) LIKE ?
    AND LOWER(a.name) LIKE ?
    LIMIT 1
  `).get(`%${normalized.slice(0, 20)}%`, `%${author.split(" ").pop()?.toLowerCase()}%`);

  return !!existing;
}

// ─── Create slug ───
function createSlug(title: string, author: string): string {
  const base = `${title}-${author}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return base;
}

// ─── Insert book ───
function insertBook(
  title: string,
  author: string,
  olWork: OLWork | null,
  seriesId: string,
  position: number
): string | null {
  const bookId = crypto.randomUUID();
  const authorId = crypto.randomUUID();
  const slug = createSlug(title, author);

  const olKey = olWork?.key?.replace("/works/", "") || null;
  const coverUrl = olWork?.cover_i
    ? `https://covers.openlibrary.org/b/id/${olWork.cover_i}-L.jpg`
    : null;
  const year = olWork?.first_publish_year || null;
  const pages = olWork?.number_of_pages_median || null;
  let isbn13 = olWork?.isbn?.find((i: string) => i.length === 13) || null;

  // Check if ISBN already exists (different edition of same book)
  if (isbn13) {
    const existingIsbn = db.prepare("SELECT id FROM books WHERE isbn_13 = ?").get(isbn13);
    if (existingIsbn) isbn13 = null; // skip ISBN to avoid conflict
  }

  // Check if already exists
  if (bookExists(olKey, title, author)) {
    // Book exists — just link to series if not already linked
    let existingId: string | null = null;
    if (olKey) {
      const row = db.prepare("SELECT id FROM books WHERE open_library_key = ?").get(olKey) as any;
      if (row) existingId = row.id;
    }
    if (!existingId) {
      const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
      const row = db.prepare(`
        SELECT b.id FROM books b
        JOIN book_authors ba ON ba.book_id = b.id
        JOIN authors a ON a.id = ba.author_id
        WHERE LOWER(REPLACE(REPLACE(REPLACE(b.title, ' ', ''), '-', ''), '''', '')) LIKE ?
        AND LOWER(a.name) LIKE ?
        LIMIT 1
      `).get(`%${normalized.slice(0, 20)}%`, `%${author.split(" ").pop()?.toLowerCase()}%`) as any;
      if (row) existingId = row.id;
    }

    if (existingId) {
      // Check if series link exists
      const link = db.prepare(
        "SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?"
      ).get(existingId, seriesId);
      if (!link) {
        db.prepare(
          "INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)"
        ).run(existingId, seriesId, position);
        console.log(`  ↳ Linked existing book to series at position ${position}`);
      } else {
        console.log(`  ↳ Already linked to series`);
      }
      return existingId;
    }
    return null;
  }

  // Insert new book
  db.prepare(`
    INSERT INTO books (id, title, slug, open_library_key, cover_image_url, publication_year,
                       pages, isbn_13, visibility, is_box_set)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', 0)
  `).run(bookId, title, slug, olKey, coverUrl, year, pages, isbn13);

  // Find or create author
  let existingAuthor = db.prepare(
    "SELECT id FROM authors WHERE LOWER(name) = LOWER(?)"
  ).get(author) as any;

  let finalAuthorId = existingAuthor?.id;
  if (!finalAuthorId) {
    const authorSlug = author.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
    db.prepare("INSERT INTO authors (id, name, slug) VALUES (?, ?, ?)").run(authorId, author, authorSlug);
    finalAuthorId = authorId;
  }

  // Link book to author
  db.prepare("INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)").run(bookId, finalAuthorId);

  // Link book to series
  db.prepare(
    "INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)"
  ).run(bookId, seriesId, position);

  // Add enrichment log entry so nightly enrichment picks it up
  db.prepare(`
    INSERT INTO enrichment_log (id, book_id, status, source, started_at)
    VALUES (?, ?, 'pending', 'series-gap-fill', datetime('now'))
  `).run(crypto.randomUUID(), bookId);

  return bookId;
}

// ─── Main ───
async function main() {
  const gaps = loadGaps();
  console.log(`\n📚 Series Gap Filler — ${gaps.length} missing books across ${new Set(gaps.map(g => g.seriesId)).size} series\n`);

  let found = 0;
  let linked = 0;
  let notFound = 0;
  let errors = 0;

  // Group by series for nicer output
  let currentSeries = "";

  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];

    if (gap.seriesName !== currentSeries) {
      currentSeries = gap.seriesName;
      const userTag = gap.userCount > 0 ? ` [${gap.userCount} users]` : "";
      console.log(`\n─── ${gap.seriesName} by ${gap.author}${userTag} ───`);
    }

    console.log(`  Searching for book #${gap.position}...`);

    // Search Brave for the book title
    const braveTitle = await braveSearch(gap.seriesName, gap.position, gap.author);

    if (!braveTitle) {
      console.log(`  ✗ No results from Brave`);
      notFound++;
      continue;
    }

    console.log(`  Brave found: "${braveTitle}"`);

    // Search OpenLibrary for the book
    const olWork = await searchOpenLibrary(braveTitle, gap.author);
    await sleep(OL_DELAY_MS);

    if (!olWork) {
      console.log(`  ✗ Not found on OpenLibrary`);
      notFound++;
      continue;
    }

    console.log(`  OL match: "${olWork.title}" (${olWork.first_publish_year || "?"}) — ${olWork.number_of_pages_median || "?"} pages`);

    try {
      const bookId = insertBook(olWork.title, gap.author, olWork, gap.seriesId, gap.position);
      if (bookId) {
        found++;
        console.log(`  ✓ Added as position #${gap.position}`);
      } else {
        linked++;
      }
    } catch (err: any) {
      console.error(`  ✗ Insert error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`Done! Found: ${found}, Linked existing: ${linked}, Not found: ${notFound}, Errors: ${errors}`);
  console.log(`Total: ${found + linked} books added/linked to series`);
  console.log(`${found} new books queued for nightly enrichment`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);

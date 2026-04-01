/**
 * backfill-metadata.ts — Fill missing book metadata using ISBNdb + Google Books + LoC
 *
 * Prioritizes books with user activity (states, ratings, reviews).
 * Rate-limited: ISBNdb (3/sec, 15K/day), Google Books (1K/day).
 *
 * Usage: npx tsx scripts/backfill-metadata.ts [--limit N] [--covers-only] [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const ISBNDB_KEY = process.env.ISBNDB_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const ISBNDB_DELAY = 350; // ms between calls (3/sec limit)
const GOOGLE_DELAY = 100;

const args = process.argv.slice(2);
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "15000", 10);
const coversOnly = args.includes("--covers-only");
const dryRun = args.includes("--dry-run");

interface BookRow {
  id: string;
  title: string;
  isbn13: string | null;
  isbn10: string | null;
  cover_image_url: string | null;
  description: string | null;
  pages: number | null;
  publication_year: number | null;
  publisher: string | null;
  user_count: number;
}

// Get books needing data, prioritized by user activity
function getBooksToBacfill(): BookRow[] {
  const query = coversOnly
    ? `SELECT b.id, b.title, b.isbn_13 as isbn13, b.isbn_10 as isbn10,
              b.cover_image_url, b.description, b.pages, b.publication_year, b.publisher,
              COUNT(DISTINCT ubs.user_id) as user_count
       FROM books b
       LEFT JOIN user_book_state ubs ON ubs.book_id = b.id
       WHERE b.visibility = 'public' AND b.cover_image_url IS NULL
       GROUP BY b.id
       ORDER BY user_count DESC, b.title
       LIMIT ?`
    : `SELECT b.id, b.title, b.isbn_13 as isbn13, b.isbn_10 as isbn10,
              b.cover_image_url, b.description, b.pages, b.publication_year, b.publisher,
              COUNT(DISTINCT ubs.user_id) as user_count
       FROM books b
       LEFT JOIN user_book_state ubs ON ubs.book_id = b.id
       WHERE b.visibility = 'public'
         AND (b.cover_image_url IS NULL OR b.description IS NULL OR b.pages IS NULL
              OR b.publication_year IS NULL OR b.publisher IS NULL)
       GROUP BY b.id
       ORDER BY user_count DESC, b.title
       LIMIT ?`;

  return db.prepare(query).all(limit) as BookRow[];
}

async function fetchISBNdb(isbn: string): Promise<any> {
  if (!ISBNDB_KEY) return null;
  await sleep(ISBNDB_DELAY);
  try {
    const res = await fetch(`https://api2.isbndb.com/book/${isbn}`, {
      headers: { Authorization: ISBNDB_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.book ?? null;
  } catch {
    return null;
  }
}

async function fetchISBNdbByTitle(title: string, author: string): Promise<any> {
  if (!ISBNDB_KEY) return null;
  await sleep(ISBNDB_DELAY);
  try {
    const query = encodeURIComponent(`${title} ${author}`.trim());
    const res = await fetch(`https://api2.isbndb.com/books/${query}?pageSize=3&column=title`, {
      headers: { Authorization: ISBNDB_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const books = data.books ?? [];
    // Return first result with matching title
    const titleLower = title.toLowerCase();
    return books.find((b: any) => (b.title || "").toLowerCase().includes(titleLower.slice(0, 15))) ?? books[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchGoogleBooks(title: string, author: string): Promise<any> {
  if (!GOOGLE_KEY) return null;
  await sleep(GOOGLE_DELAY);
  try {
    const query = encodeURIComponent(`${title} ${author}`.trim());
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=3&key=${GOOGLE_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0]?.volumeInfo ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const books = getBooksToBacfill();
  console.log(`Found ${books.length} books to backfill${coversOnly ? " (covers only)" : ""}`);
  if (dryRun) {
    console.log("Dry run — not making changes");
    for (const b of books.slice(0, 20)) {
      console.log(`  ${b.title} — isbn:${b.isbn13 || "none"} cover:${b.cover_image_url ? "yes" : "NO"} desc:${b.description ? "yes" : "NO"} pages:${b.pages || "NO"} year:${b.publication_year || "NO"}`);
    }
    return;
  }

  let isbndbCalls = 0;
  let googleCalls = 0;
  let updated = 0;
  let coversFound = 0;
  let descriptionsFound = 0;

  // Get author names for books
  const authorStmt = db.prepare(`
    SELECT a.name FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    WHERE ba.book_id = ? LIMIT 1
  `);

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (i % 100 === 0) {
      console.log(`Progress: ${i}/${books.length} (${updated} updated, ${coversFound} covers, ${descriptionsFound} descs) | ISBNdb: ${isbndbCalls} | Google: ${googleCalls}`);
    }

    const authorRow = authorStmt.get(book.id) as { name: string } | undefined;
    const author = authorRow?.name || "";

    const updates: Record<string, unknown> = {};

    // Try ISBNdb first (15K/day budget)
    if (isbndbCalls < 14500) {
      const isbndb = book.isbn13
        ? await fetchISBNdb(book.isbn13)
        : book.isbn10
          ? await fetchISBNdb(book.isbn10)
          : await fetchISBNdbByTitle(book.title, author);
      isbndbCalls++;

      if (isbndb) {
        if (!book.cover_image_url && isbndb.image && !isbndb.image.includes("placeholder")) {
          updates.cover_image_url = isbndb.image;
          updates.cover_source = "isbndb";
          updates.cover_verified = 1;
          coversFound++;
        }
        if (!book.description && isbndb.synopsis) {
          const desc = stripHtml(isbndb.synopsis);
          if (desc.length > 20) {
            updates.description = desc;
            descriptionsFound++;
          }
        }
        if (!book.pages && isbndb.pages && isbndb.pages > 20) updates.pages = isbndb.pages;
        if (!book.publication_year && isbndb.date_published) {
          const m = isbndb.date_published.match(/(\d{4})/);
          if (m) {
            const y = parseInt(m[1], 10);
            if (y >= 1900 && y <= 2027) updates.publication_year = y;
          }
        }
        if (!book.publisher && isbndb.publisher) updates.publisher = isbndb.publisher;
        if (!book.isbn13 && isbndb.isbn13) {
          // Check for ISBN collision before setting
          const existing = db.prepare("SELECT id FROM books WHERE isbn_13 = ? AND id != ?").get(isbndb.isbn13, book.id);
          if (!existing) updates.isbn_13 = isbndb.isbn13;
        }
      }
    }

    // Try Google Books for cover if still missing (1K/day budget)
    if (!book.cover_image_url && !updates.cover_image_url && googleCalls < 950) {
      const gbook = await fetchGoogleBooks(book.title, author);
      googleCalls++;

      if (gbook) {
        const imageLinks = gbook.imageLinks;
        if (imageLinks) {
          const coverUrl = (imageLinks.thumbnail || imageLinks.smallThumbnail || "")
            .replace("zoom=1", "zoom=2")
            .replace("http://", "https://");
          if (coverUrl) {
            updates.cover_image_url = coverUrl;
            updates.cover_source = "google_books";
            updates.cover_verified = 1;
            coversFound++;
          }
        }
        // Also grab description/pages/year from Google if still missing
        if (!book.description && !updates.description && gbook.description) {
          updates.description = gbook.description;
          descriptionsFound++;
        }
        if (!book.pages && !updates.pages && gbook.pageCount) updates.pages = gbook.pageCount;
        if (!book.publication_year && !updates.publication_year && gbook.publishedDate) {
          const m = gbook.publishedDate.match(/(\d{4})/);
          if (m) updates.publication_year = parseInt(m[1], 10);
        }
        if (!book.publisher && !updates.publisher && gbook.publisher) updates.publisher = gbook.publisher;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const setClauses = Object.entries(updates)
        .map(([k, v]) => `${k} = ?`)
        .join(", ");
      const values = [...Object.values(updates), book.id];
      db.prepare(`UPDATE books SET ${setClauses} WHERE id = ?`).run(...values);
      updated++;
    }
  }

  console.log(`\nDone!`);
  console.log(`Updated: ${updated} books`);
  console.log(`Covers found: ${coversFound}`);
  console.log(`Descriptions found: ${descriptionsFound}`);
  console.log(`ISBNdb calls: ${isbndbCalls}`);
  console.log(`Google Books calls: ${googleCalls}`);
}

main().catch(console.error);

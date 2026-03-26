/**
 * Backfill Open Library data for books missing OL keys.
 * Handles two cases:
 * 1. OL work not in DB yet → update the existing book record with OL data
 * 2. OL work already in DB as separate entry → merge user data to the OL entry, delete the minimal one
 * Run with: npx tsx scripts/backfill-ol.ts
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "data/tbra.db");
const OL_BASE = "https://openlibrary.org";
const DELAY = 600;

const db = new Database(DB_PATH);

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

interface OLSearchResult {
  key: string;
  title: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  number_of_pages_median?: number;
}

async function searchOL(query: string): Promise<OLSearchResult[]> {
  const url = `${OL_BASE}/search.json?q=${encodeURIComponent(query)}&limit=5&fields=key,title,author_name,author_key,first_publish_year,cover_i,isbn,number_of_pages_median`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.docs ?? [];
}

async function fetchWork(workKey: string) {
  const res = await fetch(`${OL_BASE}${workKey}.json`);
  if (!res.ok) return null;
  const data = await res.json();
  const desc = data.description;
  const description = typeof desc === "string" ? desc : desc?.value ?? null;
  return {
    title: data.title as string | undefined,
    description,
    coverId: data.covers?.[0] ?? null,
    subjects: (data.subjects ?? []) as string[],
  };
}

function buildCoverUrl(coverId: number | null | undefined): string | null {
  if (!coverId) return null;
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
}

async function findOldestHardcoverCover(workKey: string): Promise<{ coverId: number | null; year: number | null }> {
  try {
    const res = await fetch(`${OL_BASE}${workKey}/editions.json?limit=50`);
    if (!res.ok) return { coverId: null, year: null };
    const data = await res.json();
    const editions = data.entries ?? [];
    let bestCoverId: number | null = null;
    let bestYear: number | null = null;
    for (const ed of editions) {
      const format = (ed.physical_format ?? "").toLowerCase();
      const isHardcover = format.includes("hardcover") || format.includes("hardback");
      const covers = ed.covers?.filter((c: number) => c > 0) ?? [];
      const year = ed.publish_date ? parseInt(ed.publish_date.match(/\d{4}/)?.[0] ?? "") : null;
      if (isHardcover && covers.length > 0) {
        if (!bestYear || (year && year < bestYear)) {
          bestCoverId = covers[0];
          bestYear = year || bestYear;
        }
      }
    }
    return { coverId: bestCoverId, year: bestYear };
  } catch {
    return { coverId: null, year: null };
  }
}

const GENRE_MAP: Record<string, string> = {
  "literary fiction": "Literary Fiction",
  "science fiction": "Sci-Fi",
  "fantasy": "Fantasy",
  "romance": "Romance",
  "mystery": "Mystery",
  "thriller": "Thriller",
  "thrillers": "Thriller",
  "horror": "Horror",
  "historical fiction": "Historical Fiction",
  "young adult": "Young Adult",
  "nonfiction": "Nonfiction",
  "biography": "Biography",
  "memoir": "Memoir",
  "self-help": "Self-Help",
  "true crime": "True Crime",
  "poetry": "Poetry",
  "humor": "Humor",
  "adventure": "Adventure",
  "dystopian": "Dystopian",
  "crime": "Crime",
};

function normalizeGenres(subjects: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of subjects) {
    const lower = s.toLowerCase().trim();
    const mapped = GENRE_MAP[lower];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }
  return result.slice(0, 6);
}

// Tables that reference book_id and need to be migrated during merge
const FK_TABLES = [
  "user_book_state",
  "user_book_ratings",
  "reading_sessions",
  "user_book_reviews",
  "user_book_dimension_ratings",
  "user_owned_editions",
  "user_favorite_books",
  "reading_notes",
];

function mergeBookInto(fromId: string, toId: string) {
  // Move user data from fromId to toId (ignore conflicts — toId may already have entries)
  for (const table of FK_TABLES) {
    try {
      db.prepare(`UPDATE OR IGNORE ${table} SET book_id = ? WHERE book_id = ?`).run(toId, fromId);
      // Delete any remaining rows that conflicted
      db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(fromId);
    } catch {
      // Table might not exist or have different structure
    }
  }

  // Clean up book-level references
  db.prepare("DELETE FROM book_genres WHERE book_id = ?").run(fromId);
  db.prepare("DELETE FROM book_authors WHERE book_id = ?").run(fromId);
  db.prepare("DELETE FROM book_series WHERE book_id = ?").run(fromId);
  try { db.prepare("DELETE FROM book_category_ratings WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM editions WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM book_narrators WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM citations WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM rating_citations WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM links WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM report_corrections WHERE book_id = ?").run(fromId); } catch {}
  try { db.prepare("DELETE FROM review_helpful_votes WHERE review_id IN (SELECT id FROM user_book_reviews WHERE book_id = ?)").run(fromId); } catch {}

  // Delete the minimal book
  db.prepare("DELETE FROM books WHERE id = ?").run(fromId);
}

async function main() {
  const booksWithoutOL = db.prepare(`
    SELECT b.id, b.title, a.name as author_name
    FROM books b
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
    WHERE b.open_library_key IS NULL
    ORDER BY b.title
  `).all() as { id: string; title: string; author_name: string | null }[];

  console.log(`Found ${booksWithoutOL.length} books without OL keys`);

  let matched = 0;
  let merged = 0;
  let noMatch = 0;
  let errors = 0;

  for (let i = 0; i < booksWithoutOL.length; i++) {
    const book = booksWithoutOL[i];
    const progress = `[${i + 1}/${booksWithoutOL.length}]`;

    try {
      const query = book.author_name
        ? `${book.title} ${book.author_name}`
        : book.title;

      await delay(DELAY);
      const results = await searchOL(query);

      const normTitle = normalize(book.title);
      const match = results.find((r) => {
        const normResult = normalize(r.title);
        if (normResult === normTitle) return true;
        if (normResult.includes(normTitle) || normTitle.includes(normResult)) return true;
        const resultWords = normResult.split(" ");
        const titleWords = normTitle.split(" ");
        const resultSet = new Set(resultWords);
        const titleSet = new Set(titleWords);
        const overlapFromTitle = titleWords.filter((w) => resultSet.has(w)).length;
        const overlapFromResult = resultWords.filter((w) => titleSet.has(w)).length;
        return (
          titleWords.length > 1 &&
          resultWords.length > 1 &&
          overlapFromTitle / titleWords.length >= 0.5 &&
          overlapFromResult / resultWords.length >= 0.4
        );
      });

      if (match) {
        // Check if this OL work already exists in the DB
        const existingOL = db.prepare(
          "SELECT id FROM books WHERE open_library_key = ?"
        ).get(match.key) as { id: string } | undefined;

        if (existingOL) {
          // MERGE: move user data from minimal book to existing OL book
          mergeBookInto(book.id, existingOL.id);
          merged++;
          console.log(`${progress} ⇄ Merged "${book.title}" → existing OL entry (${match.key})`);
        } else {
          // UPDATE: enrich the minimal book with OL data
          await delay(300);
          const work = await fetchWork(match.key);
          if (!work) {
            console.log(`${progress} ⚠ Work fetch failed: "${book.title}"`);
            errors++;
            continue;
          }

          const { coverId: hcCoverId, year: edYear } = await findOldestHardcoverCover(match.key);
          const coverUrl =
            buildCoverUrl(hcCoverId) ??
            buildCoverUrl(work.coverId) ??
            buildCoverUrl(match.cover_i);

          const genreNames = normalizeGenres(work.subjects);
          const bookTitle = work.title || match.title;

          db.prepare(`
            UPDATE books SET
              title = ?,
              description = ?,
              publication_year = ?,
              isbn_13 = ?,
              isbn_10 = ?,
              pages = ?,
              cover_image_url = ?,
              open_library_key = ?,
              is_fiction = ?
            WHERE id = ?
          `).run(
            bookTitle,
            work.description,
            match.first_publish_year ?? edYear,
            match.isbn?.find((i: string) => i.length === 13) ?? null,
            match.isbn?.find((i: string) => i.length === 10) ?? null,
            match.number_of_pages_median,
            coverUrl,
            match.key,
            genreNames.some((g) => ["Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime"].includes(g)) ? 0 : 1,
            book.id
          );

          // Add genres
          const existingGenreCount = db.prepare(
            "SELECT COUNT(*) as cnt FROM book_genres WHERE book_id = ?"
          ).get(book.id) as { cnt: number };

          if (existingGenreCount.cnt === 0) {
            for (const genreName of genreNames) {
              let genre = db.prepare("SELECT id FROM genres WHERE name = ?").get(genreName) as { id: string } | undefined;
              if (!genre) {
                const id = crypto.randomUUID();
                db.prepare("INSERT INTO genres (id, name) VALUES (?, ?)").run(id, genreName);
                genre = { id };
              }
              db.prepare("INSERT OR IGNORE INTO book_genres (book_id, genre_id) VALUES (?, ?)").run(book.id, genre.id);
            }
          }

          matched++;
          console.log(`${progress} ✓ "${book.title}" → OL: ${match.key}`);
        }
      } else {
        noMatch++;
        console.log(`${progress} ✗ No match: "${book.title}"`);
      }
    } catch (err) {
      errors++;
      console.log(`${progress} ✗ Error: "${book.title}":`, (err as Error).message);
    }
  }

  console.log(`\nDone! Matched: ${matched}, Merged: ${merged}, No match: ${noMatch}, Errors: ${errors}`);
  db.close();
}

main().catch(console.error);

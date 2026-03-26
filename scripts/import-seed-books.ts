/**
 * Seed script: imports one book per author from Open Library,
 * then cascades to pull in all other works by each author.
 *
 * Run: npx tsx scripts/import-seed-books.ts
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "../src/db/schema";

const {
  books,
  authors,
  bookAuthors,
  genres,
  bookGenres,
} = schema;

// ─── DB setup (mirrors src/db/index.ts) ───
const dbPath = path.join(process.cwd(), "data", "tbra.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

// ─── Open Library helpers (inline to avoid Next.js imports) ───
const BASE_URL = "https://openlibrary.org";
const COVERS_URL = "https://covers.openlibrary.org";
const USER_AGENT = "tbra/0.1.0 (https://github.com/rebekah-edwards/tbra)";

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

async function olFetch(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": USER_AGENT } });
}

async function searchOL(query: string, limit = 5): Promise<OLSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    fields:
      "key,title,author_name,author_key,first_publish_year,cover_i,isbn,number_of_pages_median",
    sort: "editions",
  });
  const res = await olFetch(`${BASE_URL}/search.json?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.docs ?? [];
}

async function fetchWork(workKey: string) {
  const res = await olFetch(`${BASE_URL}${workKey}.json`);
  if (!res.ok) return { description: null, coverId: null, subjects: [] as string[] };
  const data = await res.json();
  const desc = data.description;
  return {
    description: desc
      ? typeof desc === "string"
        ? desc
        : desc.value ?? null
      : null,
    coverId: (data.covers?.[0] as number) ?? null,
    subjects: (data.subjects ?? []) as string[],
  };
}

function buildCoverUrl(coverId: number | null | undefined, size: "S" | "M" | "L" = "M"): string | null {
  if (!coverId) return null;
  return `${COVERS_URL}/b/id/${coverId}-${size}.jpg`;
}

// ─── Genre normalization (from openlibrary.ts) ───
const GENRE_MAP: Record<string, string> = {
  "literary fiction": "Literary Fiction",
  "science fiction": "Sci-Fi",
  fantasy: "Fantasy",
  romance: "Romance",
  mystery: "Mystery",
  thriller: "Thriller",
  thrillers: "Thriller",
  horror: "Horror",
  "historical fiction": "Historical Fiction",
  "young adult": "Young Adult",
  "young adult fiction": "Young Adult",
  "children's fiction": "Children's",
  children: "Children's",
  biography: "Biography",
  memoir: "Memoir",
  autobiography: "Memoir",
  "self-help": "Self-Help",
  philosophy: "Philosophy",
  poetry: "Poetry",
  drama: "Drama",
  humor: "Humor",
  dystopia: "Dystopia",
  "dystopian fiction": "Dystopia",
  adventure: "Adventure",
  classics: "Classics",
  "classic literature": "Classics",
  "gothic fiction": "Gothic",
  gothic: "Gothic",
  "magical realism": "Magical Realism",
  paranormal: "Paranormal",
  crime: "Crime",
  "crime fiction": "Crime",
  war: "War",
  "war fiction": "War",
  "psychological fiction": "Psychological Fiction",
  "graphic novels": "Graphic Novel",
  comics: "Graphic Novel",
  nonfiction: "Nonfiction",
  "non-fiction": "Nonfiction",
  "true crime": "True Crime",
  mythology: "Mythology",
  "fairy tales": "Fairy Tales",
  afrofuturism: "Afrofuturism",
  contemporary: "Contemporary",
  "contemporary fiction": "Contemporary",
  suspense: "Suspense",
  "dark fantasy": "Dark Fantasy",
  "epic fantasy": "Epic Fantasy",
  "urban fantasy": "Urban Fantasy",
  "space opera": "Space Opera",
  survival: "Survival",
  "political fiction": "Political Fiction",
  satire: "Satire",
  "speculative fiction": "Speculative Fiction",
  literary: "Literary Fiction",
  "domestic fiction": "Domestic Fiction",
  "love stories": "Romance",
};

const NOISE_SUBJECTS = new Set([
  "accessible book", "protected daisy", "in library", "lending library",
  "new york times bestseller", "nyt:bestseller", "open library staff picks",
  "popular print disabled books", "long now manual for civilization",
  "large type books", "reading level", "fiction, general", "general",
  "literature", "american literature", "english literature", "british literature",
  "american fiction", "english fiction", "fiction",
]);

const NONFICTION_GENRES = new Set([
  "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
]);

function normalizeGenres(subjects: string[]): string[] {
  const g = new Set<string>();
  for (const s of subjects) {
    const lower = s.toLowerCase().trim();
    if (NOISE_SUBJECTS.has(lower)) continue;
    const mapped = GENRE_MAP[lower];
    if (mapped) g.add(mapped);
  }
  return Array.from(g).slice(0, 6);
}

function detectIsFiction(genreNames: string[]): boolean {
  return !genreNames.some((g) => NONFICTION_GENRES.has(g));
}

// ─── DB helpers ───

async function findOrCreateAuthor(name: string, olKey?: string): Promise<string> {
  let author = await db.query.authors.findFirst({
    where: eq(authors.name, name),
  });
  if (author) {
    if (olKey && !author.openLibraryKey) {
      await db.update(authors).set({ openLibraryKey: olKey }).where(eq(authors.id, author.id));
    }
    return author.id;
  }
  const [created] = await db
    .insert(authors)
    .values({ name, openLibraryKey: olKey ?? null })
    .returning();
  return created.id;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importCascadeBooks(authorOlKeys: string[]) {
  for (const authorKey of authorOlKeys) {
    await delay(400);
    const res = await olFetch(`${BASE_URL}/authors/${authorKey}/works.json?limit=50`);
    if (!res.ok) continue;
    const data = await res.json();
    const works = data.entries ?? [];

    for (const work of works) {
      const workKey = work.key as string;
      const existing = await db.query.books.findFirst({
        where: eq(books.openLibraryKey, workKey),
      });
      if (existing) continue;

      const coverUrl = buildCoverUrl(work.covers?.[0], "L");

      await delay(200);
      const [newBook] = await db
        .insert(books)
        .values({
          title: work.title,
          coverImageUrl: coverUrl,
          openLibraryKey: workKey,
        })
        .returning();

      const author = await db.query.authors.findFirst({
        where: eq(authors.openLibraryKey, authorKey),
      });
      if (author) {
        await db.insert(bookAuthors).values({ bookId: newBook.id, authorId: author.id }).onConflictDoNothing();
      }
      console.log(`    cascade: ${work.title}`);
    }
  }
}

// ─── Main import ───

interface SeedEntry {
  query: string;
  author: string;
}

const SEED_BOOKS: SeedEntry[] = [
  { query: "Harry Potter and the Sorcerer's Stone", author: "J. K. Rowling" },
  { query: "The Shadow of What Was Lost", author: "James Islington" },
  { query: "The Way of Kings", author: "Brandon Sanderson" },
  { query: "The Way of Shadows", author: "Brent Weeks" },
  { query: "My Best Friend's Exorcism", author: "Grady Hendrix" },
  { query: "Leviathan Wakes", author: "James S. A. Corey" },
  { query: "We Are Legion (We Are Bob)", author: "Dennis E. Taylor" },
];

async function importSeedBook(entry: SeedEntry) {
  console.log(`\n--- Searching: "${entry.query}" by ${entry.author} ---`);

  const results = await searchOL(entry.query, 5);
  if (!results.length) {
    console.log("  No results found, skipping.");
    return;
  }

  // Find best match: prefer result where author matches
  const match =
    results.find(
      (r) =>
        r.author_name?.some((a) =>
          a.toLowerCase().includes(entry.author.split(" ").pop()!.toLowerCase())
        )
    ) ?? results[0];

  console.log(`  Found: "${match.title}" (${match.key}) by ${match.author_name?.join(", ")}`);

  // Check if already imported
  const existing = await db.query.books.findFirst({
    where: eq(books.openLibraryKey, match.key),
  });
  if (existing) {
    console.log(`  Already imported (id: ${existing.id}), skipping.`);
    return;
  }

  // Fetch work details
  await delay(350);
  const work = await fetchWork(match.key);
  const coverUrl = buildCoverUrl(work.coverId, "L") ?? buildCoverUrl(match.cover_i, "L");

  const genreNames = normalizeGenres(work.subjects);
  const isFiction = detectIsFiction(genreNames);

  // Insert book
  const [book] = await db
    .insert(books)
    .values({
      title: match.title,
      description: work.description,
      publicationYear: match.first_publish_year,
      isbn13: match.isbn?.find((i) => i.length === 13) ?? null,
      isbn10: match.isbn?.find((i) => i.length === 10) ?? null,
      pages: match.number_of_pages_median,
      coverImageUrl: coverUrl,
      openLibraryKey: match.key,
      isFiction,
    })
    .returning();

  console.log(`  Inserted book: ${book.id}`);

  // Authors
  const authorOlKeys: string[] = [];
  if (match.author_name?.length) {
    for (let i = 0; i < match.author_name.length; i++) {
      const name = match.author_name[i];
      const olKey = match.author_key?.[i];
      const authorId = await findOrCreateAuthor(name, olKey);
      await db.insert(bookAuthors).values({ bookId: book.id, authorId });
      if (olKey) authorOlKeys.push(olKey);
    }
  }

  // Genres
  for (const genreName of genreNames) {
    let genre = await db.query.genres.findFirst({
      where: eq(genres.name, genreName),
    });
    if (!genre) {
      [genre] = await db.insert(genres).values({ name: genreName }).returning();
    }
    await db.insert(bookGenres).values({ bookId: book.id, genreId: genre.id });
  }
  console.log(`  Genres: ${genreNames.join(", ") || "(none)"}`);

  // Cascade import
  if (authorOlKeys.length > 0) {
    console.log(`  Cascading for ${authorOlKeys.length} author(s)...`);
    await importCascadeBooks(authorOlKeys);
  }
}

async function main() {
  console.log("=== tbra Seed Import ===");
  console.log(`Database: ${dbPath}\n`);

  for (const entry of SEED_BOOKS) {
    try {
      await importSeedBook(entry);
      await delay(500); // Be polite to OL API between authors
    } catch (err) {
      console.error(`  ERROR importing "${entry.query}":`, err);
    }
  }

  console.log("\n=== Done ===");

  // Print summary
  const allBooks = await db.query.books.findMany();
  const allAuthors = await db.query.authors.findMany();
  console.log(`Total books: ${allBooks.length}`);
  console.log(`Total authors: ${allAuthors.length}`);

  sqlite.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

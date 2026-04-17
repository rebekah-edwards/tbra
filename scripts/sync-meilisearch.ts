/**
 * Sync local SQLite data to Meilisearch Cloud indexes.
 *
 * Usage:
 *   npx tsx scripts/sync-meilisearch.ts           # Full sync
 *   npx tsx scripts/sync-meilisearch.ts --books    # Books only
 *   npx tsx scripts/sync-meilisearch.ts --authors  # Authors only
 *   npx tsx scripts/sync-meilisearch.ts --series   # Series only
 *
 * Requires MEILISEARCH_HOST and MEILISEARCH_ADMIN_KEY in .env.local
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Meilisearch } from "meilisearch";
import Database from "better-sqlite3";
import path from "path";

const host = process.env.MEILISEARCH_HOST;
const adminKey = process.env.MEILISEARCH_ADMIN_KEY;
if (!host || !adminKey) {
  console.error("Missing MEILISEARCH_HOST or MEILISEARCH_ADMIN_KEY in .env.local");
  process.exit(1);
}

const client = new Meilisearch({ host, apiKey: adminKey });
const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const args = process.argv.slice(2);
const syncBooks = args.length === 0 || args.includes("--books");
const syncAuthors = args.length === 0 || args.includes("--authors");
const syncSeries = args.length === 0 || args.includes("--series");

async function syncBooksIndex() {
  console.log("Syncing books index...");

  const index = client.index("books");

  // Configure index settings
  // — Ranking rules: `exactness` moved ahead of `typo`/`proximity` so exact
  //   title matches beat fuzzy ones. Previously exactness was last, which
  //   let "The Hate U Give" outrank "The Giver" on typo-based ranking.
  // — Typo tolerance tightened: short words (< 6 chars like "Giver", "Dune",
  //   "Carl") now require exact match. Was causing "Give" to match "Giver".
  await index.updateSettings({
    searchableAttributes: ["title", "authorNames", "seriesName"],
    filterableAttributes: ["visibility", "isBoxSet"],
    sortableAttributes: ["publicationYear", "title"],
    rankingRules: ["words", "exactness", "typo", "proximity", "attribute", "sort"],
    stopWords: ["the", "a", "an", "and", "of", "in", "to", "for", "is", "on", "by"],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 6, twoTypos: 10 },
    },
  });

  // Fetch all public, non-box-set books
  const books = db.prepare(`
    SELECT id, title, slug, cover_image_url, publication_year, isbn_13
    FROM books
    WHERE visibility = 'public' AND is_box_set = 0
  `).all() as {
    id: string;
    title: string;
    slug: string | null;
    cover_image_url: string | null;
    publication_year: number | null;
    isbn_13: string | null;
  }[];

  // Fetch all authors grouped by book
  const authorRows = db.prepare(`
    SELECT ba.book_id, a.name
    FROM book_authors ba
    INNER JOIN authors a ON a.id = ba.author_id
  `).all() as { book_id: string; name: string }[];

  const authorsByBook = new Map<string, string[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.book_id) ?? [];
    list.push(row.name);
    authorsByBook.set(row.book_id, list);
  }

  // Fetch series names by book
  const seriesRows = db.prepare(`
    SELECT bs.book_id, s.name
    FROM book_series bs
    INNER JOIN series s ON s.id = bs.series_id
  `).all() as { book_id: string; name: string }[];

  const seriesByBook = new Map<string, string>();
  for (const row of seriesRows) {
    seriesByBook.set(row.book_id, row.name);
  }

  // Build documents
  const documents = books.map((b) => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    coverImageUrl: b.cover_image_url,
    publicationYear: b.publication_year,
    isbn13: b.isbn_13,
    authorNames: (authorsByBook.get(b.id) ?? []).join(" "),
    seriesName: seriesByBook.get(b.id) ?? "",
  }));

  // Batch upload in chunks of 5000
  const CHUNK_SIZE = 5000;
  for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
    const chunk = documents.slice(i, i + CHUNK_SIZE);
    await index.addDocuments(chunk);
    console.log(`  Uploaded books ${i + 1}-${Math.min(i + CHUNK_SIZE, documents.length)} of ${documents.length}`);
  }

  console.log(`Books: ${documents.length} documents synced`);
}

async function syncAuthorsIndex() {
  console.log("Syncing authors index...");

  const index = client.index("authors");

  await index.updateSettings({
    searchableAttributes: ["name"],
    sortableAttributes: ["bookCount", "name"],
    rankingRules: ["words", "exactness", "typo", "proximity", "attribute", "sort"],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 6, twoTypos: 10 },
    },
  });

  const rows = db.prepare(`
    SELECT a.id, a.name, a.slug, COUNT(ba.book_id) as book_count
    FROM authors a
    INNER JOIN book_authors ba ON ba.author_id = a.id
    GROUP BY a.id
  `).all() as { id: string; name: string; slug: string | null; book_count: number }[];

  const documents = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    bookCount: r.book_count,
  }));

  await index.addDocuments(documents);
  console.log(`Authors: ${documents.length} documents synced`);
}

async function syncSeriesIndex() {
  console.log("Syncing series index...");

  const index = client.index("series");

  await index.updateSettings({
    searchableAttributes: ["name"],
    sortableAttributes: ["bookCount", "name"],
    rankingRules: ["words", "exactness", "typo", "proximity", "attribute", "sort"],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 6, twoTypos: 10 },
    },
  });

  const rows = db.prepare(`
    SELECT s.id, s.name, s.slug, COUNT(bs.book_id) as book_count
    FROM series s
    LEFT JOIN book_series bs ON bs.series_id = s.id
    GROUP BY s.id
  `).all() as { id: string; name: string; slug: string | null; book_count: number }[];

  const documents = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    bookCount: r.book_count,
  }));

  await index.addDocuments(documents);
  console.log(`Series: ${documents.length} documents synced`);
}

async function main() {
  console.log(`Syncing to Meilisearch at ${host}`);

  if (syncBooks) await syncBooksIndex();
  if (syncAuthors) await syncAuthorsIndex();
  if (syncSeries) await syncSeriesIndex();

  console.log("Done!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});

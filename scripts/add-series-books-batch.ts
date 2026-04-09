/**
 * Add missing books for three LitRPG series:
 *   1. All the Dust That Falls (books 2-4)
 *   2. Noobtown / Mayor of Noobtown (books 2-9)
 *   3. New Realm Online / RE-ROLL (books 2-7)
 *
 * Runs against both local SQLite and Turso. Idempotent — reruns are safe
 * thanks to deterministic UUIDs and existence checks.
 *
 * After all creates, triggers enrichment on Turso-side new books.
 */

import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

// ─── DB Abstraction (same pattern as fix-gl-sleepers-series.ts) ───

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      const normalized = sql.trim().toUpperCase();
      const isSelect = normalized.startsWith("SELECT");
      const stmt = db.prepare(sql);
      if (isSelect) {
        return { rows: stmt.all(...(args as never[])) as Record<string, unknown>[] };
      }
      stmt.run(...(args as never[]));
      return { rows: [] };
    },
  };
}

function wrapRemote(client: Client): DbLike {
  return {
    label: "turso",
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return {
        rows: res.rows.map((r) => ({ ...r } as unknown as Record<string, unknown>)),
      };
    },
  };
}

// ─── Helpers ───

function makeSlug(title: string, author: string): string {
  return `${title}-${author}`
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeSeriesSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Series Definitions ───

interface BookDef {
  id: string;
  title: string;
  year: number;
  isbn13: string | null;
  position: number;
}

interface SeriesDef {
  seriesId: string;
  seriesName: string;
  authorName: string;
  authorId: string;
  description: string;
  book1Slug: string;
  books: BookDef[];
}

const SERIES: SeriesDef[] = [
  // ── Series 1: All the Dust That Falls ──
  {
    seriesId: "a1d2e3f4-5678-4abc-9def-111111111001",
    seriesName: "All the Dust That Falls",
    authorName: "Zaifyr",
    authorId: "a1d2e3f4-5678-4abc-9def-222222222001",
    description:
      "A sentient Roomba vacuum cleaner is isekai'd into a fantasy world and levels up by cleaning, inadvertently becoming one of the most powerful beings in the realm.",
    book1Slug: "all-the-dust-that-falls-an-isekai-litrpg-adventure-zaifyr",
    books: [
      { id: "b1c2d3e4-5678-4abc-9def-333333333002", title: "All the Dust That Falls 2", year: 2024, isbn13: "9798878214742", position: 2 },
      { id: "b1c2d3e4-5678-4abc-9def-333333333003", title: "All the Dust That Falls 3", year: 2024, isbn13: "9798324663957", position: 3 },
      { id: "b1c2d3e4-5678-4abc-9def-333333333004", title: "All the Dust That Falls 4", year: 2024, isbn13: "9798338396247", position: 4 },
    ],
  },
  // ── Series 2: Noobtown ──
  {
    seriesId: "a1d2e3f4-5678-4abc-9def-111111111002",
    seriesName: "Noobtown",
    authorName: "Ryan Rimmel",
    authorId: "a1d2e3f4-5678-4abc-9def-222222222002",
    description:
      "A LitRPG adventure series where the protagonist finds himself in charge of a small, underdeveloped town in a game-like fantasy world and must build it up while leveling his own abilities.",
    book1Slug: "the-mayor-of-noobtown-ryan-rimmel",
    books: [
      { id: "b1c2d3e4-5678-4abc-9def-444444444002", title: "Village of Noobtown", year: 2019, isbn13: null, position: 2 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444003", title: "Castle of the Noobs", year: 2020, isbn13: null, position: 3 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444004", title: "Dungeons and Noobs", year: 2020, isbn13: null, position: 4 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444005", title: "Noob Game Plus", year: 2021, isbn13: null, position: 5 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444006", title: "Nautical Noobs", year: 2021, isbn13: null, position: 6 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444007", title: "Tower of the Noobs", year: 2022, isbn13: null, position: 7 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444008", title: "The War of the Noobs", year: 2024, isbn13: null, position: 8 },
      { id: "b1c2d3e4-5678-4abc-9def-444444444009", title: "The Noob Returns", year: 2025, isbn13: null, position: 9 },
    ],
  },
  // ── Series 3: New Realm Online ──
  {
    seriesId: "a1d2e3f4-5678-4abc-9def-111111111003",
    seriesName: "New Realm Online",
    authorName: "Robyn Wideman",
    authorId: "a1d2e3f4-5678-4abc-9def-222222222003",
    description:
      "A LitRPG fantasy where the protagonist gets a chance to re-roll their character in a virtual world with real consequences.",
    book1Slug: "re-roll-robyn-wideman",
    books: [
      { id: "b1c2d3e4-5678-4abc-9def-555555555002", title: "Goon Squad", year: 2021, isbn13: null, position: 2 },
      { id: "b1c2d3e4-5678-4abc-9def-555555555003", title: "Granny's Goons", year: 2021, isbn13: null, position: 3 },
      { id: "b1c2d3e4-5678-4abc-9def-555555555004", title: "Broken Bones", year: 2022, isbn13: null, position: 4 },
      { id: "b1c2d3e4-5678-4abc-9def-555555555005", title: "Empire of the Rose", year: 2022, isbn13: null, position: 5 },
      { id: "b1c2d3e4-5678-4abc-9def-555555555006", title: "Heroic Deeds", year: 2023, isbn13: null, position: 6 },
      { id: "b1c2d3e4-5678-4abc-9def-555555555007", title: "Legendary Quest", year: 2023, isbn13: null, position: 7 },
    ],
  },
];

// ─── Migration logic ───

// Track newly created book IDs for enrichment triggering
const newBookIds: string[] = [];

async function processSeries(db: DbLike, s: SeriesDef) {
  console.log(`\n╭─ [${db.label}] Processing series: ${s.seriesName}`);

  // 1) Find or create author
  let authorId: string;
  const existingAuthor = await db.exec(
    `SELECT id FROM authors WHERE name = ? COLLATE NOCASE`,
    [s.authorName],
  );
  if (existingAuthor.rows.length > 0) {
    authorId = existingAuthor.rows[0].id as string;
    console.log(`│  Author "${s.authorName}" exists: ${authorId.slice(0, 8)}...`);
  } else {
    authorId = s.authorId;
    await db.exec(
      `INSERT INTO authors (id, name, slug) VALUES (?, ?, ?)`,
      [authorId, s.authorName, makeSeriesSlug(s.authorName)],
    );
    console.log(`│  Created author "${s.authorName}": ${authorId.slice(0, 8)}...`);
  }

  // 2) Find or create series
  let seriesId: string;
  const existingSeries = await db.exec(
    `SELECT id FROM series WHERE name LIKE ?`,
    [`%${s.seriesName}%`],
  );
  if (existingSeries.rows.length > 0) {
    seriesId = existingSeries.rows[0].id as string;
    console.log(`│  Series "${s.seriesName}" exists: ${seriesId.slice(0, 8)}...`);
  } else {
    seriesId = s.seriesId;
    await db.exec(
      `INSERT INTO series (id, name, slug) VALUES (?, ?, ?)`,
      [seriesId, s.seriesName, makeSeriesSlug(s.seriesName)],
    );
    console.log(`│  Created series "${s.seriesName}": ${seriesId.slice(0, 8)}...`);
  }

  // 3) Find book 1 and ensure it's linked to series + author
  const book1 = await db.exec(
    `SELECT id FROM books WHERE slug = ?`,
    [s.book1Slug],
  );
  if (book1.rows.length > 0) {
    const book1Id = book1.rows[0].id as string;
    console.log(`│  Book 1 exists: ${book1Id.slice(0, 8)}... (slug: ${s.book1Slug})`);

    // Ensure series link at position 1
    const seriesLink = await db.exec(
      `SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?`,
      [book1Id, seriesId],
    );
    if (seriesLink.rows.length === 0) {
      await db.exec(
        `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, 1)`,
        [book1Id, seriesId],
      );
      console.log(`│  Linked book 1 to series at position 1`);
    } else {
      // Update position to 1 in case it's wrong
      await db.exec(
        `UPDATE book_series SET position_in_series = 1 WHERE book_id = ? AND series_id = ?`,
        [book1Id, seriesId],
      );
    }

    // Ensure author link
    const authorLink = await db.exec(
      `SELECT 1 FROM book_authors WHERE book_id = ? AND author_id = ?`,
      [book1Id, authorId],
    );
    if (authorLink.rows.length === 0) {
      await db.exec(
        `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        [book1Id, authorId],
      );
      console.log(`│  Linked book 1 to author`);
    }
  } else {
    console.log(`│  WARNING: Book 1 not found (slug: ${s.book1Slug})`);
  }

  // 4) Add each missing book
  for (const book of s.books) {
    const slug = makeSlug(book.title, s.authorName);

    // Check if already exists by ID, ISBN, or title similarity
    let existingId: string | null = null;

    const byId = await db.exec(`SELECT id FROM books WHERE id = ?`, [book.id]);
    if (byId.rows.length > 0) {
      existingId = byId.rows[0].id as string;
    }

    if (!existingId && book.isbn13) {
      const byIsbn = await db.exec(`SELECT id FROM books WHERE isbn_13 = ?`, [book.isbn13]);
      if (byIsbn.rows.length > 0) {
        existingId = byIsbn.rows[0].id as string;
      }
    }

    if (!existingId) {
      const byTitle = await db.exec(
        `SELECT id FROM books WHERE title LIKE ? COLLATE NOCASE`,
        [`%${book.title}%`],
      );
      if (byTitle.rows.length > 0) {
        existingId = byTitle.rows[0].id as string;
      }
    }

    if (existingId) {
      console.log(`│  Book "${book.title}" already exists: ${existingId.slice(0, 8)}...`);
      // Still ensure series + author links
      const sl = await db.exec(
        `SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?`,
        [existingId, seriesId],
      );
      if (sl.rows.length === 0) {
        await db.exec(
          `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
          [existingId, seriesId, book.position],
        );
        console.log(`│    Linked to series at position ${book.position}`);
      } else {
        await db.exec(
          `UPDATE book_series SET position_in_series = ? WHERE book_id = ? AND series_id = ?`,
          [book.position, existingId, seriesId],
        );
      }
      const al = await db.exec(
        `SELECT 1 FROM book_authors WHERE book_id = ? AND author_id = ?`,
        [existingId, authorId],
      );
      if (al.rows.length === 0) {
        await db.exec(
          `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
          [existingId, authorId],
        );
        console.log(`│    Linked to author`);
      }
    } else {
      // Create the book
      await db.exec(
        `INSERT INTO books (id, title, slug, description, summary, isbn_13, publication_year, language, is_fiction, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          book.id,
          book.title,
          slug,
          s.description,
          s.description,
          book.isbn13,
          book.year,
          "English",
          1,
          "public",
        ],
      );
      console.log(`│  CREATED book "${book.title}" (${book.id.slice(0, 8)}..., slug: ${slug})`);

      // Link to author
      await db.exec(
        `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        [book.id, authorId],
      );

      // Link to series
      await db.exec(
        `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
        [book.id, seriesId, book.position],
      );
      console.log(`│    Linked to author + series (pos ${book.position})`);

      // Track for enrichment (only on Turso pass)
      if (db.label === "turso") {
        newBookIds.push(book.id);
      }
    }
  }

  console.log(`╰─ [${db.label}] Done with ${s.seriesName}\n`);
}

async function runAll(db: DbLike) {
  for (const s of SERIES) {
    await processSeries(db, s);
  }
}

// ─── Enrichment triggering ───

async function triggerEnrichment(bookIds: string[]) {
  if (bookIds.length === 0) {
    console.log("No new books to enrich.");
    return;
  }
  console.log(`\n── Triggering enrichment for ${bookIds.length} new books ──`);
  const ENRICH_URL = "https://www.thebasedreader.app/api/enrichment/trigger";
  const ENRICH_SECRET = "f0b279083a1587133e6ef0392228ed21";

  for (const bookId of bookIds) {
    try {
      const res = await fetch(ENRICH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-enrichment-secret": ENRICH_SECRET,
        },
        body: JSON.stringify({ bookId }),
      });
      const text = await res.text();
      console.log(`  Enrichment ${bookId.slice(0, 8)}...: ${res.status} ${text.slice(0, 100)}`);
    } catch (err) {
      console.error(`  Enrichment ${bookId.slice(0, 8)}... FAILED:`, err);
    }
  }
}

// ─── Main ───

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  const local = wrapLocal(localRaw);

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  // Run local first
  await runAll(local);

  if (!tursoUrl || !tursoToken) {
    console.warn("TURSO_* env vars not set — ran against local only");
    return;
  }

  const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });
  const turso = wrapRemote(tursoClient);

  // Run Turso
  await runAll(turso);

  // Trigger enrichment for newly created books (Turso only)
  await triggerEnrichment(newBookIds);

  console.log("\nAll done. Check the series pages to verify.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});

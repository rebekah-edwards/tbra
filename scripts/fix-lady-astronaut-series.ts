/**
 * fix-lady-astronaut-series.ts — resolves the reported issue on
 * /series/lady-astronaut-universe-mary-robinette-kowal ("add the rest of the
 * books in this series").
 *
 * Two defects behind that report:
 *   1. The series is split across TWO series rows — "Lady Astronaut Universe"
 *      (slug lady-astronaut-universe-mary-robinette-kowal, holding only book 1)
 *      and "Lady Astronaut" (slug lady-astronaut, holding books 3, 4 and the
 *      novelette). The reported page therefore shows a single book.
 *   2. Book 2, The Fated Sky (2018), is absent from the catalog entirely.
 *
 * Fix: create The Fated Sky, then move every member onto the canonical series
 * row (the author-suffixed slug, matching the backfill convention and the
 * reported URL) with correct positions. The unnumbered novelette keeps a NULL
 * position. The now-empty "lady-astronaut" series row is deleted.
 *
 * Dual-writes local SQLite and Turso, local first. Idempotent — the book uses a
 * deterministic UUID and every step is existence-checked.
 *
 * Usage: npx tsx scripts/fix-lady-astronaut-series.ts [--apply]
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");

const CANONICAL_SERIES_ID = "baba4bce-cf92-4eb7-a0d0-c8b604a08f3c"; // Lady Astronaut Universe
const LEGACY_SERIES_ID = "79747aad-ddf4-4cf5-921b-5fef17b95df6"; // Lady Astronaut
const AUTHOR_ID = "b4a6cbaf-603e-49ad-a325-c21edc2dbf78"; // Mary Robinette Kowal

// Deterministic id so reruns don't create a second copy.
const FATED_SKY_ID = crypto
  .createHash("sha1")
  .update("book:the-fated-sky-mary-robinette-kowal")
  .digest("hex")
  .slice(0, 32)
  .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

const FATED_SKY = {
  id: FATED_SKY_ID,
  title: "The Fated Sky",
  slug: "the-fated-sky-mary-robinette-kowal",
  description:
    "It is 1961, and the International Aerospace Coalition has established a colony on the moon. Elma York, the noted Lady Astronaut, is working on rotation, flying shuttles on the moon and returning regularly to Earth. But humanity must get a foothold on Mars. The first exploratory mission is being planned, and none of the women astronauts is on the crew list. The International Aerospace Coalition has grave reservations about sending their Lady Astronauts on such a dangerous mission — but the midjourney navigation calculations need a human computer on board, and all the computers are women.",
  publication_year: 2018,
  publication_date: "2018-08-21",
  isbn_13: "9780765398949",
  pages: 384,
  language: "English",
  publisher: "Tor Books",
  cover_image_url: "https://covers.openlibrary.org/b/id/10324448-L.jpg",
  open_library_key: "/works/OL19753582W",
};

// Publication order. The 2013 novelette is unnumbered → NULL position.
const POSITIONS: Record<string, number | null> = {
  [FATED_SKY_ID]: 2,
  "a9f485b9-8e99-4e6b-b90d-a4dc37835bbb": 1, // The Calculating Stars
  "f81b4852-8512-4090-a68c-8c5c2e49ab1d": 3, // The Relentless Moon
  "d47dd2e4-a552-49ec-adaf-726da9c894de": 4, // The Martian Contingency
  "c5ba0ed8-beca-49f5-82ae-91f965967dfa": null, // Lady Astronaut of Mars (novelette)
};

interface DbLike {
  label: string;
  all(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, args?: unknown[]): Promise<void>;
}

async function main() {
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));
  local.pragma("foreign_keys = ON");

  const { remote, shutdown } = await createGuardedTurso({
    name: "fix-lady-astronaut-series",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const dbs: DbLike[] = [
    {
      label: "local",
      async all(sql, args = []) {
        return local.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
      },
      async run(sql, args = []) {
        if (APPLY) local.prepare(sql).run(...(args as never[]));
      },
    },
    {
      label: "turso",
      async all(sql, args = []) {
        const r = await remote.execute({ sql, args: args as never[] });
        return r.rows.map((x) => ({ ...x }) as Record<string, unknown>);
      },
      async run(sql, args = []) {
        if (APPLY) await remote.execute({ sql, args: args as never[] });
      },
    },
  ];

  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (pass --apply to write)");

  for (const db of dbs) {
    console.log(`\n=== ${db.label} ===`);

    // ─── Guard: never let a new row steal an ISBN another book already claims ───
    const isbnHolder = await db.all(
      "SELECT id, title FROM books WHERE isbn_13 = ? AND id != ?",
      [FATED_SKY.isbn_13, FATED_SKY.id],
    );
    const isbn13 = isbnHolder.length === 0 ? FATED_SKY.isbn_13 : null;
    if (isbnHolder.length > 0) {
      console.log(
        `  ! isbn_13 ${FATED_SKY.isbn_13} already held by "${isbnHolder[0].title}" — inserting without it`,
      );
    }

    const slugHolder = await db.all("SELECT id, title FROM books WHERE slug = ? AND id != ?", [
      FATED_SKY.slug,
      FATED_SKY.id,
    ]);
    if (slugHolder.length > 0) {
      console.log(`  !! slug collision with ${slugHolder[0].id} — aborting, needs manual review`);
      continue;
    }

    // ─── 1. Create The Fated Sky ───
    const existing = await db.all("SELECT id FROM books WHERE id = ?", [FATED_SKY.id]);
    if (existing.length > 0) {
      console.log("  book: The Fated Sky already present");
    } else {
      console.log(`  book: creating The Fated Sky (${FATED_SKY.id})`);
      await db.run(
        `INSERT INTO books (id, title, description, publication_year, publication_date, isbn_13,
           pages, language, publisher, cover_image_url, open_library_key, slug, is_fiction,
           is_box_set, cover_verified, cover_source, needs_review, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, 'openlibrary', 0, 'public',
           strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        [
          FATED_SKY.id,
          FATED_SKY.title,
          FATED_SKY.description,
          FATED_SKY.publication_year,
          FATED_SKY.publication_date,
          isbn13,
          FATED_SKY.pages,
          FATED_SKY.language,
          FATED_SKY.publisher,
          FATED_SKY.cover_image_url,
          FATED_SKY.open_library_key,
          FATED_SKY.slug,
        ],
      );
      await db.run(
        "INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')",
        [FATED_SKY.id, AUTHOR_ID],
      );
      // Mirror genres from book 1 of the same series.
      await db.run(
        `INSERT OR IGNORE INTO book_genres (book_id, genre_id)
         SELECT ?, genre_id FROM book_genres WHERE book_id = 'a9f485b9-8e99-4e6b-b90d-a4dc37835bbb'`,
        [FATED_SKY.id],
      );
    }

    // ─── 2. Consolidate onto the canonical series row ───
    for (const [bookId, pos] of Object.entries(POSITIONS)) {
      await db.run("DELETE FROM book_series WHERE book_id = ? AND series_id = ?", [
        bookId,
        LEGACY_SERIES_ID,
      ]);
      await db.run(
        `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)
         ON CONFLICT(book_id, series_id) DO UPDATE SET position_in_series = excluded.position_in_series`,
        [bookId, CANONICAL_SERIES_ID, pos],
      );
    }
    console.log(`  series: ${Object.keys(POSITIONS).length} books linked to canonical series`);

    // ─── 3. Drop the now-empty legacy series row ───
    const leftover = await db.all("SELECT book_id FROM book_series WHERE series_id = ?", [
      LEGACY_SERIES_ID,
    ]);
    if (leftover.length === 0) {
      await db.run("DELETE FROM series WHERE id = ?", [LEGACY_SERIES_ID]);
      console.log("  series: removed empty duplicate 'lady-astronaut' row");
    } else {
      console.log(`  series: legacy row still has ${leftover.length} member(s) — left in place`);
    }

    // ─── Verify ───
    const final = await db.all(
      `SELECT bs.position_in_series pos, b.title, b.publication_year yr
         FROM book_series bs JOIN books b ON b.id = bs.book_id
        WHERE bs.series_id = ? ORDER BY bs.position_in_series`,
      [CANONICAL_SERIES_ID],
    );
    for (const r of final) console.log(`    #${r.pos ?? "-"} ${r.title} (${r.yr})`);
  }

  local.close();
  shutdown();
  process.exit(0);
}

main();

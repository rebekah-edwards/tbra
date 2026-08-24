/**
 * Triage fix (report 2026-08-23): "New X-Men Modern Era Epic Collection —
 * trying to add the second volume & it keeps taking me to the first volume."
 *
 * Root cause: the catalog only ever held volume 1 ("E Is for Extinction",
 * 9781302957964, series pos 1). Volume 2 — "New Worlds", 9781302961268,
 * Marvel, 2025-06-03, 360pp, Grant Morrison — was never ingested, so every
 * search for the series resolves to volume 1. Verified absent on BOTH local
 * and Turso by ISBN and by title before writing.
 *
 * NOT the same book as the existing "New Worlds" (Ethan Van Sciver,
 * 9780785109761, 2002) — that is the original New X-Men Vol. 3 trade.
 *
 * Dual-writes local mirror first, then Turso, then indexes for search.
 * Idempotent: fixed UUID + existence checks.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true });

import { createClient, type Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const BOOK_ID = "9c1f0a72-4f0b-4b6e-9d31-2c7a1e58b402";
const TITLE = "New X-Men Modern Era Epic Collection: New Worlds";
const SLUG = "new-xmen-modern-era-epic-collection-new-worlds-grant-morrison";
const ISBN13 = "9781302961268";
const ISBN10 = "1302961268";
const AUTHOR_ID = "ecba1de6-8cea-4298-b76f-5c6faa9d181d"; // Grant Morrison
const SERIES_ID = "31825250-f581-43ab-8f39-0545d7202d00"; // New X-Men Modern Era Epic Collection
const POSITION = 2;
const DESCRIPTION =
  "Grant Morrison's New X-Men run continues as the team faces the fallout of Cassandra Nova's attack and the destruction of Genosha. Xorn's powers are revealed, Emma Frost joins the school's faculty, and the X-Men are pushed into a wider world of mutant culture, politics and rivalry. Collects New X-Men #117-126 and Annual 2001.";

const APPLY = process.argv.includes("--apply");

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]>;
}

function wrap(label: string, client: Client): DbLike {
  return {
    label,
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return res.rows.map((r) => ({ ...r }) as Record<string, unknown>);
    },
  };
}

async function findExisting(db: DbLike): Promise<string | null> {
  const byId = await db.exec(`SELECT id FROM books WHERE id = ?`, [BOOK_ID]);
  if (byId.length) return byId[0].id as string;
  const byIsbn = await db.exec(
    `SELECT id FROM books WHERE isbn_13 = ? OR isbn_10 = ?`,
    [ISBN13, ISBN10],
  );
  if (byIsbn.length) return byIsbn[0].id as string;
  const bySlug = await db.exec(`SELECT id FROM books WHERE slug = ?`, [SLUG]);
  if (bySlug.length) return bySlug[0].id as string;
  const byTitle = await db.exec(`SELECT id FROM books WHERE title = ? COLLATE NOCASE`, [TITLE]);
  if (byTitle.length) return byTitle[0].id as string;
  return null;
}

async function run(db: DbLike): Promise<string> {
  const existing = await findExisting(db);
  let bookId = existing ?? BOOK_ID;

  if (existing) {
    console.log(`[${db.label}] book already present: ${existing}`);
  } else if (!APPLY) {
    console.log(`[${db.label}] DRY RUN — would INSERT "${TITLE}" as ${BOOK_ID}`);
    return bookId;
  } else {
    await db.exec(
      `INSERT INTO books (id, title, slug, description, isbn_10, isbn_13, pages,
         publication_year, publication_date, language, publisher, is_fiction,
         is_box_set, visibility, needs_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'public', 0)`,
      [
        BOOK_ID,
        TITLE,
        SLUG,
        DESCRIPTION,
        ISBN10,
        ISBN13,
        360,
        2025,
        "2025-06-03",
        "English",
        "Marvel",
      ],
    );
    console.log(`[${db.label}] CREATED book ${BOOK_ID}`);
  }

  if (!APPLY) return bookId;

  // Author link
  await db.exec(
    `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
    [bookId, AUTHOR_ID],
  );

  // Series link at position 2
  const link = await db.exec(
    `SELECT position_in_series FROM book_series WHERE book_id = ? AND series_id = ?`,
    [bookId, SERIES_ID],
  );
  if (link.length === 0) {
    await db.exec(
      `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [bookId, SERIES_ID, POSITION],
    );
    console.log(`[${db.label}] linked to series at position ${POSITION}`);
  } else if (link[0].position_in_series !== POSITION) {
    await db.exec(
      `UPDATE book_series SET position_in_series = ? WHERE book_id = ? AND series_id = ?`,
      [POSITION, bookId, SERIES_ID],
    );
    console.log(`[${db.label}] corrected series position to ${POSITION}`);
  }

  return bookId;
}

async function indexForSearch(local: DbLike, bookId: string) {
  const authorNames = "Grant Morrison";
  const seriesName = "New X-Men Modern Era Epic Collection";

  // Local FTS
  try {
    await local.exec(`DELETE FROM search_index WHERE book_id = ?`, [bookId]);
    await local.exec(
      `INSERT INTO search_index (book_id, title, author_names, series_name) VALUES (?, ?, ?, ?)`,
      [bookId, TITLE, authorNames, seriesName],
    );
    console.log("local FTS: indexed");
  } catch (err) {
    console.warn("local FTS index failed:", err);
  }

  // Meilisearch (production search backend)
  const host = process.env.MEILISEARCH_HOST;
  const key = process.env.MEILISEARCH_ADMIN_KEY;
  if (!host || !key) {
    console.warn("MEILISEARCH_HOST/ADMIN_KEY missing — skipped Meili upsert");
    return;
  }
  const { Meilisearch } = await import("meilisearch");
  const client = new Meilisearch({ host, apiKey: key });
  // Field set must match scripts/sync-meilisearch.ts — a doc missing `slug`
  // is searchable but unlinkable in the nav dropdown.
  const cover = (
    await local.exec(`SELECT cover_image_url FROM books WHERE id = ?`, [bookId])
  )[0]?.cover_image_url as string | null;
  await client.index("books").addDocuments([
    {
      id: bookId,
      title: TITLE,
      slug: SLUG,
      coverImageUrl: cover ?? null,
      publicationYear: 2025,
      isbn13: ISBN13,
      authorNames,
      seriesName,
      visibility: "public",
      isBoxSet: false,
    },
  ]);
  console.log("Meilisearch: upserted");
}

async function main() {
  const local = wrap("local", createClient({ url: "file:data/tbra.db" }));
  const { remote, shutdown } = await createGuardedTurso({
    name: "add-new-xmen-mee-vol2",
    maxRuntimeMs: 5 * 60_000,
  });
  const turso = wrap("turso", remote);

  const localId = await run(local);
  const tursoId = await run(turso);

  if (APPLY) {
    if (localId !== tursoId) {
      console.error(`MISMATCH: local=${localId} turso=${tursoId}`);
    } else {
      await indexForSearch(local, localId);
    }

    // Verify
    for (const db of [local, turso]) {
      const rows = await db.exec(
        `SELECT b.id, b.title, b.slug, b.isbn_13, bs.position_in_series
           FROM books b LEFT JOIN book_series bs ON bs.book_id = b.id
          WHERE b.id = ?`,
        [localId],
      );
      console.log(`VERIFY [${db.label}]`, JSON.stringify(rows));
    }
  }

  shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});

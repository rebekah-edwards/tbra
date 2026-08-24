/**
 * Ensure the COMPLETE "New X-Men Modern Era Epic Collection" is in the catalog.
 *
 * Origin (report 2026-08-22): "trying to add the second volume & it keeps
 * taking me to the first volume." Two causes — a dedup bug in the add path
 * (fixed in 8c60852) and the plain fact that only volume 1 had ever been
 * ingested. Volume 2 was added 2026-08-24; a follow-up check found volume 3
 * was missing too, so this script now defines the WHOLE series and is the
 * completeness check: re-run it any time and it reports or fills gaps.
 *
 * Grant Morrison's New X-Men run is issues #114-154, collected in exactly
 * three volumes (Planet X is billed by the publisher as concluding the run):
 *   1. E Is for Extinction  #114-126 + Annual 2001
 *   2. New Worlds           #127-141
 *   3. Planet X             #142-154
 * Issue coverage is contiguous with no gap, which is the evidence the series
 * is complete rather than merely "three we happened to find".
 *
 * All volume data verified against Penguin Random House and Marvel listings.
 * Dual-writes local mirror first, then Turso, then indexes for search.
 * Idempotent: fixed UUIDs + existence checks. Dry-run unless --apply.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true });

import { createClient, type Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const AUTHOR_ID = "ecba1de6-8cea-4298-b76f-5c6faa9d181d"; // Grant Morrison
const SERIES_ID = "31825250-f581-43ab-8f39-0545d7202d00";
const SERIES_NAME = "New X-Men Modern Era Epic Collection";
const AUTHOR_NAME = "Grant Morrison";

interface Vol {
  position: number;
  id: string;
  title: string;
  slug: string;
  isbn13: string;
  isbn10: string;
  year: number;
  date: string;
  pages: number;
  description: string;
}

const VOLUMES: Vol[] = [
  {
    position: 1,
    id: "4f4c5339-4949-47d0-bb2c-3998bd6189e9", // pre-existing
    title: "New X-Men Modern Era Epic Collection: E Is for Extinction",
    slug: "new-xmen-modern-era-epic-collection-e-is-for-extinction-grant-morrison",
    isbn13: "9781302957964",
    isbn10: "1302957961",
    year: 2024,
    date: "2024-09-24",
    pages: 448,
    description:
      "Grant Morrison's reinvention of the X-Men begins. Genosha is destroyed, a new mutant threat named Cassandra Nova emerges, and the team trades spandex for black leather as Xavier's dream is remade for a world where mutants are the coming majority. Collects New X-Men #114-126 and Annual 2001.",
  },
  {
    position: 2,
    id: "9c1f0a72-4f0b-4b6e-9d31-2c7a1e58b402",
    title: "New X-Men Modern Era Epic Collection: New Worlds",
    slug: "new-xmen-modern-era-epic-collection-new-worlds-grant-morrison",
    isbn13: "9781302961268",
    isbn10: "1302961268",
    year: 2025,
    date: "2025-06-03",
    pages: 360,
    description:
      "Grant Morrison's New X-Men run continues as the team faces the fallout of Cassandra Nova's attack and the destruction of Genosha. Xorn's powers are revealed, Emma Frost joins the school's faculty, and the X-Men are pushed into a wider world of mutant culture, politics and rivalry. Collects New X-Men #127-141.",
  },
  {
    position: 3,
    id: "b7d4e103-5c26-4a91-8f47-1de930c62a55",
    title: "New X-Men Modern Era Epic Collection: Planet X",
    slug: "new-xmen-modern-era-epic-collection-planet-x-grant-morrison",
    isbn13: "9781302967109",
    isbn10: "130296710X",
    year: 2026,
    date: "2026-06-16",
    pages: 336,
    description:
      "The conclusion of Grant Morrison's New X-Men. Wolverine and Cyclops assault Weapon Plus, Xorn's true identity is revealed and the Institute falls, and the story leaps 150 years forward for a final look at what the dream became. Collects New X-Men #142-154.",
  },
];

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

async function findExisting(db: DbLike, v: Vol): Promise<string | null> {
  for (const [sql, args] of [
    [`SELECT id FROM books WHERE id = ?`, [v.id]],
    [`SELECT id FROM books WHERE isbn_13 = ? OR isbn_10 = ?`, [v.isbn13, v.isbn10]],
    [`SELECT id FROM books WHERE slug = ?`, [v.slug]],
    [`SELECT id FROM books WHERE title = ? COLLATE NOCASE`, [v.title]],
  ] as [string, unknown[]][]) {
    const r = await db.exec(sql, args);
    if (r.length) return r[0].id as string;
  }
  return null;
}

async function ensureVolume(db: DbLike, v: Vol): Promise<{ id: string; created: boolean }> {
  const existing = await findExisting(db, v);

  if (!existing) {
    if (!APPLY) {
      console.log(`  [${db.label}] vol ${v.position} MISSING — would create "${v.title}"`);
      return { id: v.id, created: true };
    }
    await db.exec(
      `INSERT INTO books (id, title, slug, description, isbn_10, isbn_13, pages,
         publication_year, publication_date, language, publisher, is_fiction,
         is_box_set, visibility, needs_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'English', 'Marvel', 1, 0, 'public', 0)`,
      [v.id, v.title, v.slug, v.description, v.isbn10, v.isbn13, v.pages, v.year, v.date],
    );
    console.log(`  [${db.label}] vol ${v.position} CREATED — ${v.title}`);
  } else if (existing !== v.id) {
    console.log(`  [${db.label}] vol ${v.position} present under a different id: ${existing}`);
  } else {
    console.log(`  [${db.label}] vol ${v.position} already present`);
  }

  const id = existing ?? v.id;
  if (!APPLY) return { id, created: !existing };

  await db.exec(
    `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
    [id, AUTHOR_ID],
  );
  const link = await db.exec(
    `SELECT position_in_series p FROM book_series WHERE book_id = ? AND series_id = ?`,
    [id, SERIES_ID],
  );
  if (!link.length) {
    await db.exec(
      `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [id, SERIES_ID, v.position],
    );
    console.log(`      linked to series at position ${v.position}`);
  } else if (link[0].p !== v.position) {
    await db.exec(
      `UPDATE book_series SET position_in_series = ? WHERE book_id = ? AND series_id = ?`,
      [v.position, id, SERIES_ID],
    );
    console.log(`      corrected series position ${link[0].p} -> ${v.position}`);
  }
  return { id, created: !existing };
}

async function indexForSearch(local: DbLike, ids: string[]) {
  const host = process.env.MEILISEARCH_HOST;
  const key = process.env.MEILISEARCH_ADMIN_KEY;
  const { Meilisearch } = await import("meilisearch");
  const client = host && key ? new Meilisearch({ host, apiKey: key }) : null;
  const docs: Record<string, unknown>[] = [];

  for (const id of ids) {
    const row = (await local.exec(
      `SELECT title, slug, cover_image_url, publication_year, isbn_13 FROM books WHERE id = ?`,
      [id],
    ))[0];
    if (!row) continue;
    try {
      await local.exec(`DELETE FROM search_index WHERE book_id = ?`, [id]);
      await local.exec(
        `INSERT INTO search_index (book_id, title, author_names, series_name) VALUES (?, ?, ?, ?)`,
        [id, row.title, AUTHOR_NAME, SERIES_NAME],
      );
    } catch (err) {
      console.warn("  local FTS failed:", err);
    }
    // Field set must match scripts/sync-meilisearch.ts — a doc missing `slug`
    // is searchable but unlinkable in the nav dropdown.
    docs.push({
      id,
      title: row.title,
      slug: row.slug,
      coverImageUrl: row.cover_image_url ?? null,
      publicationYear: row.publication_year,
      isbn13: row.isbn_13,
      authorNames: AUTHOR_NAME,
      seriesName: SERIES_NAME,
      visibility: "public",
      isBoxSet: false,
    });
  }
  if (client && docs.length) {
    await client.index("books").addDocuments(docs);
    console.log(`  Meilisearch: upserted ${docs.length} doc(s)`);
  }
}

async function main() {
  const local = wrap("local", createClient({ url: "file:data/tbra.db" }));
  const { remote, shutdown } = await createGuardedTurso({
    name: "add-new-xmen-mee-volumes",
    maxRuntimeMs: 5 * 60_000,
  });
  const turso = wrap("turso", remote);

  console.log(`${SERIES_NAME} — ${VOLUMES.length} volumes defined (issues #114-154)\n`);
  const created: string[] = [];
  for (const v of VOLUMES) {
    console.log(`vol ${v.position}: ${v.title}`);
    const l = await ensureVolume(local, v);
    const t = await ensureVolume(turso, v);
    if (l.id !== t.id) console.error(`  !! ID MISMATCH local=${l.id} turso=${t.id}`);
    if (l.created || t.created) created.push(l.id);
    console.log("");
  }

  if (APPLY) {
    if (created.length) await indexForSearch(local, created);

    console.log("\n=== VERIFY ===");
    for (const db of [local, turso]) {
      const rows = await db.exec(
        `SELECT bs.position_in_series p, b.title, b.isbn_13
           FROM book_series bs JOIN books b ON b.id = bs.book_id
          WHERE bs.series_id = ? ORDER BY bs.position_in_series`,
        [SERIES_ID],
      );
      const ok = rows.length === VOLUMES.length &&
        rows.every((r, i) => r.p === VOLUMES[i].position && r.isbn_13 === VOLUMES[i].isbn13);
      console.log(`[${db.label}] ${rows.length}/${VOLUMES.length} volumes — ${ok ? "COMPLETE" : "INCOMPLETE"}`);
      rows.forEach((r) => console.log(`   #${r.p} ${r.title} (${r.isbn_13})`));
      if (!ok) process.exitCode = 1;
    }
  }

  shutdown();
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });

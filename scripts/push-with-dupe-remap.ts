/**
 * push-with-dupe-remap.ts
 *
 * Pushes taxonomy migration ratings to Turso with book-id remapping for local
 * dupes:
 *   1. Diff books — find local-only book_ids.
 *   2. For each, check Turso by slug / isbn_13 for a canonical dup.
 *   3. Build a local_id → remote_canonical_id map.
 *   4. For the 3 truly-missing books, INSERT them to Turso (no OR IGNORE).
 *   5. Push touched book_category_ratings, using the remapped book_id where
 *      applicable. INSERT OR REPLACE keyed on (id). On unique(book_id,
 *      category_id) conflict, SQLite REPLACE drops the old row and inserts
 *      ours — net effect: our row wins.
 */

require("dotenv").config({ path: ".env.vercel.local" });
const { createClient } = require("@libsql/client");
const Database = require("better-sqlite3");
const path = require("path");

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

const CHUNK = 200;

(async () => {
  const t0 = Date.now();

  // Step 1-3: Build remap
  console.log("→ Building book-id remap from slug/isbn dupes on Turso");
  const localBooks = local.prepare(`SELECT id, slug, isbn_13 FROM books`).all() as Array<{
    id: string;
    slug: string | null;
    isbn_13: string | null;
  }>;

  console.log("  fetching all remote book (id, slug, isbn_13)...");
  type RemoteBook = { id: string; slug: string | null; isbn_13: string | null };
  const remoteBooks: RemoteBook[] = [];
  let offset = 0;
  const page = 5000;
  while (true) {
    const r = await remote.execute(
      `SELECT id, slug, isbn_13 FROM books ORDER BY id LIMIT ${page} OFFSET ${offset}`,
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) {
      remoteBooks.push({
        id: String(row.id),
        slug: row.slug ?? null,
        isbn_13: row.isbn_13 ?? null,
      });
    }
    if (r.rows.length < page) break;
    offset += page;
  }
  console.log(`  ${remoteBooks.length} remote books fetched`);

  const remoteIds = new Set(remoteBooks.map((b) => b.id));
  const remoteSlugToId = new Map<string, string>();
  const remoteIsbnToId = new Map<string, string>();
  for (const b of remoteBooks) {
    if (b.slug) remoteSlugToId.set(b.slug, b.id);
    if (b.isbn_13) remoteIsbnToId.set(b.isbn_13, b.id);
  }

  const remap = new Map<string, string>(); // local_id → remote_canonical_id
  const trulyMissing: typeof localBooks = [];
  for (const b of localBooks) {
    if (remoteIds.has(b.id)) continue;
    const slugMatch = b.slug ? remoteSlugToId.get(b.slug) : undefined;
    const isbnMatch = b.isbn_13 ? remoteIsbnToId.get(b.isbn_13) : undefined;
    if (slugMatch) remap.set(b.id, slugMatch);
    else if (isbnMatch) remap.set(b.id, isbnMatch);
    else trulyMissing.push(b);
  }
  console.log(`  remapped (local → remote canonical): ${remap.size}`);
  console.log(`  truly missing (will INSERT to remote): ${trulyMissing.length}`);

  // Step 4: INSERT truly-missing books
  if (trulyMissing.length > 0) {
    console.log(`\n→ Inserting ${trulyMissing.length} truly-missing books`);
    const cols = local
      .prepare(`PRAGMA table_info(books)`)
      .all()
      .map((r: any) => r.name);

    const ids = trulyMissing.map((b) => b.id);
    const placeholders = ids.map(() => "?").join(",");
    const fullRows = local
      .prepare(`SELECT ${cols.join(",")} FROM books WHERE id IN (${placeholders})`)
      .all(...ids) as any[];

    for (const r of fullRows) {
      try {
        await remote.execute(
          `INSERT INTO books (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
          cols.map((c: string) => r[c]),
        );
        console.log(`  ✓ inserted ${r.id} (${r.slug})`);
      } catch (e: any) {
        console.log(`  ✗ failed ${r.id}: ${e.message.slice(0, 160)}`);
      }
    }
  }

  // Step 5: Push touched ratings with remapped book_ids
  console.log(`\n→ Pushing book_category_ratings (touched today) with dupe remap`);
  const rows = local
    .prepare(
      `SELECT id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at
         FROM book_category_ratings
        WHERE updated_at >= date('now')
        ORDER BY book_id`,
    )
    .all() as Array<{
    id: string;
    book_id: string;
    category_id: string;
    intensity: number;
    notes: string | null;
    evidence_level: string;
    updated_by_user_id: string | null;
    updated_at: string;
  }>;

  // Remap
  let remapped = 0;
  for (const r of rows) {
    const canonical = remap.get(r.book_id);
    if (canonical) {
      r.book_id = canonical;
      remapped++;
    }
  }
  console.log(`  ${rows.length} rows total, ${remapped} rows had book_id remapped`);

  let pushed = 0;
  let failed = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(rows.length / CHUNK);
  const failedBookIds = new Set<string>();

  for (let i = 0; i < rows.length; i += CHUNK) {
    batchNum++;
    const chunk = rows.slice(i, i + CHUNK);
    const statements = chunk.map((r) => ({
      sql: `INSERT OR REPLACE INTO book_category_ratings
              (id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.book_id,
        r.category_id,
        r.intensity,
        r.notes,
        r.evidence_level,
        r.updated_by_user_id,
        r.updated_at,
      ],
    }));

    try {
      await remote.batch(statements, "write");
      pushed += chunk.length;
    } catch (e: any) {
      failed += chunk.length;
      for (const r of chunk) failedBookIds.add(r.book_id);
      if (failed <= CHUNK * 3) {
        console.log(`  ✗ batch ${batchNum}: ${e.message.slice(0, 140)}`);
      }
    }

    if (batchNum % 50 === 0 || batchNum === totalBatches) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `  batch ${batchNum}/${totalBatches}  pushed=${pushed} failed=${failed}  elapsed=${elapsed}s`,
      );
    }
  }

  console.log(`\n────────────────────────────────────`);
  console.log(`Totals: ${pushed} pushed, ${failed} failed`);
  console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failedBookIds.size > 0) {
    console.log(`Unique failed book_ids: ${failedBookIds.size}`);
    console.log(`First 5:`, [...failedBookIds].slice(0, 5));
  }
  local.close();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

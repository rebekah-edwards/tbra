/**
 * push-remaining-serial.ts — Push any book_category_ratings touched today that
 * are NOT yet on Turso (or are stale). Uses individual INSERT OR REPLACE calls
 * so failures are isolated to the actual bad rows rather than a whole batch.
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

(async () => {
  const t0 = Date.now();

  // Build the dupe remap again
  console.log("→ Fetching remote book ids/slugs/isbns/ol_keys");
  const remoteBooks: Array<{ id: string; slug: string | null; isbn_13: string | null; ol: string | null }> = [];
  let offset = 0;
  const page = 5000;
  while (true) {
    const r = await remote.execute(
      `SELECT id, slug, isbn_13, open_library_key FROM books ORDER BY id LIMIT ${page} OFFSET ${offset}`,
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) {
      remoteBooks.push({
        id: String(row.id),
        slug: row.slug ?? null,
        isbn_13: row.isbn_13 ?? null,
        ol: row.open_library_key ?? null,
      });
    }
    if (r.rows.length < page) break;
    offset += page;
  }
  const remoteIds = new Set(remoteBooks.map((b) => b.id));
  const slugMap = new Map<string, string>();
  const isbnMap = new Map<string, string>();
  const olMap = new Map<string, string>();
  for (const b of remoteBooks) {
    if (b.slug) slugMap.set(b.slug, b.id);
    if (b.isbn_13) isbnMap.set(b.isbn_13, b.id);
    if (b.ol) olMap.set(b.ol, b.id);
  }

  const localBooks = local
    .prepare(`SELECT id, slug, isbn_13, open_library_key FROM books`)
    .all() as Array<{
    id: string;
    slug: string | null;
    isbn_13: string | null;
    open_library_key: string | null;
  }>;
  const remap = new Map<string, string>();
  const unmapped: string[] = [];
  for (const b of localBooks) {
    if (remoteIds.has(b.id)) continue;
    const match =
      (b.slug && slugMap.get(b.slug)) ||
      (b.isbn_13 && isbnMap.get(b.isbn_13)) ||
      (b.open_library_key && olMap.get(b.open_library_key));
    if (match) remap.set(b.id, match);
    else unmapped.push(b.id);
  }
  console.log(`  remap: ${remap.size} local-only → remote canonical`);
  console.log(`  truly-unmapped local books: ${unmapped.length}`);

  // Fetch all touched rows (today)
  const rows = local
    .prepare(
      `SELECT id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at
         FROM book_category_ratings
        WHERE updated_at >= date('now')
        ORDER BY book_id`,
    )
    .all() as any[];

  // Apply remap + drop unmapped (skip rows referencing truly-unmapped books)
  const unmappedSet = new Set(unmapped);
  let skipped = 0;
  const toCheck = rows.flatMap((r) => {
    if (unmappedSet.has(r.book_id)) {
      skipped++;
      return [];
    }
    const mapped = remap.get(r.book_id);
    if (mapped) r.book_id = mapped;
    return [r];
  });
  console.log(`  rows to push: ${toCheck.length} (${skipped} skipped — unmapped books)`);

  // Find which rows are MISSING or STALE on Turso. Fast path: grouped probe
  // by book_id (fetch all current rows for each touched book, compare).
  console.log(`\n→ Finding stale/missing rows on Turso`);
  const touchedBookIds = [...new Set(toCheck.map((r) => r.book_id))];
  console.log(`  probing ${touchedBookIds.length} distinct books on Turso`);

  // Fetch current state of touched books' ratings from Turso (in chunks)
  const remoteRatings = new Map<string, any>(); // "bookId|categoryId" → { id, intensity, notes, updated_at }
  const CHUNK_PROBE = 500;
  for (let i = 0; i < touchedBookIds.length; i += CHUNK_PROBE) {
    const chunk = touchedBookIds.slice(i, i + CHUNK_PROBE);
    const placeholders = chunk.map(() => "?").join(",");
    const r = await remote.execute({
      sql: `SELECT id, book_id, category_id, intensity, notes, updated_at FROM book_category_ratings WHERE book_id IN (${placeholders})`,
      args: chunk,
    });
    for (const row of r.rows as any[]) {
      remoteRatings.set(`${row.book_id}|${row.category_id}`, row);
    }
    if ((i / CHUNK_PROBE) % 10 === 0) {
      console.log(`  probed ${Math.min(i + CHUNK_PROBE, touchedBookIds.length)}/${touchedBookIds.length}`);
    }
  }
  console.log(`  ${remoteRatings.size} existing Turso rating rows for touched books`);

  // Filter to rows that differ from Turso state
  const needPush = toCheck.filter((r) => {
    const remote = remoteRatings.get(`${r.book_id}|${r.category_id}`);
    if (!remote) return true; // missing on remote
    // Compare updated_at, intensity, notes
    return (
      remote.intensity !== r.intensity ||
      (remote.notes ?? "") !== (r.notes ?? "") ||
      (remote.updated_at ?? "") < r.updated_at
    );
  });
  console.log(`\n  ${needPush.length} rows need push (different from Turso or missing)`);

  // Push serially (one at a time) to isolate failures
  let ok = 0;
  let fail = 0;
  const failures: Array<{ id: string; book_id: string; category_id: string; err: string }> = [];

  for (let i = 0; i < needPush.length; i++) {
    const r = needPush[i];
    try {
      await remote.execute({
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
      });
      ok++;
    } catch (e: any) {
      fail++;
      failures.push({ id: r.id, book_id: r.book_id, category_id: r.category_id, err: e.message.slice(0, 80) });
    }

    if ((i + 1) % 50 === 0 || i === needPush.length - 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  serial ${i + 1}/${needPush.length}  ok=${ok} fail=${fail}  elapsed=${elapsed}s`);
    }
  }

  console.log(`\n────────────────────────────────────`);
  console.log(`Serial push: ${ok} ok, ${fail} failed`);
  if (failures.length > 0) {
    console.log(`\nFirst 10 failures:`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  book_id=${f.book_id} cat=${f.category_id} id=${f.id}  err=${f.err}`);
    }
  }
  local.close();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

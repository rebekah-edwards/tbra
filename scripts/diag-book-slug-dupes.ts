/**
 * diag-book-slug-dupes.ts — For each local book that's "missing" on Turso by
 * id, check if Turso has a book with the same slug (different id = dup).
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
  // 1. Get all local book ids
  const localBooks = local.prepare(`SELECT id, slug, isbn_13 FROM books`).all() as Array<{
    id: string;
    slug: string | null;
    isbn_13: string | null;
  }>;

  // 2. Fetch all remote book (id, slug, isbn_13)
  console.log("→ Fetching remote books (id, slug, isbn_13)...");
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

  // 3. For each local book not on remote by id, check if slug or isbn_13 matches
  //    a different remote book (dup with different id)
  const missingById = localBooks.filter((b) => !remoteIds.has(b.id));
  console.log(`\n  local-only by id: ${missingById.length}`);

  let dupBySlug = 0;
  let dupByIsbn = 0;
  let trulyMissing = 0;

  for (const b of missingById) {
    const slugMatch = b.slug ? remoteSlugToId.get(b.slug) : undefined;
    const isbnMatch = b.isbn_13 ? remoteIsbnToId.get(b.isbn_13) : undefined;
    if (slugMatch) dupBySlug++;
    else if (isbnMatch) dupByIsbn++;
    else trulyMissing++;
  }

  console.log(`  local-only by id, but slug exists on remote (dup): ${dupBySlug}`);
  console.log(`  local-only by id, but isbn exists on remote (dup): ${dupByIsbn}`);
  console.log(`  truly missing (no match by id/slug/isbn): ${trulyMissing}`);

  // Show first 5 truly missing
  if (trulyMissing > 0) {
    console.log(`\n  First 5 truly missing:`);
    let shown = 0;
    for (const b of missingById) {
      if (shown >= 5) break;
      const slugMatch = b.slug ? remoteSlugToId.get(b.slug) : undefined;
      const isbnMatch = b.isbn_13 ? remoteIsbnToId.get(b.isbn_13) : undefined;
      if (!slugMatch && !isbnMatch) {
        const full = local
          .prepare(`SELECT title, cover_image_url, created_at, visibility FROM books WHERE id = ?`)
          .get(b.id) as any;
        console.log(
          `    ${b.id}  slug=${b.slug}  title="${full?.title?.slice(0, 40)}"  visibility=${full?.visibility}  created=${full?.created_at}`,
        );
        shown++;
      }
    }
  }

  // Show first 5 slug-dupes with both sides
  if (dupBySlug > 0) {
    console.log(`\n  First 5 slug-dupes (local id → remote id):`);
    let shown = 0;
    for (const b of missingById) {
      if (shown >= 5) break;
      const slugMatch = b.slug ? remoteSlugToId.get(b.slug) : undefined;
      if (slugMatch) {
        console.log(`    slug="${b.slug}"   local=${b.id}  remote=${slugMatch}`);
        shown++;
      }
    }
  }

  local.close();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

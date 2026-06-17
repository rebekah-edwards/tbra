/**
 * diag-missing-fk.ts — Find which touched ratings still have FK issues.
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

async function fetchAllIds(table: string, pk = "id"): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const pageSize = 5000;
  while (true) {
    const r = await remote.execute(
      `SELECT ${pk} FROM ${table} ORDER BY ${pk} LIMIT ${pageSize} OFFSET ${offset}`,
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) ids.add(String(row[pk]));
    if (r.rows.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

(async () => {
  console.log("→ Fetching remote book ids...");
  const remoteBooks = await fetchAllIds("books");
  console.log(`  remote books: ${remoteBooks.size}`);

  console.log("→ Fetching remote taxonomy ids...");
  const remoteCats = await fetchAllIds("taxonomy_categories");
  console.log(`  remote categories: ${remoteCats.size}`);

  // Distinct book_ids + category_ids from today's touched ratings
  const touchedBookIds = local
    .prepare(`SELECT DISTINCT book_id FROM book_category_ratings WHERE updated_at >= date('now')`)
    .all() as Array<{ book_id: string }>;
  const touchedCatIds = local
    .prepare(`SELECT DISTINCT category_id FROM book_category_ratings WHERE updated_at >= date('now')`)
    .all() as Array<{ category_id: string }>;

  console.log(`\n→ Touched ratings reference ${touchedBookIds.length} distinct books and ${touchedCatIds.length} distinct categories`);

  const missingBookIds = touchedBookIds
    .map((r) => r.book_id)
    .filter((id) => !remoteBooks.has(id));
  const missingCatIds = touchedCatIds
    .map((r) => r.category_id)
    .filter((id) => !remoteCats.has(id));

  console.log(`  book_ids on local but NOT on remote: ${missingBookIds.length}`);
  console.log(`  category_ids on local but NOT on remote: ${missingCatIds.length}`);

  if (missingBookIds.length > 0) {
    console.log(`\n  First 10 missing book_ids:`);
    const firstIds = missingBookIds.slice(0, 10);
    const placeholders = firstIds.map(() => "?").join(",");
    const books = local
      .prepare(`SELECT id, slug, title, visibility FROM books WHERE id IN (${placeholders})`)
      .all(...firstIds) as any[];
    for (const b of books) {
      console.log(`    ${b.id}  slug=${b.slug}  title="${b.title?.slice(0, 50)}"  visibility=${b.visibility}`);
    }
  }

  if (missingCatIds.length > 0) {
    console.log(`\n  Missing category_ids (all):`);
    for (const id of missingCatIds) {
      const cat = local
        .prepare(`SELECT * FROM taxonomy_categories WHERE id = ?`)
        .get(id) as any;
      console.log(`    ${id} key=${cat?.key} name="${cat?.name}"`);
    }
  }

  local.close();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

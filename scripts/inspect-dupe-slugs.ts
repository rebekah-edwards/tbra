import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });

  // All slugs with 2+ books on Turso
  const dupes = await c.execute(`
    WITH dupes AS (
      SELECT slug FROM books WHERE slug IS NOT NULL AND slug != '' GROUP BY slug HAVING count(*) > 1
    )
    SELECT b.id, b.slug, b.title, b.isbn_13, b.open_library_key, b.asin, b.cover_image_url IS NOT NULL has_cover,
      b.description IS NOT NULL has_desc, b.visibility,
      (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users
    FROM books b
    WHERE b.slug IN (SELECT slug FROM dupes)
    ORDER BY b.slug, users DESC, has_cover DESC
  `);

  let last = "";
  let groups = 0;
  for (const r of dupes.rows as any[]) {
    if (r.slug !== last) { console.log(); console.log(`━ "${r.slug}" ━`); last = r.slug; groups++; }
    console.log(`  ${r.id.slice(0,8)} [${r.users}u] ${r.has_cover?'cover':'-----'} ${r.has_desc?'desc':'----'} vis=${r.visibility} isbn=${r.isbn_13 ?? '-'} ol=${r.open_library_key ?? '-'} "${r.title}"`);
  }
  console.log(`\n${groups} groups, ${dupes.rows.length} books`);
}
main().catch(e => { console.error(e); process.exit(1); });

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  const total = await client.execute(
    `SELECT COUNT(*) c FROM books WHERE visibility = 'public'`,
  );
  const nullSlug = await client.execute(
    `SELECT COUNT(*) c FROM books WHERE visibility = 'public' AND (slug IS NULL OR slug = '' OR slug = 'null')`,
  );
  const nullSlugWithUsers = await client.execute(`
    SELECT COUNT(*) c FROM books b
    WHERE b.visibility = 'public'
      AND (b.slug IS NULL OR b.slug = '' OR b.slug = 'null')
      AND EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id)
  `);
  console.log(`Total public books:              ${total.rows[0].c}`);
  console.log(`Public books with null/''/"null" slug: ${nullSlug.rows[0].c}`);
  console.log(`...of which have user activity:  ${nullSlugWithUsers.rows[0].c}`);

  // Sample first 15 null-slug books
  const samples = await client.execute(`
    SELECT b.id, b.title, b.slug,
      (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id LIMIT 1) as author
    FROM books b
    WHERE b.visibility = 'public' AND (b.slug IS NULL OR b.slug = '' OR b.slug = 'null')
    ORDER BY RANDOM()
    LIMIT 15
  `);
  console.log(`\nSample:`);
  for (const r of samples.rows) {
    console.log(`  "${String(r.title).slice(0, 60)}" by ${String(r.author ?? "?").slice(0, 30)}  (slug: ${JSON.stringify(r.slug)})`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { createClient } from '@libsql/client';

async function main() {
  const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
  const r = await client.execute({
    sql: `SELECT b.id, b.title, b.slug, b.isbn_13, b.publisher, b.publication_year, b.description IS NOT NULL as has_desc, b.cover_image_url IS NOT NULL as has_cover,
          (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as user_count
      FROM books b
      JOIN book_authors ba ON ba.book_id = b.id
      JOIN authors a ON a.id = ba.author_id
      WHERE LOWER(a.name) LIKE '%brother lawrence%'
        AND LOWER(b.title) LIKE '%practice%presence%'
      ORDER BY user_count DESC, length(b.title)`,
    args: []
  });
  console.log('Count:', r.rows.length);
  for (const v of r.rows) console.log(`  [${v.user_count}u] ISBN=${v.isbn_13 ?? '-'} year=${v.publication_year ?? '-'} pub=${v.publisher ?? '-'} desc=${v.has_desc} cover=${v.has_cover} — "${v.title}"`);
}
main().catch(e => { console.error(e); process.exit(1); });

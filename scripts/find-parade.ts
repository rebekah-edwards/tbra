require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const rows = await client.execute({
    sql: `SELECT id, title, slug, cover_image_url, cover_source, description IS NOT NULL as has_desc, created_at, updated_at FROM books WHERE slug LIKE '%parade-of-horribles%' OR title LIKE '%Parade of Horribles%' ORDER BY slug`,
    args: [],
  });
  console.log('TURSO:');
  console.log(JSON.stringify(rows.rows, null, 2));

  for (const r of rows.rows) {
    const id = r.id;
    const [bs, ba, ub, uf, un, ur, ho, ra, re, rn, ow, hl] = await Promise.all([
      client.execute({ sql: 'SELECT COUNT(*) c FROM book_series WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM book_authors WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM user_book_state WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM user_favorite_books WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM up_next WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM user_book_ratings WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM user_hidden_books WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM user_book_reviews WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM reading_sessions WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM reading_notes WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM user_owned_editions WHERE book_id=?', args: [id] }),
      client.execute({ sql: 'SELECT COUNT(*) c FROM editions WHERE book_id=?', args: [id] }),
    ]);
    console.log(`\nBook ${r.title} [${id}] slug=${r.slug}:
      book_series=${bs.rows[0].c} book_authors=${ba.rows[0].c}
      user_book_state=${ub.rows[0].c} favorites=${uf.rows[0].c}
      up_next=${un.rows[0].c} ratings=${ur.rows[0].c}
      hidden=${ho.rows[0].c} reviews=${ra.rows[0].c}
      reading_sessions=${re.rows[0].c} notes=${rn.rows[0].c}
      owned_editions=${ow.rows[0].c} editions=${hl.rows[0].c}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

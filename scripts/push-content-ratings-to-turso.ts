require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const path = require('path');

const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));

(async () => {
  // Get books enriched in the last 2h locally (the just-finished backfill)
  const recent = local.prepare(`
    SELECT DISTINCT book_id FROM book_category_ratings
    WHERE updated_at >= datetime('now','-2 hours')
  `).all() as { book_id: string }[];

  console.log(`Found ${recent.length} books with recently-updated ratings locally.`);

  let ratingsPushed = 0;
  let booksUpdated = 0;
  let errors = 0;

  for (const { book_id } of recent) {
    try {
      // Get the ratings rows locally
      const rows = local.prepare(`SELECT * FROM book_category_ratings WHERE book_id = ?`).all(book_id) as any[];

      // Delete remote rows for this book then re-insert
      await remote.execute('DELETE FROM book_category_ratings WHERE book_id = ?', [book_id]);

      for (const r of rows) {
        const cols = Object.keys(r);
        const placeholders = cols.map(() => '?').join(',');
        await remote.execute(
          `INSERT INTO book_category_ratings (${cols.join(',')}) VALUES (${placeholders})`,
          cols.map(k => r[k])
        );
        ratingsPushed++;
      }

      // Also update the book's summary / is_fiction / updated_at (Grok sets these)
      const book = local.prepare(`SELECT summary, is_fiction, pacing, updated_at FROM books WHERE id = ?`).get(book_id) as any;
      if (book) {
        await remote.execute(
          `UPDATE books SET
            summary = COALESCE(?, summary),
            is_fiction = COALESCE(?, is_fiction),
            pacing = COALESCE(?, pacing),
            updated_at = ?
          WHERE id = ?`,
          [book.summary, book.is_fiction, book.pacing, book.updated_at, book_id]
        );
        booksUpdated++;
      }

      if (booksUpdated % 50 === 0) console.log(`  Progress: ${booksUpdated}/${recent.length}`);
    } catch (e: any) {
      errors++;
      if (errors <= 5) console.log(`  ERR ${book_id}: ${e.message}`);
    }
  }

  console.log(`\nDone. Pushed ratings for ${booksUpdated} books (${ratingsPushed} rating rows). Errors: ${errors}`);

  // Updated backlog remaining on Turso
  const remain = await remote.execute(`SELECT count(*) as n FROM books WHERE id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)`);
  console.log(`Books still missing content ratings on Turso: ${Number(remain.rows[0].n).toLocaleString()}`);

  local.close();
})();

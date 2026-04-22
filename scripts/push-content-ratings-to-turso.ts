/**
 * push-content-ratings-to-turso.ts — used by nightly-content-ratings-backfill.
 *
 * Pushes book_category_ratings rows (plus a few book metadata fields Grok
 * touches: summary, is_fiction, pacing, updated_at) for books enriched in
 * the last 2 hours locally.
 *
 * Guarded by scripts/lib/turso-guard:
 *   - 20min wall-clock ceiling (the normal 700-book backfill finishes in ~8min)
 *   - 30s per-query timeout (no single Turso call hangs forever)
 *   - PID lockfile at /tmp/tbra-push-content-ratings.lock
 *
 * If this script exits with code 2, something hung — the cron should alert.
 */
require('dotenv').config({ path: '.env.vercel.local' });
const Database = require('better-sqlite3');
const path = require('path');
import { createGuardedTurso } from './lib/turso-guard';

const MAX_RUNTIME_MS = 20 * 60 * 1000;      // 20 min — 2.5× the p95 normal runtime
const QUERY_TIMEOUT_MS = 30_000;            // 30s per query

(async () => {
  const { remote, heartbeat } = await createGuardedTurso({
    name: 'push-content-ratings',
    maxRuntimeMs: MAX_RUNTIME_MS,
    queryTimeoutMs: QUERY_TIMEOUT_MS,
  });
  const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));

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
      const rows = local.prepare(`SELECT * FROM book_category_ratings WHERE book_id = ?`).all(book_id) as any[];

      await remote.execute({
        sql: 'DELETE FROM book_category_ratings WHERE book_id = ?',
        args: [book_id],
      });

      for (const r of rows) {
        const cols = Object.keys(r);
        const placeholders = cols.map(() => '?').join(',');
        await remote.execute({
          sql: `INSERT INTO book_category_ratings (${cols.join(',')}) VALUES (${placeholders})`,
          args: cols.map(k => r[k]),
        });
        ratingsPushed++;
      }

      const book = local.prepare(`SELECT summary, is_fiction, pacing, updated_at FROM books WHERE id = ?`).get(book_id) as any;
      if (book) {
        await remote.execute({
          sql: `UPDATE books SET
              summary = COALESCE(?, summary),
              is_fiction = COALESCE(?, is_fiction),
              pacing = COALESCE(?, pacing),
              updated_at = ?
            WHERE id = ?`,
          args: [book.summary, book.is_fiction, book.pacing, book.updated_at, book_id],
        });
        booksUpdated++;
      }

      if (booksUpdated % 50 === 0 && booksUpdated > 0) {
        heartbeat(`${booksUpdated}/${recent.length}`);
      }
    } catch (e: any) {
      errors++;
      if (errors <= 5) console.log(`  ERR ${book_id}: ${e.message}`);
      // Query timeout surfaces here. Keep going — one stuck book shouldn't
      // kill the batch. The wall-clock ceiling still caps total runtime.
    }
  }

  console.log(`\nDone. Pushed ratings for ${booksUpdated} books (${ratingsPushed} rating rows). Errors: ${errors}`);

  const remain = await remote.execute(
    `SELECT count(*) as n FROM books WHERE id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)`,
  );
  console.log(`Books still missing content ratings on Turso: ${Number(remain.rows[0].n).toLocaleString()}`);

  local.close();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

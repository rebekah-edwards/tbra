/**
 * Targeted push for nightly-placeholder-clear.
 *
 * The full `sync-incremental.sh push` has been getting watchdog-reaped inside
 * the slow step 5c `book_category_ratings` pagination BEFORE step 5b (the
 * "UPDATE existing books" pass that carries cover clears) ever runs. This
 * script pushes ONLY the freshly-cleared cover fields, straight to Turso, so
 * the cleared books reliably surface at /admin/covers on live.
 *
 * Idempotent: re-clearing an already-cleared book is a no-op UPDATE.
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });
import Database from 'better-sqlite3';
import { createGuardedTurso } from './lib/turso-guard';

(async () => {
  const local = new Database('data/tbra.db', { readonly: true });
  const rows = local
    .prepare(
      `SELECT id, cover_image_url, cover_verified, cover_source
         FROM books
        WHERE cover_source IN ('isbndb-placeholder-cleared','gbooks-placeholder-cleared')
          AND updated_at > datetime('now','-2 hours')`
    )
    .all() as Array<{ id: string; cover_image_url: string | null; cover_verified: number; cover_source: string }>;

  console.log(`[push-cover-clears] ${rows.length} freshly-cleared books to push`);
  if (rows.length === 0) {
    process.exit(0);
  }

  const { remote } = await createGuardedTurso({
    name: 'push-cover-clears',
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let pushed = 0;
  for (const r of rows) {
    try {
      await remote.execute({
        sql: `UPDATE books
                 SET cover_image_url = ?, cover_verified = ?, cover_source = ?, updated_at = datetime('now')
               WHERE id = ?`,
        args: [r.cover_image_url, r.cover_verified, r.cover_source, r.id],
      });
      pushed++;
    } catch (e: any) {
      console.log(`  ⚠ ${r.id}: ${String(e.message).slice(0, 120)}`);
    }
  }

  console.log(`[push-cover-clears] pushed ${pushed}/${rows.length} cover clears to Turso`);
  process.exit(0);
})();

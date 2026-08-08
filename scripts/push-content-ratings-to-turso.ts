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
 * Schedule gate (added 2026-04-22 after an agent ran this mid-day and
 * saturated Turso): refuses to start unless running inside the nightly window
 * (3:00–6:00 AM PT) AND it has been >20 hours since the last successful run.
 * Set TBRA_FORCE=1 to override — logged loudly so the override is visible.
 *
 * If this script exits with code 2, the turso-guard wall-clock fired.
 * If it exits with code 3, the schedule gate refused.
 */
require('dotenv').config({ path: '.env.vercel.local' });
const Database = require('better-sqlite3');
const path = require('path');
import * as fs from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

const MAX_RUNTIME_MS = 20 * 60 * 1000;      // 20 min — 2.5× the p95 normal runtime
const QUERY_TIMEOUT_MS = 30_000;            // 30s per query

// Schedule gate — see module docstring.
const ALLOWED_HOUR_PT_START = 3;            // 3:00 AM PT
const ALLOWED_HOUR_PT_END = 6;              // up to (but not including) 6:00 AM PT
const LAST_RUN_FILE = '/tmp/tbra-push-content-ratings.last-success';
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

function hourInPacific(): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  }).format(new Date());
  return parseInt(h, 10);
}

function lastSuccessAgeMs(): number | null {
  try {
    return Date.now() - fs.statSync(LAST_RUN_FILE).mtimeMs;
  } catch {
    return null;
  }
}

function checkScheduleGate(): void {
  if (process.env.TBRA_FORCE === '1') {
    console.log('⚠ TBRA_FORCE=1 — bypassing schedule gate. This is logged for audit.');
    return;
  }
  const hour = hourInPacific();
  const inWindow = hour >= ALLOWED_HOUR_PT_START && hour < ALLOWED_HOUR_PT_END;
  const age = lastSuccessAgeMs();
  const recently = age !== null && age < MIN_INTERVAL_MS;

  if (!inWindow) {
    console.error(
      `REFUSED: push-content-ratings is a nightly task. Current PT hour: ${hour}. ` +
        `Allowed window: ${ALLOWED_HOUR_PT_START}:00–${ALLOWED_HOUR_PT_END}:00 PT. ` +
        `Set TBRA_FORCE=1 to override (logged).`,
    );
    process.exit(3);
  }
  if (recently) {
    const hours = (age! / 3_600_000).toFixed(1);
    console.error(
      `REFUSED: last successful run was ${hours}h ago (<20h threshold). ` +
        `Set TBRA_FORCE=1 to override (logged).`,
    );
    process.exit(3);
  }
}

(async () => {
  checkScheduleGate();

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

  // Mirror this run's enrichment_log successes to Turso. nightly-thin-recovery
  // (6:44 AM) reads PROD enrichment_log for its 21-day "already attempted"
  // cooldown, but the only push that carries enrichment_log is the full
  // sync-push — which doesn't run between this lane and thin-recovery. Without
  // this, every thin book enriched here at 4:54 AM looks untouched two hours
  // later and gets force-re-enriched, spending ~6 Brave/book for nothing.
  // INSERT OR IGNORE by id: replaying a row is a no-op, and a book whose FK is
  // missing on Turso fails alone rather than aborting the mirror.
  const logRows = local.prepare(`
    SELECT * FROM enrichment_log
    WHERE status = 'success' AND created_at >= datetime('now','-4 hours')
  `).all() as any[];
  let logsPushed = 0;
  let logErrors = 0;
  for (const r of logRows) {
    const cols = Object.keys(r);
    try {
      await remote.execute({
        sql: `INSERT OR IGNORE INTO enrichment_log (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        args: cols.map((k) => r[k]),
      });
      logsPushed++;
    } catch {
      logErrors++;
    }
  }
  console.log(`Mirrored ${logsPushed}/${logRows.length} enrichment_log successes to Turso (${logErrors} skipped).`);

  const remain = await remote.execute(
    `SELECT count(*) as n FROM books WHERE id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)`,
  );
  console.log(`Books still missing content ratings on Turso: ${Number(remain.rows[0].n).toLocaleString()}`);

  // Record successful run for the 20h idempotency check.
  try { fs.writeFileSync(LAST_RUN_FILE, String(Date.now())); } catch { /* non-fatal */ }

  local.close();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

/**
 * push-reported-issues-to-turso.ts — targeted push of local-created reported_issues
 * flags (e.g. nightly-junk-sweep box-set flags) to production Turso.
 *
 * Replicates sync-push.ts step 5e in isolation so it doesn't have to run behind the
 * slow full-push pagination (the deep-OFFSET scan over book_category_ratings that
 * keeps getting watchdog/timeout-reaped before step 5e is reached).
 *
 * INSERT OR IGNORE by id only — never overwrites a live row (an admin may have
 * already resolved it on Turso). Pre-filters book_id against live books so a flag
 * on a not-yet-synced book doesn't FK-fail.
 */

require('dotenv').config({ path: '.env.vercel.local' });
import { createGuardedTurso } from './lib/turso-guard';
const Database = require('better-sqlite3');
const path = require('path');

(async () => {
  const { remote, shutdown } = await createGuardedTurso({
    name: 'push-reported-issues',
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'), { readonly: true });

  // Columns from local schema
  const cols: string[] = (local.prepare(`PRAGMA table_info(reported_issues)`).all() as any[]).map(
    (r) => r.name,
  );
  if (cols.length === 0) {
    console.log('reported_issues: not in local DB — nothing to do');
    shutdown();
    process.exit(0);
  }

  // Live issue ids (small table — paginate to be safe)
  const liveIssueIds = new Set<string>();
  {
    let offset = 0;
    const page = 10000;
    while (true) {
      const r = await remote.execute(
        `SELECT id FROM reported_issues ORDER BY id LIMIT ${page} OFFSET ${offset}`,
      );
      if (r.rows.length === 0) break;
      for (const row of r.rows as any[]) liveIssueIds.add(String(row.id));
      if (r.rows.length < page) break;
      offset += page;
    }
  }
  console.log(`Live reported_issues: ${liveIssueIds.size.toLocaleString()} rows`);

  // Local rows not yet on live
  const localIssues = local.prepare(`SELECT ${cols.join(',')} FROM reported_issues`).all() as any[];
  const candidates = localIssues.filter((r) => !liveIssueIds.has(String(r.id)));
  console.log(`Local rows not on live: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Nothing to push.');
    shutdown();
    process.exit(0);
  }

  // FK pre-filter: which referenced book_ids actually exist on live?
  const bookIds = [...new Set(candidates.map((r) => r.book_id).filter((v) => v != null).map(String))];
  const liveBookIds = new Set<string>();
  for (let i = 0; i < bookIds.length; i += 100) {
    const chunk = bookIds.slice(i, i + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const r = await remote.execute({
      sql: `SELECT id FROM books WHERE id IN (${placeholders})`,
      args: chunk,
    });
    for (const row of r.rows as any[]) liveBookIds.add(String(row.id));
  }

  let orphaned = 0;
  const toPush: any[][] = [];
  for (const r of candidates) {
    if (r.book_id != null && !liveBookIds.has(String(r.book_id))) {
      orphaned++;
      continue;
    }
    toPush.push(cols.map((c) => r[c]));
  }

  if (toPush.length === 0) {
    console.log(`All ${candidates.length} candidates reference books not on live — skipped.`);
    shutdown();
    process.exit(0);
  }

  // INSERT OR IGNORE, batched, with per-row fallback
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT OR IGNORE INTO reported_issues (${cols.join(',')}) VALUES (${placeholders})`;
  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < toPush.length; i += BATCH) {
    const chunk = toPush.slice(i, i + BATCH);
    try {
      const result = await remote.batch(chunk.map((row) => ({ sql, args: row })), 'write');
      for (const rr of result as any[]) inserted += Number(rr.rowsAffected || 0);
    } catch {
      for (const row of chunk) {
        try {
          const res = await remote.execute({ sql, args: row });
          inserted += Number(res.rowsAffected || 0);
        } catch (e: any) {
          console.log(`  ⚠ skipped one row: ${String(e.message).slice(0, 100)}`);
        }
      }
    }
  }

  const note = orphaned > 0 ? ` (${orphaned} referenced a book not on live — skipped)` : '';
  console.log(`✓ reported_issues: pushed ${inserted} / ${toPush.length} new local rows${note}`);
  shutdown();
  process.exit(0);
})();

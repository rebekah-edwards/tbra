/**
 * push-book-updates-only.ts — Run ONLY step 5b of sync-push.ts.
 *
 * Used when the full sync-push is unnecessary but you need to get local
 * metadata updates (summary, description, cover, etc.) to Turso.
 *
 * Specifically useful after clean-junk-descriptions.ts runs, since that
 * script NULLs descriptions locally and bumps updated_at — this pushes
 * those NULL-outs to Turso.
 */

require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const path = require('path');

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));

const UPDATE_FIELDS = [
  'summary', 'description', 'publication_year', 'pages', 'publisher',
  'cover_image_url', 'is_fiction', 'is_box_set', 'pacing',
  'audiobook_cover_url', 'cover_verified', 'cover_source',
  'description_stale', 'updated_at',
];

const BATCH_SIZE = 100;

(async () => {
  console.log('→ Pushing book metadata updates (step 5b only)\n');

  // Build liveUpdated map (books.id → updated_at on Turso)
  const liveUpdated = new Map<string, string | null>();
  let offset = 0;
  const page = 10000;
  while (true) {
    const r = await remote.execute(
      `SELECT id, updated_at FROM books ORDER BY id LIMIT ${page} OFFSET ${offset}`
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) liveUpdated.set(String(row.id), row.updated_at);
    if (r.rows.length < page) break;
    offset += page;
  }
  console.log(`Live book count: ${liveUpdated.size.toLocaleString()}`);

  const localBooks = local
    .prepare(`SELECT id, ${UPDATE_FIELDS.join(',')} FROM books WHERE updated_at IS NOT NULL`)
    .all() as any[];

  const toUpdate: any[] = [];
  for (const b of localBooks) {
    const live = liveUpdated.get(String(b.id));
    if (live === undefined) continue; // not on live; skip
    if (!live || String(b.updated_at) > String(live)) toUpdate.push(b);
  }

  console.log(`Books with newer local metadata: ${toUpdate.length.toLocaleString()}\n`);

  if (toUpdate.length === 0) {
    console.log('Nothing to push.');
    process.exit(0);
  }

  const setClause = UPDATE_FIELDS.map((c) => `${c} = ?`).join(', ');
  const sql = `UPDATE books SET ${setClause} WHERE id = ?`;
  let updated = 0;
  let batchErrors = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    try {
      const result = await remote.batch(
        chunk.map((b: any) => ({ sql, args: [...UPDATE_FIELDS.map((c) => b[c]), b.id] })),
        'write'
      );
      for (const r of result as any[]) updated += Number(r.rowsAffected || 0);
    } catch (e: any) {
      batchErrors++;
      // fallback per-row
      for (const b of chunk) {
        try {
          const res = await remote.execute({
            sql,
            args: [...UPDATE_FIELDS.map((c) => b[c]), b.id],
          });
          updated += Number(res.rowsAffected || 0);
        } catch { /* skip */ }
      }
    }
    if (i > 0 && i % 1000 === 0) console.log(`  ...${updated} updated so far`);
  }
  console.log(`\n✓ Updated ${updated} book rows on Turso. (${batchErrors} batches had fallback)`);

  // Also sync landing page tables (admin-managed, tiny)
  console.log('\nSyncing landing page tables...');
  try {
    await remote.execute(`
      CREATE TABLE IF NOT EXISTS landing_page_books (
        id TEXT PRIMARY KEY, book_slug TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'parade', sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await remote.execute(`
      CREATE TABLE IF NOT EXISTS landing_page_copy (
        id TEXT PRIMARY KEY, section_key TEXT NOT NULL UNIQUE,
        section_label TEXT NOT NULL, content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (const lp of ['landing_page_books', 'landing_page_copy']) {
      const cols = local.prepare(`PRAGMA table_info(${lp})`).all() as any[];
      if (cols.length === 0) continue;
      const colNames = cols.map((c) => c.name);
      const rows = local.prepare(`SELECT ${colNames.join(',')} FROM ${lp}`).all() as any[];
      await remote.execute(`DELETE FROM ${lp}`);
      const placeholders = colNames.map(() => '?').join(',');
      const insertSql = `INSERT INTO ${lp} (${colNames.join(',')}) VALUES (${placeholders})`;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        await remote.batch(
          chunk.map((r: any) => ({ sql: insertSql, args: colNames.map((c: string) => r[c]) })),
          'write'
        );
      }
      console.log(`  ✓ ${lp}: replaced with ${rows.length} rows`);
    }
  } catch (e: any) {
    console.log(`  ⚠ landing page sync: ${e.message.slice(0, 100)}`);
  }

  console.log('\nDone.');
  local.close();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

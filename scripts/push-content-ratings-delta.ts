/**
 * push-content-ratings-delta.ts — Push all book_category_ratings that exist
 * locally but not on Turso (by id), filtering out orphaned rows.
 *
 * Complements push-content-ratings-to-turso.ts (which is time-windowed) for
 * catch-up runs after a long sync lag.
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

async function fetchSet(sql: string): Promise<Set<string>> {
  const set = new Set<string>();
  let offset = 0;
  const page = 20000;
  while (true) {
    const r = await remote.execute(`${sql} LIMIT ${page} OFFSET ${offset}`);
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) set.add(String((row as any).id));
    if (r.rows.length < page) break;
    offset += page;
  }
  return set;
}

(async () => {
  console.log('→ Diff-based book_category_ratings push\n');

  console.log('Fetching Turso rating IDs...');
  const liveRatingIds = await fetchSet('SELECT id FROM book_category_ratings');
  console.log(`  ${liveRatingIds.size.toLocaleString()} ratings on Turso`);

  console.log('Fetching Turso book IDs (for FK pre-filter)...');
  const liveBookIds = await fetchSet('SELECT id FROM books');
  console.log(`  ${liveBookIds.size.toLocaleString()} books on Turso`);

  const cols = (local.prepare(`PRAGMA table_info(book_category_ratings)`).all() as any[]).map((r) => r.name);
  const localRows = local.prepare(`SELECT ${cols.join(',')} FROM book_category_ratings`).all() as any[];
  console.log(`  ${localRows.length.toLocaleString()} ratings local`);

  const toPush: any[][] = [];
  let orphaned = 0;
  for (const r of localRows) {
    if (liveRatingIds.has(String(r.id))) continue;
    if (!liveBookIds.has(String(r.book_id))) { orphaned++; continue; }
    toPush.push(cols.map((c) => r[c]));
  }
  console.log(`\nMissing from Turso: ${toPush.length.toLocaleString()} (${orphaned.toLocaleString()} orphans pre-filtered)\n`);

  if (toPush.length === 0) {
    console.log('In sync.');
    process.exit(0);
  }

  const BATCH = 100;
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT OR IGNORE INTO book_category_ratings (${cols.join(',')}) VALUES (${placeholders})`;
  let pushed = 0;
  for (let i = 0; i < toPush.length; i += BATCH) {
    const chunk = toPush.slice(i, i + BATCH);
    try {
      const result = await remote.batch(chunk.map((row) => ({ sql, args: row })), 'write');
      for (const r of result as any[]) pushed += Number(r.rowsAffected || 0);
    } catch {
      for (const row of chunk) {
        try {
          const res = await remote.execute({ sql, args: row });
          pushed += Number(res.rowsAffected || 0);
        } catch { /* skip */ }
      }
    }
    if (i > 0 && i % 1000 === 0) console.log(`  ...${pushed} pushed so far`);
  }
  console.log(`\n✓ Pushed ${pushed} ratings.`);

  const finalCount = await remote.execute('SELECT count(*) as n FROM book_category_ratings');
  console.log(`book_category_ratings on Turso now: ${Number((finalCount.rows[0] as any).n).toLocaleString()}`);

  local.close();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

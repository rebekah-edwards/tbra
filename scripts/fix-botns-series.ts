require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const CANONICAL_SERIES = '7ca3e658-44c8-4855-b309-044b707efd46';
const DUP_SERIES = '94532f52-3624-43d6-828c-44d1aa45252d';

const SWORD_ID = '2873dff1-4780-48d5-9419-3aebc9762536';
const SHADOW_ID = 'd95d5ab9-0b46-482a-aeba-97f2c5b97a37';
const CLAW_ID = '99585596-1a41-4932-a762-8d78b126d337';
const CITADEL_ID = 'd421d416-99a8-4b57-88eb-4ff9c8ae9519';

const OMNIBUSES = [
  '573cbd25-b967-40e7-9a52-3032ebb0e8fb', // Severian of the Guild (2007)
  'f03d8364-0f79-4f17-959d-e420552e384d', // Complete Book of the New Sun (2017)
  '80600418-4f2e-4f65-ae9d-6b6d18ca60e7', // Book of the New Sun (1983)
];

(async () => {
  // 1. Merge duplicate series — move any books from DUP to CANONICAL if not already linked
  const dupBooks = await c.execute('SELECT book_id FROM book_series WHERE series_id = ?', [DUP_SERIES]);
  for (const row of dupBooks.rows as any[]) {
    const existing = await c.execute('SELECT 1 FROM book_series WHERE series_id = ? AND book_id = ?', [CANONICAL_SERIES, row.book_id]);
    if (existing.rows.length === 0) {
      console.log('  Moving book', row.book_id, 'from dup series to canonical');
      await c.execute('INSERT INTO book_series (series_id, book_id) VALUES (?, ?)', [CANONICAL_SERIES, row.book_id]);
    }
    await c.execute('DELETE FROM book_series WHERE series_id = ? AND book_id = ?', [DUP_SERIES, row.book_id]);
  }
  // Delete the now-empty duplicate series
  await c.execute('DELETE FROM series WHERE id = ?', [DUP_SERIES]);
  console.log('1. Merged duplicate series ->', DUP_SERIES, 'deleted');

  // 2. Set is_box_set = 1 on the 3 omnibus entries
  for (const id of OMNIBUSES) {
    await c.execute(`UPDATE books SET is_box_set = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
  }
  console.log('2. Flagged 3 omnibuses as is_box_set = 1');

  // 3. Link Sword of the Lictor to canonical series at position 3
  const existing = await c.execute('SELECT 1 FROM book_series WHERE series_id = ? AND book_id = ?', [CANONICAL_SERIES, SWORD_ID]);
  if (existing.rows.length === 0) {
    await c.execute('INSERT INTO book_series (series_id, book_id, position_in_series) VALUES (?, ?, 3)', [CANONICAL_SERIES, SWORD_ID]);
  } else {
    await c.execute('UPDATE book_series SET position_in_series = 3 WHERE series_id = ? AND book_id = ?', [CANONICAL_SERIES, SWORD_ID]);
  }
  // Set Sword's pub year if null
  await c.execute(`UPDATE books SET publication_year = COALESCE(publication_year, 1982), updated_at = datetime('now') WHERE id = ?`, [SWORD_ID]);
  console.log('3. Linked Sword of the Lictor as book 3 (pub year 1982)');

  // 4. Fix Shadow of the Torturer year (shows 1990, actual 1980)
  await c.execute(`UPDATE books SET publication_year = 1980, updated_at = datetime('now') WHERE id = ?`, [SHADOW_ID]);
  console.log('4. Fixed Shadow of the Torturer: 1990 -> 1980');

  // 5. Fix positions on core novels
  await c.execute(`UPDATE book_series SET position_in_series = 1 WHERE series_id = ? AND book_id = ?`, [CANONICAL_SERIES, SHADOW_ID]);
  await c.execute(`UPDATE book_series SET position_in_series = 2 WHERE series_id = ? AND book_id = ?`, [CANONICAL_SERIES, CLAW_ID]);
  await c.execute(`UPDATE book_series SET position_in_series = 4 WHERE series_id = ? AND book_id = ?`, [CANONICAL_SERIES, CITADEL_ID]);
  console.log('5. Confirmed positions 1/2/4 on core novels');

  // Final state
  console.log('\n=== Final series state ===');
  const finalBooks = await c.execute(`
    SELECT b.title, b.publication_year, b.is_box_set, bs.position_in_series
    FROM book_series bs JOIN books b ON b.id = bs.book_id
    WHERE bs.series_id = ?
    ORDER BY bs.position_in_series IS NULL, bs.position_in_series, b.publication_year
  `, [CANONICAL_SERIES]);
  finalBooks.rows.forEach((r: any) => console.log(`  pos=${r.position_in_series ?? '-'} box=${r.is_box_set} [${r.publication_year}] ${r.title}`));
})();

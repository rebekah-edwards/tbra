/**
 * merge-caraval-2026-08-08.ts — merge the duplicate Caraval pair.
 *
 * THE PAIR (both public, both with readers, both fully rated):
 *   429183f7  slug caraval-caraval-1-stephanie-garber  year 2016  NO author link
 *             holds: the 11 report_corrections, enrichment_log, reported_issues,
 *             and the 13 category ratings hand-curated on 2026-08-08.
 *   520ffde0  slug caraval-stephanie-garber            year 2000  author linked
 *             holds: the larger share of reader history (4 ratings / 5 reviews / 5 sessions).
 *
 * Rebekah's instruction: end up on the SHORT url (caraval-stephanie-garber) while
 * keeping the right year, the author link, and all reader history.
 *
 * So 429183f7 SURVIVES (it carries the curated ratings and every FK-bearing admin
 * row) and inherits 520ffde0's slug, author link and reader rows. 520ffde0 is then
 * deleted from BOTH databases — sync-push never deletes, so a local-only delete
 * would simply be resurrected on the next pull.
 *
 * USER ROWS MOVE VIA `UPDATE book_id` — never INSERT OR IGNORE + DELETE, which
 * silently destroyed 18 real ratings/reviews on 2026-07-30 (memory:
 * project_dedup_move_destroyed_ratings).
 *
 * TWO STATE COLLISIONS, resolved deliberately rather than newest-wins:
 *   rachallison1   — 'completed' on both, same timestamp. Drop the duplicate.
 *   joannajerowsky — 'tbr' on the survivor (2026-07-31, from the bulk local write
 *                    that stranded her library) vs 'completed' on 520ffde0
 *                    (2024-03-29). Newest-wins would demote a finished book back to
 *                    TBR and lose real reading history, so COMPLETED WINS.
 *
 * NOT merged, deliberately: 520ffde0's genres (Ya Fantasy / Young Adult Fantasy /
 * Dark Fantasy / Magical Realism) are lower-quality duplicates of the survivor's
 * clean set. Its publication_date "2024" is an edition reprint, not the original,
 * and would flag the book as a new release.
 *
 * Usage: npx tsx scripts/merge-caraval-2026-08-08.ts [--apply]
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

const KEEP = '429183f7-4688-4f39-92ba-e49cc50c45cb';
const DROP = '520ffde0-d6fc-46ed-aee7-9ea3bf7c4c82';
const WANTED_SLUG = 'caraval-stephanie-garber';
const RACH = 'rachallison1';
const APPLY = process.argv.includes('--apply');

/** Reader-owned tables that move wholesale (no unique (user, book) constraint issue). */
const MOVE = ['user_book_ratings', 'user_book_reviews', 'user_favorite_books', 'user_hidden_books',
  'up_next', 'tbr_notes', 'reading_sessions', 'reading_notes', 'user_owned_editions', 'shelf_books'];
/** Book-scoped rows that simply follow the book. */
const MOVE_BOOK = ['report_corrections', 'reported_issues', 'enrichment_log', 'editions'];
/** Junction rows on the dropped row that are discarded rather than merged. */
const DISCARD = ['book_genres', 'book_series', 'book_category_ratings', 'book_authors'];

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'merge-caraval',
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const localDb = new Database('data/tbra.db');
  const now = new Date().toISOString();
  const log: string[] = [];
  const say = (s: string) => { console.log(s); log.push(s); };

  // Run the identical statement against prod and local so the two never diverge.
  const both = async (sql: string, args: any[]) => {
    if (!APPLY) return 0;
    const res = await remote.execute({ sql, args });
    const l = localDb.prepare(sql).run(...args);
    return Number(res.rowsAffected ?? l.changes ?? 0);
  };
  const countBoth = async (sql: string, args: any[]) => {
    const p = await remote.execute({ sql, args });
    const l = localDb.prepare(sql).get(...args) as any;
    return [Number((p.rows[0] as any).n), Number(l.n)];
  };

  // Snapshot everything on the row being deleted, so the merge is reversible.
  const snapshot: Record<string, any[]> = {};
  for (const t of [...MOVE, ...MOVE_BOOK, ...DISCARD, 'user_book_state']) {
    try {
      const p = await remote.execute({ sql: `SELECT * FROM ${t} WHERE book_id=?`, args: [DROP] });
      snapshot[t] = p.rows as any[];
    } catch { /* table may not exist */ }
  }
  const bookRow = await remote.execute({ sql: 'SELECT * FROM books WHERE id=?', args: [DROP] });
  snapshot['books'] = bookRow.rows as any[];

  say(`Caraval merge — keep ${KEEP.slice(0, 8)}, drop ${DROP.slice(0, 8)}, final slug "${WANTED_SLUG}"`);

  // 1. Resolve the two user_book_state collisions BEFORE the bulk move.
  const collide = await remote.execute({
    sql: `SELECT s.user_id, s.state, s.updated_at, u.email FROM user_book_state s
          LEFT JOIN users u ON u.id=s.user_id WHERE s.book_id=? AND s.user_id IN
          (SELECT user_id FROM user_book_state WHERE book_id=?)`,
    args: [DROP, KEEP],
  });
  for (const c of collide.rows as any[]) {
    const email = String(c.email ?? '');
    if (email.startsWith(RACH)) {
      say(`  collision ${email}: identical 'completed' both sides — dropping the duplicate row`);
    } else {
      // joannajerowsky: the survivor says 'tbr', the dropped row holds the real 'completed'.
      say(`  collision ${email}: survivor='tbr' vs dropped='${c.state}' (${c.updated_at}) — COMPLETED wins, promoting survivor`);
      await both(`UPDATE user_book_state SET state=?, updated_at=? WHERE book_id=? AND user_id=?`,
        [c.state, c.updated_at, KEEP, c.user_id]);
    }
    await both(`DELETE FROM user_book_state WHERE book_id=? AND user_id=?`, [DROP, c.user_id]);
  }

  // 2. Move every remaining reader row onto the survivor.
  for (const t of ['user_book_state', ...MOVE, ...MOVE_BOOK]) {
    const col = t === 'shelf_books' ? 'book_id' : 'book_id';
    const [pn, ln] = await countBoth(`SELECT COUNT(*) n FROM ${t} WHERE ${col}=?`, [DROP]);
    if (pn === 0 && ln === 0) continue;
    await both(`UPDATE ${t} SET ${col}=? WHERE ${col}=?`, [KEEP, DROP]);
    say(`  moved ${t}: prod ${pn}, local ${ln}`);
  }

  // 3. The survivor has no author link — take the one from the dropped row.
  const authors = await remote.execute({ sql: 'SELECT author_id FROM book_authors WHERE book_id=?', args: [DROP] });
  for (const a of authors.rows as any[]) {
    const [have] = await countBoth('SELECT COUNT(*) n FROM book_authors WHERE book_id=? AND author_id=?', [KEEP, a.author_id]);
    if (have === 0) {
      await both('INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)', [KEEP, a.author_id]);
      say(`  linked author ${String(a.author_id).slice(0, 8)} to the survivor`);
    }
  }

  // 4. Drop the loser's junction rows, then the book row itself. Both databases.
  for (const t of DISCARD) {
    const [pn, ln] = await countBoth(`SELECT COUNT(*) n FROM ${t} WHERE book_id=?`, [DROP]);
    if (pn === 0 && ln === 0) continue;
    await both(`DELETE FROM ${t} WHERE book_id=?`, [DROP]);
    say(`  discarded ${t}: prod ${pn}, local ${ln}`);
  }
  await both('DELETE FROM books WHERE id=?', [DROP]);
  say(`  deleted book row ${DROP.slice(0, 8)} from prod + local`);

  // 5. Only now is the slug free.
  await both('UPDATE books SET slug=?, updated_at=? WHERE id=?', [WANTED_SLUG, now, KEEP]);
  say(`  survivor slug -> ${WANTED_SLUG}`);

  writeFileSync('reports/caraval-merge-2026-08-08.json',
    JSON.stringify({ appliedAt: APPLY ? now : null, keep: KEEP, drop: DROP, log, snapshot }, null, 1));
  say(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}. Snapshot of every deleted row: reports/caraval-merge-2026-08-08.json`);
  if (!APPLY) say('Pass --apply to write.');
  process.exit(0);
})();

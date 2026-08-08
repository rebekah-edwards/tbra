/**
 * fix-note-rating-mismatches-2026-08-08.ts — repair the 8 ratings whose note and
 * number disagreed after the bulk reviewer accept.
 *
 * Rebekah's rulings 2026-08-08, both applied here:
 *
 * A. "Where the brief mention thing is happening, let's make those a 1/4 instead
 *    of 0/4." Five ratings had been dropped to 0/None while their note still
 *    described content that is present — brief alcohol mentions, mild language,
 *    allusions to Lucifer. A reader treating Mild as "negligible" is not the same
 *    as the content being absent, and 1 is exactly what the scale calls this.
 *
 * B. "For the ones that have a 'no evidence' note, let's make those say like
 *    'Moderate substance use depicted' with no specific notes." Three ratings had
 *    been RAISED on a reader's say-so while the note still read "No evidence found
 *    in available sources" — visibly incoherent on the live book page. Nobody told
 *    us what is actually in these books, so the replacement states the level and
 *    claims nothing more.
 *
 * NOTE LENGTH: the B notes are ~30 chars, well under the 70-190 house rule
 * (memory: feedback_content_notes_concise). That is deliberate and Rebekah's call —
 * inventing 70 chars of detail we do not have would be worse than a short true one.
 *
 * Usage: npx tsx scripts/fix-note-rating-mismatches-2026-08-08.ts [--apply]
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

const ADMIN_USER_ID = 'c2f3eb27-139f-4605-9566-8ded8d9e1336';
const APPLY = process.argv.includes('--apply');

type Fix = {
  title: string; category: string;
  bookId?: string;              // required where the title is ambiguous — see CARAVAL below
  expectIntensity: number;      // guard: what it should be right now
  setIntensity?: number;        // omit to leave the number alone
  setNote?: string;             // omit to leave the note alone
  why: string;
};

/**
 * The catalog holds TWO public books titled "Caraval", both with 6 readers and a
 * full set of 13 ratings — a duplicate pair that predates this work:
 *   429183f7… slug caraval-caraval-1-stephanie-garber, year 2016, author linked  ← every correction points here
 *   520ffde0… slug caraval-stephanie-garber,            year 2000, NO author linked
 * Pinning the id so these fixes cannot land on the wrong row. The pair still wants
 * merging via the title+author dupe runbook (memory: project_title_author_dupes).
 */
const CARAVAL = '429183f7-4688-4f39-92ba-e49cc50c45cb';

const FIXES: Fix[] = [
  // A — restore 0 -> 1 where the note documents content that is present.
  { title: 'Legendary', category: 'Religious content', expectIntensity: 0, setIntensity: 1,
    why: 'note cites biblical allusions (Lucifer, fallen angels)' },
  { title: 'What We Did to Survive', category: 'Political & ideological content', expectIntensity: 0, setIntensity: 1,
    why: 'note cites commentary on toxic masculinity and privilege' },
  { title: 'Caraval', bookId: CARAVAL, category: 'Substance use', expectIntensity: 0, setIntensity: 1,
    why: 'note cites brief alcohol mentions — the scale calls that 1' },
  { title: 'Caraval', bookId: CARAVAL, category: 'Profanity / language', expectIntensity: 0, setIntensity: 1,
    why: 'note cites minor mild language' },
  { title: 'Caraval', bookId: CARAVAL, category: 'Political & ideological content', expectIntensity: 0, setIntensity: 1,
    why: 'note cites minor themes of power and control' },

  // B — replace "No evidence found" on ratings a reader raised. Level only, no invented detail.
  { title: "Don't Tell Me How It Ends", category: 'Substance use', expectIntensity: 2,
    setNote: 'Moderate substance use depicted.',
    why: 'rating raised to 2 by a reader; note still said no evidence found' },
  { title: 'The Caretaker', category: 'Religious content', expectIntensity: 1,
    setNote: 'Mild religious content depicted.',
    why: 'rating raised to 1 by a reader; note still said no evidence found' },
  { title: 'Caraval', bookId: CARAVAL, category: 'Self-harm / suicide', expectIntensity: 1,
    setNote: 'Mild self-harm or suicide content depicted.',
    why: 'rating raised to 1 by a reader; note still said no evidence found' },
];

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'fix-note-rating-mismatches',
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const local = new Database('data/tbra.db');
  const now = new Date().toISOString();
  const manifest: any[] = [];
  let changed = 0, skipped = 0;

  for (const f of FIXES) {
    const q = await remote.execute({
      sql: `SELECT bcr.book_id, bcr.category_id, bcr.intensity, bcr.notes
              FROM book_category_ratings bcr
              JOIN books b ON b.id = bcr.book_id
              JOIN taxonomy_categories tc ON tc.id = bcr.category_id
             WHERE ${f.bookId ? 'b.id = ?' : 'b.title = ?'} AND tc.name = ?`,
      args: [f.bookId ?? f.title, f.category],
    });
    if (q.rows.length !== 1) {
      console.log(`SKIP ${f.title} / ${f.category} — matched ${q.rows.length} rows, expected exactly 1`);
      skipped++; continue;
    }
    const row = q.rows[0] as any;
    if (Number(row.intensity) !== f.expectIntensity) {
      console.log(`SKIP ${f.title} / ${f.category} — is ${row.intensity}, expected ${f.expectIntensity} (changed since review)`);
      skipped++; continue;
    }

    const intensity = f.setIntensity ?? Number(row.intensity);
    const note = f.setNote ?? row.notes;
    manifest.push({
      title: f.title, category: f.category, why: f.why,
      before: { intensity: Number(row.intensity), notes: row.notes },
      after: { intensity, notes: note },
    });
    console.log(`${f.title} / ${f.category}`);
    if (f.setIntensity !== undefined) console.log(`   intensity ${row.intensity} -> ${intensity}   (${f.why})`);
    if (f.setNote) {
      console.log(`   note was: ${row.notes}`);
      console.log(`   note now: ${note}`);
    }

    if (!APPLY) { changed++; continue; }
    const sql = `UPDATE book_category_ratings
                    SET intensity=?, notes=?, evidence_level='human_verified',
                        updated_by_user_id=?, updated_at=?
                  WHERE book_id=? AND category_id=?`;
    const args = [intensity, note, ADMIN_USER_ID, now, row.book_id, row.category_id];
    await remote.execute({ sql, args });
    local.prepare(sql).run(...args);
    changed++;
  }

  const path = 'reports/note-rating-mismatch-fixes-2026-08-08.json';
  writeFileSync(path, JSON.stringify({ appliedAt: APPLY ? now : null, fixes: manifest }, null, 1));
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${changed} fixed, ${skipped} skipped. Manifest: ${path}`);
  process.exit(0);
})();

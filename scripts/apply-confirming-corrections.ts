/**
 * apply-confirming-corrections.ts — clear the CONFIRMING half of /admin/corrections.
 *
 * Reader-submitted rating corrections pile up at /admin/corrections. A large share
 * of them do not actually dispute anything: the reviewer independently proposed the
 * intensity the book ALREADY carries. Those need no judgment about the book's
 * content, so they can be resolved mechanically — which is the point of this script.
 * Everything that genuinely disputes a rating is left untouched for a human.
 *
 * WHAT IT TOUCHES (proposed_intensity === current intensity only):
 *   - evidence_level 'human_verified' already → mark the correction accepted. No
 *     rating write at all; the queue row is simply stale.
 *   - evidence_level 'ai_inferred' → mark accepted AND upgrade the rating to
 *     'human_verified'. A reader who finished the book reached the same number the
 *     model did, which is exactly what that flag is supposed to mean. The DISPLAYED
 *     INTENSITY NEVER CHANGES.
 *
 * NOTES POLICY — THIS SCRIPT NEVER WRITES NOTES (corrected 2026-08-08).
 * The API's apply route takes the reviewer's note verbatim. An earlier version of
 * this script took it whenever it was longer. BOTH are wrong: a reader's note and a
 * sourced note each carry detail the other lacks, so picking one always destroys
 * information — verbatim copy-paste also drops raw review prose ("Minor stuff
 * like...") into reader-facing copy that is supposed to be 70-190 tidy chars
 * (memory: feedback_content_notes_concise).
 *
 * Merging two prose notes is a writing task, not a rule a script can apply. So this
 * script now leaves `notes` ALONE and lists every correction whose reader note adds
 * something, under `needsNoteMerge` in the manifest. Synthesise those by hand (see
 * scripts/merge-reader-notes-2026-08-08.ts for the pattern) — combine both sources,
 * let the reader win on disputed fact, keep it in range.
 *
 * WHAT IT REFUSES TO TOUCH:
 *   - Any correction whose proposed intensity differs from the current one. Those
 *     change what a reader is told about a book and need someone who read it.
 *   - proposed_intensity IS NULL (the API rejects these too, with a 400).
 *
 * Writes BOTH prod Turso and local sqlite so the two don't drift. Emits a manifest
 * of every row changed, with before/after, so the run can be reversed.
 *
 * Usage:
 *   npx tsx scripts/apply-confirming-corrections.ts            # dry run
 *   npx tsx scripts/apply-confirming-corrections.ts --apply
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

/** The admin on whose authority these are applied (rebekah_creates). */
const ADMIN_USER_ID = 'c2f3eb27-139f-4605-9566-8ded8d9e1336';
const APPLY = process.argv.includes('--apply');

type Row = {
  id: string; book_id: string; category_id: string; prop: number | null;
  note: string | null; title: string; category: string;
  cur: number | null; ev: string | null; curnotes: string | null;
};

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'apply-confirming-corrections',
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const local = new Database('data/tbra.db');

  const q = await remote.execute(`
    SELECT rc.id, rc.book_id, rc.category_id, rc.proposed_intensity AS prop,
           rc.proposed_notes AS note, b.title, tc.name AS category,
           bcr.intensity AS cur, bcr.evidence_level AS ev, bcr.notes AS curnotes
    FROM report_corrections rc
    LEFT JOIN books b ON b.id = rc.book_id
    LEFT JOIN taxonomy_categories tc ON tc.id = rc.category_id
    LEFT JOIN book_category_ratings bcr
           ON bcr.book_id = rc.book_id AND bcr.category_id = rc.category_id
    WHERE rc.status = 'new'`);
  const rows = q.rows as unknown as Row[];

  const confirming = rows.filter((x) => x.prop !== null && x.cur !== null && x.prop === x.cur);
  const disputed = rows.filter((x) => x.prop !== null && x.cur !== null && x.prop !== x.cur);
  const unusable = rows.filter((x) => x.prop === null || x.cur === null);

  console.log(`pending=${rows.length}  confirming=${confirming.length}  ` +
              `disputed=${disputed.length} (left alone)  unusable=${unusable.length} (left alone)`);

  const manifest: any[] = [];
  const now = new Date().toISOString();

  for (const x of confirming) {
    const upgrade = x.ev !== 'human_verified';
    const revNote = (x.note ?? '').trim();
    manifest.push({
      correctionId: x.id, title: x.title, category: x.category, intensity: x.cur,
      before: { evidence_level: x.ev, notes: x.curnotes },
      after: { evidence_level: 'human_verified', notes: x.curnotes }, // notes untouched
      ratingWrite: upgrade,
      // Reader detail worth folding into the note by hand — never auto-written.
      needsNoteMerge: revNote.length > 0 ? { existing: x.curnotes, reader: revNote } : null,
    });

    if (!APPLY) continue;

    if (upgrade) {
      const args = [ADMIN_USER_ID, now, x.book_id, x.category_id];
      const sql = `UPDATE book_category_ratings
                      SET evidence_level='human_verified', updated_by_user_id=?, updated_at=?
                    WHERE book_id=? AND category_id=?`;
      await remote.execute({ sql, args });
      local.prepare(sql).run(...args);
    }
    await remote.execute({ sql: `UPDATE report_corrections SET status='accepted' WHERE id=?`, args: [x.id] });
    local.prepare(`UPDATE report_corrections SET status='accepted' WHERE id=?`).run(x.id);
  }

  const path = `reports/confirming-corrections-${now.slice(0, 10)}.json`;
  writeFileSync(path, JSON.stringify({ appliedAt: APPLY ? now : null, rows: manifest }, null, 1));
  const ratingWrites = manifest.filter((m) => m.ratingWrite).length;
  const merges = manifest.filter((m) => m.needsNoteMerge).length;
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${manifest.length} correction(s) resolved, ` +
              `${ratingWrites} rating row(s) upgraded to human_verified. Manifest: ${path}`);
  if (merges > 0) {
    console.log(`${merges} reader note(s) add detail to an existing note — merge those by hand ` +
                `(see needsNoteMerge in the manifest). Notes were NOT modified by this run.`);
  }
  if (!APPLY) console.log('Pass --apply to write.');
  process.exit(0);
})();

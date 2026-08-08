/**
 * accept-trusted-reviewers-2026-08-08.ts — bulk-accept two readers' pending corrections.
 *
 * Rebekah 2026-08-08: "Accept haylaghb and rachallison1 changes automatically."
 * 19 corrections, all with a proposed value, all disputing the current rating.
 *
 * INTENSITY ONLY — notes are NOT rewritten. Several of these drop a rating while
 * the existing note still describes the heavier content (Legendary's abuse note
 * lists gaslighting and familial abuse, and the proposal is 0). Rewriting those
 * without having read the book would be inventing copy, so the note is left as-is
 * and the mismatches are listed in the manifest under `noteContradicts` for a
 * human pass. See the notes policy in apply-confirming-corrections.ts.
 *
 * The manifest records before/after for every row, so the whole run reverts with
 * the intensities in `before`.
 *
 * Usage: npx tsx scripts/accept-trusted-reviewers-2026-08-08.ts [--apply]
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

const ADMIN_USER_ID = 'c2f3eb27-139f-4605-9566-8ded8d9e1336';
const EMAILS = ['haylaghb@gmail.com', 'rachallison1@gmail.com'];
const APPLY = process.argv.includes('--apply');
/**
 * Corrections that drop a rating 2+ rungs while the existing note still spells out
 * that the content is present are HELD BACK by default, and only applied with this
 * flag. Not a taste call — it is the rule already written into the rating prompt
 * (src/lib/enrichment/analyze.ts): "A false 'not present' for content that IS in the
 * book is worse than an over-rating. When in doubt, rate HIGHER rather than lower."
 * Legendary's abuse note lists gaslighting and familial abuse; the proposal is 0.
 */
const INCLUDE_CONTRADICTIONS = process.argv.includes('--include-contradictions');

/** A note that affirmatively describes content, vs one that says nothing is there. */
const NOTE_ASSERTS_CONTENT = (note: string | null) =>
  !!note && !/^no (evidence|occult|sexual|witchcraft|lgbtq)/i.test(note.trim());

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'accept-trusted-reviewers',
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const local = new Database('data/tbra.db');
  const now = new Date().toISOString();

  const q = await remote.execute({
    sql: `SELECT rc.id, rc.book_id, rc.category_id, rc.proposed_intensity AS prop,
                 b.title, tc.name AS cat, bcr.intensity AS cur, bcr.notes AS note,
                 bcr.evidence_level AS ev, u.email
            FROM report_corrections rc
            LEFT JOIN books b ON b.id=rc.book_id
            LEFT JOIN taxonomy_categories tc ON tc.id=rc.category_id
            LEFT JOIN book_category_ratings bcr
                   ON bcr.book_id=rc.book_id AND bcr.category_id=rc.category_id
            LEFT JOIN users u ON u.id=rc.user_id
           WHERE rc.status='new' AND u.email IN (?, ?)
             AND rc.proposed_intensity IS NOT NULL AND bcr.intensity IS NOT NULL
           ORDER BY u.email, b.title, tc.name`,
    args: EMAILS,
  });
  const rows = q.rows as any[];
  const manifest: any[] = [];

  for (const x of rows) {
    // A drop of 2+ rungs while the note still asserts the content is present is
    // the shape most likely to mislead a reader. Applied as instructed, but called out.
    const drop = x.cur - x.prop;
    const contradicts = drop >= 2 && NOTE_ASSERTS_CONTENT(x.note);
    const held = contradicts && !INCLUDE_CONTRADICTIONS;
    manifest.push({
      held,
      id: x.id, email: x.email, title: x.title, category: x.cat,
      before: { intensity: x.cur, evidence_level: x.ev },
      after: { intensity: x.prop, evidence_level: 'human_verified' },
      note: x.note,
      noteContradicts: contradicts,
    });
    console.log(`${held ? 'HOLD ' : '     '}${String(x.title).slice(0, 26).padEnd(27)} ${String(x.cat).padEnd(30)} ${x.cur} -> ${x.prop}`);

    if (held || !APPLY) continue;
    const sql = `UPDATE book_category_ratings
                    SET intensity=?, evidence_level='human_verified',
                        updated_by_user_id=?, updated_at=?
                  WHERE book_id=? AND category_id=?`;
    const args = [x.prop, ADMIN_USER_ID, now, x.book_id, x.category_id];
    await remote.execute({ sql, args });
    local.prepare(sql).run(...args);
    await remote.execute({ sql: `UPDATE report_corrections SET status='accepted' WHERE id=?`, args: [x.id] });
    local.prepare(`UPDATE report_corrections SET status='accepted' WHERE id=?`).run(x.id);
  }

  const path = 'reports/trusted-reviewer-accepts-2026-08-08.json';
  writeFileSync(path, JSON.stringify({ appliedAt: APPLY ? now : null, rows: manifest }, null, 1));
  const flagged = manifest.filter((m) => m.held);
  const done = manifest.length - flagged.length;
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${done} accepted, ${flagged.length} held. Manifest: ${path}`);
  if (flagged.length) {
    console.log(`\nHELD — drops 2+ rungs while the note still spells out that content.`);
    console.log(`Re-run with --include-contradictions to apply these too:`);
    for (const f of flagged) {
      console.log(`   ${f.title} / ${f.category}: ${f.before.intensity} -> ${f.after.intensity}`);
      console.log(`     note still reads: "${String(f.note).slice(0, 96)}"`);
    }
  }
  process.exit(0);
})();

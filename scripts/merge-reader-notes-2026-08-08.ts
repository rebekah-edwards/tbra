/**
 * merge-reader-notes-2026-08-08.ts — one-off repair + improvement pass.
 *
 * WHY THIS EXISTS: apply-confirming-corrections.ts took the reader's note verbatim
 * whenever it was longer than the existing one. That was wrong in both directions —
 * it COPY-PASTED raw review prose over sourced notes (losing detail the model had
 * found), and where the reader's note was shorter it DISCARDED first-hand detail
 * entirely. Nine notes need synthesising rather than choosing between.
 *
 * Each merged note below combines the sourced description with what the reader who
 * actually finished the book observed, in house style: 70-190 chars, descriptive,
 * no meta-language about reviewers. Where the two disagreed on fact, the reader
 * wins — e.g. First-Time Caller's model note claimed "frequent" explicit scenes and
 * the reader counted two.
 *
 * Hand-written, not generated: these are nine judgement calls about reader-facing
 * copy. Ratings/intensities are NOT touched.
 *
 * Usage: npx tsx scripts/merge-reader-notes-2026-08-08.ts [--apply]
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

const ADMIN_USER_ID = 'c2f3eb27-139f-4605-9566-8ded8d9e1336';
const APPLY = process.argv.includes('--apply');

const MERGES: { book: string; cat: string; label: string; note: string }[] = [
  {
    book: 'ea918e7b-52f1-4fb7-a2c7-5f3aee79f371', cat: '4ba66d94-2d8b-4558-858c-5643c5ae9864',
    label: "Sigra's Roost / Sexual content",
    note: 'A single brief kissing scene, with minimal romantic development around it.',
  },
  {
    book: '0224abe7-a891-4c5b-8c1c-0304c2d26b54', cat: '4ba66d94-2d8b-4558-858c-5643c5ae9864',
    label: 'First-Time Caller / Sexual content',
    note: 'Two explicit open-door scenes, detailed when they occur (heat level 4/5). Also depicts sexual harassment, though it is not central to the plot.',
  },
  {
    book: '7c21eb9d-c261-4369-aa8a-a721b1e440c5', cat: '4ba66d94-2d8b-4558-858c-5643c5ae9864',
    label: 'The Verdant Cage / Sexual content',
    note: 'Slow-burn romance with attraction and some kissing; no explicit sexual content.',
  },
  {
    book: 'd4dab4be-11b3-4214-bdd6-f12b6f55e9a8', cat: '895cee59-f605-49b5-9e8a-905cfe36c455',
    label: 'JoJo SBR v5 / Magic & witchcraft',
    note: "Stand powers, spiritual manifestations granting superpowers, drive all major conflicts; one character's Stand turns him into dinosaur-like monsters.",
  },
  {
    book: 'd4dab4be-11b3-4214-bdd6-f12b6f55e9a8', cat: '81076008-d213-45b0-bf7e-2509d75191b2',
    label: 'JoJo SBR v5 / Political & ideological',
    note: 'The chief antagonist is the sitting US president, who actively pursues the Holy Corpse parts for power.',
  },
  {
    book: 'd4dab4be-11b3-4214-bdd6-f12b6f55e9a8', cat: 'be479980-2b8a-4693-9ac9-ca22b7a46183',
    label: 'JoJo SBR v5 / Abuse & suffering',
    note: 'Intense physical suffering from combat, including a drawn-out painful ordeal for two characters; no domestic or child abuse.',
  },
  {
    book: 'd4dab4be-11b3-4214-bdd6-f12b6f55e9a8', cat: '882fd4c3-2cc9-4572-ac8b-d091e1ae7fce',
    label: 'JoJo SBR v5 / Occult / demonology',
    note: 'No occult content; Stand powers can appear cult-like but are presented as purely magical.',
  },
  {
    book: 'd4dab4be-11b3-4214-bdd6-f12b6f55e9a8', cat: '4ba66d94-2d8b-4558-858c-5643c5ae9864',
    label: 'JoJo SBR v5 / Sexual content',
    note: 'Subtle tension and loyalty themes between the leads, one embrace, and a briefly revealing outfit; no explicit scenes.',
  },
  {
    book: 'd4dab4be-11b3-4214-bdd6-f12b6f55e9a8', cat: 'dd567829-ccf2-43a4-b2e2-9bc1946313a8',
    label: 'JoJo SBR v5 / Religious content',
    note: 'Holy Corpse relics drive the central plot, with heavy religious undertones, frequent references to Catholic saints, and one character who dwells on sin.',
  },
];

(async () => {
  const bad = MERGES.filter((m) => m.note.length < 70 || m.note.length > 190);
  if (bad.length) {
    console.error('House rule is 70-190 chars. Out of range:');
    for (const m of bad) console.error(`  ${m.label}: ${m.note.length}`);
    process.exit(1);
  }

  const { remote } = await createGuardedTurso({
    name: 'merge-reader-notes',
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const local = new Database('data/tbra.db');
  const now = new Date().toISOString();
  const manifest: any[] = [];

  for (const m of MERGES) {
    const q = await remote.execute({
      sql: 'SELECT intensity, notes FROM book_category_ratings WHERE book_id=? AND category_id=?',
      args: [m.book, m.cat],
    });
    const before = q.rows[0] as any;
    manifest.push({ label: m.label, intensity: before?.intensity, before: before?.notes, after: m.note, chars: m.note.length });
    console.log(`${m.label} (${m.note.length} chars, intensity ${before?.intensity})`);
    console.log(`   was: ${String(before?.notes ?? '').slice(0, 120)}`);
    console.log(`   now: ${m.note}`);

    if (!APPLY) continue;
    const sql = `UPDATE book_category_ratings SET notes=?, updated_by_user_id=?, updated_at=?
                  WHERE book_id=? AND category_id=?`;
    const args = [m.note, ADMIN_USER_ID, now, m.book, m.cat];
    await remote.execute({ sql, args });
    local.prepare(sql).run(...args);
  }

  writeFileSync('reports/reader-note-merges-2026-08-08.json',
    JSON.stringify({ appliedAt: APPLY ? now : null, merges: manifest }, null, 1));
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${MERGES.length} notes. Manifest: reports/reader-note-merges-2026-08-08.json`);
  process.exit(0);
})();

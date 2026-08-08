/**
 * decide-reasoned-corrections-2026-08-08.ts — apply Rebekah's rulings on the 21
 * pending rating corrections that carried written reasoning.
 *
 * Companion to apply-confirming-corrections.ts, which handled only the corrections
 * that CONFIRMED an existing rating. These 21 all dispute one, so each was reviewed
 * individually and ruled on by Rebekah 2026-08-08:
 *
 *   ACCEPT (15) — the reader named something the model missed or over-called.
 *   REJECT  (4) — the reader's own note argues for the rating they wanted changed,
 *                 or the observation belongs to a different category (Airborn's
 *                 steampunk tech is not witchcraft).
 *   HOLD    (2) — still genuinely open; left as status='new'.
 *
 * TWO RULINGS WORTH KNOWING, both applied here:
 *  1. LGBTQ+ subtext does NOT earn a rating. Only content that is spelled out counts
 *     — the exception being a blatant, explicit allegory (Automatic Noodle's trans
 *     allegory is the reference case). This is why JoJo SBR v5 goes 2 -> 0.
 *  2. The Hunger Games caps at 1/4 for sexual content: "kissing and intense cuddling
 *     with limited sexual undertones isn't enough for a higher rating than that."
 *
 * Writes intensity + notes + evidence_level='human_verified' to BOTH prod Turso and
 * local sqlite, mirroring /api/admin/corrections/[id]/apply. Notes are written only
 * where a curated string is given below — never pasted verbatim from the reviewer
 * (see the notes policy in apply-confirming-corrections.ts).
 *
 * Usage: npx tsx scripts/decide-reasoned-corrections-2026-08-08.ts [--apply]
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { createGuardedTurso } from './lib/turso-guard';

const ADMIN_USER_ID = 'c2f3eb27-139f-4605-9566-8ded8d9e1336';
const APPLY = process.argv.includes('--apply');

type Decision = {
  id: string; label: string; verdict: 'accept' | 'reject';
  expect: [number, number];   // [current, proposed] — guard against drift since review
  intensity?: number;         // override; defaults to the proposed value
  note?: string;              // curated replacement note, 70-190 chars
};

const DECISIONS: Decision[] = [
  // ── ACCEPT ──────────────────────────────────────────────────────────────────
  {
    id: 'bdd07f1e-8617-476e-b7e7-dbb3eedc376b', label: 'The Hunger Games / Sexual content',
    verdict: 'accept', expect: [0, 1],
    note: 'Kissing and some intense cuddling between the leads, with limited sexual undertones; nothing explicit is depicted.',
  },
  {
    id: 'cec5655f-2e6c-495a-bab2-6a115209f8e9', label: 'The Selection Series 1-5 / LGBTQ+',
    verdict: 'accept', expect: [0, 1],
    note: 'In the fifth book, The Crown, two of the Selection contestants become a couple; their story includes a shared kiss.',
  },
  {
    id: 'b2f71495-37f5-402d-b0e5-8e41ba0d75e4', label: 'The Verdant Cage / LGBTQ+',
    verdict: 'accept', expect: [0, 1],
    note: 'A secret relationship between two female side characters runs alongside the main plot.',
  },
  {
    id: '74d265e1-00aa-43fd-9b5b-e96a8355ac18', label: 'This Story Might Save Your Life / LGBTQ+',
    verdict: 'accept', expect: [0, 1],
    note: 'Prominent side characters are in an established female-female relationship.',
  },
  {
    id: '02cc2ea5-84b9-47c6-a02b-81753ce3b94f', label: 'First-Time Caller / LGBTQ+',
    verdict: 'accept', expect: [0, 1],
    note: 'A male-male couple appears among the side characters; not a focus of the main storyline.',
  },
  {
    id: '3f3702fc-1ffb-49dc-9dfb-e8582be87788', label: "Sigra's Roost / Political & ideological",
    verdict: 'accept', expect: [0, 1],
    note: 'International politics between the nations of the invented world are discussed, without real-world parallels.',
  },
  {
    id: '410391b7-4f3c-4e5a-8b92-38fbeccaa7e3', label: "Sigra's Roost / Religious content",
    verdict: 'accept', expect: [0, 1],
    note: 'Invented religions of the fantasy world are discussed; no real-world faith is depicted.',
  },
  {
    id: 'ae0ee601-e558-407e-ac5b-04da46aa4f48', label: 'Dawn Wind / Occult / demonology',
    verdict: 'accept', expect: [0, 1],
    note: 'Pagan practice in post-Roman Britain, including animal sacrifice and offerings at shrines.',
  },
  {
    id: 'a23dde5f-36e1-4530-8bf0-a3fd3a649c06', label: 'Our Perfect Storm / Sexual content',
    verdict: 'accept', expect: [3, 2],
    note: 'Two open-door sex scenes of moderate explicitness; intimacy is otherwise implied rather than shown.',
  },
  {
    id: 'f90a94f0-180c-40c2-83ce-74e9218e6fa7', label: 'The Note / Sexual content',
    verdict: 'accept', expect: [2, 1],
    note: 'Sexual activity is implied through references to characters sleeping over; nothing is depicted on the page.',
  },
  {
    id: '37195bc6-e709-4bee-937d-3dbdcde6a392', label: 'JoJo SBR v5 / Profanity',
    verdict: 'accept', expect: [2, 1],
    note: 'Some mild curse words during confrontations; nothing graphic or sustained.',
  },
  {
    id: 'bea77ab8-6bdc-4dd6-80a9-9245a5f69dd1', label: 'Princess Academy / Magic & witchcraft',
    verdict: 'accept', expect: [2, 1],
    note: 'One magical element only: quarry-speech, a silent communication the villagers work through mountain rock.',
  },
  {
    id: 'f93d5ad1-0390-40e4-b04c-d855e57d0e4f', label: 'A Civil Campaign / Substance use',
    verdict: 'accept', expect: [0, 1],
    note: 'Social drinking appears throughout, including a disastrous dinner party; no drug use or addiction themes.',
  },
  {
    id: '68606e3e-b91d-4182-9d76-02fdff9e589c', label: 'JoJo SBR v5 / Violence & gore',
    verdict: 'accept', expect: [4, 3],
    note: 'Frequent gunfights and Stand battles in this volume, with characters taking heavy damage and several shot.',
  },
  {
    // Rebekah's ruling: subtext alone earns no LGBTQ+ rating unless spelled out.
    id: 'd74f1351-d23a-4ebd-8dc8-360858cc5a71', label: 'JoJo SBR v5 / LGBTQ+ (subtext ruling)',
    verdict: 'accept', expect: [2, 0],
    note: 'The central male duo share an intense emotional bond, but no LGBTQ+ relationship or identity is stated in the text.',
  },

  // ── REJECT — the reader's own note supports the existing rating ──────────────
  { id: '8a6051bf-ba3f-42ba-aa07-780b400de344', label: 'JoJo SBR v5 / Substance use', verdict: 'reject', expect: [1, 0] },
  { id: '6bdab2c7-d130-4c91-9e2e-254355da1c5f', label: 'A Civil Campaign / Sexual content', verdict: 'reject', expect: [3, 2] },
  { id: '0cc1fb57-40dd-4b92-86ab-20a762f92342', label: 'Airborn / Magic & witchcraft', verdict: 'reject', expect: [0, 1] },
  { id: '182e1d2f-c10c-4a1f-9474-3b7c880ae829', label: "Sigra's Roost / Violence & gore", verdict: 'reject', expect: [3, 2] },
  // Rebekah's ruling 2026-08-08: a whole magic system stays at 2 even when the reader
  // narrows what KIND of magic it is. Narrowing the flavour is not lowering the presence.
  { id: 'cfacf5b8-dca0-4827-a994-1e5c7eb39d7b', label: "Sigra's Roost / Magic & witchcraft", verdict: 'reject', expect: [2, 1] },

  // HELD (untouched, still status='new'):
  //   a4fe2b5d The Divorce / Substance use 3->1 — model claims drugs+addiction, reader only says "drinking"
];

(async () => {
  const badNotes = DECISIONS.filter((d) => d.note && (d.note.length < 70 || d.note.length > 190));
  if (badNotes.length) {
    for (const d of badNotes) console.error(`Note out of 70-190 range: ${d.label} (${d.note!.length})`);
    process.exit(1);
  }

  const { remote } = await createGuardedTurso({
    name: 'decide-reasoned-corrections',
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const local = new Database('data/tbra.db');
  const now = new Date().toISOString();
  const manifest: any[] = [];
  let applied = 0, rejected = 0, skipped = 0;

  for (const d of DECISIONS) {
    const q = await remote.execute({
      sql: `SELECT rc.book_id, rc.category_id, rc.status, rc.proposed_intensity AS prop,
                   bcr.intensity AS cur, bcr.notes AS curnote, bcr.evidence_level AS ev
              FROM report_corrections rc
              LEFT JOIN book_category_ratings bcr
                     ON bcr.book_id=rc.book_id AND bcr.category_id=rc.category_id
             WHERE rc.id=?`,
      args: [d.id],
    });
    const row = q.rows[0] as any;
    if (!row) { console.log(`SKIP ${d.label} — correction not found`); skipped++; continue; }
    if (row.status !== 'new') { console.log(`SKIP ${d.label} — already ${row.status}`); skipped++; continue; }
    if (row.cur !== d.expect[0] || row.prop !== d.expect[1]) {
      console.log(`SKIP ${d.label} — drifted since review (db ${row.cur}->${row.prop}, expected ${d.expect[0]}->${d.expect[1]})`);
      skipped++; continue;
    }

    const intensity = d.intensity ?? row.prop;
    manifest.push({
      id: d.id, label: d.label, verdict: d.verdict,
      before: { intensity: row.cur, notes: row.curnote, evidence_level: row.ev },
      after: d.verdict === 'accept'
        ? { intensity, notes: d.note ?? row.curnote, evidence_level: 'human_verified' }
        : null,
    });

    if (d.verdict === 'accept') {
      console.log(`APPLY  ${d.label}: ${row.cur} -> ${intensity}`);
      if (APPLY) {
        const sql = `UPDATE book_category_ratings
                        SET intensity=?, notes=?, evidence_level='human_verified',
                            updated_by_user_id=?, updated_at=?
                      WHERE book_id=? AND category_id=?`;
        const args = [intensity, d.note ?? row.curnote, ADMIN_USER_ID, now, row.book_id, row.category_id];
        await remote.execute({ sql, args });
        local.prepare(sql).run(...args);
        await remote.execute({ sql: `UPDATE report_corrections SET status='accepted' WHERE id=?`, args: [d.id] });
        local.prepare(`UPDATE report_corrections SET status='accepted' WHERE id=?`).run(d.id);
      }
      applied++;
    } else {
      console.log(`REJECT ${d.label}: leaving rating at ${row.cur}`);
      if (APPLY) {
        await remote.execute({ sql: `UPDATE report_corrections SET status='rejected' WHERE id=?`, args: [d.id] });
        local.prepare(`UPDATE report_corrections SET status='rejected' WHERE id=?`).run(d.id);
      }
      rejected++;
    }
  }

  writeFileSync('reports/reasoned-corrections-2026-08-08.json',
    JSON.stringify({ appliedAt: APPLY ? now : null, decisions: manifest }, null, 1));
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${applied} accepted, ${rejected} rejected, ${skipped} skipped.`);
  console.log('Manifest: reports/reasoned-corrections-2026-08-08.json');
  process.exit(0);
})();

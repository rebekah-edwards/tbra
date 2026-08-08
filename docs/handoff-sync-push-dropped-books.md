# Handoff: the 549 books sync-push drops every night

**Written 2026-08-08 by the upcoming-releases nightly session. For a normal (non-scheduled) session to pick up.**

## TL;DR — this is NOT a data-loss bug, and it is not urgent

Every `sync-push` run prints:

```
562 new books to push
⚠ books: 549 of 562 row(s) NOT inserted
✓ Pushed 13 new book rows
```

That warning looks alarming and shows up in every nightly report. I measured it. The 549 are
**local duplicate rows whose slug already belongs to a different live book**. Nothing user-facing is
being lost. Confirmed numbers as of 2026-08-08 (110,885 live books, 549 local-only):

| Bucket | Count | Meaning |
|---|---|---|
| `slugTaken` | **544** | A live book already owns this slug. The local row is a duplicate. |
| `isbnTaken` | 2 | A live book already owns this ISBN-13. Same story. |
| `genuinelyAbsent` | **3** | No live twin by slug or ISBN — these are the only real gaps. |
| **with local user activity** | **0** | No rating, review, shelf state, or favorite on ANY of the 549. |

That last row is the important one. Nobody's data is stuck. This is catalog noise, not the
[tester-libraries-stuck-local](../../.claude/projects/-Users-clankeredwards/memory/project_tester_libraries_stuck_local.md)
problem, which is a genuinely separate and more serious issue.

The `batchInsert()` doc comment in [scripts/sync-push.ts](../scripts/sync-push.ts) (~line 103) already
reached this conclusion on 2026-07-30 and added the warning specifically so a *real* regression
couldn't hide behind the same silence. The warning is working as designed. I re-verified it rather
than trusting it, and the characterization holds.

## The 3 genuinely-absent books

```
הניצוץ שבאפר                              slug=sabaa-tahir       vis=import_only  created 2026-03-28
המבוך הבוער                                slug=rick-riordan      vis=import_only  created 2026-03-28
Unearthing Ecosystems in Max Axiom's Lab   slug=unearthing-...-carol-kim  vis=public  created 2026-04-04
```

The two Hebrew ones are malformed: their `slug` is the **author's name**, not the title — an old
`assignBookSlug` failure from a March import. They are `import_only` (search-added, never shelved),
so they are invisible in the app. Either fix the slug or delete them locally; do not push them as-is.

The third is a real public book whose push has been silently failing. Worth pushing.

## What "fixing" this means

Three options, cheapest first. **My recommendation is Option A**, and only Option A — the noise is
the actual problem, not the rows.

### Option A — make the report honest (recommended, ~1 hour, no DB risk)

Teach `batchInsert()` (or its `books` call site) to classify the drops before printing: count how
many skipped rows have a live slug/ISBN twin, and print

```
⚠ books: 549 of 562 not inserted (546 duplicate of a live book, 3 genuinely absent — see docs/handoff-sync-push-dropped-books.md)
```

This turns a scary number into a boring one and — crucially — makes a real regression visible again,
because "genuinely absent" jumping from 3 to 300 is the signal that matters. No rows are touched.

There is already a working diagnostic query for this; it's reproduced at the bottom of this file.

### Option B — clean up the 3 real stragglers (~30 min)

Fix or delete the two malformed Hebrew rows, push the Carol Kim book. Do this alongside Option A.
Note that `sync-push` will keep skipping the Hebrew rows until their slugs are fixed, so deleting is
the simpler call if Rebekah doesn't want them.

### Option C — merge the 544 local duplicates into their live twins (NOT recommended right now)

This is the only option that actually zeroes the number, and it's the expensive, risky one: it means
running the dedup machinery over 544 pairs. Reasons to leave it alone:

- Zero user rows are attached, so there is no user-visible payoff.
- The dedup applier has a **history of destroying user data** when its move path was wrong
  ([project_dedup_move_destroyed_ratings](../../.claude/projects/-Users-clankeredwards/memory/project_dedup_move_destroyed_ratings.md)) —
  fixed since, but it earns caution.
- `fix-slug-collisions.ts` is flagged **DANGEROUS** in
  [project_catalog_quality_sweep](../../.claude/projects/-Users-clankeredwards/memory/project_catalog_quality_sweep.md).
  Use `merge-slug-collisions.ts` instead if this is ever done.
- The count regrows: new dupes are created by ingestion faster than a one-off merge clears them.
  Without an ingestion-side slug guard, a merge run buys a few quiet weeks, not a fix.

If Rebekah does want Option C: run it in a **dedicated session**, take a Turso PITR checkpoint first
([reference_turso_pitr](../../.claude/projects/-Users-clankeredwards/memory/reference_turso_pitr.md)),
and never bolt it onto a nightly task.

## Rules that apply to this work

- All Turso-writing scripts must use `createGuardedTurso`
  ([reference_turso_guard](../../.claude/projects/-Users-clankeredwards/memory/reference_turso_guard.md)).
- Deletes ≥1,000 rows, or any DROP/TRUNCATE, need Rebekah's explicit go-ahead. Option C is well under
  that bar per-operation, but it is a mass catalog edit — confirm before applying.
- Rebekah runs no commands herself. Do the work; don't hand back instructions.
- Stage only the files you touched; never `git add -A`.

## Reproducing the measurement

Save as `scripts/tmp-diagnose-dropped.mts`, run `npx tsx scripts/tmp-diagnose-dropped.mts`, delete
when done. (`.mts` matters — `.ts` in this repo compiles as CJS and rejects top-level `await`.)

```ts
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';

const remote = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const local = new Database('data/tbra.db', { readonly: true });

// Page the live id set — a single SELECT of 110k ids is fine, but keyset paging
// keeps this honest if the catalog keeps growing.
const liveIds = new Set<string>();
let cursor = '';
for (;;) {
  const r = await remote.execute({ sql: 'SELECT id FROM books WHERE id > ? ORDER BY id LIMIT 5000', args: [cursor] });
  if (r.rows.length === 0) break;
  for (const row of r.rows) liveIds.add(String(row.id));
  cursor = String(r.rows[r.rows.length - 1].id);
}

const missing = (local.prepare('SELECT id, title, slug, isbn_13, visibility, created_at FROM books').all() as any[])
  .filter((b) => !liveIds.has(b.id));

let slugTaken = 0, isbnTaken = 0, genuinelyAbsent = 0;
for (const b of missing) {
  const bySlug = b.slug ? await remote.execute({ sql: 'SELECT id FROM books WHERE slug = ? LIMIT 1', args: [b.slug] }) : { rows: [] };
  if (bySlug.rows.length) { slugTaken++; continue; }
  const byIsbn = b.isbn_13 ? await remote.execute({ sql: 'SELECT id FROM books WHERE isbn_13 = ? LIMIT 1', args: [b.isbn_13] }) : { rows: [] };
  if (byIsbn.rows.length) { isbnTaken++; continue; }
  genuinelyAbsent++;
  console.log(`  ABSENT: ${b.title} | slug=${b.slug} | isbn13=${b.isbn_13} | vis=${b.visibility}`);
}
console.log({ total: missing.length, slugTaken, isbnTaken, genuinelyAbsent });
```

Note the local column is `isbn_13`, not `isbn13` — that typo cost me a run.

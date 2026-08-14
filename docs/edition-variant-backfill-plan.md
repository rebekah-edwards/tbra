# Backfill plan: folding existing edition variants into selectable editions

Reviewing the whole catalog for "<Title> Deluxe Limited Edition" rows that should be an
edition of the canon book, and folding them in without losing user data.

Ingestion is already fixed — see "What changed at ingestion" below. This document covers
only the rows that landed **before** that fix.

---

## What the scan found

`scripts/find-edition-variant-dupes.ts --verify-turso`, run 2026-08-14 against 113,811
books (box sets excluded):

| Bucket | Count | Meaning |
|---|---:|---|
| **Auto-mergeable** | **176** | Decorated row, undecorated canon exists, **zero** user rows on local AND Turso |
| **Supervised** | **9** | Decorated row carries user activity — a human decides what wins |
| **No canon** | **9** | Every row in the group is decorated — there is nothing to merge *into* |

Manifest: `reports/edition-variant-dupes-2026-08-14.json`

The 9 supervised pairs, in full — this is the entire human-judgement workload:

```
Twilight Special (1u)                            -> Twilight
The Hobbit: 75th Anniversary Edition (2u)        -> The Hobbit
Mere Christianity Deluxe Edition (1u)            -> Mere Christianity
Shatter Me Paperback Deluxe Limited Edition (1u) -> Shatter Me
Prayer - 10th Anniversary Edition (1u)           -> Prayer
The City of Brass Deluxe Collector's Edition (1u)-> The City of Brass
Dragonflight [Abridged] (1u)                     -> Dragonflight
White Nights. Illustrated (1u)                   -> White Nights
Coal River [Large Print] (1u)                    -> Coal River
```

`Shatter Me Paperback Deluxe Limited Edition` is the pair the merge documentation already
flagged as having a `user_book_state` collision with canon Shatter Me on both databases.
It must not be auto-merged.

**Scale note:** 194 rows total. This is a small, finite job — not a grind. It does not need
a nightly lane; it needs one supervised session.

---

## Phase 1 — Re-scan immediately before applying (required)

The manifest above is a snapshot. A tester can shelve either book between scan and apply,
which turns an auto-mergeable pair into a data-loss hazard.

```bash
npx tsx scripts/find-edition-variant-dupes.ts --verify-turso --out=reports/edition-variant-dupes-APPLY.json
```

Compare the auto-mergeable count against 176. If it moved, read the diff before proceeding —
a pair that *left* the auto bucket acquired user rows and must be treated as supervised.

## Phase 2 — Capture the printings BEFORE deleting anything

This is the step that makes this a *merge into a selectable edition* rather than a plain
deduplication. Each decorated row carries an ISBN, cover, page count and publisher that
OpenLibrary often does not list; deleting the row without capturing them is the "honest
loss of fidelity" the merge doc describes.

A new applier (`scripts/apply-edition-variant-merges.ts`, **not yet written** — Phase 2 is the
one piece of this plan that still needs code) must, per pair, in this order:

1. `recordLocalEdition({ bookId: canonical_id, source: 'merge', mergedFromBookId: dupe_id, … })`
   carrying the dupe's ISBN-13/10, cover URL, pages, publisher and the extracted
   `editionLabel`. Idempotent by `(book_id, isbn)`, so a re-run cannot stack duplicates.
2. Fill **blank-only** fields on the canon (never overwrite — a deluxe printing's cover must
   not replace the real book's).
3. Only then hand the pair to the existing, proven merge machinery.

Ordering matters: if the delete runs first, the ISBN and cover are gone and the edition row
cannot be reconstructed.

## Phase 3 — Merge with the existing supervised applier

Do **not** write a new merge path. `scripts/replay-dedup-both.ts` already does the hard parts
correctly and has been through two data-loss incidents:

```bash
npx tsx scripts/replay-dedup-both.ts --manifest=reports/edition-variant-dupes-APPLY.json
# dry run by default — inspect, then:
npx tsx scripts/replay-dedup-both.ts --manifest=reports/edition-variant-dupes-APPLY.json --apply --chunk=5 --pause=200
```

It moves user rows with `UPDATE book_id` (never `INSERT OR IGNORE` + `DELETE` — that is the
2026-07-30 incident that destroyed ratings and reviews on tables with a surrogate `id` PK),
re-checks overlap immediately before touching each pair, and applies **local first, then
Turso** so `sync-push` cannot resurrect the dupe.

The manifest's `autoMerge` array is already in the `{dupe_id, dupe_title, canonical_id,
canonical_title}` shape that script expects; the `edition` sub-object is extra and ignored
by it.

## Phase 4 — Purge the search index

Meilisearch does not self-clean after a merge; the deleted ids keep returning as
near-duplicate search results.

```bash
npx tsx scripts/delete-dupes-from-meilisearch.ts --manifest=reports/edition-variant-dupes-APPLY.json --apply
```

## Phase 5 — Verify on BOTH databases before claiming done

Per `feedback_triage_verification`, an unverified "resolved" is worse than an open report.
For each merged pair confirm, on local **and** Turso:

- the dupe row is gone,
- no user rows still point at the deleted id,
- the canon holds the moved rows,
- an `editions` row exists on the canon carrying the dupe's ISBN and label.

That last check is the new one, and it is the whole point — it is the difference between
"we deleted a duplicate" and "the reader can now say they own the deluxe hardcover".

## Phase 6 — The 9 supervised pairs, by hand

For each: decide which state/rating/review wins, apply it to the canon, then delete the
loser. Same recipe as the Onyx Storm hand-merge (`project_onyx_storm_merge`).

Every one of these is a single user with a single shelf state, so each is a ~30-second
decision. Recommend doing them in one sitting rather than deferring — deferred merge work is
exactly what rotted the triage queue to 105 days.

## Phase 7 — The 9 "no canon" groups are NOT merges

Every row in these groups is decorated, so there is no canon to fold into. Merging two
decorated rows together would just pick an arbitrary winner and leave the catalog with a
book whose title is still "… Deluxe Limited Edition".

The correct action is a **rename** of the best row to its undecorated form (plus a slug
regeneration), then re-running the scan so the rest of the group becomes an ordinary
auto-mergeable case. Treat these as a separate, smaller task — do not fold them into the
merge run.

---

## Risks, and what covers them

| Risk | Cover |
|---|---|
| A tester shelves a book between scan and apply | Phase 1 re-scan + `replay-dedup-both.ts`'s own TOCTOU re-check |
| User rows silently destroyed on merge | `UPDATE book_id` row-moving; zero-user gate; overlap checked on **both** DBs |
| The printing's ISBN/cover lost | Phase 2 runs strictly before Phase 3 |
| Dupe resurrected by the next sync | Applier writes local first, then Turso |
| Deleted books linger in search | Phase 4 |
| A genuinely different product merged away | Box sets, omnibuses, collections and volume numbers are never stripped; `scripts/check-edition-title-rules.ts` guards the rule set |

## What is explicitly NOT in scope

- The 1,226 decorated rows with **no sibling at all**. Nothing to merge them into — they are
  a title-cleanup problem, not a duplication problem, and folding them into this run would
  turn a 194-row job into a 1,400-row one with a different risk profile.
- Any loosening of `mergeDupeIntoCanonical()`'s zero-user gate in `process-reports.ts`. That
  function does not move user rows and deletes on the strength of that contract.

---

## What changed at ingestion (already shipped — context for why this is finite)

New rows of this kind should stop appearing. `src/lib/text/edition-title.ts` is now the single
source of truth for what counts as edition decoration, and all seven ingestion paths consult
it before inserting:

| Path | Previously | Now |
|---|---|---|
| Search → ISBNdb add | ISBN + a fuzzy title fn that left "deluxe limited" in place, and searched `LIKE '%<full decorated title>%'` | `resolveEditionVariant` — folds onto canon, records the printing |
| Search → OL add | OL key + same fuzzy fn | `resolveEditionVariant` |
| Manual add | slug collision on the raw title | `resolveEditionVariant` |
| Goodreads import | parenthetical-only normalization | edition key in `buildLookupCache` |
| StoryGraph / Libby | **exact title match only** | shared cache + `findCanonicalForEdition` |
| `nightly-import.ts` (discovery, breadth) | **OL work key only — no title matching at all** | `findCanonicalForEdition`, incl. the backlist cascade |
| `upcoming-releases.ts` | ISBN + slug collision on the raw title | `findCanonicalForEdition` |

`editions.open_library_key` stays `NOT NULL UNIQUE` — non-OL printings carry a synthetic
`local:<uuid>` key, so no production table had to be rebuilt. `source` is what distinguishes
them; never test the key for nullness. `editions` was also added to `sync-push.ts` (step 5g),
without which every locally-recorded printing would have been stranded off prod.

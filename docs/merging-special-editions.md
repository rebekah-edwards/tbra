# Merging special editions into selectable editions

How a "Deluxe / Collector's / Anniversary Edition" that landed as its own book entry gets folded into the canon book — what the merge actually does today, what "selectable edition" means structurally, and the gap between the two.

---

## The problem

Publishers ship the same work as separate products: *Unravel Me*, *Unravel Me Paperback Deluxe Limited Edition*, *Shatter Me Collector's Deluxe Limited Edition*. Every metadata source treats those as distinct records with distinct ISBNs, so ingestion creates a separate `books` row for each.

To a reader they are one book. Splitting them means the canon entry's ratings, reviews and shelf counts are diluted across rows, search returns near-duplicates, and someone who owns the deluxe printing appears not to have read the book at all. Rebekah's standing rule: **a special edition is an edition of the canon book, not its own entry.**

---

## Two different operations

These get conflated. They are not the same thing.

### A. Merge (what we do today, and what closes the reports)

Fold the duplicate `books` row into the canon row and delete it:

1. Move the dupe's user rows onto the canon book with `UPDATE book_id` — shelf state, ratings, reviews, favorites, up-next, notes, reading sessions, shelf memberships.
2. Move series links the canon doesn't already have.
3. Delete the dupe row with full FK cleanup.
4. Purge the deleted id from Meilisearch.

Result: one entry, all activity consolidated, nothing lost. This is fully supported and automated.

### B. Make the printing selectable (a separate capability, only partly there)

Give the reader a way to say *"I own the deluxe hardcover"* on the canon book's page — a specific printing they can pick, with its own cover.

**This is not a consequence of the merge.** Merging deletes the deluxe row; it does not create an edition record. Whether the deluxe printing is then selectable depends entirely on something outside our control, explained below.

---

## How editions actually work

Two tables:

```
editions              id, open_library_key (NOT NULL, UNIQUE), book_id,
                      title, publish_date, publishers, isbn_13, isbn_10,
                      pages, cover_id
user_owned_editions   user_id, book_id, edition_id, format
                      UNIQUE(user_id, book_id, edition_id, format)
```

And the picker itself, in `src/app/book/[id]/book-page-client.tsx:258`:

```ts
const olPromise = book.openLibraryKey ? (async () => {
  const res = await fetch(`/api/openlibrary/editions?workKey=…&limit=100`);
  …
```

Three consequences, and they are the whole story:

1. **The picker list is fetched live from OpenLibrary at render time**, keyed on the canon book's `open_library_key`. It is not read from our `editions` table.
2. **`editions.open_library_key` is `NOT NULL UNIQUE`.** An edition row cannot exist without an OpenLibrary identity. There is no way to mint a local-only edition from a `books` row we happen to have.
3. **A book with no `open_library_key` shows no picker at all** — the fetch is skipped entirely.

So the selectable editions for a book are exactly "the editions OpenLibrary lists under that work." See `project_edition_picker_ol_only` in memory.

---

## What that means when you merge a deluxe edition

| Case | Outcome |
|---|---|
| OL lists the deluxe printing under the canon work | Merge, and it is already selectable — no extra step. |
| OL doesn't list it | Merge still correct (one entry, activity consolidated), but the printing is **not** selectable. The reader can pick a format, not that specific printing. |
| Canon book has no `open_library_key` | No picker renders at all. Fix the canon book's OL key first — that is the higher-value fix, since it restores the whole picker, not one printing. |

Merging is the right call in all three cases. The second row is a real, honest loss of fidelity and should be described that way rather than papered over — the reports asking for "a selectable edition" will be *partly* satisfied.

---

## Doing a merge

### 1. Identify the pair

Canon is the **undecorated** title. `process-reports.ts` strips edition decoration (`stripEditionSuffix`) before matching, and undecorated titles outrank everything in canonical scoring, so a deluxe row with more shelf activity can never win and cause the real book to be deleted.

Only decoration is stripped — `Collection`, `Box Set`, `Omnibus` and volume numbers are **not**, because those are genuinely different products. "Shatter Me : the Six-Novel Collection" is not an edition of *Shatter Me*.

### 2. Check for user collisions — never skip this

The merge moves rows keyed `(user, book)`. If the **same user** holds rows on both books in the same table, one side loses. Check with `findUserOverlap()` from `scripts/lib/dupe-overlap.ts`, **on local and Turso both** — they disagree in practice.

This is not theoretical. On 2026-08-14, five of six reported pairs were clean, but the unreported *Shatter Me Paperback Deluxe Limited Edition* had a `user_book_state` collision with canon Shatter Me on both databases. Auto-merging it would have silently destroyed a user's shelf state.

### 3. Automatic path — zero-user dupes only

`process-reports.ts` auto-merges a reported dupe only when it has **zero** user rows. `mergeDupeIntoCanonical()` does not move user rows; it deletes on the strength of that contract.

> **Do not loosen that gate to `findUserOverlap()` without first adding `UPDATE book_id` row-moving.** That exact combination — a finer collision check with no row move — is the 2026-07-30 incident that destroyed ratings and reviews on tables with a surrogate `id` PK. See `project_dedup_move_destroyed_ratings`.

### 4. Supervised path — anything with user rows

Build a manifest of `{dupe_id, dupe_title, canonical_id, canonical_title}` and run:

```bash
npx tsx scripts/replay-dedup-both.ts --manifest=reports/<manifest>.json
```

Dry-run by default. It re-checks overlap immediately before touching each pair (a tester can shelve either book between scan and apply), moves user-unique rows with `UPDATE book_id`, applies to local first then Turso so `sync-push` can't resurrect the dupe, and writes a run report. Add `--apply` when the dry run is clean.

Then purge the search index — it does not self-clean:

```bash
npx tsx scripts/delete-dupes-from-meilisearch.ts --manifest=reports/<manifest>.json --apply
```

Worked example: `reports/dedup-manifest-mafi-deluxe-2026-08-14.json` (6 pairs, 32 rows moved).

### 5. Verify, then resolve

Confirm on **both** databases that the dupe row is gone and no user rows still point at the deleted id, and that the canon holds the moved rows. Only then resolve the report — per `feedback_triage_verification`, an unverified "resolved" claim is worse than an open report.

Collisions found in step 2 are hand-merged: decide which state/rating/review wins, apply it to the canon, then delete the loser.

---

## Making special editions genuinely selectable

**Built 2026-08-14.** The section below described four steps to break the OpenLibrary
dependency; steps 2–4 are now done, in a cheaper form than proposed.

`editions.open_library_key` was **not** relaxed to nullable. Doing that would mean rebuilding
the table on production Turso — SQLite cannot `ALTER` a column — and the same capability is
available from a purely additive migration: a non-OL printing carries a synthetic
`local:<uuid>` key, and a new `source` column (`openlibrary` | `isbndb` | `google_books` |
`merge` | `manual`) is what distinguishes it. **Never test the key for nullness to decide
whether an OL fetch is meaningful — test `source`.** Also added: `cover_url` (local editions
have no OL cover id to build a URL from), `format`, `edition_label`, `merged_from_book_id`.

The picker now renders local printings *above* OpenLibrary's live list
(`src/lib/queries/local-editions.ts` → `/api/books/[id]/local-editions` →
`edition-picker.tsx`), each with its decoration as a badge. They are held in a separate
array from the OL entries so load-more's offset arithmetic stays a pure function of how many
OL entries have been fetched. `"Specify edition"` is no longer gated on the book having an OL
work key — a book with local editions and no OL identity now shows a picker where it
previously showed nothing.

Ingestion mints these rows automatically: `resolveEditionVariant()` folds a decorated title
onto the canon book, fills **blank-only** fields there, and records the printing's ISBN,
cover and page count as an edition. So case 2 in the table above — "merge is correct but the
printing is not selectable" — now only applies to rows that predate this change.

Still open, and still the highest-yield fix for books with no picker at all:

1. **Backfill `open_library_key` on canon books that lack one.** Restores the entire OL
   picker for those books rather than one printing.

Two things to know before touching this area:

- `editions` is in `sync-pull` and, since this change, in `sync-push` (step 5g). Before that
  it was pull-only — editions were only ever created on live by the picker. Every nightly
  lane writes LOCAL, so without the push step each recorded printing would be stranded.
- For the rows that landed before the ingestion fix, see
  [`edition-variant-backfill-plan.md`](edition-variant-backfill-plan.md). Phase 2 of that plan
  (capture the printing before deleting the row) is the one piece still needing code.

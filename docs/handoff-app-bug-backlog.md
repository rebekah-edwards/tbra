# Handoff: app-bug backlog from /admin/issues

**Written:** 2026-08-14, from the nightly-report-triage run.
**Scope:** the 9 open reports that are **app/code bugs**, excluding the Finished-flow cluster (that has its own handoff: `docs/handoff-finish-book-failure.md`) and excluding the 23 data/catalog items.

---

## Read this first: several of these are already fixed

Rebekah's read is that many of these have been resolved in code but were never closed out in `/admin/issues`. Spot-checking confirms that — two of the nine were fixed on 2026-07-30 by a commit that literally cites the reporting tester's own example.

**So step 1 for every item below is "is this still real?", not "how do I fix it?"** Reproduce against current `origin/main` (deployed) and the latest TestFlight build before writing a line of code. Then resolve the report either way — a fixed-but-open report costs Rebekah the same attention as a broken one.

Per `feedback_triage_verification`: a "resolved" claim must be verified, not assumed. For UI items that means a screenshot; for data-shaped ones, a DB check.

Status column below:
- **FIXED (verified)** — I read the shipped code and it handles the reported case. Close after a confirming screenshot.
- **LIKELY OPEN** — I looked and found no implementation, or found a plausible mechanism. Treat as real work.
- **UNVERIFIED** — I did not investigate deeply. Reproduce first.

---

## The nine

### 1. Library sort by Author A-Z uses first names, and "Ask for Andrea" files under author "A"
`tf:AAJQ3pQJynFMejOw9isSyqI` · 2026-07-20 · tester Meganlstanton@yahoo.com · **FIXED (verified)**

Fixed by `3cc82a6` (2026-07-30, "Sort library by surname, ignore leading articles, reject listing scrapes"), which postdates the report by ten days.

- Web: `src/app/library/library-client.tsx:60` `authorSortKey()` — converts "A. Rae Dunlap" → "Dunlap, A. Rae", handles suffixes (Jr./III) and surname particles (Le Guin, van, de).
- iOS: `native-ios/LibraryView.swift:522` — same algorithm, ported.

The code comment uses **the tester's exact example**, so this report is what drove the fix. The "Ask for Andrea parsed as author A" half is the same root cause (a bare initial being treated as the surname) and is covered by the suffix/particle walk. **Action:** screenshot the Author A-Z sort on both surfaces, confirm, close.

### 2. Title sort lumps all "A …" titles together
`tf:ACE_geJulYVUOGDE6svL9Ys` · 2026-07-20 · **FIXED (verified)**

Same commit. `titleSortKey()` strips leading `a `/`an `/`the ` — web `library-client.tsx:51`, iOS `LibraryView.swift:508`. "A Court of Thorns and Roses" now files under C.

Note the tester asked for this as an **optional toggle** ("ignore if this is by choice"). It shipped as unconditional behavior, which is the standard library convention and matches how "The …" already worked. **Recommendation:** close as fixed, don't build the toggle unless Rebekah wants it — it's a settings-surface cost for a convention almost everyone expects.

### 3. Scion — iOS missing the pre-release notice the web app shows
2026-08-01 · **FIXED (verified)**

`native-ios/BookDetailView.swift:2707` `PreReleaseBanner`. The comment records it as punch-list #6, fixed 2026-08-08, and explicitly names *"also reported from TestFlight on 2026-08-01 for Scion"* — this report.

It mirrors the web's day/month/year precision cascade: a full date is pre-release only if the day is ahead, `YYYY-MM` only if the whole month is, a bare year only if the year is. **Action:** confirm on-device against Scion, close.

### 4. Book covers don't load on the library page (iOS)
`tf:ACE_geJulYVUOGDE6svL9Ys` (part 1 of the same report as #2) · 2026-07-20 · **UNVERIFIED**

Tester's screenshot 3 shows the app *has* the cover; screenshot 1 shows the same book with no cover in the list. So the URL is present and the image isn't rendering — this reads as a loading/caching problem in the list view, not missing data.

Where to look: the async image loading in `native-ios/LibraryView.swift` and whatever shared cover-image view it uses. Likely candidates are a cache eviction under memory pressure, a cancelled task on fast scroll, or no retry after a failed first load. Screenshots are at `data/testflight-feedback/ACE_geJulYVUOGDE6svL9Ys-*.jpg`.

Note this report is a **two-part** report — closing it requires resolving both this and #2.

### 5. Search dropdown menu is clipped, options unreachable (iOS)
`tf:AMVpMk1BjVNKLvBsRDvFvBc` · 2026-07-20 · **UNVERIFIED**

From the search results list, opening the state dropdown (with or without "To Read" selected) cuts off the menu; the tester had to open each book individually to reach the other options.

Where to look: `native-ios/SearchView.swift` around the state-setting call sites (lines ~392–418) and whatever menu/dropdown container wraps them. This smells like a frame/clipping or safe-area issue on the row's overlay rather than a logic bug. Screenshot: `data/testflight-feedback/AMVpMk1BjVNKLvBsRDvFvBc-*.jpg`.

Worth checking against `project_native_ios_kickoff`, which catalogs the iOS 27 hit-testing bugs — a menu that renders but can't be reached has overlapped with that family before.

### 6 & 7. Author count is wrong — undercounts finished books
`tf:AI2GyRaOORbGygiogWJNqyQ` + `tf:ANLXtjLxqF7xCbPZSyGAa2c` · both 2026-07-20 · tester Meganlstanton@yahoo.com · **UNVERIFIED — treat as one bug, two reports**

- First report: 3 Neal Shusterman books finished, all with 2026 finish dates in the library, but the author count disagrees.
- Follow-up: after syncing her data to match Fable, authors show with **one** book read where they should show **two or three**.

Two distinct hypotheses, and they need separating before any code changes:

1. **Counting bug** — the stat counts distinct authors or books-per-author using a join that drops rows (e.g. counting only the primary `book_authors` row, or filtering on a completion date that's null for some sessions).
2. **Data problem** — the same author exists as multiple `authors` rows, so her three Shusterman books are split across duplicate author records. This would present exactly as "one book read" repeated. Given the catalog's known duplicate-author history, this is at least as likely as a code bug.

**Start by querying her actual rows** rather than reading the stats code — pull her finished books, their `book_authors` joins, and check whether Shusterman resolves to one `authors.id` or several. That single query tells you which of the two you're in. Her account is identifiable from the TestFlight email.

If it's hypothesis 2, this belongs with the data work, not here.

### 8. Profile page won't load in the app (loads on the website — then stopped there too)
2026-07-31 · **UNVERIFIED — highest severity in this batch**

"the profile page won't load in the app but it will on the website. I tried to wait it out and refresh on the website which helped at first but then stopped allowing me to access the profile in app at all."

The escalation pattern — works on web, degrades, then fails in-app entirely — suggests something accumulating per-user rather than a static rendering bug: a payload that grows with library size until it times out, an unbounded query, or a cached bad response. A profile that loads and then permanently stops is not a layout bug.

This one has no screenshot and no reference code. **Reproduce with a large library first** — if it's size-dependent, a small test account will show nothing. The `test_account` in memory may be too small to trigger it; consider reproducing against a copy of a heavy account's data locally rather than touching a tester's live account.

### 9. Every Exquisite Thing — shows "own 1 copy" but also appears under "Not Owned"
2026-07-27 · **LIKELY OPEN**

The web filter is a straight predicate — `src/app/library/library-client.tsx:110-112`:
```ts
case "owned":     return tbrBooks.filter((b) => b.ownedFormats.length > 0);
case "not_owned": return tbrBooks.filter((b) => b.ownedFormats.length === 0);
```
These are exact complements, so a book cannot appear in both tabs *from the same payload*. That means the book detail view and the library list are reading ownership from **different sources** and disagreeing — the detail page says owned, the library payload has `ownedFormats` empty.

Look at what populates `ownedFormats` in `getUserBooks` versus what the book page reads. `1c5d11e` (2026-08-13) changed `getUserBooks`'s return shape, so re-verify against current `main` — the report predates it and the behavior may have shifted either direction.

Check the underlying row for this user + book first; if `ownedFormats` is genuinely empty in the DB while an owned-format record exists elsewhere, this is a write-path bug (ownership set somewhere that doesn't update the field the library reads), which would affect more than one book.

---

## Suggested order

1. **#8 profile won't load** — worst user impact, a tester locked out of a whole surface.
2. **#6/#7 author count** — one query decides code-vs-data, cheap to resolve.
3. **#9 owned/not-owned** — likely a real write-path or payload bug; may be broader than one book.
4. **#1, #2, #3** — verify + close, near-zero code.
5. **#4 covers, #5 dropdown** — iOS polish, real but lower stakes.

## Shipping requirements (project rules, non-negotiable)

- **Web changes ship to prod as part of "done."** Worktree flow: branch `main-deploy` from `origin/main` — the checkout sits on `claude/native-ios-api-shelves-upnext`, so parity-check every file against `origin/main` before copying. Verify with a one-shot `npx vercel inspect thebasedreader.app`. Never `vercel --prod`; never watch-loop `vercel ls`.
- **After any native iOS change that builds: run `./native-ios/push-to-phone.sh`.** Don't ask first.
- **Never touch the port 3000 dev server** — launchd service `com.tbra.devserver`; restart only via `launchctl kickstart -k gui/501/com.tbra.devserver`.
- **Screenshot-verify every UI change** before calling it done, and check computed styles for CSS changes (Turbopack serves stale code — `rm -rf .next` and restart if they disagree).
- Stage only the files you touched. Never `git add -A`.
- Mobile UI review at 390x844. Never resize the browser yourself — ask.

## Design rules that apply to anything visual here

Accent is always `#a3e635`; black text on solid green; links use `text-neon-blue`, never `text-primary`. See `feedback_design_rules` and the conventions block in `CLAUDE.md`.

## Closing the reports

All nine are `status='new'` in `reported_issues`. The TestFlight-sourced ones carry a `[TestFlight tf:…]` prefix and have local screenshot backups under `data/testflight-feedback/`. Note that `reported_issues` is bidirectional but `report_corrections` syncs in **neither** script — see `project_tester_libraries_stuck_local`.

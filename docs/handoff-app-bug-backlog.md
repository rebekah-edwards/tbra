> **SUPERSEDED 2026-08-15 → [`handoff-ios-ship-2026-08-15.md`](handoff-ios-ship-2026-08-15.md).**
> Send an agent *that* doc. This one is the investigation trail, and it contains leads that are now
> known-wrong (the `try?` call sites are fixed; the "reproduce with a large library" advice for the
> profile bug is backwards). Read it for history, not for instructions.

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

---

# Status update — 2026-08-14 (end of triage session)

Six of the nine items in this doc are now closed. What follows is the state of the rest.

## Closed

| Item | Outcome |
|---|---|
| #1 Author A-Z sort | Verified fixed by `3cc82a6`; closed. |
| #2 "A …" title sort | Verified fixed by the same commit; closed as fixed rather than building the opt-out toggle. |
| #3 Scion pre-release notice | Verified fixed 2026-08-08 (`PreReleaseBanner`); closed. |
| #6/#7 Author count | **Not a code bug and not duplicate authors.** The production query returns Neal Shusterman = 3, matching her count; top-8 contains no 1-book author displacing a 2-book one. Reads as mid-sync state when filed. Closed with the evidence and an invitation to reopen with a screenshot. |
| #9 Owned / Not Owned | **Fixed — and it was neither a filter bug nor bad data.** Her row is correct and the two filters are exact complements on both surfaces, so a book in both is always staleness. SwiftUI's `.task` runs once per view lifetime and `LibraryView.onAppear` only consumed deep-links, so changing owned formats on the detail screen and navigating back left the list on pre-change data. `LibraryView` now refreshes on appear, guarded by a `hasLoaded` flag. Built and installed to device. |

## Still open

### #8 Profile page won't load in-app — highest severity remaining
Untouched. Needs reproduction against a large library; the escalation pattern (works on web, degrades, then fails in-app) still points at something size- or cache-dependent rather than a rendering bug. Do not reproduce against a small test account.

### #4 Covers not loading in the library list · #5 Search dropdown clipped
Both still need on-device reproduction. Note that #4 shares a report row with #2, so that row cannot close until #4 is resolved.

### The spoiler sparkle (`ba64c7cf`) — deliberately not attempted, and why
The web effect is `src/components/review/spoiler-particles.tsx`: a canvas overlay that reads `getClientRects()` of every unrevealed `.spoiler-tag` and animates ~0.025 particles/px², drifting at 0.35 px/frame, flickering on a per-particle sine phase, white in dark mode and black in light.

iOS has no equivalent. `ReviewsListView.swift:437` renders an unrevealed spoiler as **transparent text over a solid `Theme.surfaceAlt` background**, inside a single `AttributedString`.

The reason this is not a quick job: the whole review is one `AttributedString` rendered by one `Text`, and there is no iOS equivalent of `getClientRects()` for a run inside it. You cannot position particles without run geometry.

The correct implementation is a **custom `TextRenderer`** (iOS 18+, and the app targets 27):

1. Define a `TextAttribute` marking spoiler runs.
2. Convert `ReviewHTML.attributed(...)` from building one `AttributedString` to concatenating per-segment `Text` values, applying `.customAttribute(...)` to spoiler segments. Reveal is currently driven by `part.link = URL("tbra-spoiler://\(idx)")` plus an `OpenURLAction`, so that tap path has to survive the conversion — this is the part most likely to regress.
3. In `draw(layout:in:)`, walk runs, and for each spoiler run draw the glyphs as today, then draw the particle field within its `typographicBounds`.
4. Drive animation with a `TimelineView` feeding a time value into the renderer.

Match the web's constants so the two surfaces look like one product. Budget this as real work on a core surface, not a polish pass — a botched conversion breaks review rendering and spoiler reveal for every user.

---

# Status update — 2026-08-15 (nightly-report-triage)

## #8 Profile won't load — the leading hypothesis is DISPROVEN. Do not follow this doc's original advice.

The 2026-08-14 write-up above says the escalation pattern "suggests something accumulating per-user
rather than a static rendering bug: a payload that grows with library size until it times out, an
unbounded query, or a cached bad response," and instructs the next investigator to **"reproduce with
a large library first — if it's size-dependent, a small test account will show nothing."**

**That is wrong, and following it would waste the effort.** Measured tonight:

**1. We know who filed it.** `reported_issues.user_id` on `cb73411e-5a59-44ea-87c7-87e8301bcb4f` is
`b3a035fa-5c7c-46f5-b809-bdeea88a9cce` = `holmes.kayleigh.m@gmail.com` ("Kay :)", `@holmeskay`). The
doc treated this report as anonymous. It is not — reproduce against her account, not a synthetic one.

**2. Her library is small, not large.** 61 books, 2 favorites, 9 reviews, 0 reading notes. The five
heaviest accounts in the DB carry 1,169–2,021 books. She is nowhere near the top; the size hypothesis
has the direction backwards.

**3. The whole `/api/v1/profile` payload runs in 21ms for her.** Every one of the ten queries the
route fans out in its `Promise.all`, timed individually against local sqlite:

```
getUser 1ms · getUserStats 1ms · getUserFavorites 5ms · getUserReviewsWithBooks 9ms
getRecentNotes 0ms · getFollowerCount 0ms · getFollowingCount 1ms · getUserShelves 3ms
ensureReferralCode 1ms · getReferralCount 0ms          → 21ms serial, largest payload 2.7KB
```

**4. It is not unbounded even for the heaviest users.** The same five queries against all five
1,100–2,000-book accounts stay under 50ms each with payloads under 6KB. `getUserReviewsWithBooks` and
`getRecentNotes` take explicit limits (6 and 20) at the call site; `ensureReferralCode` short-circuits
when a code already exists and its generator is capped at 5 attempts with a deterministic fallback.
There is no unbounded scan and no size-dependent payload in this route.

So: **not a slow query, not payload size, not library size.** Whatever breaks her profile in the app
is not in the `/api/v1/profile` query set.

### Where to look instead

The measurements above only clear the server's *data* path. They do not clear:

- **Auth / token refresh on iOS.** "Works on web, degrades, then fails in-app entirely and stays
  failed" fits an expired or bad cached credential far better than it fits a slow query — the web
  session and the app token are separate, which is exactly why one surface kept working while the
  other died permanently.
- **Client-side caching in the iOS app.** A cached bad response that is never invalidated reproduces
  the "stopped allowing me to access the profile in app at all" permanence. Note the `LibraryView`
  staleness bug closed on 2026-08-14 was the same family of defect (`.task` running once per view
  lifetime), so this app has form here.
- **Response serialization**, not response size — a single unexpected null in her row breaking iOS
  decoding would fail identically every time regardless of how fast the query is.

Cheapest next step: hit `/api/v1/profile` on **prod** with her account's token and inspect the actual
response, rather than reading query code. If prod returns 200 with sane JSON, the bug is entirely
client-side and belongs in the iOS app, not the API.

## #4 covers · #5 search dropdown — still open, unchanged

Both need on-device iOS reproduction and neither can be done from this automated task (no simulator
work, no device, no UI to inspect). They remain accurately described above. Report row
`2b67d3ea-ae5a-44a8-91c7-04855c9f62ad` still cannot close until #4 is resolved, since #2 (fixed)
shares that row.

## Not touched tonight

The spoiler-sparkle item (`ba64c7cf`) stands as written — it is a custom `TextRenderer` job on a core
surface, correctly scoped as real work rather than a polish pass.

---

# Correction + status — 2026-08-15 (later in the same run)

## The profile bug was already diagnosed and fixed. It just never shipped.

My redirection above (auth/token refresh, client caching, decoding) pointed at the client, which was
the right half of the map — but the actual root cause had **already been found and fixed** in the
working tree by an earlier session, and I missed it by reading the API before reading the diff.

`native-ios/ProfileView.swift` (uncommitted) adds the missing `else` branch:

> Load failed. Without this branch the view rendered an EMPTY scroll view forever: the alert fires
> once, the reader taps OK (which clears `model.error`), and then `data==nil` / `loading==false` /
> `error==nil` matches nothing — no content, no message, no way back. `.task` only runs on first
> appearance, so returning to the tab doesn't retry either.

That explains the reporter's escalation exactly — "helped at first but then stopped allowing me to
access the profile in app at all" is the alert being dismissed once and the view then having no state
to render. It also explains why the server measurements came back clean: the API was never the
problem. The fix adds an error state with a **Try again** button that calls `model.load()`.

## The real problem: a batch of finished iOS fixes was sitting unshipped

`git status` shows 13 modified Swift files plus an untracked `native-ios/ReadingStateAlert.swift`,
none of it committed. Between them they cover **four of the five open reports**:

| Report | Fix present in working tree |
|---|---|
| Profile won't load (`cb73411e`) | `ProfileView.swift` error branch + retry |
| iOS finish stuck pending (`5a7145cd`) | `ReadingStateAlert` — all 16 `try?` call sites now surface the error |
| Spoiler sparkle (`ba64c7cf`) | `ReviewsListView.swift` particle renderer, with a deliberate light-mode divergence |
| — | `AppShell.swift` wires `.readingStateErrorAlert()` into every full-screen cover |

**Section 3 of `handoff-finish-book-failure.md` is now stale** — it lists the 16 `try?` sites as the
live lead. `grep` confirms zero remain; they all route through `ReadingStateAlert.shared.perform`.

Verified tonight: `xcodegen generate` + `xcodebuild` → **BUILD SUCCEEDED**, warnings only (all
pre-existing iOS 26 deprecations). Installed to Rebekah's iPhone via `push-to-phone.sh` per standing
order.

## Why the reports are still open

**These fixes have not reached the people who filed the reports.** A debug build on Rebekah's phone is
not a TestFlight build. Closing the reports now would be the exact failure this task exists to
prevent — marking work delivered that no tester has received.

To actually close `cb73411e`, `5a7145cd` and `ba64c7cf`: commit the native work, cut a TestFlight
build (`docs/ios-release-checklist.md` + `./native-ios/preflight-archive.sh`, stable Xcode only, bump
the build number), and confirm with the testers. That is a release decision, not an automated one.

## #4 covers · #5 dropdown — genuinely untouched

No fix for either in the working tree. Both still need on-device reproduction, and the simulator
tooling is unavailable in scheduled-task sessions (attended sessions only), so this task cannot do
it. Report `2b67d3ea` still cannot close until the covers half is resolved.

---

## #6 Volume 2 of a series redirects to volume 1 — DIAGNOSED 2026-08-23

**Report:** "New X-Men Modern Era Epic Collection: E Is for Extinction" (1 user, book
`4f4c5339-4949-47d0-bb2c-3998bd6189e9`) — _"Trying to add the second volume & it keeps taking me to
the first volume."_ Only volume 1 exists in `books`; volume 2 never got a row.

**Root cause — `normalizeTitleForDedup()`, `src/lib/actions/books.ts:76`:**

```js
t = t.replace(/\s*[:\-–—([\/{]\s*.*$/, "");
```

The character class contains a bare `-`, so the title is truncated at the FIRST hyphen, not just at
subtitle separators. Measured:

| Title | Normalizes to |
|---|---|
| `New X-Men Modern Era Epic Collection: E Is for Extinction` | `newx` |
| `New X-Men Modern Era Epic Collection: Riot at Xavier's` | `newx` |
| `New X-Men Modern Era Epic Collection Vol. 2` | `newx` |

`findExistingByTitleAndAuthor()` therefore matches volume 2 to volume 1 (same author, Grant
Morrison), returns the existing id, and the add silently resolves to volume 1. That is exactly the
reported symptom.

**Blast radius is wider than this one report.** Any hyphenated title collapses to its pre-hyphen
prefix, so any two same-author books sharing that prefix are treated as one book. `Spider-Man`,
`X-Men`, `Ender's Game: Mazer-…`, and every `Part-One`/`Part-Two` split are candidates. The SQL
pre-filter (`LIKE %new x%`) plus the author check are the only things keeping this from being far
noisier.

**Suggested fix (NOT applied — needs review + a dedup regression pass):** drop the bare `-` from the
class, or require it to be a spaced separator (` - `), so intra-word hyphens survive:

```js
t = t.replace(/\s*(?:[:–—([\/{]|\s-\s)\s*.*$/, "");
```

Note the volume-number question is separate and also unsolved: even with hyphens fixed, the `:`
truncation still collapses `Collection: E Is for Extinction` and `Collection: Riot at Xavier's` to
the same key. Numbered/subtitled volumes of one collection are genuinely different products — the
same principle already documented for `Collection`/`Box Set`/`Omnibus` in the edition-variant rule
in CLAUDE.md. A correct fix probably has to keep the subtitle when the pre-colon stem alone is
ambiguous across the same author.

**Why this task did not fix it:** it is a code change to the shared import/add dedup path, with a
real chance of causing either duplicate books or missed merges across the whole catalog. It needs a
dry-run over existing titles to size the impact before shipping. Report left OPEN in /admin/issues.

---

# Status update — 2026-08-24 (nightly-report-triage)

## §6 Volume 2 → volume 1: the dry-run this doc asked for is DONE. The fix is safe to ship.

§6 (2026-08-23) left the regex fix unshipped with one stated blocker: *"it needs a dry-run over
existing titles to size the impact before shipping."* That dry-run now exists and is committed:

- script: `scripts/dryrun-dedup-hyphen-regex.ts` (read-only, keyset-paginated, runs against Turso)
- full output: `reports/dedup-hyphen-regex-dryrun-2026-08-24.txt`

**Measured over all 125,306 books in the live catalog**, comparing today's separator class against
the proposed one (`/\s*(?:[:–—([\/{]|\s-\s)\s*.*$/` — bare `-` only counts when spaced):

| | count |
|---|---|
| Books whose normalized key changes | 4,387 (3.50%) |
| Same-author collision groups today | 6,783 |
| Same-author collision groups after the fix | 6,536 |
| **B. groups the fix splits apart** (false merges the bug is causing now) | **391** |
| C. groups preserved (existing merge behaviour unchanged) | 6,392 |
| D. groups the fix newly creates | 144 |

**B is the confirmed damage, and it is worse than §6 estimated.** The single worst group is 14
separate books collapsing to one key — `Ultimate Spider-Man` plus Vols. 1, 3, 4, 8, 9, 11–18, all
Brian Michael Bendis, all currently indistinguishable to `findExistingByTitleAndAuthor()`. Also in
B: 7 × `Cul-de-Sac Kids` collections (Beverly Lewis), 4 × `Firework-Maker's Daughter` (Pullman),
3 × `X-23`/`X-Termination` (Marjorie M. Liu), and a long tail of `Spider-Man …` pairs. Any user
trying to add one of these gets silently shelved with a different volume — the exact reported
symptom, across hundreds of titles rather than one.

**D was the number to be scared of, and it turns out to be mostly a bonus, not a regression.**
Reading the 144: the large majority are *genuine* duplicate pairs that the current regex fails to
merge because it truncates them into different keys — `The Tell-Tale Heart` / `The tell-tale heart`,
`Client-centered therapy` / `Client-Centered Therapy`, `Manic-Depressive Illness` ×2,
`Small-Town Billionaire` ×3, `Chronicles of the Nephilim Books 1-4 Bundle` in Paperback / Large
Print / Hardcover. The fix improves true-duplicate detection on those.

The genuinely wrong ones in D — `Spider-Man/Deadpool` vs `Spider-Man/deadpool Vol. 6`,
`Spider-Man by Todd Mcfarlane` vs `Spider-Man - Masques` — are all the **volume-number problem
that §6 already identified as a separate, unsolved issue**. That class is not new: it is the same
failure already occurring in the 6,392 group-C collisions today. The fix does not introduce it and
does not widen it materially; it trades 391 bad groups away for 144, most of which are correct.

**Verdict: ship it.** Net effect is ~391 false-merge groups eliminated, no new failure class, and a
side benefit of catching real duplicates. The change is one character class in
`normalizeTitleForDedup()`, `src/lib/actions/books.ts:76` — note the *identical* pattern is repeated
12 lines below at the `shortTitle` SQL pre-filter in `findExistingByTitleAndAuthor()` and **both
copies must change together**, or the pre-filter will stop returning the candidates the comparison
then wants to match.

**Why this task still did not ship it:** this nightly task's scope is data triage, and per its own
rules web/iOS code changes are handed off rather than deployed from an unattended run — this one
touches the shared add/import path for the whole catalog and deserves Rebekah in the loop and a
`/admin/issues` spot-check after deploy. The blocker, though, is gone: the sizing exists.

## What WAS fixed tonight (data half of the same report)

The report also had a real data gap underneath the code bug: only volume 1 of *New X-Men Modern Era
Epic Collection* existed. Volume 2 has been added —

- `New X-Men Modern Era Epic Collection: New Worlds`, Grant Morrison, Marvel, 2025-06-03, 360pp,
  ISBN 9781302961268, id `9c1f0a72-4f0b-4b6e-9d31-2c7a1e58b402`, series position 2
- identity verified against Penguin Random House + Marvel listings before writing; deliberately
  distinct from the existing 2002 `New Worlds` trade (9780785109761, Ethan Van Sciver)
- present and verified on **both** local and Turso, linked to author + series, indexed into local
  FTS and Meilisearch, enrichment run (cover landed from ISBNdb), prod book page returns 200
- `scripts/add-new-xmen-mee-vol2.ts` (idempotent, dry-run by default, `--apply` to write)

Report `06e45eb8-9faa-4b54-9e16-62d704f3b1bf` is therefore left **OPEN**, not resolved: searching
for volume 2 now works, but the *add* path that produced the complaint is still governed by the
buggy regex above.

## Incidental find: `updateSearchIndex()` writes thin Meilisearch docs

Not from a report — hit while indexing the book above. `src/lib/search/search-index.ts:60` upserts
`{id, title, authorNames, seriesName, visibility, isBoxSet}`, but `scripts/sync-meilisearch.ts:121`
writes `{id, title, slug, coverImageUrl, publicationYear, isbn13, authorNames, seriesName}`. The
live path is missing `slug`, `coverImageUrl`, `publicationYear` and `isbn13`, so **any book added or
imported during the day is searchable but has no slug or cover in the nav dropdown until the
8:45am rebuild overwrites it**. Same-day-add books look broken in search for up to 24h. Low
severity, small fix (align the field set), untouched — flagging it so it is not rediscovered.

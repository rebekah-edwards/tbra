# tbr*a Beta Launch Roadmap

## ⭐ Distribution & Mobile (biggest unshipped category)

All blocked on creating developer accounts. PWA ships today as the bridge.

### App Store (iOS)
- **Apple Developer account** ($99/yr) — not yet created
- Xcode packaging — choose Capacitor/Expo or native wrapper
- App Store Connect setup + listing copy/screenshots
- Icon variants + splash screens for all device sizes
- TestFlight beta workflow
- Privacy nutrition label + App Store review submission
- Push notifications via APNS (separate from current web push)

### Google Play Store (Android)
- **Google Play Console account** ($25 one-time) — not yet created
- AAB packaging (Trusted Web Activity or Capacitor)
- Play listing copy/screenshots
- Internal → closed → production testing tracks
- Push notifications via FCM

### Social login
- **Google Sign-In** — ⏳ ACTIVE NEXT (2026-06-17, user decision: Google ONLY for now, no other social logins). Needs OAuth credentials in Google Cloud Console + `auth/` flow edits (social button + account-linking to existing email users).
- **Apple Sign-In** — deferred. (App Store rules require Apple Sign-In *if* any other social login is offered — revisit when iOS packaging starts.)
- `auth/` flow edits to add social buttons + provider-linking to existing email accounts

---

## Premium & Revenue (partially shipped)

### Shipped
- Premium gating infrastructure (`isPremium()`, `PremiumGate`, `/upgrade`)
- Custom shelves (create/edit/follow/share)
- Full data exports (CSV free, JSON premium)
- ARC review gates
- TBR Notes

### Open
- **Payment integration** — `/upgrade` page exists but no Stripe/billing wired up. Decide provider + billing model (monthly? annual? lifetime?). (User is OK with Apple's IAP cut on premium upgrades.)
- **Reading challenges with discount codes** — advertiser-sponsored, non-data-targeted. Product-vision piece not yet built.
- **Amazon Associates affiliate** — code FIXED 2026-06-17 (tag now in server-rendered HTML; was only in the click dialog → repeated rejections). ⏳ Awaiting Amazon to re-open the account, then a FRESH tracking ID (`tbra08-20` is the rejected one) → set `NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG` + redeploy + reapply. See memory `project_amazon_affiliate_fix`.

---

## Data & External APIs

### Blocked on credentials
- **Amazon Creators API integration** — replaces OpenLibrary as primary source. `scripts/audit-series.ts` + `data/series-missing-book1.md` (1,302 series with missing book 1) ready to re-run once access granted.

### In progress
- ~~**Finish slug-collision migration**~~ ⏳ in progress (Round 16, 2026-05-04..05). Re-audit found 438 new collisions had accumulated since April (prevention hadn't shipped). Prevention shipped 2026-05-04 commit `ef52a8f` (slug-existence check in `importFromOpenLibrary` / `importFromOpenLibraryAndReturn` / `importFromISBNdbAndReturn`). Fix script enhanced commit `9ce8c20` to preserve UNIQUE-conflict identifiers as `editions` rows instead of dropping. Smoke test passed; full run on 438 pairs in background, ~5h. See `reference_slug_collisions.md`.
- **Cover review queue** — `/admin/covers` accumulating (74 added 2026-04-21). Ongoing manual work, no blocker.

### Done / retiring from this list
- ~~**326 slug collisions remaining**~~ — overnight resume cleared 287 pairs, down to 39 groups
- ~~**Slug-collision systemic prevention**~~ ✅ — manual-add guard shipped 2026-04-20
- ~~**614 unclassified multi-series pairs**~~ ✅ — aggressive normalizer + 13 curated merges + per-pair walk done; remaining pairs are legitimately cross-series
- ~~**Search improvements (Invisible Woman)**~~ ✅ — strict ALL-tokens filter + ISBNdb nav fallback shipped 2026-04-20
- ~~**Bottom-of-page padding — GLOBAL**~~ ✅ — root layout `pb-32` shipped
- ~~**sync-push hardening**~~ ✅ — PID lockfile + per-query timeout + stall detector shipped
- ~~**Cover "coming soon" placeholder sweep**~~ ✅ — ISBNdb v2 fingerprint added; `nightly-placeholder-clear` picks it up
- ~~**Grok cost audit**~~ — own fault, won't dispute

---

## UX & Feature polish

### Open
- **Reviews summary visualization** — StoryGraph-style histogram/average/% DNF/sort controls at top of book reviews list. Reference screenshot captured 2026-04-20. Not a blocker — design polish when review volume warrants.
- **Proposed edits flow — "confirm as-is" toggle** — review wizard content-details step should let reviewer confirm categories they already agree with instead of re-entering all ratings. Requires wizard step-advance callback plumbing.
- **Invite-a-friend buddy read** — "Buddy Read" button exists + routes to `/buddy-reads/new?bookId=X`; "pick specific friend → DM invite" flow not built.
- **Mobile animations refinement** — page transitions, interactive element polish
- **Corrections triage pipeline** — formal admin review for beta tester content detail submissions (currently ad-hoc via issue reports)
- **User submission process for content details** — let non-admin users contribute content ratings
- **Pacing-based recommendations** — aggregation + display shipped; filter on Discover + wire into recommendation scoring still pending
- **Comic/manga series parent pages** — group high-volume series into season/arc/volume sub-series with parent linking

### Tabled 2026-04-20 (need to pick up later)
- **Library reading formats report** — user punted this to "discuss live"
- **Search relevance post-ship review** — after a week of real traffic, verify strict filter isn't dropping legitimate fuzzy matches; tune safety valve if needed

---

## Infrastructure / housekeeping

- **4 new overnight reports** (2026-04-21): Safe Place to Die details, Legend missing Champion (#3), Legend pub dates inaccurate, On the Edge of Gone title caps + description truncation
- **Orphan scheduled task cleanup** — remove `~/.claude/scheduled-tasks/nightly-cover-rescue/` directory (renamed to `nightly-placeholder-clear` on 2026-04-17)
- ~~**Book page mobile perf — convert raw `<img>` to `next/image`**~~ ✅ shipped Round 16 (2026-05-04). 8 raw img tags across 6 files converted; Dune page now serves hero cover via `_next/image` with 15-width responsive srcSet at q=75, automatic AVIF/WebP.

---

## Round 16 (2026-05-04..05) ✅ — Search fix + scheduled-task unblock + cover/description cleanup + mobile perf

### Search "stopped responding" silent-failure fix
- `/api/search/full` could 504 when ISBNdb was slow → client cleared `loading` but never set `searched=true` → user saw blank page instead of "No results found." Added an `else` branch on `!res.ok` and a non-AbortError catch that sets `searched=true` and clears all result arrays so the existing empty-state UI renders.
- File: `src/app/search/search-client.tsx`. Commit `0c23e4c`.

### Scheduled-task permission fix (the root cause of "nightly tasks haven't worked in 9 days")
- 7 scheduled tasks had been firing on cron but stalling at the permission prompt because none of the `cd /Users/clankeredwards/claude/tbra && ./scripts/sync-incremental.sh ...` command shapes matched the project allowlist (`Bash(npm run *)`, `Bash(npx *)`, `Bash(tsx *)`, etc.). The user-level `Bash(*)` in `~/.claude/settings.json` was effectively shadowed.
- Added 3 patterns to `.claude/settings.json` allow array: `Bash(cd /Users/clankeredwards/claude/tbra && *)`, `Bash(./scripts/sync-incremental.sh *)`, `Bash(./scripts/*.sh *)`.
- **Verified live:** within an hour of the change, all 3 previously-stuck tasks (junk-sweep, description-refresh, placeholder-clear) self-fired after 8 days of stale `lastRunAt`. Plus a one-time `cron-proof-2026-05-04` task fired at 21:22 EDT with ~50s grace. Settings precedence confirmed: project-level allow patterns are required (user-level Bash(*) doesn't carry through to fresh task sessions).

### Cover placeholder detection upgrade
- Added 2 new fingerprints found from user-reported books: `isbndb-v4` (1304 bytes, 60×40 microimage, `54664c70...`) and `openlibrary-v1` (1770 bytes, 60×40, `1eaa7e0f...` — first OL placeholder we've found).
- **New: dimension-based microimage detection.** Both new placeholders are 60×40 pixels — no real cover would be that small. Added `parseJpegDimensions()` (SOF marker walker, no npm dep) + `MICRO_IMAGE_DIMENSION_THRESHOLD=100` + `MICRO_IMAGE_BYTE_THRESHOLD=3000` HEAD pre-filter. Catches future placeholder variants automatically without per-fingerprint maintenance.
- **Bug fix:** `isKnownPlaceholderCover()` was silently skipping when the host didn't return Content-Length on HEAD (notably covers.openlibrary.org). Now always fetches body and uses `buf.length` as authoritative size. Also iterates ALL fingerprints whose URL pattern matches (was only checking the first match — meant isbndb-v2/v3/v4 were ignored).
- `cover-rescue.ts` runs the dimension pass after the fingerprint pass, scoped to ISBNdb/Google/OL hosts.

### Description sanitization upgrade
- New `stripBlurbs()` helper in `sanitize.ts` removes `"quote"—Source` attribution patterns while preserving non-blurb prose. Source-end detection: paragraph break, period+capital, ~30 sentence-starter words (`It's`/`The`/`If`/`But`/`When`/...), 150-char safety cap. Wired into `sanitizeDescription()` early so review-walls get stripped before length/junk checks.
- New rejection rules in `sanitizeDescription()`: Goodreads UI scrapes (Read reviews from the world's largest community / Let us know what's wrong with this preview / Want to Read · Currently Reading / Return to Book Page / Reviews from the book:), Goodreads metadata (N Ratings · N Reviews / published YYYY · N editions), multi-star bursts (★★+).
- **Closed the re-enrichment loop hole.** Previously, only the final "publisher description" write path applied `sanitizeDescription`. The OL/ISBNdb/Brave write paths bypassed it, so re-enriching a stale-flagged junk description could write the same junk back. Wrapped all 3 paths with `sanitizeDescription` so worst case is "stays empty" rather than "junk re-written."

### Bulk data cleanup applied
- `flag-junk-descriptions.ts` (new): scans Turso for descriptions matching the new patterns, with `--dry-run`/`--apply`/`--skip=`/`--only=` flags. **260 books cleared** (Goodreads scrapes + Goodreads metadata + multi-star promos).
- `strip-blurbs-from-existing.ts` (new): runs `stripBlurbs()` against the catalog, writes back the cleaned text. **46 books had blurbs removed while preserving prose**, **2 PURE blurb-walls cleared** (would have been left below the 60-char threshold).
- 4 missing series books imported with covers + ISBNdb metadata + author/series links: Marissa Meyer's Renegades trilogy (Renegades 2017 #1, Archenemies 2018 #2, Supernova 2019 #3) and `It Devours!` (Fink + Cranor 2017 #2 in Welcome to Night Vale).

### Process-reports hardening
- Per-report `Promise.race` 3-min timeout — a single hung report can no longer hold the queue hostage. Wall-clock ceiling raised from 20min to 4h with `longRunning: true` so future bigger queues fit.
- `deleteBook()` audit-trail fix: now detaches `reported_issues.book_id` and auto-resolves any still-`new` reports BEFORE the cascade DELETEs run. Caller's `resolveReport()` then finds the still-existing report row and overwrites the placeholder resolution with the meaningful one. Was silently destroying audit trail when junk-deletes ran.

### Mobile perf — `<img>` → `next/image`
- 8 raw img tags across 6 files: `book-header.tsx` (hero blur fill, card blur fill, main cover 180×270 with priority + responsive srcSet), `book-series.tsx` (series thumbs 120×180), `book-page-client.tsx` (cover-picker thumbs ×2), `up-next-shelf.tsx` / `friends-activity.tsx` / `currently-reading-section.tsx` (card-bg blur fills, priority on currently-reading).
- **Verified live:** Dune book page now serves hero cover via `_next/image` with 15-width srcSet (32w → 3840w) at quality 75. Mobile devices auto-pick 256w/384w (~10-30 KB) instead of the full 600+ KB original.

### 7 user reports resolved
1. A Parade of Horribles — primary genre humor → LitRPG (removed Humor/Dark Humor/Humorous Fantasy from the book; Fantasy/Grimdark Fantasy/LitRPG/Progression Fantasy remain).
2. The Wild Robot series — set positions 1, 2, 3 (left "Wild Robot on the Island" picture-book at null).
3. Empire of Silence (Deluxe Hardcover) — deleted dupe (user already had canonical `completed`); also cleaned up a 3rd no-author junk dupe.
4. Gone Girl FTI — re-pointed reading session to canonical, set `started_at = completion_date` and `started_at_explicit = 0` (DB constraint requires non-null), preserved 2024 completion. Deleted FTI dupe.
5. Renegades — imported the 3 English Marissa Meyer books at proper positions; Turkish translations preserved.
6. Welcome to Night Vale — imported `It Devours!` at position 2.
7. Strenghtsfinder 2.0 typo (came in mid-session) — deleted (0 users); canonical preserved.

### Commits (5 deploys, all `Ready` on Vercel — broke the 9-day stale streak)
- `0c23e4c` Search "no results" fix + permission patterns
- `b8692eb` Cover/description cleanup machinery (placeholders, blurbs, per-report cap)
- `d499070` Bugfix: placeholder detection works without Content-Length
- `b77f9bc` process-reports preserves audit trail on book deletion
- `a9fe09f` Mobile perf: book/home covers → next/image

---

## Buddy Reads expansion (later phase)

Current buddy-reads is shipped + functional. Later expansion: multi-person groups, public discussion boards, reading-pace matching, challenge tie-ins.

## Round 8 (2026-04-09) ✅ — Search overhaul + report triage + data integrity

### Search overhaul
- **FTS5 full-text search** built and benchmarked at 3ms for 46K books — but dropped from Turso after discovering it added 213MB to the DB and degraded ALL queries (COUNT(*) went from <100ms to 3 seconds). Kept on local only; production falls back to optimized LIKE with graceful degradation.
- **ISBNdb external search restored** — `ISBNDB_API_KEY` was never added to Vercel env vars, so external search silently returned empty since launch. Added + deployed.
- **ISBNdb click-through fixed** — clicking ISBNdb results called `importFromOpenLibrary()` which failed on `isbndb:` keys. Now detects source and routes through `importFromISBNdbAndReturn()` + navigates to the new book page.
- **ISBNdb result dedup** — multiple editions (hardcover, paperback, Kindle, etc.) of the same book collapsed into one result by normalized title + primary author. Keeps best edition (prefers cover, then most pages).
- **Debounce reduced** — nav: 300ms→150ms, full page: 400ms→200ms
- **Books/People tabs removed** from full search page — user search belongs elsewhere
- **`/search` blocked in robots.txt** — belt-and-suspenders with existing `noindex` meta tag. Prevents crawl budget waste on `?q=` URLs.
- **Bottom scroll padding** added on mobile search page so "add manually" button isn't butted against nav bar

### Report triage (22 open reports + I Hate Fairyland + series requests)
- **Data corrections:** Moon title caps, Great Alone/Name of the Wind wrong extra authors, Gorp pub year, Black Sun duplicate hidden, Ascension Factor title/description/slug fixed, Anatomy of an Alibi slug assigned, How It Unfolds page count confirmed
- **Junk descriptions cleared:** Hell's Heart (Star Trek, then reverted after I wrongly overwrote it), RE-ROLL, Can I Say That? (Amazon scrapes → clean blurbs)
- **Authors fixed:** Worlds to Come (Heinlein → Damon Knight editor), Gorp ("Ross, Dave" → "Dave Ross"), Can I Say That? (Brenna Blain added), Hell's Heart (John Jackson Miller added)
- **Non-English/junk entries hidden:** The Habbit, Acto de Crear (Spanish), Verdadera Historia (Spanish), BadAsstronauts (Spanish ISBN edition)
- **Piranesi:** linked Susanna Clarke as author, year fixed 2015→2020, cover set from OL ISBN API (enrichment had failed due to hyphenated ISBN + missing OL key)
- **I Hate Fairyland cleanup:** 10 entries hidden (individual issues, all-caps junk, duplicate "Book 1"), series consolidated from 2 rows to 1, Vol 1-6 positions set, pub year fixed
- **Series verified:** All the Dust That Falls 2-4, Noobtown 2-9, New Realm Online 2-7 all already existed. Noob Returns (book 9) + 6 New Realm Online books created by agent. Enrichment triggered for all coverless books.
- **Green Lantern: Sleepers** filled out completely (3 books, correct titles/authors/descriptions/years) per user request with Goodreads screenshot
- **Report button bug fixed:** `GlobalReportButton` now passes `seriesSlug` from `/series/` pages. `submitIssue` resolves `seriesId` from slug. Previously 144 reports from series pages had null `book_id` + null `series_id`.

### ISBN normalization (systemic fix)
- **Manual add form** (`createBookManually`) now strips hyphens/spaces from ISBNs before insert — users paste hyphenated ISBNs from Amazon which broke all downstream lookups
- **Enrichment pipeline** (`enrichBook`) normalizes ISBNs as first step — catches any existing books with bad ISBNs, fixes them before lookups
- **Import path** (`importFromISBNdbAndReturn`) already had normalization from the earlier Hell's Heart fix
- **Retroactive cleanup:** found and fixed 15 books with hyphenated ISBNs locally + 13 on Turso

### Junk description cleanup (4,906 books)
- **Root cause:** nightly `backfill-metadata.ts` was writing raw ISBNdb `synopsis` to `description` with only `stripHtml()` + `length > 20` — no review/Amazon/Goodreads junk detection
- **Cleanup script** (`clean-junk-descriptions.ts`) scanned all descriptions with 50+ regex patterns: Amazon scrapes (3,496), user reviews (983), Goodreads dumps (158), other junk (154), author bios (115). All NULLed for re-enrichment through proper OL-first pipeline.
- **Backfill script fixed** — `backfill-metadata.ts` now uses `cleanISBNdbSynopsis()` with full review/Amazon/Goodreads/bio detection. Returns null for junk so it never gets written.

### Handle change redirects
- New `user_previous_usernames` table tracks old handles
- `updateProfile()` records old handle on rename; clears stale entries when new user claims an old handle
- `/u/[username]` page falls back to previous-usernames table with JOIN, then 308-redirects to current handle

### Amazon Associates tag updated
- Changed from `tbra-20` to `tbra08-20` (reapplied account) in `buy-button.tsx`

### isbn_13 Turso push
- 8,086 isbn_13 values pushed safely (collision-checked) via `push-isbn13-to-turso.ts`. 8 collisions skipped (genuine cross-catalog dupes).

### Similar books scorer parity
- `getSimilarBooksInner()` now applies custom content warning penalty (same tiered formula as main recommendations)

## Round 7 (2026-04-08) ✅ — UX polish + custom content warnings + metadata sync

### DNF review flow
- Marking a book DNF from the home Reading Now card or the book page now opens the ReviewWizard pre-seeded with `didNotFinish=true` and the tracked progress prefilled as "how far did you get?"
- Step 4 heading swaps to "Why did you stop reading?" with a matching placeholder
- Footer button reads "Save" instead of "Post Review" for DNFs
- Content details step (step 5) unchanged — DNFs can flag content details the same way a finished review can
- Gated on `!userReview` so users who already reviewed a book aren't re-prompted

### Custom content warnings pipeline 🎯
- New `src/lib/content-warnings/vocabulary.ts` — static 35-entry canonical vocabulary across 8 categories (relationships, violence, death & loss, mental health, identity, body, religion, other). Each canonical has 3–6 aliases. Zero DB round trips.
- `canonicalizeWarning()` runs on save for BOTH sides: user's "topics to avoid" preferences AND reviewer-tagged custom warnings (`custom:{canonical_id}` in `review_descriptor_tags`)
- `scanTextForCanonicals()` scans free-text with word-boundary checks (prevents "war" matching "toward", etc.) — used to scan admin-curated `bookCategoryRatings.notes`
- Recommendations: new `batchFetchCustomWarningFlags()` runs one SQL count per recommendations call, only when user has avoid list set. Penalty tiered per warning (5 + flags*5, capped at 20 each), max 40 total
- Book page: new `getBookContentWarningMatchesForUser()` returns tag matches + note matches in one parallel call. Surfaces in the existing `ContentWarningBanner` as "Infidelity / cheating — 3 reviewers flagged · you asked to avoid" or "noted in Sexual content · you asked to avoid"
- Settings UI: autocomplete suggestions as user types, substring match against canonical ID + label + aliases. Free text still accepted and canonicalized on save. Pills display canonical labels instead of raw IDs.
- `ContentWarningBanner` layout rewrite: stacked rows (label on top, detail below) with `break-words` — fixes mobile overflow when both sides are long. "See all content details" link now always shown when expanded.

### Home page + UX polish
- **Reading Now card redesign:** buttons on the right side (smaller text), Track Progress (neon blue) + Reading state dropdown (green split button matching book page style). Title/author now vertically centered with breathing room. Dropdown paints above next sibling card via z-50 when open (was being clipped).
- **Purple "FROM YOUR TBR" tag on Pick From Your Shelf card in light mode** (was unreadable green), green in dark mode. Uses new `.tbr-reason-tag` helper class following `.read-more-link` pattern.
- **Emoji removed from "User-added" content detail label** sitewide
- **Hamburger menu: Settings moved up under View Profile** for faster access
- **"Browse Library" renamed to "Browse All Books on tbr*a"**
- **Buddy read progress now shows 100% for `completed`/`dnf`** states (prior fix only checked `finished`, missed the DB's actual state names)
- **Password show/hide toggle** on all four auth forms (signup, login, reset-password, settings change-password). Each field has its own independent toggle for sanity-checking new+confirm pairs.

### Performance — killing N+1 queries
- **`/profile/reviews`** was running 4 subqueries per review (authors, rating, editions, state) plus a correlated completion date subquery. For a 10,000-review user that's 40,000 sequential SQL round-trips → page hung. Rewrote to 6 batched queries with `inArray()` lookups. Also added missing `bookSlug` field to returned interface so "View all reviews" links use slugs directly.
- **Browse page** — pre-existing rewrite carried over. LEFT JOIN against pre-aggregated rating subselect replaces N+1 correlated subqueries. `needsRatingsForSort` flag batch-fetches ratings only for visible slice when sort doesn't need them.
- **Join table dedup:** added unique indexes on `book_authors`, `book_genres`, `book_series` (local + Turso + `schema.ts`). Added `.onConflictDoNothing()` to every join-table insert call site in actions/books.ts and enrichment/enrich-book.ts so enrichment re-runs can't reintroduce dupes.
- **Ghost reviews:** Beloved was showing 6 reviews / 3.8 avg with nothing visible. Root cause: orphan `user_book_ratings` and `user_book_reviews` rows from deleted seed-reviewer-001 through -006 users. Cleaned 12 ratings + 6 reviews + 17 dim ratings + 28 descriptor tags. Updated `getBookAggregateRating()` to INNER JOIN users as a safety rail.

### Metadata backfill push to Turso
- The nightly `nightly-metadata-backfill` task only wrote to local SQLite per its skill file. Production had accumulated ~10k missing covers / ~8k missing descriptions / ~7.5k missing summaries.
- **One-shot catch-up:** new `scripts/push-metadata-backfill-to-turso.ts` pushed 13,961 books to Turso. Only fills blank fields (COALESCE-style CASE guards), never overwrites live data. Idempotent — rerun is safe.
- **Before → after on Turso:** missing descriptions 17,841 → 9,573 · missing summaries 14,201 → 6,614 · missing covers 12,071 → 1,966. Remaining gaps match local (asymptote of what ISBNdb + Google Books can provide).
- **Nightly skill updated:** `nightly-metadata-backfill` SKILL.md now runs the push script after every local backfill. Gap won't recur.

### Hell's Heart ISBN bug
- Adding a book via the ISBNdb fallback would crash with a 500 when the book already existed on Turso under a different ISBN format. Reproduced with Hell's Heart (`978-1250394958`): existing row was `9781250394958` without hyphens, dedup exact-match missed it, INSERT hit UNIQUE constraint.
- **Three layers of defense added** in `importFromISBNdbAndReturn()`:
  1. Normalize incoming ISBNs to digits-only before dedup + insert
  2. Normalize curly quotes to straight in fuzzy title match
  3. Wrap INSERT in try/catch — if UNIQUE fires anyway, do a targeted SELECT and return the existing book id
- External search dedup filter in `/api/search/external` also normalizes ISBNs on both sides

### Book page share button
- Moved from standalone mount under the action buttons into the BookHeader card itself via new `shareButton` slot prop
- Styled as a translucent glass circle (40×40, `bg-white/10` + `backdrop-blur-md` + `border-white/25`)
- Positioned at bottom-LEFT of the card with `translate-y-1/2` so it straddles the edge 50/50
- Removed the two prior standalone mounts (mobile + desktop)

### Misc
- **Odyssey merge:** canonical slug `the-odyssey-homer`, deduped hidden duplicate, migrated Rebekah's TBR entry
- **Legends & Lattes duplicate:** hidden the dup, kept the canonical
- **Star rating halves:** `StarRow` fractional-fill fix for `.5` ratings that were rendering as full stars
- **Similar Books scroll fade mask:** restored accidentally removed CSS mask
- **Junk book descriptions:** wider detection patterns + local scan/cleanup script

### Schema migrations applied (local + Turso)
- `books_publication_year_idx` on books
- `user_book_ratings_book_idx` on user_book_ratings
- `book_genres_genre_idx_v2` on book_genres
- `book_authors_unique` unique index
- `book_genres_unique` unique index
- `book_series_unique` unique index

## Round 6 (2026-04-07) ✅ — Pre-beta bug bash + search rewrite

### Critical fixes
- **Amazon affiliate button** visible for logged-out users (unblocks Amazon Associates approval — was rejected twice). Renamed from "Affiliate" to "Buy".
- **UUID URLs no longer leak to Google** — all internal links use slugs, `robots.txt` disallows UUID-pattern paths.
- **PWA white screen (20s)** — added `src/app/loading.tsx` for streaming, splash waits for `<nav>` element, SW uses exponential backoff retry (was meta-refresh loop).
- **Search crash on live** — `/api/search` `searchSeries()` now fetches books per series and client has defensive optional chaining.
- **CRON_SECRET env var whitespace** had been silently blocking all Vercel deploys for 3 days — no code had actually been shipping. Fixed.

### Buddy Reads overhaul
- Removed custom "buddy read name" field — auto-names from book title
- Progress shows 100% for finished books (was stuck at last note percentage)
- "Mark Complete" → "End Buddy Read" with confirmation dialog
- All 10 notification types now have `link_url` for clickable navigation
- "Share to buddy read" toggle on reading notes posts formatted update to discussion
- Full color sweep (`text-primary` → `text-foreground`, undefined `text-secondary`/`text-tertiary` → `text-muted`)
- New `getActiveBuddyReadsForBook()` query

### Review wizard, reading history, and dates
- Keyboard layout fixed via `100dvh` on root container (was pushing header off-screen on mobile)
- Step 2 mood pill color fixed (`text-primary` → `text-accent` so global light-mode override applies)
- New `reading_sessions.started_at_explicit` column tracks user-specified start dates
- `formatDate()` respects `completionPrecision` — year-only shows "2024", month/year shows "Apr 2026"
- Default finish date to today ONLY when transitioning from `currently_reading` → `completed`; leave null for direct TBR → Finished skips
- Re-read finish no longer auto-opens review wizard (gated on `!hasCompleted`)
- Finish date dialog uses `createPortal` + `z-[200]` to escape stacking contexts
- Friends' feed reviews link directly to `/book/{slug}/reviews#review-{id}`

### Classification & taxonomy
- `classifyGenres()` takes `isFiction` and filters whitelist (nonfiction books like Jesus Revolution no longer pick "Christian Fiction" primary)
- Added "Christian Nonfiction", "Christian Living" to `NONFICTION_GENRES`
- **Graphic novel backfill:** ~3,276 books tagged based on publisher match (Marvel, DC, Image, IDW, Dark Horse, Vertigo, Viz Media, Kodansha, Tokyopop, Yen Press, Seven Seas, Idea & Design Works, Boom Studios, Vault Comics, etc.). Both local and Turso.
- LGBTQIA+ → LGBTQ+ sitewide (seed, taxonomy, methodology, onboarding, settings, enrichment)

### Search rewrite ⚡
- **Full search page now queries local DB only** — 20-80ms typical (was 5-30 seconds)
- Previously made up to 11 sequential OpenLibrary HTTP calls per query
- ISBNdb fallback only fires when local returns fewer than 5 results
- **Hard daily cap: 2,000 ISBNdb search calls** via new `api_quota_usage` table (atomic `INSERT ... ON CONFLICT`). Enrichment gets the rest of the 15K/day premium budget.
- In-memory LRU cache (200 entries, 5-min TTL) per query on `/api/search/external`
- New `importFromISBNdbAndReturn()` creates minimal book row + generates SEO slug + triggers background enrichment
- `ReadingStateButton` + `setBookStateWithImport` accept `externalImport` prop to route ISBNdb-sourced clicks through the new import path

### SEO regression fix
- Book page title restored to `What's Inside {book} | tbr*a` (was silently changed to `{book} by {author} | tbr*a` on March 30 in the "Performance overhaul" round)
- Audited all 29 `generateMetadata`/metadata files sitewide — no other templates were changed from the original SEO plan
- Mixed `tbr*a` vs `The Based Reader App` brand naming is intentional (short UI pages vs conversion/landing pages)

### Schema migrations applied (local + Turso)
- `user_notifications.link_url TEXT` (nullable)
- `reading_sessions.started_at_explicit INTEGER NOT NULL DEFAULT 0` (backfilled to 1 for all existing rows)
- `api_quota_usage (api_name, date, count)` with unique index

## Tier 1: Must-Have Before Beta Launch ✅ COMPLETE

1. ~~**Account types & admin access**~~ ✅ — Super admin sharing (Seth Cordle added), beta tester type with report access and pacing trust, account type dropdown on admin Users page
2. ~~**Corrections triage pipeline**~~ → Moved to Tier 3 (beta testers use issue reporting; formal corrections pipeline not needed for beta launch)
3. ~~**Beta issue reporting button**~~ ✅ — Report button visible for beta_tester, admin, and super_admin accounts on all book pages
4. ~~**Light mode green-on-green fixes**~~ ✅ — Fixed all instances; exceptions preserved (mood buttons, ignore preferences on Discover, year/all-time toggles on Stats, match details on Discover gems, hearted options in reading preferences)
5. ~~**Hide book option**~~ ✅ — Users can permanently hide a book from all recommendations
6. ~~**Account/display/notification settings + contact us**~~ ✅ — Full settings page with change password, reading preferences, content comfort zone, display settings, notification preferences, and contact page
7. ~~**Social features: following + activity**~~ ✅ — Follow users, see followed users' activity on Home feed (horizontal scroll on mobile, card layout on desktop)

## Tier 2: Polished Beta Experience ✅ COMPLETE

8. ~~**System mode toggle**~~ ✅ — Light/Dark/System toggle with device-adaptive icon
9. ~~**Rename Dig → Discover**~~ ✅ — Page renamed, H1 is "Find Your Next Read", info tooltip updated
10. ~~**Search bar visual redesign**~~ ✅ — Deduplication (strips parentheticals, scores by quality), fuzzy/typo-tolerant search (Levenshtein distance), race condition fix (AbortController), smart quote normalization, box set filtering
11. ~~**SEO for all pages**~~ ✅ — Full metadata, OpenGraph, Twitter Cards, robots.ts, sitemap.ts, Organization + WebSite + Book JSON-LD structured data, auth page noindex, logo.png
12. ~~**Desktop/web layout**~~ ✅ — All admin pages at 60% width centered on desktop (matching Settings/Import)
12b. ~~**Up Next drag-to-reorder**~~ ✅ — Apple-style item shifting animation with CSS order + transitions, drop target highlight
12c. ~~**Consistent "Finished" flow**~~ ✅ — Review wizard now auto-opens after date picker confirmation from all locations (book page, series page, search). Fixed by moving onStateChange outside startTransition.
13. ~~**Stats page overhaul**~~ ✅ — Gradient cards, reading goal, genre donut, monthly bar chart, streak tracking

## Tier 3: Post-Beta / Parallel

### Blocked — waiting on external dependencies
- **Amazon Creators API integration** — Replace OpenLibrary as primary data source for book discovery and series gap-filling. Will dramatically improve coverage for self-pub and niche books. Script `scripts/audit-series.ts` and gap report `data/series-missing-book1.md` (1,302 series) ready to re-run once API access is granted.

### Revenue & Premium Features
1. ~~**Free vs. premium feature gating**~~ ✅ — isPremium() helper, PremiumGate component, /upgrade page, based_reader→premium rename (2026-03-28)
2. ~~**Custom shelves / book lists**~~ ✅ — Premium feature. Create/edit/delete shelves with custom colors (8 presets), add/remove books, per-book notes, mass select, public sharing via `/u/[username]/shelves/[slug]`, bookshelf-style public view (3 books per shelf row), profile display with horizontal book scroll per shelf, "Add to Shelf" button on book pages. Following others' public shelves is free; creating/sharing requires Based Reader. (2026-03-28)
3. ~~**Full data exports**~~ ✅ — CSV (free, Goodreads-compatible) + JSON (premium, complete dump) via Settings page (2026-03-28)
4. **Reading challenges for premium users** — Challenges that offer discount codes from advertisers (non-data-targeted ad model)

### User Experience & Polish
4. **Mobile animations refinement** — Page transitions, interactive element polish
5. **Corrections triage pipeline** — Formal admin review system for beta tester content detail submissions. Currently handled via issue reports.
6. **User submission process for content details** (non-admin) — Let users contribute content ratings
7. **Pacing-based recommendations** — Pacing aggregation and display built (stoplight-colored pills on book pages, beta_tester + super_admin pacing trusted). Once enough reviews include pacing data, add pacing filter to Discover and wire into recommendation scoring.
8. **Comic/manga series parent pages** — Group high-volume series into season/arc/volume sub-series with parent page linking them.

### Round 4
- ~~**Follow Author + notifications**~~ ✅ — Follow button on author pages, follower count, new-book notification script (2026-03-31)
- ~~**TBR Notes (Based Reader)**~~ ✅ — Premium note editor inside state dropdown, note previews on library TBR grid (2026-03-31)
- ~~**Pre-publication ARC review gates**~~ ✅ — ARC source dropdown + proof upload → admin review queue at `/admin/arc-reviews` → ARC badge on approved reviews (2026-03-31)
- ~~**Admin notification broadcast**~~ ✅ — Super admin sends to all users via `/admin/broadcast` (2026-03-31)
- ~~**Shelf following + discovery**~~ ✅ — "Other shelves with this book" in Shelves bottom sheet, My Shelves/Following tabs, shelf reorder with @dnd-kit (2026-03-31)
- ~~**Shelf followed → notification**~~ ✅ — (2026-03-30)
- ~~**Review marked as helpful → notification**~~ ✅ — (2026-03-30)
- ~~**Book page button declutter**~~ ✅ — Conditional Up Next/Format, combined Top Shelf into Shelves bottom sheet, neon-blue Shelves button (2026-03-31)
- ~~**Amazon affiliate disclosure**~~ ✅ — Confirmation dialog + FTC-compliant footer (2026-03-31)
- ~~**Speed fixes**~~ ✅ — Cached heavy queries, added indexes, reduced revalidation blast radius (2026-03-31)
- ~~**Referral program**~~ ✅ — Tracking only: unique referral codes, signup capture via ?ref=CODE, in-app notifications to referrer, profile card with copy link + count (2026-03-31)
- ~~**PWA (Progressive Web App)**~~ ✅ — Installable from browser, offline fallback page, service worker with static asset caching, web app manifest, generated icons from logo. Bridge distribution until app store packaging. (2026-03-31)

### Later Phase
9. **Buddy reads** — Social reading feature (much later)
10. **Handle change redirects** — Store previous usernames and add redirect middleware so old `/u/` links still work after a handle change

### Needs External Accounts/Credentials
10. Google + Apple login (waiting on credentials)
11. Xcode / App Store packaging (needs Apple Developer account)
12. Google Play packaging (needs Google Play Console)

### Completed
- ~~**Custom shelves / book lists**~~ ✅ (2026-03-28)
- ~~**Free vs. premium feature gating**~~ ✅ (2026-03-28)
- ~~**Full data exports**~~ ✅ (2026-03-28)
- ~~**New follower notifications**~~ ✅ (2026-03-28)
- ~~**Follow Author + notifications**~~ ✅ (2026-03-31)
- ~~**TBR Notes (Based Reader)**~~ ✅ (2026-03-31)
- ~~**Pre-publication ARC review gates**~~ ✅ (2026-03-31)
- ~~**Admin notification broadcast**~~ ✅ (2026-03-31)
- ~~**Shelf following + discovery + reorder**~~ ✅ (2026-03-31)
- ~~**Book page button declutter**~~ ✅ (2026-03-31)
- ~~**Amazon affiliate disclosure**~~ ✅ (2026-03-31)
- ~~**Speed optimizations (caching + indexes + revalidation)**~~ ✅ (2026-03-31)

## Completed (2026-03-28 Session)

### Data Integrity & Series Fixes
- Sanderson/Cosmere series restructured: Hoid's Travails, Secret Projects, Elantris, Cosmere (Other), Stormlight Archive supplementary novellas
- 22 user-reported issues resolved: duplicates merged, missing books added, genres fixed, series positions corrected
- Series audit script (`scripts/audit-series.ts`): scans all series for missing book 1, position gaps, missing years; comic/manga detection; OL rate limiting
- 337 missing publication years fixed across all series
- 31 missing books added/linked to series
- 1,302 series with missing book 1 documented for future Amazon API integration
- He Who Fights with Monsters series cleaned up (dupes removed, positions set)
- Requiem (Lauren Oliver) fixed: wrong OL key was pointing to 1940 edition

### Deploy & Sync Safety
- **deploy.sh fixed** — was doing destructive DELETE-all + re-insert on every deploy, destroying live user data. Now uses incremental sync (pull then push), never deletes.
- Sync script properly handles bidirectional data flow: user data stays on live, book data pushed from local

### Search Fixes
- Smart/curly quote normalization in search (mobile keyboards insert U+2019 instead of U+0027)
- Box sets filtered from search bar dropdown results
- Duplicate search entries merged (Assassin's Apprentice, Babel, Assistant to the Villain, etc.)

### Reading State & Stats
- Paused books excluded from Discover and Home recommendations
- Paused books always get a reading session with start date (ensureReadingSession before pause)
- StoryGraph import now recognizes "paused" state (was silently mapping to TBR)
- Pause/resume time tracking: `paused_at` and `total_paused_days` columns on reading_sessions
- Stats "Avg pace" now subtracts paused days for accurate active reading time
- Reading History: paused sessions show 3 date spots (start → paused → finish)
- Reading History date inputs: save on blur (not onChange) to prevent partial saves
- Optimistic UI for date edits (instant visual update, server save in background)
- "Invalid Date" display fixed (rejects years <1900 or >2100)

### Analytics & Email
- GA4 tracking added (G-WMF29PM9E2) via next/script afterInteractive
- GSC verified via DNS TXT record
- Resend upgraded to Pro plan ($20/mo, 50k emails)
- Per-signup notification emails replaced with daily digest (conserves Resend quota)

### Settings & UI
- "Auto-saved" pill added to Reading Preferences header
- Admin pages (all 6) set to 60% width on desktop

## Previously Completed

### Infrastructure & Security
- Security hardening (password hashing, sessions, email verification via Resend)
- Password reset flow (forgot password page + reset via email link)
- Change password in Settings
- Signup notification emails to hello@thebasedreader.app (now daily digest)
- Database sync tooling (incremental pull/push, admin Sync Users button)
- Vercel deploy pipeline fixed (root directory config, then incremental sync)
- Homepage performance caching (unstable_cache for landing page data)

### Landing Page & Navigation
- New landing page for logged-out users (hero section, feature cards, book parade, CTA)
- Admin CMS for all landing page copy (20 editable sections in DB, admin UI at /admin/landing)
- Admin landing page book manager (/admin/landing) for curating hero/parade books
- Hero cover mosaic: proper aspect ratios, light mode opacity boost
- Frosted glass cards (For Readers/Parents, feature cards) with gradient tints
- "Sign in" links in branded neon-blue
- Nav cleanup: theme toggle moved into hamburger menu, green Sign Up pill on mobile
- Desktop nav: logged-out users see Home, Discover, Our Methodology
- Hamburger menu: logged-out users see Sign In, Our Methodology, Discover, Theme toggle
- Favicon: Space Grotesk asterisk with brand gradient (lime → blue → purple)
- Light mode: warmer background (#f5f4f8), vibrant gradient glows, softer surfaces
- Settings, Import, and all Admin pages: 60% width centered on desktop

### Book Pages & Content
- Pacing system: aggregation from reviews, stoplight-colored pills (green/amber/red), super_admin + beta_tester trust
- Info bubbles on Home ("Discover Something New") and Discover page with overlay tooltips
- Top Shelf toast notification on adding favorites
- Amazon buy button updated to affiliate homepage link
- Summary backfill for books with descriptions
- Similar Books: excludes same-series and out-of-order books
- Content rating deduplication
- Standardized intensity labels: None / Mild / Moderate / Significant / Extreme
- Reading History section: view/edit start & finish dates, add re-reads, delete sessions, optimistic UI
- Reading progress pills on Currently Reading cards (frosted glass, percentage from notes)
- DNF/Pause confirmation dialogs from Home page
- Featured book "See full descriptions" link with #whats-inside anchor
- Desktop book page: summary flush with card top, duplicate report button removed
- Consistent "Finished" flow: review wizard auto-opens from all locations after date picker

### SEO & Metadata
- Homepage: meta description + OpenGraph tags
- Bookshelf: title + description (noindex)
- Stats: title + description (noindex)
- Methodology: title + description + OpenGraph
- Book pages: dynamic title, description, canonical URL, OpenGraph with cover image, Book JSON-LD schema
- Author pages: dynamic title, description, canonical URL, OpenGraph
- Series pages: dynamic title, description, canonical URL, OpenGraph
- User profiles: dynamic title, description, OpenGraph
- Organization schema with founder (Rebekah Edwards), social accounts, logo
- WebSite schema with SearchAction
- Dynamic sitemap.ts covering all public books, authors, series, profiles
- robots.ts with crawl rules and sitemap reference
- Twitter Card and theme-color meta tags
- Auth page noindex (login, signup, forgot-password)
- GA4 tracking (G-WMF29PM9E2)
- GSC verified via DNS

### Search & Discovery
- Search deduplication: normalizes titles, scores by quality, groups by title+author
- Fuzzy/typo-tolerant search: Levenshtein edit distance, ~35% tolerance, works on books/authors/series
- Smart/curly quote normalization for mobile keyboard compatibility
- Box sets filtered from search dropdown results
- Race condition fix: AbortController, request ID tracking, no flash-to-empty
- Discover page: filter state persisted in URL params (back button restores selections + results)
- Paused books excluded from recommendations (Discover + Home)

### Bookshelf & Stats
- Advanced bookshelf filters: year, genre, fiction/nonfiction, format, min rating, sort
- All filter state URL-driven (deep links work, back button preserves)
- Genre pills populated from user's actual books
- Default tab changed to TBR (was Activity)
- Deep links: reading goal on Home → bookshelf filtered view, books count on Stats → bookshelf
- Pencil icon for editing reading goal (separate from card navigation)
- Reading pace calculation subtracts paused time for accuracy

### Database & Enrichment
- Comprehensive dedup system: 1400+ duplicate books merged/deleted across local and live
- Dedup script with scoring (cover, ratings, clean title), user data migration, dry-run mode
- Hardened import matching: normalized title comparison prevents future dupes
- Enrichment: never overwrites manually-set covers (Amazon URLs, manual source)
- Sync script: always pulls live covers as authoritative source
- Non-English book filtering tightened (French, Spanish, suffix patterns, Estuche/Coffret)
- Auto-pause enrichment on API exhaustion
- 5,500+ books enriched in overnight runs
- 314 non-English junk entries cleaned
- Enrichment pipeline overhaul: OL → Brave → Google Books tiered approach
- Series health: Ender universe, Divergent, Maximum Ride, Sanderson/Cosmere, HWFWM, Riyria, Three-Body Problem, Lunar Chronicles, and many more
- Series audit script with comic/manga detection, position gap filling, year backfill

### Import System
- Two-phase import: fast Phase 1 (DB matching + state setting, no API calls) then background Phase 2 (OL search + enrichment)
- Chunked imports: client sends 100-book batches to avoid Vercel 5-min timeout
- Pre-loaded lookup cache: ISBNs, titles, authors, slugs all in memory — eliminates per-book DB round-trips
- Goodreads, StoryGraph (with paused state support), and Libby (OverDrive) importers
- Libby import: parses audiobook loan history, three default state options (completed/TBR/review each), Safari warning
- Re-import checkbox: skips books already in user's library (prevents duplicate sessions)
- Navigation warning during import (beforeunload + route change interceptor)
- Book-opening animation on import completion with count ticker
- In-app notification bell when background enrichment completes
- Fixed re-read session duplication (Goodreads only has one dateRead per book)

### User & Account Features
- Password reset flow (forgot password page + reset via email link)
- Change password in Settings
- Email verification: auto-redirect on verify, polling for verification status
- Daily signup digest email (replaces per-signup notifications, conserves Resend quota)
- Auto-generate handles from display names (or email prefix if no name)
- Profile bio: line breaks preserved
- Reviews: show all sources on profile (not just user-created), fix "Anonymous" display
- Notification bell with unread badge in nav bar
- Beta tester report icon visibility fixed
- Database sync tooling (incremental pull/push, admin Sync Users button, cover sync)
- "Auto-saved" indicator on Reading Preferences settings

### Design & UI
- Discover/Dig page: mood cards, gem sparkle, gradient dividers, visual polish
- Stats page: gradient cards, reading goal, genre donut, monthly bar chart
- LitRPG genre priority over Sci-Fi
- Methodology page: removed Home link, reordered sections, updated contact email
- Pill/badge styles: translucent backgrounds, never solid fills
- Up Next drag-to-reorder: Apple-style item shifting with CSS order transitions

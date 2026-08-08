# Project: tbr*a

A book tracking and discovery app — think Letterboxd for books.

## Commands
npm run dev           # Next.js dev server (port 3000)
npm run build         # Production build
npm run lint          # ESLint
npm run db:push       # Push Drizzle schema to SQLite
npm run db:seed       # Seed database
npm run deploy        # Full deploy (scripts/deploy.sh)
npm run deploy:db     # Deploy database only
npm run deploy:code   # Deploy code only

## Architecture
- Next.js 16, React 19, Tailwind 4, App Router
- SQLite via Drizzle ORM + libSQL (local: `data/tbra.db`, production: Turso)
- Auth: bcryptjs + jose (JWT sessions), email verification via Resend
- Blob storage: Vercel Blob (book covers, profile images)
- AI: OpenAI (xAI endpoint) for enrichment summaries
- Enrichment pipeline: OpenLibrary → ISBNdb → Library of Congress → BookBrainz → Brave Search → Grok/xAI → Google Books (multi-source, tiered)

## Key Directories
- `src/app/` — App Router pages (admin, book/[id], discover, library, profile, stats, etc.)
- `src/components/` — React components (book/, discover/, profile/, review/)
- `src/db/schema.ts` — Drizzle schema (books, authors, series, users, reviews, shelves, etc.)
- `src/lib/actions/` — Server actions (auth, books)
- `src/lib/queries/` — Database query functions
- `src/lib/enrichment/` — Book enrichment pipeline
- `scripts/` — 84+ utility scripts (import, enrichment, deploy)
- `data/tbra.db` — Primary SQLite database (62MB)
- `drizzle/` — Migration files

## Conventions
- Theme: `data-theme` attribute ("dark"/"light"), NOT Tailwind `dark:` prefix
- Accent color: ALWAYS `#a3e635` (lime-400). NEVER darken to olive/muted green.
  - **Opaque green backgrounds** (solid buttons, solid pills): ALWAYS black text (`#18181b`), both light AND dark mode
  - **Translucent green backgrounds** (10-20% opacity pills/badges): use `text-accent` — the global override at `globals.css:184` forces black in light mode. Tailwind opacity variants like `text-accent/60` do NOT get the override because they compile to unique class names; use `text-foreground/50` or `text-muted/60` instead.
  - **NEVER use `text-primary`** for text — it resolves to `#a3e635` (lime) which is unreadable on light backgrounds. Use `text-foreground` for body text, `text-neon-blue` for tappable text.
  - **NEVER use `text-secondary` or `text-tertiary`** — they aren't defined in the theme CSS and render as browser default. Use `text-muted` or `text-muted/60`.
- Fonts: Plus Jakarta Sans (body), Outfit (headings), Space Grotesk (logo only) via CSS vars `font-body`, `font-heading`, `font-logo` (next/font in layout.tsx; h1/h2/h3 get the heading font automatically via globals.css)
- Pill/badge styles: translucent backgrounds, never solid fills
- `.env.local` must be loaded explicitly for standalone scripts (outside Next.js)
- **SEO book page title must always be `What's Inside {book} | tbr*a`** — do not change the format. This is the documented SEO plan.
- **Brand name inconsistency is intentional:** short UI pages (buddy reads, author, user profile, book) use `tbr*a`. Conversion/landing pages (library, stats, discover, methodology, auth) use `The Based Reader App` for Google discoverability. Do NOT unify without explicit instruction.

## Scheduled Tasks
**Redesigned 2026-04-17. All write tasks use pull → run → push. Effective times post-jitter:**
- `nightly-discovery` — 12:21 AM PT: `nightly-import.ts` with `TARGET_BOOKS=500` (net books added), Christian weighted heaviest. **Rebuilt 2026-06-01:** primary engine is now paginated OpenLibrary *subject* feeds with persisted per-subject offsets (`data/subject-offsets.json`) so discovery pages ever deeper and never dries up. The old static curated-query list is kept only as a top-up safety net — it was structurally capped (one import per query) and had collapsed nightly volume to near-zero through May. Cascade backlist import capped at 25/author. A NYT Books API freshness source (10 bestseller lists, gated on `NYT_API_KEY` in `.env.local`) runs FIRST before the subject feeds to pull current releases; it silently no-ops if the key is absent. **`nightly-import.ts` is parameterized (2026-06-20):** env `SUBJECT_SET` picks `DISCOVERY_SUBJECTS` (default, this task) vs `BROAD_SUBJECTS` (the `breadth-import` task); `SUBJECT_OFFSET_FILE` gives each lane its own cursor; `DISABLE_NYT=1`/`DISABLE_LEGACY=1` strip the freshness + curated-seed sources for the subjects-only breadth lane. **Brave-free ingestion (2026-07-07):** the inline `enrichBook` call now passes `skipContentSearch:true` (metadata-only), so discovery no longer spends Brave — books land with metadata/genres/cover from free structured sources and DEFER Grok content ratings to `nightly-content-ratings-backfill`. This stopped discovery from silently burning ~3,000 Brave/night (it was starving the priority lanes); it also drops enrichBook's redundant internal author-discovery "double import" (the intended cascade is `importCascadeBooks`, import_only, capped 25/author).
- `nightly-junk-sweep` — 1:40 AM PT: flags box-sets + study guides into `/admin/issues`
- `nightly-report-triage` — 2:34 AM PT: `pull-testflight-feedback.ts` first (bridges TestFlight beta feedback from App Store Connect into reported_issues, tagged `[TestFlight tf:…]`, screenshots backed up to `data/testflight-feedback/`; added 2026-07-25), then `process-reports.ts` (direct on Turso)
- `nightly-placeholder-clear` — 3:15 AM PT: detects + clears known cover placeholders (ISBNdb `56c3e12f…` / 3736 bytes; Google Books `12557f8948b8…` / 15567 bytes). Does NOT auto-replace — cleared books land on `/admin/covers` for manual fix. (Renamed from `nightly-cover-rescue` on 2026-04-17 for clarity.)
- `nightly-description-refresh` — 4:04 AM PT, **Sun/Tue/Thu only** (`0 4 * * 0,2,4`): re-enriches `description_stale=1`, up to 500/night. Script hardened 2026-06-20: watchdog-exempt + self-governed `MAX_RUNTIME_MIN` ceiling (SKILL sets 140 since it runs solo on its nights), exits 0 so the chained push always runs, and an API circuit breaker that stops on `API_EXHAUSTED`/auto-pause instead of spinning. **Dropped Sat on 2026-06-20** to free Sat for `breadth-import`. **Alternates with content-ratings** — disjoint nights because both fire ~5 Brave searches/book and would otherwise blow the shared daily Brave cap + contend on single-writer SQLite.
- `nightly-content-ratings-backfill` — 4:54 AM, **Mon/Wed/Fri/Sat** (`45 4 * * 1,3,5,6`): **450** Grok enrichments/night (`BACKFILL_LIMIT=450` set in the task command; trimmed from 500 on 2026-07-17 to preserve shared-Brave headroom for daytime user adds — see Brave section). **Expanded from Mon/Fri → Mon/Wed/Fri/Sat on 2026-07-07**: once discovery+breadth went Brave-free (`skipContentSearch`), ~3,000 Brave/night was freed, so this — now the PRIMARY source of content ratings for the whole catalog (bulk ingestion defers ratings here) — runs 4 nights instead of 2 (~2,000 books/week). Wed/Sat are safe because `breadth-import` no longer spends Brave. Still disjoint from `nightly-description-refresh` (Sun/Tue/Thu), which also fires ~5 Brave/book. ~2,700 Brave/night (450 × ~6) + thin-recovery's ~300-360 leaves ~1,000/day headroom under the shared 4,200 cap. NOTE: filters `visibility='public'`, so import_only (search-added) books are handled by `scripts/fix-shelf-enrichment.ts`, not here. **Reworked 2026-08-08** after an audit found the lane finishing only ~150 of 450 books/night: (a) it now runs `CONCURRENCY` (default 4) books in flight — the serial loop spent ~60s of wall clock per book against the 150min ceiling and lost two thirds of every batch, while spending only ~900 of the 8,000 Brave/day cap, so throughput was the limit, not budget; (b) the candidate pool now includes **thin** books (>=50% "no evidence found"), sent with `force:true` (the trigger skips already-rated books otherwise) and carrying the same 21-day `enrichment_log` success cooldown `recover-thin-ratings.ts` uses — ~20k public books were invisible to the old `NOT IN book_category_ratings` query; (c) ordering is user-shelved → NYT bestseller (ISBN-13, titleKey fallback) → newest-first, replacing `ORDER BY users DESC, b.title`, which went alphabetical for ~96% of each batch. `DRY_RUN=1` prints the plan without spending budget. `push-content-ratings-to-turso.ts` also mirrors the run's `enrichment_log` successes so thin-recovery (6:44 AM) doesn't re-enrich what this lane just did.
- `sitemap-threshold-check` — **moved to launchd 2026-07-30** (`com.tbra.sitemap-threshold`, 5:36 AM). Alerts on 5K book-count boundary; now files a deduped `[AUTO-FLAG: sitemap-threshold]` /admin/issues alert on a crossing instead of only writing `reports/sitemap-threshold-{date}.md` for a Claude session to relay.
- `nightly-key-health` — **moved to launchd 2026-07-30** (`com.tbra.key-health`, 6:20 AM). ~6:10 AM PT: `check-api-keys.ts` canary. Curls the secret-guarded `GET /api/health/keys` (exercises LIVE prod env vars — the only way to catch key drift, since Sensitive Vercel vars read empty via `vercel env pull`). Checks 7 connections: **Brave, xAI, ISBNdb, Google Books** (enrichment providers) plus **Turso** (`SELECT 1`), **Vercel Blob** (`list`), and **Resend** (added 2026-07-05). **CRITICAL = Brave + xAI + Turso** (bad prod value silently breaks a core flow: enrichment hard-block or DB down); ISBNdb/Google Books/Blob/Resend are report-only. On critical failure files a deduped `[AUTO-FLAG: key-health]` /admin/issues alert (auto-resolves on recovery). GOTCHA: the Resend prod key is **sending-only**, so the check probes `POST /emails` with an incomplete body (422 = key authenticates = healthy) rather than `GET /domains` (which 401s for sending-only keys = false negative). Added 2026-06-20 after an invalid prod Brave key silently broke new-import enrichment for ~89 days (fix had only landed in local `.env.local`, never pushed to Vercel).
- `nightly-thin-recovery` — ~6:44 AM PT: `recover-thin-ratings.ts` (`TIER=2 MAX_BOOKS=60`; trimmed from 120 on 2026-07-17 — see Brave section). Re-enriches public books whose ratings are mostly "no evidence found" (the 2026-04-02→06-17 Brave-less-window residue) via the prod trigger `{force:true}` (writes straight to Turso; NOTE: since ~2026-06-26 ALL lanes share ONE Brave counter via QUOTA_TURSO_URL — there is no separate local counter). User-shelved books first, self-throttles on prod Brave 503, skips books with an enrichment_log success in the last 21 days. ~60% of attempts materially improve; ~300-360 Brave calls/night. Added 2026-06-20; grinds the ~11–14k thin-rating backlog over months (raise MAX_BOOKS if the Brave budget is raised).
- `breadth-import` — 10 AM, **Wed/Sat only** (`0 10 * * 3,6`): the endless popularity-ranked catalog-growth lane. Runs the SAME `nightly-import.ts` engine in BREADTH mode (`SUBJECT_SET=broad DISABLE_NYT=1 DISABLE_LEGACY=1 SUBJECT_OFFSET_FILE=data/breadth-offsets.json TARGET_BOOKS=500`), then `sync-incremental.sh push`. Pages OL `/subjects` feeds (`sort=readinglog`) across ~20 mostly-NONFICTION subjects (biography, history, science, psychology, business, self-help, true_crime, cooking, sci-fi, etc.) — the high-demand categories `nightly-discovery` (fiction/Christian-weighted) never reaches. Own offset cursor (`data/breadth-offsets.json`) pages ever deeper → never dries up; books enriched INLINE **metadata-only (`skipContentSearch:true`, 2026-07-07)** so they land with metadata/genres/cover but DEFER Grok ratings to `nightly-content-ratings-backfill` — this lane now spends **zero Brave**. **Runs Wed/Sat on purpose** — the only days with no legacy backfill; now that it's Brave-free the Wed/Sat slots are also free for the content-ratings backfill. **Replaced the retired `nightly-nyt-backfill`** (its historical NYT walk reached MIN_DATE 2011 and self-exited; `nyt-backfill.ts` + `data/nyt-backfill-cursor.json` remain for manual re-runs, and NYT *current-list* capture continues inside `nightly-discovery`).
- `upcoming-releases` — **3:09 AM ET** (`5 3 * * *`), daily: `upcoming-releases.ts` (`MAX_AUTHORS=150 MAX_BOOKS=60`) + `sync-incremental.sh push`. Rotates a ~7.7k buzz-author pool (NYT bestsellers ∪ user-favorited ∪ user-shelved) through Google Books `inauthor:"…"` newest, keeps volumes dated today…+18mo, inserts them public as preorders, enriches inline metadata-only (`skipContentSearch:true` → ZERO Brave; Grok ratings deferred to the content-ratings backfill). **Moved from 7:42 AM on 2026-07-30**: the Google Books daily quota resets at midnight Pacific = 3:00 AM ET, and this is the only lane whose work is purely Google-bound, so it now runs against a nearly untouched quota — `nightly-discovery` (12:21 AM ET) spends the *previous* quota day, and everything else that draws on Google (description-refresh, content-ratings, breadth-import, daytime prod imports) comes later. At 7:42 AM, 88 of 150 queries failed on 2026-07-30. **A `503` from `google-books.ts` = Queries-per-day exhausted, not an outage** (a direct probe returns the real `429 RESOURCE_EXHAUSTED`). The cursor (`data/upcoming-authors-cursor.json`) now carries a `deferred` re-check queue drained first each run, so a quota-starved night no longer silently burns author slots.
- Legacy `process-reported-issues` — disabled, manual only

### Mechanical jobs run on launchd, NOT as Claude scheduled tasks (2026-07-30)
Three no-judgment jobs were converted from Claude scheduled tasks to launchd agents:
`com.tbra.user-activity-sync` (every 30 min, quiet hours 3-9 AM), `com.tbra.sitemap-threshold`
(5:36 AM), `com.tbra.key-health` (6:20 AM). **Reason:** every scheduled-task firing left a
resident ~380MB `claude-code` process behind; user-activity-sync fires 34×/day (505 archived run
sessions at deletion time) and the three together were ~36 of ~45 daily sessions — the pileup that
twice drove the iMac to load 80 and starved the dev server (memory `project_mac_process_pileup`).
Converting them cut daily Claude sessions from ~45 to ~11.

All three invoke `scripts/lib/cron-run.sh <job> <command...>` (logs to `data/<job>.log` rotated at
5MB, PID lock, `TBRA_CRON_QUIET_HOURS`). Anything needing a human now files its own `/admin/issues`
alert via `scripts/lib/admin-alert.ts` — nobody reads launchd stdout. In particular
`sync-user-activity.ts` reimplements the old SKILL.md rule "escalate only if the same table fails
3+ consecutive runs" with a counter in `data/user-activity-sync-errors.json`, auto-resolving on
recovery. Full write-up + the original SKILL.md text: `docs/retired-scheduled-tasks/`.

**When adding a new scheduled job, ask whether it needs a language model at all.** If the task is
one command and the output only matters when it's an error, make it a launchd agent using
`cron-run.sh` and have the script file its own alert. Reserve Claude scheduled tasks for work where
the report or the judgment IS the product (discovery, content-ratings, triage, junk-sweep).

### NYT bestseller cache (added 2026-06-01)
`nyt_bestsellers` table (local + Turso) caches NYT Books API list data so the NYT API is hit only ~10–200×/night by the capture jobs — NEVER per-book. `nightly-discovery` captures the current lists; historical backfill is DONE (`nightly-nyt-backfill` retired 2026-06-20 after reaching MIN_DATE 2011 — 7,220 books cached across the two combined print-and-e-book lists; re-run `nyt-backfill.ts` manually to extend to other lists). Shared logic in `src/lib/enrichment/nyt.ts` (`fetchNytList`/`upsertNytEntries`/`findNytMatch`). Enrichment Phase 0.2 (`enrich-book.ts`) matches a book to the cache by ISBN-13 → titleKey and uses NYT's curated description/publisher over OL/Brave junk — this is also how USER IMPORTS get good descriptions (they run through `enrichBook` in production, reading the Turso-synced cache; zero NYT API calls per book). `sync-push.ts` mirrors the cache to Turso via INSERT OR REPLACE (step 5d). The publication-year cascade was also hardened 2026-06-01: the Brave-snippet year scraper was removed and implausible years (<1000 or >currentYear+1) are cleared + flagged. Requires `NYT_API_KEY` in `.env.local`; all NYT code no-ops gracefully without it.
- **When creating/replacing scheduled tasks:** Delete old tasks entirely rather than just disabling them. Disabled tasks clutter the sidebar.
- **Task IDs in sidebar:** The task ID you create is what shows in the user's sidebar. Use clear, descriptive IDs.
- **New tasks don't appear in sidebar until triggered once.** After creating a new task, immediately do a manual "Run now" to make it visible and to pre-approve tool permissions so future automatic runs don't stall on permission prompts.
- **Permission allowlist must include the cwd-prefix shape (CRITICAL — added 2026-05-04).** Every nightly SKILL.md command starts with `cd /Users/clankeredwards/claude/tbra && ...`. The user-level `~/.claude/settings.json` `Bash(*)` does NOT carry through to fresh scheduled-task sessions when project-level `.claude/settings.json` exists — project settings shadow it. The project allow-list MUST contain `Bash(cd /Users/clankeredwards/claude/tbra && *)` (already added). If you add a new task whose command isn't covered by `Bash(npm run *)` / `Bash(npx *)` / `Bash(tsx *)` / `Bash(./scripts/sync-incremental.sh *)` / `Bash(./scripts/*.sh *)` / `Bash(cd /Users/clankeredwards/claude/tbra && *)` — add the matching pattern to project settings BEFORE enabling the task. Symptom of this trap: tasks fire on cron, hang silently on a permission prompt while user is asleep, never log a `lastRunAt`. **Before enabling any new task, verify by manually running its bash command in your current session — if you don't see a permission prompt, the task is auto-approved; if you do, fix the allowlist first.**

## Cover Management (2026-04-17)
Auto-refill is **off** for existing books. Enrichment's Phase 4 cover cascade only runs when `cover_source IS NULL` — meaning the book has never been through the cascade. Subsequent enrichment runs skip Phase 4 for any book with a `cover_source` value.

- **Fresh import** → Phase 4 runs → `cover_source` set to whatever succeeded, or `'none-found'` if cascade came back empty.
- **nightly-cover-rescue** clears ISBNdb placeholder covers and sets `cover_source='isbndb-placeholder-cleared'`. Book then waits for manual review.
- **`/admin/covers`** — admin dashboard lists every book with a missing cover. 3 tabs: Priority (has_user_activity) / All pending / Abandon candidates (zero activity). Paste an Amazon URL → Save sets `cover_source='manual'`, `cover_verified=1`. Archive sets `visibility='hidden'`.
- **Never re-enable auto-refill for existing books** unless the user explicitly asks. The `/admin/covers` queue is the source of truth.

## Enrichment API Quotas
- **Brave Search:** valid key + HARD budget guard as of 2026-06-17. `braveSearch()` (the single choke point) calls `consumeApiQuotaWithMonthly("brave_search", BRAVE_DAILY_MAX, BRAVE_MONTHLY_MAX≈101000)` and throws `API_EXHAUSTED` when a cap is hit — no silent overspend. Budget = $505/mo ÷ $5/1k = 101k calls (the MONTHLY cap is the real money guard). Code default `BRAVE_DAILY_MAX=3300` but **prod overrides to 8,000 daily / 150,000 monthly** (Vercel env; RAISED from 4,200/101k on 2026-07-23 per Rebekah — beta-tester import quality over cost, worst case ~$750/mo): the 3,300 daily smoothing cap was stranding budget — the three 500-book jobs (each ≈3,300/day) already saturated it before `nightly-thin-recovery` (~600/day) got a turn, 503ing it to 0 books/night even though month-to-date usage was only ~18% of the 101k cap. 4,200 fits a 500-book job + thin-recovery on the same UTC day; the monthly cap is unchanged so max spend is still $505. `skipBrave` now defaults FALSE on the trigger route (content-ratings + user search-adds). **GOTCHA (fixed 2026-07-07): `skipBrave` alone does NOT make enrichment Brave-free** — the content-analysis searches (`enrich-book.ts` ~L682) and the audiobook lookup (`searchAudiobookLength` ~L1285) call `braveSearch()` unconditionally, ignoring it. So bulk lanes running `enrichBook(id)` with the default `skipBrave:true` were STILL spending ~6 Brave/book (~3,000/night for discovery), silently exhausting the daily cap and starving the priority lanes. The real zero-Brave switch is **`skipContentSearch:true`** (`EnrichOptions`): metadata-only pass — free structured sources + free cover tiers only, no Grok, ratings deferred to the content-ratings backfill. Now used by `nightly-discovery`, `breadth-import`, and `upcoming-releases`. Env overrides: `BRAVE_DAILY_MAX`, `BRAVE_MONTHLY_MAX`.
  **SHARED COUNTER (understood 2026-07-17):** since ~2026-06-26, `QUOTA_TURSO_URL`/`QUOTA_TURSO_TOKEN` in `.env.local` point the quota guard at the PROD Turso `api_quota_usage` table, so local nightly jobs and prod spend ONE combined budget (the local table's counter is dead — do not read it). Real spend is ~6 Brave/book (5 content searches + audiobook lookup). The 2026-07-17 incident: 500-book backfill (~3,000) + 120-book thin-recovery (~600) + stragglers exhausted the full 4,200 by ~8:30 AM PT on every Mon/Wed/Fri/Sat, so EVERY user-added book failed enrichment until the 5 PM PT (00:00 UTC) reset — a 223-book stuck backlog accumulated (books with only free-source metadata, no summary/ratings, page shows "being added"). CURRENT SIZING (2026-07-23): caps raised to 8,000/day + 150,000/mo; BACKFILL_LIMIT restored to 450, MAX_BOOKS=60. When sizing ANY new Brave-spending lane, budget against the SHARED 8,000/day + 150,000/mo, at ~6 calls/book. GOTCHA: standalone scripts read the cap envs at module load BEFORE dotenv runs (ESM hoisting) — pass BRAVE_DAILY_MAX/BRAVE_MONTHLY_MAX on the shell command line.
  GOTCHA: the daily counter is keyed on **UTC** day (resets 8 PM ET); a hard stop (cap OR a transient Brave 429) logged to `enrichment_log` trips a **1-hour global auto-pause** (`enrich-book.ts`) that 503s ALL content enrichment regardless of remaining budget. Primary metadata fallback after OpenLibrary.
- **Google Books:** 1,000 queries/day free tier, resets midnight Pacific. Cap bulk runs at 1,000. Use `skipGoogleBooks` option in `enrichBook()` during bulk operations.
- **ISBNdb:** Premium plan, 15,000 queries/day, 3/sec rate limit. Primary metadata source after OL. Fills covers, pages, publisher, year, description, ISBN variants.
  - **Search-driven calls are hard-capped at 2,000/day** via `api_quota_usage` table (see `src/lib/api-quota.ts`). Enrichment gets the rest.
- **Library of Congress:** Free, no key needed. Supplements genre/subject data. Rate limit ~20 req/sec.
- **BookBrainz:** Free, no key needed. Backup only — used when OL + ISBNdb both fail for book identification.
- **xAI (Grok):** content analysis runs **grok-4.5** (switched 2026-07-23; env-overridable via `XAI_ANALYZE_MODEL` in Vercel prod + .env.local — grok-3 was delisted from the account). Heal pass still `grok-3-mini` (`XAI_HEAL_MODEL`). The analyze prompt carries PER-CATEGORY INTENSITY CALIBRATION ANCHORS (analyze.ts) pinning every 0-4 threshold with catalog reference points (e.g. Harry Potter magic=3) — do not remove them; they are what keeps new models on the established scale. Monitor spend.
- **ENRICHMENT_PAUSED** in `.env.local`: set to `"true"` to halt all enrichment when quotas are exhausted. Currently `false`.

## Search Architecture (as of 2026-04-07)
- **Local-first, ISBNdb fallback.** The full search page queries only the local DB via `/api/openlibrary/search` (~20-80ms). If fewer than 5 results, the client fetches `/api/search/external` (ISBNdb-backed) to supplement.
- **Never call OpenLibrary search from user-facing endpoints.** `searchOpenLibrary()` is still used internally by the enrichment pipeline (`enrich-book.ts`, `discover-author.ts`, `backfill`, `import enrich-batch`) but NOT for UI search — it cascades up to 11 sequential HTTP calls and was causing 5-30s search latency.
- **`/api/search/external` quota enforcement:**
  - Hard daily cap of `DAILY_LIMIT = 2000` in the route file (hardcoded const, not env var)
  - Atomic increment via `consumeApiQuota()` in `src/lib/api-quota.ts`
  - 5-minute in-memory LRU cache (200 entries) to eliminate backspace/retype burn
- **ISBNdb-sourced imports:** `importFromISBNdbAndReturn()` in `src/lib/actions/books.ts` handles creating a minimal book row from ISBN+title+authors, generates the SEO slug via `assignBookSlug`, then triggers background enrichment. `ReadingStateButton` accepts an `externalImport` prop; `setBookStateWithImport` routes ISBNdb-sourced clicks through the new import path.
- **Unified nav search** (`/api/search`) is separate and queries local DB for books/series/authors/users in parallel. Used by `SearchBar` component in the nav, not the full search page.

## Import System
- **Two-phase import:** Phase 1 (fast, no API calls) creates/matches books and sets states. Phase 2 (background) runs OL search + enrichment for new books.
- **Chunked imports:** Client parses CSV via `/api/import/goodreads/parse`, then sends rows in batches of 100 to `/api/import/goodreads` (JSON mode). Each batch is a separate API call to avoid Vercel 5-min timeout.
- **Pre-loaded lookup cache:** `buildLookupCache()` in `import-goodreads.ts` loads all ISBNs, titles, authors, slugs, and user states into memory at import start. Per-book matching is in-memory Map lookups.
- **Dedup prevention:** `findExistingBook` and the cache both normalize titles (strip parentheticals, series suffixes) to match existing entries.
- **Re-reads:** Goodreads only exports ONE dateRead per book even for re-reads. Import creates only ONE session with the known date. Users can manually add re-read sessions via the Reading History UI.
- **Supported sources:** Goodreads, StoryGraph, Libby (OverDrive audiobook loans)

## Deduplication

Three dedup tools, each for a distinct pattern:

### 1. Generic title+author dedup (`scripts/dedup-books.ts`)
- **Run `npx tsx scripts/dedup-books.ts`** (supports `--dry-run`). Normalizes titles (strips parentheticals, subtitles, "A Novel"), groups by normalized title + author, scores each entry (cover, ratings, clean title), merges all user data into the canonical entry, then deletes dupes.
- Runs against LOCAL only. After it, removed book IDs must also be deleted from Turso (sync-push never deletes).

### 2. Cross-DB title+author dupes ("Parade of Horribles" pattern) — `scripts/find-title-author-dupes.ts` + `scripts/replay-dedup-both.ts`
- Scans for same-normalized-title + first-author books that exist as separate rows on Turso (often `/book/<title>` AND `/book/<title>-<author>` as parallel slugs). Dedicated runbook with step-by-step commands at `project_title_author_dupes.md` in Claude memory — read it before running anything.
- Flow: `find-title-author-dupes.ts --verify-turso` → `reports/title-author-dupe-manifest-<ts>.json` → `replay-dedup-both.ts --apply --chunk=5 --pause=200 --cooldown=60` (applies to BOTH local + Turso per pair, local first to block sync-push re-insertion). Uses `createGuardedTurso` per the Turso script safety rule (3h ceiling, PID lockfile, verified deletes).
- **Auto-merge gating is same-user-collision based, NOT zero-user based (changed 2026-07-30).** `replay-dedup-both.ts` moves a dupe's user rows onto the canonical with `INSERT OR IGNORE` and then DELETEs the source, so the only real hazard is one user holding rows on BOTH books — the OR IGNORE drops the dupe's row and the DELETE destroys it (silent loss of a rating/review/shelf state). The old rule approximated this as "every loser has 0 users", which blocked every multi-user group; on 2026-07-30 that was 2 auto-mergeable groups vs 31 under the real check. Shared logic lives in `scripts/lib/dupe-overlap.ts` (`MOVE_UNIQUE` + `findUserOverlap`), imported by BOTH the scanner and the applier so the table list can never drift.
  - Overlap is checked on **local AND Turso** — they disagree. On the first run of this change, 4 pairs were clean on Turso but collided locally; a Turso-only check would have merged them and eaten user data.
  - The applier re-checks every pair immediately before touching it (TOCTOU guard) — a tester can shelve either book between scan and apply. Colliding pairs are skipped, counted as `skip (collide)`, and listed under "Held for manual merge" in the run report.
  - **User rows move via `UPDATE book_id`, never `INSERT OR IGNORE` + `DELETE` (fixed 2026-07-30).** The old form silently DESTROYED rows in every table with a surrogate `id` PK (`user_book_ratings`, `user_book_reviews`, `user_favorite_books`, `up_next`, `tbr_notes`): the SELECT copied `id`, so the INSERT collided with the source row, OR IGNORE swallowed it, and the DELETE killed the original. It was invisible while only 0-user dupes were merged. See `project_dedup_move_destroyed_ratings` in memory.
  - Genuine collisions still need a hand merge (decide which state/rating/review wins). `MOVE_APPEND` tables move via plain `UPDATE book_id` and cannot collide.
- `scripts/ambiguous-dupes-report.ts` generates a markdown review of the groups the auto-merger declined.
- Follow-up: `delete-dupes-from-meilisearch.ts --manifest=<path> --apply` — Meilisearch index doesn't auto-purge after a dedup run.

### 3. Slug-collision dedup ("Midnight" pattern) — `scripts/audit-slug-collisions.ts` + `scripts/fix-slug-collisions.ts`
- Same slug, different UUIDs across local + Turso. See `reference_slug_collisions.md`.

### Related
- **Merge-shaped user reports auto-handled (patched 2026-04-21):** `process-reports.ts` detects "two versions / please merge / duplicate of this" language in reports, finds the sibling by normalized title + author, and auto-merges when clean. Ambiguous cases stay `status='new'` with `[merge-ambiguous: N siblings …]` prefix so they surface in `/admin/issues` rather than being silently buried. `deleteBook()` has a post-action SELECT verify that throws if the row survived — no more fabricated "Deleted" claims in nightly-triage reports. See `feedback_triage_verification.md`.
- **Live covers are authoritative:** sync-pull always overwrites local covers with live values. Manual cover fixes on live are never lost.

## Database Sync Architecture (rewritten 2026-04-16)
Local SQLite (`data/tbra.db`) and production Turso (`tbra-web-app-thebasedreaderapp`) can diverge. The sync scripts now talk to Turso via `@libsql/client` directly (NOT the `turso` CLI, which is authed to the wrong account — see note under "Watch Out For").

**Scripts:**
- `./scripts/sync-incremental.sh pull` → delegates to `scripts/sync-pull.ts`
- `./scripts/sync-incremental.sh push` → delegates to `scripts/sync-push.ts`
- Both read credentials from `.env.vercel.local` (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`). Run `npx vercel env pull` if that file is missing.

**`sync-pull.ts` (Turso → local):**
- For each table: INSERTs new rows (by primary key).
- For tables with `updated_at`: UPDATEs local when live timestamp is newer.
- Always overwrites local `cover_image_url` with the live value (live covers are authoritative).
- NEVER deletes local rows.

**`sync-push.ts` (local → Turso), 7 steps:**
1. **Local hygiene pre-pass** — deletes orphaned junction rows (book_authors/book_genres/book_series/book_category_ratings/enrichment_log where the referenced book/author/genre/series no longer exists locally). Prevents FK failures downstream.
2. NEW BOOKS — INSERT OR IGNORE books whose id isn't on Turso.
3. NEW AUTHORS — full diff, push all local authors not on Turso.
4. NEW SERIES — full diff.
5. NEW GENRES — full diff.
6. JOIN TABLES for new books (book_authors/book_genres/book_series/book_category_ratings/enrichment_log).
7. **5b. UPDATE existing books where local `updated_at` is newer** — pushes metadata fields (summary, description, publication_year, pages, publisher, cover_image_url, is_fiction, is_box_set, pacing, audiobook_cover_url, cover_verified, cover_source). NEVER touches id, slug, visibility, needs_review, created_at.
8. **5c. NEW JUNCTION ROWS for existing books** — enrichment adds new book_authors/book_genres/book_series/book_category_ratings for books that already exist on Turso. Pre-filters against live author/series/genre id sets to avoid FK failures.
9. **5e. NEW reported_issues (local-created flags)** — pushes rows created locally (e.g. `nightly-junk-sweep` box-set/study-guide flags) that aren't on live. `INSERT OR IGNORE` by id only, so a live admin resolution is never overwritten; diffs by id first and pre-filters `book_id` against live books. Added 2026-07-07 to close the long-standing gap where junk-sweep flags never reached `/admin/issues` on live and had to be hand-pushed each night.
10. LANDING PAGE tables (`landing_page_books`, `landing_page_copy`) — full replace (admin-curated, small tables).

**Targeted push scripts** (used by specific nightly tasks; don't run `sync-push.ts` end-to-end):
- `scripts/push-content-ratings-to-turso.ts` — used by `nightly-content-ratings-backfill`. Pushes `book_category_ratings` rows updated in last 2h plus the book's `summary`/`is_fiction`/`pacing`. DELETE + re-INSERT per book to avoid PK conflicts.
- `scripts/push-metadata-backfill-to-turso.ts` — used by `nightly-metadata-backfill`. Fills blank fields only (description, summary, cover_image_url, pages, publisher, publication_year). Never overwrites.

**User-facing tables that change on BOTH sides** (bidirectional sync required): `up_next`, `user_book_state`, `user_book_ratings`, `user_book_reviews`, `user_favorite_books`, `user_follows`, `reading_goals`, `reading_sessions`, `reading_notes`, `report_corrections`, `reported_issues`, `users`.

**Book/enrichment tables that change locally** (pushed via `sync-push.ts`): `books`, `authors`, `series`, `genres`, `book_authors`, `book_genres`, `book_series`, `book_category_ratings`, `editions`, `enrichment_log`.

**Deploy flow:**
- Before any deploy: `./scripts/sync-incremental.sh pull` then `./scripts/sync-incremental.sh push`. `deploy.sh --db-only` does both.
- NEVER nuke-and-replace live data. The old `deploy.sh` used to DELETE all live data and re-insert — this destroyed user activity created between pull and deploy. The current script only adds/updates, never deletes.

**The nightly tasks sync automatically:**
- `nightly-enrichment-v2` (12:08 AM PT) — NYT bestsellers import + enrichment + `sync-incremental.sh push`.
- `nightly-metadata-backfill` (5:12 AM PT) — ISBNdb/Google Books + `push-metadata-backfill-to-turso.ts`.
- `nightly-content-ratings-backfill` (3:45 AM PT) — Grok content ratings for 700 books + `push-content-ratings-to-turso.ts`.
- `nightly-report-triage` (2:27 AM PT) — resolves user reports.
- `nightly-book-cleanup` (3:24 AM PT) — junk title cleanup.

## Turso script safety (MANDATORY — added 2026-04-22)

**Any script that writes to production Turso must be guarded.** The history is that every unguarded script is one hung `await remote.execute()` away from saturating Turso connections and degrading the live site for hours (see 2026-04-20 postmortem + 2026-04-22 `push-content-ratings-to-turso.ts` hung 7h incident).

**Three layers enforce this:**

1. **`scripts/lib/turso-guard.ts`** — THE primary defense. Import `createGuardedTurso` and use it instead of `createClient` from `@libsql/client`. It provides:
   - Per-query timeout (default 30s — a hung query rejects instead of blocking forever)
   - Wall-clock self-abort (script declares its ceiling, process.exit(2) if exceeded)
   - PID lockfile at `/tmp/tbra-<name>.lock` (refuses to run if another copy holds it)
   - Auto-cleanup on SIGINT/SIGTERM/uncaughtException
   - Optional `longRunning: true` for scripts >watchdog threshold — touches `/tmp/tbra-longrun-<pid>` so the watchdog skips it

2. **Launchd watchdog** (`~/Library/LaunchAgents/com.tbra.watchdog.plist` → `scripts/lib/watchdog.sh`) — runs every 5 minutes, kills any `tsx` process under `/Users/clankeredwards/claude/tbra/` older than 60 min (env `TBRA_WATCHDOG_MAX_AGE_MIN` overrides). This is the floor: even if a new script skips the guard, the watchdog catches it. Log at `/tmp/tbra-watchdog.log`.

3. **CLAUDE.md rule (this section).** Every new Turso-writing script must use the guard. Agents reviewing existing code should retrofit any un-guarded script they touch.

**Authoring a new Turso-writing script — minimal template:**
```typescript
import { createGuardedTurso } from './lib/turso-guard';

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'my-script-name',          // lowercase-dashes, used for lockfile
    maxRuntimeMs: 20 * 60 * 1000,    // pick based on realistic p95 + 2×
    queryTimeoutMs: 30_000,
    longRunning: false,              // true if ceiling > 60min
  });
  // use remote.execute({ sql, args }) normally
  process.exit(0);
})();
```

**Do NOT**: call `createClient` directly from `@libsql/client` in scripts/. The guard wraps it. Reading or exploratory `/*` queries via the raw client in one-off investigations are OK; anything that writes, or loops, or runs in a cron — use the guard.

## Watch Out For
- **The one hard prohibition: NEVER nuke-and-replace the production database.** Do NOT wipe, `DROP`, `TRUNCATE`, or delete-and-repopulate a production table (or the whole DB) of curated book/author/enrichment data — i.e. the full "delete everything, then re-import" pattern the old `deploy.sh` used. That single operation caused a major bandwidth incident, and it requires the user's explicit, specific go-ahead **every time** (a general "go ahead" from another task does not count). Never destroy user-activity tables (reviews, ratings, shelves, reading states, sessions) under any circumstances.
- **Everything short of a full wipe is pre-authorized — do NOT ask for per-change approval.** Incremental row inserts/updates/deletes, schema migrations (`CREATE`/`ALTER`, new columns/tables, `db:push`), normal `sync-push`/`sync-pull`, targeted backfills/enrichment, and deploys are all routine: use the existing safety guards (`turso-guard`, watchdog, `vercel ls` verification) and your own judgment, and proceed without stopping to confirm. **Pause and confirm first only when an operation would (a) `DROP`/`TRUNCATE` a table, or (b) `DELETE` 1,000 or more rows in a single operation** (whether or not a re-insert follows — estimate the row count before running it; if unsure whether a delete clears the 1K bar, confirm). Writes, updates, and smaller deletes never need approval. The book database (62MB of curated, deduplicated, enriched entries) is precious, but protecting it means "no wholesale wipe + no mass delete," not "no writes."
- **ALWAYS take a screenshot to verify visual changes before telling the user it's done.** Never confirm a UI change is complete without visually confirming it yourself via screenshot. Zoom in on the affected area if the change is subtle.
- **ALWAYS verify CSS changes are actually applied** by checking the computed styles via JavaScript (`getComputedStyle` or inspecting `className` on the element). The Next.js dev server (Turbopack) frequently serves stale cached code — a hard refresh alone is NOT sufficient. If the computed styles don't match your code changes, kill the server (`lsof -ti:3000 | xargs kill -9`), delete `.next` (`rm -rf .next`), and restart (`npm run dev`). Do this BEFORE telling the user the change is live.
- **ALWAYS check `vercel ls` after every `git push`** to confirm the deploy reaches `Ready` status. Never trust that a push succeeded just because git accepted it. A broken env var (e.g. whitespace in `CRON_SECRET`) can silently fail all builds for days — this actually happened on 2026-04-04 and blocked ~3 days of deploys.
- **New schema columns must land on Turso BEFORE deploying code** that references them. The local `turso` CLI is authed to the wrong database (`tbra-rebekah-edwards`, not production `tbra-web-app-thebasedreaderapp`), so `turso db shell tbra-web-app "ALTER TABLE ..."` does NOT work. Apply via `@libsql/client` using `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` from `.env.vercel.local` instead. See `scripts/sync-push.ts` for the pattern.
- **Intensity labels are standardized:** None / Mild / Moderate / Significant / Extreme. Never use "Heavy", "Intense", "Strong" — and never "Minor"/"Major" (the methodology page had those until 2026-07-23; fixed).
- **Content category naming/order (2026-07-17):** the `romance_sex` category is displayed as **"Sexual content"** everywhere (taxonomy_categories.name renamed local+Turso; key unchanged). Display order for category lists is canonical in `src/lib/content-category-order.ts` (sexual content first) — book page, web settings, and /api/v1/settings all import it; never hand-sort categories.
- **Amazon affiliate tag MUST render in server HTML.** `buy-button.tsx` renders the tagged `<a href ...tag=>` in the INITIAL markup (not only inside the click dialog) — Amazon's reviewer scans raw HTML/View Source. Tag is env-overridable via `NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG` (current `tbra08-20` is from the REJECTED app). **As of 2026-06-17 the user has NOT supplied a fresh tracking ID — awaiting Amazon account reopen. Do NOT treat Amazon Associates as resolved.** Verify any change with `curl <book-url> | grep tag=` (not the hydrated DOM).
- **Super admins need BOTH `account_type = 'super_admin'` AND `role = 'admin'`** for the Admin Edit panel to show on book pages. When changing account types, always set both fields.
- **Import enrichment is deferred:** The import process does NOT call `enrichBook()` inline. New books get enriched by Phase 2 background call or the nightly task.
- **The user can't run commands** — dev server, deploys, scripts, CLI, DB operations all must happen from the agent side.
- **Never resize the browser window** — always ask the user to do it manually for mobile UI review (target: 390x844 for iPhone 14/15).
- **Port 3000 = tbr*a only.** Lion Publishing uses port 3333. Never fall back to 3000 for other projects.
- Database is SQLite — no concurrent writes. Scripts that modify DB should not run in parallel.
- `globals.css` has many carefully tuned opacity values — never use `replace_all` on opacity
- Hero card light mode vibrancy settings are hand-tuned — do not change without verifying visually
- See `docs/BRANDING.md` for full design system rules
- See `ROADMAP.md` for beta launch priorities and completed work
- See `project_session_progress.md` in Claude memory for the running log of recent session work

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->

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
- Fonts: Source Sans 3 (body), Literata (headings), Space Grotesk (logo only) via CSS vars `font-body`, `font-heading`, `font-logo`
- Pill/badge styles: translucent backgrounds, never solid fills
- `.env.local` must be loaded explicitly for standalone scripts (outside Next.js)
- **SEO book page title must always be `What's Inside {book} | tbr*a`** — do not change the format. This is the documented SEO plan.
- **Brand name inconsistency is intentional:** short UI pages (buddy reads, author, user profile, book) use `tbr*a`. Conversion/landing pages (library, stats, discover, methodology, auth) use `The Based Reader App` for Google discoverability. Do NOT unify without explicit instruction.

## Scheduled Tasks
- `nightly-enrichment-v2` — 12:03 AM PT: imports NYT bestsellers, runs full enrichment pipeline, syncs to Turso
- `nightly-metadata-backfill` — 1:03 AM PT: ISBNdb/Google Books backfill for books with missing data (15K/night). Disable after full catalog is backfilled (~3 nights from 2026-04-01).
- `nightly-book-cleanup` — 3:23 AM: catches audiobook splits, sessions, junk titles that slipped through import
- `sitemap-threshold-check` — 9:17 AM: notifies user when book count crosses 5K threshold (new sitemap to submit in GSC)
- **When creating/replacing scheduled tasks:** Delete old tasks entirely rather than just disabling them. Disabled tasks clutter the sidebar.
- **Task IDs in sidebar:** The task ID you create is what shows in the user's sidebar. Use clear, descriptive IDs.
- **New tasks don't appear in sidebar until triggered once.** After creating a new task, immediately do a manual "Run now" to make it visible and to pre-approve tool permissions so future automatic runs don't stall on permission prompts.

## Enrichment API Quotas
- **Brave Search:** rate-limited, use sparingly. Primary metadata fallback after OpenLibrary.
- **Google Books:** 1,000 queries/day free tier, resets midnight Pacific. Cap bulk runs at 1,000. Use `skipGoogleBooks` option in `enrichBook()` during bulk operations.
- **ISBNdb:** Premium plan, 15,000 queries/day, 3/sec rate limit. Primary metadata source after OL. Fills covers, pages, publisher, year, description, ISBN variants.
  - **Search-driven calls are hard-capped at 2,000/day** via `api_quota_usage` table (see `src/lib/api-quota.ts`). Enrichment gets the rest.
- **Library of Congress:** Free, no key needed. Supplements genre/subject data. Rate limit ~20 req/sec.
- **BookBrainz:** Free, no key needed. Backup only — used when OL + ISBNdb both fail for book identification.
- **xAI (Grok):** used for AI-generated summaries. Monitor spend.
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
- **Run `npx tsx scripts/dedup-books.ts`** to find and merge duplicate books. Supports `--dry-run` flag.
- **The script:** normalizes titles (strips parentheticals, subtitles, "A Novel"), groups by normalized title + author, scores each entry (cover, ratings, clean title), merges all user data into the canonical entry, then deletes dupes.
- **After running locally:** must also delete the removed book IDs from live Turso. The sync push script only adds new books, never deletes.
- **Live covers are authoritative:** The sync pull script always overwrites local covers with live versions. Manual cover fixes on live are never lost.

## Database Sync Rules
Local SQLite (`data/tbra.db`) and production Turso (`tbra-web-app`) can diverge. Always sync both directions before deploying.

- **NEVER nuke-and-replace live data.** The old `deploy.sh` used to DELETE all live data and re-insert from local — this destroyed user activity (reading sessions, notes, states) created between the last pull and the deploy. `deploy.sh` now uses `sync-incremental.sh` which only adds/updates, never deletes.
- **Before any deploy:** run `./scripts/sync-incremental.sh pull` (Turso → local) then `./scripts/sync-incremental.sh push` (local → Turso) to reconcile. `deploy.sh --db-only` does both automatically.
- **User-facing tables that change on BOTH sides:** `up_next`, `user_book_state`, `user_book_ratings`, `user_book_reviews`, `user_favorite_books`, `user_follows`, `reading_goals`, `reading_sessions`, `reading_notes`, `report_corrections`, `reported_issues`, `users`. These MUST be synced bidirectionally.
- **Book/enrichment tables that change locally:** `books`, `authors`, `book_authors`, `book_genres`, `editions`, `enrichment_log`, etc. These are typically pushed local → Turso after enrichment runs.
- **Never assume local = production.** Live users create accounts, write reviews, and update reading states directly on Turso. Local enrichment scripts add/update book metadata on the local SQLite. Both sides have unique changes.
- **The nightly task syncs automatically:** The `nightly-enrichment` scheduled task runs import → enrich → push at 12:03 AM PT. But if deploying mid-day, always pull first.

## Watch Out For
- **NEVER rewrite, reset, or bulk-modify the production database without explicit instruction from the user.** The book database (62MB, thousands of curated entries) has been cleaned, deduplicated, and enriched over many iterations. Schema migrations are fine; mass data operations are not.
- **ALWAYS take a screenshot to verify visual changes before telling the user it's done.** Never confirm a UI change is complete without visually confirming it yourself via screenshot. Zoom in on the affected area if the change is subtle.
- **ALWAYS verify CSS changes are actually applied** by checking the computed styles via JavaScript (`getComputedStyle` or inspecting `className` on the element). The Next.js dev server (Turbopack) frequently serves stale cached code — a hard refresh alone is NOT sufficient. If the computed styles don't match your code changes, kill the server (`lsof -ti:3000 | xargs kill -9`), delete `.next` (`rm -rf .next`), and restart (`npm run dev`). Do this BEFORE telling the user the change is live.
- **ALWAYS check `vercel ls` after every `git push`** to confirm the deploy reaches `Ready` status. Never trust that a push succeeded just because git accepted it. A broken env var (e.g. whitespace in `CRON_SECRET`) can silently fail all builds for days — this actually happened on 2026-04-04 and blocked ~3 days of deploys.
- **New schema columns must land on Turso BEFORE deploying code** that references them. Apply via `turso db shell tbra-web-app "ALTER TABLE ..."` first, then deploy.
- **Intensity labels are standardized:** None / Mild / Moderate / Significant / Extreme. Never use "Heavy", "Intense", or "Strong".
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

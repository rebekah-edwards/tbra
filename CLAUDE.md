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
- Enrichment pipeline: OpenLibrary -> Brave Search -> Google Books (tiered fallback)

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
  - **Translucent green backgrounds** (10-20% opacity pills/badges): black text in light mode; green text (`var(--primary)`) in dark mode
  - When in doubt: black text on green. Never white, never gray.
- Fonts: Source Sans 3 (body), Literata (headings), Space Grotesk (logo only) via CSS vars `font-body`, `font-heading`, `font-logo`
- Pill/badge styles: translucent backgrounds, never solid fills
- `.env.local` must be loaded explicitly for standalone scripts (outside Next.js)

## Scheduled Tasks
- **Active task:** `nightly-enrichment-v2` — runs at 12:03 AM PT daily
  - Imports NYT bestsellers (auto-skips already-imported)
  - Runs full enrichment pipeline (Phases 1-4)
  - Google Books capped at 800 queries (fallback only — skipped if OpenLibrary has covers)
  - Syncs results to production Turso via `sync-incremental.sh push`
- **When creating/replacing scheduled tasks:** Delete old tasks entirely rather than just disabling them. Disabled tasks clutter the sidebar. There should only ever be ONE active enrichment task.
- **Task IDs in sidebar:** The task ID you create is what shows in the user's sidebar. Use clear, descriptive IDs.
- **New tasks don't appear in sidebar until triggered once.** After creating a new task, immediately do a manual "Run now" to make it visible and to pre-approve tool permissions so future automatic runs don't stall on permission prompts.

## Enrichment API Quotas
- **Brave Search:** rate-limited, use sparingly. Primary metadata fallback after OpenLibrary.
- **Google Books:** 1,000 queries/day free tier, resets midnight Pacific. Cap bulk runs at 800. Use `skipGoogleBooks` option in `enrichBook()` during bulk operations.
- **xAI (Grok):** used for AI-generated summaries. Monitor spend.
- **ENRICHMENT_PAUSED** in `.env.local`: set to `"true"` to halt all enrichment when quotas are exhausted. Currently `false`.

## Database Sync Rules
Local SQLite (`data/tbra.db`) and production Turso (`tbra-web-app`) can diverge. Always sync both directions before deploying.

- **Before any deploy:** run `./scripts/sync-incremental.sh pull` (Turso → local) then `./scripts/sync-incremental.sh push` (local → Turso) to reconcile.
- **User-facing tables that change on BOTH sides:** `up_next`, `user_book_state`, `user_book_ratings`, `user_book_reviews`, `user_favorite_books`, `user_follows`, `reading_goals`, `reading_sessions`, `reading_notes`, `report_corrections`, `reported_issues`, `users`. These MUST be synced bidirectionally.
- **Book/enrichment tables that change locally:** `books`, `authors`, `book_authors`, `book_genres`, `editions`, `enrichment_log`, etc. These are typically pushed local → Turso after enrichment runs.
- **Never assume local = production.** Live users create accounts, write reviews, and update reading states directly on Turso. Local enrichment scripts add/update book metadata on the local SQLite. Both sides have unique changes.
- **The nightly task syncs automatically:** The `nightly-enrichment` scheduled task runs import → enrich → push at 12:03 AM PT. But if deploying mid-day, always pull first.

## Watch Out For
- **NEVER rewrite, reset, or bulk-modify the production database without explicit instruction from the user.** The book database (62MB, thousands of curated entries) has been cleaned, deduplicated, and enriched over many iterations. Schema migrations are fine; mass data operations are not.
- **ALWAYS take a screenshot to verify visual changes before telling the user it's done.** Never confirm a UI change is complete without visually confirming it yourself via screenshot. Zoom in on the affected area if the change is subtle.
- **ALWAYS verify CSS changes are actually applied** by checking the computed styles via JavaScript (`getComputedStyle` or inspecting `className` on the element). The Next.js dev server (Turbopack) frequently serves stale cached code — a hard refresh alone is NOT sufficient. If the computed styles don't match your code changes, kill the server (`lsof -ti:3000 | xargs kill -9`), delete `.next` (`rm -rf .next`), and restart (`npm run dev`). Do this BEFORE telling the user the change is live.
- Database is SQLite — no concurrent writes. Scripts that modify DB should not run in parallel.
- `globals.css` has many carefully tuned opacity values — never use `replace_all` on opacity
- Hero card light mode vibrancy settings are hand-tuned — do not change without verifying visually
- See `docs/BRANDING.md` for full design system rules
- See `ROADMAP.md` for beta launch priorities and completed work

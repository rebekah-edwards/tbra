# Current Task: Phase 5 — Deploy Prep + Content Pipeline

## What was completed

### Phase 0 — Scaffold (completed 2026-03-13)
- [x] Init Next.js 16 project (App Router) in `tbra/` with TypeScript and Tailwind CSS
- [x] Set up SQLite with Drizzle ORM — full schema matching `docs/schema-sketch-postgres.md`
- [x] Seed script creates 11 taxonomy categories from `docs/taxonomy-v0.md`
- [x] Page shells created: `/` (Home), `/search` (Search), `/book/[id]` (Book)
- [x] `npm run dev` starts without errors (Next.js 16.1.6 + Turbopack)

### Competitor Research Dashboard (completed 2026-03-13)
- [x] HTML dashboard with tabbed navigation covering Goodreads, StoryGraph, Fable, Bookmory, Bookly
- [x] Deployed to GitHub Pages: https://rebekah-edwards.github.io/tbra/

### Phase 1 — Book Data + Search + Visual Design (completed 2026-03-13)
- [x] Design system: teal primary + warm stone neutrals, light mode only
- [x] Schema: added `coverImageUrl` and `openLibraryKey` to books table
- [x] Open Library client (`src/lib/openlibrary.ts`): search, fetch work, build cover URLs
- [x] API route: `GET /api/openlibrary/search?q=...` proxy for client-side search
- [x] Server actions: `importFromOpenLibrary`, `createBookManually`
- [x] Book queries: `getBookWithDetails` joins books + authors + genres + ratings + links
- [x] Search page with debounced Open Library search + import
- [x] Book detail page: cover, authors, expandable description, content profile bars
- [x] Manual entry form at `/search/add`
- [x] Content profile component: 4-segment intensity bars with evidence badges
- [x] Seeded 15 books with sample taxonomy ratings via `npm run db:seed-books`

### Phase 2 — Book Page Improvements + Author Features (completed 2026-03-13)
- [x] Renamed "Add to Library" → "Import Book" on search page
- [x] Simplified evidence badges: "AI" (merged ai_inferred + cited) and "Verified"
- [x] Fixed reference-style markdown links in book descriptions (The Road)
- [x] Spoiler wall: content profile notes hidden behind "May contain spoilers" banner
- [x] Expandable notes for human-verified ratings (Read more/Show less)
- [x] Genre normalization: OL subjects mapped to clean tags on import
- [x] All 15 seeded books now have all 11 category ratings (165 total)
- [x] All 15 seeded books now have genre tags
- [x] Author pages: `/author/[id]` with name + book grid
- [x] Clickable author names on book pages link to author pages
- [x] Author cascade import: importing a book auto-imports other works by same author
- [x] `openLibraryKey` added to authors table for OL linking

### Phase 2.5 — Book Page Redesign + Series + UX (completed 2026-03-13)
- [x] Blurred cover hero card: each book's cover blurred as dynamic background, white text overlay
- [x] Genre tags as semi-transparent pills on hero card
- [x] "View editions" moved into hero as subtle unlinked text
- [x] 1-3 sentence summaries for all books (above description)
- [x] Description retitled to "From the Author/Publisher:"
- [x] Spoiler wall redesign: full blur with bright teal "Reveal Content Details" button
- [x] Search: "Import to tbr(a)" button, clickable cover and title
- [x] Author page: full-height cover images (aspect-[2/3])
- [x] Series schema: `series` and `bookSeries` tables
- [x] DCC books 1-6 seeded with series linkage, ratings, genres, summaries
- [x] Functional horizontal-scroll series component with position labels
- [x] Summary column added to books table

### Phase 3 — Auth + User State + Editions (completed 2026-03-13)
- [x] User auth: signup, login, logout with bcrypt + JWT sessions (7-day HTTP-only cookies)
- [x] Reading state: TBR / Currently Reading / Completed / Paused / DNF per book
- [x] Format tracking: Hardcover / Paperback / eBook / Audiobook with active format selector
- [x] Edition picker: browse OL editions in a bottom sheet, link specific editions to owned formats
- [x] Edition data cached locally in `editions` table on first browse
- [x] Home page: personalized Currently Reading / TBR / Recently Completed sections (auth-gated)
- [x] Profile page: avatar, display name, stats grid, book sections by state
- [x] Profile edit: display name + avatar upload (local filesystem storage)
- [x] Reading state button on search results: auto-imports book on first interaction
- [x] Mobile nav: avatar dropdown with profile link, theme toggle, sign out
- [x] Dark/light theme: full dual-theme CSS variable system with animated toggle
- [x] Methodology page: explains content rating philosophy, 0-4 scale, all 11 categories, evidence levels
- [x] "What's Inside" rename (was "Content Profile")
- [x] LGBTQ+ Rep. category label updates
- [x] Book page shows audio length when audiobook format is active

### Phase 4 — Series Auto-Detection (completed 2026-03-13)
- [x] Books imported via OL cascade include series data (Licanius Trilogy detected with 86 books now in DB)
- [x] Series component displays on book pages with position labels

## What to do next

Priority order:
1. **Auto-research pipeline** — AI-assisted content classification for imported books without ratings
2. **Report corrections UI** — schema exists (`report_corrections` table), needs frontend form + admin triage view
3. **Catalog expansion** — seed/import target of 100 books with content profiles
4. **Deploy prep** — swap SQLite → PostgreSQL, move avatar storage off local filesystem, deploy to Vercel + Railway/Render
5. **Polish & hardening** — sanitize markdown renderer (XSS risk), fix N+1 in `getUserBooks`, add author bios

## Known issues
- `dangerouslySetInnerHTML` in book description markdown renderer — needs sanitization
- N+1 query in `getUserBooks` (author lookup per book in a loop)
- Avatar storage is local filesystem (`public/uploads/`) — won't survive serverless deploy
- Several schema tables unused: `narrators`, `book_narrators`, `citations`, `rating_citations`, `links` (queried but not rendered)
- No tests
- No email verification or password reset flow
- CLAUDE.md still says "No auth yet" — outdated

## Context
- Repo: https://github.com/rebekah-edwards/tbra (public)
- Dashboard: https://rebekah-edwards.github.io/tbra/
- Stack: Next.js 16 + SQLite + Drizzle ORM locally
- Database: 86 books, 26 authors, 1 user, 1 series (DCC), 0 editions cached yet
- Routes: `/`, `/search`, `/search/add`, `/book/[id]`, `/author/[id]`, `/methodology`, `/login`, `/signup`, `/profile`, `/profile/edit`
- API routes: `/api/openlibrary/search`, `/api/openlibrary/editions`, `/api/books/check`, `/api/profile`

# Current Task: Phase 3 — TBD

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
- [x] Editions section placeholder ("View editions" link)
- [x] Series section placeholder ("Series information coming soon")
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

## What to do next
Priority order:
1. **Methodology page** — collaborative content, quick win
2. **In-app editions page** — build `/book/[id]/editions` from OL API
3. **Auto-research pipeline** — AI content classification
4. **Series auto-detection** — detect series from OL during import
5. **User auth + reading state** — TBR/reading/completed tracking

## Context
- Repo: https://github.com/rebekah-edwards/tbra (now public)
- Dashboard: https://rebekah-edwards.github.io/tbra/
- Stack: Next.js + SQLite + Drizzle ORM locally
- Routes: `/`, `/search`, `/search/add`, `/book/[id]`, `/author/[id]`, `/api/openlibrary/search`

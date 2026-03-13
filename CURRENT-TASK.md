# Current Task: Phase 2 — TBD

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
- [x] Search page with debounced Open Library search + "Add to Library" import
- [x] Book detail page: cover, authors, expandable description, content profile bars
- [x] Manual entry form at `/search/add`
- [x] Content profile component: 4-segment intensity bars with evidence badges
- [x] Seeded 15 books (6 with sample taxonomy ratings) via `npm run db:seed-books`

## What to do next (Phase 2)
- TBD — awaiting assignment

## Context
- Repo: https://github.com/rebekah-edwards/tbra (now public)
- Dashboard: https://rebekah-edwards.github.io/tbra/
- Stack: Next.js + SQLite + Drizzle ORM locally
- Routes: `/`, `/search`, `/search/add`, `/book/[id]`, `/api/openlibrary/search`

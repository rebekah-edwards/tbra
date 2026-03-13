# Current Task: Phase 1 — Book data + search

## What was completed

### Phase 0 — Scaffold (completed 2026-03-13)
- [x] Init Next.js 16 project (App Router) in `tbra/` with TypeScript and Tailwind CSS
- [x] Set up SQLite with Drizzle ORM — full schema matching `docs/schema-sketch-postgres.md`
- [x] Seed script creates 11 taxonomy categories from `docs/taxonomy-v0.md`
- [x] Page shells created: `/` (Home), `/search` (Search), `/book/[id]` (Book)
- [x] `npm run dev` starts without errors (Next.js 16.1.6 + Turbopack)

### Competitor Research Dashboard (completed 2026-03-13)
- [x] HTML dashboard with tabbed navigation covering Goodreads, StoryGraph, Fable, Bookmory, Bookly
- [x] Book page structure breakdowns per app
- [x] Branding teardowns with color palettes
- [x] Complete feature lists per app
- [x] Strengths/weaknesses vs tbr(a)
- [x] Taxonomy comparison (our 11 categories vs all competitors)
- [x] Deployed to GitHub Pages: https://rebekah-edwards.github.io/tbra/
- [x] Repo made public to support GitHub Pages

## What to do next (Phase 1)
1. Integrate Open Library API for book metadata (title, author, ISBN, description, cover)
2. Build search: full-text search across title + author + description
3. Manual book entry form (for books not in Open Library)
4. Seed 10-20 books for testing

## Context
- Repo: https://github.com/rebekah-edwards/tbra (now public)
- Dashboard: https://rebekah-edwards.github.io/tbra/
- Stack: Next.js + SQLite + Drizzle ORM locally

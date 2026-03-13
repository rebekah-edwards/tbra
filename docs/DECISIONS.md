# DECISIONS.md — tbr(a) / Spine

Short, dated decisions log. Keep entries crisp: *decision → why → implications*. 

## 2026-02-26
- v0 requires login (persist TBR + reading state).
- v0 core flow: Home (TBR + Recently Read) → Search → Book Page → Report correction.
- Evidence levels: AI Inferred / Cited (internal citations) / Human Verified (full read).

## 2026-03-12
- "Why we think this" citations shown for ALL categories, not just disputed ones. Expandable section on every book page.
- Tech stack: Next.js + SQLite locally for development; swap to PostgreSQL at deploy time. Zero hosting cost until launch.
- Spine defaults to Sonnet 4.6 for cron runs. Escalates to Opus for complex architectural tasks (multi-file refactors, deep design decisions).
- Overnight schedule: Tue/Thu 3 AM ET. Interleaved with Lore (Mon/Wed/Fri 3 AM).

## 2026-03-13
- Phase 0 scaffold complete: Next.js 16 + Drizzle ORM + SQLite. Schema matches schema-sketch-postgres.md. 11 taxonomy categories seeded.
- Repo made public to support GitHub Pages. No secrets in the codebase — safe for now.
- Competitor dashboard deployed to GitHub Pages (gh-pages branch). Covers Goodreads, StoryGraph, Fable, Bookmory, Bookly.
- Bookmory and Bookly added to competitor analysis. Both are personal habit trackers with zero content classification — reinforce our differentiation.
- Fable faced AI controversy in early 2025 — cautionary note for our AI-assisted classification messaging.

## 2026-03-13 (Phase 1)
- Design system: teal primary (#0d9488) + warm stone neutrals (#fafaf9). Light mode only for MVP. "Well-lit bookshop" feel.
- Search flow: Open Library only (no local search) — we have no books in DB yet, local search adds complexity for zero value.
- Book import trigger: user clicks search result → intentional import, not auto-scraping.
- Cover storage: URL string only (no file storage). Open Library CDN is reliable.
- Empty content profile shows "No profile yet" — ratings are editorial, never auto-generated.
- Server actions for mutations, 1 API route for OL search proxy (search needs client-side debounce).

## 2026-03-13 (Phase 2)
- Evidence badges simplified: merged "AI" + "Cited" into single "AI" badge. Only two visual states: "AI" and "Verified". Reduces cognitive load.
- Spoiler wall: category names + intensity bars always visible, descriptive notes hidden behind opt-in banner. Single toggle reveals all.
- Genre normalization: map OL subjects to curated genre tags (cap at 6 per book). Filter noise like "Accessible book" or "NYT bestseller".
- Author cascade import: when importing a book, non-blocking fetch of all works by same author. Title + cover only — no content research on cascade imports.
- Rate limiting OL API: 350ms delay between calls during cascade import. Respectful use of public API.
- `openLibraryKey` on authors table: enables linking back to OL for author bibliographies.
- Editions and series sections are UI shells only — no schema yet. Avoids premature complexity.
- Auto-research pipeline deferred: needs AI integration planning, not a quick add. Will build as separate phase.

## 2026-03-13 (Phase 2.5)
- Book page redesign: blurred cover as dynamic background (Spotify/Fable style). Pure CSS, no color extraction library needed — the cover itself is the palette.
- Hero card contains cover, title, author, metadata, genres, editions — single visual unit replacing the sparse layout.
- Summaries are AI-written (by Spine) 1-3 sentences, stored in `summary` column. Separate from OL description which is often too long.
- Spoiler wall redesign: entire content profile blurred behind a bright button, not just notes. Clearer visual signal, Fable-inspired.
- Series data: `series` + `bookSeries` tables. DCC is the first series populated (books 1-6, book 7 not yet on OL).
- DCC Book 7 ("The Cage of Dark Hours") not found on Open Library — may need manual entry later.
- Next priorities: methodology page → in-app editions → AI research pipeline → series auto-detection → auth.

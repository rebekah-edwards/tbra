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

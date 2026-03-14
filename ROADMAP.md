# tbr(a) — MVP Roadmap

Owner: Rebekah (product) / Spine (architecture)
Updated: 2026-03-13

## Phase 0 — Scaffold ✅
- Init Next.js project in `tbra/`
- Set up SQLite with ORM (Drizzle) matching `docs/schema-sketch-postgres.md`
- Seed the 11 taxonomy categories from `docs/taxonomy-v0.md`
- Create page shells: Home (`/`), Search (`/search`), Book Page (`/book/[id]`)
- Verify local dev server runs

## Phase 1 — Book data + search ✅
- Integrate Open Library API for book metadata (title, author, ISBN, description, cover)
- Build search: debounced Open Library search with import flow
- Manual book entry form (for books not in Open Library)
- Seed 15 books with full content ratings across all 11 categories

## Phase 2 — Content profile display ✅
- Book page: render all 11 taxonomy categories with intensity bars (0-4)
- Show notes for categories with intensity >= 2
- Spoiler wall: blur content details behind opt-in reveal button
- Evidence badge (AI / Human Verified)
- Genre normalization on import
- Author pages with book grids + cascade import

## Phase 2.5 — Book page redesign + series ✅
- Blurred cover hero card (Spotify/Fable style)
- AI-written summaries for all seeded books
- Series schema + DCC series (books 1-6)
- Horizontal-scroll series component
- Methodology page (What's Inside philosophy, categories, evidence levels)

## Phase 3 — Auth + user state + editions ✅
- User registration + login (email/password with bcrypt + JWT)
- Reading states: TBR / Currently Reading / Completed / Paused / DNF
- Format tracking: Hardcover / Paperback / eBook / Audiobook
- Edition picker: browse OL editions, link specific editions to owned formats
- Home page: personalized Currently Reading / TBR / Recently Completed
- Profile page with avatar, stats, and book sections
- Dark/light theme toggle

## Phase 4 — Series auto-detection ✅
- Series detected and linked during OL import
- Series component on book pages

## Phase 5 — Content pipeline + corrections (next)
- Auto-research pipeline: AI-assisted content classification for books without ratings
- Report corrections UI (schema exists, needs frontend + admin triage)
- Target: 100 books with content profiles

## Phase 6 — Deploy
- Swap SQLite → PostgreSQL (Railway or Render)
- Move avatar storage to object storage (S3/R2)
- Deploy frontend to Vercel
- Domain setup
- Sanitize markdown renderer (XSS), fix N+1 queries, add tests

---

Each phase should be completable in 2-4 overnight dev sessions. Spine updates CURRENT-TASK.md after each run.

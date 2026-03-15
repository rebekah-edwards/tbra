# tbr(a) — MVP Roadmap

Owner: Rebekah (product) / Spine (architecture)
Updated: 2026-03-14

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

## Phase 4.5 — Reviews + reading history ✅
- Review wizard: overall rating, mood, dimensions, tags, rich text with spoilers ✅
- View all reviews page with sort/filter ✅
- Helpful votes + share ✅
- Inline review summary on book page: top tags, top 3 reviews, summary ✅
- Reading history system: `reading_sessions` table with re-read tracking ✅
- Fable-style completion date picker (scroll wheels, precision tabs, "I don't remember") ✅
- Review gate: must mark Finished/DNF before reviewing ✅
- Auto-open review wizard after marking a book finished ✅

## Phase 5 — Content pipeline + corrections (next)
- Auto-research pipeline: AI-assisted content classification for books without ratings
- Report corrections UI (schema exists, needs frontend + admin triage)
- Content detail updates by users (not just selecting buttons during review but entering actual information)
- "Based Readers" (super users) who can do less-monitored content detail updates
- Update legacy book pages still using "child harm" → "abuse & suffering" and missing user-added section
- Target: 100 books with content profiles

## Phase 6 — Homepage + feed
- Determine the homepage experience for logged-in users (feed? social? recommendations? up next?)
- Flow for books automatically added to your pipeline to assess

## Phase 7 — Search overhaul
- Add import button so users can add books directly to "owned" list from search
- Better search UX and result ranking

## Phase 8 — Profile + gamification
- Profile layout refresh
- Custom user lists (beyond TBR/Reading/Completed)
- Gamification elements (streaks, badges, reading challenges)

## Phase 9 — Social features
- Buddy reads
- Limited social: show if people you follow have interacted with a book (on book page)
- Social feed elements

## Phase 10 — SEO + metadata
- Page-level metadata for all routes
- Slug structure for book pages, reviews, author pages
- Open Graph + structured data

## Phase 11 — Monetization + links
- Buy links section on book pages (affiliate links where possible)
- Process for sourcing/managing affiliate links
- Free vs. premium user plan structure
- Giveaways feature

## Phase 12 — Deploy
- Swap SQLite → PostgreSQL (Railway or Render)
- Move avatar storage to object storage (S3/R2)
- Deploy frontend to Vercel
- Domain setup
- Sanitize markdown renderer (XSS), fix N+1 queries, add tests

## Future considerations
- Refactor book page into tabbed layout (About / Reviews / etc.) as more features land
- Review summary improvements (AI-generated summaries, more sophisticated aggregation)
- Updates to default book images (placeholder covers)

---

Each phase should be completable in 2-4 overnight dev sessions. Spine updates CURRENT-TASK.md after each run.

# tbr(a) — MVP Roadmap

Owner: Rebekah (product) / Spine (architecture)
Updated: 2026-03-12

## Phase 0 — Scaffold
- Init Next.js project in `tbra/`
- Set up SQLite with ORM (Drizzle or Prisma) matching `docs/schema-sketch-postgres.md`
- Seed the 11 taxonomy categories from `docs/taxonomy-v0.md`
- Create page shells: Home (`/`), Search (`/search`), Book Page (`/book/[id]`)
- Verify local dev server runs

## Phase 1 — Book data + search
- Integrate Open Library API for book metadata (title, author, ISBN, description, cover)
- Build search: full-text search across title + author + description
- Manual book entry form (for books not in Open Library)
- Seed 10-20 books for testing

## Phase 2 — Content profile display
- Book page: render all 11 taxonomy categories with intensity bars (0-4)
- Show notes for categories with intensity >= 2
- "Why we think this" expandable section with citations (for all categories)
- Evidence badge (AI Inferred / Cited / Human Verified)
- Admin/seed tool: manually add content ratings for test books

## Phase 3 — Auth + user state
- User registration + login (email/password or magic link)
- "Add to TBR" / "Mark as Read" / state selector per book
- Home page: show user's TBR list + recently read

## Phase 4 — Report corrections
- "Report a correction" button on every book page
- Form: category, proposed intensity, proposed notes, citation link, freeform explanation
- Admin view to triage corrections (new → accepted/rejected)

## Phase 5 — Deploy
- Swap SQLite → PostgreSQL (Railway or Render)
- Deploy frontend to Vercel
- Domain setup
- Seed initial catalog (target: 100 books with content profiles)

---

Each phase should be completable in 2-4 overnight dev sessions. Spine updates CURRENT-TASK.md after each run.
